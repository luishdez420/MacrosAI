"""add optimistic revision control for saved meals

Revision ID: 0029_add_meal_revisions
Revises: 0028_add_worker_heartbeats
Create Date: 2026-07-21 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0029_add_meal_revisions"
down_revision = "0028_add_worker_heartbeats"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "meals",
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
    )


def downgrade() -> None:
    op.drop_column("meals", "revision")
