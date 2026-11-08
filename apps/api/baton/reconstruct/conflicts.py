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
    r"revert(?:ed|s|ing)?|revers(?:ed|es|ing)|dropp(?:ed|ing)|no longer|tak(?:es|ing) over|took over|handed over)\b",
    re.I,
)
# A claim that describes a PAST state of affairs is itself the old side of a reversal.
HISTORICAL = re.compile(r"\b(previously|initially|originally|formerly|used to|at first|was replaced|were replaced|"
                        r"before (?:switching|moving|migrating))\b", re.I)
_SIZE = re.compile(r"^\d+(?:\.\d+)?(?:b|kb|mb|gb)$")


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


def value_class(value: str | None, people: frozenset[str] = frozenset()) -> str | None:
    """Only values of the same class are comparable. Free text, lists and people's names are not compared
    (ownership changes between members are the handover itself, not a contradiction)."""
    v = normalise_value(value)
    if v is None or v in people:
        return None
    if _SIZE.match(v):
        return "size"
    if re.fullmatch(r"\d+(?:\.\d+)?", v.replace(",", "")):
        return "number"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        return "date"
    if re.fullmatch(r"[a-z][a-z0-9.+\-]*", v):
        return "token"
    return None


def _when(c: ClaimLite):
    return c.occurred_at.replace(tzinfo=None) if c.occurred_at else datetime.min


def plan_conflicts(claims: list[ClaimLite], people: frozenset[str] = frozenset()) -> ConflictPlan:
    by_subject: dict[tuple[str, str], list[ClaimLite]] = {}
    for c in claims:
        cls = value_class(c.value, people)
        if cls is not None:
            by_subject.setdefault((c.subject_key, cls), []).append(c)

    superseded: dict[str, str] = {}
    groups: dict[str, list[str]] = {}
    for (subject, _cls), cs in by_subject.items():
        cs = sorted(cs, key=_when)
        # 1a. self-described past states are superseded by a current claim with a different value
        current = [c for c in cs if not HISTORICAL.search(c.text or "")]
        for old in cs:
            if HISTORICAL.search(old.text or ""):
                newer = next((n for n in reversed(current) if not same_value(old.value, n.value)), None)
                if newer is not None:
                    superseded[old.id] = newer.id
        # 1b. a later explicit reversal supersedes earlier claims with a different value
        for i, newer in enumerate(cs):
            if newer.id in superseded:
                continue
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
            groups.setdefault(subject, []).extend(c.id for c in live)
    return ConflictPlan(superseded, groups)
