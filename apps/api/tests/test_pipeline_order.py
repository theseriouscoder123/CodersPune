"""Regression: jobs share one created_at, so step order must come from the pipeline definition, not timestamps."""

from sqlalchemy import delete, select

from baton.db.models import Job, Workspace
from baton.db.session import SessionLocal
from baton.pipeline import STEPS, RunBusy, create_run, run_progress


def test_steps_always_reported_and_picked_in_pipeline_order():
    db = SessionLocal()
    ws = Workspace(name="pytest order")
    db.add(ws)
    db.flush()
    run = create_run(db, ws.id)
    db.commit()
    try:
        assert [s["step"] for s in run_progress(run.id)["steps"]] == STEPS
        assert len({j.created_at for j in db.scalars(select(Job).where(Job.run_id == run.id))}) == 1  # the trap
        try:
            create_run(db, ws.id)
            raise AssertionError("second concurrent run must be refused")
        except RunBusy:
            db.rollback()
    finally:
        db.execute(delete(Workspace).where(Workspace.id == ws.id))
        db.commit()
        db.close()
