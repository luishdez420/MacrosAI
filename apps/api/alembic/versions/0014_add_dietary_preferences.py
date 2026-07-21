"""add dietary preferences

Revision ID: 0014_add_dietary_preferences
Revises: 0013_add_food_search_cache
Create Date: 2026-07-13 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0014_add_dietary_preferences"
down_revision = "0013_add_food_search_cache"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_preferences",
        sa.Column("dietary_preferences", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    )


def downgrade() -> None:
    op.drop_column("user_preferences", "dietary_preferences")
