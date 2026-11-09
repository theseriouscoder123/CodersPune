"""Claim status from evidence + review state. PURE, deterministic (trust rule 1; spec §4). The LLM never decides this.

Rules, first match wins:
  1 review_state == rejected                        -> rejected
  2 in an unresolved conflict group                 -> conflicting
  3 origin == checklist and no passing evidence     -> missing
  4 review_state == confirmed and >=1 passing       -> verified
  5 review_state == promoted (note required)        -> verified (+ reviewer_confirmed_without_evidence)
  6 >=1 passing evidence                            -> supported
  7 otherwise                                       -> inferred
where passing = quote_found AND verdict == "supports".
"""

from __future__ import annotations

from dataclasses import dataclass, field

STATUSES = ("verified", "supported", "inferred", "conflicting", "missing", "rejected")


@dataclass(frozen=True)
class EvidenceState:
    quote_found: bool
    verdict: str  # supports | contradicts | insufficient | pending
    source_ref: str = "source"  # e.g. "PR #88", "#dev 12 Mar", "upload.ts:41"
    match_score: int = 0
    verdict_reason: str | None = None

    @property
    def passes(self) -> bool:
        return self.quote_found and self.verdict == "supports"

    @property
    def contradicts(self) -> bool:
        return self.quote_found and self.verdict == "contradicts"


@dataclass(frozen=True)
class ClaimState:
    origin: str  # extracted | checklist | testimony
    review_state: str = "none"  # none | confirmed | edited | rejected | promoted
    evidence: tuple[EvidenceState, ...] = ()
    in_unresolved_conflict: bool = False
    conflict_with: str | None = None  # "'<other claim text>' (<source ref>)"
    reviewer_name: str = "the reviewer"
    reviewer_note: str | None = None
    checklist_signal: str | None = None  # why the checklist expected this item
    source_changed: str | None = None  # set when a refresh removed the text this claim's evidence quoted


@dataclass(frozen=True)
class StatusResult:
    status: str
    reason: str
    flags: dict = field(default_factory=dict)


def _first_failure(evidence: tuple[EvidenceState, ...]) -> str:
    if not evidence:
        return "no source evidence was cited"
    for e in evidence:
        if not e.quote_found:
            return f"quote not found in {e.source_ref} (best match {e.match_score})"
    for e in evidence:
        if e.verdict == "pending":
            return f"verification unavailable for the quote in {e.source_ref}"
        if e.verdict != "supports":
            why = f" ({e.verdict_reason})" if e.verdict_reason else ""
            return f"verifier: {e.verdict} for {e.source_ref}{why}"
    return "no quote passed"


def compute_status(c: ClaimState) -> StatusResult:
    passing = [e for e in c.evidence if e.passes]
    best = max(passing, key=lambda e: e.match_score) if passing else None

    if c.review_state == "rejected":
        return StatusResult("rejected", f"Rejected by {c.reviewer_name}" + (f" · note: '{c.reviewer_note}'" if c.reviewer_note else ""))

    if c.in_unresolved_conflict:
        other = f": {c.conflict_with}" if c.conflict_with else ""
        return StatusResult("conflicting", f"Disagrees with another claim{other}. Pick one, or keep both as an open risk.")

    if c.origin == "checklist" and not passing:
        signal = c.checklist_signal or "the repository structure"
        return StatusResult("missing", f"Expected because {signal}; no source covers it.")

    if c.review_state == "confirmed" and best:
        return StatusResult("verified", f"Confirmed by {c.reviewer_name} · quote found in {best.source_ref} "
                                        f"(match {best.match_score}) · verifier: supports")

    if c.review_state == "promoted":
        if not (c.reviewer_note or "").strip():
            # Promotion without a note is invalid; treat as not promoted (the API also rejects it).
            return compute_status(ClaimState(**{**c.__dict__, "review_state": "none"}))
        return StatusResult("verified", f"Reviewer-confirmed without source evidence · note: '{c.reviewer_note}'",
                            {"reviewer_confirmed_without_evidence": True})

    if best:
        return StatusResult("supported", f"Quote found in {best.source_ref} (match {best.match_score}) · "
                                         "verifier: supports · not yet confirmed by a person")

    if c.source_changed:
        return StatusResult("inferred", f"The source changed: {c.source_changed}. Check it again before relying on it.",
                            {"source_changed": True})
    prefix = f"Confirmed by {c.reviewer_name}, but no quote passed: " if c.review_state == "confirmed" else "No quote passed: "
    return StatusResult("inferred", prefix + _first_failure(c.evidence))
