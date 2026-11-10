"""Workspace data ownership: full JSON export and permanent deletion.

Export is for the admin/reviewer (they can already see everything in it). Secrets were scrubbed before storage, so
the export never contains them; invite-token hashes, browser bindings and notification logs are left out.
Deletion is owner + admin only, requires typing the workspace name, and cascades through every table.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from baton.auth import Ctx, workspace_ctx
from baton.db.models import (
    Chunk,
    Claim,
    ConflictGroup,
    Evidence,
    Handover,
    HandoverVersion,
    Member,
    Membership,
    ReviewEvent,
    Source,
    Visitor,
    Workspace,
)
from baton.db.session import get_db

router = APIRouter(prefix="/api", tags=["Workspaces"])

EXPORT_FORMAT = "baton-workspace-export/1"


def _iso(d):
    return d.isoformat() if d else None


@router.get("/workspaces/{workspace_id}/export.json")
def export_workspace(ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> Response:
    if not (ctx.is_admin or ctx.is_reviewer):
        raise HTTPException(403, "Only the workspace admin or reviewer can export its data")
    ws = ctx.workspace
    wid = ws.id
    members = list(db.scalars(select(Member).where(Member.workspace_id == wid)))
    roles: dict = {}
    for mid, role in db.execute(select(Membership.member_id, Membership.role).where(Membership.workspace_id == wid)):
        roles.setdefault(mid, []).append(role)
    claims = list(db.scalars(select(Claim).where(Claim.workspace_id == wid)))
    claim_ids = [c.id for c in claims]
    data = {
        "format": EXPORT_FORMAT, "exported_at": datetime.now(UTC).isoformat(), "exported_by": ctx.member.display_name,
        "workspace": {"id": str(wid), "name": ws.name, "synthetic": ws.synthetic, "created_at": _iso(ws.created_at)},
        "members": [{"id": str(m.id), "name": m.display_name, "handle": m.handle, "roles": sorted(roles.get(m.id, [])),
                     **({"email": m.email} if ctx.is_admin and m.email else {})} for m in members],
        "sources": [{"id": str(s.id), "type": s.type, "name": s.name, "uri": s.uri, "access": s.acl,
                     "redactions": s.scrub_report, "ingested_at": _iso(s.ingested_at)}
                    for s in db.scalars(select(Source).where(Source.workspace_id == wid))],
        "chunks": [{"id": str(c.id), "source_id": str(c.source_id), "kind": c.kind, "location": c.location,
                    "author": c.author, "occurred_at": _iso(c.occurred_at), "text": c.text}
                   for c in db.scalars(select(Chunk).where(Chunk.workspace_id == wid))],
        "claims": [{"id": str(c.id), "type": c.type, "text": c.text, "status": c.status, "status_reason": c.status_reason,
                    "origin": c.origin, "review_state": c.review_state, "reviewer_note": c.reviewer_note,
                    "subject_key": c.subject_key, "value": c.value, "occurred_at": _iso(c.occurred_at),
                    "superseded_by": str(c.superseded_by) if c.superseded_by else None,
                    "conflict_group_id": str(c.conflict_group_id) if c.conflict_group_id else None} for c in claims],
        "evidence": [{"id": str(e.id), "claim_id": str(e.claim_id), "chunk_id": str(e.chunk_id), "quote": e.quote,
                      "quote_found": e.quote_found, "match_score": e.match_score, "verdict": e.verdict,
                      "verdict_reason": e.verdict_reason}
                     for e in db.scalars(select(Evidence).where(Evidence.claim_id.in_(claim_ids)))] if claim_ids else [],
        "conflicts": [{"id": str(g.id), "subject_key": g.subject_key, "resolved": g.resolved}
                      for g in db.scalars(select(ConflictGroup).where(ConflictGroup.workspace_id == wid))],
        "review_events": [{"claim_id": str(r.claim_id), "actor_member_id": str(r.actor_member_id) if r.actor_member_id else None,
                           "role": r.actor_role, "action": r.action, "note": r.note, "at": _iso(r.created_at)}
                          for r in db.scalars(select(ReviewEvent).where(ReviewEvent.claim_id.in_(claim_ids)))] if claim_ids else [],
        "handovers": [],
    }
    for h in db.scalars(select(Handover).where(Handover.workspace_id == wid)):
        data["handovers"].append({
            "id": str(h.id), "name": h.name, "leaver_member_id": str(h.leaver_member_id) if h.leaver_member_id else None,
            "successor_member_id": str(h.successor_member_id) if h.successor_member_id else None, "scope": h.scope,
            "versions": [{"version": v.version, "approved_at": _iso(v.approved_at), "note": v.note, "snapshot": v.snapshot}
                         for v in db.scalars(select(HandoverVersion).where(HandoverVersion.handover_id == h.id)
                                             .order_by(HandoverVersion.version))],
        })
    slug = "".join(ch if ch.isalnum() else "-" for ch in ws.name.lower()).strip("-")[:40] or "workspace"
    return Response(json.dumps(data, ensure_ascii=False, indent=1), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="baton-{slug}-{datetime.now(UTC):%Y%m%d}.json"'})


class DeleteIn(BaseModel):
    confirm_name: str = Field(max_length=120)


@router.delete("/workspaces/{workspace_id}")
def delete_workspace(body: DeleteIn, ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    ws = ctx.workspace
    if ws.is_demo_template:
        raise HTTPException(403, "The shared demo template can't be deleted")
    if not (ctx.is_owner and ctx.is_admin):
        raise HTTPException(403, "Only the person who created this workspace, acting as its admin, can delete it")
    if body.confirm_name.strip() != ws.name:
        raise HTTPException(422, "Type the workspace name exactly to confirm")
    db.execute(Visitor.__table__.update().where(Visitor.sandbox_workspace_id == ws.id).values(sandbox_workspace_id=None))
    db.execute(delete(Workspace).where(Workspace.id == ws.id))  # ON DELETE CASCADE removes everything else
    db.commit()
    return {"deleted": True}
