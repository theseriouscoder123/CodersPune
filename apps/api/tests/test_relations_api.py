"""Round 3 improvement #2 through the API: relation signals, reviewer overrides that survive re-planning, stale open
work (and "still open"), and the successor projection (stale -> history, someone else's task -> owners)."""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from baton.db.models import Chunk, Claim, ClaimRelation, ConflictGroup, Evidence, Handover, Member, Source, Workspace
from baton.db.session import SessionLocal
from baton.demo_loader import build_demo_workspace
from baton.ledger import rebuild_relations, recompute_statuses
from baton.main import app
from baton.pipeline import replan_conflicts
from baton.sandbox import clone_workspace
from baton.verify.quote_match import match

REPO = "devclub/campus-events-app"


def _chunk(db, ws, name, needle):
    return db.scalar(select(Chunk).join(Source, Source.id == Chunk.source_id)
                     .where(Chunk.workspace_id == ws, Source.name == name, Chunk.text.contains(needle)))


def _claim(db, ws, typ, text, subject, value=None, when=None, chunk=None, quote=None):
    c = Claim(workspace_id=ws, type=typ, text=text, subject_key=subject, value=value, origin="extracted",
              occurred_at=datetime.fromisoformat(when).replace(tzinfo=UTC) if when else None)
    db.add(c)
    db.flush()
    if chunk is not None:
        m = match(quote, chunk.text)
        assert m.found, quote
        db.add(Evidence(claim_id=c.id, chunk_id=chunk.id, quote=quote, quote_found=True, match_score=m.score,
                        match_start=m.start, match_end=m.end, verdict="supports", verifier="test"))
    return c


@pytest.fixture(scope="module")
def world():
    db = SessionLocal()
    base = build_demo_workspace(db, template=False, name="pytest relations base")
    w = base.id
    any_repo = _chunk(db, w, REPO, "OneSignal")
    _claim(db, w, "decision", "Push reminders use OneSignal.", "notifications.provider", "onesignal", "2026-01-10", any_repo, "OneSignal")
    _claim(db, w, "decision", "Push reminders switched from OneSignal to FCM.", "notifications.provider", "fcm", "2026-03-14", any_repo, "OneSignal")
    two = _chunk(db, w, REPO, "MAX_BYTES")
    _claim(db, w, "decision", "The poster upload limit is 2 MB.", "upload.max_size", "2 MB", None, two, "MAX_BYTES = 2 * 1024 * 1024")
    _claim(db, w, "decision", "The poster upload limit is 5 MB.", "upload.max_size", "5 MB", "2026-04-02", _chunk(db, w, "Meeting notes", "5 MB"), "5 MB")
    _claim(db, w, "open_work", "Rohan is tasked with setting up push reminders for events.", "feature.push", None, "2026-02-10", any_repo, "OneSignal")
    _claim(db, w, "open_work", "Kabir needs to check Cloudinary usage after the fest.", "budget.cloudinary", None, "2026-04-02", any_repo, "OneSignal")
    _claim(db, w, "next_action", "Neha will receive admin access on the GitHub repository.", "deploy.owner", None, "2026-10-28", any_repo, "OneSignal")
    members = {m.handle: m for m in db.scalars(select(Member).where(Member.workspace_id == w))}
    db.add(Handover(workspace_id=w, leaver_member_id=members["rohan"].id, successor_member_id=members["neha"].id))
    replan_conflicts(db, w, reset=True)
    recompute_statuses(db, w)
    rebuild_relations(db, w)
    ws = clone_workspace(db, w, "rel-visitor")
    db.commit()
    yield {"ws": str(ws)}
    db.execute(delete(Workspace).where(Workspace.id.in_([w, ws])))
    db.commit()
    db.close()


def _c():
    c = TestClient(app)
    c.cookies.set("baton_visitor", "rel-visitor")
    return c


def _p(c, ws):
    return {m["handle"]: m["id"] for m in c.get(f"/api/workspaces/{ws}").json()["members"]}


def h(pid):
    return {"X-Baton-Persona": pid}


def test_relations_listed_with_signals(world):
    c, ws = _c(), world["ws"]
    p = _p(c, ws)
    assert c.get(f"/api/workspaces/{ws}/relations", headers=h(p["neha"])).status_code == 403
    r = c.get(f"/api/workspaces/{ws}/relations", headers=h(p["meera"])).json()
    kinds = {x["relation"]: x for x in r["relations"]}
    assert "reversal" in kinds and "contradiction" in kinds
    assert "switched" in kinds["reversal"]["signal"] and kinds["reversal"]["later"]["text"].startswith("Push reminders switched")
    assert "no reversal language" in kinds["contradiction"]["signal"]
    stale = {s["text"]: s["stale_reason"] for s in r["stale"]}
    assert any(t.startswith("Rohan is tasked") for t in stale)


def test_reviewer_override_survives_replanning(world):
    c, ws = _c(), world["ws"]
    p = _p(c, ws)
    rels = c.get(f"/api/workspaces/{ws}/relations", headers=h(p["meera"])).json()["relations"]
    contra = next(x for x in rels if x["relation"] == "contradiction")
    assert c.patch(f"/api/claim-relations/{contra['id']}", headers=h(p["kabir"]), json={"relation": "reversal"}).status_code == 403
    r = c.patch(f"/api/claim-relations/{contra['id']}", headers=h(p["meera"]), json={"relation": "reversal", "note": "5 MB was agreed later"})
    assert r.status_code == 200 and r.json()["decided_by"] == "reviewer"
    db = SessionLocal()
    try:
        earlier = db.get(Claim, contra["earlier"]["id"])
        later = db.get(Claim, contra["later"]["id"])
        assert earlier.superseded_by == later.id and later.status != "conflicting"
        # a full re-plan (as a refresh run does) must not undo the reviewer's choice
        replan_conflicts(db, earlier.workspace_id, reset=True)
        recompute_statuses(db, earlier.workspace_id)
        rebuild_relations(db, earlier.workspace_id)
        db.commit()
        db.refresh(earlier)
        assert earlier.superseded_by == later.id
        rel = db.get(ClaimRelation, contra["id"])
        assert rel.relation == "reversal" and rel.decided_by == "reviewer" and rel.note == "5 MB was agreed later"
    finally:
        db.close()
    log = c.get(f"/api/workspaces/{ws}/activity", headers=h(p["meera"])).json()["entries"]
    assert any(e["action"] == "relation_override" for e in log)


def test_override_to_contradiction_then_unrelated(world):
    c, ws = _c(), world["ws"]
    p = _p(c, ws)
    rev = next(x for x in c.get(f"/api/workspaces/{ws}/relations", headers=h(p["meera"])).json()["relations"]
               if x["relation"] == "reversal" and x["decided_by"] == "rule")
    assert c.patch(f"/api/claim-relations/{rev['id']}", headers=h(p["meera"]), json={"relation": "contradiction"}).status_code == 200
    db = SessionLocal()
    try:
        a, b = db.get(Claim, rev["earlier"]["id"]), db.get(Claim, rev["later"]["id"])
        assert a.superseded_by is None and a.conflict_group_id == b.conflict_group_id and a.status == "conflicting"
        gid = a.conflict_group_id
    finally:
        db.close()
    assert c.patch(f"/api/claim-relations/{rev['id']}", headers=h(p["meera"]), json={"relation": "unrelated"}).status_code == 200
    db = SessionLocal()
    try:
        a, b = db.get(Claim, rev["earlier"]["id"]), db.get(Claim, rev["later"]["id"])
        assert a.conflict_group_id is None and b.conflict_group_id is None and db.get(ConflictGroup, gid) is None
        assert a.status != "conflicting"
    finally:
        db.close()


def test_still_open_override(world):
    c, ws = _c(), world["ws"]
    p = _p(c, ws)
    stale = c.get(f"/api/workspaces/{ws}/relations", headers=h(p["meera"])).json()["stale"]
    sid = next(s["id"] for s in stale if s["text"].startswith("Rohan is tasked"))
    r = c.post(f"/api/claims/{sid}/stale", headers=h(p["meera"]), json={"still_open": True})
    assert r.status_code == 200 and r.json()["stale_reason"] is None
    r = c.post(f"/api/claims/{sid}/stale", headers=h(p["meera"]), json={"still_open": False})
    assert r.json()["stale_reason"] and "in place" in r.json()["stale_reason"]


def test_successor_projection_moves_stale_and_others_tasks(world):
    c, ws = _c(), world["ws"]
    p = _p(c, ws)
    hid = c.get(f"/api/workspaces/{ws}/handover").json()["handover"]["id"]
    assert c.post(f"/api/handovers/{hid}/approve", headers=h(p["meera"]), json={}).status_code == 200
    v = c.get(f"/api/handovers/{hid}", headers=h(p["neha"])).json()
    sec = {s["key"]: s["items"] for s in v["sections"]}
    start = [it["text"] for it in sec["start_here"]]
    assert start and start[0].startswith("Neha will receive")
    assert not any(t.startswith("Rohan is tasked") for t in start)
    assert any(it.get("stale") and it["text"].startswith("Rohan is tasked") for it in sec["decisions"])
    assert any(it["text"].startswith("Kabir needs") for it in sec["owners"])
