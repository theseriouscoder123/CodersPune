from baton.acl import Viewer, access_label, acl_key, can_view_acl, can_view_claim

EVERYONE = {"roles": ["all_members"]}
CORE = {"roles": ["reviewer"], "members": ["kabir-id", "rohan-id"]}

meera = Viewer("meera-id", frozenset({"admin", "reviewer"}))
rohan = Viewer("rohan-id", frozenset({"leaver", "member"}))
neha = Viewer("neha-id", frozenset({"successor", "member"}))
kabir = Viewer("kabir-id", frozenset({"member"}))


def test_acl_key_is_canonical():
    assert acl_key({"members": ["b", "a"], "roles": ["x"]}) == acl_key({"roles": ["x", "x"], "members": ["a", "b"]})
    assert acl_key(EVERYONE) != acl_key(CORE)
    assert acl_key({}) == acl_key(None) == "deny"


def test_core_team_visibility():
    assert can_view_acl(meera, CORE)   # reviewer sees all
    assert can_view_acl(rohan, CORE)
    assert can_view_acl(kabir, CORE)
    assert not can_view_acl(neha, CORE)  # G8: Neha excluded


def test_default_deny():
    assert not can_view_acl(neha, {})
    assert not can_view_acl(neha, None)
    assert can_view_acl(meera, {})  # reviewers can still review everything


def test_claim_needs_every_cited_source():
    assert can_view_claim(neha, [EVERYONE, EVERYONE])
    assert not can_view_claim(neha, [EVERYONE, CORE])  # one restricted citation withholds the claim
    assert can_view_claim(rohan, [EVERYONE, CORE])
    assert can_view_claim(neha, [])  # no evidence (e.g. Missing) -> visible


def test_access_label():
    assert access_label(EVERYONE) == "All members"
    assert access_label(CORE, {"kabir-id": "Kabir", "rohan-id": "Rohan"}) == "Reviewers, Kabir, Rohan"
    assert access_label({}) == "Reviewers only"
