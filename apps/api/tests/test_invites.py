"""Per-member invite links and locked identities: the server, not the browser, decides who you are."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from baton.db.models import MemberInvite, Visitor, Workspace
from baton.db.session import SessionLocal
from baton.demo_loader import build_demo_workspace
from baton.main import app


@pytest.fixture(scope="module")
def ws():
    with SessionLocal.begin() as db:
        db.merge(Visitor(id="inv-owner"))
        w = build_demo_workspace(db, template=False, name="pytest invites")
        w.synthetic = False
        w.visitor_id = "inv-owner"
        wid = str(w.id)
    yield wid
    with SessionLocal.begin() as db:
        db.execute(delete(Workspace).where(Workspace.id == wid))
        db.execute(delete(Visitor).where(Visitor.id.in_(["inv-owner"])))


def client(cookie=None):
    c = TestClient(app)
    if cookie:
        c.cookies.set("baton_visitor", cookie)
    return c


def test_invite_join_binds_persona_and_blocks_impersonation(ws):
    owner = client("inv-owner")
    members = {m["handle"]: m["id"] for m in owner.get(f"/api/workspaces/{ws}").json()["members"]}
    r = owner.post(f"/api/workspaces/{ws}/invites/{members['neha']}")
    assert r.status_code == 200 and r.json()["path"].startswith("/join/")
    token = r.json()["path"].split("/join/")[1]
    with SessionLocal() as db:  # only the hash is stored
        assert all(token not in i.token_hash for i in db.scalars(select(MemberInvite)))

    neha = client()
    j = neha.post(f"/api/join/{token}")
    assert j.status_code == 200 and j.json()["member"] == "Neha"
    info = neha.get(f"/api/workspaces/{ws}", headers={"X-Baton-Persona": members["meera"]}).json()
    assert info["persona"]["name"] == "Neha" and info["persona_locked"] is True  # header can't impersonate Meera
    names = {s["name"] for s in neha.get(f"/api/workspaces/{ws}/sources", headers={"X-Baton-Persona": members["meera"]}).json()["sources"]}
    assert "#core-team" not in names
    assert neha.get(f"/api/workspaces/{ws}/claims").status_code == 403  # successor has no ledger access

    # rotate: the old link stops working; revoke signs Neha out
    owner.post(f"/api/workspaces/{ws}/invites/{members['neha']}")
    assert client().post(f"/api/join/{token}").status_code == 404
    owner.delete(f"/api/workspaces/{ws}/invites/{members['neha']}")
    assert neha.get(f"/api/workspaces/{ws}").status_code == 404


def test_locked_workspace(ws):
    owner = client("inv-owner")
    assert owner.patch(f"/api/workspaces/{ws}/identity", json={"mode": "invites"}).json()["identity_mode"] == "invites"
    me = owner.get(f"/api/workspaces/{ws}").json()
    assert me["persona_locked"] is True and "admin" in me["persona"]["roles"]  # owner bound to the admin member
    members = {m["handle"]: m["id"] for m in me["members"]}
    # even the owner can't switch persona any more
    assert owner.get(f"/api/workspaces/{ws}", headers={"X-Baton-Persona": members["neha"]}).json()["persona"]["name"] == "Meera"
    assert client("someone-else").get(f"/api/workspaces/{ws}").status_code == 404
    team = owner.get(f"/api/workspaces/{ws}/team").json()
    assert team["identity_mode"] == "invites" and team["can_manage"] is True
    owner.patch(f"/api/workspaces/{ws}/identity", json={"mode": "switcher"})
