"""Live Slack connector against a fake Slack Web API: only channels the bot is in, private channel -> its members
only, unmatched people reported, bots skipped, secrets scrubbed, re-import updates in place, token never stored."""

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from baton.db.models import Chunk, Source, Visitor, Workspace
from baton.db.session import SessionLocal
from baton.demo_loader import build_demo_workspace
from baton.ingest import slack_api
from baton.ingest.slack_api import SlackUser, match_members
from baton.main import app
from baton.routers import slack_import

TOKEN = "xoxb-test-token-1234567890"
USERS = [
    {"id": "U1", "name": "rohan", "profile": {"display_name": "Rohan", "email": "rohan@club.test"}},
    {"id": "U2", "name": "neha", "profile": {"real_name": "Neha Kulkarni"}},
    {"id": "U3", "name": "deploybot", "is_bot": True, "profile": {"display_name": "deploybot"}},
    {"id": "U4", "name": "priya", "profile": {"display_name": "Priya", "email": "priya@club.test"}},
]
CHANNELS = [
    {"id": "C1", "name": "dev", "is_private": False, "is_member": True},
    {"id": "C2", "name": "leads", "is_private": True, "is_member": True},
    {"id": "C3", "name": "random", "is_private": False, "is_member": False},
]
HISTORY = {
    "C1": [{"ts": "1793000000.000100", "user": "U1", "text": "deploys go through the GitHub action; token ghp_abcdefghijklmnopqrstuvwxyz0123456789", "reply_count": 1},
           {"ts": "1793000100.000100", "user": "U3", "text": "build passed"}],
    "C2": [{"ts": "1793000200.000100", "user": "U1", "text": "sponsor budget is fifty thousand, keep it in leads"}],
}
REPLIES = {"1793000000.000100": [{"ts": "1793000000.000100", "user": "U1", "text": "parent"},
                                 {"ts": "1793000050.000100", "user": "U2", "text": "got it, I'll read the workflow", "thread_ts": "1793000000.000100"}]}
MEMBERS = {"C1": ["U1", "U2", "U3"], "C2": ["U1", "U4", "U3"]}


def fake_slack(request: httpx.Request) -> httpx.Response:
    assert request.headers["authorization"] == f"Bearer {TOKEN}"
    m, q = request.url.path.rsplit("/", 1)[-1], dict(request.url.params)
    body = {"ok": True}
    if m == "auth.test":
        body["team"] = "DevClub"
    elif m == "conversations.list":
        body["channels"] = CHANNELS
    elif m == "users.list":
        body["members"] = USERS
    elif m == "conversations.members":
        body["members"] = MEMBERS[q["channel"]]
    elif m == "conversations.history":
        body["messages"] = HISTORY[q["channel"]]
    elif m == "conversations.replies":
        body["messages"] = REPLIES.get(q["ts"], [])
    return httpx.Response(200, json=body, headers={"content-type": "application/json"})


@pytest.fixture
def fake(monkeypatch):
    real = slack_api.SlackClient
    monkeypatch.setattr(slack_import, "SlackClient", lambda token: real(token, transport=httpx.MockTransport(fake_slack)))


@pytest.fixture(scope="module")
def ws():
    with SessionLocal.begin() as db:
        db.merge(Visitor(id="slack-owner"))
        w = build_demo_workspace(db, template=False, name="pytest slack")
        w.synthetic = False
        w.visitor_id = "slack-owner"
        wid = str(w.id)
    yield wid
    with SessionLocal.begin() as db:
        db.execute(delete(Workspace).where(Workspace.id == wid))
        db.execute(delete(Visitor).where(Visitor.id == "slack-owner"))


def test_match_members_pure():
    users = {"U1": SlackUser("U1", "Rohan D", "rohan@club.test", False), "U2": SlackUser("U2", "Neha Kulkarni", None, False),
             "U4": SlackUser("U4", "Priya", "priya@club.test", False)}
    people = [{"id": "m1", "name": "Rohan", "handle": "rohan", "email": "rohan@club.test"}, {"id": "m2", "name": "Neha", "handle": "neha", "email": None}]
    assert match_members(["U1", "U2", "U4"], users, people) == (["m1", "m2"], ["Priya"])  # email, then first name


def test_import_end_to_end(ws, fake):
    c = TestClient(app)
    c.cookies.set("baton_visitor", "slack-owner")
    p = {m["handle"]: m["id"] for m in c.get(f"/api/workspaces/{ws}").json()["members"]}
    H = {"X-Baton-Persona": p["meera"]}
    assert c.post(f"/api/workspaces/{ws}/slack/channels", headers=H, json={"token": "not-a-bot-token"}).status_code == 422
    assert c.post(f"/api/workspaces/{ws}/slack/channels", headers={"X-Baton-Persona": p["neha"]}, json={"token": TOKEN}).status_code == 403
    ch = c.post(f"/api/workspaces/{ws}/slack/channels", headers=H, json={"token": TOKEN}).json()
    assert ch["team"] == "DevClub" and [x["name"] for x in ch["channels"]] == ["dev", "leads"]  # not #random: bot isn't in it
    r = c.post(f"/api/workspaces/{ws}/slack/import", headers=H, json={"token": TOKEN, "channel_ids": ["C1", "C2"]}).json()
    by = {x["name"]: x for x in r["imported"]}
    assert by["#dev"]["access"] == "All members" and by["#dev"]["secrets_removed"] == 1
    assert by["#leads"]["private"] and "Rohan" in by["#leads"]["access"] and "Neha" not in by["#leads"]["access"]
    assert by["#leads"]["unmatched"] == ["Priya"]
    db = SessionLocal()
    try:
        texts = " ".join(t for (t,) in db.execute(select(Chunk.text).join(Source, Source.id == Chunk.source_id)
                                                  .where(Source.workspace_id == ws, Source.name.in_(["#dev", "#leads"]))))
        assert "ghp_abcdefghijklmnopqrstuvwxyz" not in texts and "build passed" not in texts  # scrubbed; bot skipped
        assert "got it, I'll read the workflow" in texts  # thread replies included
        assert TOKEN not in str([s.meta for s in db.scalars(select(Source).where(Source.workspace_id == ws))])  # never stored
    finally:
        db.close()
    # Neha (not in #leads) can't see that source; re-import updates in place instead of duplicating
    names = {s["name"] for s in c.get(f"/api/workspaces/{ws}/sources", headers={"X-Baton-Persona": p["neha"]}).json()["sources"]}
    assert "#dev" in names and "#leads" not in names
    c.post(f"/api/workspaces/{ws}/slack/import", headers=H, json={"token": TOKEN, "channel_ids": ["C1"]})
    db = SessionLocal()
    try:
        assert db.scalar(select(Source).where(Source.workspace_id == ws, Source.name == "#dev").limit(2)) is not None
        assert len(list(db.scalars(select(Source).where(Source.workspace_id == ws, Source.name == "#dev")))) == 1
    finally:
        db.close()


def test_slack_errors_are_explained(ws, monkeypatch):
    real = slack_api.SlackClient
    bad = httpx.MockTransport(lambda req: httpx.Response(200, json={"ok": False, "error": "missing_scope", "provided": "channels:history,chat:write"},
                                                         headers={"content-type": "application/json"}))
    monkeypatch.setattr(slack_import, "SlackClient", lambda token: real(token, transport=bad))
    c = TestClient(app)
    c.cookies.set("baton_visitor", "slack-owner")
    p = {m["handle"]: m["id"] for m in c.get(f"/api/workspaces/{ws}").json()["members"]}
    r = c.post(f"/api/workspaces/{ws}/slack/channels", headers={"X-Baton-Persona": p["meera"]}, json={"token": TOKEN})
    assert r.status_code == 422 and "channels:read" in r.json()["detail"] and "channels:history" not in r.json()["detail"]
