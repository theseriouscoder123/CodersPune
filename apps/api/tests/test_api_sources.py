"""Server-side permission checks on the sources endpoint (trust rule 5)."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from baton.db.models import Workspace
from baton.db.session import SessionLocal
from baton.demo_loader import build_demo_workspace
from baton.main import app


@pytest.fixture(scope="module")
def ws():
    db = SessionLocal()
    # A visitor-owned (non-template) workspace so these tests never touch the seeded template.
    w = build_demo_workspace(db, template=False, name="pytest api")
    w.visitor_id = "pytest-visitor"
    db.commit()
    yield str(w.id)
    db.execute(delete(Workspace).where(Workspace.id == w.id))
    db.commit()
    db.close()


@pytest.fixture
def client():
    c = TestClient(app)
    c.cookies.set("baton_visitor", "pytest-visitor")
    return c


def personas(client, ws):
    body = client.get(f"/api/workspaces/{ws}").json()
    return {m["handle"]: m["id"] for m in body["members"]}


def names(client, ws, persona_id):
    r = client.get(f"/api/workspaces/{ws}/sources", headers={"X-Baton-Persona": persona_id})
    assert r.status_code == 200
    return {s["name"] for s in r.json()["sources"]}


def test_default_persona_is_admin_and_sees_all(client, ws):
    body = client.get(f"/api/workspaces/{ws}").json()
    assert "admin" in body["persona"]["roles"]
    assert body["synthetic"] is True
    r = client.get(f"/api/workspaces/{ws}/sources").json()["sources"]
    assert len(r) == 4
    core = next(s for s in r if s["name"] == "#core-team")
    assert core["restricted"] and core["access"] == "Reviewers, Kabir, Rohan"
    assert sum(s["redactions"] for s in r) == 2


def test_successor_cannot_see_core_team(client, ws):
    p = personas(client, ws)
    assert "#core-team" not in names(client, ws, p["neha"])
    assert "#core-team" in names(client, ws, p["kabir"])
    assert "#core-team" in names(client, ws, p["rohan"])


def test_foreign_persona_and_foreign_workspace_rejected(client, ws):
    assert client.get(f"/api/workspaces/{ws}/sources", headers={"X-Baton-Persona": "00000000-0000-0000-0000-000000000000"}).status_code == 403
    stranger = TestClient(app)  # different visitor, no cookie
    assert stranger.get(f"/api/workspaces/{ws}").status_code == 404
