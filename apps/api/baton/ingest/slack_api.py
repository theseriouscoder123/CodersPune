"""Live Slack connector (read-only, Slack Web API with a bot token). The token is used for one request and never stored.

Reads only channels the bot has been invited to. Messages are converted to the export format and parsed by the same
`parse_chat_export` as uploaded exports, so scrubbing, chunking and threading are identical. Each channel's member
list is returned so the caller can turn it into the source's access list (private channel -> only its members).

Scopes: channels:read, channels:history, groups:read, groups:history, users:read, users:read.email.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import httpx

API = "https://slack.com/api/"
TIMEOUT_S = 15
REQUIRED_SCOPES = ("channels:read", "channels:history", "groups:read", "groups:history", "users:read", "users:read.email")
MAX_MESSAGES = 1000  # per channel, newest first
MAX_THREADS = 40  # threads with replies fetched per channel


class SlackError(RuntimeError):
    def __init__(self, user_message: str):
        super().__init__(user_message)
        self.user_message = user_message


@dataclass
class SlackChannel:
    id: str
    name: str
    private: bool
    member_ids: list[str] = field(default_factory=list)
    messages: list[dict] = field(default_factory=list)


@dataclass
class SlackUser:
    id: str
    name: str
    email: str | None
    bot: bool


_ERRORS = {
    "invalid_auth": "Slack rejected the token. Paste the Bot User OAuth Token (it starts with xoxb-).",
    "not_authed": "Slack rejected the token. Paste the Bot User OAuth Token (it starts with xoxb-).",
    "token_revoked": "That Slack token was revoked. Reinstall the app and copy the new token.",
    "missing_scope": "The Slack app is missing a permission. Add channels:read, channels:history, groups:read, groups:history, "
                     "users:read and users:read.email under OAuth & Permissions, then reinstall it.",
    "not_in_channel": "The Baton app isn't in that channel. In Slack, type /invite @YourApp in the channel.",
    "channel_not_found": "Channel not found, or the app isn't in it.",
}


class SlackClient:
    def __init__(self, token: str, transport: httpx.BaseTransport | None = None):
        if not token.startswith("xoxb-"):
            raise SlackError("Paste the Bot User OAuth Token. It starts with xoxb-.")
        self._http = httpx.Client(base_url=API, timeout=TIMEOUT_S, transport=transport,
                                  headers={"Authorization": f"Bearer {token}"})

    def close(self) -> None:
        self._http.close()

    def _get(self, method: str, **params) -> dict:
        for attempt in range(3):
            try:
                r = self._http.get(method, params=params)
            except httpx.HTTPError as exc:
                raise SlackError(f"Couldn't reach Slack ({type(exc).__name__}). Try again.") from exc
            if r.status_code == 429 and attempt < 2:  # rate limited: Slack says how long to wait
                time.sleep(min(float(r.headers.get("retry-after", "1")), 5))
                continue
            data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            if not data.get("ok"):
                err = data.get("error", f"http_{r.status_code}")
                if err == "missing_scope":  # Slack says exactly which scopes are missing: name them
                    have = {x.strip() for x in (data.get("provided") or "").split(",") if x.strip()}
                    missing = [x for x in REQUIRED_SCOPES if x not in have]
                    if missing:
                        raise SlackError(f"The Slack app is missing these permissions: {', '.join(missing)}. Add them under "
                                         "OAuth & Permissions → Bot Token Scopes, click Reinstall to Workspace, then try again.")
                raise SlackError(_ERRORS.get(err, f"Slack said: {err}"))
            return data
        raise SlackError("Slack is rate limiting us. Try again in a minute.")

    def _paged(self, method: str, key: str, limit_total: int, **params) -> list[dict]:
        out: list[dict] = []
        cursor = None
        while len(out) < limit_total:
            data = self._get(method, limit=200, **({"cursor": cursor} if cursor else {}), **params)
            out += data.get(key, [])
            cursor = (data.get("response_metadata") or {}).get("next_cursor")
            if not cursor:
                break
        return out[:limit_total]

    def team(self) -> str:
        return self._get("auth.test").get("team", "Slack")

    def channels(self) -> list[SlackChannel]:
        """Channels the bot is a member of (public and private)."""
        raw = self._paged("conversations.list", "channels", 1000, types="public_channel,private_channel", exclude_archived="true")
        return [SlackChannel(c["id"], c.get("name", c["id"]), bool(c.get("is_private"))) for c in raw if c.get("is_member")]

    def users(self) -> dict[str, SlackUser]:
        out = {}
        for u in self._paged("users.list", "members", 5000):
            p = u.get("profile") or {}
            out[u["id"]] = SlackUser(u["id"], p.get("display_name") or p.get("real_name") or u.get("name") or u["id"],
                                     (p.get("email") or "").lower() or None, bool(u.get("is_bot")) or u["id"] == "USLACKBOT")
        return out

    def fill(self, ch: SlackChannel, users: dict[str, SlackUser]) -> SlackChannel:
        """Members, then messages (newest first, capped) plus replies of the busiest threads, in export format."""
        ch.member_ids = [m for m in self._paged("conversations.members", "members", 5000, channel=ch.id)
                         if m in users and not users[m].bot]
        msgs = self._paged("conversations.history", "messages", MAX_MESSAGES, channel=ch.id)
        threads = sorted((m for m in msgs if m.get("reply_count")), key=lambda m: -m.get("reply_count", 0))[:MAX_THREADS]
        for t in threads:
            msgs += [r for r in self._paged("conversations.replies", "messages", 200, channel=ch.id, ts=t["ts"]) if r.get("ts") != t["ts"]]
        name = lambda uid: users[uid].name if uid in users else uid
        ch.messages = [{"channel": ch.name, "ts": m["ts"], "text": m.get("text", ""), "thread_ts": m.get("thread_ts"),
                        "subtype": m.get("subtype"), "user": m.get("user"), "user_profile": {"name": name(m.get("user", ""))}}
                       for m in msgs if m.get("text") and not (m.get("user") in users and users[m["user"]].bot)]
        return ch


def match_members(member_ids: list[str], users: dict[str, SlackUser], baton_members: list[dict]) -> tuple[list[str], list[str]]:
    """Slack user ids -> Baton member ids, by email first, then by name or handle (case-insensitive). Returns
    (matched Baton ids, unmatched Slack names). Pure, so it can be tested without Slack."""
    by_email = {m["email"].lower(): m["id"] for m in baton_members if m.get("email")}
    by_name = {}
    for m in baton_members:
        for key in (m.get("name"), m.get("handle")):
            if key:
                by_name[key.strip().lower()] = m["id"]
    matched, unmatched = [], []
    for uid in member_ids:
        u = users.get(uid)
        if u is None:
            continue
        mid = (by_email.get(u.email) if u.email else None) or by_name.get(u.name.strip().lower()) \
            or by_name.get(u.name.strip().split(" ")[0].lower())
        if mid:
            if mid not in matched:
                matched.append(mid)
        else:
            unmatched.append(u.name)
    return matched, unmatched
