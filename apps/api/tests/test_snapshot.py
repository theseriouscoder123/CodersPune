"""Frozen-ledger round trip: export from one ingestion, import onto a fresh one, statuses identical (no LLM)."""

from sqlalchemy import delete, select

from baton.db.models import Chunk, Claim, Evidence, Member, Membership, Source, Workspace
from baton.db.session import SessionLocal
from baton.demo_loader import build_demo_workspace
from baton.demo_snapshot import export_snapshot, import_snapshot
from baton.ledger import recompute_statuses
from baton.verify.quote_match import match


def test_snapshot_round_trip(tmp_path):
    db = SessionLocal()
    a = build_demo_workspace(db, template=False, name="pytest snap a")
    ch = db.scalar(select(Chunk).join(Source, Source.id == Chunk.source_id)
                   .where(Chunk.workspace_id == a.id, Source.name == "#core-team", Chunk.text.contains("TechNova pays")))
    leaver = db.scalar(select(Member.id).join(Membership, Membership.member_id == Member.id)
                       .where(Membership.workspace_id == a.id, Membership.role == "leaver"))
    c1 = Claim(workspace_id=a.id, type="dependency", text="Sponsor deal", subject_key="sponsor.technova", origin="extracted",
               about_member_id=leaver)
    c2 = Claim(workspace_id=a.id, type="contact", text="Who owns Firebase", subject_key="firebase.owner", origin="checklist",
               meta={"signal": "FIREBASE_* in .env.example"})
    db.add_all([c1, c2])
    db.flush()
    q = "TechNova pays ₹40,000 only if the events app is live"
    m = match(q, ch.text)
    db.add(Evidence(claim_id=c1.id, chunk_id=ch.id, quote=q, quote_found=m.found, match_score=m.score,
                    match_start=m.start, match_end=m.end, verdict="supports", verifier="test"))
    recompute_statuses(db, a.id)
    path = tmp_path / "frozen.json"
    assert export_snapshot(db, a.id, path)["claims"] == 2

    b = build_demo_workspace(db, template=False, name="pytest snap b")
    assert import_snapshot(db, b.id, path)["claims"] == 2
    got = {c.subject_key: c.status for c in db.scalars(select(Claim).where(Claim.workspace_id == b.id))}
    assert got == {"sponsor.technova": "supported", "firebase.owner": "missing"}
    # evidence re-attached to the restricted channel of the NEW workspace (ACL preserved)
    src = db.scalar(select(Source.name).join(Chunk, Chunk.source_id == Source.id).join(Evidence, Evidence.chunk_id == Chunk.id)
                    .join(Claim, Claim.id == Evidence.claim_id).where(Claim.workspace_id == b.id))
    assert src == "#core-team"
    db.rollback()
    db.execute(delete(Workspace).where(Workspace.name.like("pytest snap%")))
    db.commit()
    db.close()
