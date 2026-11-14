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


def merge_duplicates(db: Session, workspace_id) -> int:
    """Fix F3: merge near-identical claims (rules in reconstruct/duplicates.py). Evidence moves to the survivor, links
    are re-pointed, and each merge leaves an audit row. Claims a person has touched are never deleted."""
    from sqlalchemy import delete, update

    from baton.db.models import Acknowledgement, AuditEvent, ClaimRelation, InterviewQuestion, ReviewEvent
    from baton.reconstruct.duplicates import D, find_duplicates

    claims = [c for c in db.scalars(select(Claim).where(Claim.workspace_id == workspace_id))
              if c.status != "rejected" and not c.superseded_by]
    if len(claims) < 2:
        return 0
    ids = [c.id for c in claims]
    touched = set(db.scalars(select(ReviewEvent.claim_id).where(ReviewEvent.claim_id.in_(ids))))
    touched |= set(db.scalars(select(Acknowledgement.claim_id).where(Acknowledgement.claim_id.in_(ids))))
    for a, b in db.execute(select(ClaimRelation.from_claim_id, ClaimRelation.to_claim_id)
                           .where(ClaimRelation.decided_by == "reviewer", ClaimRelation.from_claim_id.in_(ids))):
        touched |= {a, b}
    import json

    from baton.projection import claim_sources

    cited = claim_sources(db, ids)
    access = {cid: frozenset(json.dumps(acl, sort_keys=True) for _, _, acl in rows) for cid, rows in cited.items()}
    pairs = find_duplicates([
        D(c.id, c.type, c.subject_key, c.text, reviewed=c.review_state != "none", access=access.get(c.id, frozenset()),
          locked=bool(c.conflict_group_id) or c.origin in ("checklist", "testimony") or bool(c.derived_from)
          or (c.review_state == "none" and c.id in touched))
        for c in claims])
    by_id = {c.id: c for c in claims}
    merged = 0
    for keep_id, drop_id in pairs:
        if drop_id in touched:
            continue
        keep, drop = by_id[keep_id], by_id[drop_id]
        have = {(e.chunk_id, e.quote) for e in db.scalars(select(Evidence).where(Evidence.claim_id == keep_id))}
        for e in list(db.scalars(select(Evidence).where(Evidence.claim_id == drop_id))):
            if (e.chunk_id, e.quote) in have:
                db.delete(e)
            else:
                e.claim_id = keep_id
                have.add((e.chunk_id, e.quote))
        for col in (Claim.superseded_by, Claim.derived_from):
            db.execute(update(Claim).where(col == drop_id).values({col.key: keep_id}))
        db.execute(update(InterviewQuestion).where(InterviewQuestion.claim_id == drop_id).values(claim_id=keep_id))
        db.execute(delete(ClaimRelation).where((ClaimRelation.from_claim_id == drop_id) | (ClaimRelation.to_claim_id == drop_id)))
        db.add(AuditEvent(workspace_id=workspace_id, actor_member_id=None, actor_role="system", action="duplicate_merged",
                          target=str(keep_id), before={"text": drop.text, "subject_key": drop.subject_key},
                          after={"text": keep.text, "subject_key": keep.subject_key}))
        db.flush()
        db.delete(drop)
        merged += 1
    if merged:
        db.flush()
    return merged


def rebuild_relations(db: Session, workspace_id) -> dict:
    """Round 3 improvement #2: record WHY claims relate (reversal / historical / contradiction) and mark stale open work.
    Deterministic, no LLM. Reviewer decisions (decided_by='reviewer', meta.stale_override) are never overwritten."""
    from sqlalchemy import delete

    from baton.db.models import ClaimRelation
    from baton.reconstruct.relations import C, classify_supersession, contradiction_signal, ordered, stale_reasons

    claims = list(db.scalars(select(Claim).where(Claim.workspace_id == workspace_id)))
    by_id = {c.id: c for c in claims}
    ev = evidence_rows(db, [c.id for c in claims])

    def lite(c: Claim) -> C:
        rows = ev.get(c.id, [])
        origin = "extracted" if (c.origin == "checklist" and c.status != "missing") else c.origin  # covered checklist items count
        return C(str(c.id), c.type, c.text, c.subject_key, c.value, c.occurred_at, origin, c.supersedes_hint,
                 ref_for(*rows[0]) if rows else "")

    db.execute(delete(ClaimRelation).where(ClaimRelation.workspace_id == workspace_id, ClaimRelation.decided_by == "rule"))
    kept = {(r.from_claim_id, r.to_claim_id) for r in db.scalars(select(ClaimRelation).where(ClaimRelation.workspace_id == workspace_id))}
    kept |= {(b, a) for a, b in kept}
    counts = {"reversal": 0, "historical": 0, "contradiction": 0, "stale": 0}

    def add(a: Claim, b: Claim, relation: str, signal: str) -> None:
        if (a.id, b.id) in kept or a.id == b.id:
            return
        kept.add((a.id, b.id))
        kept.add((b.id, a.id))
        db.add(ClaimRelation(workspace_id=workspace_id, from_claim_id=a.id, to_claim_id=b.id, relation=relation, signal=signal))
        counts[relation] = counts.get(relation, 0) + 1

    for c in claims:
        if c.superseded_by and c.superseded_by in by_id and c.review_state != "rejected":
            newer = by_id[c.superseded_by]
            r = classify_supersession(lite(c), lite(newer))
            add(c, newer, r.relation, r.signal)
    groups: dict = defaultdict(list)
    for c in claims:
        if c.conflict_group_id and c.review_state != "rejected":
            groups[c.conflict_group_id].append(c)
    for members in groups.values():
        for i, a in enumerate(members):
            for b in members[i + 1:]:
                if a.superseded_by == b.id or b.superseded_by == a.id:
                    continue  # resolved with a winner: already recorded as a supersession above
                la, lb = ordered(lite(a), lite(b))
                add(by_id[uuid.UUID(la.id)], by_id[uuid.UUID(lb.id)], "contradiction", contradiction_signal(la, lb))

    stale = stale_reasons([lite(c) for c in claims if c.review_state != "rejected" and not c.superseded_by])
    for c in claims:
        override = (c.meta or {}).get("stale_override")
        reason = None if override == "still_open" else stale.get(str(c.id))
        if c.stale_reason != reason:
            c.stale_reason = reason
        if reason:
            counts["stale"] += 1
    db.flush()
    return counts
