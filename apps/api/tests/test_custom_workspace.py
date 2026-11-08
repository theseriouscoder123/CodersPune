"""S1 custom workspace creation: validation, server-side ACLs from the access picker, scrubbing, rate limit."""

import json

from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from baton.config import get_settings
from baton.db.models import Chunk, Run, Source, Workspace
from baton.db.session import SessionLocal
from baton.main import app

MEMBERS = [
    {"name": "Asha", "handle": "asha", "roles": ["reviewer"]},
    {"name": "Ben", "handle": "ben", "roles": ["leaver"]},
    {"name": "Cy", "handle": "cy", "roles": ["successor"]},
]
NOTE = b"# Sync 2026-05-01\n\nWe decided to use Postgres. DB_PASSWORD=supersecretvalue123\n"
CHAT = json.dumps([
    {"channel": "ops", "ts": "1714550000.0", "user": "U1", "user_profile": {"name": "asha"}, "text": "budget is 10k, keep quiet"},
]).encode()


def client(visitor):
    c = TestClient(app)
    c.cookies.set("baton_visitor", visitor)
    return c


def post(c, **over):
    data = {"name": "My project", "members": json.dumps(MEMBERS), "confirm_authorised": "true",
            "notes_access": "all", "chat_access": json.dumps(["ben"]), **over.pop("data", {})}
    files = over.pop("files", [("notes", ("sync.md", NOTE, "text/markdown")), ("chat", ("ops.json", CHAT, "application/json"))])
    return c.post("/api/workspaces", data=data, files=files)


def cleanup(visitor):
    with SessionLocal.begin() as db:
        db.execute(delete(Workspace).where(Workspace.visitor_id == visitor))


def test_create_with_notes_and_restricted_chat():
    v = "pytest-custom-1"
    cleanup(v)
    c = client(v)
    r = post(c)
    assert r.status_code == 200, r.text
    ws_id = r.json()["workspace_id"]
    with SessionLocal() as db:
        srcs = {s.name: s for s in db.scalars(select(Source).where(Source.workspace_id == ws_id))}
        assert set(srcs) == {"Uploaded notes", "#ops"}
        assert srcs["#ops"].acl["roles"] == ["reviewer"] and len(srcs["#ops"].acl["members"]) == 1
        assert srcs["Uploaded notes"].scrub_report == {"generic_secret": 1}
        assert all("supersecretvalue123" not in ch.text for ch in db.scalars(select(Chunk).where(Chunk.workspace_id == ws_id)))
        assert db.scalar(select(Run).where(Run.workspace_id == ws_id)).status == "queued"
    # Server-side ACL from the picker: the successor can't see the restricted channel; the leaver can.
    people = {m["handle"]: m["id"] for m in c.get(f"/api/workspaces/{ws_id}").json()["members"]}
    names = lambda pid: {s["name"] for s in c.get(f"/api/workspaces/{ws_id}/sources", headers={"X-Baton-Persona": pid}).json()["sources"]}
    assert names(people["cy"]) == {"Uploaded notes"}
    assert names(people["ben"]) == {"Uploaded notes", "#ops"}
    assert names(people["asha"]) == {"Uploaded notes", "#ops"}
    cleanup(v)


def test_validation_errors_are_clear():
    c = client("pytest-custom-2")
    assert "authorised" in post(c, data={"confirm_authorised": "false"}).json()["detail"]
    bad = [dict(MEMBERS[0]), dict(MEMBERS[1]), {"name": "Cy", "handle": "cy", "roles": ["member"]}]
    assert "successor" in post(c, data={"members": json.dumps(bad)}).json()["detail"]
    assert "GitHub" in post(c, data={"repo_url": "not a repo"}, files=[]).json()["detail"]
    assert "at least one source" in post(c, files=[]).json()["detail"]
    r = post(c, files=[("notes", ("evil.exe", b"x", "application/octet-stream"))])
    assert r.status_code == 422 and ".md" in r.json()["detail"]
    cleanup("pytest-custom-2")


def test_daily_limit_per_visitor():
    v = "pytest-custom-3"
    cleanup(v)
    c = client(v)
    limit = get_settings().custom_workspace_daily_limit
    for _ in range(limit):
        assert post(c).status_code == 200
    r = post(c)
    assert r.status_code == 429 and "Limit" in r.json()["detail"]
    cleanup(v)
