"""add meal category to meals and recipes

Revision ID: 0007_add_meal_type
Revises: 0006_add_item_sort_order
Create Date: 2026-07-12 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "0007_add_meal_type"
down_revision = "0006_add_item_sort_order"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "meals",
        sa.Column("meal_type", sa.String(length=32), nullable=False, server_default="meal"),
    )
    op.add_column(
        "recipes",
        sa.Column("meal_type", sa.String(length=32), nullable=False, server_default="meal"),
    )


def downgrade() -> None:
    op.drop_column("recipes", "meal_type")
    op.drop_column("meals", "meal_type")
