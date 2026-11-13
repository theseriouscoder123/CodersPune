"""Round 3 improvement #1, the gap interview: questions from Missing/Conflicting claims, leaver-only answering,
testimony that never widens access, exact quotes, status rules, conflict proposals (never auto-resolved), idempotency."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from baton.acl import acl_intersection
from baton.db.models import Chunk, Claim, ConflictGroup, Evidence, Handover, Member, Source, Workspace
from baton.db.session import SessionLocal
from baton.demo_loader import build_demo_workspace
from baton.ledger import recompute_statuses
from baton.main import app
from baton.sandbox import clone_workspace
from baton.status import ClaimState, EvidenceState, compute_status
from baton.verify.quote_match import match


def _chunk(db, ws_id, source_name, needle):
    return db.scalar(select(Chunk).join(Source, Source.id == Chunk.source_id)
                     .where(Chunk.workspace_id == ws_id, Source.name == source_name, Chunk.text.contains(needle)))


def _claim(db, ws, typ, text, chunk=None, quote=None, origin="extracted", subject="x", group=None):
    c = Claim(workspace_id=ws, type=typ, text=text, subject_key=subject, origin=origin, conflict_group_id=group,
              meta={"signal": "FIREBASE_* keys in .env.example"} if origin == "checklist" else {})
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
    base = build_demo_workspace(db, template=False, name="pytest interview base")
    w = base.id
    repo = "devclub/campus-events-app"
    _claim(db, w, "contact", "Who owns the Firebase account/project and its billing", origin="checklist", subject="firebase.owner")
    g = ConflictGroup(workspace_id=w, subject_key="uploads.limit")
    db.add(g)
    db.flush()
    _claim(db, w, "risk", "The poster upload limit is 2 MB.", _chunk(db, w, repo, "MAX_BYTES"), "MAX_BYTES = 2 * 1024 * 1024",
           subject="uploads.limit", group=g.id)
    _claim(db, w, "risk", "The team agreed to raise the poster upload limit to 5 MB.", _chunk(db, w, "Meeting notes", "5 MB"),
           "5 MB", subject="uploads.limit", group=g.id)
    # a Missing item whose only evidence is restricted, to check the leaver-visibility filter and ACL rules
    members = {m.handle: m for m in db.scalars(select(Member).where(Member.workspace_id == w))}
    db.add(Handover(workspace_id=w, leaver_member_id=members["rohan"].id, successor_member_id=members["neha"].id))
    recompute_statuses(db, w)
    ws = clone_workspace(db, w, "iv-visitor")
    db.commit()
    yield {"ws": str(ws)}
    db.execute(delete(Workspace).where(Workspace.id.in_([w, ws])))
    db.commit()
    db.close()


def _c():
    c = TestClient(app)
    c.cookies.set("baton_visitor", "iv-visitor")
    return c


def _p(c, ws):
    return {m["handle"]: m["id"] for m in c.get(f"/api/workspaces/{ws}").json()["members"]}


def h(pid):
    return {"X-Baton-Persona": pid}


def test_acl_intersection_never_widens():
    pub = {"roles": ["all_members"], "members": []}
    core = {"roles": ["reviewer"], "members": ["k", "r"]}
    assert acl_intersection(pub, core) == {"roles": ["reviewer"], "members": ["k", "r"]}
    assert acl_intersection(core, pub) == {"roles": ["reviewer"], "members": ["k", "r"]}
    assert acl_intersection(core, {"roles": ["reviewer"], "members": ["r"]}) == {"roles": ["reviewer"], "members": ["r"]}
    assert acl_intersection(pub, pub)["roles"] == ["all_members"]


def test_testimony_status_rules():
    ev = (EvidenceState(True, "supports", "Leaver testimony · Rohan · 14 Nov · Q1", 100),)
    r = compute_status(ClaimState(origin="testimony", evidence=ev, testimony_from="Rohan, gap interview 14 Nov"))
    assert r.status == "supported" and "Leaver testimony" in r.reason and "Rohan" in r.reason and r.flags.get("testimony")
    assert compute_status(ClaimState(origin="testimony", evidence=ev, review_state="confirmed")).status == "verified"
    m = compute_status(ClaimState(origin="checklist", answered_by="Rohan"))
    assert m.status == "missing" and m.flags == {"answered": True} and "gap interview" in m.reason
    assert compute_status(ClaimState(origin="testimony")).status == "inferred"  # no passing quote -> not shown as fact


def test_full_interview_flow(world):
    c, ws = _c(), world["ws"]
    p = _p(c, ws)
    assert c.post(f"/api/workspaces/{ws}/interviews", headers=h(p["neha"]), json={}).status_code == 403
    r = c.post(f"/api/workspaces/{ws}/interviews", headers=h(p["meera"]), json={})
    assert r.status_code == 200, r.text
    iv = r.json()
    assert iv["status"] == "draft" and iv["respondent"]["name"] == "Rohan" and iv["counts"]["total"] == 2
    kinds = {q["kind"] for q in iv["questions"]}
    assert kinds == {"missing", "conflict"}
    again = c.post(f"/api/workspaces/{ws}/interviews", headers=h(p["meera"]), json={}).json()  # double click
    assert again["id"] == iv["id"] and again["existing"] is True
    iid = iv["id"]
    # drafts are invisible to the leaver
    assert c.get(f"/api/interviews/{iid}", headers=h(p["rohan"])).status_code == 404
    # reviewer adds a custom question, then sends
    iv = c.post(f"/api/interviews/{iid}/questions", headers=h(p["meera"]), json={"question": "Where are the staging credentials kept"}).json()
    assert iv["counts"]["total"] == 3 and iv["questions"][-1]["question"].endswith("?")
    assert c.post(f"/api/interviews/{iid}/send", headers=h(p["meera"])).json()["status"] == "sent"
    # only the leaver answers
    miss = next(q for q in iv["questions"] if q["kind"] == "missing")
    conf = next(q for q in iv["questions"] if q["kind"] == "conflict")
    cust = next(q for q in iv["questions"] if q["kind"] == "custom")
    url = f"/api/interviews/{iid}/questions/{miss['id']}/answer"
    assert c.put(url, headers=h(p["neha"]), json={"answer_kind": "answered", "answer": "x"}).status_code in (403, 404)
    assert c.put(url, headers=h(p["rohan"]), json={"answer_kind": "answered", "answer": ""}).status_code == 422
    secret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"
    ans = f"Rohan's personal Google account; billing card ends 4242. Token {secret}"
    r = c.put(url, headers=h(p["rohan"]), json={"answer_kind": "answered", "answer": ans})
    assert r.status_code == 200 and secret not in r.text
    c.put(url, headers=h(p["rohan"]), json={"answer_kind": "answered", "answer": "Rohan's personal Google account."})  # edit = overwrite
    bad = c.put(f"/api/interviews/{iid}/questions/{conf['id']}/answer", headers=h(p["rohan"]),
                json={"answer_kind": "chose_option", "chosen_claim_id": miss["id"]})
    assert bad.status_code == 422
    five = next(o for o in conf["options"] if "5 MB" in o["text"])
    assert c.put(f"/api/interviews/{iid}/questions/{conf['id']}/answer", headers=h(p["rohan"]),
                 json={"answer_kind": "chose_option", "chosen_claim_id": five["claim_id"]}).status_code == 200
    assert c.put(f"/api/interviews/{iid}/questions/{cust['id']}/answer", headers=h(p["rohan"]),
                 json={"answer_kind": "ask_other", "ask_who": "Kabir"}).status_code == 200
    # questions can't be edited once answering started
    assert c.patch(f"/api/interviews/{iid}/questions/{miss['id']}", headers=h(p["meera"]), json={"question": "changed?"}).status_code == 409
    # submit twice -> one result
    s1 = c.post(f"/api/interviews/{iid}/submit", headers=h(p["rohan"]))
    assert s1.status_code == 200, s1.text
    assert s1.json()["created"] == 1 and s1.json()["status"] == "submitted"
    s2 = c.post(f"/api/interviews/{iid}/submit", headers=h(p["rohan"]))
    assert s2.status_code == 200 and s2.json()["created"] == 0
    assert c.put(url, headers=h(p["rohan"]), json={"answer_kind": "dont_know"}).status_code == 409

    db = SessionLocal()
    try:
        srcs = list(db.scalars(select(Source).where(Source.workspace_id == ws, Source.type == "testimony")))
        assert srcs, "a testimony source was created"
        tclaim = db.scalar(select(Claim).where(Claim.workspace_id == ws, Claim.origin == "testimony"))
        assert tclaim.status == "supported" and "Leaver testimony" in tclaim.status_reason
        ev = db.scalar(select(Evidence).where(Evidence.claim_id == tclaim.id))
        assert ev.quote_found and ev.match_score >= 90 and ev.verifier == "testimony"
        missing = db.scalar(select(Claim).where(Claim.workspace_id == ws, Claim.origin == "checklist"))
        assert (missing.meta.get("flags") or {}).get("answered") is True
        # conflict is NOT resolved by the interview; the chosen claim gained testimony evidence
        five_claim = db.get(Claim, five["claim_id"])
        assert five_claim.status == "conflicting"
        assert db.get(ConflictGroup, five_claim.conflict_group_id).resolved is False
        cited = db.scalars(select(Source.type).join(Chunk, Chunk.source_id == Source.id).join(Evidence, Evidence.chunk_id == Chunk.id)
                           .where(Evidence.claim_id == five_claim.id)).all()
        assert "testimony" in cited
        # testimony about the 5 MB note (all members) stays visible to everyone; nothing wider than its question
        for s in srcs:
            assert s.acl["roles"] in (["all_members"], ["leaver", "reviewer"]) or "reviewer" in s.acl["roles"]
    finally:
        db.close()

    view = c.get(f"/api/interviews/{iid}", headers=h(p["meera"])).json()
    q5 = next(q for q in view["questions"] if q["kind"] == "conflict")
    assert q5["chosen_claim_id"] == five["claim_id"] and q5["conflict_resolved"] is False
    assert next(q for q in view["questions"] if q["kind"] == "custom")["ask_who"] == "Kabir"
    log = c.get(f"/api/workspaces/{ws}/activity", headers=h(p["meera"])).json()["entries"]
    assert any(e["action"] == "interview_submitted" for e in log) and any(e["action"] == "interview_sent" for e in log)
    # a new interview now has only what is still open (the conflict); the answered Missing item isn't asked again
    nxt = c.post(f"/api/workspaces/{ws}/interviews", headers=h(p["meera"]), json={})
    assert nxt.status_code == 200 and {q["kind"] for q in nxt.json()["questions"]} == {"conflict"}


def test_successor_sees_testimony_after_approval_not_before(world):
    c, ws = _c(), world["ws"]
    p = _p(c, ws)
    hid = c.get(f"/api/workspaces/{ws}/handover").json()["handover"]["id"]
    assert c.post(f"/api/handovers/{hid}/approve", headers=h(p["meera"]), json={}).status_code == 200
    view = c.get(f"/api/handovers/{hid}", headers=h(p["neha"])).json()
    texts = [it.get("text", "") for s in view["sections"] for it in s["items"]]
    assert any("Rohan's personal Google account" in t for t in texts)
    assert not any(t.startswith("Who owns the Firebase account/project and its billing") and ":" not in t for t in texts)


def test_on_behalf_and_permissions(world):
    c, ws = _c(), world["ws"]
    p = _p(c, ws)
    # discard the open interview from the previous test (nothing answered yet)
    open_iv = next(i for i in c.get(f"/api/workspaces/{ws}/interviews", headers=h(p["meera"])).json()["interviews"] if i["status"] == "draft")
    assert c.delete(f"/api/interviews/{open_iv['id']}", headers=h(p["kabir"])).status_code == 404
    assert c.delete(f"/api/interviews/{open_iv['id']}", headers=h(p["meera"])).json()["discarded"] is True
    iv = c.post(f"/api/workspaces/{ws}/interviews", headers=h(p["meera"]), json={"on_behalf": True}).json()
    assert iv["on_behalf"] and iv["status"] == "sent" and iv["can_answer"]
    assert c.get(f"/api/workspaces/{ws}/interviews", headers=h(p["kabir"])).json()["interviews"] == []
    q = iv["questions"][0]
    assert c.put(f"/api/interviews/{iv['id']}/questions/{q['id']}/answer", headers=h(p["meera"]), json={"answer_kind": "dont_know"}).status_code == 200
    assert c.post(f"/api/interviews/{iv['id']}/submit", headers=h(p["meera"])).status_code == 200
    # another visitor can't see any of it
    other = TestClient(app)
    other.cookies.set("baton_visitor", "stranger")
    assert other.get(f"/api/interviews/{iv['id']}", headers=h(p["meera"])).status_code == 404
