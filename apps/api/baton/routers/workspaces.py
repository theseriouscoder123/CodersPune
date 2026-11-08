from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from baton.acl import access_label, can_view_acl
from baton.auth import Ctx, get_or_create_visitor, workspace_ctx
from baton.db.models import Member, Membership, Source, Workspace
from baton.db.session import get_db

router = APIRouter(prefix="/api")

SOURCE_KIND_LABELS = {
    "file": "files", "commit": "commit groups", "commit_stats": "ownership stats", "pr": "pull requests",
    "pr_comment": "review comments", "issue": "issues", "issue_comment": "comments", "note_para": "note sections",
    "chat_thread": "threads",
}


@router.post("/demo/start")
def demo_start(request: Request, response: Response, db: Session = Depends(get_db)) -> dict:
    """Return this visitor's demo workspace. (M1: the shared read-only template; M3: a per-visitor sandbox clone.)"""
    visitor = get_or_create_visitor(request, response, db)
    template = db.scalars(select(Workspace).where(Workspace.is_demo_template.is_(True))
                          .order_by(Workspace.created_at.desc()).limit(1)).first()
    if template is None:
        db.commit()
        raise HTTPException(503, "The demo workspace hasn't been seeded yet.")
    visitor.sandbox_workspace_id = template.id
    db.commit()
    return {"workspace_id": str(template.id), "sandbox": False}


def _members(db: Session, ws_id) -> list[dict]:
    roles: dict = defaultdict(list)
    for m_id, role in db.execute(select(Membership.member_id, Membership.role).where(Membership.workspace_id == ws_id)):
        roles[m_id].append(role)
    order = {"admin": 0, "reviewer": 0, "leaver": 1, "successor": 2, "member": 3}
    ms = db.scalars(select(Member).where(Member.workspace_id == ws_id))
    out = [{"id": str(m.id), "name": m.display_name, "handle": m.handle, "color": m.avatar_color,
            "roles": sorted(roles[m.id], key=lambda r: order.get(r, 9))} for m in ms]
    return sorted(out, key=lambda m: min(order.get(r, 9) for r in m["roles"] or ["member"]))


@router.get("/workspaces/{workspace_id}")
def get_workspace(ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    ws = ctx.workspace
    return {
        "id": str(ws.id),
        "name": ws.name,
        "synthetic": ws.synthetic,
        "read_only": not ctx.can_write,
        "members": _members(db, ws.id),
        "persona": {"id": str(ctx.member.id), "name": ctx.member.display_name, "roles": sorted(ctx.roles)},
    }


@router.get("/workspaces/{workspace_id}/sources")
def list_sources(ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    names = {str(m.id): m.display_name for m in db.scalars(select(Member).where(Member.workspace_id == ctx.workspace.id))}
    sources = db.scalars(select(Source).where(Source.workspace_id == ctx.workspace.id).order_by(Source.created_at))
    visible = []
    for s in sources:
        if not can_view_acl(ctx.viewer, s.acl):  # server-side filter (trust rule 5)
            continue
        kinds = (s.meta or {}).get("chunk_kinds", {})
        visible.append({
            "id": str(s.id),
            "type": s.type,
            "name": s.name,
            "uri": s.uri,
            "access": access_label(s.acl, names),
            "restricted": "all_members" not in (s.acl or {}).get("roles", []),
            "chunk_count": (s.meta or {}).get("chunk_count", 0),
            "items": [{"kind": k, "label": SOURCE_KIND_LABELS.get(k, k), "count": n} for k, n in sorted(kinds.items())],
            "files": (s.meta or {}).get("files"),
            "redactions": sum((s.scrub_report or {}).values()),
            "scrub_report": s.scrub_report or {},
            "synthetic": bool((s.meta or {}).get("synthetic")),
            "ingested_at": s.ingested_at.isoformat() if s.ingested_at else None,
        })
    return {"sources": visible}
