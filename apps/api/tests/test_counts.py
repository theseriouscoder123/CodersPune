"""Fix F1: one count for the handover. The preview, the approve response, the successor's page and version history
report the same numbers, with reversed decisions counted as history and withheld items counted apart."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from baton.db.models import Handover, Member, Workspace
from baton.db.session import SessionLocal
from baton.demo_loader import build_demo_workspace
from baton.ledger import recompute_statuses
from baton.main import app
from baton.sandbox import clone_workspace
from tests.test_acks import REPO, _claim


@pytest.fixture(scope="module")
def world():
    db = SessionLocal()
    base = build_demo_workspace(db, template=False, name="pytest counts base")
    w = base.id
    old = _claim(db, w, "decision", "Push reminders use OneSignal.", REPO, "OneSignal", "OneSignal")
    new = _claim(db, w, "decision", "Push reminders moved from OneSignal to FCM.", REPO, "OneSignal", "OneSignal")
    old.superseded_by = new.id
    _claim(db, w, "next_action", "Neha will receive admin access on the GitHub repository.", REPO, "OneSignal", "OneSignal")
    _claim(db, w, "dependency", "Sponsor TechNova pays only if the app is live by 20 Dec.", "#core-team", "TechNova pays", "TechNova pays")
    members = {m.handle: m for m in db.scalars(select(Member).where(Member.workspace_id == w))}
    db.add(Handover(workspace_id=w, leaver_member_id=members["rohan"].id, successor_member_id=members["neha"].id))
    recompute_statuses(db, w)
    ws = clone_workspace(db, w, "counts-visitor")
    db.commit()
    yield {"ws": str(ws)}
    db.execute(delete(Workspace).where(Workspace.id.in_([w, ws])))
    db.commit()
    db.close()


def test_every_screen_reports_the_same_counts(world):
    c = TestClient(app)
    c.cookies.set("baton_visitor", "counts-visitor")
    ws = world["ws"]
    p = {m["handle"]: m["id"] for m in c.get(f"/api/workspaces/{ws}").json()["members"]}
    hid = c.get(f"/api/workspaces/{ws}/handover").json()["handover"]["id"]
    meera, neha = {"X-Baton-Persona": p["meera"]}, {"X-Baton-Persona": p["neha"]}

    prev = c.get(f"/api/handovers/{hid}/preview", headers=meera).json()
    counts = prev["counts"]
    assert counts["history"] >= 1 and counts["withheld"] >= 1 and counts["current"] >= 1
    assert counts["current"] + counts["history"] == len(prev["visible"])
    assert counts["withheld"] == len(prev["withheld"])
    assert any(it["history"] == "superseded" for it in prev["visible"])  # the preview now shows history too

    appr = c.post(f"/api/handovers/{hid}/approve", headers=meera, json={}).json()
    assert appr["counts"] == counts

    view = c.get(f"/api/handovers/{hid}", headers=neha).json()
    shown = [it for s in view["sections"] for it in s["items"] if not it.get("restricted")]
    assert view["counts"]["current"] == counts["current"] and view["counts"]["history"] == counts["history"]
    assert len(shown) == counts["current"] + counts["history"]
    assert view["counts"]["withheld"] is None  # stubs are off, so the successor isn't told how many are withheld
    assert not any("review_state" in it for it in shown)

    vers = c.get(f"/api/handovers/{hid}/versions", headers=meera).json()["versions"]
    assert vers[0]["counts"] == counts and vers[0]["items"] == counts["current"]

    # every section placement in the preview matches the successor's real page
    real = {it["claim_id"]: s["key"] for s in view["sections"] for it in s["items"] if it.get("claim_id")}
    assert {it["id"]: it["section"] for it in prev["visible"]} == real
