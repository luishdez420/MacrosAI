"""add nutrition goal effective-date index

Revision ID: 0008_add_goal_effective_date_index
Revises: 0007_add_meal_type
Create Date: 2026-07-12 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "0008_add_goal_effective_date_index"
down_revision = "0007_add_meal_type"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_nutrition_goals_user_starts_on",
        "nutrition_goals",
        ["user_id", "starts_on"],
    )
    # Alembic creates this table as VARCHAR(32), but later revision IDs exceed
    # that size. Widen before Alembic records this revision in the version row.
    op.alter_column("alembic_version", "version_num", type_=sa.String(length=128))


def downgrade() -> None:
    op.drop_index("ix_nutrition_goals_user_starts_on", table_name="nutrition_goals")
