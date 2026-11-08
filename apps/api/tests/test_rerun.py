"""Re-runs keep review work: chunk identity survives a refresh, duplicates merge into existing claims, and a
re-plan never undoes a reviewer's conflict decision."""

from sqlalchemy import delete, select

from baton.db.models import Chunk, Claim, ConflictGroup, Evidence, ReviewEvent, Run, Source, Workspace
from baton.db.session import SessionLocal
from baton.demo_loader import build_demo_workspace
from baton.ingest.chat_export import parse_chat_export
from baton.ingest.fixtures import DEMO_DIR
from baton.ingest.service import store_chunks
from baton.pipeline import _reattach, create_run, replan_conflicts


def test_refresh_keeps_chunk_ids_and_evidence():
    db = SessionLocal()
    ws = build_demo_workspace(db, template=False, name="pytest rerun a")
    dev = db.scalar(select(Source).where(Source.workspace_id == ws.id, Source.name == "#dev"))
    chunk = db.scalar(select(Chunk).where(Chunk.source_id == dev.id).limit(1))
    claim = Claim(workspace_id=ws.id, type="decision", text="x", subject_key="x", origin="extracted", review_state="confirmed")
    db.add(claim)
    db.flush()
    db.add(Evidence(claim_id=claim.id, chunk_id=chunk.id, quote=chunk.text[:20], quote_found=True, verdict="supports"))
    db.flush()
    drafts = parse_chat_export((DEMO_DIR / "chat" / "slack_export.json").read_bytes())["dev"]
    res = store_chunks(db, dev, drafts)  # same content again
    assert res["new"] == 0 and res["removed"] == 0
    assert db.get(Chunk, chunk.id) is not None
    assert db.scalar(select(Evidence).where(Evidence.claim_id == claim.id)) is not None
    res = store_chunks(db, dev, drafts[1:])  # one thread disappeared upstream
    assert res["removed"] == 1
    db.rollback()
    db.close()


def test_reattach_merges_new_claim_into_reviewed_one():
    db = SessionLocal()
    ws = build_demo_workspace(db, template=False, name="pytest rerun b")
    chunks = list(db.scalars(select(Chunk).where(Chunk.workspace_id == ws.id).limit(2)))
    old = Claim(workspace_id=ws.id, type="decision", text="Push reminders use Firebase Cloud Messaging",
                subject_key="notifications.provider", origin="extracted", review_state="confirmed")
    db.add(old)
    db.flush()
    db.add(Evidence(claim_id=old.id, chunk_id=chunks[0].id, quote="a", quote_found=True, verdict="supports"))
    run = Run(workspace_id=ws.id, status="running", stats={})
    db.add(run)
    db.flush()
    new = Claim(workspace_id=ws.id, run_id=run.id, type="decision", text="Push reminders use Firebase Cloud Messaging (FCM)",
                subject_key="notifications.provider", origin="extracted")
    db.add(new)
    db.flush()
    db.add(Evidence(claim_id=new.id, chunk_id=chunks[1].id, quote="b"))
    db.flush()
    assert _reattach(db, run.id, ws.id) == 1
    assert db.get(Claim, new.id) is None
    assert {e.chunk_id for e in db.scalars(select(Evidence).where(Evidence.claim_id == old.id))} == {chunks[0].id, chunks[1].id}
    db.rollback()
    db.close()


def test_replan_never_undoes_reviewer_decision_and_refresh_mode():
    db = SessionLocal()
    ws = build_demo_workspace(db, template=False, name="pytest rerun c")
    winner = Claim(workspace_id=ws.id, type="decision", text="Limit is 2 MB", subject_key="upload.max_size", value="2 MB", origin="extracted")
    loser = Claim(workspace_id=ws.id, type="decision", text="Limit is 5 MB", subject_key="upload.max_size", value="5 MB", origin="extracted")
    db.add_all([winner, loser])
    db.flush()
    g = ConflictGroup(workspace_id=ws.id, subject_key="upload.max_size", resolved=True)
    db.add(g)
    db.flush()
    loser.superseded_by = winner.id
    db.add(ReviewEvent(claim_id=loser.id, actor_role="reviewer", action="resolve_superseded"))
    db.flush()
    replan_conflicts(db, ws.id, reset=True)
    assert loser.superseded_by == winner.id  # the reviewer's choice survives
    assert create_run(db, ws.id, mode="refresh").stats["mode"] == "full"  # no previous run -> full
    db.rollback()
    with SessionLocal.begin() as d2:
        d2.execute(delete(Workspace).where(Workspace.name.like("pytest rerun%")))
    db.close()
