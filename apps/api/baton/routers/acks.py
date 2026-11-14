"""Round 3 improvement #3 (part 1): successor acknowledgement, with open questions tracked to closure.

The successor responds to each item of the approved handover they can see: "Got it", "I have a question" or "Not mine".
A response belongs to one approved VERSION. When a new version keeps an item's text unchanged the response carries
over; when the text changed it resets and the item is flagged "changed since you acknowledged". A question goes to
the reviewer, who answers it in place; the successor then closes it. Only items the successor may see can be
acknowledged (the same projection as the handover view), so this can't be used to probe withheld items.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from baton import notify
from baton.acl import Viewer
from baton.auth import _roles
from baton.db.models import Acknowledgement, AuditEvent, Handover, HandoverVersion, Member
from baton.db.session import get_db
from baton.ingest.scrubber import mask_pii, scrub
from baton.routers.handovers import _handover, _latest, _project

router = APIRouter(prefix="/api", tags=["Successor acknowledgement"])


def _successor_view(db: Session, h: Handover, v: HandoverVersion) -> dict[str, dict]:
    """claim_id -> item, for the non-history items the successor sees in this version."""
    succ = db.get(Member, h.successor_member_id) if h.successor_member_id else None
    if succ is None:
        return {}
    view = _project(db, h, v, Viewer(str(succ.id), _roles(db, succ.id, succ.workspace_id)), mask=True)
    return {it["claim_id"]: {**it, "section": s["title"]} for s in view["sections"] for it in s["items"]
            if not it.get("restricted") and it.get("claim_id") and not it.get("history")}


def _snapshot_texts(v: HandoverVersion) -> dict[str, str]:
    return {it["claim_id"]: it["text"] for it in v.snapshot.get("items", [])}


def _effective(db: Session, h: Handover, v: HandoverVersion, items: dict[str, dict]) -> dict[str, dict]:
    """claim_id -> the successor's current response, carried over from earlier versions when the text is unchanged."""
    if not h.successor_member_id:
        return {}
    versions = {x.id: x for x in db.scalars(select(HandoverVersion).where(HandoverVersion.handover_id == h.id))}
    acks = list(db.scalars(select(Acknowledgement).where(Acknowledgement.member_id == h.successor_member_id,
                                                         Acknowledgement.handover_version_id.in_(list(versions)))))
    names = {m.id: m.display_name for m in db.scalars(select(Member).where(Member.workspace_id == h.workspace_id))}
    texts_cache: dict = {}
    out: dict[str, dict] = {}
    for cid, it in items.items():
        mine = [a for a in acks if str(a.claim_id) == cid]
        cur = next((a for a in mine if a.handover_version_id == v.id), None)
        if cur is not None:
            out[cid] = _ack_out(cur, names, carried=False)
            continue
        older = sorted((a for a in mine if versions[a.handover_version_id].version < v.version),
                       key=lambda a: versions[a.handover_version_id].version, reverse=True)
        if older:
            a = older[0]
            ov = versions[a.handover_version_id]
            texts = texts_cache.setdefault(ov.id, _snapshot_texts(ov))
            if mask_pii(texts.get(cid, "")) == it["text"] or texts.get(cid) == it["text"]:
                out[cid] = _ack_out(a, names, carried=True)
            else:
                out[cid] = {"state": None, "changed_since": ov.version}
    return out


def _ack_out(a: Acknowledgement, names: dict, carried: bool) -> dict:
    return {"id": str(a.id), "state": a.state, "note": a.note, "answer": a.answer,
            "answered_by": names.get(a.answered_by), "answered_at": a.answered_at.isoformat() if a.answered_at else None,
            "closed": a.closed_at is not None, "carried": carried, "updated_at": a.updated_at.isoformat() if a.updated_at else None}


def _counts(items: dict, eff: dict) -> dict:
    states = [eff.get(cid, {}) for cid in items]
    q = [s for s in states if s.get("state") == "question"]
    return {"total": len(items),
            "acknowledged": sum(1 for s in states if s.get("state") == "acknowledged"),
            "not_mine": sum(1 for s in states if s.get("state") == "not_mine"),
            "questions_open": sum(1 for s in q if not s.get("answer") and not s.get("closed")),
            "questions_answered": sum(1 for s in q if s.get("answer") and not s.get("closed")),
            "questions_closed": sum(1 for s in q if s.get("closed")),
            "changed": sum(1 for s in states if s.get("changed_since")),
            "untouched": sum(1 for s in states if not s.get("state"))}


@router.get("/handovers/{handover_id}/acks")
def get_acks(handover_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    h, ctx = _handover(db, request, handover_id)
    is_succ = ctx.member.id == h.successor_member_id
    if not (ctx.is_reviewer or is_succ):
        raise HTTPException(403, "Acknowledgements are shared between the successor and the reviewer")
    v = _latest(db, h, None)
    if v is None:
        return {"version": None, "items": {}, "counts": _counts({}, {}), "questions": []}
    items = _successor_view(db, h, v)
    eff = _effective(db, h, v, items)
    if not ctx.is_reviewer:  # the reviewer's answers follow the same PII rule as everything else the successor reads
        eff = {k: {**x, "answer": mask_pii(x["answer"]) if x.get("answer") else x.get("answer")} for k, x in eff.items()}
    questions = [{"claim_id": cid, "text": items[cid]["text"], "section": items[cid]["section"], **eff[cid]}
                 for cid in items if eff.get(cid, {}).get("state") in ("question", "not_mine")]
    questions.sort(key=lambda q: (q["state"] != "question", bool(q.get("closed")), bool(q.get("answer"))))
    succ = db.get(Member, h.successor_member_id) if h.successor_member_id else None
    return {"version": v.version, "successor": succ.display_name if succ else None, "can_respond": is_succ and ctx.can_write,
            "can_answer": ctx.is_reviewer and ctx.can_write, "items": eff, "counts": _counts(items, eff), "questions": questions}


class AckIn(BaseModel):
    state: Literal["acknowledged", "question", "not_mine"]
    note: str | None = Field(default=None, max_length=500)


@router.put("/handovers/{handover_id}/acks/{claim_id}")
def respond(handover_id: uuid.UUID, claim_id: uuid.UUID, body: AckIn, request: Request, db: Session = Depends(get_db)) -> dict:
    h, ctx = _handover(db, request, handover_id)
    if ctx.member.id != h.successor_member_id:
        raise HTTPException(403, "Only the successor can acknowledge their handover")
    if not ctx.can_write:
        raise HTTPException(403, "This is the shared read-only template. Click 'Try the demo' to get your own copy.")
    v = _latest(db, h, None)
    if v is None:
        raise HTTPException(409, "Nothing has been approved yet.")
    items = _successor_view(db, h, v)
    if str(claim_id) not in items:
        raise HTTPException(404, "That item isn't in your handover")
    note = scrub(body.note.strip())[0] if body.note and body.note.strip() else None
    if body.state == "question" and (not note or len(note) < 3):
        raise HTTPException(422, "Write your question so the reviewer knows what to answer.")
    a = db.scalar(select(Acknowledgement).where(Acknowledgement.handover_version_id == v.id, Acknowledgement.claim_id == claim_id,
                                                Acknowledgement.member_id == ctx.member.id).with_for_update())
    now = datetime.now(UTC)
    if a is None:
        a = Acknowledgement(handover_version_id=v.id, claim_id=claim_id, member_id=ctx.member.id, state=body.state)
        db.add(a)
    elif a.state == "question" and body.state == "question" and a.note != note:
        a.answer, a.answered_by, a.answered_at = None, None, None  # a new question needs a new answer
    a.state, a.note, a.updated_at = body.state, note, now
    if body.state == "question":
        a.closed_at = None
    db.flush()
    names = {m.id: m.display_name for m in db.scalars(select(Member).where(Member.workspace_id == h.workspace_id))}
    out = _ack_out(a, names, carried=False)
    if body.state == "question":
        reviewer = next((m for m in db.scalars(select(Member).where(Member.workspace_id == h.workspace_id))
                         if "reviewer" in _roles(db, m.id, h.workspace_id)), None)
        if reviewer is not None:  # optional; skipped unless email is configured and the reviewer has an address
            notify.send_email(db, ctx.workspace, event="successor_question", to=reviewer.email,
                              subject=f"{ctx.member.display_name} has a question about the handover",
                              heading=f"{ctx.member.display_name} asked about an item in “{ctx.workspace.name}”",
                              lines=[f"Item: {items[str(claim_id)]['text']}", f"Question: {note}"],
                              link=f"/w/{ctx.workspace.id}/handover", link_label="Answer it")
    db.commit()
    return out


class AnswerIn(BaseModel):
    answer: str = Field(min_length=2, max_length=1000)


def _load_ack(db: Session, request: Request, ack_id: uuid.UUID):
    a = db.get(Acknowledgement, ack_id)
    if a is None:
        raise HTTPException(404, "Not found")
    v = db.get(HandoverVersion, a.handover_version_id)
    h, ctx = _handover(db, request, v.handover_id)
    return a, h, ctx


@router.post("/acks/{ack_id}/answer")
def answer(ack_id: uuid.UUID, body: AnswerIn, request: Request, db: Session = Depends(get_db)) -> dict:
    a, h, ctx = _load_ack(db, request, ack_id)
    if not ctx.is_reviewer:
        raise HTTPException(403, "Only the reviewer can answer the successor's questions")
    if not ctx.can_write:
        raise HTTPException(403, "This is the shared read-only template. Click 'Try the demo' to get your own copy.")
    if a.state != "question":
        raise HTTPException(409, "This item has no open question.")
    a.answer, a.answered_by, a.answered_at = scrub(body.answer.strip())[0], ctx.member.id, datetime.now(UTC)
    a.updated_at = a.answered_at
    db.add(AuditEvent(workspace_id=h.workspace_id, actor_member_id=ctx.member.id, actor_role="reviewer",
                      action="successor_question_answered", target=str(a.claim_id)))
    db.commit()
    return {"id": str(a.id), "answered": True}


@router.post("/acks/{ack_id}/close")
def close(ack_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    a, h, ctx = _load_ack(db, request, ack_id)
    if ctx.member.id != a.member_id:
        raise HTTPException(403, "Only the person who asked can close their question")
    if not ctx.can_write:
        raise HTTPException(403, "This is the shared read-only template. Click 'Try the demo' to get your own copy.")
    if a.state != "question":
        raise HTTPException(409, "This item has no question to close.")
    a.closed_at = a.updated_at = datetime.now(UTC)
    db.commit()
    return {"id": str(a.id), "closed": True}
