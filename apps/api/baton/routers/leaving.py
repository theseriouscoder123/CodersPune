"""Before the leaver leaves: one ordered list of what must happen before the leaver's last day (rules, no AI).

Items, each with a stable key so manual marks survive refreshes:
* task          open work / next actions that name the leaver ("Rohan must transfer Vercel ownership…")   manual done
* conflict      unresolved conflicts: only the leaver can say which source is current            done when resolved
* gap           Missing items nobody has answered (incl. services with no named owner)          done when answered
* walkthrough   files the leaver maintains alone (commit statistics): someone needs a walkthrough      manual done
* question      successor questions on the approved handover still waiting for an answer       done when answered

Everything is filtered by what the viewer may see (trust rule 5) before it is listed.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from baton.acl import can_view_acl
from baton.db.models import (
    Acknowledgement,
    AuditEvent,
    Chunk,
    Claim,
    ConflictGroup,
    HandoverVersion,
    Interview,
    Member,
    Source,
)
from baton.db.session import get_db
from baton.ingest.scrubber import mask_pii
from baton.projection import claim_sources, visible
from baton.reconstruct.relations import task_owner
from baton.reconstruct.risk import SOLE_MIN_COMMITS, SOLE_SHARE, parse_stats
from baton.routers.handovers import _handover

router = APIRouter(prefix="/api", tags=["Before the leaver leaves"])
IST = timezone(timedelta(hours=5, minutes=30))
ORDER = {"task": 0, "conflict": 1, "gap": 2, "walkthrough": 3, "question": 4}
MANUAL = {"task", "walkthrough"}


def _access(ctx, h) -> None:
    if not (ctx.is_reviewer or ctx.is_admin or ctx.member.id == h.leaver_member_id):
        raise HTTPException(403, "This checklist is for the reviewer and the person who is leaving")


@router.get("/handovers/{handover_id}/leaving")
def leaving(handover_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    h, ctx = _handover(db, request, handover_id)
    _access(ctx, h)
    pii = (lambda s: s) if ctx.is_reviewer else (lambda s: mask_pii(s) if s else s)
    leaver = db.get(Member, h.leaver_member_id)
    succ = db.get(Member, h.successor_member_id) if h.successor_member_id else None
    marks = h.leaving_marks or {}
    claims = [c for c in db.scalars(select(Claim).where(Claim.workspace_id == h.workspace_id))
              if c.status != "rejected" and not c.superseded_by]
    cited = claim_sources(db, [c.id for c in claims])
    claims = [c for c in claims if visible(ctx.viewer, cited.get(c.id, []))]
    items: list[dict] = []

    def add(kind: str, key: str, title: str, detail: str, auto_done: bool | None, link: str | None, claim_id=None):
        m = marks.get(key) or {}
        done = bool(auto_done) if kind not in MANUAL else bool(m.get("done"))
        items.append({"key": key, "kind": kind, "title": pii(title), "detail": pii(detail), "done": done,
                      "manual": kind in MANUAL, "marked_by": m.get("by") if kind in MANUAL else None,
                      "link": link, "claim_id": str(claim_id) if claim_id else None})

    wsid = h.workspace_id
    for c in claims:  # tasks that name the leaver
        if c.type in ("open_work", "next_action") and not c.stale_reason and c.status in ("supported", "verified", "conflicting"):
            owner = task_owner(c.text)
            if owner and owner.lower() in (leaver.display_name.lower(), leaver.handle.lower()):
                add("task", f"task:{c.id}", c.text, f"{leaver.display_name}'s task. Mark it done once it has happened.",
                    None, f"/w/{wsid}/review?tab=all&claim={c.id}", c.id)
    groups = {g.id: g for g in db.scalars(select(ConflictGroup).where(ConflictGroup.workspace_id == wsid))}
    seen_groups = set()
    for c in claims:  # conflicts (one row per group)
        if c.conflict_group_id and c.conflict_group_id not in seen_groups and c.conflict_group_id in groups:
            seen_groups.add(c.conflict_group_id)
            g = groups[c.conflict_group_id]
            members_ = [o for o in claims if o.conflict_group_id == g.id]
            add("conflict", f"conflict:{g.id}", " vs ".join(f"“{o.text}”" for o in members_[:2]),
                "Resolved." if g.resolved else f"Sources disagree. {leaver.display_name} can say which is current.",
                g.resolved, f"/w/{wsid}/review?tab=conflicts&claim={c.id}", c.id)
    interview = db.scalar(select(Interview).where(Interview.workspace_id == wsid, Interview.status.in_(("sent", "draft")))
                          .order_by(Interview.created_at.desc()))
    for c in claims:  # gaps
        if c.status == "missing" or ((c.meta or {}).get("flags") or {}).get("answered"):
            answered = bool(((c.meta or {}).get("flags") or {}).get("answered"))
            if c.status != "missing" and not answered:
                continue
            who = (c.meta or {}).get("answered_by_name")
            where = (f"Answered{' by ' + who if who else ''}." if answered
                     else ("In the gap interview, waiting for an answer." if interview and interview.status == "sent"
                           else f"No source answers this. Ask {leaver.display_name} in a gap interview."))
            add("gap", f"gap:{c.id}", c.text if c.text.endswith("?") else f"{c.text}?", where, answered,
                f"/w/{wsid}/interview/{interview.id}" if interview else f"/w/{wsid}/review?tab=missing&claim={c.id}", c.id)
    for ch, acl in db.execute(select(Chunk, Source.acl).join(Source, Source.id == Chunk.source_id)
                              .where(Chunk.workspace_id == wsid, Chunk.kind == "commit_stats")):
        if not can_view_acl(ctx.viewer, acl):
            continue
        for f in parse_stats(ch.text):  # files the leaver maintains alone
            n = f.authors.get(leaver.handle.lower(), 0)
            if f.total >= SOLE_MIN_COMMITS and n / f.total >= SOLE_SHARE:
                add("walkthrough", f"walkthrough:{f.path}", f"Walk {succ.display_name if succ else 'the successor'} through {f.path}",
                    f"{leaver.display_name} made {n} of {f.total} commits. Nobody else knows it well.", None, f"/w/{wsid}/risk")
    latest = db.scalar(select(HandoverVersion).where(HandoverVersion.handover_id == h.id).order_by(HandoverVersion.version.desc()))
    if latest:  # successor questions still waiting
        by_id = {c.id: c for c in claims}
        for a in db.scalars(select(Acknowledgement).where(Acknowledgement.handover_version_id == latest.id,
                                                          Acknowledgement.state == "question")):
            if a.claim_id not in by_id or a.closed_at:
                continue
            add("question", f"question:{a.id}", f"{succ.display_name if succ else 'The successor'} asked: “{a.note}”",
                f"About: {by_id[a.claim_id].text}", bool(a.answer), f"/w/{wsid}/handover?h={h.id}", a.claim_id)
    items.sort(key=lambda it: (it["done"], ORDER[it["kind"]]))
    today = datetime.now(IST).date()
    days = (h.leaves_on - today).days if h.leaves_on else None
    counts = {"total": len(items), "done": sum(1 for i in items if i["done"])}
    return {"handover_id": str(h.id), "leaver": leaver.display_name, "successor": succ.display_name if succ else None,
            "leaves_on": h.leaves_on.isoformat() if h.leaves_on else None, "days_left": days, "today": today.isoformat(),
            "can_edit_date": ctx.is_reviewer and ctx.can_write, "can_mark": (ctx.is_reviewer or ctx.member.id == h.leaver_member_id) and ctx.can_write,
            "items": items, "counts": counts}


class DateIn(BaseModel):
    leaves_on: date | None


@router.put("/handovers/{handover_id}/leaving/date")
def set_date(handover_id: uuid.UUID, body: DateIn, request: Request, db: Session = Depends(get_db)) -> dict:
    h, ctx = _handover(db, request, handover_id)
    if not ctx.is_reviewer:
        raise HTTPException(403, "Only the reviewer can set the leaver's last day")
    if not ctx.can_write:
        raise HTTPException(403, "This is the shared read-only template. Click 'Try the demo' to get your own copy.")
    if body.leaves_on and not (date(2000, 1, 1) <= body.leaves_on <= date(2100, 1, 1)):
        raise HTTPException(422, "Pick a real date")
    h.leaves_on = body.leaves_on
    db.commit()
    return {"leaves_on": h.leaves_on.isoformat() if h.leaves_on else None}


class MarkIn(BaseModel):
    done: bool


@router.post("/handovers/{handover_id}/leaving/marks/{key:path}")
def mark(handover_id: uuid.UUID, key: str, body: MarkIn, request: Request, db: Session = Depends(get_db)) -> dict:
    h, ctx = _handover(db, request, handover_id)
    if not (ctx.is_reviewer or ctx.member.id == h.leaver_member_id):
        raise HTTPException(403, "Only the reviewer or the person leaving can tick items off")
    if not ctx.can_write:
        raise HTTPException(403, "This is the shared read-only template. Click 'Try the demo' to get your own copy.")
    kind = key.split(":", 1)[0]
    if kind not in MANUAL or len(key) > 400:
        raise HTTPException(422, "This item completes by itself (answered, resolved), so it can't be ticked by hand")
    db.execute(select(type(h).id).where(type(h).id == h.id).with_for_update())  # serialise concurrent ticks
    marks = dict(h.leaving_marks or {})
    marks[key] = {"done": body.done, "by": ctx.member.display_name, "at": datetime.now(UTC).isoformat()}
    h.leaving_marks = marks
    db.add(AuditEvent(workspace_id=h.workspace_id, actor_member_id=ctx.member.id,
                      actor_role="reviewer" if ctx.is_reviewer else "leaver", action="leaving_mark",
                      target=key, after={"done": body.done}))
    db.commit()
    return {"key": key, "done": body.done}
