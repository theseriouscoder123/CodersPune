"""Rebuild the demo TEMPLATE workspace.  Usage:  python -m baton.seed_demo

M1: ingestion only. The pipeline run and the frozen snapshot are added in M2/M3.
"""

from __future__ import annotations

from sqlalchemy import delete, select

from baton.db.models import Source, Workspace
from baton.db.session import SessionLocal
from baton.demo_loader import build_demo_workspace


def main() -> None:
    with SessionLocal.begin() as db:
        db.execute(delete(Workspace).where(Workspace.is_demo_template.is_(True)))
        ws = build_demo_workspace(db, template=True)
        print(f"template workspace {ws.id}")
        for s in db.scalars(select(Source).where(Source.workspace_id == ws.id)):
            print(f"  {s.name:<28} {s.type:<12} chunks={s.meta.get('chunk_count'):<4} "
                  f"acl={s.acl_key[:40]:<40} scrubbed={s.scrub_report}")


if __name__ == "__main__":
    main()
