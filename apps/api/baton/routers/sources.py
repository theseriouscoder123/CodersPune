"""Source access lists, editable by the workspace admin (Round 3; needed by improvement #3's "withheld item assigned
to the successor" fix, and it closes the Round 2 gap where access could only be set at creation).

Visibility is computed from source ACLs at every read (trust rule 5), so a change applies at once everywhere,
including approved handovers: narrowing revokes immediately; widening reveals items the reviewer already approved
in that version but that were withheld for permissions. The UI says so before saving, and every change is audited.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from baton.acl import ALL_MEMBERS, access_label, acl_key, normalise_acl
from baton.auth import resolve_ctx
from baton.db.models import ROLES, AuditEvent, Chunk, Member, Source
from baton.db.session import get_db

router = APIRouter(prefix="/api", tags=["Sources"])

GRANTABLE_ROLES = tuple(r for r in ROLES if r != "admin") + (ALL_MEMBERS,)


class AclIn(BaseModel):
    roles: list[str] = Field(default_factory=list, max_length=8)
    members: list[uuid.UUID] = Field(default_factory=list, max_length=50)
    note: str | None = Field(default=None, max_length=300)


@router.get("/sources/{source_id}/acl")
def get_acl(source_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    src, ctx = _load(db, request, source_id)
    if not ctx.is_admin:
        raise HTTPException(403, "Only the workspace admin can see and change who can access a source")
    return _out(db, src)


@router.patch("/sources/{source_id}/acl")
def set_acl(source_id: uuid.UUID, body: AclIn, request: Request, db: Session = Depends(get_db)) -> dict:
    src, ctx = _load(db, request, source_id)
    if not ctx.is_admin:
        raise HTTPException(403, "Only the workspace admin can change who can access a source")
    if not ctx.can_write:
        raise HTTPException(403, "This is the shared read-only template. Click 'Try the demo' to get your own copy.")
    bad = sorted(set(body.roles) - set(GRANTABLE_ROLES))
    if bad:
        raise HTTPException(422, f"Unknown role: {', '.join(bad)}. Use one of: {', '.join(GRANTABLE_ROLES)}.")
    member_ids = {str(m) for m in db.scalars(select(Member.id).where(Member.workspace_id == src.workspace_id))}
    foreign = [str(m) for m in body.members if str(m) not in member_ids]
    if foreign:
        raise HTTPException(422, "Every person must be a member of this workspace.")
    # Row lock: two admins saving at once apply one after the other, and each audit row shows the true "before".
    db.execute(select(Source.id).where(Source.id == src.id).with_for_update())
    before = normalise_acl(src.acl)
    after = normalise_acl({"roles": body.roles, "members": [str(m) for m in body.members]})
    if before == after:
        return {**_out(db, src), "changed": False}
    src.acl = after
    src.acl_key = acl_key(after)
    db.execute(update(Chunk).where(Chunk.source_id == src.id).values(acl_key=src.acl_key))
    db.add(AuditEvent(workspace_id=src.workspace_id, actor_member_id=ctx.member.id, actor_role="admin",
                      action="source_acl", target=str(src.id), before=before, after=after,
                      note=(body.note or "").strip() or None))
    db.commit()
    return {**_out(db, src), "changed": True}


def _load(db: Session, request: Request, source_id: uuid.UUID):
    src = db.get(Source, source_id)
    if src is None:
        raise HTTPException(404, "Source not found")
    ctx = resolve_ctx(db, request, src.workspace_id)  # 404s for a workspace this visitor can't open
    return src, ctx


def _out(db: Session, src: Source) -> dict:
    members = list(db.scalars(select(Member).where(Member.workspace_id == src.workspace_id).order_by(Member.display_name)))
    names = {str(m.id): m.display_name for m in members}
    acl = normalise_acl(src.acl)
    return {
        "source": {"id": str(src.id), "name": src.name, "type": src.type},
        "acl": acl,
        "access": access_label(acl, names),
        "grantable_roles": list(GRANTABLE_ROLES),
        "members": [{"id": str(m.id), "name": m.display_name} for m in members],
    }
