"""Optional email/Slack notifications: off by default, never break actions, never leak restricted text, no SSRF."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from baton import notify
from baton.config import Settings
from baton.db.models import Handover, Member, Membership, Notification, Visitor, Workspace
from baton.db.session import SessionLocal
from baton.demo_loader import build_demo_workspace
from baton.main import app


@pytest.fixture(scope="module")
def ws():
    with SessionLocal.begin() as db:
        db.merge(Visitor(id="notify-owner"))
        w = build_demo_workspace(db, template=False, name="pytest notify")
        w.synthetic = False
        w.visitor_id = "notify-owner"
        wid = str(w.id)
    yield wid
    with SessionLocal.begin() as db:
        db.execute(delete(Workspace).where(Workspace.id == wid))
        db.execute(delete(Visitor).where(Visitor.id == "notify-owner"))


@pytest.fixture
def outbox(monkeypatch):
    sent = {"email": [], "slack": []}
    monkeypatch.setattr(notify, "_smtp_send", lambda msg: sent["email"].append(msg))
    monkeypatch.setattr(notify, "_slack_post", lambda url, payload: sent["slack"].append((url, payload)))
    return sent


@pytest.fixture
def email_on(monkeypatch):
    s = Settings(smtp_user="baton.bot@gmail.com", smtp_password="app-password-xyz", app_url="https://baton.test")
    monkeypatch.setattr(notify, "get_settings", lambda: s)
    return s


def owner():
    c = TestClient(app)
    c.cookies.set("baton_visitor", "notify-owner")
    return c


def members(c, ws):
    return {m["handle"]: m["id"] for m in c.get(f"/api/workspaces/{ws}").json()["members"]}


def test_validation_and_masking():
    assert notify.valid_email("neha@example.com") and not notify.valid_email("neha@") and not notify.valid_email("a b@x.io")
    assert notify.valid_slack_webhook("https://hooks.slack.com/services/T000/B000/abcdefghijkl")
    for bad in ("http://hooks.slack.com/services/T0/B0/abcdefghij", "https://hooks.slack.com.evil.io/services/T0/B0/abcdefghij",
                "https://169.254.169.254/latest/meta-data", "https://example.com/hooks.slack.com/services/x"):
        assert not notify.valid_slack_webhook(bad), bad
    assert notify.mask_email("neha.sharma@gmail.com") == "ne***@gmail.com"
    assert notify.mask_webhook("https://hooks.slack.com/services/T/B/abcd1234") == "hooks.slack.com/…1234"


def test_everything_works_when_not_configured(ws, outbox, monkeypatch):
    monkeypatch.setattr(notify, "get_settings", lambda: Settings(smtp_user="", smtp_password=""))
    c = owner()
    m = members(c, ws)
    r = c.post(f"/api/workspaces/{ws}/invites/{m['neha']}?send_email=true")
    assert r.status_code == 200 and r.json()["path"].startswith("/join/")
    assert r.json()["emailed"]["status"] == "skipped"
    assert c.post(f"/api/workspaces/{ws}/notify/test", json={"channel": "slack"}).json()["status"] == "skipped"
    t = c.get(f"/api/workspaces/{ws}/team").json()["notifications"]
    assert t["email"]["configured"] in (True, False) and t["slack"]["set"] is False
    assert outbox == {"email": [], "slack": []}


def test_slack_webhook_must_be_slack(ws, outbox):
    c = owner()
    assert c.put(f"/api/workspaces/{ws}/notify", json={"slack_webhook": "https://169.254.169.254/x"}).status_code == 422
    hook = "https://hooks.slack.com/services/T000/B000/abcdefghijkl"
    r = c.put(f"/api/workspaces/{ws}/notify", json={"slack_webhook": hook})
    assert r.status_code == 200 and r.json()["slack"]["hint"].endswith("ijkl")
    assert hook not in c.get(f"/api/workspaces/{ws}/team").text  # the full webhook is never sent back
    assert c.post(f"/api/workspaces/{ws}/notify/test", json={"channel": "slack"}).json()["status"] == "sent"
    assert outbox["slack"][0][0] == hook


def test_invite_email_and_masked_log(ws, outbox, email_on):
    c = owner()
    m = members(c, ws)
    assert c.put(f"/api/workspaces/{ws}/members/{m['neha']}/email", json={"email": "not-an-email"}).status_code == 422
    assert c.put(f"/api/workspaces/{ws}/members/{m['neha']}/email", json={"email": "neha@example.com"}).status_code == 200
    r = c.post(f"/api/workspaces/{ws}/invites/{m['neha']}?send_email=true").json()
    assert r["emailed"]["status"] == "sent"
    msg = outbox["email"][-1]
    token = r["path"].split("/join/")[1]
    assert msg["To"] == "neha@example.com" and f"https://baton.test/join/{token}" in msg.get_body(("plain",)).get_content()
    with SessionLocal() as db:
        logs = list(db.scalars(select(Notification).where(Notification.workspace_id == ws, Notification.event == "invite")))
        assert logs and all(n.recipient == "ne***@example.com" for n in logs) and all(token not in (n.detail or "") for n in logs)


def test_smtp_failure_never_breaks_the_action(ws, monkeypatch, email_on):
    def boom(msg):
        raise OSError("smtp down")

    monkeypatch.setattr(notify, "_smtp_send", boom)
    c = owner()
    m = members(c, ws)
    r = c.post(f"/api/workspaces/{ws}/invites/{m['neha']}?send_email=true")
    assert r.status_code == 200 and r.json()["emailed"]["status"] == "failed"


def test_approval_notice_has_no_claim_text(ws, outbox, email_on):
    from baton.routers.handovers import _notify_approved

    with SessionLocal.begin() as db:
        ids = {m.handle: m for m in db.scalars(select(Member).where(Member.workspace_id == ws))}
        ids["neha"].email = "neha@example.com"
        ids["rohan"].email = "rohan@example.com"
        db.add(Handover(workspace_id=ws, leaver_member_id=ids["rohan"].id, successor_member_id=ids["neha"].id))
    with SessionLocal() as db:
        h = db.scalar(select(Handover).where(Handover.workspace_id == ws))
        out = _notify_approved(db, h, 1, "Meera")
    to = {e["To"] for e in outbox["email"]}
    assert {"neha@example.com", "rohan@example.com"} <= to
    assert {o["to"] for o in out} >= {"Neha", "Rohan"}
    for e in outbox["email"]:
        body = e.get_body(("plain",)).get_content()
        assert "TechNova" not in body and "40,000" not in body  # names + link only, never claim text


def test_template_never_sends(outbox, email_on):
    with SessionLocal() as db:
        tpl = db.scalar(select(Workspace).where(Workspace.is_demo_template.is_(True)))
        if tpl is None:
            pytest.skip("no template in this database")
        r = notify.send_email(db, tpl, event="x", to="a@b.io", subject="s", heading="h", lines=[])
        assert r.status == "skipped" and outbox["email"] == []
        db.rollback()


def test_member_roles_present(ws):
    with SessionLocal() as db:  # sanity: the fixture has a leaver for the questions endpoint
        assert db.scalar(select(Membership).where(Membership.workspace_id == ws, Membership.role == "leaver")) is not None
