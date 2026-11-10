"""Optional email (Gmail SMTP / any SMTP) and Slack (incoming webhook) notifications.

Design rules:
  * Strictly optional. With no SMTP settings or webhook, every function returns "skipped" and the calling action
    still succeeds. A notification failure can never fail or roll back the action that triggered it.
  * Permission-safe. Messages carry counts, names and a link, never claim text or quotes, so nothing restricted can
    leak through a notification. The recipient opens Baton, where the normal server-side projection applies.
  * Abuse-limited. Email only goes to addresses the workspace admin entered for its own members, with a daily cap
    per workspace and globally (Gmail allows ~500/day). Slack only posts to https://hooks.slack.com/ URLs (no SSRF).
  * Bounded. Sent inline with short timeouts (no background tasks on serverless, DECISIONS D8); each send is logged
    to `notifications` with a masked recipient and never the body.
"""

from __future__ import annotations

import re
import smtplib
import ssl
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from email.utils import formataddr
from html import escape

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from baton.config import get_settings
from baton.db.models import Notification, Workspace

EMAILS_PER_WORKSPACE_PER_DAY = 25
EMAILS_GLOBAL_PER_DAY = 300
SLACK_PER_WORKSPACE_PER_HOUR = 60
SMTP_TIMEOUT_S = 8
SLACK_TIMEOUT_S = 5

SLACK_WEBHOOK_RE = re.compile(r"^https://hooks\.slack\.com/(services|workflows|triggers)/[A-Za-z0-9_/\-]{10,200}$")
EMAIL_RE = re.compile(r"^[^@\s<>\"']{1,64}@[A-Za-z0-9.\-]{1,190}\.[A-Za-z]{2,24}$")


@dataclass
class Result:
    channel: str
    status: str  # sent | skipped | failed
    detail: str = ""

    def as_dict(self) -> dict:
        return {"channel": self.channel, "status": self.status, "detail": self.detail}


# ---------- validation and masking (pure) ----------

def valid_email(addr: str | None) -> bool:
    return bool(addr) and bool(EMAIL_RE.match(addr.strip()))


def valid_slack_webhook(url: str | None) -> bool:
    return bool(url) and bool(SLACK_WEBHOOK_RE.match(url.strip()))


def mask_email(addr: str) -> str:
    local, _, domain = addr.partition("@")
    return f"{local[:2]}***@{domain}" if domain else "***"


def mask_webhook(url: str) -> str:
    return f"hooks.slack.com/…{url.strip()[-4:]}" if url else ""


def email_status() -> dict:
    s = get_settings()
    return {"configured": s.email_configured, "from": mask_email(s.smtp_user) if s.email_configured else None}


# ---------- logging and limits ----------

def _log(db: Session, ws_id, channel: str, event: str, recipient: str | None, res: Result) -> Result:
    from baton.security import redact

    res.detail = redact(res.detail) or ""
    db.add(Notification(workspace_id=ws_id, channel=channel, event=event, recipient=recipient, status=res.status,
                        detail=(res.detail or "")[:300] or None))
    db.flush()
    return res


def _count(db: Session, since: datetime, channel: str, ws_id=None) -> int:
    q = select(func.count()).select_from(Notification).where(
        Notification.channel == channel, Notification.status == "sent", Notification.created_at > since)
    if ws_id is not None:
        q = q.where(Notification.workspace_id == ws_id)
    return db.scalar(q) or 0


# ---------- transports (patched in tests) ----------

def _smtp_send(msg: EmailMessage) -> None:
    s = get_settings()
    if s.smtp_port == 465:
        with smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, timeout=SMTP_TIMEOUT_S, context=ssl.create_default_context()) as smtp:
            smtp.login(s.smtp_user, s.smtp_password)
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=SMTP_TIMEOUT_S) as smtp:
            smtp.starttls(context=ssl.create_default_context())
            smtp.login(s.smtp_user, s.smtp_password)
            smtp.send_message(msg)


def _slack_post(url: str, payload: dict) -> None:
    r = httpx.post(url, json=payload, timeout=SLACK_TIMEOUT_S, follow_redirects=False)
    if r.status_code >= 400:
        raise RuntimeError(f"slack {r.status_code}: {r.text[:80]}")


# ---------- public API ----------

def send_email(db: Session, ws: Workspace, *, event: str, to: str | None, subject: str, heading: str,
               lines: list[str], link: str | None = None, link_label: str = "Open in Baton") -> Result:
    s = get_settings()
    if not s.email_configured:
        return Result("email", "skipped", "Email isn't configured on this server.")
    if ws.is_demo_template:
        return Result("email", "skipped", "The shared demo template never sends email.")
    if not valid_email(to):
        return Result("email", "skipped", "No valid email address for this person. Add one on the Team page.")
    to = to.strip()
    now = datetime.now(UTC)
    if _count(db, now - timedelta(days=1), "email", ws.id) >= EMAILS_PER_WORKSPACE_PER_DAY:
        return _log(db, ws.id, "email", event, mask_email(to), Result("email", "skipped", "Daily email limit for this workspace reached."))
    if _count(db, now - timedelta(days=1), "email") >= EMAILS_GLOBAL_PER_DAY:
        return _log(db, ws.id, "email", event, mask_email(to), Result("email", "skipped", "Daily email limit for this server reached."))

    msg = EmailMessage()
    msg["Subject"] = subject[:150]
    msg["From"] = s.mail_from or formataddr(("Baton", s.smtp_user))
    msg["To"] = to
    url = f"{s.app_url.rstrip('/')}{link}" if link and link.startswith("/") else link
    text = "\n".join([heading, "", *lines] + (["", f"{link_label}: {url}"] if url else []) +
                     ["", "— Baton · evidence-graded handovers", "You get this because a workspace admin added your address."])
    msg.set_content(text)
    items = "".join(f"<p style='margin:0 0 10px'>{escape(line)}</p>" for line in lines)
    button = (f"<p style='margin:22px 0'><a href='{escape(url)}' style='background:#1b2230;color:#fff;padding:11px 18px;"
              f"border-radius:10px;text-decoration:none;font-weight:600'>{escape(link_label)}</a></p>") if url else ""
    msg.add_alternative(
        f"<div style='font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px;"
        f"color:#1b2230;background:#f7f4ee'><p style='font-size:13px;color:#8a6d1f;margin:0 0 6px;font-weight:600'>BATON</p>"
        f"<h2 style='margin:0 0 14px;font-size:20px'>{escape(heading)}</h2>{items}{button}"
        f"<p style='font-size:12px;color:#6b7280;margin-top:24px'>You get this because a workspace admin added your "
        f"address to “{escape(ws.name)}”.</p></div>", subtype="html")
    try:
        _smtp_send(msg)
        res = Result("email", "sent")
    except Exception as exc:  # noqa: BLE001 - notifications must never break the action
        res = Result("email", "failed", f"{type(exc).__name__}: could not send")
    return _log(db, ws.id, "email", event, mask_email(to), res)


def send_slack(db: Session, ws: Workspace, *, event: str, title: str, lines: list[str], link: str | None = None,
               webhook: str | None = None) -> Result:
    url = (webhook or (ws.notify or {}).get("slack_webhook") or "").strip()
    if not url:
        return Result("slack", "skipped", "No Slack webhook set for this workspace.")
    if not valid_slack_webhook(url):
        return Result("slack", "skipped", "The Slack webhook URL isn't a hooks.slack.com URL.")
    if ws.is_demo_template:
        return Result("slack", "skipped", "The shared demo template never posts to Slack.")
    if _count(db, datetime.now(UTC) - timedelta(hours=1), "slack", ws.id) >= SLACK_PER_WORKSPACE_PER_HOUR:
        return _log(db, ws.id, "slack", event, mask_webhook(url), Result("slack", "skipped", "Hourly Slack limit reached."))
    s = get_settings()
    full = f"{s.app_url.rstrip('/')}{link}" if link and link.startswith("/") else link
    body = "\n".join(f"• {line}" for line in lines)
    payload = {
        "text": f"{title}\n{body}" + (f"\n{full}" if full else ""),  # fallback for notifications/clients without blocks
        "blocks": [
            {"type": "section", "text": {"type": "mrkdwn", "text": f"*{_slack_escape(title)}*\n{_slack_escape(body)}"}},
            *([{"type": "actions", "elements": [{"type": "button", "text": {"type": "plain_text", "text": "Open in Baton"},
                                                 "url": full}]}] if full else []),
            {"type": "context", "elements": [{"type": "mrkdwn", "text": f"Baton · {_slack_escape(ws.name)}"}]},
        ],
    }
    try:
        _slack_post(url, payload)
        res = Result("slack", "sent")
    except Exception as exc:  # noqa: BLE001 - notifications must never break the action
        res = Result("slack", "failed", f"{type(exc).__name__}: could not post")
    return _log(db, ws.id, "slack", event, mask_webhook(url), res)


def _slack_escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def operator_feed(text: str) -> None:
    """Optional server-wide Slack feed (SLACK_WEBHOOK_URL) for the operator: never raises, never blocks long."""
    url = get_settings().slack_webhook_url.strip()
    if not valid_slack_webhook(url):
        return
    try:
        _slack_post(url, {"text": text[:500]})
    except Exception:  # noqa: BLE001
        pass


def recent(db: Session, ws_id, limit: int = 8) -> list[dict]:
    rows = db.scalars(select(Notification).where(Notification.workspace_id == ws_id)
                      .order_by(Notification.created_at.desc()).limit(limit))
    return [{"channel": n.channel, "event": n.event, "recipient": n.recipient, "status": n.status, "detail": n.detail,
             "at": n.created_at.isoformat()} for n in rows]
