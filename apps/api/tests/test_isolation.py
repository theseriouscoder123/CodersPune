"""Tenant isolation sweep: a visitor must never read or change another visitor's workspace through ANY endpoint,
whatever ids or persona header they send. Each foreign-id call must answer 403/404 and leave the data unchanged."""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from baton.db.models import (
    Chunk,
    Claim,
    ConflictGroup,
    Evidence,
    Handover,
    HandoverVersion,
    Member,
    Run,
    Visitor,
    Workspace,
)
from baton.db.session import SessionLocal
from baton.demo_loader import build_demo_workspace
from baton.main import app


def _make(owner: str, name: str) -> dict:
    with SessionLocal.begin() as db:
        db.merge(Visitor(id=owner))
        w = build_demo_workspace(db, template=False, name=name)
        w.synthetic, w.visitor_id = False, owner
        members = {m.handle: m for m in db.scalars(select(Member).where(Member.workspace_id == w.id))}
        chunk = db.scalar(select(Chunk).where(Chunk.workspace_id == w.id).limit(1))
        g = ConflictGroup(workspace_id=w.id, subject_key="x.limit")
        db.add(g)
        db.flush()
        c = Claim(workspace_id=w.id, type="decision", text=f"SECRET-{name} decision", subject_key="x.limit",
                  origin="extracted", status="supported", conflict_group_id=g.id)
        db.add(c)
        db.flush()
        ev = Evidence(claim_id=c.id, chunk_id=chunk.id, quote=chunk.text[:30], quote_found=True, verdict="supports")
        db.add(ev)
        h = Handover(workspace_id=w.id, leaver_member_id=members["rohan"].id, successor_member_id=members["neha"].id)
        db.add(h)
        db.flush()
        db.add(HandoverVersion(handover_id=h.id, version=1, approved_by=members["meera"].id, approved_at=datetime.now(UTC),
                               snapshot={"items": [{"claim_id": str(c.id), "type": "decision", "text": c.text, "status": "supported",
                                                    "status_reason": "", "flags": {}, "occurred_at": None, "superseded_by": None,
                                                    "evidence": [{"evidence_id": str(ev.id), "chunk_id": str(chunk.id), "ref": "x"}]}]}))
        r = Run(workspace_id=w.id, status="done")
        db.add(r)
        db.flush()
        return {"ws": str(w.id), "claim": str(c.id), "ev": str(ev.id), "handover": str(h.id), "run": str(r.id),
                "group": str(g.id), "members": {k: str(m.id) for k, m in members.items()}}


@pytest.fixture(scope="module")
def two():
    a, b = _make("iso-a", "iso-alpha"), _make("iso-b", "iso-beta")
    yield a, b
    with SessionLocal.begin() as db:
        db.execute(delete(Workspace).where(Workspace.id.in_([a["ws"], b["ws"]])))
        db.execute(delete(Visitor).where(Visitor.id.in_(["iso-a", "iso-b"])))


def _client(visitor):
    c = TestClient(app)
    c.cookies.set("baton_visitor", visitor)
    return c


def test_foreign_ids_never_leak_or_change(two):
    a, b = two
    att = _client("iso-a")
    bw, bc, bh = b["ws"], b["claim"], b["handover"]
    with SessionLocal() as db:
        from baton.db.models import Source
        bsrc = str(db.scalar(select(Source.id).where(Source.workspace_id == bw).limit(1)))
    for persona in (None, a["members"]["meera"], b["members"]["meera"]):  # own, foreign and no persona header
        h = {"X-Baton-Persona": persona} if persona else {}
        calls = [
            ("GET", f"/api/workspaces/{bw}", None), ("GET", f"/api/workspaces/{bw}/sources", None),
            ("GET", f"/api/workspaces/{bw}/claims", None), ("GET", f"/api/workspaces/{bw}/timeline", None),
            ("GET", f"/api/workspaces/{bw}/questions", None), ("GET", f"/api/workspaces/{bw}/handover", None),
            ("GET", f"/api/workspaces/{bw}/handovers", None), ("GET", f"/api/workspaces/{bw}/runs/latest", None),
            ("GET", f"/api/workspaces/{bw}/pipeline-health", None), ("GET", f"/api/workspaces/{bw}/team", None),
            ("GET", f"/api/workspaces/{bw}/activity", None), ("GET", f"/api/workspaces/{bw}/activity.csv", None),
            ("GET", f"/api/workspaces/{bw}/export.json", None), ("GET", f"/api/workspaces/{bw}/search?q=decision", None),
            ("GET", f"/api/workspaces/{bw}/tour", None),
            ("GET", f"/api/claims/{bc}", None), ("GET", f"/api/handovers/{bh}", None),
            ("GET", f"/api/handovers/{bh}/changes", None), ("GET", f"/api/handovers/{bh}/versions", None),
            ("GET", f"/api/handovers/{bh}/preview", None), ("GET", f"/api/handovers/{bh}/export.md", None),
            ("GET", f"/api/handovers/{bh}/evidence/{b['ev']}", None), ("GET", f"/api/runs/{b['run']}", None),
            ("POST", f"/api/claims/{bc}/review", {"action": "reject", "note": "x"}),
            ("POST", f"/api/conflicts/{b['group']}/resolve", {"keep_as_risk": True}),
            ("POST", f"/api/handovers/{bh}/approve", {}), ("POST", f"/api/handovers/{bh}/ask", {"question": "what is it?"}),
            ("POST", f"/api/runs/{b['run']}/advance", None), ("POST", f"/api/workspaces/{bw}/runs", {"mode": "refresh"}),
            ("POST", f"/api/workspaces/{bw}/handovers", {"successor_id": b["members"]["kabir"]}),
            ("POST", f"/api/workspaces/{bw}/invites/{b['members']['neha']}", None),
            ("DELETE", f"/api/workspaces/{bw}/invites/{b['members']['neha']}", None),
            ("PATCH", f"/api/workspaces/{bw}/identity", {"mode": "invites"}),
            ("PUT", f"/api/workspaces/{bw}/members/{b['members']['neha']}/email", {"email": "x@y.io"}),
            ("PUT", f"/api/workspaces/{bw}/notify", {"slack_webhook": None}),
            ("POST", f"/api/workspaces/{bw}/notify/test", {"channel": "slack"}),
            ("POST", f"/api/workspaces/{bw}/questions/email", None),
            ("POST", f"/api/workspaces/{bw}/claims/bulk-review", {"claim_ids": [bc], "action": "reject"}),
            ("GET", f"/api/workspaces/{bw}/interviews", None), ("POST", f"/api/workspaces/{bw}/interviews", {}),
            ("GET", f"/api/sources/{bsrc}/acl", None), ("PATCH", f"/api/sources/{bsrc}/acl", {"roles": ["all_members"]}),
            ("DELETE", f"/api/workspaces/{bw}", {"confirm_name": "iso-beta"}),
        ]
        for method, url, body in calls:
            r = att.request(method, url, headers=h, json=body)
            assert r.status_code in (403, 404, 422), f"{method} {url} as {persona} -> {r.status_code}"
            assert "SECRET-iso-beta" not in r.text, f"{method} {url} leaked foreign claim text"

    # Foreign ids routed through the attacker's OWN workspace must not touch workspace B either.
    aw, own = a["ws"], {"X-Baton-Persona": a["members"]["meera"]}
    r = att.post(f"/api/workspaces/{aw}/claims/bulk-review", headers=own, json={"claim_ids": [bc], "action": "reject"})
    assert r.status_code == 200 and r.json().get("updated", 0) == 0
    assert att.post(f"/api/workspaces/{aw}/invites/{b['members']['neha']}", headers=own).status_code == 404
    assert att.put(f"/api/workspaces/{aw}/members/{b['members']['neha']}/email", headers=own, json={"email": "x@y.io"}).status_code == 404
    r = att.post(f"/api/workspaces/{aw}/handovers", headers=own, json={"successor_id": b["members"]["kabir"]})
    assert r.status_code in (404, 422)

    with SessionLocal() as db:  # B is untouched
        c = db.get(Claim, bc)
        assert c.review_state == "none" and c.status == "supported"
        assert db.get(Workspace, bw) is not None
        assert db.scalar(select(Member.email).where(Member.id == b["members"]["neha"])) is None


def test_successor_cannot_open_evidence_outside_approved_versions(two):
    a, _ = two
    c = _client("iso-a")
    with SessionLocal.begin() as db:  # a draft claim with evidence from a source everyone can see
        chunk = db.scalar(select(Chunk).where(Chunk.workspace_id == a["ws"]).limit(1))
        draft = Claim(workspace_id=a["ws"], type="decision", text="DRAFT-only claim", subject_key="draft.x", origin="extracted")
        db.add(draft)
        db.flush()
        ev = Evidence(claim_id=draft.id, chunk_id=chunk.id, quote=chunk.text[:20], quote_found=True, verdict="supports")
        db.add(ev)
        db.flush()
        draft_ev = str(ev.id)
    neha = {"X-Baton-Persona": a["members"]["neha"]}
    meera = {"X-Baton-Persona": a["members"]["meera"]}
    assert c.get(f"/api/handovers/{a['handover']}/evidence/{a['ev']}", headers=neha).status_code == 200  # approved: fine
    assert c.get(f"/api/handovers/{a['handover']}/evidence/{draft_ev}", headers=neha).status_code == 404  # draft: never
    assert c.get(f"/api/handovers/{a['handover']}/evidence/{draft_ev}", headers=meera).status_code == 200  # reviewer may


def test_concurrent_approvals_get_distinct_versions(two):
    from concurrent.futures import ThreadPoolExecutor

    a, _ = two
    h = {"X-Baton-Persona": a["members"]["meera"]}

    def approve(_):
        return _client("iso-a").post(f"/api/handovers/{a['handover']}/approve", headers=h, json={})

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(approve, range(4)))
    assert all(r.status_code == 200 for r in results), [r.text for r in results]
    versions = sorted(r.json()["version"] for r in results)
    assert len(set(versions)) == 4 and versions == list(range(versions[0], versions[0] + 4))


def test_double_click_demo_start_creates_one_sandbox():
    from concurrent.futures import ThreadPoolExecutor

    with SessionLocal() as db:
        if db.scalar(select(Workspace).where(Workspace.is_demo_template.is_(True))) is None:
            pytest.skip("no demo template in this database")
    with SessionLocal.begin() as db:
        db.merge(Visitor(id="iso-dbl"))

    def start(_):
        return _client("iso-dbl").post("/api/demo/start", headers={"X-Forwarded-For": "203.0.113.77"})

    try:
        with ThreadPoolExecutor(max_workers=3) as pool:
            ids = {r.json()["workspace_id"] for r in pool.map(start, range(3))}
        assert len(ids) == 1
    finally:
        with SessionLocal.begin() as db:
            db.execute(delete(Workspace).where(Workspace.visitor_id == "iso-dbl"))
            db.execute(delete(Visitor).where(Visitor.id == "iso-dbl"))


def test_failed_run_can_be_retried_from_the_failed_step(two):
    from baton.db.models import Job

    a, _ = two
    with SessionLocal.begin() as db:
        r = Run(workspace_id=a["ws"], status="failed", error="Match quotes to sources failed: boom")
        db.add(r)
        db.flush()
        db.add_all([Job(run_id=r.id, step="ingest", status="done"), Job(run_id=r.id, step="match", status="failed", message="boom")])
        rid = str(r.id)
    c = _client("iso-a")
    admin = {"X-Baton-Persona": a["members"]["meera"]}
    assert c.post(f"/api/runs/{rid}/retry", headers={"X-Baton-Persona": a["members"]["neha"]}).status_code == 403
    p = c.post(f"/api/runs/{rid}/retry", headers=admin).json()
    assert p["status"] == "running" and not p["error"]
    steps = {s["step"]: s["status"] for s in p["steps"]}
    assert steps == {"ingest": "done", "match": "pending"}  # finished work is kept
    assert c.post(f"/api/runs/{rid}/retry", headers=admin).status_code == 409
    with SessionLocal.begin() as db:
        db.get(Run, rid).status = "failed"  # leave the fixture without a live run
