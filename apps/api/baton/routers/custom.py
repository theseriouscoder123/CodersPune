"""S1: create a workspace from any public GitHub repo + uploaded notes + a chat export, then start a run.

Uploads and chat are parsed (and scrubbed) immediately; the GitHub repo is fetched by the pipeline's ingest step so
the request returns fast and the work is resumable. Rate-limited per visitor (CUSTOM_WORKSPACE_DAILY_LIMIT/day).
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field, ValidationError, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from baton.auth import get_or_create_visitor
from baton.config import get_settings
from baton.db.models import Member, Membership, Source, Workspace
from baton.db.session import get_db
from baton.ingest.chat_export import ChatExportError, parse_chat_export
from baton.ingest.github import GitHubError, parse_repo
from baton.ingest.service import store_chunks
from baton.ingest.uploads import MAX_UPLOAD_BYTES, UploadRejected, parse_upload
from baton.pipeline import create_run

router = APIRouter(prefix="/api")

COLORS = ["#14213d", "#2b5b88", "#1f6f4a", "#b5531a", "#8a5a06", "#0e7490", "#6d4c41", "#3f5f3a"]
MAX_FILES = 10
MAX_MEMBERS = 12


class MemberIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    handle: str = Field(min_length=1, max_length=40, description="their GitHub username, used to match commits/PRs")
    roles: list[str] = Field(max_length=4)

    @field_validator("handle")
    @classmethod
    def _handle(cls, v: str) -> str:
        v = v.strip().lstrip("@").lower()
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", v):
            raise ValueError("handles may contain letters, numbers and dashes")
        return v

    @field_validator("roles")
    @classmethod
    def _roles(cls, v: list[str]) -> list[str]:
        ok = {"reviewer", "leaver", "successor", "member"}
        bad = set(v) - ok
        if bad:
            raise ValueError(f"unknown roles: {', '.join(sorted(bad))}")
        return sorted(set(v) | {"member"} if "reviewer" not in v else set(v))


def _acl(spec: str | None, ids: dict[str, str]) -> dict:
    """'all' (default) -> every member; otherwise a JSON list of handles (reviewers can always read everything)."""
    if not spec or spec == "all":
        return {"roles": ["all_members"], "members": []}
    try:
        handles = json.loads(spec)
    except json.JSONDecodeError as exc:
        raise HTTPException(422, "Access must be 'all' or a list of member handles") from exc
    unknown = [h for h in handles if h not in ids]
    if unknown:
        raise HTTPException(422, f"Unknown members in access list: {', '.join(unknown)}")
    return {"roles": ["reviewer"], "members": sorted(ids[h] for h in handles)}


@router.post("/workspaces")
async def create_workspace(
    request: Request, response: Response, db: Session = Depends(get_db),
    name: str = Form(..., max_length=80),
    members: str = Form(..., max_length=6000),
    repo_url: str | None = Form(None, max_length=300),
    repo_access: str | None = Form("all", max_length=2000),
    notes_access: str | None = Form("all", max_length=2000),
    chat_access: str | None = Form("all", max_length=2000),
    notes: list[UploadFile] | None = File(None),
    chat: UploadFile | None = File(None),
    confirm_authorised: bool = Form(False),
    github_token: str | None = Form(None, max_length=255),
) -> dict:
    s = get_settings()
    notes = [f for f in (notes or []) if f.filename]
    visitor = get_or_create_visitor(request, response, db)
    if not confirm_authorised:
        raise HTTPException(422, "Please confirm you are authorised to use these sources.")
    since = datetime.now(UTC) - timedelta(days=1)
    made = db.scalar(select(func.count()).select_from(Workspace).where(
        Workspace.visitor_id == visitor.id, Workspace.sandbox_of.is_(None), Workspace.created_at > since))
    from baton.limits import check_custom, client_ip

    check_custom(db, client_ip(request))
    if made >= s.custom_workspace_daily_limit:
        raise HTTPException(429, f"Limit reached: {s.custom_workspace_daily_limit} custom workspaces per visitor per day.")
    if not s.llm_configured:
        raise HTTPException(503, "AI pipeline unavailable: no LLM key is configured on the server. The demo still works.")

    try:
        people = [MemberIn(**m) for m in json.loads(members)]
    except (json.JSONDecodeError, TypeError, ValidationError) as exc:
        raise HTTPException(422, f"Members are invalid: {str(exc)[:200]}") from exc
    if not 2 <= len(people) <= MAX_MEMBERS:
        raise HTTPException(422, f"Add between 2 and {MAX_MEMBERS} members.")
    for role in ("reviewer", "leaver", "successor"):
        n = sum(role in p.roles for p in people)
        if n != 1:
            raise HTTPException(422, f"Exactly one member must be the {role} (found {n}).")
    if len({p.handle for p in people}) != len(people):
        raise HTTPException(422, "Member handles must be unique.")

    repo = repo_url.strip() if repo_url and repo_url.strip() else None
    if repo:
        try:
            parse_repo(repo)
        except GitHubError as exc:
            raise HTTPException(422, exc.args[0]) from exc
    if not repo and not notes and chat is None:
        raise HTTPException(422, "Add at least one source: a GitHub repo, notes or a chat export.")
    if len(notes) > MAX_FILES:
        raise HTTPException(422, f"Upload at most {MAX_FILES} note files.")

    # Parse files before writing anything, so a bad file never leaves a half-made workspace.
    note_drafts = []
    for f in notes:
        data = await f.read(MAX_UPLOAD_BYTES + 1)
        try:
            note_drafts.extend(parse_upload(f.filename or "notes.md", data))
        except UploadRejected as exc:
            raise HTTPException(422, str(exc)) from exc
    channels = {}
    if chat is not None:
        data = await chat.read(MAX_UPLOAD_BYTES * 2 + 1)
        if len(data) > MAX_UPLOAD_BYTES * 2:
            raise HTTPException(422, "Chat export is larger than 4 MB.")
        try:
            channels = parse_chat_export(data, default_channel=(chat.filename or "chat").rsplit(".", 1)[0])
        except ChatExportError as exc:
            raise HTTPException(422, str(exc)) from exc
        if not channels:
            raise HTTPException(422, "The chat export contains no messages.")

    ws = Workspace(name=name.strip(), visitor_id=visitor.id, synthetic=False)
    db.add(ws)
    db.flush()
    ids: dict[str, str] = {}
    for i, p in enumerate(people):
        m = Member(workspace_id=ws.id, display_name=p.name.strip(), handle=p.handle, avatar_color=COLORS[i % len(COLORS)])
        db.add(m)
        db.flush()
        ids[p.handle] = str(m.id)
        for r in set(p.roles) | ({"admin"} if "reviewer" in p.roles else set()):
            db.add(Membership(member_id=m.id, workspace_id=ws.id, role=r))

    if repo:
        owner, rname = parse_repo(repo)
        src = Source(workspace_id=ws.id, type="github_repo", name=f"{owner}/{rname}",
                     uri=f"https://github.com/{owner}/{rname}", acl=_acl(repo_access, ids), meta={"pending": True})
        db.add(src)
        db.flush()
        token = (github_token or "").strip()
        if token:
            # Private repo: read it now with the visitor's token, then forget the token (never stored or logged).
            from baton.ingest.github import fetch_repo
            from baton.ingest.github_normalise import normalise

            try:
                data = fetch_repo(repo, user_token=token)
            except GitHubError as exc:
                db.rollback()
                raise HTTPException(422, f"GitHub: {exc.args[0]}") from exc
            finally:
                token = ""
            drafts, meta = normalise(data)
            src.meta = {**meta, "private": bool(data.repo.get("private")), "repo": data.repo.get("full_name")}
            store_chunks(db, src, drafts)
    if note_drafts:
        src = Source(workspace_id=ws.id, type="upload", name="Uploaded notes", acl=_acl(notes_access, ids),
                     meta={"files": [f.filename for f in notes]})
        db.add(src)
        db.flush()
        store_chunks(db, src, note_drafts)
    for channel, drafts in channels.items():
        src = Source(workspace_id=ws.id, type="chat_export", name=f"#{channel}", acl=_acl(chat_access, ids),
                     meta={"channel": channel})
        db.add(src)
        db.flush()
        store_chunks(db, src, drafts)
    db.flush()
    run = create_run(db, ws.id)
    db.commit()
    from baton.notify import operator_feed  # optional server-wide Slack feed; no-op without SLACK_WEBHOOK_URL

    operator_feed(f"New custom workspace on Baton: '{ws.name}' ({len(people)} members)")
    return {"workspace_id": str(ws.id), "run_id": str(run.id)}
