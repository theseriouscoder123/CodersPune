"""Short human source references for UI and status reasons, e.g. 'PR #88', '#dev · 12 Mar', 'upload.ts:41'. PURE."""

from __future__ import annotations

from datetime import timedelta, timezone

from baton.ingest.chunker import line_of_offset

IST = timezone(timedelta(hours=5, minutes=30))


def _date(dt) -> str:
    if not dt:
        return ""
    local = dt.astimezone(IST)
    return f"{local.day} {local:%b}"


def source_ref(kind: str, location: dict, occurred_at=None, source_name: str = "", text: str = "",
               match_start: int | None = None) -> str:
    loc = location or {}
    if kind == "pr":
        return f"PR #{loc.get('pr')}"
    if kind == "pr_comment":
        return f"PR #{loc.get('pr')} review comment"
    if kind == "issue":
        return f"issue #{loc.get('issue')}"
    if kind == "issue_comment":
        return f"PR #{loc['pr']} comment" if loc.get("pr") else f"issue #{loc.get('issue')} comment"
    if kind == "commit_stats":
        return f"{(loc.get('file') or '').rsplit('/', 1)[-1]} commit history"
    if kind == "commit":
        return "commit log"
    if kind == "file":
        name = (loc.get("file") or "").rsplit("/", 1)[-1]
        if match_start is not None and text:
            line = line_of_offset(text, match_start, loc.get("line_start", 1)) - loc.get("prefix_lines", 0)
            return f"{name}:{line}"
        return name
    if kind == "note_para":
        f = (loc.get("file") or source_name).rsplit(".", 1)[0]
        return f"Notes {_date(occurred_at)} ({f})".replace("  ", " ") if occurred_at else f"Notes ({f})"
    if kind == "chat_thread":
        return f"{loc.get('channel', source_name)} · {_date(occurred_at)}"
    if kind == "testimony":  # gap interview answer (Round 3, improvement #1)
        return f"Leaver testimony · {loc.get('respondent', 'leaver')} · {_date(occurred_at)} · Q{loc.get('question', '?')}"
    return source_name or kind
