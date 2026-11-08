"""Slack-style chat export -> one chunk list per channel (each channel becomes its own source, so it can have
its own ACL; this is how #core-team stays restricted).

Accepted shapes:
  * a JSON array of messages, each with `channel` (the demo format), or
  * {"channel": "dev", "messages": [...]} / {"messages": [...]} with a default channel name, or
  * a Discord export (DiscordChatExporter JSON: {"channel": {"name"}, "messages": [{"id", "timestamp", "content",
    "author": {"name"}, "reference": {"messageId"}}]}); replies become threads.
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
    if isinstance(raw, dict) and _is_discord(raw):
        raw, default_channel = _from_discord(raw, default_channel)
    elif isinstance(raw, dict):
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


def _is_discord(raw: dict) -> bool:
    msgs = raw.get("messages") or []
    return isinstance(raw.get("channel"), dict) or (bool(msgs) and isinstance(msgs[0], dict)
                                                    and "content" in msgs[0] and "timestamp" in msgs[0])


def _from_discord(raw: dict, default_channel: str) -> tuple[list[dict], str]:
    """Normalise a Discord export to the Slack-like shape. A reply joins the thread of the message it replies to."""
    channel = (raw.get("channel") or {}).get("name") or default_channel
    by_id: dict[str, dict] = {}
    out: list[dict] = []
    for m in raw.get("messages") or []:
        if not isinstance(m, dict) or not (m.get("content") or "").strip():
            continue
        if m.get("type") not in (None, "Default", "Reply"):
            continue  # pins, joins, calls...
        try:
            ts = f"{datetime.fromisoformat(m['timestamp']).timestamp():.6f}"
        except (KeyError, ValueError):
            continue
        author = m.get("author") or {}
        row = {"ts": ts, "text": m["content"], "channel": channel,
               "user_profile": {"name": author.get("nickname") or author.get("name") or "unknown"}}
        parent = by_id.get(str((m.get("reference") or {}).get("messageId") or ""))
        if parent is not None:
            root_ts = parent.get("thread_ts") or parent["ts"]
            parent["thread_ts"] = root_ts
            row["thread_ts"] = root_ts
        by_id[str(m.get("id"))] = row
        out.append(row)
    return out, channel


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
