"""Round 3 improvement #1: the gap interview.

The reviewer turns the ledger's Missing and unresolved Conflicting items into a short list of targeted questions for the
leaver (or answers them on the leaver's behalf when the leaver is unavailable). Submitted answers become a cited source
of type `testimony`, so they flow through the same evidence, status and permission machinery as every other source:

* Access never widens: an answer's source gets an access list no wider than the sources behind its question
  (`acl_intersection`). Custom questions default to reviewer + leaver; the admin can widen that with Change access.
* No fabricated quotes: a testimony claim's quote IS the respondent's answer, so the quote check is exact by construction.
* No AI on this path: the testimony claim restates the answer; its status comes from `status.py` (Supported with a
  "Leaver testimony" reason, never Verified until a reviewer confirms it).
* Conflicts are never resolved by the interview: the leaver's pick becomes testimony evidence on the chosen claim and a
  *proposal* the reviewer can accept in one click (trust rule 8: a human decides).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from baton import notify
from baton.acl import ALL_MEMBERS, Viewer, acl_intersection, acl_key, normalise_acl
from baton.auth import Ctx, _roles, resolve_ctx, workspace_ctx
from baton.db.models import (
    AuditEvent, Chunk, Claim, ConflictGroup, Evidence, Handover, Interview, InterviewQuestion, Member, Membership, Source,
)
from baton.db.session import get_db
from baton.ingest.scrubber import mask_pii, scrub
from baton.ledger import evidence_rows, recompute_statuses, ref_for
from baton.projection import claim_sources, visible
from baton.verify.quote_match import match

router = APIRouter(prefix="/api", tags=["Gap interview"])

MAX_QUESTIONS = 15
ANSWER_MAX = 1000
CUSTOM_ACL = {"roles": ["leaver", "reviewer"], "members": []}
TYPE_ORDER = {"open_work": 0, "contact": 1, "ownership": 1, "dependency": 2, "risk": 3}


# ----------------------------------------------------------------------------------------------- helpers

def _leaver(db: Session, ws_id) -> Member | None:
    h = db.scalar(select(Handover).where(Handover.workspace_id == ws_id, Handover.leaver_member_id.is_not(None))
                  .order_by(Handover.created_at).limit(1))
    if h is not None:
        return db.get(Member, h.leaver_member_id)
    mid = db.scalar(select(Membership.member_id).where(Membership.workspace_id == ws_id, Membership.role == "leaver").limit(1))
    return db.get(Member, mid) if mid else None


def _viewer(db: Session, m: Member) -> Viewer:
    return Viewer(str(m.id), _roles(db, m.id, m.workspace_id))


def _load(db: Session, request: Request, interview_id: uuid.UUID) -> tuple[Interview, Ctx]:
    iv = db.get(Interview, interview_id)
    if iv is None:
        raise HTTPException(404, "Interview not found")
    ctx = resolve_ctx(db, request, iv.workspace_id)
    is_respondent = iv.respondent_member_id == ctx.member.id
    if not (ctx.is_reviewer or (is_respondent and iv.status != "draft")):
        raise HTTPException(404, "Interview not found")  # don't reveal drafts or other people's interviews
    return iv, ctx


def _can_answer(iv: Interview, ctx: Ctx) -> bool:
    if not ctx.can_write or iv.status != "sent":
        return False
    return iv.respondent_member_id == ctx.member.id or (iv.on_behalf and ctx.is_reviewer)


def _require_editable(iv: Interview, ctx: Ctx) -> None:
    if not ctx.is_reviewer:
        raise HTTPException(403, "Only the reviewer can edit the questions")
    if not ctx.can_write:
        raise HTTPException(403, "This is the shared read-only template. Click 'Try the demo' to get your own copy.")
    if iv.status not in ("draft", "sent"):
        raise HTTPException(409, "These answers were already submitted, so the questions can't change.")


def _questions(db: Session, iv: Interview) -> list[InterviewQuestion]:
    return list(db.scalars(select(InterviewQuestion).where(InterviewQuestion.interview_id == iv.id)
                           .order_by(InterviewQuestion.position)))


def _today() -> str:
    return datetime.now(UTC).strftime("%d %b").lstrip("0")


def _source_acl(db: Session, claim_ids: list) -> dict:
    """The intersection of every cited source's access list: testimony about these claims never widens access."""
    acl: dict = {"roles": [ALL_MEMBERS], "members": []}
    for src_acls in claim_sources(db, claim_ids).values():
        for _sid, _name, a in src_acls:
            acl = acl_intersection(acl, a)
    return normalise_acl(acl)


def _build(db: Session, ws_id, respondent: Member) -> list[dict]:
    """Questions from Missing (not yet answered) and unresolved Conflicting claims the respondent may see."""
    claims = list(db.scalars(select(Claim).where(Claim.workspace_id == ws_id)))
    cited = claim_sources(db, [c.id for c in claims])
    who = _viewer(db, respondent)
    can_see = {c.id for c in claims if visible(who, cited.get(c.id, []))}
    groups = {g.id: g for g in db.scalars(select(ConflictGroup).where(ConflictGroup.workspace_id == ws_id))}
    out: list[dict] = []
    missing = [c for c in claims if c.status == "missing" and c.id in can_see and not c.superseded_by
               and not ((c.meta or {}).get("flags") or {}).get("answered")]
    for c in sorted(missing, key=lambda c: (TYPE_ORDER.get(c.type, 5), c.text)):
        q = (c.meta or {}).get("question") or c.text
        out.append({"claim_id": c.id, "kind": "missing", "question": q if q.endswith("?") else f"{q}?", "options": []})
    ev = evidence_rows(db, [c.id for c in claims if c.conflict_group_id])
    seen: set = set()
    for c in claims:
        g = groups.get(c.conflict_group_id) if c.conflict_group_id else None
        if c.status != "conflicting" or g is None or g.resolved or g.id in seen:
            continue
        seen.add(g.id)
        members = [o for o in claims if o.conflict_group_id == g.id and o.status != "rejected"]
        if not all(o.id in can_see for o in members) or len(members) < 2:
            continue  # never show the respondent one side of a conflict they can't fully see
        opts = [{"claim_id": str(o.id), "text": o.text, "ref": ", ".join(dict.fromkeys(ref_for(*r) for r in ev.get(o.id, [])[:2])) or None}
                for o in members]
        out.append({"claim_id": c.id, "kind": "conflict", "options": opts,
                    "question": "These sources disagree. Which one is current?"})
    return out[:MAX_QUESTIONS]


def _payload(db: Session, iv: Interview, ctx: Ctx) -> dict:
    names = {m.id: m.display_name for m in db.scalars(select(Member).where(Member.workspace_id == iv.workspace_id))}
    qs = _questions(db, iv)
    mask = not ctx.is_reviewer
    pii = (lambda s: mask_pii(s) if s else s) if mask else (lambda s: s)
    claim_ids = [q.claim_id for q in qs if q.claim_id]
    claims = {c.id: c for c in db.scalars(select(Claim).where(Claim.id.in_(claim_ids)))} if claim_ids else {}
    items = []
    for q in qs:
        c = claims.get(q.claim_id) if q.claim_id else None
        context = None
        if q.kind == "missing" and c is not None:
            context = (c.meta or {}).get("signal")
        items.append({
            "id": str(q.id), "kind": q.kind, "position": q.position, "question": pii(q.question),
            "context": f"Baton expected this because {context}." if context else None,
            "options": [{**o, "text": pii(o.get("text"))} for o in (q.options or [])],
            "answer": pii(q.answer), "answer_kind": q.answer_kind, "answered_at": q.answered_at.isoformat() if q.answered_at else None,
            "ask_who": (q.answer_meta or {}).get("ask_who"), "chosen_claim_id": (q.answer_meta or {}).get("chosen_claim_id"),
            "conflict_group_id": str(c.conflict_group_id) if (c is not None and c.conflict_group_id) else None,
            "conflict_resolved": bool(c is not None and c.conflict_group_id and (g := db.get(ConflictGroup, c.conflict_group_id)) and g.resolved),
            "testimony_claim_id": str(q.testimony_claim_id) if q.testimony_claim_id else None,
        })
    answered = sum(1 for q in qs if q.answer_kind)
    minutes = None
    if iv.started_at and iv.submitted_at:
        minutes = max(1, round((iv.submitted_at - iv.started_at).total_seconds() / 60))
    return {
        "id": str(iv.id), "status": iv.status, "on_behalf": iv.on_behalf,
        "respondent": {"id": str(iv.respondent_member_id) if iv.respondent_member_id else None,
                       "name": names.get(iv.respondent_member_id, "the leaver")},
        "created_by": names.get(iv.created_by, "the reviewer"),
        "sent_at": iv.sent_at.isoformat() if iv.sent_at else None,
        "submitted_at": iv.submitted_at.isoformat() if iv.submitted_at else None,
        "minutes_to_answer": minutes,
        "counts": {"total": len(qs), "answered": answered},
        "can_edit": ctx.is_reviewer and ctx.can_write and iv.status in ("draft", "sent") and answered == 0,
        "can_answer": _can_answer(iv, ctx),
        "is_reviewer": ctx.is_reviewer,
        "questions": items,
    }


# ----------------------------------------------------------------------------------------------- endpoints

class CreateIn(BaseModel):
    on_behalf: bool = False


@router.post("/workspaces/{workspace_id}/interviews")
def create_interview(body: CreateIn, ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    if not ctx.is_reviewer:
        raise HTTPException(403, "Only the reviewer can prepare questions for the leaver")
    if not ctx.can_write:
        raise HTTPException(403, "This is the shared read-only template. Click 'Try the demo' to get your own copy.")
    ws_id = ctx.workspace.id
    # One open interview at a time; a double click or a second tab gets the same one (row lock on the workspace).
    from baton.db.models import Workspace
    db.execute(select(Workspace.id).where(Workspace.id == ws_id).with_for_update())
    open_iv = db.scalar(select(Interview).where(Interview.workspace_id == ws_id, Interview.status.in_(("draft", "sent")))
                        .order_by(Interview.created_at.desc()).limit(1))
    if open_iv is not None:
        return {**_payload(db, open_iv, ctx), "existing": True}
    leaver = _leaver(db, ws_id)
    if leaver is None:
        raise HTTPException(409, "This workspace has no leaver. Add a member with the leaver role first.")
    respondent = ctx.member if body.on_behalf else leaver
    drafts = _build(db, ws_id, respondent if not body.on_behalf else ctx.member)
    if not drafts:
        raise HTTPException(409, "Nothing to ask: there are no open Missing or Conflicting items. Every gap is covered.")
    iv = Interview(workspace_id=ws_id, respondent_member_id=respondent.id, created_by=ctx.member.id, on_behalf=body.on_behalf,
                   status="sent" if body.on_behalf else "draft", sent_at=datetime.now(UTC) if body.on_behalf else None,
                   handover_id=db.scalar(select(Handover.id).where(Handover.workspace_id == ws_id).order_by(Handover.created_at).limit(1)))
    db.add(iv)
    db.flush()
    for i, d in enumerate(drafts, start=1):
        db.add(InterviewQuestion(interview_id=iv.id, claim_id=d["claim_id"], kind=d["kind"], position=i,
                                 question=d["question"], options=d["options"]))
    db.flush()
    out = {**_payload(db, iv, ctx), "existing": False}
    db.commit()
    return out


@router.get("/workspaces/{workspace_id}/interviews")
def list_interviews(ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    q = select(Interview).where(Interview.workspace_id == ctx.workspace.id).order_by(Interview.created_at.desc())
    if not ctx.is_reviewer:
        q = q.where(Interview.respondent_member_id == ctx.member.id, Interview.status != "draft")
    names = {m.id: m.display_name for m in db.scalars(select(Member).where(Member.workspace_id == ctx.workspace.id))}
    out = []
    for iv in db.scalars(q.limit(20)):
        total = db.scalar(select(func.count()).select_from(InterviewQuestion).where(InterviewQuestion.interview_id == iv.id)) or 0
        answered = db.scalar(select(func.count()).select_from(InterviewQuestion).where(
            InterviewQuestion.interview_id == iv.id, InterviewQuestion.answer_kind.is_not(None))) or 0
        out.append({"id": str(iv.id), "status": iv.status, "on_behalf": iv.on_behalf,
                    "respondent": names.get(iv.respondent_member_id, "the leaver"),
                    "total": total, "answered": answered,
                    "sent_at": iv.sent_at.isoformat() if iv.sent_at else None,
                    "submitted_at": iv.submitted_at.isoformat() if iv.submitted_at else None})
    return {"interviews": out}


@router.get("/interviews/{interview_id}")
def get_interview(interview_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    iv, ctx = _load(db, request, interview_id)
    return _payload(db, iv, ctx)


@router.delete("/interviews/{interview_id}")
def discard_interview(interview_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    iv, ctx = _load(db, request, interview_id)
    _require_editable(iv, ctx)
    if any(q.answer_kind for q in _questions(db, iv)):
        raise HTTPException(409, "Some questions are already answered, so this interview can't be discarded.")
    db.delete(iv)
    db.commit()
    return {"discarded": True}


class QuestionIn(BaseModel):
    question: str = Field(min_length=3, max_length=500)


@router.post("/interviews/{interview_id}/questions")
def add_question(interview_id: uuid.UUID, body: QuestionIn, request: Request, db: Session = Depends(get_db)) -> dict:
    iv, ctx = _load(db, request, interview_id)
    _require_editable(iv, ctx)
    qs = _questions(db, iv)
    if len(qs) >= MAX_QUESTIONS + 5:
        raise HTTPException(409, "That's enough questions for one interview. Keep it short so the leaver can finish it.")
    text = scrub(body.question.strip())[0]
    db.add(InterviewQuestion(interview_id=iv.id, kind="custom", position=(qs[-1].position + 1) if qs else 1,
                             question=text if text.endswith("?") else f"{text}?"))
    db.commit()
    return _payload(db, iv, ctx)


@router.patch("/interviews/{interview_id}/questions/{question_id}")
def edit_question(interview_id: uuid.UUID, question_id: uuid.UUID, body: QuestionIn, request: Request,
                  db: Session = Depends(get_db)) -> dict:
    iv, ctx = _load(db, request, interview_id)
    _require_editable(iv, ctx)
    q = db.get(InterviewQuestion, question_id)
    if q is None or q.interview_id != iv.id:
        raise HTTPException(404, "Question not found")
    if q.answer_kind:
        raise HTTPException(409, "This question is already answered, so it can't be reworded.")
    q.question = scrub(body.question.strip())[0]
    db.commit()
    return _payload(db, iv, ctx)


@router.delete("/interviews/{interview_id}/questions/{question_id}")
def drop_question(interview_id: uuid.UUID, question_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    iv, ctx = _load(db, request, interview_id)
    _require_editable(iv, ctx)
    q = db.get(InterviewQuestion, question_id)
    if q is None or q.interview_id != iv.id:
        raise HTTPException(404, "Question not found")
    if q.answer_kind:
        raise HTTPException(409, "This question is already answered, so it can't be removed.")
    if len(_questions(db, iv)) <= 1:
        raise HTTPException(409, "An interview needs at least one question. Discard the interview instead.")
    db.delete(q)
    db.commit()
    return _payload(db, iv, ctx)


@router.post("/interviews/{interview_id}/send")
def send_interview(interview_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    iv, ctx = _load(db, request, interview_id)
    _require_editable(iv, ctx)
    emailed = None
    if iv.status == "draft":
        iv.status, iv.sent_at = "sent", datetime.now(UTC)
        respondent = db.get(Member, iv.respondent_member_id) if iv.respondent_member_id else None
        n = len(_questions(db, iv))
        if respondent is not None:
            emailed = notify.send_email(
                db, ctx.workspace, event="interview", to=respondent.email,
                subject=f"{n} handover question{'s' if n != 1 else ''} for you on “{ctx.workspace.name}”",
                heading=f"{ctx.member.display_name} needs your help with the handover",
                lines=[f"Baton couldn't answer {n} question{'s' if n != 1 else ''} from the project's sources.",
                       "Your answers are saved as you go, and they become cited “leaver testimony” for whoever takes over.",
                       "Open it with the personal link you were given for this workspace."],
                link=f"/w/{ctx.workspace.id}/interview/{iv.id}", link_label="Answer the questions").as_dict()
        db.add(AuditEvent(workspace_id=iv.workspace_id, actor_member_id=ctx.member.id, actor_role="reviewer",
                          action="interview_sent", target=str(iv.id), after={"questions": n}))
    db.commit()
    return {**_payload(db, iv, ctx), "emailed": emailed}


class AnswerIn(BaseModel):
    answer_kind: Literal["answered", "chose_option", "dont_know", "ask_other"]
    answer: str | None = Field(default=None, max_length=ANSWER_MAX)
    chosen_claim_id: uuid.UUID | None = None
    ask_who: str | None = Field(default=None, max_length=80)


@router.put("/interviews/{interview_id}/questions/{question_id}/answer")
def answer_question(interview_id: uuid.UUID, question_id: uuid.UUID, body: AnswerIn, request: Request,
                    db: Session = Depends(get_db)) -> dict:
    iv, ctx = _load(db, request, interview_id)
    if not _can_answer(iv, ctx):
        if iv.status == "submitted":
            raise HTTPException(409, "These answers were already submitted. Thank you!")
        raise HTTPException(403, "Only the person these questions were sent to can answer them")
    q = db.get(InterviewQuestion, question_id)
    if q is None or q.interview_id != iv.id:
        raise HTTPException(404, "Question not found")
    text = (body.answer or "").strip()
    meta: dict = {}
    if body.answer_kind == "answered":
        if len(text) < 2:
            raise HTTPException(422, "Write an answer, or choose “I don't know” or “Ask someone else”.")
    elif body.answer_kind == "chose_option":
        valid = {o.get("claim_id") for o in (q.options or [])}
        if q.kind != "conflict" or str(body.chosen_claim_id) not in valid:
            raise HTTPException(422, "Pick one of the options shown for this question.")
        meta["chosen_claim_id"] = str(body.chosen_claim_id)
    elif body.answer_kind == "ask_other":
        who = (body.ask_who or "").strip()
        if len(who) < 2:
            raise HTTPException(422, "Say who would know, for example a name or a team.")
        meta["ask_who"] = scrub(who)[0]
    q.answer_kind = body.answer_kind
    q.answer = scrub(text)[0] if text else None  # secrets never stored (trust rule 7)
    q.answer_meta = meta
    q.answered_at = datetime.now(UTC)
    if iv.started_at is None:
        iv.started_at = q.answered_at
    db.commit()
    return _payload(db, iv, ctx)


@router.post("/interviews/{interview_id}/submit")
def submit_interview(interview_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    iv, ctx = _load(db, request, interview_id)
    db.execute(select(Interview.id).where(Interview.id == iv.id).with_for_update())  # double submit -> one result
    db.refresh(iv)
    if iv.status == "submitted":
        return {**_payload(db, iv, ctx), "created": 0}
    if not _can_answer(iv, ctx):
        raise HTTPException(403, "Only the person these questions were sent to can submit the answers")
    qs = _questions(db, iv)
    if not any(q.answer_kind for q in qs):
        raise HTTPException(422, "Answer at least one question before submitting.")
    respondent = db.get(Member, iv.respondent_member_id)
    name = respondent.display_name if respondent else "the leaver"
    label = f"{name} (answered by {ctx.member.display_name} on their behalf)" if iv.on_behalf else name
    now = datetime.now(UTC)
    claims = {c.id: c for c in db.scalars(select(Claim).where(Claim.id.in_([q.claim_id for q in qs if q.claim_id])))}
    sources: dict[str, Source] = {}

    def source_for(acl: dict) -> Source:
        key = acl_key(acl)
        if key not in sources:
            restricted = ALL_MEMBERS not in acl["roles"]
            src = Source(workspace_id=iv.workspace_id, type="testimony",
                         name=f"Leaver testimony · {name} · {_today()}" + (" (restricted)" if restricted else ""),
                         acl=acl, acl_key=key, scrub_report={}, ingested_at=now,
                         meta={"interview_id": str(iv.id), "on_behalf": iv.on_behalf, "respondent": name,
                               "synthetic": bool(ctx.workspace.synthetic), "chunk_count": 0, "chunk_kinds": {}})
            db.add(src)
            db.flush()
            sources[key] = src
        return sources[key]

    def add_chunk(src: Source, q: InterviewQuestion, text: str) -> Chunk:
        ch = Chunk(source_id=src.id, workspace_id=iv.workspace_id, kind="testimony", text=text,
                   location={"interview": str(iv.id), "question": q.position, "respondent": name},
                   author=label, occurred_at=now, acl_key=src.acl_key)
        db.add(ch)
        db.flush()
        meta = dict(src.meta or {})
        meta["chunk_count"] = meta.get("chunk_count", 0) + 1
        meta["chunk_kinds"] = {"testimony": meta["chunk_count"]}
        src.meta = meta
        return ch

    def add_evidence(claim_id, ch: Chunk, quote: str, reason: str) -> None:
        m = match(quote, ch.text)
        db.add(Evidence(claim_id=claim_id, chunk_id=ch.id, quote=quote, quote_found=m.found, match_score=m.score,
                        match_start=m.start, match_end=m.end, verdict="supports" if m.found else "pending",
                        verdict_reason=reason, verifier="testimony"))

    created = 0
    touched: list = []
    for q in qs:
        orig = claims.get(q.claim_id) if q.claim_id else None
        if q.answer_kind == "answered" and q.answer:
            acl = _source_acl(db, [orig.id]) if orig is not None else normalise_acl(CUSTOM_ACL)
            src = source_for(acl)
            ch = add_chunk(src, q, f"Question: {q.question}\nAnswer ({label}): {q.answer}")
            stem = q.question.rstrip("?").strip()
            new = Claim(workspace_id=iv.workspace_id, type=orig.type if orig is not None else "open_question",
                        text=f"{stem}: {q.answer}" if orig is not None else f"{stem}? {q.answer}",
                        subject_key=orig.subject_key if orig is not None else f"interview.{q.position}",
                        origin="testimony", occurred_at=now, about_member_id=orig.about_member_id if orig is not None else None,
                        meta={"testimony_from": f"{label}, gap interview {_today()}", "interview_id": str(iv.id),
                              "answers_claim": str(orig.id) if orig is not None else None})
            db.add(new)
            db.flush()
            add_evidence(new.id, ch, q.answer, f"The claim restates {name}'s own answer to the gap interview.")
            q.testimony_claim_id = new.id
            touched.append(new.id)
            created += 1
            if orig is not None and orig.origin == "checklist":
                orig.meta = {**(orig.meta or {}), "answered_by_name": label, "answered_by_claim": str(new.id)}
                touched.append(orig.id)
        elif q.answer_kind == "chose_option" and orig is not None:
            chosen_id = uuid.UUID(q.answer_meta["chosen_claim_id"])
            chosen = db.get(Claim, chosen_id)
            if chosen is None or chosen.workspace_id != iv.workspace_id:
                continue
            src = source_for(_source_acl(db, [chosen.id]))  # only the chosen side's text goes into this source
            ch = add_chunk(src, q, f"Question: Which is current?\nAnswer ({label}): {chosen.text}")
            add_evidence(chosen.id, ch, chosen.text, f"{name} confirmed in the gap interview that this is current.")
            q.answer_meta = {**q.answer_meta, "proposed_winner": str(chosen.id)}
            touched.append(chosen.id)
    iv.status, iv.submitted_at = "submitted", now
    iv.source_id = next(iter(sources.values())).id if sources else None
    db.add(AuditEvent(workspace_id=iv.workspace_id, actor_member_id=ctx.member.id, actor_role="reviewer" if iv.on_behalf else "leaver",
                      action="interview_submitted", target=str(iv.id),
                      after={"answered": sum(1 for q in qs if q.answer_kind), "testimony_claims": created,
                             "minutes": round((now - (iv.started_at or now)).total_seconds() / 60)}))
    db.flush()
    recompute_statuses(db, iv.workspace_id)
    out = {**_payload(db, iv, ctx), "created": created}
    db.commit()
    return out
