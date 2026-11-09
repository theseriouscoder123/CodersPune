"""unique (handover_id, version): backstop for concurrent approvals

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-09 15:00:00
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("handover_versions_unique_idx", "handover_versions", ["handover_id", "version"], unique=True)


def downgrade() -> None:
    op.drop_index("handover_versions_unique_idx", table_name="handover_versions")
