"""Permission safety (Round 1 target: 0 restricted claims in successor views), measured as a sweep: every GET route
in the API, called as the successor for every id in an approved copy of the full demo ledger (with re-rendered and
history items), must never return the restricted sponsor details that live only in #core-team."""

import re

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from baton.db.models import Chunk, Claim, Evidence, Interview, Run, Source, Workspace
from baton.db.session import SessionLocal
from baton.main import app
from baton.sandbox import clone_workspace

RESTRICTED = re.compile(r"technova|40,000|₹\s?40", re.IGNORECASE)
VISITOR = "leak-sweep-visitor"


@pytest.fixture(scope="module")
def world():
    db = SessionLocal()
    tpl = db.scalar(select(Workspace).where(Workspace.is_demo_template.is_(True)))
    if tpl is None:
        pytest.skip("demo template not seeded (python -m baton.seed_demo --frozen)")
    ws = clone_workspace(db, tpl.id, VISITOR)
    db.commit()
    yield str(ws)
    db.execute(delete(Workspace).where(Workspace.id == ws))
    db.commit()
    db.close()


def test_successor_never_sees_restricted_details_on_any_route(world):
    c = TestClient(app)
    c.cookies.set("baton_visitor", VISITOR)
    ws = world
    p = {m["handle"]: m["id"] for m in c.get(f"/api/workspaces/{ws}").json()["members"]}
    meera, neha = {"X-Baton-Persona": p["meera"]}, {"X-Baton-Persona": p["neha"]}
    hid = c.get(f"/api/workspaces/{ws}/handover", headers=meera).json()["handover"]["id"]
    assert c.post(f"/api/handovers/{hid}/approve", headers=meera, json={}).status_code == 200
    # Neha acknowledges and asks, so acknowledgement routes have data too
    view = c.get(f"/api/handovers/{hid}", headers=neha).json()
    first = next(it["claim_id"] for s in view["sections"] for it in s["items"] if it.get("claim_id") and not it.get("history"))
    c.put(f"/api/handovers/{hid}/acks/{first}", headers=neha, json={"state": "question", "note": "Who do I ask about sponsors?"})

    db = SessionLocal()
    try:
        assert db.scalar(select(Chunk).join(Source, Source.id == Chunk.source_id)
                         .where(Chunk.workspace_id == ws, Chunk.text.ilike("%technova%"))) is not None  # the bait exists
        ids = {
            "workspace_id": [ws], "handover_id": [hid],
            "claim_id": [str(x) for x in db.scalars(select(Claim.id).where(Claim.workspace_id == ws))],
            "source_id": [str(x) for x in db.scalars(select(Source.id).where(Source.workspace_id == ws))],
            "evidence_id": [str(x) for x in db.scalars(select(Evidence.id).join(Claim, Claim.id == Evidence.claim_id)
                                                        .where(Claim.workspace_id == ws))],
            "interview_id": [str(x) for x in db.scalars(select(Interview.id).where(Interview.workspace_id == ws))] or ["0" * 8],
            "run_id": [str(x) for x in db.scalars(select(Run.id).where(Run.workspace_id == ws))] or ["0" * 8],
        }
    finally:
        db.close()

    paths = [x for x, v in c.get("/api/openapi.json").json()["paths"].items() if "get" in v and "{" in x or x.endswith("health")]
    calls, leaks = 0, []
    for path in paths:
        names = re.findall(r"{(\w+)}", path)
        combos = [{}]
        for n in names:
            combos = [{**cb, n: v} for cb in combos for v in ids.get(n, ["x"])]
        for cb in combos:
            url = path.format(**cb)
            extras = ["?q=TechNova", "?q=sponsor"] if url.endswith(("/search", "/claims")) else [""]
            for ex in extras:
                r = c.get(url + ex, headers=neha)
                calls += 1
                if RESTRICTED.search(r.text):
                    leaks.append(f"{r.status_code} {path}{ex}")
    print(f"\nleak sweep: {calls} successor requests across {len(paths)} GET routes, {len(leaks)} leaks")
    assert calls >= 150  # 179 on the demo ledger (every claim, source and evidence id)
    assert leaks == []
