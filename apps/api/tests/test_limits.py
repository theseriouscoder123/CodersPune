"""Abuse limits and garbage collection."""

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from baton.db.models import Visitor, Workspace
from baton.db.session import SessionLocal
from baton.limits import collect_garbage
from baton.main import app


def test_demo_start_reuses_sandbox_and_limits_per_ip(monkeypatch):
    ip = "203.0.113.77"
    c = TestClient(app, headers={"x-forwarded-for": ip})
    first = c.post("/api/demo/start")
    if first.status_code == 503:
        return  # template not seeded in this DB
    assert c.post("/api/demo/start").json()["workspace_id"] == first.json()["workspace_id"]  # same browser, same copy
    import baton.limits as limits

    monkeypatch.setattr(limits, "NEW_SANDBOXES_PER_IP_PER_HOUR", 1)
    stranger = TestClient(app, headers={"x-forwarded-for": ip})  # new browser on the same network
    assert stranger.post("/api/demo/start").status_code == 429
    assert c.post("/api/demo/reset").status_code == 429  # reset cooldown right after creation
    with SessionLocal.begin() as db:
        ids = select(Visitor.id).where(Visitor.ip == ip)
        db.execute(delete(Workspace).where(Workspace.visitor_id.in_(ids)))
        db.execute(delete(Visitor).where(Visitor.ip == ip))


def test_gc_deletes_only_stale_visitor_workspaces():
    old = datetime.now(UTC) - timedelta(days=9)
    with SessionLocal.begin() as db:
        db.add_all([Visitor(id="gc-old", last_seen_at=old), Visitor(id="gc-new")])
        db.flush()
        db.add_all([Workspace(name="gc old", visitor_id="gc-old", created_at=old),
                    Workspace(name="gc new", visitor_id="gc-new", created_at=old)])
    with SessionLocal.begin() as db:
        res = collect_garbage(db)
    with SessionLocal() as db:
        assert set(db.scalars(select(Workspace.name).where(Workspace.name.like("gc %")))) == {"gc new"}
        assert res["workspaces_deleted"] >= 1
    with SessionLocal.begin() as db:
        db.execute(delete(Workspace).where(Workspace.name.like("gc %")))
        db.execute(delete(Visitor).where(Visitor.id.in_(["gc-old", "gc-new"])))


def test_gc_endpoint_requires_secret(monkeypatch):
    c = TestClient(app)
    monkeypatch.delenv("CRON_SECRET", raising=False)
    assert c.get("/api/maintenance/gc").status_code == 401
    monkeypatch.setenv("CRON_SECRET", "s3cret")
    assert c.get("/api/maintenance/gc", headers={"authorization": "Bearer nope"}).status_code == 401
    assert c.get("/api/maintenance/gc", headers={"authorization": "Bearer s3cret"}).status_code == 200
