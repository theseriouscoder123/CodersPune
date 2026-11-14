"""Before the leaver leaves: the ordered checklist, who may see and tick it, automatic completion, the last day."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from baton.db.models import Workspace
from baton.db.session import SessionLocal
from baton.main import app
from baton.sandbox import clone_workspace


@pytest.fixture(scope="module")
def ws():
    db = SessionLocal()
    tpl = db.scalar(select(Workspace).where(Workspace.is_demo_template.is_(True)))
    if tpl is None:
        pytest.skip("demo template not seeded")
    w = clone_workspace(db, tpl.id, "leaving-visitor")
    db.commit()
    yield str(w)
    db.execute(delete(Workspace).where(Workspace.id == w))
    db.commit()
    db.close()


def test_checklist(ws):
    c = TestClient(app)
    c.cookies.set("baton_visitor", "leaving-visitor")
    p = {m["handle"]: m["id"] for m in c.get(f"/api/workspaces/{ws}").json()["members"]}
    H = lambda who: {"X-Baton-Persona": p[who]}  # noqa: E731
    hid = c.get(f"/api/workspaces/{ws}/handover", headers=H("meera")).json()["handover"]["id"]
    url = f"/api/handovers/{hid}/leaving"
    assert c.get(url, headers=H("neha")).status_code == 403 and c.get(url, headers=H("kabir")).status_code == 403
    d = c.get(url, headers=H("meera")).json()
    assert d["leaves_on"] == "2026-11-15"  # copied with the demo
    kinds = [i["kind"] for i in d["items"]]
    assert kinds == sorted(kinds, key=["task", "conflict", "gap", "walkthrough", "question"].index)  # ordered by urgency
    assert any(i["kind"] == "task" and "Vercel" in i["title"] for i in d["items"])
    walk = next(i for i in d["items"] if i["kind"] == "walkthrough" and "deploy.yml" in i["title"])
    gap = next(i for i in d["items"] if i["kind"] == "gap")
    # the leaver can tick manual items; automatic ones refuse; others can't tick at all
    assert c.post(f"{url}/marks/{walk['key']}", headers=H("rohan"), json={"done": True}).status_code == 200
    assert c.post(f"{url}/marks/{gap['key']}", headers=H("meera"), json={"done": True}).status_code == 422
    assert c.post(f"{url}/marks/{walk['key']}", headers=H("neha"), json={"done": True}).status_code == 403
    d2 = c.get(url, headers=H("rohan")).json()
    w2 = next(i for i in d2["items"] if i["key"] == walk["key"])
    assert w2["done"] and w2["marked_by"] == "Rohan" and d2["counts"]["done"] == 1
    assert d2["items"][-1]["done"]  # done items sink to the bottom
    # the last day: reviewer only, and validated
    assert c.put(f"{url}/date", headers=H("rohan"), json={"leaves_on": "2026-12-01"}).status_code == 403
    assert c.put(f"{url}/date", headers=H("meera"), json={"leaves_on": "1990-01-01"}).status_code == 422
    assert c.put(f"{url}/date", headers=H("meera"), json={"leaves_on": "2026-12-01"}).json()["leaves_on"] == "2026-12-01"
    assert c.get(url, headers=H("meera")).json()["days_left"] is not None
    # resolving the conflict completes its item by itself
    conflict = next(i for i in d["items"] if i["kind"] == "conflict")
    cg = c.get(f"/api/claims/{conflict['claim_id']}", headers=H("meera")).json()["conflict"]
    assert c.post(f"/api/conflicts/{cg['id']}/resolve", headers=H("meera"), json={"keep_as_risk": True, "note": "unclear"}).status_code == 200
    assert next(i for i in c.get(url, headers=H("meera")).json()["items"] if i["key"] == conflict["key"])["done"]
