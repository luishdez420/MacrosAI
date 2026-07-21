"""add goal direction preference

Revision ID: 0009_add_goal_direction_preference
Revises: 0008_add_goal_effective_date_index
Create Date: 2026-07-12 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "0009_add_goal_direction_preference"
down_revision = "0008_add_goal_effective_date_index"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_preferences",
        sa.Column("goal_direction", sa.String(length=16), nullable=False, server_default="maintain"),
    )


def downgrade() -> None:
    op.drop_column("user_preferences", "goal_direction")
