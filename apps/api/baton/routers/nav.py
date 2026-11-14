"""GET /workspaces/{id}/nav: the live counts next to each workflow step in the sidebar (redesign). Every number is
computed under the viewer's permissions, exactly like the screens it summarises, so the sidebar can't leak a count."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from baton.acl import can_view_acl
from baton.auth import Ctx, workspace_ctx
from baton.db.models import Claim, Handover, HandoverVersion, Source
from baton.db.session import get_db
from baton.projection import claim_sources, visible
from baton.routers.acks import _counts, _effective, _successor_view

router = APIRouter(prefix="/api", tags=["Workspaces"])


@router.get("/workspaces/{workspace_id}/nav")
def nav(ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    ws = ctx.workspace
    srcs = list(db.scalars(select(Source).where(Source.workspace_id == ws.id)))
    out: dict = {"sources": {"visible": sum(1 for s in srcs if can_view_acl(ctx.viewer, s.acl)), "total": len(srcs)}}
    ledger = ctx.is_reviewer or ctx.is_admin or "leaver" in ctx.roles
    if ledger:
        claims = [c for c in db.scalars(select(Claim).where(Claim.workspace_id == ws.id)) if c.status != "rejected"]
        cited = claim_sources(db, [c.id for c in claims])
        claims = [c for c in claims if visible(ctx.viewer, cited.get(c.id, []))]
        live = [c for c in claims if not c.superseded_by]
        out["claims"] = len(live)
        out["to_review"] = sum(1 for c in live if c.review_state == "none")
    h = db.scalar(select(Handover).where(Handover.workspace_id == ws.id).order_by(Handover.created_at))
    if h is not None and (ctx.is_reviewer or ctx.member.id in (h.successor_member_id, h.leaver_member_id)):
        v = db.scalar(select(HandoverVersion).where(HandoverVersion.handover_id == h.id).order_by(HandoverVersion.version.desc()))
        info: dict = {"id": str(h.id), "version": v.version if v else None}
        if v is not None and (ctx.is_reviewer or ctx.member.id == h.successor_member_id):
            items = _successor_view(db, h, v)
            c = _counts(items, _effective(db, h, v, items))
            info["acks"] = {"done": c["acknowledged"] + c["not_mine"], "total": c["total"],
                            "questions_open": c["questions_open"], "questions_answered": c["questions_answered"]}
        out["handover"] = info
    return out
