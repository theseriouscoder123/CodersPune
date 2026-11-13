"""Activity log: who did what to the ledger and when (review actions, comments, conflict decisions, approvals).

Reviewer/admin only: entries quote claim text, and only the reviewer sees the whole draft ledger. CSV export for
records. Notes are PII-masked like everywhere else for non-reviewers (moot here, but kept for safety).
"""

from __future__ import annotations

import csv
import io
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from baton.ingest.scrubber import mask_pii
from baton.auth import Ctx, workspace_ctx
from baton.acl import access_label
from baton.db.models import AuditEvent, Claim, Handover, HandoverVersion, Member, ReviewEvent, Source
from baton.db.session import get_db

router = APIRouter(prefix="/api", tags=["Ledger and review"])

ACTION_LABELS = {
    "confirm": "Confirmed", "reject": "Rejected", "restore": "Restored", "promote": "Promoted without evidence",
    "edit": "Edited", "comment": "Commented", "bulk_confirm": "Confirmed (bulk)", "bulk_reject": "Rejected (bulk)",
    "resolve_winner": "Marked as current in a conflict", "resolve_superseded": "Superseded in a conflict",
    "resolve_keep_risk": "Kept a conflict as an open risk",
}
MAX_ROWS = 1000


def _entries(db: Session, ctx: Ctx) -> list[dict]:
    if not (ctx.is_reviewer or ctx.is_admin):
        raise HTTPException(403, "The activity log is visible to the workspace admin and reviewer")
    ws_id = ctx.workspace.id
    names = {m.id: m.display_name for m in db.scalars(select(Member).where(Member.workspace_id == ws_id))}
    out: list[dict] = []
    pii = (lambda s: mask_pii(s) if s else s) if not ctx.is_reviewer else (lambda s: s)
    rows = db.execute(select(ReviewEvent, Claim.text, Claim.type).join(Claim, Claim.id == ReviewEvent.claim_id)
                      .where(Claim.workspace_id == ws_id).order_by(ReviewEvent.created_at.desc()).limit(MAX_ROWS))
    for ev, text, ctype in rows:
        before_text = (ev.before or {}).get("text")
        out.append({
            "at": ev.created_at.isoformat(), "kind": "review", "action": ev.action,
            "label": ACTION_LABELS.get(ev.action, ev.action.replace("_", " ").capitalize()),
            "actor": names.get(ev.actor_member_id, "Someone"), "role": ev.actor_role,
            "claim_id": str(ev.claim_id), "claim": pii(text), "claim_type": ctype, "note": pii(ev.note),
            "before": pii(before_text) if ev.action == "edit" and before_text != text else None,
        })
    for v, hname, succ in db.execute(
            select(HandoverVersion, Handover.name, Handover.successor_member_id).join(Handover, Handover.id == HandoverVersion.handover_id)
            .where(Handover.workspace_id == ws_id)):
        out.append({
            "at": v.approved_at.isoformat(), "kind": "approval", "action": "approve",
            "label": f"Approved version {v.version}" + (f" of “{hname}”" if hname else ""),
            "actor": names.get(v.approved_by, "Someone"), "role": "reviewer", "claim_id": None,
            "claim": f"Shared with {names.get(succ, 'the successor')} ({len(v.snapshot.get('items', []))} items)",
            "claim_type": None, "note": pii(v.note), "before": None,
        })
    src_names = {str(s.id): s.name for s in db.scalars(select(Source).where(Source.workspace_id == ws_id))}
    for a in db.scalars(select(AuditEvent).where(AuditEvent.workspace_id == ws_id).order_by(AuditEvent.created_at.desc()).limit(MAX_ROWS)):
        if a.action == "source_acl":
            label, what = "Changed who can access a source", (
                f"{src_names.get(a.target or '', 'A source')}: {access_label(a.before, {str(k): v for k, v in names.items()})}"
                f" → {access_label(a.after, {str(k): v for k, v in names.items()})}")
        else:
            label, what = a.action.replace("_", " ").capitalize(), a.target
        out.append({"at": a.created_at.isoformat(), "kind": "audit", "action": a.action, "label": label,
                    "actor": names.get(a.actor_member_id, "Someone"), "role": a.actor_role, "claim_id": None,
                    "claim": what, "claim_type": None, "note": pii(a.note), "before": None})
    out.sort(key=lambda e: e["at"], reverse=True)
    return out[:MAX_ROWS]


@router.get("/workspaces/{workspace_id}/activity")
def activity(ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> dict:
    return {"entries": _entries(db, ctx)}


@router.get("/workspaces/{workspace_id}/activity.csv")
def activity_csv(ctx: Ctx = Depends(workspace_ctx), db: Session = Depends(get_db)) -> Response:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["when (UTC)", "who", "role", "action", "claim or item", "note", "previous text"])
    for e in _entries(db, ctx):
        w.writerow([e["at"], e["actor"], e["role"], e["label"], _safe(e["claim"]), _safe(e["note"]), _safe(e["before"])])
    stamp = datetime.now().strftime("%Y%m%d")
    return Response(buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="baton-activity-{stamp}.csv"'})


def _safe(v: str | None) -> str:
    """Neutralise spreadsheet formula injection (cells starting with = + - @ run as formulas in Excel/Sheets)."""
    s = v or ""
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s
