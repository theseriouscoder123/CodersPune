from datetime import datetime

import pytest

from baton.reconstruct.checklist import build_checklist
from baton.reconstruct.conflicts import ClaimLite, plan_conflicts, same_value
from baton.reconstruct.values import normalise_value


@pytest.mark.parametrize(
    "raw,expected",
    [("5 MB", "5mb"), ("5MB", "5mb"), ("5 megabytes", "5mb"), ("2 * 1024 * 1024", "2mb"), ("2097152 bytes", "2mb"),
     ("Firebase Cloud Messaging", "fcm"), ("FCM", "fcm"), ("OneSignal", "onesignal"), ("Supabase Auth", "supabase"),
     ("  Rohan ", "rohan"), (None, None), ("", None)],
)
def test_normalise_value(raw, expected):
    assert normalise_value(raw) == expected


def d(m):
    return datetime(2026, m, 1)


def test_g3_size_conflict_detected():
    plan = plan_conflicts([
        ClaimLite("notes", "upload.max_size", "5 MB", d(4), False),
        ClaimLite("code", "upload.max_size", "2 * 1024 * 1024", d(2), False),
    ])
    assert set(plan.groups["upload.max_size"]) == {"notes", "code"}
    assert not plan.superseded


def test_g7_reversal_supersedes_not_conflict():
    plan = plan_conflicts([
        ClaimLite("jan", "auth.provider", "Supabase Auth", d(1), False),
        ClaimLite("feb", "auth.provider", "Firebase Auth", d(2), True),
    ])
    assert plan.superseded == {"jan": "feb"}
    assert "auth.provider" not in plan.groups


def test_same_value_is_not_a_conflict_and_no_value_is_ignored():
    plan = plan_conflicts([
        ClaimLite("a", "notifications.provider", "FCM", d(3), False),
        ClaimLite("b", "notifications.provider", "Firebase Cloud Messaging", d(4), False),
        ClaimLite("c", "notifications.provider", None, d(5), False),
    ])
    assert not plan.groups and not plan.superseded


def test_hint_on_older_claim_does_not_supersede_newer():
    plan = plan_conflicts([
        ClaimLite("old", "x", "A", d(1), True),
        ClaimLite("new", "x", "B", d(5), False),
    ])
    assert plan.groups == {"x": ["old", "new"]}


SIGNALS = {
    "open_prs": [{"number": 142, "title": "RSVP CSV export", "author": "rohan"}, {"number": 150, "title": "x", "author": "neha"}],
    "open_issues": [{"number": 131, "title": "Duplicate reminders", "assignees": ["rohan"]},
                    {"number": 120, "title": "Leaderboard", "assignees": []}],
    "env_prefixes": {"FIREBASE": ["FIREBASE_PROJECT_ID", "FIREBASE_SERVER_KEY"]},
    "workflows": [".github/workflows/deploy.yml"],
    "path_stats": {".github/workflows/deploy.yml": {"rohan": 31, "neha": 2}, "src/a.ts": {"rohan": 3, "neha": 3}},
    "dependencies": ["next", "react", "firebase", "cloudinary", "papaparse", "zod"],
}


def test_checklist_items_from_signals():
    items = {i.subject_key: i for i in build_checklist(SIGNALS, "rohan", "Rohan")}
    assert "pr.142.status" in items and "pr.150.status" not in items       # only the leaver's PRs
    assert "issue.131.status" in items and "issue.120.status" not in items  # only assigned to the leaver
    assert items["firebase.owner"].type == "contact"
    own = items["deploy.owner"]
    assert own.stats_line == ".github/workflows/deploy.yml: 33 commits; rohan 31, neha 2"
    assert "workflow.deploy.owner" not in items  # covered by the stats-backed ownership item
    assert "owner.src_a_ts" not in items         # 50% share is not ownership
    deps = [k for k in items if k.startswith("dependency.")]
    assert deps == ["dependency.firebase", "dependency.cloudinary", "dependency.papaparse"]  # boring deps skipped, max 3


def test_reversal_language_supersedes_without_llm_hint():
    plan = plan_conflicts([
        ClaimLite("jan", "auth.provider", "Supabase Auth", d(1), False, "The project adopted Supabase Auth for sign-in."),
        ClaimLite("feb", "auth.provider", "Firebase Auth", d(2), False, "Firebase Auth replaced Supabase Auth to use one console."),
    ])
    assert plan.superseded == {"jan": "feb"} and not plan.groups


def test_handover_transition_is_not_a_conflict():
    plan = plan_conflicts([
        ClaimLite("a", "app.owner", "Rohan", d(1), False, "Rohan is the lead of the app team until November."),
        ClaimLite("b", "app.owner", "Neha", d(10), False, "Neha is taking over the app from Rohan on 15 Nov."),
    ], people=frozenset({"rohan", "neha"}))
    assert not plan.groups


def test_different_attributes_of_one_subject_do_not_conflict():
    plan = plan_conflicts([
        ClaimLite("a", "sponsor.technova", "confirmed", d(10), False, "TechNova is a confirmed sponsor."),
        ClaimLite("b", "sponsor.technova", "40000", d(10), False, "TechNova pays 40,000 if the app is live."),
        ClaimLite("c", "sponsor.technova", "Meera", d(10), False, "Meera holds the contract."),
        ClaimLite("d", "pr.142.status", "pending review", d(9), False, "PR #142 waits for review."),
        ClaimLite("e", "pr.142.status", "blocked by faculty", d(10), False, "PR #142 needs faculty sign-off."),
        ClaimLite("f", "tech.stack", "Next.js, Tailwind", d(1), False, "Uses Next.js and Tailwind."),
        ClaimLite("g", "tech.stack", "Firebase", d(1), False, "Uses Firebase."),
    ], people=frozenset({"meera"}))
    assert not plan.groups and not plan.superseded


def test_historical_claim_superseded_even_if_dated_later():
    plan = plan_conflicts([
        ClaimLite("now", "auth.provider", "Firebase Auth", None, False, "The project uses Firebase Auth."),
        ClaimLite("old", "auth.provider", "Supabase", d(2), False, "The project previously used Supabase for authentication."),
    ])
    assert plan.superseded == {"old": "now"} and not plan.groups


def test_reversal_words_without_old_value_still_conflict():
    plan = plan_conflicts([
        ClaimLite("notes", "upload.max_size", "5 MB", d(4), False, "Agreed to raise the poster upload limit to 5 MB."),
        ClaimLite("code", "upload.max_size", "2 MB", d(2), False, "The API route limits poster uploads to 2 MB."),
        ClaimLite("code2", "upload.max_size", "2 MB", d(2), False, "Poster uploads are limited to 2 MB."),
    ])
    assert set(plan.groups["upload.max_size"]) == {"notes", "code", "code2"} and not plan.superseded


def test_same_value_token_subset():
    assert same_value("Tailwind", "Tailwind CSS")
    assert same_value("FCM", "Firebase Cloud Messaging")
    assert not same_value("Supabase", "Firebase")
    assert not same_value("5 MB", "2 MB")
