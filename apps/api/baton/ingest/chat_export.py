"""Slack-style chat export -> one chunk list per channel (each channel becomes its own source, so it can have
its own ACL; this is how #core-team stays restricted).

Accepted shapes:
  * a JSON array of messages, each with `channel` (the demo format), or
  * {"channel": "dev", "messages": [...]} / {"messages": [...]} with a default channel name.
Messages need `ts` and `text`; `user`/`user_profile.name`/`thread_ts` are optional.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import UTC, datetime, timedelta, timezone

from baton.ingest.types import ChunkDraft

MAX_CHAT_CHARS = 1500
WINDOW = timedelta(minutes=20)
IST = timezone(timedelta(hours=5, minutes=30))


class ChatExportError(ValueError):
    pass


def _when(ts: str) -> datetime:
    return datetime.fromtimestamp(float(ts), tz=UTC)


def _who(m: dict) -> str:
    return (m.get("user_profile") or {}).get("name") or m.get("user_name") or m.get("user") or "unknown"


def parse_chat_export(data: bytes | str, default_channel: str = "chat") -> dict[str, list[ChunkDraft]]:
    try:
        raw = json.loads(data)
    except json.JSONDecodeError as exc:
        raise ChatExportError(f"chat export is not valid JSON ({exc.msg})") from exc
    if isinstance(raw, dict):
        default_channel = raw.get("channel") or raw.get("name") or default_channel
        raw = raw.get("messages", [])
    if not isinstance(raw, list):
        raise ChatExportError("chat export must be a list of messages")

    by_channel: dict[str, list[dict]] = defaultdict(list)
    for m in raw:
        if not isinstance(m, dict) or "ts" not in m or not m.get("text"):
            continue
        if m.get("subtype") in {"channel_join", "channel_leave", "bot_message"}:
            continue
        by_channel[(m.get("channel") or default_channel).lstrip("#")].append(m)

    return {ch: _chunk_channel(ch, msgs) for ch, msgs in by_channel.items()}


def _chunk_channel(channel: str, msgs: list[dict]) -> list[ChunkDraft]:
    msgs.sort(key=lambda m: float(m["ts"]))
    threads: dict[str, list[dict]] = defaultdict(list)
    loose: list[dict] = []
    for m in msgs:
        if m.get("thread_ts"):
            threads[m["thread_ts"]].append(m)
        else:
            loose.append(m)

    groups: list[list[dict]] = list(threads.values())
    window: list[dict] = []
    for m in loose:  # unthreaded: group messages within 20 minutes of the previous one
        if window and _when(m["ts"]) - _when(window[-1]["ts"]) > WINDOW:
            groups.append(window)
            window = []
        window.append(m)
    if window:
        groups.append(window)

    drafts: list[ChunkDraft] = []
    for g in sorted(groups, key=lambda g: float(g[0]["ts"])):
        drafts.extend(_render_group(channel, g))
    return drafts


def _render_group(channel: str, group: list[dict]) -> list[ChunkDraft]:
    out: list[ChunkDraft] = []
    lines: list[str] = []
    ts_list: list[str] = []
    is_thread = bool(group[0].get("thread_ts"))

    def flush():
        if not lines:
            return
        first = _when(ts_list[0]).astimezone(IST)
        header = f"#{channel} {'thread' if is_thread else 'messages'} on {first:%Y-%m-%d}"
        authors = {l.split("] ", 1)[1].split(":", 1)[0] for l in lines}
        out.append(ChunkDraft(
            "chat_thread", header + "\n" + "\n".join(lines),
            {"channel": f"#{channel}", "ts": ts_list[0], "ts_list": list(ts_list),
             "thread_ts": group[0].get("thread_ts")},
            ", ".join(sorted(authors)), _when(ts_list[-1]),
        ))
        lines.clear()
        ts_list.clear()

    size = 0
    for m in group:
        line = f"[{_when(m['ts']).astimezone(IST):%Y-%m-%d %H:%M}] {_who(m)}: {m['text']}"
        if lines and size + len(line) > MAX_CHAT_CHARS:
            flush()
            size = 0
        lines.append(line)
        ts_list.append(m["ts"])
        size += len(line) + 1
    flush()
    return out
