"""add private favorite flag to recipes

Revision ID: 0034_add_recipe_favorites
Revises: 0033_add_recipe_folders
Create Date: 2026-07-22 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0034_add_recipe_favorites"
down_revision = "0033_add_recipe_folders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "recipes",
        sa.Column("is_favorite", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("recipes", "is_favorite")
