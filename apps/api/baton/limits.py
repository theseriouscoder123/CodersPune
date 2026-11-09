"""Abuse limits for the public demo and housekeeping for old sandboxes. Counted in Postgres (no Redis)."""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, Request
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from baton.db.models import Claim, ReviewEvent, Visitor, Workspace

NEW_SANDBOXES_PER_IP_PER_HOUR = int(os.environ.get("DEMO_SANDBOXES_PER_IP_HOUR", "60"))  # judges may share one office IP
CUSTOM_PER_IP_PER_DAY = 6
RESET_COOLDOWN = timedelta(seconds=15)
SANDBOX_TTL = timedelta(days=7)


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for") or request.headers.get("x-real-ip") or ""
    ip = fwd.split(",")[0].strip()
    return ip or (request.client.host if request.client else "unknown")


def _count_for_ip(db: Session, ip: str, since: datetime, sandbox: bool) -> int:
    q = (select(func.count()).select_from(Workspace).join(Visitor, Visitor.id == Workspace.visitor_id)
         .where(Visitor.ip == ip, Workspace.created_at > since))
    q = q.where(Workspace.sandbox_of.is_not(None)) if sandbox else q.where(Workspace.sandbox_of.is_(None))
    return db.scalar(q) or 0


def check_new_sandbox(db: Session, ip: str) -> None:
    if _count_for_ip(db, ip, datetime.now(UTC) - timedelta(hours=1), sandbox=True) >= NEW_SANDBOXES_PER_IP_PER_HOUR:
        raise HTTPException(429, "Too many demo copies from this network in the last hour. Please try again a little later.")


def check_custom(db: Session, ip: str) -> None:
    if _count_for_ip(db, ip, datetime.now(UTC) - timedelta(days=1), sandbox=False) >= CUSTOM_PER_IP_PER_DAY:
        raise HTTPException(429, f"Limit reached: {CUSTOM_PER_IP_PER_DAY} custom workspaces per network per day.")


REVIEW_ACTIONS_PER_MINUTE = 120  # a fast human with keyboard shortcuts does ~30; a script does thousands


def check_review_rate(db: Session, workspace_id) -> None:
    since = datetime.now(UTC) - timedelta(minutes=1)
    n = db.scalar(select(func.count()).select_from(ReviewEvent).join(Claim, Claim.id == ReviewEvent.claim_id)
                  .where(Claim.workspace_id == workspace_id, ReviewEvent.created_at > since)) or 0
    if n >= REVIEW_ACTIONS_PER_MINUTE:
        raise HTTPException(429, "That's a lot of review actions in one minute. Please slow down a little.")


def check_reset(current: Workspace | None) -> None:
    if current is not None and current.created_at and datetime.now(UTC) - current.created_at < RESET_COOLDOWN:
        raise HTTPException(429, "You just reset the demo. Give it a few seconds.")


def touch(db: Session, visitor: Visitor | None) -> None:
    """Mark a visitor active (at most once an hour) so their sandbox isn't garbage-collected."""
    if visitor is not None and (visitor.last_seen_at is None or datetime.now(UTC) - visitor.last_seen_at > timedelta(hours=1)):
        visitor.last_seen_at = datetime.now(UTC)


def collect_garbage(db: Session, now: datetime | None = None) -> dict:
    """Delete visitor workspaces (sandboxes and custom) untouched for 7 days. The template is never touched."""
    now = now or datetime.now(UTC)
    cutoff = now - SANDBOX_TTL
    stale_visitors = select(Visitor.id).where(Visitor.last_seen_at < cutoff)
    victims = list(db.scalars(select(Workspace.id).where(
        Workspace.is_demo_template.is_(False), Workspace.visitor_id.in_(stale_visitors), Workspace.created_at < cutoff)))
    if victims:
        db.execute(delete(Workspace).where(Workspace.id.in_(victims)))
    gone = db.execute(delete(Visitor).where(Visitor.last_seen_at < cutoff,
                                            Visitor.id.not_in(select(Workspace.visitor_id).where(Workspace.visitor_id.is_not(None)))))
    return {"workspaces_deleted": len(victims), "visitors_deleted": gone.rowcount or 0}
