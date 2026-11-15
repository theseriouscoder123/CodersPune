"""Fix F3: deterministic duplicate merge (pure). The extractor's dedupe only merges within one subject key, so two
batches can still produce the same fact under different keys ("Neha is taking over the app from Rohan." twice).

Two claims are duplicates when they have the same type, neither is in a conflict group, at most one has been reviewed,
both cite sources with exactly the same access (trust rule 6: a merge must never blend
restricted and public evidence into one claim), and their texts are nearly the same: token-set similarity >= 90 AND plain similarity >= 75 (or the same subject key
and token-set >= 90). The plain-similarity floor stops a short claim being swallowed by a longer one that adds a new
fact ("uses Next.js and Tailwind" vs "uses Next.js 15.1.0" stays two claims). The reviewed one survives, otherwise the
longer text. A second, narrow rule: two claims citing the SAME passage where one's words are contained in the
other's after light stemming ("Neha takes over the app." inside "Neha is taking over the app from Rohan.").
A third rule (D73): a decision or dependency with the same subject key and the same normalised value as another is the
same fact in different words ("15-minute timeout" in the workflow file and "timeout after 15 minutes" in the commit
log). Ownership and open work never merge this way: two ownership claims about Neha can be different duties.
Evidence is moved to the survivor, so nothing is lost, and every merge is audited.
Checklist questions are never merged: "Status and next step for issue #131" stays Missing even beside a claim that
the issue is unresolved, because the next step is still unknown (golden ledger G14)."""

from __future__ import annotations

import re
from dataclasses import dataclass

from rapidfuzz import fuzz

from baton.reconstruct.values import normalise_value

SET_MIN, PLAIN_MIN = 90, 75


@dataclass(frozen=True)
class D:
    id: object
    type: str
    subject_key: str
    text: str
    reviewed: bool = False
    access: frozenset = frozenset()  # the access keys of every cited source
    chunks: frozenset = frozenset()  # cited chunk ids
    locked: bool = False  # in a conflict group, a reviewer relation, acknowledged, testimony or checklist: never merged
    value: str | None = None


VALUE_TYPES = ("decision", "dependency")


def same_value(a: D, b: D) -> bool:
    if a.type not in VALUE_TYPES or a.type != b.type or a.subject_key != b.subject_key or a.access != b.access:
        return False
    va, vb = normalise_value(a.value), normalise_value(b.value)
    return bool(va) and va == vb


_WORD = re.compile(r"[a-z0-9]+")


def _stems(text: str) -> set[str]:
    out = set()
    for w in _WORD.findall(text.lower()):
        for suf in ("ing", "es", "ed", "s"):
            if w.endswith(suf) and len(w) - len(suf) >= 3:
                w = w[: -len(suf)]
                break
        out.add(w)
    return out - {"is", "the", "a", "an", "of", "to"}


def similar(a: D, b: D) -> bool:
    if a.type != b.type or a.access != b.access:
        return False
    if same_value(a, b):
        return True
    if a.chunks & b.chunks:  # same passage: one claim's words contained in the other's
        sa, sb = _stems(a.text), _stems(b.text)
        if sa and sb and (sa <= sb or sb <= sa) and min(len(sa), len(sb)) >= 3:
            return True
    s = fuzz.token_set_ratio(a.text.lower(), b.text.lower())
    if s < SET_MIN:
        return False
    return a.subject_key == b.subject_key or fuzz.ratio(a.text.lower(), b.text.lower()) >= PLAIN_MIN


def find_duplicates(claims: list[D]) -> list[tuple[object, object]]:
    """[(keep_id, drop_id)], each dropped claim once, never a reviewed or locked one."""
    out: list[tuple[object, object]] = []
    dropped: set = set()
    pool = [c for c in claims if not c.locked]
    for i, a in enumerate(pool):
        if a.id in dropped:
            continue
        for b in pool[i + 1:]:
            if b.id in dropped or not similar(a, b) or (a.reviewed and b.reviewed):
                continue
            keep, drop = (a, b) if (a.reviewed or (not b.reviewed and len(a.text) >= len(b.text))) else (b, a)
            out.append((keep.id, drop.id))
            dropped.add(drop.id)
            if drop is a:
                break
    return out

