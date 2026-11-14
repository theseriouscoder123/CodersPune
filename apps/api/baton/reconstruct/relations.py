"""Round 3 improvement #2: how claims about the same subject relate, and which open work is stale. PURE (trust core,
tests/test_relations.py). The LLM never decides any of this; the database layer (ledger.rebuild_relations) applies it.

Relations between an EARLIER and a LATER claim on one subject:
  reversal       the later claim replaces the earlier one: reversal language that names the earlier value, or the
                 extractor's supersedes flag, AND the later claim is not dated before the earlier one.
  historical     the earlier claim describes a past state itself ("previously used Supabase"). It is not a
                 contradiction even when it was written down later than the current claim.
  contradiction  same subject, different values, and no reversal signal (or the "replacing" claim is dated earlier
                 than the claim it would replace). A person decides.
  unrelated      only ever set by a reviewer: the two claims were grouped by mistake.

Stale open work: an open_work / next_action claim is marked stale (with a reason) when
  * a later update on the SAME item exists (same subject, same type family, later date), or
  * a later or undated decision describes the same thing as done or in place (shared content words + completion
    language), or parks it ("parked", "on hold", "dropped"...).
Stale items stay in the ledger; the successor sees them as history instead of in "Start here".
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime

from baton.reconstruct.conflicts import HISTORICAL, REVERSAL
from baton.reconstruct.values import normalise_value

OPEN_TYPES = ("open_work", "next_action")
COMPLETION = re.compile(
    r"\b(uses|now uses|is using|migrated|moved (?:to|from)|switched|replaced|implemented|shipped|launched|went live|is live|"
    r"set up|configured|completed|finished|done|merged|added|enabled|deployed|having migrated)\b", re.IGNORECASE)
PARKED = re.compile(r"\b(parked|on hold|paused|deferred|postponed|shelved|abandoned|dropped|cancelled|canceled|"
                    r"won't do|not planned)\b", re.IGNORECASE)
STOP = frozenset("""a an the and or but if of to in on at by for from with without into onto over under about after before
is are was were be been being has have had do does did will would should must can could may might shall this that these
those it its as than then so not no yes all any some each every other more most less least very just also only still yet
project app application team we our us they them their there here which who whom whose what when where why how
needs need needed tasked responsible assigned use uses used using set setting up out new now currently""".split())


@dataclass(frozen=True)
class C:
    """The claim fields the rules need (plain data, no ORM)."""
    id: str
    type: str
    text: str
    subject_key: str
    value: str | None = None
    occurred_at: datetime | None = None
    origin: str = "extracted"
    supersedes_hint: bool = False
    ref: str = ""  # first source reference, for human-readable signals


@dataclass(frozen=True)
class Relation:
    relation: str  # reversal | historical | contradiction
    signal: str


def _day(d: datetime | None) -> str:
    return d.strftime("%d %b %Y").lstrip("0") if d else "undated"


def _naive(d: datetime | None) -> datetime | None:
    return d.replace(tzinfo=None) if d else None


def _src(c: C) -> str:
    return f" ({c.ref})" if c.ref else ""


def classify_supersession(older: C, newer: C) -> Relation:
    """Explain an older -> newer supersession found by conflicts.plan_conflicts (or chosen by the reviewer)."""
    hist = HISTORICAL.search(older.text or "")
    if hist:
        return Relation("historical", f"The earlier claim describes a past state itself (“{hist.group(0)}”){_src(older)}. "
                                      f"The current state is “{newer.text}”{_src(newer)}.")
    o, n = _naive(older.occurred_at), _naive(newer.occurred_at)
    if o and n and n < o:
        return Relation("contradiction", f"The claim that would replace it is dated earlier ({_day(newer.occurred_at)}) than "
                                         f"the claim it replaces ({_day(older.occurred_at)}), so this can't be a reversal.")
    rev = REVERSAL.search(newer.text or "")
    if rev:
        return Relation("reversal", f"Reversal language “{rev.group(0)}” in the later claim{_src(newer)}, "
                                    f"{_day(newer.occurred_at)}, naming the earlier value.")
    if newer.supersedes_hint:
        return Relation("reversal", f"The later claim{_src(newer)} ({_day(newer.occurred_at)}) was extracted as replacing "
                                    "the earlier decision.")
    return Relation("reversal", f"The later claim{_src(newer)} ({_day(newer.occurred_at)}) replaces the earlier one.")


def contradiction_signal(a: C, b: C) -> str:
    va, vb = normalise_value(a.value) or a.value, normalise_value(b.value) or b.value
    return (f"Same subject ({a.subject_key.replace('.', ' ')}), different values ({va}{_src(a)} vs {vb}{_src(b)}), "
            "and no reversal language, so neither replaces the other.")


def ordered(a: C, b: C) -> tuple[C, C]:
    """(earlier, later). Undated claims describe the current code, so they sort last."""
    ka = _naive(a.occurred_at) or datetime.max
    kb = _naive(b.occurred_at) or datetime.max
    return (a, b) if (ka, a.id) <= (kb, b.id) else (b, a)


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9#]+", (text or "").lower()) if len(w) > 2 and w not in STOP}


def _later_or_undated(decision: C, work: C) -> bool:
    d, w = _naive(decision.occurred_at), _naive(work.occurred_at)
    return d is None or w is None or d > w


def stale_reasons(claims: list[C]) -> dict[str, str]:
    """id -> reason, for open work overtaken by a later update or by a decision that says it's done or parked."""
    out: dict[str, str] = {}
    live = [c for c in claims if c.origin != "checklist"]
    open_items = [c for c in live if c.type in OPEN_TYPES]
    for w in open_items:
        later_same = [o for o in open_items if o.id != w.id and o.subject_key == w.subject_key and w.occurred_at and o.occurred_at
                      and _naive(o.occurred_at) > _naive(w.occurred_at)]
        if later_same:
            newest = max(later_same, key=lambda o: _naive(o.occurred_at))
            out[w.id] = f"A later update on the same item ({_day(newest.occurred_at)}{_src(newest)}): “{newest.text}”"
            continue
        ww = _words(w.text)
        for d in live:
            if d.type != "decision" or not _later_or_undated(d, w):
                continue
            shared = ww & _words(d.text)
            if len(shared) < 2:
                continue
            if PARKED.search(d.text or ""):
                out[w.id] = f"A later decision parks this ({_day(d.occurred_at)}{_src(d)}): “{d.text}”"
                break
            if COMPLETION.search(d.text or ""):
                out[w.id] = f"A later decision says this is in place ({_day(d.occurred_at)}{_src(d)}): “{d.text}”"
                break
    return out


_TASK_START = re.compile(r"^\s*([A-Z][a-z]+)\s+(?:is|are|was|needs|need|will|must|should|has|have|to|can|plans|owns|"
                         r"handles|takes|took|asked|agreed)\b")


def task_owner(text: str) -> str | None:
    """The person a task sentence starts with ("Kabir needs to…" -> "Kabir"), else None. Capitalised common words
    at the start ("The", "Duplicate", "Marathi") don't match because they aren't followed by a verb like "is"/"needs"."""
    m = _TASK_START.match(text or "")
    if not m:
        return None
    word = m.group(1)
    return None if word.lower() in STOP or word in {"This", "That", "There", "It", "PR", "Issue"} else word


def start_here_rank(text: str, successor: str | None) -> int:
    """0: names the successor; 1: nobody in particular; 2: someone else's task (shown under owners instead)."""
    if successor and re.search(rf"\b{re.escape(successor)}\b", text or "", re.IGNORECASE):
        return 0
    owner = task_owner(text)
    if owner and (not successor or owner.lower() != successor.lower()):
        return 2
    return 1
