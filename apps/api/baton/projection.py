"""Visibility projection: which claims a persona may see, and why others are withheld (spec §5).

Applied at READ time from the current source ACLs, never baked into snapshots. Uses the pure rules in acl.py.
"""

from __future__ import annotations

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from baton.acl import Viewer, access_label, can_view_acl, can_view_claim
from baton.db.models import Chunk, Evidence, Member, Source


def source_acls_for_chunks(db: Session, chunk_ids: list) -> dict:
    """chunk_id -> (source_id, source name, acl)."""
    if not chunk_ids:
        return {}
    rows = db.execute(select(Chunk.id, Source.id, Source.name, Source.acl).join(Source, Source.id == Chunk.source_id)
                      .where(Chunk.id.in_(chunk_ids)))
    return {cid: (sid, name, acl) for cid, sid, name, acl in rows}


def claim_sources(db: Session, claim_ids: list) -> dict:
    """claim_id -> list of (source_id, source name, acl) for every cited chunk."""
    out: dict = defaultdict(list)
    if not claim_ids:
        return out
    rows = db.execute(select(Evidence.claim_id, Source.id, Source.name, Source.acl)
                      .join(Chunk, Chunk.id == Evidence.chunk_id).join(Source, Source.id == Chunk.source_id)
                      .where(Evidence.claim_id.in_(claim_ids)))
    for cid, sid, name, acl in rows:
        out[cid].append((sid, name, acl))
    return out


def visible(viewer: Viewer, cited: list) -> bool:
    return can_view_claim(viewer, [acl for _, _, acl in cited])


def withheld_reason(db: Session, workspace_id, viewer: Viewer, cited: list) -> str:
    names = {str(m.id): m.display_name for m in db.scalars(select(Member).where(Member.workspace_id == workspace_id))}
    blocked = [(n, acl) for _, n, acl in cited if not can_view_acl(viewer, acl)]
    seen, parts = set(), []
    for n, acl in blocked:
        if n not in seen:
            seen.add(n)
            parts.append(f"{n} ({access_label(acl, names)})")
    return "cites " + ", ".join(parts)
