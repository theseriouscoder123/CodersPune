"""Re-plan conflicts and recompute statuses for a workspace without any LLM calls.

    python -m baton.recompute            # the demo template
    python -m baton.recompute <uuid>
"""

from __future__ import annotations

import sys
from collections import Counter

from sqlalchemy import select

from baton.db.models import Claim, Job, Run, Workspace
from baton.db.session import SessionLocal
from baton.ledger import recompute_statuses
from baton.pipeline import replan_conflicts


def main() -> None:
    with SessionLocal.begin() as db:
        ws_id = sys.argv[1] if len(sys.argv) > 1 else db.scalar(
            select(Workspace.id).where(Workspace.is_demo_template.is_(True)).order_by(Workspace.created_at.desc()))
        groups, sup = replan_conflicts(db, ws_id, reset=True)
        recompute_statuses(db, ws_id)
        run = db.scalars(select(Run).where(Run.workspace_id == ws_id).order_by(Run.created_at.desc())).first()
        if run:
            for j in db.scalars(select(Job).where(Job.run_id == run.id, Job.step == "conflicts")):
                j.message, j.progress, j.total = f"{groups} conflicts, {sup} reversed decisions", groups, groups
        counts = Counter(c.status for c in db.scalars(select(Claim).where(Claim.workspace_id == ws_id)))
        print(f"{ws_id}: {groups} conflicts, {sup} superseded, statuses {dict(counts)}")


if __name__ == "__main__":
    main()
