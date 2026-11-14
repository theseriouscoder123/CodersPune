"""Round 3 improvement #2: the pure relation and stale-work rules (truth table)."""

from datetime import datetime

from baton.reconstruct.relations import (
    C, classify_supersession, contradiction_signal, ordered, stale_reasons, start_here_rank, task_owner,
)


def d(s):
    return datetime.fromisoformat(s)


SUPABASE = C("a", "decision", "The project uses Supabase Auth.", "auth.provider", "supabase", d("2026-01-20"), ref="#dev 20 Jan")
FIREBASE = C("b", "decision", "Supabase Auth was replaced with Firebase Auth.", "auth.provider", "firebase", d("2026-02-09"), ref="PR #61")


def test_reversal_needs_language_and_date_order():
    r = classify_supersession(SUPABASE, FIREBASE)
    assert r.relation == "reversal" and "replaced" in r.signal and "PR #61" in r.signal and "9 Feb 2026" in r.signal


def test_backwards_dates_are_a_contradiction_not_a_reversal():
    older_later = C("x", "decision", "We use Firebase Auth.", "auth.provider", "firebase", d("2026-03-01"))
    newer_earlier = C("y", "decision", "We switched to Supabase Auth.", "auth.provider", "supabase", d("2026-02-01"))
    r = classify_supersession(older_later, newer_earlier)
    assert r.relation == "contradiction" and "dated earlier" in r.signal


def test_self_described_past_state_is_historical_even_if_written_later():
    past = C("p", "decision", "The project previously used Supabase for authentication.", "auth.provider", "supabase", d("2026-03-14"))
    now = C("n", "decision", "The project uses Firebase Auth.", "auth.provider", "firebase", d("2026-02-09"))
    r = classify_supersession(past, now)
    assert r.relation == "historical" and "previously" in r.signal


def test_extractor_hint_without_words_is_still_explained():
    a = C("a", "decision", "Uploads go to S3.", "images.provider", "s3", d("2026-01-01"))
    b = C("b", "decision", "Uploads go to Cloudinary.", "images.provider", "cloudinary", d("2026-02-01"), supersedes_hint=True)
    assert classify_supersession(a, b).relation == "reversal"


def test_contradiction_signal_and_order():
    two = C("t", "decision", "The limit is 2 MB.", "upload.max_size", "2 MB", None, ref="upload.ts:41")
    five = C("f", "decision", "The limit is 5 MB.", "upload.max_size", "5 MB", d("2026-04-02"), ref="Notes 2 Apr")
    assert "2mb" in contradiction_signal(two, five).lower().replace(" ", "") and "no reversal" in contradiction_signal(two, five)
    assert ordered(two, five) == (five, two)  # undated (current code) sorts last


def test_stale_by_later_update_on_same_item():
    a = C("a", "open_work", "The PR is still WIP waiting for faculty sign-off.", "pr.142.status", None, d("2026-09-19"))
    b = C("b", "open_work", "PR #142 is waiting for Dr. Rao's review.", "pr.142.status", None, d("2026-10-12"), ref="PR #142")
    out = stale_reasons([a, b])
    assert "a" in out and "b" not in out and "12 Oct 2026" in out["a"]


def test_stale_by_completion_or_parking_decision():
    task = C("t", "open_work", "Rohan is tasked with setting up push reminders for events.", "feature.push_notifications", None, d("2026-02-10"))
    done = C("d", "decision", "The project uses Firebase Cloud Messaging for push reminders, having migrated from OneSignal.",
             "notifications.provider", "fcm", None, ref="PR #88")
    board = C("l", "open_work", "The leaderboard feature is an empty skeleton page behind a flag.", "leaderboard.status", None, d("2026-08-12"))
    parked = C("p", "decision", "The leaderboard feature is parked until after the fest.", "issue.120.status", None, d("2026-09-25"))
    out = stale_reasons([task, done, board, parked])
    assert "in place" in out["t"] and "PR #88" in out["t"]
    assert "parks this" in out["l"]


def test_not_stale_when_decision_is_earlier_or_unrelated():
    logo = C("g", "open_work", "Neha needs to add the TechNova logo to the fest page.", "app.feature", None, d("2026-11-03"))
    sponsor = C("s", "decision", "TechNova is a confirmed sponsor for the winter fest.", "sponsor.technova", None, d("2026-10-05"))
    usage = C("u", "open_work", "Kabir needs to check Cloudinary usage after the fest.", "budget.cloudinary", None, d("2026-04-02"))
    uses = C("c", "decision", "The application uses Cloudinary for storing event posters.", "images.provider", "cloudinary", None)
    checklist = C("k", "open_work", "Status and next step for issue #131", "issue.131.status", origin="checklist")
    later = C("m", "open_work", "Duplicate reminders remain unresolved.", "issue.131.status", None, d("2026-10-28"))
    assert stale_reasons([logo, sponsor, usage, uses, checklist, later]) == {}


def test_task_owner_and_start_here_rank():
    assert task_owner("Kabir needs to check Cloudinary usage") == "Kabir"
    assert task_owner("Sana is preparing winter fest poster drafts") == "Sana"
    assert task_owner("Duplicate reminder notifications remain unresolved") is None
    assert task_owner("Marathi translations are requested") is None
    assert task_owner("The PR is waiting for review") is None
    assert start_here_rank("Neha will receive admin access", "Neha") == 0
    assert start_here_rank("Rohan must transfer Vercel ownership to Neha before 15 Nov", "Neha") == 0
    assert start_here_rank("Organiser role management is needed", "Neha") == 1
    assert start_here_rank("Sana is preparing poster drafts", "Neha") == 2
