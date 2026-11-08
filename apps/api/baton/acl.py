"""Access control: PURE functions over plain data (trust core; tests/test_acl.py).

ACL shape (sources.acl): {"members": ["<member uuid>", ...], "roles": ["reviewer", "all_members", ...]}
Default deny: an empty ACL is visible to reviewers only (reviewers see every source of their workspace, spec §5).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field

ALL_MEMBERS = "all_members"


def normalise_acl(acl: Mapping | None) -> dict[str, list[str]]:
    acl = acl or {}
    return {
        "members": sorted({str(m) for m in acl.get("members", []) or []}),
        "roles": sorted({str(r) for r in acl.get("roles", []) or []}),
    }


def acl_key(acl: Mapping | None) -> str:
    """Canonical string; identical ACLs -> identical keys (extraction batches group by this)."""
    a = normalise_acl(acl)
    parts = [f"r:{r}" for r in a["roles"]] + [f"m:{m}" for m in a["members"]]
    return "|".join(parts) or "deny"


@dataclass(frozen=True)
class Viewer:
    member_id: str
    roles: frozenset[str] = field(default_factory=frozenset)

    @property
    def is_reviewer(self) -> bool:
        return "reviewer" in self.roles


def can_view_acl(viewer: Viewer, acl: Mapping | None) -> bool:
    if viewer.is_reviewer:
        return True
    a = normalise_acl(acl)
    if ALL_MEMBERS in a["roles"]:
        return True  # every workspace member
    if viewer.member_id in a["members"]:
        return True
    return bool(viewer.roles & set(a["roles"]))


def can_view_claim(viewer: Viewer, cited_source_acls: Iterable[Mapping | None]) -> bool:
    """A claim is visible only if EVERY source it cites is visible (spec §5). No evidence -> visible."""
    return all(can_view_acl(viewer, acl) for acl in cited_source_acls)


def access_label(acl: Mapping | None, member_names: Mapping[str, str] | None = None) -> str:
    """Human label for UI chips, e.g. 'All members' or 'Reviewers, Kabir, Rohan'."""
    a = normalise_acl(acl)
    if ALL_MEMBERS in a["roles"]:
        return "All members"
    names = [r.capitalize() + "s" for r in a["roles"]]
    names += sorted((member_names or {}).get(m, "1 member") for m in a["members"])
    return ", ".join(names) if names else "Reviewers only"
