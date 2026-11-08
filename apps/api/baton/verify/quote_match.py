"""Deterministic quote matcher: the hard gate against fabricated quotes (trust rule 2). PURE.

A quote passes when, after normalisation, it is found in its cited chunk exactly or with rapidfuzz partial_ratio >= 90.
Offsets are mapped back to the ORIGINAL chunk text so the UI can highlight the exact span.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from rapidfuzz import fuzz

THRESHOLD = 90
MIN_FUZZY_CHARS = 12  # shorter quotes must match exactly (fuzzy matching of tiny strings is meaningless)

_DROP = set("`\"'“”‘’*_")
_WS = re.compile(r"\s")


def normalise_with_map(s: str) -> tuple[str, list[int]]:
    """Lowercase, drop markdown emphasis/quote characters, collapse whitespace. Returns (normalised, index map)."""
    out: list[str] = []
    idx: list[int] = []
    prev_space = True
    for i, ch in enumerate(s):
        if ch in _DROP:
            continue
        if _WS.match(ch):
            if prev_space:
                continue
            out.append(" ")
            idx.append(i)
            prev_space = True
            continue
        out.append(ch.lower())
        idx.append(i)
        prev_space = False
    while out and out[-1] == " ":
        out.pop()
        idx.pop()
    return "".join(out), idx


def normalise(s: str) -> str:
    return normalise_with_map(s)[0]


@dataclass(frozen=True)
class Match:
    found: bool
    score: int
    start: int | None = None  # offsets into the ORIGINAL chunk text
    end: int | None = None


def match(quote: str, chunk_text: str) -> Match:
    q = normalise(quote)
    t, tmap = normalise_with_map(chunk_text)
    if not q or not t:
        return Match(False, 0)

    pos = t.find(q)
    if pos >= 0:
        return Match(True, 100, tmap[pos], tmap[pos + len(q) - 1] + 1)

    if len(q) < MIN_FUZZY_CHARS:
        return Match(False, int(fuzz.partial_ratio(q, t)))

    al = fuzz.partial_ratio_alignment(q, t)
    score = int(round(al.score)) if al else 0
    if al is None or al.dest_end <= al.dest_start:
        return Match(False, score)
    start, end = tmap[al.dest_start], tmap[min(al.dest_end, len(tmap)) - 1] + 1
    return Match(score >= THRESHOLD, score, start, end)
