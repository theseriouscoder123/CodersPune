"""Rebuild the demo TEMPLATE workspace (judges never wait on a live LLM; DECISIONS D4, D15).

    python -m baton.seed_demo              # ingest demo/ + run the live pipeline
    python -m baton.seed_demo --export     # ...and freeze the result to demo/frozen_ledger.json
    python -m baton.seed_demo --frozen     # ingest demo/ + restore demo/frozen_ledger.json (no LLM calls; used for prod)
    python -m baton.seed_demo --no-llm     # ingest only
"""

from __future__ import annotations

import sys
import time
from collections import Counter

from sqlalchemy import delete, select

from baton.db.models import Claim, Source, Workspace
from baton.db.session import SessionLocal
from baton.demo_loader import build_demo_workspace
from baton.demo_snapshot import export_snapshot, import_snapshot
from baton.pipeline import create_run, run_to_completion


def main() -> None:
    args = set(sys.argv[1:])
    with SessionLocal.begin() as db:
        db.execute(delete(Workspace).where(Workspace.is_demo_template.is_(True)))
        ws = build_demo_workspace(db, template=True)
        ws_id = ws.id
        print(f"template workspace {ws_id}")
        for s in db.scalars(select(Source).where(Source.workspace_id == ws_id)):
            print(f"  {s.name:<28} {s.type:<12} chunks={s.meta.get('chunk_count'):<4} scrubbed={s.scrub_report}")
        if "--no-llm" in args:
            return
        if "--frozen" in args:
            print("restored frozen ledger:", import_snapshot(db, ws_id))
            run_id = None
        else:
            run_id = create_run(db, ws_id).id

    if run_id:
        t0 = time.time()
        p = run_to_completion(run_id)
        print(f"run {p['status']} in {time.time() - t0:.0f}s{(' - ' + p['error']) if p['error'] else ''}")
        for s in p["steps"]:
            print(f"  {s['step']:<10} {s['status']:<8} {s['message']}" + (f"  errors={len(s['errors'])}" if s["errors"] else ""))
    with SessionLocal() as db:
        claims = list(db.scalars(select(Claim).where(Claim.workspace_id == ws_id)))
        print("statuses:", dict(Counter(c.status for c in claims)), "superseded:", sum(1 for c in claims if c.superseded_by))
        if "--export" in args:
            print("exported:", export_snapshot(db, ws_id))


if __name__ == "__main__":
    main()
