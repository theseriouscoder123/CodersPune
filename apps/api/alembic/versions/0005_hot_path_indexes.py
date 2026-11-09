"""indexes for workspace-scoped lookups, rate limits, cleanup and FK cascades

Every demo visitor gets a full copy of the template, so these tables grow with traffic. Postgres does not index
foreign keys automatically, which made cascade deletes (sandbox clean-up, workspace delete) scan whole tables.

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-09 15:30:00
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INDEXES = [
    ("members_workspace_idx", "members", "workspace_id"),
    ("memberships_workspace_idx", "memberships", "workspace_id, role"),
    ("sources_workspace_idx", "sources", "workspace_id"),
    ("runs_workspace_idx", "runs", "workspace_id, created_at"),
    ("llm_calls_workspace_idx", "llm_calls", "workspace_id, purpose, created_at"),
    ("llm_calls_run_idx", "llm_calls", "run_id"),
    ("conflict_groups_workspace_idx", "conflict_groups", "workspace_id"),
    ("handovers_workspace_idx", "handovers", "workspace_id"),
    ("workspaces_visitor_idx", "workspaces", "visitor_id, created_at"),
    ("workspaces_sandbox_of_idx", "workspaces", "sandbox_of"),
    ("visitors_ip_idx", "visitors", "ip"),
    ("visitors_last_seen_idx", "visitors", "last_seen_at"),
    ("visitors_sandbox_idx", "visitors", "sandbox_workspace_id"),
    ("member_invites_member_idx", "member_invites", "member_id"),
    ("member_bindings_workspace_idx", "member_bindings", "workspace_id, member_id"),
    ("claims_superseded_by_idx", "claims", "superseded_by"),
    ("claims_conflict_group_idx", "claims", "conflict_group_id"),
    ("review_events_actor_idx", "review_events", "actor_member_id"),
]


def upgrade() -> None:
    for name, table, cols in INDEXES:
        op.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {table} ({cols})")


def downgrade() -> None:
    for name, _, _ in INDEXES:
        op.execute(f"DROP INDEX IF EXISTS {name}")
