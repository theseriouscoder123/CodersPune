"""Persist chunk drafts for a source: scrub every chunk BEFORE it touches the database, tag it with the source's
ACL key, and record the scrub report and item counts on the source."""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime

from sqlalchemy import delete, insert
from sqlalchemy.orm import Session

from baton.acl import acl_key
from baton.db.models import Chunk, Source
from baton.ingest.scrubber import merge_reports, scrub
from baton.ingest.types import ChunkDraft


def store_chunks(db: Session, source: Source, drafts: list[ChunkDraft], *, replace: bool = True) -> dict:
    source.acl_key = acl_key(source.acl)
    if replace:
        db.execute(delete(Chunk).where(Chunk.source_id == source.id))

    report: Counter[str] = Counter()
    rows = []
    for d in drafts:
        clean, counts = scrub(d.text)
        report.update(counts)
        if not clean.strip():
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
    if rows:
        db.execute(insert(Chunk), rows)

    kinds = Counter(r["kind"] for r in rows)
    source.scrub_report = merge_reports(source.scrub_report or {} if not replace else {}, report)
    source.meta = {**(source.meta or {}), "chunk_count": len(rows), "chunk_kinds": dict(kinds)}
    source.ingested_at = datetime.now(UTC)
    db.flush()
    return {"chunks": len(rows), "redactions": sum(report.values())}
