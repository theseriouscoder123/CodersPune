"""Freeze a pipeline result for the demo and restore it without any LLM calls (DECISIONS D4/D15).

The snapshot is the real output of a past pipeline run on the synthetic dataset (claims, quotes, verifier verdicts),
keyed to chunks by a content hash so it re-attaches to a fresh, deterministic ingestion. Statuses are recomputed by
status.py on import, so the rules, not the file, decide them.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from baton.db.models import (
    Chunk,
    Claim,
    ConflictGroup,
    Evidence,
    Handover,
    Job,
    Member,
    Membership,
    Run,
    Source,
)
from baton.ingest.fixtures import DEMO_DIR
from baton.ledger import rebuild_relations, recompute_statuses

SNAPSHOT = DEMO_DIR / "frozen_ledger.json"


def chunk_key(source_name: str, kind: str, text: str) -> str:
    return hashlib.sha1(f"{source_name}\x00{kind}\x00{text}".encode()).hexdigest()[:20]


def export_snapshot(db: Session, workspace_id, path: Path = SNAPSHOT) -> dict:
    chunks = {ch.id: chunk_key(src.name, ch.kind, ch.text) for ch, src in db.execute(
        select(Chunk, Source).join(Source, Source.id == Chunk.source_id).where(Chunk.workspace_id == workspace_id))}
    claims = list(db.scalars(select(Claim).where(Claim.workspace_id == workspace_id).order_by(Claim.created_at)))
    keys = {c.id: f"c{i}" for i, c in enumerate(claims)}
    groups = {g.id: g.subject_key for g in db.scalars(select(ConflictGroup).where(ConflictGroup.workspace_id == workspace_id))}
    ev = {}
    for e in db.scalars(select(Evidence).where(Evidence.claim_id.in_(list(keys)))):
        ev.setdefault(e.claim_id, []).append(e)
    run = db.scalars(select(Run).where(Run.workspace_id == workspace_id).order_by(Run.created_at.desc())).first()
    jobs = list(db.scalars(select(Job).where(Job.run_id == run.id))) if run else []
    data = {
        "note": "Real output of a Baton pipeline run on the SYNTHETIC demo dataset, frozen so judges never wait on an LLM.",
        "frozen_at": datetime.now(UTC).isoformat(),
        "run": {"started_at": run.started_at.isoformat() if run and run.started_at else None,
                "finished_at": run.finished_at.isoformat() if run and run.finished_at else None,
                "steps": [{"step": j.step, "message": j.message, "progress": j.progress, "total": j.total} for j in jobs]},
        "claims": [{
            "key": keys[c.id], "type": c.type, "text": c.text, "subject_key": c.subject_key, "value": c.value,
            "occurred_at": c.occurred_at.isoformat() if c.occurred_at else None, "origin": c.origin, "stated": c.stated,
            "supersedes_hint": c.supersedes_hint, "superseded_by": keys.get(c.superseded_by),
            "conflict": groups.get(c.conflict_group_id), "about_leaver": c.about_member_id is not None,
            "meta": {k: v for k, v in (c.meta or {}).items() if k != "flags"},
            "evidence": [{"chunk": chunks[e.chunk_id], "quote": e.quote, "match_score": e.match_score,
                          "quote_found": e.quote_found, "match_start": e.match_start, "match_end": e.match_end,
                          "verdict": e.verdict, "verdict_reason": e.verdict_reason, "verifier": e.verifier}
                         for e in ev.get(c.id, [])],
        } for c in claims if c.review_state == "none"],
    }
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    return {"claims": len(data["claims"]), "path": str(path)}


def import_snapshot(db: Session, workspace_id, path: Path = SNAPSHOT) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    chunks = {chunk_key(src.name, ch.kind, ch.text): ch.id for ch, src in db.execute(
        select(Chunk, Source).join(Source, Source.id == Chunk.source_id).where(Chunk.workspace_id == workspace_id))}
    roles = dict(db.execute(select(Membership.role, Member.id).join(Member, Member.id == Membership.member_id)
                            .where(Membership.workspace_id == workspace_id)).all())
    leaver, successor = roles.get("leaver"), roles.get("successor")

    run = Run(workspace_id=workspace_id, status="done", started_at=_dt(data["run"]["started_at"]),
              finished_at=_dt(data["run"]["finished_at"]), stats={"frozen": True})
    db.add(run)
    db.flush()
    for s in data["run"]["steps"]:
        db.add(Job(run_id=run.id, step=s["step"], status="done", message=s["message"], progress=s["progress"], total=s["total"]))

    groups: dict[str, ConflictGroup] = {}
    made: dict[str, Claim] = {}
    missing_chunks = 0
    for c in data["claims"]:
        claim = Claim(workspace_id=workspace_id, run_id=run.id, type=c["type"], text=c["text"], subject_key=c["subject_key"],
                      value=c["value"], occurred_at=_dt(c["occurred_at"]), origin=c["origin"], stated=c["stated"],
                      supersedes_hint=c["supersedes_hint"], about_member_id=leaver if c["about_leaver"] else None,
                      meta=c["meta"])
        if c["conflict"]:
            if c["conflict"] not in groups:
                groups[c["conflict"]] = ConflictGroup(workspace_id=workspace_id, subject_key=c["conflict"])
                db.add(groups[c["conflict"]])
                db.flush()
            claim.conflict_group_id = groups[c["conflict"]].id
        db.add(claim)
        db.flush()
        made[c["key"]] = claim
        for e in c["evidence"]:
            chunk_id = chunks.get(e["chunk"])
            if chunk_id is None:
                missing_chunks += 1
                continue
            db.add(Evidence(claim_id=claim.id, chunk_id=chunk_id, quote=e["quote"], match_score=e["match_score"],
                            quote_found=e["quote_found"], match_start=e["match_start"], match_end=e["match_end"],
                            verdict=e["verdict"], verdict_reason=e["verdict_reason"], verifier=e["verifier"]))
    for c in data["claims"]:
        if c["superseded_by"] and c["superseded_by"] in made:
            made[c["key"]].superseded_by = made[c["superseded_by"]].id
    if leaver and successor:
        db.add(Handover(workspace_id=workspace_id, leaver_member_id=leaver, successor_member_id=successor))
    db.flush()
    recompute_statuses(db, workspace_id)
    rebuild_relations(db, workspace_id)  # improvement #2: relation signals + stale open work, no LLM
    if missing_chunks:
        raise RuntimeError(f"{missing_chunks} evidence items no longer match the demo data; re-run the live pipeline")
    return {"claims": len(made)}


def _dt(s):
    return datetime.fromisoformat(s) if s else None
