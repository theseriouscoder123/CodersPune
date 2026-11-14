"""GET /workspaces/{id}/risk: knowledge risk per person (see baton/reconstruct/risk.py). Permissions first: only
claims and commit statistics the viewer may see go into the assessment, so the panel can't reveal restricted work."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from baton.acl import can_view_acl
from baton.auth import Ctx, workspace_ctx
from baton.db.models import Chunk, Claim, Handover, Member, Source
from baton.db.session import get_db
from baton.ingest.scrubber import mask_pii
from baton.ledger import evidence_rows, ref_for
from baton.projection import claim_sources, visible
from baton.reconstruct.risk import (
    HIGH,
    MEDIUM,
    SOLE_MIN_COMMITS,
    SOLE_SHARE,
    WEIGHTS,
    ClaimLite,
    assess,
    parse_stats,
)

router = APIRouter(prefix="/api", tags=["Knowledge risk"])


@router.get("/workspaces/{workspace_id}/risk")
def knowledge_risk(ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    if not (ctx.is_reviewer or ctx.is_admin):
        raise HTTPException(403, "Knowledge risk is a planning view for the reviewer and the workspace admin")
    ws_id = ctx.workspace.id
    pii = (lambda s: s) if ctx.is_reviewer else (lambda s: mask_pii(s) if s else s)
    files = []
    for ch, acl in db.execute(select(Chunk, Source.acl).join(Source, Source.id == Chunk.source_id)
                              .where(Chunk.workspace_id == ws_id, Chunk.kind == "commit_stats")):
        if can_view_acl(ctx.viewer, acl):
            files += parse_stats(ch.text)
    claims = list(db.scalars(select(Claim).where(Claim.workspace_id == ws_id, Claim.status != "rejected")))
    cited = claim_sources(db, [c.id for c in claims])
    claims = [c for c in claims if visible(ctx.viewer, cited.get(c.id, []))]
    ev = evidence_rows(db, [c.id for c in claims])
    by_id = {str(c.id): c for c in claims}
    lites = []
    for c in claims:
        rows = [(e, ch, s) for e, ch, s in ev.get(c.id, []) if e.quote_found and e.verdict == "supports"]
        authors: set[str] = set()
        unknown = not rows
        for _, ch, _ in rows:
            if not ch.author:
                unknown = True
                break
            authors |= {a.strip().lower() for a in ch.author.split(",") if a.strip()}
        lites.append(ClaimLite(id=str(c.id), type=c.type, text=c.text, status=c.status, origin=c.origin,
                               live=not c.superseded_by and not c.stale_reason,
                               authors=frozenset() if unknown else frozenset(authors),
                               signal=(c.meta or {}).get("signal") or ""))
    members = list(db.scalars(select(Member).where(Member.workspace_id == ws_id)))
    people = {m.handle.lower(): m.display_name for m in members}
    member_by_key = {m.handle.lower(): m for m in members}
    ranked, unowned = assess(files, lites, people)
    handovers = {h.leaver_member_id: h for h in db.scalars(select(Handover).where(Handover.workspace_id == ws_id))}

    def claim_out(cl: ClaimLite) -> dict:
        c = by_id[cl.id]
        return {"id": cl.id, "text": pii(c.text), "type": c.type, "status": c.status,
                "refs": list(dict.fromkeys(ref_for(*r) for r in ev.get(c.id, [])))[:2]}

    out = []
    for p in ranked:
        m = member_by_key.get(p.key)
        h = handovers.get(m.id) if m else None
        out.append({"key": p.key, "name": p.name, "member_id": str(m.id) if m else None, "in_workspace": m is not None,
                    "score": p.score, "level": p.level, "breakdown": p.breakdown,
                    "sole_files": p.sole_files, "open_tasks": [claim_out(c) for c in p.open_tasks],
                    "unanswered": [claim_out(c) for c in p.unanswered], "only_source": [claim_out(c) for c in p.only_source],
                    "handover_id": str(h.id) if h else None})
    return {"people": out, "unowned": [claim_out(c) for c in unowned],
            "rules": {"weights": WEIGHTS, "high": HIGH, "medium": MEDIUM, "sole_share": SOLE_SHARE, "sole_min_commits": SOLE_MIN_COMMITS}}
