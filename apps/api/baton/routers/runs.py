"""Pipeline runs. The run page drives progress by calling /advance while it polls (resumable; DECISIONS D8)."""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from baton.auth import Ctx, resolve_ctx, workspace_ctx
from baton.config import get_settings
from baton.db.models import Run
from baton.db.session import get_db
from baton.pipeline import RunBusy, advance, create_run, run_progress

router = APIRouter(prefix="/api")


class RunIn(BaseModel):
    mode: Literal["full", "refresh"] = "full"


@router.post("/workspaces/{workspace_id}/runs")
def start_run(body: RunIn | None = None, ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    if not ctx.is_admin:
        raise HTTPException(403, "Only the workspace admin can start a pipeline run")
    if not ctx.can_write:
        raise HTTPException(403, "This is the shared read-only template. Click 'Try the demo' to get your own copy.")
    if not get_settings().llm_configured:
        raise HTTPException(503, "AI pipeline unavailable: no LLM key is configured on the server.")
    try:
        run = create_run(db, ctx.workspace.id, mode=(body.mode if body else "full"))
    except RunBusy as exc:
        raise HTTPException(409, {"message": "A run is already in progress", "run_id": str(exc)}) from exc
    db.commit()
    return {"run_id": str(run.id), "mode": (run.stats or {}).get("mode")}


@router.get("/workspaces/{workspace_id}/runs/latest")
def latest_run(ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    run = db.scalars(select(Run).where(Run.workspace_id == ctx.workspace.id).order_by(Run.created_at.desc())).first()
    if run is None and ctx.workspace.sandbox_of:  # a sandbox shows the precomputed run of the template it was cloned from
        run = db.scalars(select(Run).where(Run.workspace_id == ctx.workspace.sandbox_of).order_by(Run.created_at.desc())).first()
    return {"run": run_progress(run.id) if run else None}


def _run_ctx(db: Session, request: Request, run_id: uuid.UUID) -> Ctx:
    run = db.get(Run, run_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    return resolve_ctx(db, request, run.workspace_id)


@router.get("/runs/{run_id}")
def get_run(run_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    _run_ctx(db, request, run_id)
    return run_progress(run_id)


@router.post("/runs/{run_id}/advance")
def advance_run(run_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    ctx = _run_ctx(db, request, run_id)
    run = db.get(Run, run_id)
    if run.status not in ("queued", "running"):
        return run_progress(run_id)  # nothing to drive: anyone who can see the run gets its final state
    if not ctx.can_write:
        raise HTTPException(403, "This run belongs to a workspace you can only view.")
    db.close()  # the pipeline manages its own short transactions
    return advance(run_id)
