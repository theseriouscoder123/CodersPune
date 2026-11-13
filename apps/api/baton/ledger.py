"""Ledger helpers shared by the pipeline and the review API: evidence labels and status recomputation.

Status is ALWAYS computed by status.py from DB state; nothing else writes claims.status.
"""

from __future__ import annotations

import uuid
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from baton.db.models import Chunk, Claim, ConflictGroup, Evidence, Member, Membership, Source
from baton.reconstruct.refs import source_ref
from baton.status import ClaimState, EvidenceState, compute_status


def reviewer_name(db: Session, workspace_id) -> str:
    name = db.scalar(select(Member.display_name).join(Membership, Membership.member_id == Member.id)
                     .where(Membership.workspace_id == workspace_id, Membership.role == "reviewer").limit(1))
    return name or "the reviewer"


def evidence_rows(db: Session, claim_ids: list) -> dict:
    """claim_id -> list of (Evidence, Chunk, Source)."""
    out: dict = defaultdict(list)
    if not claim_ids:
        return out
    q = (select(Evidence, Chunk, Source).join(Chunk, Chunk.id == Evidence.chunk_id).join(Source, Source.id == Chunk.source_id)
         .where(Evidence.claim_id.in_(claim_ids)).order_by(Evidence.created_at))
    for ev, ch, src in db.execute(q):
        out[ev.claim_id].append((ev, ch, src))
    return out


def ref_for(ev: Evidence, ch: Chunk, src: Source) -> str:
    return source_ref(ch.kind, ch.location, ch.occurred_at, src.name, ch.text, ev.match_start)


def recompute_statuses(db: Session, workspace_id, claim_ids: list | None = None) -> int:
    q = select(Claim).where(Claim.workspace_id == workspace_id)
    if claim_ids is not None:
        q = q.where(Claim.id.in_(claim_ids))
    claims = list(db.scalars(q))
    if not claims:
        return 0
    groups = {g.id: g for g in db.scalars(select(ConflictGroup).where(ConflictGroup.workspace_id == workspace_id))}
    # Conflict partners need the whole group, even when recomputing a subset.
    group_ids = {c.conflict_group_id for c in claims if c.conflict_group_id}
    partners: dict = defaultdict(list)
    if group_ids:
        for other in db.scalars(select(Claim).where(Claim.conflict_group_id.in_(group_ids))):
            partners[other.conflict_group_id].append(other)
    ev = evidence_rows(db, [c.id for c in claims] + [p.id for ps in partners.values() for p in ps])
    rname = reviewer_name(db, workspace_id)

    for c in claims:
        states = tuple(EvidenceState(e.quote_found, e.verdict, ref_for(e, ch, src), e.match_score, e.verdict_reason)
                       for e, ch, src in ev.get(c.id, []))
        g = groups.get(c.conflict_group_id) if c.conflict_group_id else None
        unresolved = bool(g and not g.resolved)
        conflict_with = None
        if unresolved:
            others = [o for o in partners[c.conflict_group_id] if o.id != c.id]
            if others:
                o = others[0]
                o_ref = ", ".join(ref_for(*row) for row in ev.get(o.id, [])[:1]) or "another source"
                conflict_with = f"'{o.text}' ({o_ref})"
        result = compute_status(ClaimState(
            origin=c.origin, review_state=c.review_state, evidence=states, in_unresolved_conflict=unresolved,
            conflict_with=conflict_with, reviewer_name=rname, reviewer_note=c.reviewer_note,
            checklist_signal=(c.meta or {}).get("signal"),
            source_changed=((c.meta or {}).get("source_changed") or {}).get("note"),
            testimony_from=(c.meta or {}).get("testimony_from"),
            answered_by=(c.meta or {}).get("answered_by_name"),
        ))
        c.status, c.status_reason = result.status, result.reason
        c.meta = {**(c.meta or {}), "flags": result.flags} if result.flags or (c.meta or {}).get("flags") else (c.meta or {})
    db.flush()
    return len(claims)


def as_uuid(v) -> uuid.UUID:
    return v if isinstance(v, uuid.UUID) else uuid.UUID(str(v))
