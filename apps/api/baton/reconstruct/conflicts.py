"""Conflict grouping and supersession (spec §6). The decision logic is PURE; pipeline.py applies it to the DB.

Within a subject_key, claims with different normalised values conflict, UNLESS the later one carries
supersedes_hint (explicit reversal), in which case the older claim is superseded instead. Never resolved by the model.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from baton.reconstruct.values import normalise_value


@dataclass(frozen=True)
class ClaimLite:
    id: str
    subject_key: str
    value: str | None
    occurred_at: datetime | None
    supersedes_hint: bool


@dataclass
class ConflictPlan:
    superseded: dict[str, str]  # older id -> newer id
    groups: dict[str, list[str]]  # subject_key -> claim ids in the conflict


def plan_conflicts(claims: list[ClaimLite]) -> ConflictPlan:
    by_subject: dict[str, list[ClaimLite]] = {}
    for c in claims:
        if normalise_value(c.value) is not None:
            by_subject.setdefault(c.subject_key, []).append(c)

    superseded: dict[str, str] = {}
    groups: dict[str, list[str]] = {}
    epoch = datetime.min

    for subject, cs in by_subject.items():
        cs = sorted(cs, key=lambda c: (c.occurred_at.replace(tzinfo=None) if c.occurred_at else epoch))
        # 1. supersession: a later claim with an explicit reversal supersedes every earlier claim with another value
        for i, newer in enumerate(cs):
            if not newer.supersedes_hint:
                continue
            nv = normalise_value(newer.value)
            for older in cs[:i]:
                if older.id not in superseded and normalise_value(older.value) != nv:
                    superseded[older.id] = newer.id
        live = [c for c in cs if c.id not in superseded]
        values = {normalise_value(c.value) for c in live}
        # 2. remaining disagreement = conflict (both sides shown, a human decides)
        if len(values) > 1:
            groups[subject] = [c.id for c in live]
    return ConflictPlan(superseded, groups)
