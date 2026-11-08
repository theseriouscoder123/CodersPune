"""Resumable pipeline (DECISIONS D8). `advance(run_id, budget_s)` does a bounded slice of work and checkpoints after
every unit (an extraction batch, a checklist item, a verification), so a killed request only repeats its last unit.

Steps (docs/03): ingest -> checklist -> extract -> cover -> match -> verify -> conflicts -> status -> handover
"""

from __future__ import annotations

import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.orm import Session

from baton.config import get_settings
from baton.db.models import (
    Chunk,
    Claim,
    ConflictGroup,
    Evidence,
    Handover,
    Job,
    Member,
    Membership,
    ReviewEvent,
    Run,
    Source,
    Workspace,
)
from baton.db.session import SessionLocal
from baton.ledger import recompute_statuses
from baton.llm.base import LLMError, LLMNotConfigured, get_llm
from baton.llm.prompts import COVER_SYSTEM, CoverResult
from baton.reconstruct.checklist import build_checklist
from baton.reconstruct.conflicts import ClaimLite, plan_conflicts
from baton.reconstruct.extractor import ChunkRef, dedupe, extract_batch, make_batches
from baton.reconstruct.refs import source_ref
from baton.verify.entailment import excerpt, verify
from baton.verify.quote_match import match

STEPS = ["ingest", "checklist", "extract", "cover", "match", "verify", "conflicts", "status", "handover"]
STEP_LABELS = {"ingest": "Ingest sources", "checklist": "Build expected-knowledge checklist", "extract": "Extract claims",
               "cover": "Search sources for checklist items", "match": "Match quotes to sources",
               "verify": "Verify evidence (separate model)", "conflicts": "Detect conflicts and reversals",
               "status": "Assign statuses (rules)", "handover": "Prepare handover"}
PARALLEL = 4
VERIFY_PARALLEL = 3  # the verify model has the tightest free-tier rate limit
LEASE = timedelta(seconds=330)


class RunBusy(Exception):
    pass


# ------------------------------------------------------------------------------------------------ run lifecycle

def create_run(db: Session, workspace_id) -> Run:
    busy = db.scalar(select(Run).where(Run.workspace_id == workspace_id, Run.status.in_(["queued", "running"])))
    if busy:
        raise RunBusy(str(busy.id))
    run = Run(workspace_id=workspace_id, status="queued", stats={})
    db.add(run)
    db.flush()
    for step in STEPS:
        db.add(Job(run_id=run.id, step=step, status="pending", message=STEP_LABELS[step]))
    db.flush()
    return run


def _acquire(run_id) -> bool:
    """Atomic lease so two tabs can't advance the same run concurrently."""
    now = datetime.now(UTC)
    with SessionLocal.begin() as db:
        res = db.execute(text(
            "UPDATE runs SET stats = jsonb_set(stats, '{lease_until}', to_jsonb(CAST(:until AS text))) "
            "WHERE id = :id AND status IN ('queued','running') "
            "AND (stats->>'lease_until' IS NULL OR (stats->>'lease_until')::timestamptz < :now)"),
            {"id": str(run_id), "until": (now + LEASE).isoformat(), "now": now})
        return res.rowcount == 1


def _release(run_id) -> None:
    with SessionLocal.begin() as db:
        db.execute(text("UPDATE runs SET stats = stats - 'lease_until' WHERE id = :id"), {"id": str(run_id)})


def advance(run_id, budget_s: float | None = None) -> dict:
    budget_s = budget_s if budget_s is not None else get_settings().pipeline_slice_seconds
    deadline = time.monotonic() + budget_s
    if not _acquire(run_id):
        return run_progress(run_id)
    try:
        while time.monotonic() < deadline:
            with SessionLocal.begin() as db:
                run = db.get(Run, run_id)
                if run.status not in ("queued", "running"):
                    break
                if run.status == "queued":
                    run.status, run.started_at = "running", datetime.now(UTC)
                open_jobs = list(db.scalars(select(Job).where(Job.run_id == run_id, Job.status.in_(["pending", "running"]))))
                # Jobs share one created_at (same transaction), so order by pipeline position, never by timestamp.
                job = min(open_jobs, key=lambda j: STEPS.index(j.step)) if open_jobs else None
                if job is None:
                    _finish(db, run)
                    break
                job.status = "running"
                job_id, step, workspace_id = job.id, job.step, run.workspace_id
            try:
                done = HANDLERS[step](run_id, job_id, workspace_id, deadline)
            except LLMNotConfigured as exc:
                _fail(run_id, job_id, exc.user_message)
                break
            except Exception as exc:  # noqa: BLE001 - a step failure must surface as a clear run error, not a crash
                _fail(run_id, job_id, f"{STEP_LABELS[step]} failed: {getattr(exc, 'user_message', None) or type(exc).__name__}: {str(exc)[:200]}")
                break
            if done:
                with SessionLocal.begin() as db:
                    j = db.get(Job, job_id)
                    j.status, j.updated_at = "done", datetime.now(UTC)
    finally:
        _release(run_id)
    return run_progress(run_id)


def run_to_completion(run_id, slice_s: float = 120) -> dict:
    """CLI helper (seed_demo / local): keep advancing until the run ends."""
    while True:
        p = advance(run_id, slice_s)
        if p["status"] not in ("queued", "running"):
            return p
        time.sleep(0.2)


def _fail(run_id, job_id, message: str) -> None:
    with SessionLocal.begin() as db:
        j = db.get(Job, job_id)
        j.status, j.message, j.updated_at = "failed", message, datetime.now(UTC)
        run = db.get(Run, run_id)
        run.status, run.error, run.finished_at = "failed", message, datetime.now(UTC)


def _finish(db: Session, run: Run) -> None:
    counts = dict(db.execute(select(Claim.status, func.count()).where(Claim.workspace_id == run.workspace_id)
                             .group_by(Claim.status)).all())
    run.status, run.finished_at = "done", datetime.now(UTC)
    run.stats = {**{k: v for k, v in (run.stats or {}).items() if k != "lease_until"}, "status_counts": counts}


def run_progress(run_id) -> dict:
    with SessionLocal() as db:
        run = db.get(Run, run_id)
        jobs = sorted(db.scalars(select(Job).where(Job.run_id == run_id)), key=lambda j: STEPS.index(j.step) if j.step in STEPS else 99)
        return {
            "id": str(run.id), "workspace_id": str(run.workspace_id), "status": run.status, "error": run.error,
            "started_at": run.started_at.isoformat() if run.started_at else None,
            "finished_at": run.finished_at.isoformat() if run.finished_at else None,
            "stats": {k: v for k, v in (run.stats or {}).items() if k != "lease_until"},
            "steps": [{"step": j.step, "label": STEP_LABELS.get(j.step, j.step), "status": j.status,
                       "progress": j.progress, "total": j.total, "message": j.message,
                       "errors": (j.state or {}).get("errors", [])[-5:]} for j in jobs],
        }


def _set_job(job_id, **kw) -> None:
    with SessionLocal.begin() as db:
        j = db.get(Job, job_id)
        for k, v in kw.items():
            setattr(j, k, v)
        j.updated_at = datetime.now(UTC)


def _job_error(job_id, msg: str) -> None:
    with SessionLocal.begin() as db:
        j = db.get(Job, job_id)
        state = dict(j.state or {})
        state["errors"] = (state.get("errors") or []) + [msg[:240]]
        j.state = state


# ------------------------------------------------------------------------------------------------ helpers

def _people(db: Session, workspace_id):
    rows = db.execute(select(Member, Membership.role).join(Membership, Membership.member_id == Member.id)
                      .where(Membership.workspace_id == workspace_id)).all()
    roles: dict = {}
    members: dict = {}
    for m, r in rows:
        members[m.id] = m
        roles.setdefault(m.id, []).append(r)
    leaver = next((members[i] for i, rs in roles.items() if "leaver" in rs), None)
    successor = next((members[i] for i, rs in roles.items() if "successor" in rs), None)
    return members, roles, leaver, successor


def _context_header(db: Session, workspace_id) -> tuple[str, str]:
    ws = db.get(Workspace, workspace_id)
    members, roles, leaver, _ = _people(db, workspace_id)
    people = "; ".join(f"{m.display_name} (handle {m.handle}; {', '.join(sorted(roles[i]))})" for i, m in members.items())
    repo = db.scalar(select(Source.name).where(Source.workspace_id == workspace_id, Source.type.in_(["fixture", "github_repo"])))
    leaver_name = leaver.display_name if leaver else "the departing member"
    return (f"Project: {ws.name}. Repository: {repo or 'n/a'}. People: {people}. "
            f"The person leaving is {leaver_name}."), leaver_name


def _chunk_label(ch: Chunk, src: Source) -> str:
    when = ch.occurred_at.date().isoformat() if ch.occurred_at else "undated"
    who = f" · author: {ch.author}" if ch.author else ""
    return f"{ch.kind} · {source_ref(ch.kind, ch.location, ch.occurred_at, src.name)} · {when}{who}"


def _waves(units: list, deadline: float, fn, on_result, parallel: int = PARALLEL) -> int:
    """Run `fn(unit)` in parallel waves until the deadline; `on_result(unit, result|exception)` in the main thread."""
    done = 0
    with ThreadPoolExecutor(max_workers=parallel) as pool:
        i = 0
        while i < len(units) and time.monotonic() < deadline:
            wave = units[i : i + parallel]
            futures = [(u, pool.submit(fn, u)) for u in wave]
            for u, f in futures:
                try:
                    on_result(u, f.result())
                except LLMNotConfigured:
                    raise
                except Exception as exc:  # noqa: BLE001
                    on_result(u, exc)
                done += 1
            i += len(wave)
    return done


# ------------------------------------------------------------------------------------------------ steps

def step_ingest(run_id, job_id, workspace_id, deadline) -> bool:
    with SessionLocal() as db:
        pending = list(db.scalars(select(Source).where(Source.workspace_id == workspace_id, Source.ingested_at.is_(None))))
        total = db.scalar(select(func.count()).select_from(Source).where(Source.workspace_id == workspace_id))
    if pending:
        # Custom-workspace sources are ingested when created (M5 adds live re-ingest here).
        raise RuntimeError(f"{len(pending)} source(s) have not been ingested")
    _set_job(job_id, progress=total, total=total, message=f"{total} sources ready")
    return True


def step_checklist(run_id, job_id, workspace_id, deadline) -> bool:
    with SessionLocal.begin() as db:
        # A new run replaces claims nobody has reviewed; reviewed claims are kept.
        reviewed = select(ReviewEvent.claim_id)
        stale = select(Claim.id).where(Claim.workspace_id == workspace_id, Claim.review_state == "none",
                                       Claim.id.not_in(reviewed))
        db.execute(update(Claim).where(Claim.superseded_by.in_(stale)).values(superseded_by=None))
        db.execute(delete(Claim).where(Claim.id.in_(stale)))
        db.execute(update(Claim).where(Claim.workspace_id == workspace_id).values(conflict_group_id=None, superseded_by=None))
        db.execute(delete(ConflictGroup).where(ConflictGroup.workspace_id == workspace_id, ConflictGroup.resolved.is_(False)))

        _, _, leaver, _ = _people(db, workspace_id)
        repo = db.scalar(select(Source).where(Source.workspace_id == workspace_id, Source.type.in_(["fixture", "github_repo"])))
        items = build_checklist((repo.meta or {}).get("signals", {}), leaver.handle, leaver.display_name) if repo and leaver else []
        for it in items:
            c = Claim(workspace_id=workspace_id, run_id=run_id, type=it.type, text=it.text, subject_key=it.subject_key,
                      origin="checklist", about_member_id=leaver.id,
                      meta={"signal": it.signal, "question": it.text, "terms": it.terms})
            db.add(c)
            db.flush()
            if it.stats_path:
                ch = db.scalar(select(Chunk).where(Chunk.source_id == repo.id, Chunk.kind == "commit_stats",
                                                   Chunk.location["file"].astext == it.stats_path))
                if ch:
                    db.add(Evidence(claim_id=c.id, chunk_id=ch.id, quote=it.stats_line))
                    c.occurred_at = ch.occurred_at
        job = db.get(Job, job_id)
        job.progress = job.total = len(items)
        job.message = f"{len(items)} expected items from the repository"
    return True


def step_extract(run_id, job_id, workspace_id, deadline) -> bool:
    s = get_settings()
    llm = get_llm()
    with SessionLocal() as db:
        job = db.get(Job, job_id)
        state = dict(job.state or {})
        rows = db.execute(select(Chunk, Source).join(Source, Source.id == Chunk.source_id)
                          .where(Chunk.workspace_id == workspace_id)).all()
        refs = {str(ch.id): ChunkRef(str(ch.id), ch.acl_key, ch.kind, ch.text, ch.occurred_at, _chunk_label(ch, src))
                for ch, src in rows}
        if "batches" not in state:
            state["batches"] = [{"acl_key": b.acl_key, "chunks": b.chunk_ids} for b in make_batches(list(refs.values()))]
            state["done"] = []
            state["keys"] = {}
            _set_job(job_id, state=state, total=len(state["batches"]), progress=0)
        header, leaver_name = _context_header(db, workspace_id)

    todo = [i for i in range(len(state["batches"])) if i not in state["done"]]
    broad = [k for acl, ks in state["keys"].items() if "r:all_members" in acl.split("|") for k in ks]

    def run_batch(i):
        b = state["batches"][i]
        known = broad + state["keys"].get(b["acl_key"], [])  # never share keys from narrower groups
        return extract_batch(llm, s.llm_model_extract, [refs[c] for c in b["chunks"] if c in refs],
                             leaver_name=leaver_name, context_header=header, known_keys=known,
                             workspace_id=workspace_id, run_id=run_id)

    def save(i, result):
        if isinstance(result, Exception):
            _job_error(job_id, f"batch {i + 1}: {getattr(result, 'user_message', None) or type(result).__name__}")
            claims = []
        else:
            claims = result
        with SessionLocal.begin() as db:
            for c in claims:
                claim = Claim(workspace_id=workspace_id, run_id=run_id, type=c["type"], text=c["text"],
                              subject_key=c["subject_key"], value=c["value"], occurred_at=c["occurred_at"],
                              origin="extracted", stated=c["stated"], supersedes_hint=c["supersedes_hint"])
                db.add(claim)
                db.flush()
                for e in c["evidence"]:
                    db.add(Evidence(claim_id=claim.id, chunk_id=e["chunk_id"], quote=e["quote"]))
            j = db.get(Job, job_id)
            st = dict(j.state)
            st["done"] = sorted(set(st["done"]) | {i})
            acl = st["batches"][i]["acl_key"]
            st["keys"] = {**st["keys"], acl: sorted(set(st["keys"].get(acl, [])) | {c["subject_key"] for c in claims})}
            j.state, j.progress = st, len(st["done"])
            j.message = f"{len(st['done'])}/{len(st['batches'])} batches"
            state.update(st)

    _waves(todo, deadline, run_batch, save)
    if len(state["done"]) < len(state["batches"]):
        return False
    with SessionLocal.begin() as db:  # dedupe within the run, merging evidence
        claims = list(db.scalars(select(Claim).where(Claim.run_id == run_id, Claim.origin == "extracted")))
        ev = {}
        for e in db.scalars(select(Evidence).where(Evidence.claim_id.in_([c.id for c in claims]))):
            ev.setdefault(e.claim_id, []).append(e)
        dicts = [{"id": c.id, "subject_key": c.subject_key, "text": c.text, "type": c.type, "value": c.value,
                  "evidence": [{"chunk_id": e.chunk_id, "quote": e.quote, "eid": e.id} for e in ev.get(c.id, [])]}
                 for c in claims]
        kept = dedupe(dicts)
        kept_ids = {k["id"] for k in kept}
        for k in kept:
            db.execute(update(Claim).where(Claim.id == k["id"]).values(text=k["text"]))
            for e in k["evidence"]:
                db.execute(update(Evidence).where(Evidence.id == e["eid"]).values(claim_id=k["id"]))
        dup = [c.id for c in claims if c.id not in kept_ids]
        if dup:
            db.execute(delete(Claim).where(Claim.id.in_(dup)))
        j = db.get(Job, job_id)
        j.message = f"{len(kept)} claims from {len(state['batches'])} batches" + (f" ({len(dup)} duplicates merged)" if dup else "")
    return True


def _fts_query(terms: list[str]) -> str:
    words = {w.lower() for t in terms for w in re.findall(r"[A-Za-z0-9]{2,}", t)}
    return " | ".join(sorted(words)) or "nothing"


def step_cover(run_id, job_id, workspace_id, deadline) -> bool:
    s = get_settings()
    llm = get_llm()
    with SessionLocal() as db:
        has_ev = select(Evidence.claim_id)
        items = list(db.scalars(select(Claim).where(Claim.run_id == run_id, Claim.origin == "checklist",
                                                    Claim.id.not_in(has_ev))))
        job = db.get(Job, job_id)
        state = dict(job.state or {})
        state.setdefault("done", [])
        if not job.total:
            _set_job(job_id, total=len(items) + len(state["done"]), state=state)
        todo = [(str(c.id), c.text, (c.meta or {}).get("terms", [])) for c in items if str(c.id) not in state["done"]]

    def cover_one(unit):
        claim_id, question, terms = unit
        with SessionLocal() as db:
            rows = db.execute(text(
                "SELECT c.id, c.text, c.acl_key, c.kind, c.location, c.occurred_at, s.name, "
                "ts_rank(c.tsv, to_tsquery('english', :q)) AS rank FROM chunks c JOIN sources s ON s.id = c.source_id "
                "WHERE c.workspace_id = :w AND c.kind <> 'commit_stats' AND c.tsv @@ to_tsquery('english', :q) "
                "ORDER BY rank DESC LIMIT 40"), {"q": _fts_query(terms), "w": str(workspace_id)}).all()
        groups: dict[str, list] = {}
        for r in rows:
            groups.setdefault(r.acl_key, [])
            if len(groups[r.acl_key]) < 6:
                groups[r.acl_key].append(r)
        # One call per access group: restricted and public text are never mixed in a prompt (trust rule 6).
        for acl in sorted(groups, key=lambda k: (0 if "r:all_members" in k.split("|") else 1, k)):
            cands = groups[acl]
            local = {f"C{i}": r for i, r in enumerate(cands, start=1)}
            user = f"Question: {question}\n\n" + "\n".join(
                f"[{cid}] ({r.kind} · {source_ref(r.kind, r.location, r.occurred_at, r.name)})\n{r.text}\n"
                for cid, r in local.items())
            res: CoverResult = llm.structured(system=COVER_SYSTEM, user=user, schema=CoverResult,
                                              model=s.llm_model_verify, purpose="cover",
                                              workspace_id=workspace_id, run_id=run_id)
            if res.answered and res.chunk in local and res.quote and res.answer:
                return {"chunk_id": local[res.chunk].id, "quote": res.quote.strip(), "answer": res.answer.strip()[:300]}
        return None

    def save(unit, result):
        claim_id = unit[0]
        if isinstance(result, Exception):
            _job_error(job_id, f"checklist item: {getattr(result, 'user_message', None) or type(result).__name__}")
            result = None
        with SessionLocal.begin() as db:
            if result:
                c = db.get(Claim, claim_id)
                c.text = result["answer"]
                db.add(Evidence(claim_id=c.id, chunk_id=result["chunk_id"], quote=result["quote"]))
                ch = db.get(Chunk, result["chunk_id"])
                c.occurred_at = ch.occurred_at if ch else None
            j = db.get(Job, job_id)
            st = dict(j.state or {})
            st["done"] = sorted(set(st.get("done", [])) | {claim_id})
            st["covered"] = st.get("covered", 0) + (1 if result else 0)
            j.state, j.progress = st, len(st["done"])
            j.message = f"{st['covered']} of {len(st['done'])} items found in sources"

    _waves(todo, deadline, cover_one, save)
    with SessionLocal() as db:
        done = set((db.get(Job, job_id).state or {}).get("done", []))
    return all(u[0] in done for u in todo)


def step_match(run_id, job_id, workspace_id, deadline) -> bool:
    with SessionLocal.begin() as db:
        rows = db.execute(select(Evidence, Chunk).join(Chunk, Chunk.id == Evidence.chunk_id).join(Claim, Claim.id == Evidence.claim_id)
                          .where(Claim.workspace_id == workspace_id, Evidence.verifier.is_(None))).all()
        found = 0
        for ev, ch in rows:
            m = match(ev.quote, ch.text)
            ev.quote_found, ev.match_score, ev.match_start, ev.match_end = m.found, m.score, m.start, m.end
            if m.found:
                found += 1
            else:
                ev.verifier = "quote_match"  # failed the hard gate: never sent to the verifier
        j = db.get(Job, job_id)
        j.progress = j.total = len(rows)
        j.message = f"{found} of {len(rows)} quotes found in their cited source"
    return True


def step_verify(run_id, job_id, workspace_id, deadline) -> bool:
    s = get_settings()
    llm = get_llm()
    with SessionLocal() as db:
        rows = db.execute(select(Evidence.id, Claim.text, Chunk.text, Evidence.match_start, Evidence.match_end, Evidence.quote)
                          .join(Claim, Claim.id == Evidence.claim_id).join(Chunk, Chunk.id == Evidence.chunk_id)
                          .where(Claim.workspace_id == workspace_id, Evidence.quote_found.is_(True),
                                 Evidence.verdict == "pending",
                                 (Evidence.verifier.is_(None)) | (Evidence.verifier == "error"))).all()
        job = db.get(Job, job_id)
        state = dict(job.state or {})
        retried = set(state.get("retried", []))
        rows = [r for r in rows if str(r[0]) not in retried]  # an errored item gets exactly one more attempt
        if not job.total:
            _set_job(job_id, total=len(rows))
        base = job.progress or 0

    counter = {"n": base}

    def check(row):
        ev_id, claim_text, chunk_text, a, b, quote = row
        return verify(llm, s.llm_model_verify, claim_text, excerpt(chunk_text, a, b, quote),
                      workspace_id=workspace_id, run_id=run_id)

    def save(row, result):
        with SessionLocal.begin() as db:
            ev = db.get(Evidence, row[0])
            j = db.get(Job, job_id)
            if ev.verifier == "error":  # this was the retry; never loop on it again
                j.state = {**(j.state or {}), "retried": sorted(set((j.state or {}).get("retried", [])) | {str(ev.id)})}
            else:
                counter["n"] += 1
            if isinstance(result, Exception):
                _job_error(job_id, f"verify: {getattr(result, 'user_message', None) or type(result).__name__}")
                ev.verifier = "error"  # stays 'pending' -> status explains 'verification unavailable'
            else:
                ev.verdict, ev.verdict_reason, ev.verifier = result.verdict, result.reason[:300], s.llm_model_verify
            j.progress = min(counter["n"], j.total or counter["n"])
            j.message = f"{j.progress}/{j.total} evidence items checked"

    _waves(list(rows), deadline, check, save, parallel=VERIFY_PARALLEL)
    with SessionLocal() as db:
        retried = set((db.get(Job, job_id).state or {}).get("retried", []))
        left = [i for (i,) in db.execute(select(Evidence.id).join(Claim, Claim.id == Evidence.claim_id).where(
            Claim.workspace_id == workspace_id, Evidence.quote_found.is_(True), Evidence.verdict == "pending",
            (Evidence.verifier.is_(None)) | (Evidence.verifier == "error")))]
    return all(str(i) in retried for i in left)


def replan_conflicts(db: Session, workspace_id, reset: bool = False) -> tuple[int, int]:
    """Plan conflicts/supersession for claims not already in a (resolved) group. Deterministic, no LLM."""
    if reset:  # used by `python -m baton.recompute`: forget unresolved groups and automatic supersessions
        db.execute(update(Claim).where(Claim.workspace_id == workspace_id, Claim.review_state == "none")
                   .values(superseded_by=None))
        unresolved = select(ConflictGroup.id).where(ConflictGroup.workspace_id == workspace_id, ConflictGroup.resolved.is_(False))
        db.execute(update(Claim).where(Claim.conflict_group_id.in_(unresolved)).values(conflict_group_id=None))
        db.execute(delete(ConflictGroup).where(ConflictGroup.workspace_id == workspace_id, ConflictGroup.resolved.is_(False)))
    members, _, _, _ = _people(db, workspace_id)
    people = frozenset(n.lower() for m in members.values() for n in (m.display_name, m.handle))
    claims = list(db.scalars(select(Claim).where(Claim.workspace_id == workspace_id, Claim.review_state != "rejected",
                                                 Claim.conflict_group_id.is_(None))))
    plan = plan_conflicts([ClaimLite(str(c.id), c.subject_key, c.value, c.occurred_at, c.supersedes_hint, c.text)
                           for c in claims], people)
    by_id = {str(c.id): c for c in claims}
    for old, new in plan.superseded.items():
        by_id[old].superseded_by = by_id[new].id
    for subject, ids in plan.groups.items():
        g = ConflictGroup(workspace_id=workspace_id, subject_key=subject)
        db.add(g)
        db.flush()
        for i in ids:
            by_id[i].conflict_group_id = g.id
    db.flush()
    return len(plan.groups), len(plan.superseded)


def step_conflicts(run_id, job_id, workspace_id, deadline) -> bool:
    with SessionLocal.begin() as db:
        n_groups, n_sup = replan_conflicts(db, workspace_id)
        j = db.get(Job, job_id)
        j.progress = j.total = n_groups
        j.message = f"{n_groups} conflicts, {n_sup} reversed decisions"
    return True


def step_status(run_id, job_id, workspace_id, deadline) -> bool:
    with SessionLocal.begin() as db:
        n = recompute_statuses(db, workspace_id)
        j = db.get(Job, job_id)
        j.progress = j.total = n
        j.message = f"{n} claims graded by deterministic rules"
    return True


def step_handover(run_id, job_id, workspace_id, deadline) -> bool:
    with SessionLocal.begin() as db:
        _, _, leaver, successor = _people(db, workspace_id)
        if leaver and successor and not db.scalar(select(Handover).where(Handover.workspace_id == workspace_id)):
            db.add(Handover(workspace_id=workspace_id, leaver_member_id=leaver.id, successor_member_id=successor.id))
        j = db.get(Job, job_id)
        j.progress = j.total = 1
        j.message = "Handover ready for review" if successor else "No successor set"
    return True


HANDLERS = {"ingest": step_ingest, "checklist": step_checklist, "extract": step_extract, "cover": step_cover,
            "match": step_match, "verify": step_verify, "conflicts": step_conflicts, "status": step_status,
            "handover": step_handover}


def describe_error(exc: Exception) -> str:
    return exc.user_message if isinstance(exc, LLMError) else str(exc)
