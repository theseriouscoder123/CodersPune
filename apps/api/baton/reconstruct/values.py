"""Normalise claim values so conflicts compare like with like (docs/03 §6). PURE."""

from __future__ import annotations

import re

_PROVIDER_ALIASES = {
    "firebase cloud messaging": "fcm", "fcm": "fcm", "google fcm": "fcm",
    "onesignal": "onesignal", "one signal": "onesignal",
    "supabase auth": "supabase", "supabase": "supabase",
    "firebase auth": "firebase", "firebase authentication": "firebase", "firebase": "firebase",
    "vercel": "vercel", "cloudinary": "cloudinary",
}
_UNITS = {"b": 1, "byte": 1, "bytes": 1, "kb": 1024, "kib": 1024, "kilobytes": 1024,
          "mb": 1024**2, "mib": 1024**2, "megabyte": 1024**2, "megabytes": 1024**2,
          "gb": 1024**3, "gib": 1024**3, "gigabytes": 1024**3}
_SIZE = re.compile(r"^(\d+(?:\.\d+)?)\s*([a-z]+)$")
_BYTE_EXPR = re.compile(r"^[\d\s*()+]+$")


def _fmt_bytes(n: float) -> str:
    for unit, size in (("gb", 1024**3), ("mb", 1024**2), ("kb", 1024)):
        if n >= size and abs(n / size - round(n / size, 2)) < 1e-9:
            v = round(n / size, 2)
            return f"{int(v) if v == int(v) else v}{unit}"
    return f"{int(n)}b"


def _eval_byte_expr(s: str) -> float | None:
    """Tiny safe evaluator for '2 * 1024 * 1024' style expressions (digits, *, +, parentheses only)."""
    if not _BYTE_EXPR.match(s) or "*" not in s:
        return None
    tokens = re.findall(r"\d+|[*+()]", s)

    def expr(i):
        v, i = term(i)
        while i < len(tokens) and tokens[i] == "+":
            r, i = term(i + 1)
            v += r
        return v, i

    def term(i):
        v, i = factor(i)
        while i < len(tokens) and tokens[i] == "*":
            r, i = factor(i + 1)
            v *= r
        return v, i

    def factor(i):
        if tokens[i] == "(":
            v, i = expr(i + 1)
            return v, i + 1
        return float(tokens[i]), i + 1

    try:
        v, i = expr(0)
        return v if i == len(tokens) else None
    except (IndexError, ValueError):
        return None


def normalise_value(value: str | None) -> str | None:
    if value is None:
        return None
    s = re.sub(r"\s+", " ", str(value).strip().lower()).strip(" .\"'`")
    if not s:
        return None
    if s in _PROVIDER_ALIASES:
        return _PROVIDER_ALIASES[s]
    m = _SIZE.match(s.replace(",", ""))
    if m and m.group(2) in _UNITS:
        return _fmt_bytes(float(m.group(1)) * _UNITS[m.group(2)])
    n = _eval_byte_expr(s)
    if n is not None:
        return _fmt_bytes(n)
    return s
