"""Search the ledger and the sources (Postgres full-text search, websearch syntax: "quoted phrases", -exclude, or).

Permission rules are the same as everywhere else, enforced in the query results on the server:
  * only ledger roles (reviewer, leaver, admin) can search; the successor uses the approved handover and Ask;
  * a claim is returned only if every source it cites is visible to the searcher (trust rule 5);
  * a source passage is returned only if its source is visible; snippets are PII-masked for non-reviewers.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from baton.acl import can_view_acl, can_view_claim
from baton.auth import Ctx, workspace_ctx
from baton.db.models import Chunk, Claim, Source
from baton.db.session import get_db
from baton.ingest.scrubber import mask_pii
from baton.ledger import evidence_rows, ref_for
from baton.reconstruct.refs import source_ref
from baton.routers.claims import TYPE_LABELS

router = APIRouter(prefix="/api", tags=["Ledger and review"])

MAX_CLAIMS = 20
MAX_PASSAGES = 12


@router.get("/workspaces/{workspace_id}/search")
def search(q: str = Query(min_length=2, max_length=120), ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    if not (ctx.is_reviewer or ctx.is_admin or "leaver" in ctx.roles):
        raise HTTPException(403, "Search covers the draft ledger, which only the reviewer and the leaver can see")
    ws_id = ctx.workspace.id
    tsq = func.websearch_to_tsquery("english", q)
    mask = not ctx.is_reviewer

    # Claims: rank on claim text; small per workspace, so an on-the-fly tsvector is fine.
    c_vec = func.to_tsvector("english", Claim.text)
    claim_rows = list(db.execute(
        select(Claim, func.ts_rank(c_vec, tsq).label("rank"))
        .where(Claim.workspace_id == ws_id, c_vec.op("@@")(tsq))
        .order_by(func.ts_rank(c_vec, tsq).desc()).limit(MAX_CLAIMS * 2)))
    # Fallback for short tokens / names the stemmer drops (e.g. "FCM", "#142").
    if not claim_rows:
        claim_rows = [(c, 0.0) for c in db.scalars(select(Claim).where(Claim.workspace_id == ws_id, Claim.text.ilike(f"%{_like(q)}%"))
                                                   .limit(MAX_CLAIMS * 2))]
    ev = evidence_rows(db, [c.id for c, _ in claim_rows])
    claims = []
    for c, _rank in claim_rows:
        rows = ev.get(c.id, [])
        if not can_view_claim(ctx.viewer, [src.acl for _, _, src in rows]):
            continue
        claims.append({"id": str(c.id), "text": mask_pii(c.text) if mask else c.text, "status": c.status,
                       "type_label": TYPE_LABELS.get(c.type, c.type), "superseded": bool(c.superseded_by),
                       "refs": list(dict.fromkeys(ref_for(*r) for r in rows))[:3]})
        if len(claims) >= MAX_CLAIMS:
            break

    # Source passages: GIN-indexed chunks.tsv, filtered by the source's access list.
    passages = []
    for ch, src, snippet in db.execute(
            select(Chunk, Source, func.ts_headline("english", Chunk.text, tsq,
                                                   "MaxWords=28, MinWords=12, StartSel=«, StopSel=», MaxFragments=1"))
            .join(Source, Source.id == Chunk.source_id)
            .where(Chunk.workspace_id == ws_id, Chunk.tsv.op("@@")(tsq))
            .order_by(func.ts_rank(Chunk.tsv, tsq).desc()).limit(MAX_PASSAGES * 3)):
        if not can_view_acl(ctx.viewer, src.acl):
            continue
        text = mask_pii(snippet) if mask else snippet
        passages.append({"chunk_id": str(ch.id), "source": src.name, "source_type": src.type, "snippet": text,
                         "ref": source_ref(ch.kind, ch.location or {}, ch.occurred_at, src.name, ch.text, None)})
        if len(passages) >= MAX_PASSAGES:
            break
    return {"q": q, "claims": claims, "passages": passages}


def _like(q: str) -> str:
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
