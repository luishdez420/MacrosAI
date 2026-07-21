"""add onboarding personalization preferences

Revision ID: 0011_add_onboarding_personalization
Revises: 0010_add_theme_preference
Create Date: 2026-07-13 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "0011_add_onboarding_personalization"
down_revision = "0010_add_theme_preference"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_preferences",
        sa.Column("onboarding_goal", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "user_preferences",
        sa.Column("logging_preference", sa.String(length=32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("user_preferences", "logging_preference")
    op.drop_column("user_preferences", "onboarding_goal")
