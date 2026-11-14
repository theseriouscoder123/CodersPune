"""Precompute improvement #3's re-renders for the demo template, so judges never wait on the AI:
    python -m baton.seed_rerender            # withheld items that name the successor or carry a deadline
Copies of the demo get the results through the normal sandbox clone (claims.derived_from is remapped)."""

from __future__ import annotations

from sqlalchemy import select

from baton.db.models import Claim, Handover, Member, Workspace
from baton.db.session import SessionLocal
from baton.ledger import rebuild_relations
from baton.reconstruct.rerender import looks_like_theirs
from baton.routers.handovers import eligible_for_successor
from baton.routers.rerender import rerender_claim


def main() -> None:
    with SessionLocal.begin() as db:
        ws = db.scalar(select(Workspace).where(Workspace.is_demo_template.is_(True)))
        h = db.scalar(select(Handover).where(Handover.workspace_id == ws.id))
        succ = db.get(Member, h.successor_member_id)
        done = {c.derived_from for c in db.scalars(select(Claim).where(Claim.workspace_id == ws.id, Claim.derived_from.is_not(None)))}
        for c in list(db.scalars(select(Claim).where(Claim.workspace_id == ws.id))):
            if c.id in done or c.derived_from or not eligible_for_successor(c) or not looks_like_theirs(c.text, succ.display_name):
                continue
            out = rerender_claim(db, ws.id, c, succ)
            if out["status"] == "not_withheld":
                continue
            print(f"{out['status']:<16} {c.text[:60]!r} -> {out.get('text', out.get('reason'))!r} [{out.get('claim_status', '')}]")
        rebuild_relations(db, ws.id)


if __name__ == "__main__":
    main()
