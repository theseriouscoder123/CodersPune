"""Knowledge risk (Round 3 feature): the pure rule table, then the endpoint with permissions applied first."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from baton.db.models import Membership, Workspace
from baton.db.session import SessionLocal
from baton.main import app
from baton.reconstruct.risk import ClaimLite, FileStat, assess, parse_stats
from baton.sandbox import clone_workspace

PEOPLE = {"rohan": "Rohan", "neha": "Neha"}


def test_parse_stats():
    rows = parse_stats("Commit statistics (computed from repository history)\n.github/workflows/deploy.yml: 33 commits; rohan 31, neha 2")
    assert rows == [FileStat(".github/workflows/deploy.yml", 33, {"rohan": 31, "neha": 2})]


def test_rule_table():
    files = [FileStat("deploy.yml", 33, {"rohan": 31, "neha": 2}),  # sole maintainer
             FileStat("app.ts", 10, {"rohan": 6, "neha": 4}),       # shared: not sole
             FileStat("tiny.md", 3, {"neha": 3})]                    # too few commits to say
    claims = [
        ClaimLite("1", "next_action", "Rohan must transfer Vercel ownership to Neha before 15 Nov.", "supported"),
        ClaimLite("2", "open_work", "Rohan is tasked with setting up push reminders.", "supported", live=False),  # stale
        ClaimLite("3", "open_work", "Status of issue #131", "missing", origin="checklist", signal="open issue #131 is assigned to rohan"),
        ClaimLite("4", "contact", "Who owns the Firebase project and its billing", "missing", origin="checklist", signal="FIREBASE_* in .env.example"),
        ClaimLite("5", "decision", "Uploads use Cloudinary.", "supported", authors=frozenset({"rohan"})),
        ClaimLite("6", "decision", "We use FCM.", "supported", authors=frozenset({"rohan", "neha"})),  # two authors: not only-source
        ClaimLite("7", "decision", "Posters are 4:5.", "supported", authors=frozenset({"sana"})),  # contributor outside the workspace
    ]
    ranked, unowned = assess(files, claims, PEOPLE)
    rohan = next(p for p in ranked if p.key == "rohan")
    assert [f["path"] for f in rohan.sole_files] == ["deploy.yml"]
    assert [c.id for c in rohan.open_tasks] == ["1"] and [c.id for c in rohan.unanswered] == ["3"]
    assert [c.id for c in rohan.only_source] == ["5"]
    assert rohan.score == 3 + 2 + 2 + 1 and rohan.level == "medium"
    assert ranked[0].key == "rohan"
    assert any(p.key == "sana" for p in ranked)  # people outside Baton still show up
    assert [c.id for c in unowned] == ["4"]


@pytest.fixture(scope="module")
def ws():
    db = SessionLocal()
    tpl = db.scalar(select(Workspace).where(Workspace.is_demo_template.is_(True)))
    if tpl is None:
        pytest.skip("demo template not seeded")
    w = clone_workspace(db, tpl.id, "risk-visitor")
    db.commit()
    yield str(w)
    db.execute(delete(Workspace).where(Workspace.id == w))
    db.commit()
    db.close()


def test_endpoint_and_permissions(ws):
    c = TestClient(app)
    c.cookies.set("baton_visitor", "risk-visitor")
    p = {m["handle"]: m["id"] for m in c.get(f"/api/workspaces/{ws}").json()["members"]}
    meera = {"X-Baton-Persona": p["meera"]}
    assert c.get(f"/api/workspaces/{ws}/risk", headers={"X-Baton-Persona": p["neha"]}).status_code == 403
    d = c.get(f"/api/workspaces/{ws}/risk", headers=meera).json()
    rohan = next(x for x in d["people"] if x["key"] == "rohan")
    assert rohan["level"] == "high" and ".github/workflows/deploy.yml" in [f["path"] for f in rohan["sole_files"]]
    assert rohan["handover_id"]  # the demo already has Rohan's handover
    assert {u["text"] for u in d["unowned"]} >= {"Who owns the Firebase account/project and its billing"}
    neha = next(x for x in d["people"] if x["key"] == "neha")
    assert any("TechNova" in t["text"] for t in neha["open_tasks"])
    # an admin who isn't the reviewer, without access to #core-team, must not see its work in the risk view
    db = SessionLocal()
    try:
        db.add(Membership(member_id=uuid.UUID(p["kabir"]), workspace_id=uuid.UUID(ws), role="admin"))
        db.commit()
    finally:
        db.close()
    src = next(s for s in c.get(f"/api/workspaces/{ws}/sources", headers=meera).json()["sources"] if s["name"] == "#core-team")
    assert c.patch(f"/api/sources/{src['id']}/acl", headers=meera, json={"roles": [], "members": [p["rohan"]]}).status_code == 200
    r = c.get(f"/api/workspaces/{ws}/risk", headers={"X-Baton-Persona": p["kabir"]})
    assert r.status_code == 200 and "TechNova" not in r.text
