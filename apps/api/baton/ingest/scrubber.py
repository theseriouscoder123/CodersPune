"""Secret scrubbing (before storage and before any model call) and PII masking (at read time).

PURE module: no I/O, no DB. Trust core; see tests/test_scrubber.py.
"""

from __future__ import annotations

import re
from collections import Counter

REDACTED = "[REDACTED:{kind}]"

# Specific token formats first (order matters: the generic rule runs last and skips already-redacted values).
_SPECIFIC: list[tuple[str, re.Pattern[str]]] = [
    ("private_key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----")),
    ("stripe_key", re.compile(r"\b[sr]k_(?:live|test)_[0-9A-Za-z]{10,}")),
    ("github_token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})")),
    ("aws_access_key", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("google_api_key", re.compile(r"AIza[0-9A-Za-z_\-]{35}(?![0-9A-Za-z_\-])")),
    ("slack_token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")),
    ("google_api_key", re.compile(r"\bAQ\.Ab[0-9A-Za-z_\-]{30,}")),  # newer Gemini / Google AI Studio key format
    ("groq_key", re.compile(r"\bgsk_[A-Za-z0-9]{40,}")),
    ("anthropic_key", re.compile(r"\bsk-ant-[A-Za-z0-9_\-]{32,}")),
    ("openai_key", re.compile(r"\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_\-]{32,}")),
    ("slack_webhook", re.compile(r"https://hooks\.slack\.com/(?:services|workflows|triggers)/[A-Za-z0-9_/\-]{16,}")),
    ("connection_string_password",  # keep scheme and host so the claim still makes sense; drop the credentials
     re.compile(r"(?<=://)([^\s:/@]+):[^\s@/]{3,}(?=@[^\s/]+)")),
]

# `<identifier ending in key/secret/token/password> [:=] <value of 8+ chars>` -> redact the value, keep the name.
_GENERIC = re.compile(
    r"(?i)(?P<name>\b[A-Z0-9_\-.]*(?:api[_\-]?key|secret|token|passw(?:or)?d|client[_\-]?secret))"
    r"(?P<sep>[ \t]*[:=][ \t]*)(?P<q>[\"']?)(?P<value>[^\s\"'`,;)]{8,})"  # same line only
)
# Values that are references to configuration, not secrets themselves.
_REFERENCE = re.compile(
    r"^(?:process\.env|os\.environ|import\.meta|env\.|\$|<|\{|\[REDACTED|secrets\.|config\.|settings\.)", re.IGNORECASE
)


def scrub(text: str) -> tuple[str, Counter[str]]:
    """Return (scrubbed_text, counts_by_kind)."""
    counts: Counter[str] = Counter()
    for kind, pattern in _SPECIFIC:
        text, n = pattern.subn(REDACTED.format(kind=kind), text)
        if n:
            counts[kind] += n

    def _generic(m: re.Match[str]) -> str:
        value = m.group("value")
        if _REFERENCE.match(value) or _looks_like_identifier(value):
            return m.group(0)
        counts["generic_secret"] += 1
        return f"{m.group('name')}{m.group('sep')}{m.group('q')}{REDACTED.format(kind='generic_secret')}"

    text = _GENERIC.sub(_generic, text)
    return text, counts


def _looks_like_identifier(value: str) -> bool:
    """`CLOUDINARY_API_KEY` or `getToken()`-style references aren't secrets."""
    return bool(re.fullmatch(r"[A-Z][A-Z0-9_]*", value)) or value.endswith("()")


def merge_reports(*reports: dict[str, int] | Counter[str]) -> dict[str, int]:
    total: Counter[str] = Counter()
    for r in reports:
        total.update(r)
    return dict(total)


# ---------------------------------------------------------------- PII masking (applied when serving to non-reviewers)

_EMAIL = re.compile(r"\b([A-Za-z0-9._%+\-])[A-Za-z0-9._%+\-]*@([A-Za-z0-9.\-]+\.[A-Za-z]{2,})\b")
# Phone-like: optional +CC, then 10+ digits allowing spaces/dashes. Dates (8 digits) and amounts don't qualify.
_PHONE = re.compile(r"(?<![\w.])(\+\d{1,3}[\s\-]?)?(\d[\d\s\-]{8,}\d)(?!\w|\.\d)")


_DATEISH = re.compile(r"\b(?:19|20)\d{2}-\d{2}-\d{2}\b")  # ISO date inside a digit run = timestamp, not phone


def mask_pii(text: str) -> str:
    text = _EMAIL.sub(lambda m: f"{m.group(1)}***@…", text)

    def _phone(m: re.Match[str]) -> str:
        digits = re.sub(r"\D", "", m.group(2))
        if len(digits) < 10 or _DATEISH.search(m.group(0)):
            return m.group(0)  # dates/timestamps such as "2026-11-03 20:30" are not phone numbers
        cc = (m.group(1) or "").strip()
        return f"{cc + ' ' if cc else ''}{digits[:2]}{'*' * (len(digits) - 2)}"

    return _PHONE.sub(_phone, text)
