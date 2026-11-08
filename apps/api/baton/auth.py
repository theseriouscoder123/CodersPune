"""Request context: visitor (cookie) -> workspace access -> acting persona (validated against memberships).

No login in Round 2 (DECISIONS D1). The browser sends `X-Baton-Persona: <member id>`; the server checks that the
member belongs to the workspace and loads their roles from the DB. Every ACL decision downstream uses this resolved
context, never anything the client claims about roles.
"""

from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from baton.acl import Viewer
from baton.db.models import Member, Membership, Visitor, Workspace
from baton.db.session import get_db

VISITOR_COOKIE = "baton_visitor"
PERSONA_HEADER = "X-Baton-Persona"


def get_or_create_visitor(request: Request, response: Response, db: Session) -> Visitor:
    vid = request.cookies.get(VISITOR_COOKIE)
    visitor = db.get(Visitor, vid) if vid else None
    if visitor is None:
        from baton.limits import client_ip

        visitor = Visitor(id=secrets.token_urlsafe(24), ip=client_ip(request))
        db.add(visitor)
        db.flush()
    response.set_cookie(VISITOR_COOKIE, visitor.id, max_age=60 * 60 * 24 * 30, httponly=True, samesite="lax",
                        secure=request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https")
    return visitor


@dataclass
class Ctx:
    workspace: Workspace
    member: Member
    roles: frozenset[str]
    visitor_id: str | None

    @property
    def viewer(self) -> Viewer:
        return Viewer(str(self.member.id), self.roles)

    @property
    def is_reviewer(self) -> bool:
        return "reviewer" in self.roles

    @property
    def is_admin(self) -> bool:
        return "admin" in self.roles

    @property
    def can_write(self) -> bool:
        """The shared template is read-only; visitors write only to their own sandbox."""
        return not self.workspace.is_demo_template and self.workspace.visitor_id == self.visitor_id


def _roles(db: Session, member_id, workspace_id) -> frozenset[str]:
    return frozenset(db.scalars(select(Membership.role).where(
        Membership.member_id == member_id, Membership.workspace_id == workspace_id)))


def workspace_ctx(workspace_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> Ctx:
    return resolve_ctx(db, request, workspace_id)


def resolve_ctx(db: Session, request: Request, workspace_id) -> Ctx:
    ws = db.get(Workspace, workspace_id)
    visitor_id = request.cookies.get(VISITOR_COOKIE)
    # Visible workspaces: the demo template (read-only) and the visitor's own sandbox / custom workspaces.
    if ws is None or not (ws.is_demo_template or (visitor_id and ws.visitor_id == visitor_id)):
        raise HTTPException(404, "Workspace not found")

    member = None
    persona = request.headers.get(PERSONA_HEADER)
    if persona:
        try:
            member = db.get(Member, uuid.UUID(persona))
        except ValueError:
            member = None
        if member is None or member.workspace_id != ws.id:
            raise HTTPException(403, "That persona is not a member of this workspace")
    if member is None:  # default persona: the workspace admin/reviewer
        member = db.scalars(
            select(Member).join(Membership, Membership.member_id == Member.id)
            .where(Membership.workspace_id == ws.id, Membership.role == "admin").limit(1)
        ).first()
    if member is None:
        raise HTTPException(409, "Workspace has no admin member")
    return Ctx(ws, member, _roles(db, member.id, ws.id), visitor_id)


def require_reviewer(ctx: Ctx = Depends(workspace_ctx)) -> Ctx:
    if not ctx.is_reviewer:
        raise HTTPException(403, "Only the reviewer can do this")
    return ctx


def require_admin(ctx: Ctx = Depends(workspace_ctx)) -> Ctx:
    if not ctx.is_admin:
        raise HTTPException(403, "Only the workspace admin can do this")
    return ctx
