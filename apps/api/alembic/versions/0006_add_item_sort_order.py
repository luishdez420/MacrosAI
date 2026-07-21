"""persist meal and recipe item order

Revision ID: 0006_add_item_sort_order
Revises: 0005_add_recipes
Create Date: 2026-07-12 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "0006_add_item_sort_order"
down_revision = "0005_add_recipes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "meal_items",
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "recipe_items",
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("recipe_items", "sort_order")
    op.drop_column("meal_items", "sort_order")
