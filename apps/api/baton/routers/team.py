"""Team management: per-member private invite links and locked identities (real use without full OAuth).

An invite link carries a random token; only its SHA-256 is stored. Opening the link binds that browser to one member.
In "invites" mode every request's identity comes from that binding on the server; persona switching is disabled.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from baton import notify
from baton.auth import Ctx, get_or_create_visitor, workspace_ctx
from baton.db.models import Member, MemberBinding, MemberInvite, Membership, Workspace
from baton.db.session import get_db

router = APIRouter(prefix="/api")


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _require_admin_writer(ctx: Ctx) -> None:
    if not ctx.is_admin:
        raise HTTPException(403, "Only the workspace admin can manage the team")
    if not ctx.can_write:
        raise HTTPException(403, "This is the shared read-only template. Click 'Try the demo' to get your own copy.")


@router.get("/workspaces/{workspace_id}/team")
def team(ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    if not (ctx.is_admin or ctx.is_reviewer):
        raise HTTPException(403, "Only the admin or reviewer can see team settings")
    ws = ctx.workspace
    roles: dict = {}
    for m_id, role in db.execute(select(Membership.member_id, Membership.role).where(Membership.workspace_id == ws.id)):
        roles.setdefault(m_id, []).append(role)
    active = {m for (m,) in db.execute(select(MemberInvite.member_id).where(
        MemberInvite.workspace_id == ws.id, MemberInvite.revoked_at.is_(None)))}
    joined = dict(db.execute(select(MemberBinding.member_id, func.count()).where(MemberBinding.workspace_id == ws.id)
                             .group_by(MemberBinding.member_id)).all())
    members = [{"id": str(m.id), "name": m.display_name, "handle": m.handle, "roles": sorted(roles.get(m.id, [])),
                "has_invite": m.id in active, "joined": joined.get(m.id, 0), "is_you": m.id == ctx.member.id,
                "email": m.email if ctx.is_admin else (notify.mask_email(m.email) if m.email else None)}
               for m in db.scalars(select(Member).where(Member.workspace_id == ws.id).order_by(Member.created_at))]
    hook = (ws.notify or {}).get("slack_webhook") or ""
    return {"identity_mode": ws.identity_mode, "members": members, "can_manage": ctx.is_admin and ctx.can_write,
            "notifications": {"email": notify.email_status(), "slack": {"set": bool(hook), "hint": notify.mask_webhook(hook)},
                              "recent": notify.recent(db, ws.id)}}


class EmailIn(BaseModel):
    email: str | None = Field(default=None, max_length=254)


@router.put("/workspaces/{workspace_id}/members/{member_id}/email")
def set_member_email(member_id: uuid.UUID, body: EmailIn, ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    """Optional address used only for notifications. Stored per workspace; demo copies start with none."""
    _require_admin_writer(ctx)
    m = db.get(Member, member_id)
    if m is None or m.workspace_id != ctx.workspace.id:
        raise HTTPException(404, "Member not found")
    addr = (body.email or "").strip()
    if addr and not notify.valid_email(addr):
        raise HTTPException(422, "That doesn't look like an email address.")
    m.email = addr or None
    db.commit()
    return {"email": m.email}


class SlackIn(BaseModel):
    slack_webhook: str | None = Field(default=None, max_length=300)


@router.put("/workspaces/{workspace_id}/notify")
def set_notify(body: SlackIn, ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    _require_admin_writer(ctx)
    url = (body.slack_webhook or "").strip()
    if url and not notify.valid_slack_webhook(url):
        raise HTTPException(422, "Paste a Slack incoming-webhook URL (it starts with https://hooks.slack.com/).")
    ws = ctx.workspace
    ws.notify = {**(ws.notify or {}), "slack_webhook": url or None}
    db.commit()
    return {"slack": {"set": bool(url), "hint": notify.mask_webhook(url)}}


class TestIn(BaseModel):
    channel: Literal["email", "slack"]


@router.post("/workspaces/{workspace_id}/notify/test")
def test_notify(body: TestIn, ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    _require_admin_writer(ctx)
    ws = ctx.workspace
    if body.channel == "slack":
        res = notify.send_slack(db, ws, event="test", title="Baton is connected",
                                lines=[f"Handover notifications for “{ws.name}” will appear here."], link=f"/w/{ws.id}/ledger")
    else:
        res = notify.send_email(db, ws, event="test", to=ctx.member.email, subject=f"Baton test email · {ws.name}",
                                heading="Email notifications work",
                                lines=[f"This is a test from the workspace “{ws.name}”."], link=f"/w/{ws.id}/ledger")
    db.commit()
    return res.as_dict()


@router.post("/workspaces/{workspace_id}/invites/{member_id}")
def create_invite(member_id: uuid.UUID, send_email: bool = False, ctx: Ctx = Depends(workspace_ctx),
                  db: Session = Depends(get_db)) -> dict:
    """Create (or rotate) a member's private link. The token is returned once and never stored."""
    _require_admin_writer(ctx)
    m = db.get(Member, member_id)
    if m is None or m.workspace_id != ctx.workspace.id:
        raise HTTPException(404, "Member not found")
    db.execute(update(MemberInvite).where(MemberInvite.member_id == m.id, MemberInvite.revoked_at.is_(None))
               .values(revoked_at=datetime.now(UTC)))
    token = secrets.token_urlsafe(24)
    db.add(MemberInvite(workspace_id=ctx.workspace.id, member_id=m.id, token_hash=_hash(token)))
    db.flush()
    emailed = None
    if send_email:  # optional: the link goes straight to their inbox (it is still shown once to the admin)
        emailed = notify.send_email(
            db, ctx.workspace, event="invite", to=m.email, subject=f"You're invited to “{ctx.workspace.name}” on Baton",
            heading=f"{ctx.member.display_name} invited you to a project handover",
            lines=[f"You've been added to “{ctx.workspace.name}” as {m.display_name}.",
                   "This link is personal: anyone who opens it is signed in as you. Don't forward it."],
            link=f"/join/{token}", link_label="Open my workspace").as_dict()
    db.commit()
    return {"path": f"/join/{token}", "member": m.display_name, "emailed": emailed}


@router.delete("/workspaces/{workspace_id}/invites/{member_id}")
def revoke_invite(member_id: uuid.UUID, ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    """Revoke the link and sign out everyone who joined as this member (except the admin themself)."""
    _require_admin_writer(ctx)
    db.execute(update(MemberInvite).where(MemberInvite.workspace_id == ctx.workspace.id, MemberInvite.member_id == member_id,
                                          MemberInvite.revoked_at.is_(None)).values(revoked_at=datetime.now(UTC)))
    db.execute(delete(MemberBinding).where(MemberBinding.workspace_id == ctx.workspace.id, MemberBinding.member_id == member_id,
                                           MemberBinding.visitor_id != (ctx.visitor_id or "")))
    db.commit()
    return {"revoked": True}


class IdentityIn(BaseModel):
    mode: Literal["switcher", "invites"]


@router.patch("/workspaces/{workspace_id}/identity")
def set_identity(body: IdentityIn, ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    _require_admin_writer(ctx)
    ws = ctx.workspace
    if ws.synthetic and body.mode == "invites" and ws.sandbox_of is None:
        raise HTTPException(422, "The demo template can't be locked")
    if body.mode == "invites" and ctx.visitor_id:
        # The admin keeps access: bind their browser to the admin member they're acting as.
        existing = db.get(MemberBinding, (ctx.visitor_id, ws.id))
        if existing is None:
            db.add(MemberBinding(visitor_id=ctx.visitor_id, workspace_id=ws.id, member_id=ctx.member.id))
        else:
            existing.member_id = ctx.member.id
    ws.identity_mode = body.mode
    db.commit()
    return {"identity_mode": ws.identity_mode}


@router.post("/join/{token}")
def join(token: str, request: Request, response: Response, db: Session = Depends(get_db)) -> dict:
    inv = db.scalar(select(MemberInvite).where(MemberInvite.token_hash == _hash(token), MemberInvite.revoked_at.is_(None)))
    if inv is None:
        raise HTTPException(404, "This invite link is invalid or has been revoked. Ask the workspace admin for a new one.")
    visitor = get_or_create_visitor(request, response, db)
    b = db.get(MemberBinding, (visitor.id, inv.workspace_id))
    if b is None:
        db.add(MemberBinding(visitor_id=visitor.id, workspace_id=inv.workspace_id, member_id=inv.member_id))
    else:
        b.member_id = inv.member_id
    ws = db.get(Workspace, inv.workspace_id)
    m = db.get(Member, inv.member_id)
    db.commit()
    return {"workspace_id": str(ws.id), "workspace": ws.name, "member_id": str(m.id), "member": m.display_name}
