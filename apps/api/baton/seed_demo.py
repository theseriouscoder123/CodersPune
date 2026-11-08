"""Rebuild the demo TEMPLATE workspace and run the full pipeline once (judges never wait on a live LLM; D4).

    python -m baton.seed_demo            # ingest + pipeline
    python -m baton.seed_demo --no-llm   # ingest only
"""

from __future__ import annotations

import sys
import time
from collections import Counter

from sqlalchemy import delete, select

from baton.db.models import Claim, Source, Workspace
from baton.db.session import SessionLocal
from baton.demo_loader import build_demo_workspace
from baton.pipeline import create_run, run_to_completion


def main() -> None:
    with SessionLocal.begin() as db:
        db.execute(delete(Workspace).where(Workspace.is_demo_template.is_(True)))
        ws = build_demo_workspace(db, template=True)
        ws_id = ws.id
        print(f"template workspace {ws_id}")
        for s in db.scalars(select(Source).where(Source.workspace_id == ws_id)):
            print(f"  {s.name:<28} {s.type:<12} chunks={s.meta.get('chunk_count'):<4} scrubbed={s.scrub_report}")
        if "--no-llm" in sys.argv:
            return
        run = create_run(db, ws_id)
        run_id = run.id

    t0 = time.time()
    p = run_to_completion(run_id)
    print(f"run {p['status']} in {time.time() - t0:.0f}s{(' - ' + p['error']) if p['error'] else ''}")
    for s in p["steps"]:
        print(f"  {s['step']:<10} {s['status']:<8} {s['message']}" + (f"  errors={s['errors']}" if s["errors"] else ""))
    with SessionLocal() as db:
        claims = list(db.scalars(select(Claim).where(Claim.workspace_id == ws_id)))
        print("statuses:", dict(Counter(c.status for c in claims)))
        print("superseded:", sum(1 for c in claims if c.superseded_by))


if __name__ == "__main__":
    main()
