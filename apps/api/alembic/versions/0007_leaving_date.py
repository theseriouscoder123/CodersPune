"""Before the leaver leaves: the leaver's last day on a handover, and manual checklist marks for items that have no
automatic signal (for example "walk Neha through deploy.yml").

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-14 22:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("handovers", sa.Column("leaves_on", sa.Date(), nullable=True))
    op.add_column("handovers", sa.Column("leaving_marks", postgresql.JSONB(astext_type=sa.Text()),
                                         server_default=sa.text("'{}'::jsonb"), nullable=False))


def downgrade() -> None:
    op.drop_column("handovers", "leaving_marks")
    op.drop_column("handovers", "leaves_on")
