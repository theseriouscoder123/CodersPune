"""Ledger, evidence and review actions. Every read is filtered server-side by the acting persona (trust rule 5)."""

from __future__ import annotations

import uuid
from collections import Counter
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from baton.acl import access_label
from baton.auth import Ctx, resolve_ctx, workspace_ctx
from baton.config import get_settings
from baton.db.models import Chunk, Claim, ConflictGroup, Evidence, Member, ReviewEvent, Source
from baton.db.session import get_db
from baton.ingest.scrubber import mask_pii
from baton.ledger import evidence_rows, recompute_statuses, ref_for
from baton.limits import check_review_rate
from baton.projection import claim_sources, visible

router = APIRouter(prefix="/api")

EXCERPT_CHARS = 300
TYPE_LABELS = {"decision": "Decision", "ownership": "Ownership", "open_work": "Open work", "next_action": "Next action",
               "risk": "Risk", "dependency": "Dependency", "contact": "Contact", "recurring_issue": "Recurring issue",
               "open_question": "Open question"}


def _snap(c: Claim) -> dict:
    return {"text": c.text, "review_state": c.review_state, "status": c.status, "note": c.reviewer_note}


def _require_ledger_access(ctx: Ctx) -> None:
    if not (ctx.is_reviewer or "leaver" in ctx.roles or ctx.is_admin):
        raise HTTPException(403, "The ledger is visible to the reviewer and the leaver. The successor sees the approved handover.")


def claim_summary(c: Claim, refs: list[str]) -> dict:
    return {
        "id": str(c.id), "type": c.type, "type_label": TYPE_LABELS.get(c.type, c.type), "text": c.text,
        "status": c.status, "status_reason": c.status_reason, "origin": c.origin, "review_state": c.review_state,
        "subject_key": c.subject_key, "value": c.value, "stated": c.stated,
        "occurred_at": c.occurred_at.isoformat() if c.occurred_at else None,
        "superseded_by": str(c.superseded_by) if c.superseded_by else None,
        "conflict_group_id": str(c.conflict_group_id) if c.conflict_group_id else None,
        "reviewer_note": c.reviewer_note, "source_refs": refs,
        "flags": (c.meta or {}).get("flags", {}), "question": (c.meta or {}).get("question"),
        "source_changed": (c.meta or {}).get("source_changed"), "needs_rereview": bool((c.meta or {}).get("needs_rereview")),
    }


def _acknowledge_source_change(c: Claim) -> None:
    """A reviewer acting on a claim has seen the "source changed" flag; clear it (the status rules still apply)."""
    if c.meta and ("source_changed" in c.meta or "needs_rereview" in c.meta):
        c.meta = {k: v for k, v in c.meta.items() if k not in ("source_changed", "needs_rereview")}


@router.get("/workspaces/{workspace_id}/claims")
def list_claims(tab: str = "all", status: str | None = None, type: str | None = None, q: str | None = None,
                ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    _require_ledger_access(ctx)
    claims = list(db.scalars(select(Claim).where(Claim.workspace_id == ctx.workspace.id)))
    cited = claim_sources(db, [c.id for c in claims])
    claims = [c for c in claims if visible(ctx.viewer, cited.get(c.id, []))]  # server-side projection
    ev = evidence_rows(db, [c.id for c in claims])
    refs = {c.id: list(dict.fromkeys(ref_for(*r) for r in ev.get(c.id, []))) for c in claims}

    live = [c for c in claims if c.status != "rejected" and not c.superseded_by]
    counts = Counter(c.status for c in live)
    type_counts = Counter(c.type for c in live)
    tab_counts = {"all": len(live), "conflicts": sum(1 for c in live if c.status == "conflicting"),
                  "missing": sum(1 for c in live if c.status == "missing"),
                  "rejected": sum(1 for c in claims if c.status == "rejected"),
                  "superseded": sum(1 for c in claims if c.superseded_by)}

    if tab == "rejected":
        rows = [c for c in claims if c.status == "rejected"]
    elif tab == "conflicts":
        rows = [c for c in live if c.status == "conflicting"]
    elif tab == "missing":
        rows = [c for c in live if c.status == "missing"]
    else:
        rows = live
    if status:
        rows = [c for c in rows if c.status == status]
    if type:
        rows = [c for c in rows if c.type == type]
    if q:
        ql = q.lower()
        rows = [c for c in rows if ql in c.text.lower() or ql in c.subject_key.lower()]

    order = {"conflicting": 0, "missing": 1, "inferred": 2, "supported": 3, "verified": 4, "rejected": 5}
    rows.sort(key=lambda c: (order.get(c.status or "", 9), c.type, c.text))
    reviewed = sum(1 for c in live if c.review_state != "none")
    return {"claims": [claim_summary(c, refs.get(c.id, [])) for c in rows], "status_counts": counts,
            "type_counts": type_counts, "tab_counts": tab_counts,
            "progress": {"reviewed": reviewed, "total": len(live),
                         "supported_unconfirmed": sum(1 for c in live if c.status == "supported" and c.review_state == "none"),
                         "source_changed": sum(1 for c in live if (c.meta or {}).get("source_changed"))}}


def _load_claim(db: Session, request: Request, claim_id: uuid.UUID) -> tuple[Claim, Ctx]:
    c = db.get(Claim, claim_id)
    if c is None:
        raise HTTPException(404, "Claim not found")
    ctx = resolve_ctx(db, request, c.workspace_id)
    if not visible(ctx.viewer, claim_sources(db, [c.id]).get(c.id, [])):
        raise HTTPException(404, "Claim not found")  # don't leak existence (spec §5)
    return c, ctx


def evidence_payload(ev: Evidence, ch: Chunk, src: Source, names: dict, mask: bool) -> dict:
    a = max(0, (ev.match_start if ev.match_start is not None else 0) - EXCERPT_CHARS)
    b = min(len(ch.text), (ev.match_end if ev.match_end is not None else EXCERPT_CHARS) + EXCERPT_CHARS)
    before, hit, after = ch.text[a:ev.match_start or a], "", ch.text[ev.match_end or a:b]
    if ev.match_start is not None and ev.match_end is not None:
        hit = ch.text[ev.match_start:ev.match_end]
    else:
        before, after = ch.text[a:b], ""
    tx = (lambda s: mask_pii(s)) if mask else (lambda s: s)
    return {
        "id": str(ev.id), "quote": tx(ev.quote), "quote_found": ev.quote_found, "match_score": ev.match_score,
        "verdict": ev.verdict, "verdict_reason": ev.verdict_reason, "verifier": ev.verifier,
        "ref": ref_for(ev, ch, src), "source": {"id": str(src.id), "name": src.name, "type": src.type,
                                                 "access": access_label(src.acl, names)},
        "location": ch.location, "kind": ch.kind, "author": ch.author,
        "occurred_at": ch.occurred_at.isoformat() if ch.occurred_at else None,
        "excerpt": {"before": tx(before), "match": tx(hit), "after": tx(after),
                    "truncated_start": a > 0, "truncated_end": b < len(ch.text)},
    }


@router.get("/claims/{claim_id}")
def get_claim(claim_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    c, ctx = _load_claim(db, request, claim_id)
    if not (ctx.is_reviewer or "leaver" in ctx.roles or ctx.is_admin):
        raise HTTPException(404, "Claim not found")
    names = {str(m.id): m.display_name for m in db.scalars(select(Member).where(Member.workspace_id == c.workspace_id))}
    rows = evidence_rows(db, [c.id]).get(c.id, [])
    detail = claim_summary(c, list(dict.fromkeys(ref_for(*r) for r in rows)))
    detail["evidence"] = [evidence_payload(e, ch, s, names, mask=not ctx.is_reviewer) for e, ch, s in rows]
    if c.conflict_group_id:
        others = [o for o in db.scalars(select(Claim).where(Claim.conflict_group_id == c.conflict_group_id, Claim.id != c.id))]
        cited = claim_sources(db, [o.id for o in others])
        g = db.get(ConflictGroup, c.conflict_group_id)
        detail["conflict"] = {"id": str(g.id), "resolved": g.resolved, "resolution": g.resolution,
                              "others": [claim_summary(o, []) for o in others if visible(ctx.viewer, cited.get(o.id, []))]}
    if c.superseded_by:
        newer = db.get(Claim, c.superseded_by)
        detail["superseded_by_text"] = newer.text if newer else None
    history = db.scalars(select(ReviewEvent).where(ReviewEvent.claim_id == c.id).order_by(ReviewEvent.created_at))
    detail["history"] = [{"action": h.action, "actor_role": h.actor_role, "note": h.note,
                          "at": h.created_at.isoformat()} for h in history]
    return detail


class ReviewIn(BaseModel):
    action: Literal["confirm", "edit", "reject", "promote", "comment", "restore"]
    text: str | None = Field(default=None, max_length=400)
    note: str | None = Field(default=None, max_length=500)


def reverify_claim(db: Session, c: Claim) -> str:
    """Edits must not keep a stale 'supported' badge: re-run the isolated verifier on the edited text (spec §4)."""
    from baton.llm.base import LLMError, get_llm
    from baton.verify.entailment import excerpt, verify

    s = get_settings()
    rows = evidence_rows(db, [c.id]).get(c.id, [])
    try:
        llm = get_llm()
    except LLMError:
        llm = None
    outcome = "verified"
    for ev, ch, _ in rows:
        if not ev.quote_found:
            continue
        if llm is None:
            ev.verdict, ev.verifier, ev.verdict_reason = "pending", "unavailable", "verification unavailable (no LLM key)"
            outcome = "unavailable"
            continue
        try:
            v = verify(llm, s.llm_model_verify, c.text, excerpt(ch.text, ev.match_start, ev.match_end, ev.quote),
                       workspace_id=c.workspace_id)
            ev.verdict, ev.verdict_reason, ev.verifier = v.verdict, v.reason[:300], s.llm_model_verify
        except LLMError as exc:
            ev.verdict, ev.verifier, ev.verdict_reason = "pending", "error", exc.user_message[:300]
            outcome = "unavailable"
    return outcome


@router.post("/claims/{claim_id}/review")
def review_claim(claim_id: uuid.UUID, body: ReviewIn, request: Request, db: Session = Depends(get_db)) -> dict:
    c, ctx = _load_claim(db, request, claim_id)
    if not ctx.can_write:
        raise HTTPException(403, "This is the shared read-only template. Click 'Try the demo' to get your own copy.")
    if body.action != "comment" and not ctx.is_reviewer:
        raise HTTPException(403, "Only the reviewer can change claims. The leaver can add comments.")
    if body.action == "comment" and not (ctx.is_reviewer or "leaver" in ctx.roles):
        raise HTTPException(403, "Only the reviewer or the leaver can comment.")

    check_review_rate(db, c.workspace_id)
    before = _snap(c)
    reverify = None
    if body.action != "comment":
        _acknowledge_source_change(c)
    if body.action == "confirm":
        c.review_state = "confirmed"
    elif body.action == "reject":
        c.review_state, c.reviewer_note = "rejected", body.note or c.reviewer_note
    elif body.action == "restore":
        c.review_state = "none"
    elif body.action == "promote":
        if not (body.note or "").strip():
            raise HTTPException(422, "Promoting a claim without source evidence requires a note explaining why.")
        c.review_state, c.reviewer_note = "promoted", body.note.strip()
    elif body.action == "edit":
        if not (body.text or "").strip():
            raise HTTPException(422, "Edited text can't be empty.")
        c.text, c.review_state = body.text.strip(), "edited"
        if body.note:
            c.reviewer_note = body.note
        reverify = reverify_claim(db, c)

    actor_role = "reviewer" if ctx.is_reviewer else "leaver"
    db.add(ReviewEvent(claim_id=c.id, actor_member_id=ctx.member.id, actor_role=actor_role, action=body.action,
                       before=before, after=None, note=body.note))
    db.flush()
    ids = [c.id] + ([o.id for o in db.scalars(select(Claim).where(Claim.conflict_group_id == c.conflict_group_id))]
                    if c.conflict_group_id else [])
    recompute_statuses(db, c.workspace_id, ids)
    ev =db.scalars(select(ReviewEvent).where(ReviewEvent.claim_id == c.id).order_by(ReviewEvent.created_at.desc())).first()
    ev.after = _snap(c)
    db.commit()
    return {"claim": claim_summary(c, []), "reverify": reverify}


class ResolveIn(BaseModel):
    winner_claim_id: uuid.UUID | None = None
    keep_as_risk: bool = False
    note: str | None = Field(default=None, max_length=500)


@router.post("/conflicts/{group_id}/resolve")
def resolve_conflict(group_id: uuid.UUID, body: ResolveIn, request: Request, db: Session = Depends(get_db)) -> dict:
    g = db.get(ConflictGroup, group_id)
    if g is None:
        raise HTTPException(404, "Conflict not found")
    ctx = resolve_ctx(db, request, g.workspace_id)
    if not ctx.is_reviewer:
        raise HTTPException(403, "Only the reviewer can resolve conflicts")
    if not ctx.can_write:
        raise HTTPException(403, "This is the shared read-only template. Click 'Try the demo' to get your own copy.")
    if g.resolved:
        raise HTTPException(409, "Already resolved")
    members = list(db.scalars(select(Claim).where(Claim.conflict_group_id == g.id)))
    if body.winner_claim_id:
        winner = next((m for m in members if m.id == body.winner_claim_id), None)
        if winner is None:
            raise HTTPException(422, "Winner must be one of the conflicting claims")
        for m in members:
            if m.id != winner.id:
                m.superseded_by = winner.id
            db.add(ReviewEvent(claim_id=m.id, actor_member_id=ctx.member.id, actor_role="reviewer",
                               action="resolve_winner" if m.id == winner.id else "resolve_superseded", note=body.note))
        g.resolution = f"winner:{winner.id}"
    elif body.keep_as_risk:
        cited = evidence_rows(db, [m.id for m in members])
        texts = " vs ".join(f"'{m.text}'" for m in members)
        risk = Claim(workspace_id=g.workspace_id, type="risk", subject_key=g.subject_key, origin="extracted",
                     text=f"Unresolved: sources disagree on {g.subject_key.replace('.', ' ')}: {texts}"[:400],
                     review_state="confirmed", reviewer_note=body.note, meta={"from_conflict": str(g.id)})
        db.add(risk)
        db.flush()
        for m in members:
            for ev, _, _ in cited.get(m.id, []):  # the new risk cites both sides' evidence
                db.add(Evidence(claim_id=risk.id, chunk_id=ev.chunk_id, quote=ev.quote, match_score=ev.match_score,
                                quote_found=ev.quote_found, match_start=ev.match_start, match_end=ev.match_end,
                                verdict="supports" if ev.quote_found else "pending",
                                verdict_reason="Reviewer kept the disagreement as an open risk; quote shows one side.",
                                verifier="reviewer"))
            db.add(ReviewEvent(claim_id=m.id, actor_member_id=ctx.member.id, actor_role="reviewer",
                               action="resolve_keep_risk", note=body.note))
        g.resolution = f"risk:{risk.id}"
        members.append(risk)
    else:
        raise HTTPException(422, "Pick a winner or keep both as an open risk")
    g.resolved, g.resolved_by = True, ctx.member.id
    db.flush()
    recompute_statuses(db, g.workspace_id, [m.id for m in members])
    db.commit()
    return {"resolved": True, "resolution": g.resolution}


@router.get("/workspaces/{workspace_id}/timeline")
def timeline(ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    _require_ledger_access(ctx)
    claims = [c for c in db.scalars(select(Claim).where(Claim.workspace_id == ctx.workspace.id, Claim.occurred_at.is_not(None)))
              if c.status != "rejected" and c.type in ("decision", "risk", "open_work", "next_action", "recurring_issue", "dependency")]
    cited = claim_sources(db, [c.id for c in claims])
    claims = [c for c in claims if visible(ctx.viewer, cited.get(c.id, []))]
    ev = evidence_rows(db, [c.id for c in claims])
    by_id = {c.id: c for c in claims}
    claims.sort(key=lambda c: c.occurred_at)
    return {"events": [{**claim_summary(c, list(dict.fromkeys(ref_for(*r) for r in ev.get(c.id, [])))),
                        "superseded_by_text": by_id[c.superseded_by].text if c.superseded_by in by_id else None}
                       for c in claims]}


@router.get("/workspaces/{workspace_id}/questions")
def questions(ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    """Questions for the leaver from Missing + unresolved Conflicting claims (manual precursor to R3 gap interview)."""
    if not ctx.is_reviewer:
        raise HTTPException(403, "Only the reviewer can see the question list")
    claims = list(db.scalars(select(Claim).where(Claim.workspace_id == ctx.workspace.id)))
    live = [c for c in claims if c.status in ("missing", "conflicting") and not c.superseded_by]
    order = {"open_work": 0, "contact": 1, "ownership": 1}
    missing = sorted([c for c in live if c.status == "missing"], key=lambda c: (order.get(c.type, 2), c.text))
    qs = [{"claim_id": str(c.id), "kind": "missing", "text": f"{c.text}?" if not c.text.endswith("?") else c.text}
          for c in missing]
    seen = set()
    for c in live:
        if c.status == "conflicting" and c.conflict_group_id not in seen:
            seen.add(c.conflict_group_id)
            group = [o for o in claims if o.conflict_group_id == c.conflict_group_id]
            qs.append({"claim_id": str(c.id), "kind": "conflict",
                       "text": " vs ".join(f"“{o.text}”" for o in group) + " - which is current, and why?"})
    leaver = db.scalar(select(Member).where(Member.id == next((c.about_member_id for c in claims if c.about_member_id), None)))
    name = leaver.display_name if leaver else "the leaver"
    md = f"## Questions for {name}\n\n" + "\n".join(f"{i}. {q['text']}" for i, q in enumerate(qs, start=1))
    issue_title = f"Handover questions for {name} ({ctx.workspace.name})"
    issue_body = ("Baton could not answer these from the project's sources. Please reply inline before you leave.\n\n"
                  + "\n".join(f"- [ ] {q['text']}" for q in qs)
                  + "\n\n_Generated by Baton from Missing and Conflicting claims._")
    return {"questions": qs, "markdown": md, "leaver": name, "issue_title": issue_title, "issue_body": issue_body}


class BulkIn(BaseModel):
    claim_ids: list[uuid.UUID] = Field(min_length=1, max_length=200)
    action: Literal["confirm", "reject"]
    note: str | None = Field(default=None, max_length=500)


@router.post("/workspaces/{workspace_id}/claims/bulk-review")
def bulk_review(body: BulkIn, ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    """Confirm or reject many claims at once. Confirm only applies where a quote passed both checks: a bulk action can
    never turn an unsupported claim into Verified."""
    if not ctx.is_reviewer:
        raise HTTPException(403, "Only the reviewer can review claims")
    if not ctx.can_write:
        raise HTTPException(403, "This is the shared read-only template. Click 'Try the demo' to get your own copy.")
    check_review_rate(db, ctx.workspace.id)
    claims = list(db.scalars(select(Claim).where(Claim.workspace_id == ctx.workspace.id, Claim.id.in_(body.claim_ids))))
    passing = {cid for (cid,) in db.execute(select(Evidence.claim_id).where(
        Evidence.claim_id.in_([c.id for c in claims]), Evidence.quote_found.is_(True), Evidence.verdict == "supports"))}
    done, skipped = [], []
    for c in claims:
        if body.action == "confirm" and (c.id not in passing or c.status in ("rejected", "conflicting")):
            skipped.append(str(c.id))
            continue
        before = _snap(c)
        _acknowledge_source_change(c)
        if body.action == "confirm":
            c.review_state = "confirmed"
        else:
            c.review_state, c.reviewer_note = "rejected", body.note or c.reviewer_note
        db.add(ReviewEvent(claim_id=c.id, actor_member_id=ctx.member.id, actor_role="reviewer",
                           action=f"bulk_{body.action}", before=before, after=None, note=body.note))
        done.append(c.id)
    db.flush()
    recompute_statuses(db, ctx.workspace.id, done)
    db.commit()
    return {"updated": len(done), "skipped": len(skipped), "skipped_ids": skipped}
