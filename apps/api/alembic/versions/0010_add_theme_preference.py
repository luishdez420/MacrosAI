"""add user theme preference

Revision ID: 0010_add_theme_preference
Revises: 0009_add_goal_direction_preference
Create Date: 2026-07-12 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "0010_add_theme_preference"
down_revision = "0009_add_goal_direction_preference"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_preferences",
        sa.Column("theme_preference", sa.String(length=16), nullable=False, server_default="system"),
    )


def downgrade() -> None:
    op.drop_column("user_preferences", "theme_preference")
