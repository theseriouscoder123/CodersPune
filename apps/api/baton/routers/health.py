"""Pipeline health for the workspace admin: what the AI did, what failed and why (metadata only, no prompt text)."""

from __future__ import annotations

from collections import Counter, defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from baton.auth import Ctx, workspace_ctx
from baton.config import get_settings
from baton.db.models import Job, LlmCall, Run
from baton.db.session import get_db
from baton.pipeline import STEP_LABELS, STEPS

router = APIRouter(prefix="/api")


def _pct(values: list[int], p: float) -> int | None:
    if not values:
        return None
    v = sorted(values)
    return v[min(len(v) - 1, int(round(p * (len(v) - 1))))]


@router.get("/workspaces/{workspace_id}/pipeline-health")
def pipeline_health(ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    if not (ctx.is_admin or ctx.is_reviewer):
        raise HTTPException(403, "Pipeline health is visible to the workspace admin and reviewer")
    ids = [ctx.workspace.id] + ([ctx.workspace.sandbox_of] if ctx.workspace.sandbox_of else [])
    calls = list(db.scalars(select(LlmCall).where(LlmCall.workspace_id.in_(ids)).order_by(LlmCall.created_at.desc()).limit(5000)))

    groups: dict = defaultdict(list)
    for c in calls:
        groups[(c.purpose, f"{(c.provider or '').split('#')[0] or 'llm'}:{c.model}")].append(c)
    rows = []
    for (purpose, model), cs in sorted(groups.items()):
        lat = [c.latency_ms for c in cs if c.latency_ms is not None and c.ok]
        errs = Counter((c.error or "error").split(":")[0] for c in cs if not c.ok)
        rows.append({
            "purpose": purpose, "model": model, "calls": len(cs), "ok": sum(c.ok for c in cs), "failed": sum(not c.ok for c in cs),
            "keys_used": len({c.provider for c in cs if c.provider}),
            "errors": dict(errs.most_common(4)), "tokens_in": sum(c.tokens_in or 0 for c in cs),
            "tokens_out": sum(c.tokens_out or 0 for c in cs), "p50_ms": _pct(lat, 0.5), "p95_ms": _pct(lat, 0.95),
        })

    runs = []
    for r in db.scalars(select(Run).where(Run.workspace_id.in_(ids)).order_by(Run.created_at.desc()).limit(10)):
        jobs = sorted(db.scalars(select(Job).where(Job.run_id == r.id)), key=lambda j: STEPS.index(j.step) if j.step in STEPS else 99)
        dur = (r.finished_at - r.started_at).total_seconds() if r.finished_at and r.started_at else None
        runs.append({
            "id": str(r.id), "status": r.status, "mode": (r.stats or {}).get("mode", "full"), "frozen": bool((r.stats or {}).get("frozen")),
            "started_at": r.started_at.isoformat() if r.started_at else None, "duration_s": dur, "error": r.error,
            "inherited": r.workspace_id != ctx.workspace.id,
            "steps": [{"step": j.step, "label": STEP_LABELS.get(j.step, j.step), "status": j.status, "message": j.message,
                       "issues": len((j.state or {}).get("errors", []))} for j in jobs],
        })

    s = get_settings()
    total = len(calls)
    failed = sum(not c.ok for c in calls)
    return {
        "config": {"provider": s.llm_provider, "configured": s.llm_configured, "verifier": s.verifier,
                   "keys": {p: len(s.key_pool(p)) for p in ("gemini", "groq")},  # counts only, never key material
                   "extract_models": [m.strip() for m in s.llm_model_extract.split(",") if m.strip()],
                   "verify_models": [m.strip() for m in s.llm_model_verify.split(",") if m.strip()]},
        "totals": {"calls": total, "failed": failed, "failure_rate": round(failed / total, 3) if total else 0,
                   "daily_quota_hits": sum(1 for c in calls if (c.error or "").startswith("daily quota")),
                   "tokens": sum((c.tokens_in or 0) + (c.tokens_out or 0) for c in calls)},
        "by_model": rows,
        "runs": runs,
    }
