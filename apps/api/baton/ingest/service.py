"""Persist chunk drafts for a source: scrub every chunk BEFORE it touches the database, tag it with the source's
ACL key, and record the scrub report and item counts on the source."""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime

from sqlalchemy import delete, insert, select
from sqlalchemy.orm import Session

from baton.acl import acl_key
from baton.db.models import Chunk, Claim, Evidence, Source
from baton.ingest.scrubber import merge_reports, scrub
from baton.ingest.types import ChunkDraft
from baton.reconstruct.refs import source_ref
from baton.verify.quote_match import match as quote_match


def store_chunks(db: Session, source: Source, drafts: list[ChunkDraft], *, replace: bool = True) -> dict:
    """Upsert by content: unchanged chunks keep their ids (so evidence on reviewed claims survives a refresh), removed
    chunks are deleted (their evidence goes with them), and only genuinely new chunks are inserted."""
    source.acl_key = acl_key(source.acl)
    existing = {(c.kind, c.text): c for c in db.scalars(select(Chunk).where(Chunk.source_id == source.id))} if replace else {}

    report: Counter[str] = Counter()
    rows = []
    keep: set = set()
    for d in drafts:
        clean, counts = scrub(d.text)
        report.update(counts)
        if not clean.strip():
            continue
        old = existing.get((d.kind, clean))
        if old is not None:
            keep.add(old.id)
            if old.acl_key != source.acl_key:
                old.acl_key = source.acl_key
            continue
        rows.append({
            "source_id": source.id,
            "workspace_id": source.workspace_id,
            "kind": d.kind,
            "text": clean,
            "location": d.location,
            "author": d.author,
            "occurred_at": d.occurred_at,
            "acl_key": source.acl_key,
        })
    stale = [c for c in existing.values() if c.id not in keep]
    new_chunks: list[Chunk] = []
    if rows:
        new_ids = list(db.scalars(insert(Chunk).returning(Chunk.id), rows))
        new_chunks = list(db.scalars(select(Chunk).where(Chunk.id.in_(new_ids))))
    reanchored = changed = 0
    if stale:
        reanchored, changed = _rescue_evidence(db, source, stale, new_chunks)
        db.execute(delete(Chunk).where(Chunk.id.in_([c.id for c in stale])))

    kinds = Counter(c.kind for c in db.scalars(select(Chunk).where(Chunk.source_id == source.id))) if replace else Counter(r["kind"] for r in rows)
    source.scrub_report = merge_reports(source.scrub_report or {} if not replace else {}, report)
    source.meta = {**(source.meta or {}), "chunk_count": sum(kinds.values()), "chunk_kinds": dict(kinds)}
    source.ingested_at = datetime.now(UTC)
    db.flush()
    return {"chunks": sum(kinds.values()), "new": len(rows), "removed": len(stale), "redactions": sum(report.values()),
            "evidence_reanchored": reanchored, "claims_source_changed": changed}


REVIEWED = ("confirmed", "edited", "promoted")


def _rescue_evidence(db: Session, source: Source, stale: list[Chunk], new_chunks: list[Chunk]) -> tuple[int, int]:
    """Before stale chunks are deleted, move their evidence to the new chunk that still contains the quote (same
    90+ normalised match as at extraction). Evidence whose quote is gone is dropped and its claim is flagged
    "source changed", so status.py downgrades it and a reviewer must look again. Returns (re-anchored, claims flagged)."""
    by_id = {c.id: c for c in stale}
    orphans = list(db.scalars(select(Evidence).where(Evidence.chunk_id.in_(list(by_id)))))
    if not orphans:
        return 0, 0
    reanchored = 0
    lost: dict = {}
    for ev in orphans:
        old = by_id[ev.chunk_id]
        best = None
        for ch in new_chunks:
            if ch.kind != old.kind:
                continue
            m = quote_match(ev.quote, ch.text)
            if m.found and (best is None or m.score > best[1].score):
                best = (ch, m)
        if best:
            ch, m = best
            ev.chunk_id, ev.match_score, ev.match_start, ev.match_end = ch.id, m.score, m.start, m.end
            reanchored += 1
        else:
            lost.setdefault(ev.claim_id, []).append(source_ref(old.kind, old.location or {}, old.occurred_at, source.name,
                                                               old.text, ev.match_start))
    if lost:
        now = datetime.now(UTC).isoformat()
        for claim in db.scalars(select(Claim).where(Claim.id.in_(list(lost)))):
            where = ", ".join(sorted(set(lost[claim.id])))[:120]
            meta = dict(claim.meta or {})
            meta["source_changed"] = {"at": now, "source": source.name, "where": where,
                                      "note": f"{source.name} changed and the quoted text ({where}) is no longer there"}
            if claim.review_state in REVIEWED:
                meta["needs_rereview"] = True
            claim.meta = meta
    db.flush()
    return reanchored, len(lost)
