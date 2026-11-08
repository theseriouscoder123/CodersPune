"""Conflict grouping and supersession (spec §6). The decision logic is PURE; pipeline.py applies it to the DB.

Within a subject_key, claims with different normalised values conflict UNLESS a later claim explicitly reverses the
earlier one, in which case the older claim is superseded instead. A later claim reverses an earlier one when:
  * the extractor flagged supersedes_hint, or
  * deterministically: its text uses reversal language (replaced, switched, moved from, migrated, instead of, reverted,
    dropped, taking over, ...) AND mentions the earlier claim's value.
Nothing is ever resolved by the model; genuine disagreements stay CONFLICTING for a human.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime

from baton.reconstruct.values import normalise_value

REVERSAL = re.compile(
    r"\b(replac(?:e|ed|es|ing)|switch(?:ed|es|ing)?|mov(?:ed|es|ing) (?:from|away)|migrat(?:ed|es|ing)|instead of|"
    r"revert(?:ed|s|ing)?|revers(?:ed|es|ing)|dropp(?:ed|ing)|no longer|tak(?:es|ing) over|took over|handed over|"
    r"superseded|previously|initially|formerly)\b",
    re.I,
)


@dataclass(frozen=True)
class ClaimLite:
    id: str
    subject_key: str
    value: str | None
    occurred_at: datetime | None
    supersedes_hint: bool
    text: str = ""


@dataclass
class ConflictPlan:
    superseded: dict[str, str]  # older id -> newer id
    groups: dict[str, list[str]]  # subject_key -> claim ids in the conflict


def _tokens(v: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", v) if len(t) > 1 or t.isdigit()}


def same_value(a: str | None, b: str | None) -> bool:
    na, nb = normalise_value(a), normalise_value(b)
    if na is None or nb is None:
        return False
    if na == nb:
        return True
    ta, tb = _tokens(na), _tokens(nb)
    return bool(ta and tb) and (ta <= tb or tb <= ta)  # "tailwind" vs "tailwind css"


def reverses(newer: ClaimLite, older: ClaimLite) -> bool:
    if newer.supersedes_hint:
        return True
    if not REVERSAL.search(newer.text or ""):
        return False
    ov = normalise_value(older.value)
    raw = (older.value or "").lower()
    text = (newer.text or "").lower()
    return bool(ov) and (ov in text or (raw and raw in text) or all(t in text for t in _tokens(ov)))


def _when(c: ClaimLite):
    return c.occurred_at.replace(tzinfo=None) if c.occurred_at else datetime.min


def plan_conflicts(claims: list[ClaimLite]) -> ConflictPlan:
    by_subject: dict[str, list[ClaimLite]] = {}
    for c in claims:
        if normalise_value(c.value) is not None:
            by_subject.setdefault(c.subject_key, []).append(c)

    superseded: dict[str, str] = {}
    groups: dict[str, list[str]] = {}
    for subject, cs in by_subject.items():
        cs = sorted(cs, key=_when)
        # 1. supersession: a later explicit reversal supersedes earlier claims with a different value
        for i, newer in enumerate(cs):
            for older in cs[:i]:
                if older.id in superseded or same_value(older.value, newer.value) or _when(older) > _when(newer):
                    continue
                if reverses(newer, older):
                    superseded[older.id] = newer.id
        live = [c for c in cs if c.id not in superseded]
        # 2. remaining disagreement = conflict (both sides shown, a human decides)
        distinct: list[ClaimLite] = []
        for c in live:
            if not any(same_value(c.value, d.value) for d in distinct):
                distinct.append(c)
        if len(distinct) > 1:
            groups[subject] = [c.id for c in live]
    return ConflictPlan(superseded, groups)
