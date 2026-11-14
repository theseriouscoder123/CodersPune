"""Round 3 improvement #3 (part 2): re-rendering a withheld claim from the successor's accessible sources only.
A fake model records exactly what it was sent, so the test proves no restricted text (and not the withheld claim's own
wording) reaches the AI, and that quotes, verification and status rules apply to the result."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from baton.db.models import Chunk, Claim, Evidence, Handover, Member, Source, Workspace
from baton.db.session import SessionLocal
from baton.demo_loader import build_demo_workspace
from baton.ledger import recompute_statuses
from baton.llm.prompts import Verdict
from baton.main import app
from baton.reconstruct.rerender import Rerendered, looks_like_theirs, search_terms
from baton.routers.rerender import rerender_claim
from baton.sandbox import clone_workspace
from baton.verify.quote_match import match

LOGO = "Neha needs to add the TechNova logo to the app's fest page."


class FakeLLM:
    def __init__(self, quote="the sponsor logo has to be on it before we launch", passage="P1", possible=True):
        self.calls, self.quote, self.passage, self.possible = [], quote, passage, possible

    def structured(self, *, system, user, schema, model, purpose, **kw):
        self.calls.append({"purpose": purpose, "user": user})
        if schema is Verdict:
            return Verdict(verdict="supports", reason="The excerpt says the sponsor logo must be on the fest page.")
        label = next((ln.strip("[]") for ln in user.splitlines() if ln.startswith("[P") and "sponsor logo" in user.split(ln, 1)[1][:400]), self.passage)
        return Rerendered(possible=self.possible, claim="Neha should add the sponsor logo to the fest page before launch.",
                          passage=label if self.passage == "P1" else self.passage, quote=self.quote, reason="stated in #dev")


@pytest.fixture(scope="module")
def world():
    db = SessionLocal()
    base = build_demo_workspace(db, template=False, name="pytest rerender base")
    w = base.id
    ch = db.scalar(select(Chunk).join(Source, Source.id == Chunk.source_id)
                   .where(Chunk.workspace_id == w, Source.name == "#core-team", Chunk.text.contains("neha can add it")))
    c = Claim(workspace_id=w, type="open_work", text=LOGO, subject_key="app.feature", origin="extracted")
    db.add(c)
    db.flush()
    m = match("neha can add it", ch.text)
    db.add(Evidence(claim_id=c.id, chunk_id=ch.id, quote="neha can add it", quote_found=True, match_score=m.score,
                    match_start=m.start, match_end=m.end, verdict="supports", verifier="test"))
    members = {mm.handle: mm for mm in db.scalars(select(Member).where(Member.workspace_id == w))}
    db.add(Handover(workspace_id=w, leaver_member_id=members["rohan"].id, successor_member_id=members["neha"].id))
    recompute_statuses(db, w)
    ws = clone_workspace(db, w, "rr-visitor")
    db.commit()
    yield {"ws": str(ws)}
    db.execute(delete(Workspace).where(Workspace.id.in_([w, ws])))
    db.commit()
    db.close()


def _logo_and_neha(db, ws):
    logo = db.scalar(select(Claim).where(Claim.workspace_id == ws, Claim.text == LOGO))
    neha = db.scalar(select(Member).where(Member.workspace_id == ws, Member.handle == "neha"))
    return logo, neha


def test_helpers():
    assert looks_like_theirs(LOGO, "Neha") == "It names Neha"
    assert looks_like_theirs("TechNova pays only if the app is live by 20 Dec", "Neha") == "It has a deadline"
    assert looks_like_theirs("The stage quote is 28,000", "Neha") is None
    assert "technova" in search_terms(LOGO) and "logo" in search_terms(LOGO)


def test_rerender_sends_only_visible_text_and_creates_a_checked_claim(world):
    db = SessionLocal()
    try:
        logo, neha = _logo_and_neha(db, world["ws"])
        restricted = [c.text for c in db.scalars(select(Chunk).join(Source, Source.id == Chunk.source_id)
                                                 .where(Chunk.workspace_id == world["ws"], Source.name == "#core-team"))]
        llm = FakeLLM()
        out = rerender_claim(db, world["ws"], logo, neha, llm=llm)
        assert out["status"] == "created", out
        rr = next(c for c in llm.calls if c["purpose"] == "rerender")["user"]
        assert "TechNova" not in rr and LOGO not in rr  # neither the withheld wording nor the sponsor's name
        for text in restricted:
            assert text[:60] not in rr  # no restricted chunk text at all
        new = db.get(Claim, out["claim_id"])
        assert new.derived_from == logo.id and new.status == "supported" and "TechNova" not in new.text
        ev = db.scalar(select(Evidence).where(Evidence.claim_id == new.id))
        src = db.scalar(select(Source).join(Chunk, Chunk.source_id == Source.id).where(Chunk.id == ev.chunk_id))
        assert src.name == "#dev" and ev.quote_found
        db.rollback()
    finally:
        db.close()


def test_fabricated_quote_is_discarded(world):
    db = SessionLocal()
    try:
        logo, neha = _logo_and_neha(db, world["ws"])
        out = rerender_claim(db, world["ws"], logo, neha, llm=FakeLLM(quote="TechNova pays forty thousand rupees"))
        assert out["status"] == "quote_not_found"
        assert db.scalar(select(Claim).where(Claim.derived_from == logo.id)) is None
        out = rerender_claim(db, world["ws"], logo, neha, llm=FakeLLM(possible=False))
        assert out["status"] == "not_stated"
        db.rollback()
    finally:
        db.close()


def test_not_withheld_and_endpoint_permissions(world):
    db = SessionLocal()
    try:
        _, neha = _logo_and_neha(db, world["ws"])
        public = db.scalar(select(Claim).where(Claim.workspace_id == world["ws"], Claim.text != LOGO).limit(1))
        if public is not None:
            assert rerender_claim(db, world["ws"], public, neha, llm=FakeLLM())["status"] in ("not_withheld", "no_sources", "created", "not_stated")
        logo, _ = _logo_and_neha(db, world["ws"])
        logo_id = str(logo.id)
    finally:
        db.rollback()
        db.close()
    c = TestClient(app)
    c.cookies.set("baton_visitor", "rr-visitor")
    ws = world["ws"]
    p = {m["handle"]: m["id"] for m in c.get(f"/api/workspaces/{ws}").json()["members"]}
    hid = c.get(f"/api/workspaces/{ws}/handover").json()["handover"]["id"]
    assert c.post(f"/api/handovers/{hid}/rerender/{logo_id}", headers={"X-Baton-Persona": p["neha"]}).status_code == 403
    prev = c.get(f"/api/handovers/{hid}/preview", headers={"X-Baton-Persona": p["meera"]}).json()
    w = next(x for x in prev["withheld"] if x["id"] == logo_id)
    assert w["matters"] == "It names Neha" and w["rerendered"] is None
