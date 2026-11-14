"""The successor's first week: placement rules (pure), then the endpoint: successor-only, only what they see, progress."""

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from baton.db.models import Handover, Workspace
from baton.db.session import SessionLocal
from baton.main import app
from baton.routers.firstweek import place
from baton.sandbox import clone_workspace


def test_placement_rules():
    assert place({"section": "Start here", "rank": 0, "text": "Neha will get admin."}, "Rohan", True) == ("day1", "It names you.")
    assert place({"section": "Start here", "rank": 1, "text": "Logo on the page before launch."}, "Rohan", True)[0] == "day1"
    assert place({"section": "Start here", "rank": 1, "text": "Venue map proposed."}, "Rohan", True)[0] == "days23"
    assert place({"section": "Unresolved", "text": "Who owns Firebase"}, "Rohan", True)[0] == "day1"   # leaver still here
    assert place({"section": "Unresolved", "text": "Who owns Firebase"}, "Rohan", False)[0] == "week1"  # leaver gone
    assert place({"section": "Key decisions", "text": "Uses FCM."}, "Rohan", True) == ("week1", "Read for context.")


@pytest.fixture(scope="module")
def ws():
    db = SessionLocal()
    tpl = db.scalar(select(Workspace).where(Workspace.is_demo_template.is_(True)))
    if tpl is None:
        pytest.skip("demo template not seeded")
    w = clone_workspace(db, tpl.id, "fw-visitor")
    db.commit()
    yield str(w)
    db.execute(delete(Workspace).where(Workspace.id == w))
    db.commit()
    db.close()


def test_endpoint(ws):
    c = TestClient(app)
    c.cookies.set("baton_visitor", "fw-visitor")
    p = {m["handle"]: m["id"] for m in c.get(f"/api/workspaces/{ws}").json()["members"]}
    H = lambda who: {"X-Baton-Persona": p[who]}  # noqa: E731
    hid = c.get(f"/api/workspaces/{ws}/handover", headers=H("meera")).json()["handover"]["id"]
    url = f"/api/handovers/{hid}/first-week"
    assert c.get(url, headers=H("neha")).json()["approved"] is False  # nothing before approval (trust rule 8)
    c.post(f"/api/handovers/{hid}/approve", headers=H("meera"), json={})
    assert c.get(url, headers=H("kabir")).status_code == 403
    d = c.get(url, headers=H("neha")).json()
    view = c.get(f"/api/handovers/{hid}", headers=H("neha")).json()
    shown = {it["claim_id"] for s in view["sections"] for it in s["items"] if it.get("claim_id") and not it.get("history")}
    planned = {i["claim_id"] for b in d["buckets"] for i in b["items"]}
    assert planned == shown  # exactly the items Neha already sees, nothing more
    assert "TechNova" not in str(d)
    day1 = d["buckets"][0]["items"]
    assert any("Vercel" in i["text"] for i in day1)
    first = day1[0]["claim_id"]
    c.put(f"/api/handovers/{hid}/acks/{first}", headers=H("neha"), json={"state": "acknowledged"})
    d2 = c.get(url, headers=H("neha")).json()
    assert d2["counts"]["done"] == 1 and d2["buckets"][0]["items"][-1]["done"]
    # once the leaver's last day has passed, unanswered questions move out of Day 1
    db = SessionLocal()
    try:
        db.scalar(select(Handover).where(Handover.id == hid)).leaves_on = date.today() - timedelta(days=3)
        db.commit()
    finally:
        db.close()
    d3 = c.get(url, headers=H("neha")).json()
    assert d3["leaver_here"] is False and not any(i["section"] == "Unresolved" for i in d3["buckets"][0]["items"])
