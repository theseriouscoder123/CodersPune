"""Admin access-list editing (Round 3 M0): roles, validation, read-only template, immediate effect, audit trail.
Also checks that sandbox copies carry the Round 3 claim fields and relations."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from baton.db.models import AuditEvent, Claim, ClaimRelation, Source, Workspace
from baton.db.session import SessionLocal
from baton.demo_loader import build_demo_workspace
from baton.main import app
from baton.sandbox import clone_workspace


@pytest.fixture(scope="module")
def world():
    db = SessionLocal()
    base = build_demo_workspace(db, template=False, name="pytest acl base")
    a, b = db.scalars(select(Claim).where(Claim.workspace_id == base.id).limit(2)).all() or (None, None)
    if a is None:  # the loader inserts no claims; make two so the relation clone can be checked
        a = Claim(workspace_id=base.id, type="decision", text="We use Supabase Auth.", subject_key="auth", origin="extracted")
        b = Claim(workspace_id=base.id, type="decision", text="We moved to Firebase Auth.", subject_key="auth", origin="extracted",
                  stale_reason=None)
        db.add_all([a, b])
        db.flush()
    a.stale_reason = "superseded by a later decision"
    db.add(ClaimRelation(workspace_id=base.id, from_claim_id=a.id, to_claim_id=b.id, relation="reversal", signal="test"))
    db.flush()
    sandbox = clone_workspace(db, base.id, "acl-visitor")
    db.commit()
    yield {"base": str(base.id), "ws": str(sandbox)}
    db.execute(delete(Workspace).where(Workspace.id.in_([base.id, sandbox])))
    db.commit()
    db.close()


def _client(visitor="acl-visitor"):
    c = TestClient(app)
    c.cookies.set("baton_visitor", visitor)
    return c


def _setup(world):
    c = _client()
    ws = world["ws"]
    info = c.get(f"/api/workspaces/{ws}").json()
    p = {m["handle"]: m["id"] for m in info["members"]}
    core = next(s for s in c.get(f"/api/workspaces/{ws}/sources", headers={"X-Baton-Persona": p["meera"]}).json()["sources"]
                if s["name"] == "#core-team")
    return c, ws, p, core["id"]


def h(pid):
    return {"X-Baton-Persona": pid}


def test_only_admin_can_read_or_change(world):
    c, ws, p, sid = _setup(world)
    for who in ("neha", "kabir", "rohan"):
        assert c.get(f"/api/sources/{sid}/acl", headers=h(p[who])).status_code == 403
        assert c.patch(f"/api/sources/{sid}/acl", headers=h(p[who]), json={"roles": ["all_members"]}).status_code == 403
    r = c.get(f"/api/sources/{sid}/acl", headers=h(p["meera"]))
    assert r.status_code == 200 and "reviewer" in r.json()["acl"]["roles"]


def test_other_visitor_gets_404(world):
    _, _, p, sid = _setup(world)
    assert _client("someone-else").get(f"/api/sources/{sid}/acl", headers=h(p["meera"])).status_code == 404


def test_validation_is_friendly(world):
    c, ws, p, sid = _setup(world)
    r = c.patch(f"/api/sources/{sid}/acl", headers=h(p["meera"]), json={"roles": ["superuser"]})
    assert r.status_code == 422 and "Unknown role" in r.json()["detail"]
    r = c.patch(f"/api/sources/{sid}/acl", headers=h(p["meera"]),
                json={"roles": ["reviewer"], "members": ["00000000-0000-0000-0000-000000000001"]})
    assert r.status_code == 422 and "member of this workspace" in r.json()["detail"]


def test_widening_takes_effect_and_is_audited_and_idempotent(world):
    c, ws, p, sid = _setup(world)
    names = lambda pid: {s["name"] for s in c.get(f"/api/workspaces/{ws}/sources", headers=h(pid)).json()["sources"]}  # noqa: E731
    assert "#core-team" not in names(p["neha"])
    cur = c.get(f"/api/sources/{sid}/acl", headers=h(p["meera"])).json()["acl"]
    body = {"roles": cur["roles"], "members": cur["members"] + [p["neha"]], "note": "Neha owns the sponsor logo task"}
    r = c.patch(f"/api/sources/{sid}/acl", headers=h(p["meera"]), json=body)
    assert r.status_code == 200 and r.json()["changed"] is True and "Neha" in r.json()["access"]
    assert "#core-team" in names(p["neha"])
    again = c.patch(f"/api/sources/{sid}/acl", headers=h(p["meera"]), json=body)  # same save twice
    assert again.status_code == 200 and again.json()["changed"] is False
    db = SessionLocal()
    try:
        assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.target == sid)) == 1
        src = db.get(Source, sid)
        assert p["neha"] in src.acl["members"] and p["neha"] in src.acl_key
    finally:
        db.close()
    log = c.get(f"/api/workspaces/{ws}/activity", headers=h(p["meera"])).json()["entries"]
    assert any(e["kind"] == "audit" and "#core-team" in (e["claim"] or "") for e in log)
    # narrow back: revoked at once
    c.patch(f"/api/sources/{sid}/acl", headers=h(p["meera"]), json={"roles": cur["roles"], "members": cur["members"]})
    assert "#core-team" not in names(p["neha"])


def test_template_is_read_only(world):
    db = SessionLocal()
    tpl = build_demo_workspace(db, template=True, name="pytest acl template")
    db.commit()
    try:
        c = _client("tpl-visitor")
        info = c.get(f"/api/workspaces/{tpl.id}").json()
        meera = next(m["id"] for m in info["members"] if m["handle"] == "meera")
        sid = next(s["id"] for s in c.get(f"/api/workspaces/{tpl.id}/sources", headers=h(meera)).json()["sources"])
        r = c.patch(f"/api/sources/{sid}/acl", headers=h(meera), json={"roles": ["all_members"]})
        assert r.status_code == 403 and "read-only" in r.json()["detail"]
    finally:
        db.execute(delete(Workspace).where(Workspace.id == tpl.id))
        db.commit()
        db.close()


def test_sandbox_copies_relations_and_stale_reason(world):
    db = SessionLocal()
    try:
        rel = db.scalars(select(ClaimRelation).where(ClaimRelation.workspace_id == world["ws"])).all()
        assert len(rel) == 1 and rel[0].relation == "reversal"
        frm = db.get(Claim, rel[0].from_claim_id)
        assert str(frm.workspace_id) == world["ws"] and frm.stale_reason == "superseded by a later decision"
    finally:
        db.close()
