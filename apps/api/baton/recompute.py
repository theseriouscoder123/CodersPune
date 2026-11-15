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
from baton.ledger import merge_duplicates, rebuild_relations, recompute_statuses
from baton.pipeline import _n, replan_conflicts


def main() -> None:
    with SessionLocal.begin() as db:
        ws_id = sys.argv[1] if len(sys.argv) > 1 else db.scalar(
            select(Workspace.id).where(Workspace.is_demo_template.is_(True)).order_by(Workspace.created_at.desc()))
        groups, sup = replan_conflicts(db, ws_id, reset=True)
        merged = merge_duplicates(db, ws_id)  # same rules as the pipeline's status step (D73)
        recompute_statuses(db, ws_id)
        rebuild_relations(db, ws_id)  # relation signals and stale-work reasons use the fresh dates and statuses
        run = db.scalars(select(Run).where(Run.workspace_id == ws_id).order_by(Run.created_at.desc())).first()
        if run:
            for j in db.scalars(select(Job).where(Job.run_id == run.id, Job.step == "conflicts")):
                j.message, j.progress, j.total = f"{_n(groups, 'conflict')}, {_n(sup, 'reversed decision')}", groups, groups
        counts = Counter(c.status for c in db.scalars(select(Claim).where(Claim.workspace_id == ws_id)))
        print(f"{ws_id}: {groups} conflicts, {sup} superseded, {merged} merged, statuses {dict(counts)}")


if __name__ == "__main__":
    main()
