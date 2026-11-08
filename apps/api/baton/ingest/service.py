"""Persist chunk drafts for a source: scrub every chunk BEFORE it touches the database, tag it with the source's
ACL key, and record the scrub report and item counts on the source."""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime

from sqlalchemy import delete, insert, select
from sqlalchemy.orm import Session

from baton.acl import acl_key
from baton.db.models import Chunk, Source
from baton.ingest.scrubber import merge_reports, scrub
from baton.ingest.types import ChunkDraft


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
    stale = [c.id for c in existing.values() if c.id not in keep]
    if stale:
        db.execute(delete(Chunk).where(Chunk.id.in_(stale)))
    if rows:
        db.execute(insert(Chunk), rows)

    kinds = Counter(c.kind for c in db.scalars(select(Chunk).where(Chunk.source_id == source.id))) if replace else Counter(r["kind"] for r in rows)
    source.scrub_report = merge_reports(source.scrub_report or {} if not replace else {}, report)
    source.meta = {**(source.meta or {}), "chunk_count": sum(kinds.values()), "chunk_kinds": dict(kinds)}
    source.ingested_at = datetime.now(UTC)
    db.flush()
    return {"chunks": sum(kinds.values()), "new": len(rows), "removed": len(stale), "redactions": sum(report.values())}
