"""store goal direction with effective nutrition goal revisions

Revision ID: 0032_add_goal_direction_to_nutrition_goals
Revises: 0031_add_recipe_tags
Create Date: 2026-07-22 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0032_add_goal_direction_to_nutrition_goals"
down_revision = "0031_add_recipe_tags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "nutrition_goals",
        sa.Column("goal_direction", sa.String(length=16), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("nutrition_goals", "goal_direction")
