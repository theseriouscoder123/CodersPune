"""Questions for the leaver exported as a GitHub issue: an issue can be public, so questions built from restricted
sources are left out (and counted); a pre-filled 'new issue' link only for a real repo of the workspace."""

from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from baton.db.models import Chunk, Claim, Evidence, Source, Workspace
from baton.db.session import SessionLocal
from baton.main import app
from baton.sandbox import clone_workspace


@pytest.fixture(scope="module")
def ws():
    db = SessionLocal()
    tpl = db.scalar(select(Workspace).where(Workspace.is_demo_template.is_(True)))
    if tpl is None:
        pytest.skip("demo template not seeded")
    w = clone_workspace(db, tpl.id, "issue-visitor")
    ch = db.scalar(select(Chunk).join(Source, Source.id == Chunk.source_id)
                   .where(Chunk.workspace_id == w, Source.name == "#core-team", Chunk.text.ilike("%technova%")))
    c = Claim(workspace_id=w, type="contact", text="Who signs the TechNova contract renewal", subject_key="sponsor.renewal",
              origin="extracted", status="missing")
    db.add(c)
    db.flush()
    db.add(Evidence(claim_id=c.id, chunk_id=ch.id, quote="TechNova", quote_found=True, match_score=100, verdict="supports", verifier="test"))
    db.commit()
    yield str(w)
    db.execute(delete(Workspace).where(Workspace.id == w))
    db.commit()
    db.close()


def test_restricted_questions_stay_out_of_the_issue(ws):
    c = TestClient(app)
    c.cookies.set("baton_visitor", "issue-visitor")
    meera = {"X-Baton-Persona": {m["handle"]: m["id"] for m in c.get(f"/api/workspaces/{ws}").json()["members"]}["meera"]}
    d = c.get(f"/api/workspaces/{ws}/questions", headers=meera).json()
    assert any("TechNova" in q["text"] for q in d["questions"])  # the reviewer still sees it in Baton
    assert "TechNova" not in d["issue_body"] and d["issue_left_out"] == 1
    assert "1 more question came from restricted sources" in d["issue_body"]
    assert d["issue_url"] is None  # the demo's repo is fictional: no link
    # a real workspace with a real repo gets a pre-filled issue link carrying the same filtered body
    db = SessionLocal()
    try:
        w = db.get(Workspace, ws)
        w.synthetic = False
        src = db.scalar(select(Source).where(Source.workspace_id == w.id, Source.type == "fixture"))
        src.type, src.uri = "github_repo", "https://github.com/devclub/campus-events-app"
        db.commit()
    finally:
        db.close()
    d = c.get(f"/api/workspaces/{ws}/questions", headers=meera).json()
    u = urlparse(d["issue_url"])
    assert u.netloc == "github.com" and u.path == "/devclub/campus-events-app/issues/new"
    q = parse_qs(u.query)
    assert q["body"][0] == d["issue_body"] and "TechNova" not in q["body"][0] and q["title"][0].startswith("Handover questions")
