"""The successor's first week: the approved handover, arranged into Day 1 / Days 2–3 / Rest of week 1 (rules, no AI).

Built only from what the successor already sees (the permission projection of the latest approved version, the same
items they acknowledge), so it can never show more than their handover does. Each item says why it sits on that day.
Progress comes from the successor's acknowledgements.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from baton.db.models import Member
from baton.db.session import get_db
from baton.routers.acks import _effective, _successor_view
from baton.routers.handovers import _handover, _latest
from baton.routers.leaving import IST

router = APIRouter(prefix="/api", tags=["Successor's first week"])

_DEADLINE = re.compile(r"\b(before|by|until|due|deadline)\b", re.IGNORECASE)
BUCKETS = [("day1", "Day 1", "Start with these."), ("days23", "Days 2–3", "Get oriented: the rest of the next steps, risks and access."),
           ("week1", "Rest of week 1", "Background: decisions, owners and the remaining open questions.")]


def place(it: dict, leaver: str, leaver_here: bool) -> tuple[str, str]:
    """(bucket, reason) for one handover item."""
    sec, text = it["section"], it["text"]
    if sec == "Start here" and it.get("rank") == 0:
        return "day1", "It names you."
    if sec == "Start here" and _DEADLINE.search(text):
        return "day1", "It has a deadline."
    if sec == "Unresolved" and leaver_here:
        return "day1", f"Nobody has answered this, and {leaver} can still be asked."
    if sec == "Start here":
        return "days23", "A next step for the project."
    if sec == "Risks and conflicts":
        return "days23", "Know this before you change anything."
    if sec == "Dependencies and contacts":
        return "days23", "Check you have access."
    if sec == "Unresolved":
        return "week1", f"Nobody has answered this; {leaver} has left, so ask the reviewer."
    if sec == "Who owns what":
        return "week1", "Know who to ask."
    return "week1", "Read for context."


@router.get("/handovers/{handover_id}/first-week")
def first_week(handover_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    h, ctx = _handover(db, request, handover_id)
    is_succ = ctx.member.id == h.successor_member_id
    if not (ctx.is_reviewer or is_succ):
        raise HTTPException(403, "The first-week plan is for the successor (and the reviewer who approved the handover)")
    v = _latest(db, h, None)
    succ = db.get(Member, h.successor_member_id) if h.successor_member_id else None
    leaver = db.get(Member, h.leaver_member_id)
    if v is None:
        return {"approved": False, "successor": succ.display_name if succ else None, "buckets": []}
    items = _successor_view(db, h, v)
    eff = _effective(db, h, v, items)
    today = datetime.now(IST).date()
    leaver_here = h.leaves_on is None or h.leaves_on >= today
    out = {k: [] for k, _, _ in BUCKETS}
    for cid, it in items.items():
        bucket, why = place(it, leaver.display_name, leaver_here)
        state = (eff.get(cid) or {}).get("state")
        out[bucket].append({"claim_id": cid, "text": it["text"], "status": it["status"], "section": it["section"],
                            "type_label": it.get("type_label"), "why": why, "state": state,
                            "done": state in ("acknowledged", "not_mine") or bool((eff.get(cid) or {}).get("closed"))})
    for bucket_items in out.values():
        bucket_items.sort(key=lambda x: (x["done"], x["section"] != "Start here"))
    total = sum(len(v_) for v_ in out.values())
    done = sum(1 for v_ in out.values() for x in v_ if x["done"])
    return {"approved": True, "version": v.version, "successor": succ.display_name if succ else None, "leaver": leaver.display_name,
            "leaves_on": h.leaves_on.isoformat() if h.leaves_on else None, "leaver_here": leaver_here,
            "counts": {"total": total, "done": done},
            "buckets": [{"key": k, "title": t, "help": hp, "items": out[k]} for k, t, hp in BUCKETS]}
