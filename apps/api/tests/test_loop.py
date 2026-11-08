"""The judged loop without the LLM: statuses -> review -> preview -> approve -> projected successor view.

Claims are inserted directly (pipeline output shape) so this runs offline and deterministically.
Acceptance criteria covered: #1 sandbox isolation, #4 restricted claim absent for Neha in every response,
#6 review actions + approval, plus PII masking, inferred-hidden and the 404-not-403 rule.
"""

import json

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

SPONSOR_QUOTE = "TechNova pays ₹40,000 only if the events app is live for the fest by 20 Dec"


def _chunk(db, ws_id, source_name, needle):
    return db.scalar(select(Chunk).join(Source, Source.id == Chunk.source_id)
                     .where(Chunk.workspace_id == ws_id, Source.name == source_name, Chunk.text.contains(needle)))


def _claim(db, ws_id, typ, text, chunk=None, quote=None, verdict="supports", origin="extracted", subject="x"):
    c = Claim(workspace_id=ws_id, type=typ, text=text, subject_key=subject, origin=origin,
              meta={"signal": "FIREBASE_* in .env.example"} if origin == "checklist" else {})
    db.add(c)
    db.flush()
    if chunk is not None:
        m = match(quote, chunk.text)
        db.add(Evidence(claim_id=c.id, chunk_id=chunk.id, quote=quote, quote_found=m.found, match_score=m.score,
                        match_start=m.start, match_end=m.end, verdict=verdict if m.found else "pending",
                        verifier="test"))
    return c


@pytest.fixture(scope="module")
def world():
    db = SessionLocal()
    base = build_demo_workspace(db, template=False, name="pytest loop base")
    w = base.id
    repo = "devclub/campus-events-app"
    _claim(db, w, "decision", "Push reminders moved from OneSignal to FCM because of the free-plan device cap.",
           _chunk(db, w, repo, "OneSignal free plan"), "The OneSignal free plan caps us at the device limit before fest",
           subject="notifications.provider")
    _claim(db, w, "dependency", "Sponsor TechNova pays Rs 40,000 only if the app is live by 20 Dec.",
           _chunk(db, w, "#core-team", "TechNova pays"), SPONSOR_QUOTE, subject="sponsor.technova")
    _claim(db, w, "contact", "Who owns the Firebase account/project and its billing", origin="checklist", subject="firebase.owner")
    _claim(db, w, "open_question", "The leaderboard was abandoned because nobody liked it.",
           _chunk(db, w, repo, "parking this for now"), "abandoned because nobody liked it", subject="leaderboard.status")
    _claim(db, w, "contact", "Rohan can be called if a deploy breaks.",
           _chunk(db, w, "#dev", "call me on"), "call me on +91 90000 00000 if deploy breaks", subject="deploy.contact")
    members = {m.handle: m for m in db.scalars(select(Member).where(Member.workspace_id == w))}
    db.add(Handover(workspace_id=w, leaver_member_id=members["rohan"].id, successor_member_id=members["neha"].id))
    recompute_statuses(db, w)
    s1 = clone_workspace(db, w, "visitor-one")
    s2 = clone_workspace(db, w, "visitor-two")
    db.commit()
    yield {"s1": str(s1), "s2": str(s2)}
    db.execute(delete(Workspace).where(Workspace.id.in_([w, s1, s2])))
    db.commit()
    db.close()


def client(visitor):
    c = TestClient(app)
    c.cookies.set("baton_visitor", visitor)
    return c


def personas(c, ws):
    return {m["handle"]: m["id"] for m in c.get(f"/api/workspaces/{ws}").json()["members"]}


def as_(pid):
    return {"X-Baton-Persona": pid}


def ledger(c, ws, pid, **params):
    r = c.get(f"/api/workspaces/{ws}/claims", headers=as_(pid), params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_statuses_from_rules(world):
    c = client("visitor-one")
    p = personas(c, world["s1"])
    by_text = {x["text"][:20]: x for x in ledger(c, world["s1"], p["meera"])["claims"]}
    assert by_text["Push reminders moved"]["status"] == "supported"
    assert by_text["Sponsor TechNova pay"]["status"] == "supported"
    assert by_text["Who owns the Firebas"]["status"] == "missing"
    assert by_text["The leaderboard was "]["status"] == "inferred"  # fabricated quote never passes
    assert "quote not found" in by_text["The leaderboard was "]["status_reason"]


def test_successor_has_no_ledger_and_sees_nothing_before_approval(world):
    c = client("visitor-two")
    p = personas(c, world["s2"])
    assert c.get(f"/api/workspaces/{world['s2']}/claims", headers=as_(p["neha"])).status_code == 403
    hid = c.get(f"/api/workspaces/{world['s2']}/handover").json()["handover"]["id"]
    r = c.get(f"/api/handovers/{hid}", headers=as_(p["neha"])).json()
    assert r["approved"] is False and "being prepared by Meera" in r["message"]


def test_full_loop_review_preview_approve_successor(world):
    c = client("visitor-one")
    ws = world["s1"]
    p = personas(c, ws)
    claims = {x["text"][:20]: x for x in ledger(c, ws, p["meera"])["claims"]}

    # Review actions
    fcm = claims["Push reminders moved"]["id"]
    r = c.post(f"/api/claims/{fcm}/review", headers=as_(p["meera"]), json={"action": "confirm"}).json()
    assert r["claim"]["status"] == "verified"
    inferred = claims["The leaderboard was "]["id"]
    assert c.post(f"/api/claims/{inferred}/review", headers=as_(p["meera"]), json={"action": "promote"}).status_code == 422
    assert c.post(f"/api/claims/{fcm}/review", headers=as_(p["neha"]), json={"action": "confirm"}).status_code in (403, 404)
    assert c.post(f"/api/claims/{fcm}/review", headers=as_(p["rohan"]), json={"action": "reject"}).status_code == 403
    assert c.post(f"/api/claims/{fcm}/review", headers=as_(p["rohan"]), json={"action": "comment", "note": "correct"}).status_code == 200

    # Preview as Neha: sponsor withheld with a reason, inferred never shown
    hid = c.get(f"/api/workspaces/{ws}/handover").json()["handover"]["id"]
    pv = c.get(f"/api/handovers/{hid}/preview", headers=as_(p["meera"]), params={"as": p["neha"]}).json()
    assert any("TechNova" in w["text"] and "#core-team" in w["reason"] for w in pv["withheld"])
    assert not any("TechNova" in v["text"] for v in pv["visible"])
    assert not any("leaderboard" in v["text"].lower() for v in pv["visible"])

    # Approve, then the successor sees exactly the preview's visible set
    assert c.post(f"/api/handovers/{hid}/approve", headers=as_(p["neha"]), json={}).status_code == 403
    assert c.post(f"/api/handovers/{hid}/approve", headers=as_(p["meera"]), json={"note": "v1"}).json()["version"] == 1
    h = c.get(f"/api/handovers/{hid}", headers=as_(p["neha"]))
    body = h.json()
    shown = {it["claim_id"] for s in body["sections"] for it in s["items"] if not it.get("restricted")}
    assert shown == {v["id"] for v in pv["visible"]}
    assert "TechNova" not in h.text and "40,000" not in h.text                       # acceptance #4
    unresolved = next(s for s in body["sections"] if s["key"] == "unresolved")
    assert any("Firebase" in it["text"] for it in unresolved["items"])

    # Evidence drawer: PII masked for Neha; restricted evidence is a 404 for her
    pii_item = next(it for s in body["sections"] for it in s["items"] if "called if a deploy" in it.get("text", ""))
    ev = c.get(f"/api/handovers/{hid}/evidence/{pii_item['evidence'][0]['evidence_id']}", headers=as_(p["neha"]))
    assert ev.status_code == 200 and "90000 00000" not in ev.text and "+91 90" in ev.text
    rohan_view = c.get(f"/api/handovers/{hid}", headers=as_(p["rohan"])).json()
    sponsor = next(it for s in rohan_view["sections"] for it in s["items"] if "TechNova" in it.get("text", ""))
    assert c.get(f"/api/handovers/{hid}/evidence/{sponsor['evidence'][0]['evidence_id']}",
                 headers=as_(p["neha"])).status_code == 404

    # Neha never gets the sponsor claim through ANY endpoint (404, not 403: existence isn't leaked)
    assert c.get(f"/api/claims/{sponsor['claim_id']}", headers=as_(p["neha"])).status_code == 404
    for path in (f"/api/workspaces/{ws}/sources", f"/api/workspaces/{ws}", f"/api/handovers/{hid}/export.md"):
        assert "TechNova" not in c.get(path, headers=as_(p["neha"])).text, path


def test_sandboxes_are_isolated(world):
    one, two = client("visitor-one"), client("visitor-two")
    # visitor-one confirmed the FCM claim in the previous test; visitor-two's copy is untouched
    p2 = personas(two, world["s2"])
    fcm = next(x for x in ledger(two, world["s2"], p2["meera"])["claims"] if x["text"].startswith("Push reminders"))
    assert fcm["status"] == "supported"
    assert two.get(f"/api/workspaces/{world['s1']}").status_code == 404  # can't open another visitor's sandbox
    assert one.get(f"/api/workspaces/{world['s2']}").status_code == 404


def test_no_secret_in_any_response(world):
    golden = json.load(open("../../demo/golden_ledger.json", encoding="utf-8"))
    c = client("visitor-one")
    p = personas(c, world["s1"])
    texts = [c.get(f"/api/workspaces/{world['s1']}/sources").text,
             c.get(f"/api/workspaces/{world['s1']}/claims", headers=as_(p["meera"])).text]
    for cl in ledger(c, world["s1"], p["meera"])["claims"]:
        texts.append(c.get(f"/api/claims/{cl['id']}", headers=as_(p["meera"])).text)
    for secret in golden["secrets"]:
        assert all(secret not in t for t in texts)


def test_bulk_confirm_skips_claims_without_passing_evidence(world):
    c = client("visitor-two")
    ws = world["s2"]
    p = personas(c, ws)
    claims = ledger(c, ws, p["meera"])["claims"]
    ids = [x["id"] for x in claims]
    r = c.post(f"/api/workspaces/{ws}/claims/bulk-review", headers=as_(p["meera"]), json={"claim_ids": ids, "action": "confirm"})
    body = r.json()
    assert r.status_code == 200 and body["updated"] >= 1 and body["skipped"] >= 2  # missing + inferred never confirmed
    after = {x["text"][:20]: x["status"] for x in ledger(c, ws, p["meera"])["claims"]}
    assert after["The leaderboard was "] == "inferred" and after["Who owns the Firebas"] == "missing"
    assert ledger(c, ws, p["meera"])["progress"]["reviewed"] == body["updated"]
    assert c.post(f"/api/workspaces/{ws}/claims/bulk-review", headers=as_(p["neha"]),
                  json={"claim_ids": ids, "action": "reject"}).status_code == 403


def test_pipeline_health_is_admin_only(world):
    c = client("visitor-one")
    ws = world["s1"]
    p = personas(c, ws)
    r = c.get(f"/api/workspaces/{ws}/pipeline-health", headers=as_(p["meera"]))
    assert r.status_code == 200 and {"config", "totals", "by_model", "runs"} <= set(r.json())
    assert "api_key" not in r.text.lower()
    assert c.get(f"/api/workspaces/{ws}/pipeline-health", headers=as_(p["neha"])).status_code == 403


def test_scoped_second_handover_for_kabir(world):
    c = client("visitor-two")
    ws = world["s2"]
    p = personas(c, ws)
    r = c.post(f"/api/workspaces/{ws}/handovers", headers=as_(p["meera"]),
               json={"name": "Sponsor & deploy", "leaver_member_id": p["rohan"], "successor_member_id": p["kabir"], "scope": "sponsor, deploy"})
    assert r.status_code == 200, r.text
    h = r.json()["handover"]["id"]
    pv = c.get(f"/api/handovers/{h}/preview", headers=as_(p["meera"]), params={"as": p["kabir"]}).json()
    texts = [v["text"] for v in pv["visible"]]
    assert pv["scope"] == ["sponsor", "deploy"]
    assert any("TechNova" in t for t in texts)          # Kabir may read #core-team, and it's in scope
    assert not any("leaderboard" in t.lower() or "OneSignal" in t for t in texts)  # out of scope
    # Neha sees only her own handover in the list; Kabir only his
    assert [x["id"] for x in c.get(f"/api/workspaces/{ws}/handovers", headers=as_(p["kabir"])).json()["handovers"]] == [h]
    assert h not in [x["id"] for x in c.get(f"/api/workspaces/{ws}/handovers", headers=as_(p["neha"])).json()["handovers"]]
    assert c.post(f"/api/workspaces/{ws}/handovers", headers=as_(p["neha"]),
                  json={"leaver_member_id": p["rohan"], "successor_member_id": p["neha"]}).status_code == 403


class _FakeLLM:
    def __init__(self, result):
        self.result, self.prompts = result, []

    def structured(self, *, system, user, schema, model, purpose, **kw):
        self.prompts.append(user)
        return schema.model_validate(self.result)


def _ask_setup(monkeypatch, result):
    from types import SimpleNamespace

    import baton.routers.ask as ask_mod

    fake = _FakeLLM(result)
    monkeypatch.setattr(ask_mod, "get_llm", lambda: fake)
    monkeypatch.setattr(ask_mod, "get_settings", lambda: SimpleNamespace(llm_configured=True, llm_model_verify="fake"))
    return fake


def test_ask_uses_only_projected_claims_and_validates_citations(world, monkeypatch):
    c = client("visitor-one")  # this sandbox has an approved v1 from the full-loop test
    ws = world["s1"]
    p = personas(c, ws)
    hid = c.get(f"/api/workspaces/{ws}/handover").json()["handover"]["id"]

    fake = _ask_setup(monkeypatch, {"answered": True, "answer": "Reminders moved to FCM.", "cited": ["I1"]})
    r = c.post(f"/api/handovers/{hid}/ask", headers=as_(p["neha"]), json={"question": "Why did push reminders change?"}).json()
    assert r["answered"] is True and r["citations"]
    assert "TechNova" not in fake.prompts[-1] and "40,000" not in fake.prompts[-1]  # restricted text never reaches the model

    _ask_setup(monkeypatch, {"answered": True, "answer": "Made-up answer", "cited": ["I99"]})  # fabricated citation
    r = c.post(f"/api/handovers/{hid}/ask", headers=as_(p["neha"]), json={"question": "What is the sponsor deal?"}).json()
    assert r["answered"] is False and "doesn't cover" in r["fallback"]

    _ask_setup(monkeypatch, {"answered": True, "answer": "Uncited", "cited": []})
    assert c.post(f"/api/handovers/{hid}/ask", headers=as_(p["neha"]), json={"question": "anything?"}).json()["answered"] is False
    assert c.post(f"/api/handovers/{hid}/ask", headers=as_(p["kabir"]), json={"question": "anything?"}).status_code == 403
