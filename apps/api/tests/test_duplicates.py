"""Fix F3: deterministic duplicate merge. Pure rule table, then the apply step on a real workspace."""

import pytest
from sqlalchemy import delete, select

from baton.db.models import AuditEvent, Claim, Evidence, Workspace
from baton.db.session import SessionLocal
from baton.demo_loader import build_demo_workspace
from baton.ledger import merge_duplicates, recompute_statuses
from baton.reconstruct.duplicates import D, find_duplicates
from tests.test_acks import REPO, _claim

TAKE_A = "Neha is taking over the app from Rohan."
TAKE_B = "Neha is the successor taking over the app from Rohan."


def test_rule_table():
    a, b = D(1, "ownership", "service.transfer", TAKE_A), D(2, "ownership", "neha.transfer", TAKE_B)
    assert find_duplicates([a, b]) == [(2, 1)]  # different subject keys, same fact: the longer text survives
    # a short claim isn't swallowed by a longer one that adds a fact
    assert find_duplicates([D(1, "decision", "tech.stack", "The project uses Next.js and Tailwind CSS."),
                            D(2, "decision", "tech.stack", "The project uses Next.js 15.1.0.")]) == []
    assert find_duplicates([D(1, "risk", "x", TAKE_A), D(2, "ownership", "y", TAKE_B)]) == []  # different type
    assert find_duplicates([D(1, "ownership", "x", TAKE_A, access=frozenset({"public"})),
                            D(2, "ownership", "y", TAKE_B, access=frozenset({"core"}))]) == []  # different access
    assert find_duplicates([D(1, "ownership", "x", TAKE_A, reviewed=True), D(2, "ownership", "y", TAKE_B)]) == [(1, 2)]
    assert find_duplicates([D(1, "ownership", "x", TAKE_A, reviewed=True), D(2, "ownership", "y", TAKE_B, reviewed=True)]) == []
    assert find_duplicates([D(1, "ownership", "x", TAKE_A, locked=True), D(2, "ownership", "y", TAKE_B)]) == []
    # three copies collapse to one survivor, each dropped once
    three = find_duplicates([D(1, "ownership", "x", TAKE_A), D(2, "ownership", "y", TAKE_B), D(3, "ownership", "z", TAKE_A)])
    assert sorted(d for _, d in three) == [1, 3] and {k for k, _ in three} == {2}


@pytest.fixture()
def ws():
    db = SessionLocal()
    base = build_demo_workspace(db, template=False, name="pytest duplicates")
    db.commit()
    yield base.id
    db.execute(delete(Workspace).where(Workspace.id == base.id))
    db.commit()
    db.close()


def test_merge_moves_evidence_and_audits(ws):
    db = SessionLocal()
    try:
        a = _claim(db, ws, "ownership", TAKE_A, REPO, "OneSignal", "OneSignal")
        b = _claim(db, ws, "ownership", TAKE_B, REPO, "OneSignal", "push")
        b.subject_key = "neha.transfer"
        c = _claim(db, ws, "ownership", TAKE_B + " ", "#core-team", "TechNova pays", "TechNova pays")  # restricted copy
        recompute_statuses(db, ws)
        assert merge_duplicates(db, ws) >= 1
        assert db.get(Claim, a.id) is None
        kept = db.get(Claim, b.id)
        assert kept.text == TAKE_B
        assert len(list(db.scalars(select(Evidence).where(Evidence.claim_id == kept.id)))) == 2  # both quotes kept
        assert db.scalar(select(AuditEvent).where(AuditEvent.workspace_id == ws, AuditEvent.action == "duplicate_merged")) is not None
        assert db.get(Claim, c.id) is not None  # different access: never blended into the public claim
        assert merge_duplicates(db, ws) == 0  # idempotent
        db.rollback()
    finally:
        db.close()
