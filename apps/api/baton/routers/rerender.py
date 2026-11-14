"""POST /handovers/{id}/rerender/{claim_id}: rebuild a withheld claim from the successor's accessible sources only.
See baton/reconstruct/rerender.py for the safety design. Reviewer only, rate-limited, never a cold path for judges
(the demo's results are computed in advance)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from baton.acl import Viewer, can_view_acl
from baton.auth import _roles
from baton.config import get_settings
from baton.db.models import AuditEvent, Chunk, Claim, Evidence, LlmCall, Member, Source
from baton.db.session import get_db
from baton.ledger import rebuild_relations, recompute_statuses
from baton.llm.base import LLMError, get_llm
from baton.projection import claim_sources, visible
from baton.reconstruct.rerender import (
    RERENDER_SYSTEM, Rerendered, assert_only_visible, build_prompt, candidate_chunks, search_terms,
)
from baton.routers.handovers import _handover
from baton.verify.entailment import excerpt, verify
from baton.verify.quote_match import match

router = APIRouter(prefix="/api", tags=["Successor acknowledgement"])
RERENDERS_PER_HOUR = 20


def rerender_claim(db: Session, workspace_id, original: Claim, successor: Member, llm=None) -> dict:
    """Shared by the endpoint and the demo seeding script. Returns {status, claim_id?, reason}."""
    viewer = Viewer(str(successor.id), _roles(db, successor.id, workspace_id))
    cited = claim_sources(db, [original.id]).get(original.id, [])
    if visible(viewer, cited):
        return {"status": "not_withheld", "reason": f"{successor.display_name} can already see this claim."}
    restricted_sources = {sid for sid, _, acl in cited if not can_view_acl(viewer, acl)}
    terms = search_terms(original.text)
    chunks = candidate_chunks(db, workspace_id, viewer, terms, restricted_sources)
    if not chunks:
        original.meta = {**(original.meta or {}), "rerender_none": "no_sources"}
        return {"status": "no_sources", "reason": f"No source {successor.display_name} can read mentions this."}
    allowed = {ch.id for ch, acl in db.execute(select(Chunk, Source.acl).join(Source, Source.id == Chunk.source_id)
                                               .where(Chunk.id.in_([c.id for c in chunks]))) if can_view_acl(viewer, acl)}
    assert_only_visible(chunks, allowed)  # defence in depth: never send what the successor can't read
    topic = original.subject_key.replace(".", " ").replace("_", " ")
    user, labels = build_prompt(topic, original.type, chunks)
    s = get_settings()
    llm = llm or get_llm()
    res: Rerendered = llm.structured(system=RERENDER_SYSTEM, user=user, schema=Rerendered, model=s.llm_model_verify,
                                     purpose="rerender", workspace_id=workspace_id)
    if not res.possible or not res.claim or not res.quote or res.passage not in labels:
        original.meta = {**(original.meta or {}), "rerender_none": "not_stated"}
        return {"status": "not_stated", "reason": res.reason or f"The sources {successor.display_name} can read don't state this."}
    ch = labels[res.passage]
    m = match(res.quote, ch.text)
    if not m.found:  # no fabricated quotes (trust rule 2)
        original.meta = {**(original.meta or {}), "rerender_none": "quote_not_found"}
        return {"status": "quote_not_found", "reason": "The rewrite's quote wasn't found in the passage, so it was discarded."}
    new = Claim(workspace_id=workspace_id, type=original.type, text=res.claim.strip()[:400], subject_key=original.subject_key,
                origin="extracted", occurred_at=ch.occurred_at, derived_from=original.id, stated=True,
                meta={"rerendered_for": successor.display_name, "rerendered_at": datetime.now(UTC).isoformat()})
    db.add(new)
    db.flush()
    try:  # separate verifier (trust rule 3): sees only the new claim and the accessible excerpt
        v = verify(llm, s.llm_model_verify, new.text, excerpt(ch.text, m.start, m.end, res.quote), workspace_id=workspace_id)
        verdict, why = v.verdict, v.reason
    except LLMError:
        verdict, why = "pending", "verification unavailable"
    db.add(Evidence(claim_id=new.id, chunk_id=ch.id, quote=res.quote, quote_found=True, match_score=m.score, match_start=m.start,
                    match_end=m.end, verdict=verdict, verdict_reason=why, verifier="llm"))
    meta = dict(original.meta or {})
    meta.pop("rerender_none", None)
    original.meta = meta
    db.flush()
    recompute_statuses(db, workspace_id, [new.id])
    return {"status": "created", "claim_id": str(new.id), "text": new.text, "claim_status": new.status, "reason": why}


@router.post("/handovers/{handover_id}/rerender/{claim_id}")
def rerender(handover_id: uuid.UUID, claim_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    h, ctx = _handover(db, request, handover_id)
    if not ctx.is_reviewer:
        raise HTTPException(403, "Only the reviewer can rewrite withheld items")
    if not ctx.can_write:
        raise HTTPException(403, "This is the shared read-only template. Click 'Try the demo' to get your own copy.")
    original = db.get(Claim, claim_id)
    if original is None or original.workspace_id != h.workspace_id:
        raise HTTPException(404, "Claim not found")
    existing = db.scalar(select(Claim).where(Claim.derived_from == original.id, Claim.review_state != "rejected"))
    if existing is not None:
        return {"status": "exists", "claim_id": str(existing.id), "text": existing.text, "claim_status": existing.status}
    successor = db.get(Member, h.successor_member_id) if h.successor_member_id else None
    if successor is None:
        raise HTTPException(409, "This handover has no successor.")
    if not get_settings().llm_configured:
        raise HTTPException(503, "Rewriting needs the AI, which isn't configured on this server.")
    recent = db.scalar(select(func.count()).select_from(LlmCall).where(
        LlmCall.workspace_id == h.workspace_id, LlmCall.purpose == "rerender", LlmCall.created_at > datetime.now(UTC) - timedelta(hours=1)))
    if recent >= RERENDERS_PER_HOUR:
        raise HTTPException(429, "Lots of rewrites this hour. Please try again in a little while.")
    try:
        out = rerender_claim(db, h.workspace_id, original, successor)
    except LLMError as exc:
        raise HTTPException(503, exc.user_message) from exc
    db.add(AuditEvent(workspace_id=h.workspace_id, actor_member_id=ctx.member.id, actor_role="reviewer", action="rerender",
                      target=str(original.id), after={"status": out["status"]}))
    rebuild_relations(db, h.workspace_id)
    db.commit()
    return out
