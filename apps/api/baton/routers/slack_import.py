"""Import channels from Slack directly (live connector). Admin only, in your own workspaces (not the synthetic demo).

The bot token is used for this request and never stored, like private GitHub tokens. A public channel becomes a
source open to all members; a private channel becomes a source restricted to its Slack members, matched to Baton
people by email, then by name. People who can't be matched are reported back, never guessed. Re-importing a channel
updates its source in place (unchanged passages keep their ids, so reviewed evidence survives).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from baton.acl import ALL_MEMBERS, access_label
from baton.auth import Ctx, workspace_ctx
from baton.db.models import AuditEvent, Member, Source
from baton.db.session import get_db
from baton.ingest.chat_export import parse_chat_export
from baton.ingest.service import store_chunks
from baton.ingest.slack_api import SlackClient, SlackError, match_members

router = APIRouter(prefix="/api", tags=["Slack"])
IMPORTS_PER_HOUR = 10


class TokenIn(BaseModel):
    token: str = Field(min_length=10, max_length=300)


class ImportIn(TokenIn):
    channel_ids: list[str] = Field(min_length=1, max_length=20)


def _guard(ctx: Ctx) -> None:
    if not ctx.is_admin:
        raise HTTPException(403, "Only the workspace admin can connect Slack")
    if not ctx.can_write:
        raise HTTPException(403, "This is the shared read-only template. Click 'Try the demo' to get your own copy.")
    if ctx.workspace.synthetic:
        raise HTTPException(409, "Slack import works in your own workspaces, not the synthetic demo. Start one from 'Start from your own repo'.")


def _client(token: str) -> SlackClient:
    try:
        return SlackClient(token.strip())
    except SlackError as exc:
        raise HTTPException(422, exc.user_message) from exc


@router.post("/workspaces/{workspace_id}/slack/channels")
def list_channels(body: TokenIn, ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    _guard(ctx)
    client = _client(body.token)
    try:
        team, channels = client.team(), client.channels()
    except SlackError as exc:
        raise HTTPException(422, exc.user_message) from exc
    finally:
        client.close()
    have = {(s.meta or {}).get("slack_channel_id") for s in db.scalars(select(Source).where(Source.workspace_id == ctx.workspace.id))}
    return {"team": team, "channels": [{"id": c.id, "name": c.name, "private": c.private, "imported": c.id in have} for c in channels]}


@router.post("/workspaces/{workspace_id}/slack/import")
def import_channels(body: ImportIn, ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    _guard(ctx)
    ws = ctx.workspace
    recent = db.scalar(select(func.count()).select_from(AuditEvent).where(
        AuditEvent.workspace_id == ws.id, AuditEvent.action == "slack_import", AuditEvent.created_at > datetime.now(UTC) - timedelta(hours=1)))
    if recent >= IMPORTS_PER_HOUR:
        raise HTTPException(429, "Lots of Slack imports this hour. Please try again later.")
    client = _client(body.token)
    try:
        users = client.users()
        wanted = set(body.channel_ids)
        chans = [client.fill(c, users) for c in client.channels() if c.id in wanted]
    except SlackError as exc:
        raise HTTPException(422, exc.user_message) from exc
    finally:
        client.close()
    if not chans:
        raise HTTPException(422, "None of those channels are available to the Baton app. Invite it with /invite @YourApp.")
    members = list(db.scalars(select(Member).where(Member.workspace_id == ws.id)))
    people = [{"id": str(m.id), "name": m.display_name, "handle": m.handle, "email": m.email} for m in members]
    names = {str(m.id): m.display_name for m in members}
    current = list(db.scalars(select(Source).where(Source.workspace_id == ws.id)))
    existing = {(s.meta or {}).get("slack_channel_id"): s for s in current if (s.meta or {}).get("slack_channel_id")}
    by_name = {s.name: s for s in current if s.type == "chat_export" and not (s.meta or {}).get("slack_channel_id")}
    out = []
    for ch in chans:
        matched, unmatched = match_members(ch.member_ids, users, people)
        acl = {"roles": [ALL_MEMBERS], "members": []} if not ch.private else {"roles": [], "members": matched}
        drafts = parse_chat_export(json.dumps(ch.messages), default_channel=ch.name).get(ch.name, [])
        # Same Slack channel imported before, or the same channel uploaded earlier as an export: update that source.
        src = existing.get(ch.id) or by_name.get(f"#{ch.name}")
        if src is None:
            src = Source(workspace_id=ws.id, type="chat_export", name=f"#{ch.name}", acl=acl)
            db.add(src)
            db.flush()
        else:
            src.acl = acl  # Slack membership is the source of truth for a private channel's access
        src.meta = {**(src.meta or {}), "channel": ch.name, "slack_channel_id": ch.id, "slack_private": ch.private,
                    "slack_imported_at": datetime.now(UTC).isoformat(), "slack_unmatched": unmatched[:50]}
        report = store_chunks(db, src, drafts)
        out.append({"source_id": str(src.id), "name": f"#{ch.name}", "private": ch.private, "messages": len(ch.messages),
                    "chunks": report["chunks"], "access": access_label(acl, names), "unmatched": unmatched,
                    "secrets_removed": report["redactions"]})
    db.add(AuditEvent(workspace_id=ws.id, actor_member_id=ctx.member.id, actor_role="admin", action="slack_import",
                      target=",".join(c.id for c in chans), after={"channels": [o["name"] for o in out]}))
    db.commit()
    return {"imported": out, "next": "Re-run the pipeline (Reconstruct → Re-run) to extract claims from the new messages."}
