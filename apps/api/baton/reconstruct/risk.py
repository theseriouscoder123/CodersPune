"""Knowledge risk: where knowledge would be lost if one person left (pure, no AI).

The handover loop starts when someone is already leaving. This module looks earlier, from data Baton already has:

* sole maintainer:    files where one person made >= 75% of at least 5 commits (computed commit statistics)
* open tasks:         open work / next actions that name the person ("Rohan must…", "assigned to Rohan")
* unanswered gaps:    Missing checklist items that point at the person (e.g. "open issue #131 is assigned to rohan")
* only written down by them: live claims whose every cited passage was written by that person alone

Each signal has a fixed weight and the score is shown with its breakdown, so the level is explainable. Project-wide,
Missing ownership/contact items are listed as services and accounts with no named owner. The caller passes only
data the viewer may see (permissions are applied before this module runs).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from baton.reconstruct.relations import task_owner

SOLE_SHARE = 0.75
SOLE_MIN_COMMITS = 5
WEIGHTS = {"sole_files": 3, "open_tasks": 2, "unanswered": 2, "only_source": 1}
HIGH, MEDIUM = 10, 4
_STATS = re.compile(r"^(?P<path>.+?): (?P<total>\d+) commits; (?P<authors>.+)$", re.MULTILINE)


@dataclass(frozen=True)
class FileStat:
    path: str
    total: int
    authors: dict  # login -> commits


@dataclass(frozen=True)
class ClaimLite:
    id: str
    type: str
    text: str
    status: str
    origin: str = "extracted"
    live: bool = True  # not rejected, superseded or stale
    authors: frozenset = frozenset()  # authors of every cited passage (empty = unknown, e.g. notes or files)
    signal: str = ""  # checklist: why Baton expected this


@dataclass
class Person:
    key: str
    name: str
    sole_files: list = field(default_factory=list)
    open_tasks: list = field(default_factory=list)
    unanswered: list = field(default_factory=list)
    only_source: list = field(default_factory=list)

    @property
    def breakdown(self) -> dict:
        return {k: len(getattr(self, k)) for k in WEIGHTS}

    @property
    def score(self) -> int:
        return sum(WEIGHTS[k] * n for k, n in self.breakdown.items())

    @property
    def level(self) -> str:
        return "high" if self.score >= HIGH else "medium" if self.score >= MEDIUM else "low"


def parse_stats(text: str) -> list[FileStat]:
    """'Commit statistics …\\n<path>: 33 commits; rohan 31, neha 2' -> FileStat rows."""
    out = []
    for m in _STATS.finditer(text or ""):
        authors = {}
        for part in m.group("authors").split(","):
            bits = part.strip().rsplit(" ", 1)
            if len(bits) == 2 and bits[1].isdigit():
                authors[bits[0].strip().lower()] = int(bits[1])
        out.append(FileStat(m.group("path").strip(), int(m.group("total")), authors))
    return out


def _named(text: str, name: str) -> bool:
    return bool(re.search(rf"\b{re.escape(name)}\b", text or "", re.IGNORECASE))


def assess(files: list[FileStat], claims: list[ClaimLite], people: dict[str, str]) -> tuple[list[Person], list[ClaimLite]]:
    """people: key (handle/login, lower case) -> display name. Contributors seen in commit stats or authorship but not
    in `people` are added under their login. Returns (people sorted by score, unowned services)."""
    persons: dict[str, Person] = {k.lower(): Person(k.lower(), v) for k, v in people.items()}

    def get(key: str) -> Person:
        key = key.lower()
        if key not in persons:
            persons[key] = Person(key, key.capitalize())
        return persons[key]

    for f in files:
        if f.total < SOLE_MIN_COMMITS or not f.authors:
            continue
        top, n = max(f.authors.items(), key=lambda kv: kv[1])
        if n / f.total >= SOLE_SHARE:
            get(top).sole_files.append({"path": f.path, "commits": n, "total": f.total})
    for c in claims:
        if not c.live:
            continue
        if c.origin == "checklist" and c.status == "missing":
            for p in list(persons.values()):
                if _named(c.signal, p.key) or _named(c.signal, p.name):
                    p.unanswered.append(c)
            continue
        if c.type in ("open_work", "next_action") and c.status in ("supported", "verified", "conflicting"):
            owner = task_owner(c.text)
            for p in list(persons.values()):
                if (owner and owner.lower() in (p.key, p.name.lower())) or re.search(rf"assigned to {re.escape(p.name)}\b", c.text, re.IGNORECASE):
                    p.open_tasks.append(c)
        if c.origin != "checklist" and c.status in ("supported", "verified") and len(c.authors) == 1:
            (only,) = tuple(c.authors)
            get(only).only_source.append(c)
    unowned = [c for c in claims if c.live and c.origin == "checklist" and c.status == "missing" and c.type in ("contact", "ownership")]
    ranked = sorted((p for p in persons.values() if p.score > 0 or p.key in {k.lower() for k in people}),
                    key=lambda p: (-p.score, p.name))
    return ranked, unowned
