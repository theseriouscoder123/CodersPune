"""Round 3 improvement #3 (part 1): successor acknowledgement, questions tracked to closure, carry-over between
versions, reset when an item changes, and no probing of withheld items."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from baton.db.models import Chunk, Claim, Evidence, Handover, Member, Source, Workspace
from baton.db.session import SessionLocal
from baton.demo_loader import build_demo_workspace
from baton.ledger import recompute_statuses
from baton.main import app
from baton.sandbox import clone_workspace
from baton.verify.quote_match import match

REPO = "devclub/campus-events-app"


def _claim(db, ws, typ, text, source, needle, quote):
    ch = db.scalar(select(Chunk).join(Source, Source.id == Chunk.source_id)
                   .where(Chunk.workspace_id == ws, Source.name == source, Chunk.text.contains(needle)))
    c = Claim(workspace_id=ws, type=typ, text=text, subject_key=text[:20], origin="extracted")
    db.add(c)
    db.flush()
    m = match(quote, ch.text)
    assert m.found
    db.add(Evidence(claim_id=c.id, chunk_id=ch.id, quote=quote, quote_found=True, match_score=m.score,
                    match_start=m.start, match_end=m.end, verdict="supports", verifier="test"))
    return c


@pytest.fixture(scope="module")
def world():
    db = SessionLocal()
    base = build_demo_workspace(db, template=False, name="pytest acks base")
    w = base.id
    _claim(db, w, "decision", "Push reminders moved from OneSignal to FCM.", REPO, "OneSignal", "OneSignal")
    _claim(db, w, "next_action", "Neha will receive admin access on the GitHub repository.", REPO, "OneSignal", "OneSignal")
    _claim(db, w, "dependency", "Sponsor TechNova pays only if the app is live by 20 Dec.", "#core-team", "TechNova pays", "TechNova pays")
    members = {m.handle: m for m in db.scalars(select(Member).where(Member.workspace_id == w))}
    db.add(Handover(workspace_id=w, leaver_member_id=members["rohan"].id, successor_member_id=members["neha"].id))
    recompute_statuses(db, w)
    ws = clone_workspace(db, w, "ack-visitor")
    db.commit()
    yield {"ws": str(ws)}
    db.execute(delete(Workspace).where(Workspace.id.in_([w, ws])))
    db.commit()
    db.close()


def _c():
    c = TestClient(app)
    c.cookies.set("baton_visitor", "ack-visitor")
    return c


def h(pid):
    return {"X-Baton-Persona": pid}


def _setup(world):
    c, ws = _c(), world["ws"]
    p = {m["handle"]: m["id"] for m in c.get(f"/api/workspaces/{ws}").json()["members"]}
    hid = c.get(f"/api/workspaces/{ws}/handover").json()["handover"]["id"]
    return c, ws, p, hid


def _ids(world):
    db = SessionLocal()
    try:
        return {c.text[:12]: str(c.id) for c in db.scalars(select(Claim).where(Claim.workspace_id == world["ws"]))}
    finally:
        db.close()


def test_acknowledge_ask_answer_close(world):
    c, ws, p, hid = _setup(world)
    ids = _ids(world)
    assert c.get(f"/api/handovers/{hid}/acks", headers=h(p["neha"])).json()["version"] is None  # nothing approved yet
    assert c.post(f"/api/handovers/{hid}/approve", headers=h(p["meera"]), json={}).status_code == 200
    push, admin, sponsor = ids["Push reminde"], ids["Neha will re"], ids["Sponsor Tech"]
    url = f"/api/handovers/{hid}/acks"
    assert c.get(url, headers=h(p["kabir"])).status_code == 403
    assert c.put(f"{url}/{push}", headers=h(p["meera"]), json={"state": "acknowledged"}).status_code == 403
    # a withheld item can't be acknowledged (or probed)
    assert c.put(f"{url}/{sponsor}", headers=h(p["neha"]), json={"state": "acknowledged"}).status_code == 404
    assert c.put(f"{url}/{push}", headers=h(p["neha"]), json={"state": "acknowledged"}).status_code == 200
    assert c.put(f"{url}/{push}", headers=h(p["neha"]), json={"state": "acknowledged"}).status_code == 200  # twice is fine
    assert c.put(f"{url}/{admin}", headers=h(p["neha"]), json={"state": "question", "note": ""}).status_code == 422
    q = c.put(f"{url}/{admin}", headers=h(p["neha"]), json={"state": "question", "note": "Who grants it, Rohan or Meera?"}).json()
    got = c.get(url, headers=h(p["neha"])).json()
    assert got["counts"]["acknowledged"] == 1 and got["counts"]["questions_open"] == 1 and got["counts"]["total"] == 2
    meera = c.get(url, headers=h(p["meera"])).json()
    assert meera["can_answer"] and any(x["state"] == "question" for x in meera["questions"])
    assert c.post(f"/api/acks/{q['id']}/answer", headers=h(p["neha"]), json={"answer": "me"}).status_code == 403
    assert c.post(f"/api/acks/{q['id']}/answer", headers=h(p["meera"]),
                  json={"answer": "Rohan does it before 15 Nov; ping rohan.personal@gmail.com"}).status_code == 200
    seen = c.get(url, headers=h(p["neha"])).json()["items"][admin]
    assert seen["answer"] and "rohan.personal@gmail.com" not in seen["answer"]  # PII masked for the successor
    assert c.post(f"/api/acks/{q['id']}/close", headers=h(p["meera"])).status_code == 403
    assert c.post(f"/api/acks/{q['id']}/close", headers=h(p["neha"])).status_code == 200
    assert c.get(url, headers=h(p["neha"])).json()["counts"]["questions_closed"] == 1


def test_carry_over_and_reset_on_change(world):
    c, ws, p, hid = _setup(world)
    ids = _ids(world)
    push, admin = ids["Push reminde"], ids["Neha will re"]
    # v2 with no changes: responses carry over
    assert c.post(f"/api/handovers/{hid}/approve", headers=h(p["meera"]), json={}).status_code == 200
    items = c.get(f"/api/handovers/{hid}/acks", headers=h(p["neha"])).json()["items"]
    assert items[push]["state"] == "acknowledged" and items[push]["carried"] is True
    # edit one item, approve v3: that response resets and is flagged as changed
    db = SessionLocal()  # change the text directly (an API edit would re-run the AI verifier)
    try:
        db.get(Claim, push).text = "Push reminders moved from OneSignal to FCM in March."
        db.commit()
    finally:
        db.close()
    assert c.post(f"/api/handovers/{hid}/approve", headers=h(p["meera"]), json={}).status_code == 200
    got = c.get(f"/api/handovers/{hid}/acks", headers=h(p["neha"])).json()
    assert got["items"][push].get("state") is None and got["items"][push].get("changed_since") == 1  # acknowledged in v1
    assert got["counts"]["changed"] == 1
    assert got["items"][admin]["state"] == "question"  # unchanged item keeps its (closed) question
