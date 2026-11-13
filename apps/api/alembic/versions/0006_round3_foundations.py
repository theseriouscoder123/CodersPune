"""Round 3 foundations: gap interviews (#1), claim relations and stale work (#2), acknowledgements and
re-rendered claims (#3), and an audit log for admin changes such as source access lists.

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-14 00:15:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSONB = postgresql.JSONB(astext_type=sa.Text())


def _id() -> sa.Column:
    return sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False, primary_key=True)


def _created() -> sa.Column:
    return sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False)


def _fk(name: str, target: str, *, nullable: bool = False, ondelete: str = "CASCADE") -> sa.Column:
    return sa.Column(name, sa.UUID(), sa.ForeignKey(target, ondelete=ondelete), nullable=nullable)


def upgrade() -> None:
    # --- #2: stale open work; #3: claims re-rendered from accessible sources ---
    op.add_column("claims", sa.Column("stale_reason", sa.Text(), nullable=True))
    op.add_column("claims", _fk("derived_from", "claims.id", nullable=True, ondelete="SET NULL"))
    op.create_index("claims_derived_from_idx", "claims", ["derived_from"])

    # --- #1: gap interview ---
    op.create_table(
        "interviews",
        _id(),
        _fk("workspace_id", "workspaces.id"),
        _fk("handover_id", "handovers.id", nullable=True, ondelete="SET NULL"),
        _fk("respondent_member_id", "members.id", nullable=True, ondelete="SET NULL"),
        _fk("created_by", "members.id", nullable=True, ondelete="SET NULL"),
        sa.Column("on_behalf", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("status", sa.Text(), server_default=sa.text("'draft'"), nullable=False),
        _fk("source_id", "sources.id", nullable=True, ondelete="SET NULL"),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        _created(),
        sa.CheckConstraint("status IN ('draft','sent','submitted','closed')", name="interviews_status_check"),
    )
    op.create_index("interviews_ws_idx", "interviews", ["workspace_id", "created_at"])
    op.create_table(
        "interview_questions",
        _id(),
        _fk("interview_id", "interviews.id"),
        _fk("claim_id", "claims.id", nullable=True, ondelete="SET NULL"),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("options", JSONB, server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("answer", sa.Text(), nullable=True),
        sa.Column("answer_kind", sa.Text(), nullable=True),
        sa.Column("answer_meta", JSONB, server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("answered_at", sa.DateTime(timezone=True), nullable=True),
        _fk("testimony_claim_id", "claims.id", nullable=True, ondelete="SET NULL"),
        _created(),
        sa.CheckConstraint("kind IN ('missing','conflict','custom')", name="interview_questions_kind_check"),
        sa.CheckConstraint("answer_kind IS NULL OR answer_kind IN ('answered','chose_option','dont_know','ask_other')",
                           name="interview_questions_answer_kind_check"),
    )
    op.create_index("interview_questions_interview_idx", "interview_questions", ["interview_id", "position"])
    op.create_index("interview_questions_claim_idx", "interview_questions", ["claim_id"])

    # --- #2: relations between claims about the same subject ---
    op.create_table(
        "claim_relations",
        _id(),
        _fk("workspace_id", "workspaces.id"),
        _fk("from_claim_id", "claims.id"),
        _fk("to_claim_id", "claims.id"),
        sa.Column("relation", sa.Text(), nullable=False),
        sa.Column("decided_by", sa.Text(), server_default=sa.text("'rule'"), nullable=False),
        sa.Column("signal", sa.Text(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        _fk("decided_by_member_id", "members.id", nullable=True, ondelete="SET NULL"),
        _created(),
        sa.CheckConstraint("relation IN ('reversal','contradiction','historical','unrelated')", name="claim_relations_relation_check"),
        sa.CheckConstraint("decided_by IN ('rule','reviewer')", name="claim_relations_decided_by_check"),
    )
    op.create_index("claim_relations_pair_idx", "claim_relations", ["from_claim_id", "to_claim_id"], unique=True)
    op.create_index("claim_relations_ws_idx", "claim_relations", ["workspace_id"])
    op.create_index("claim_relations_to_idx", "claim_relations", ["to_claim_id"])

    # --- #3: acknowledgements become a tracked item (question -> answer -> closed) ---
    op.add_column("acknowledgements", sa.Column("note", sa.Text(), nullable=True))
    op.add_column("acknowledgements", sa.Column("answer", sa.Text(), nullable=True))
    op.add_column("acknowledgements", _fk("answered_by", "members.id", nullable=True, ondelete="SET NULL"))
    op.add_column("acknowledgements", sa.Column("answered_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("acknowledgements", sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("acknowledgements", sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False))
    op.create_check_constraint("acknowledgements_state_check", "acknowledgements",
                               "state IN ('acknowledged','question','not_mine')")
    op.create_index("acknowledgements_unique_idx", "acknowledgements", ["handover_version_id", "claim_id", "member_id"], unique=True)
    op.create_index("acknowledgements_claim_idx", "acknowledgements", ["claim_id"])
    op.create_index("acknowledgements_member_idx", "acknowledgements", ["member_id"])

    # --- admin changes (source access lists, relation overrides) ---
    op.create_table(
        "audit_events",
        _id(),
        _fk("workspace_id", "workspaces.id"),
        _fk("actor_member_id", "members.id", nullable=True, ondelete="SET NULL"),
        sa.Column("actor_role", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("target", sa.Text(), nullable=True),
        sa.Column("before", JSONB, nullable=True),
        sa.Column("after", JSONB, nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        _created(),
    )
    op.create_index("audit_events_ws_idx", "audit_events", ["workspace_id", "created_at"])


def downgrade() -> None:
    op.drop_table("audit_events")
    for name in ("acknowledgements_member_idx", "acknowledgements_claim_idx", "acknowledgements_unique_idx"):
        op.drop_index(name, table_name="acknowledgements")
    op.drop_constraint("acknowledgements_state_check", "acknowledgements")
    for col in ("updated_at", "closed_at", "answered_at", "answered_by", "answer", "note"):
        op.drop_column("acknowledgements", col)
    op.drop_table("claim_relations")
    op.drop_table("interview_questions")
    op.drop_table("interviews")
    op.drop_index("claims_derived_from_idx", table_name="claims")
    op.drop_column("claims", "derived_from")
    op.drop_column("claims", "stale_reason")
