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


def test_export_labels_history_and_carries_quotes(world):
    c = TestClient(app)
    c.cookies.set("baton_visitor", "counts-visitor")
    ws = world["ws"]
    p = {m["handle"]: m["id"] for m in c.get(f"/api/workspaces/{ws}").json()["members"]}
    hid = c.get(f"/api/workspaces/{ws}/handover").json()["handover"]["id"]
    md = c.get(f"/api/handovers/{hid}/export.md", headers={"X-Baton-Persona": p["neha"]}).text
    assert "~~" not in md  # history is labelled, not struck through
    assert "Earlier, changed" in md and "Now: Push reminders moved from OneSignal to FCM." in md
    assert "> “" in md  # key quotes travel with the items
    assert "TechNova" not in md  # withheld for Neha, in the export too


def test_compare_two_people(world):
    """Person-to-person visibility diff: Neha vs Kabir (who can read #core-team), consistent with the counts."""
    c = TestClient(app)
    c.cookies.set("baton_visitor", "counts-visitor")
    ws = world["ws"]
    p = {m["handle"]: m["id"] for m in c.get(f"/api/workspaces/{ws}").json()["members"]}
    hid = c.get(f"/api/workspaces/{ws}/handover").json()["handover"]["id"]
    url = f"/api/handovers/{hid}/compare?a={p['neha']}&b={p['kabir']}"
    assert c.get(url, headers={"X-Baton-Persona": p["neha"]}).status_code == 403
    assert c.get(f"/api/handovers/{hid}/compare?a={p['neha']}&b={p['neha']}", headers={"X-Baton-Persona": p["meera"]}).status_code == 422
    d = c.get(url, headers={"X-Baton-Persona": p["meera"]}).json()
    assert d["only_a"] == []  # Kabir reads everything Neha reads here
    assert any("TechNova" in x["text"] for x in d["only_b"]) and all("#core-team" in x["reason"] for x in d["only_b"])
    a, b = d["a"]["counts"], d["b"]["counts"]
    assert a["current"] + a["history"] == d["both"] + len(d["only_a"])
    assert b["current"] + b["history"] == d["both"] + len(d["only_b"])
    assert a["withheld"] == len(d["only_b"])  # what Neha can't see is exactly what only Kabir sees


def test_preview_says_when_nothing_changed_since_the_latest_approval(world):
    c = TestClient(app)
    c.cookies.set("baton_visitor", "counts-visitor")
    ws = world["ws"]
    p = {m["handle"]: m["id"] for m in c.get(f"/api/workspaces/{ws}").json()["members"]}
    hid = c.get(f"/api/workspaces/{ws}/handover").json()["handover"]["id"]
    meera = {"X-Baton-Persona": p["meera"]}
    c.post(f"/api/handovers/{hid}/approve", headers=meera, json={})
    assert c.get(f"/api/handovers/{hid}/preview", headers=meera).json()["same_as_latest"] is True
    claim = next(it for it in c.get(f"/api/handovers/{hid}/preview", headers=meera).json()["visible"] if not it["history"])
    assert c.post(f"/api/claims/{claim['id']}/review", headers=meera, json={"action": "reject", "note": "test"}).status_code == 200
    assert c.get(f"/api/handovers/{hid}/preview", headers=meera).json()["same_as_latest"] is False
