import pytest

from baton.status import ClaimState, EvidenceState, compute_status
from baton.verify.quote_match import match, normalise

PASS = EvidenceState(True, "supports", "PR #88", 97)
NOT_FOUND = EvidenceState(False, "supports", "PR #12", 61)
INSUFF = EvidenceState(True, "insufficient", "#dev 12 Mar", 100, "excerpt doesn't state the date")
PENDING = EvidenceState(True, "pending", "PR #88", 100)
CONTRA = EvidenceState(True, "contradicts", "upload.ts:41", 100)


# ------------------------------------------------------------------ status.py: every row of spec §4

@pytest.mark.parametrize(
    "state,expected",
    [
        (ClaimState("extracted", "rejected", (PASS,), in_unresolved_conflict=True), "rejected"),        # 1 beats all
        (ClaimState("extracted", "confirmed", (PASS,), in_unresolved_conflict=True), "conflicting"),    # 2 beats 4
        (ClaimState("checklist", "none", ()), "missing"),                                               # 3
        (ClaimState("checklist", "none", (INSUFF,)), "missing"),                                        # 3 (no pass)
        (ClaimState("checklist", "none", (PASS,)), "supported"),                                        # covered item
        (ClaimState("extracted", "confirmed", (PASS,)), "verified"),                                    # 4
        (ClaimState("extracted", "promoted", (), reviewer_note="Rohan told me in person"), "verified"), # 5
        (ClaimState("extracted", "none", (NOT_FOUND, PASS)), "supported"),                              # 6 any pass
        (ClaimState("extracted", "edited", (PASS,)), "supported"),                                      # edit re-verified
        (ClaimState("extracted", "none", (NOT_FOUND,)), "inferred"),                                    # 7 fabricated quote
        (ClaimState("extracted", "none", (INSUFF,)), "inferred"),                                       # 7 verifier says no
        (ClaimState("extracted", "none", (CONTRA,)), "inferred"),                                       # contradiction alone
        (ClaimState("extracted", "none", (PENDING,)), "inferred"),                                      # verifier unavailable
        (ClaimState("extracted", "confirmed", (NOT_FOUND,)), "inferred"),                               # confirm can't fake evidence
        (ClaimState("extracted", "none", ()), "inferred"),
    ],
)
def test_status_rules(state, expected):
    assert compute_status(state).status == expected


def test_promotion_requires_note():
    r = compute_status(ClaimState("extracted", "promoted", (), reviewer_note="  "))
    assert r.status == "inferred"
    r = compute_status(ClaimState("extracted", "promoted", (), reviewer_note="confirmed with Rohan"))
    assert r.flags == {"reviewer_confirmed_without_evidence": True}
    assert "Reviewer-confirmed without source evidence" in r.reason


def test_reasons_explain_the_status():
    assert "not yet confirmed by a person" in compute_status(ClaimState("extracted", "none", (PASS,))).reason
    assert "quote not found in PR #12" in compute_status(ClaimState("extracted", "none", (NOT_FOUND,))).reason
    assert "doesn't state the date" in compute_status(ClaimState("extracted", "none", (INSUFF,))).reason
    assert "Expected because open PR #142" in compute_status(
        ClaimState("checklist", checklist_signal="open PR #142 is authored by Rohan")).reason
    assert "Confirmed by Meera" in compute_status(ClaimState("extracted", "confirmed", (PASS,), reviewer_name="Meera")).reason


def test_status_is_deterministic():
    s = ClaimState("extracted", "none", (NOT_FOUND, PASS))
    assert len({(r.status, r.reason) for r in (compute_status(s) for _ in range(20))}) == 1


# ------------------------------------------------------------------ quote_match.py

CHUNK = (
    "PR #88 'Move push reminders from OneSignal to FCM' by rohan (merged)\n\n"
    "Switching push reminders to Firebase Cloud Messaging. The OneSignal free plan caps us at the device limit "
    "before fest, and we'd blow past it on day one."
)


def test_exact_match_offsets_point_into_original_text():
    q = "The OneSignal free plan caps us at the device limit before fest"
    m = match(q, CHUNK)
    assert m.found and m.score == 100
    assert CHUNK[m.start : m.end] == q


def test_normalisation_ignores_case_quotes_markdown_whitespace():
    assert normalise("**The**  “OneSignal”\n free") == "the onesignal free"
    m = match("the onesignal FREE plan   caps us at the **device limit**", CHUNK)
    assert m.found and m.score == 100


def test_small_typo_still_matches_with_offsets():
    m = match("The OneSignal free plan caps us at the devise limit before fest", CHUNK)
    assert m.found and 90 <= m.score < 100
    assert "device limit" in CHUNK[m.start : m.end]


@pytest.mark.parametrize(
    "fabricated",
    [
        "The OneSignal paid plan was too expensive for the club budget",    # plausible but not there
        "Firebase Cloud Messaging was chosen because Meera asked for it",
        "caps us at the device limit before fest ... we picked FCM over APNs",  # stitched + invented
    ],
)
def test_fabricated_quotes_fail(fabricated):
    assert not match(fabricated, CHUNK).found


def test_short_quotes_need_exact_match():
    assert match("FCM", CHUNK).found
    assert not match("FCN", CHUNK).found


def test_code_line_quote():
    code = "// Max poster size accepted by the API route.\nexport const MAX_BYTES = 2 * 1024 * 1024;\n"
    m = match("export const MAX_BYTES = 2 * 1024 * 1024;", code)
    assert m.found and code[m.start : m.end] == "export const MAX_BYTES = 2 * 1024 * 1024;"


def test_quote_match_survives_unicode_that_lowercases_to_several_chars():
    from baton.verify.quote_match import match as _match, normalise_with_map

    for text in ["Turkish İstanbul and İzmir", "Straße", "ǅemal", "ﬁle and ﬂow", "İİİİİİİİİİİİİİİİ end"]:
        norm, idx = normalise_with_map(text)
        assert len(norm) == len(idx)
    m = _match("We love İstanbul in spring", "Notes: We love İstanbul in spring, said Ayşe.")
    assert m.found and m.start is not None and m.end is not None
    m = _match("transliterate İ to I correctly please", "slugify should transliterate İ to I correctly please, see #12")
    assert m.found
