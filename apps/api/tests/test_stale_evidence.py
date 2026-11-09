"""When a refresh changes a source, evidence follows its quote to the new text, or the claim is flagged and downgraded."""

from sqlalchemy import select

from baton.db.models import Chunk, Claim, Evidence, Source
from baton.db.session import SessionLocal
from baton.demo_loader import build_demo_workspace
from baton.ingest.service import store_chunks
from baton.ingest.types import ChunkDraft
from baton.ledger import recompute_statuses
from baton.routers.claims import _acknowledge_source_change
from baton.status import ClaimState, EvidenceState, compute_status

QUOTE = "We moved push reminders from OneSignal to FCM because the free plan capped devices."


def _notes(db, ws):
    return db.scalar(select(Source).where(Source.workspace_id == ws.id, Source.type == "upload"))


def test_status_explains_source_change():
    r = compute_status(ClaimState(origin="extracted", review_state="confirmed", evidence=(),
                                  source_changed="Meeting notes changed and the quoted text is no longer there"))
    assert r.status == "inferred" and "source changed" in r.reason.lower() and r.flags["source_changed"]
    # passing evidence still wins: a re-anchored quote keeps the claim verified
    ok = EvidenceState(True, "supports", "notes", 100)
    assert compute_status(ClaimState(origin="extracted", review_state="confirmed", evidence=(ok,),
                                     source_changed="x")).status == "verified"


def test_edited_source_reanchors_and_removed_quote_flags_claim():
    db = SessionLocal()
    ws = build_demo_workspace(db, template=False, name="pytest stale")
    src = _notes(db, ws)
    a = ChunkDraft(kind="note_para", text=f"## Push\n{QUOTE}", location={"file": "sync.md", "heading": "Push"})
    b = ChunkDraft(kind="note_para", text="## Other\nNothing to see.", location={"file": "sync.md", "heading": "Other"})
    store_chunks(db, src, [a, b])
    chunk = db.scalar(select(Chunk).where(Chunk.source_id == src.id, Chunk.text.contains("OneSignal")))
    claim = Claim(workspace_id=ws.id, type="decision", text="Reminders moved to FCM", subject_key="push.provider",
                  origin="extracted", review_state="confirmed")
    db.add(claim)
    db.flush()
    db.add(Evidence(claim_id=claim.id, chunk_id=chunk.id, quote=QUOTE, quote_found=True, verdict="supports", match_score=100))
    db.flush()
    recompute_statuses(db, ws.id, [claim.id])
    assert claim.status == "verified"

    # 1) the paragraph is edited around the quote: evidence moves to the new chunk, status unchanged
    a2 = ChunkDraft(kind="note_para", text=f"## Push (updated 3 Nov)\n{QUOTE} Rohan owns it.", location=a.location)
    res = store_chunks(db, src, [a2, b])
    assert res["removed"] == 1 and res["evidence_reanchored"] == 1 and res["claims_source_changed"] == 0
    ev = db.scalar(select(Evidence).where(Evidence.claim_id == claim.id))
    assert ev is not None and ev.chunk_id != chunk.id and ev.quote_found
    recompute_statuses(db, ws.id, [claim.id])
    assert claim.status == "verified"

    # 2) the quote disappears upstream: evidence goes, the claim is flagged and can no longer stay Verified
    res = store_chunks(db, src, [b])
    assert res["claims_source_changed"] == 1
    db.refresh(claim)
    assert claim.meta["source_changed"]["source"] == src.name and claim.meta["needs_rereview"] is True
    assert "sync.md" in claim.meta["source_changed"]["where"] or claim.meta["source_changed"]["where"]
    recompute_statuses(db, ws.id, [claim.id])
    assert claim.status == "inferred" and "source changed" in claim.status_reason.lower()

    # 3) a reviewer acting on it acknowledges the flag
    _acknowledge_source_change(claim)
    assert "source_changed" not in claim.meta and "needs_rereview" not in claim.meta
    db.rollback()
    db.close()
