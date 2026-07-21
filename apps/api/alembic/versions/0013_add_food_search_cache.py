"""add bounded food search cache

Revision ID: 0013_add_food_search_cache
Revises: 0012_add_meal_idempotency_key
Create Date: 2026-07-12 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0013_add_food_search_cache"
down_revision = "0012_add_meal_idempotency_key"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "food_search_caches",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("normalized_query", sa.String(length=256), nullable=False),
        sa.Column("locale", sa.String(length=32), nullable=False),
        sa.Column("food_source_record_ids", sa.JSON(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("normalized_query", "locale", name="uq_food_search_caches_query_locale"),
    )
    op.create_index("ix_food_search_caches_normalized_query", "food_search_caches", ["normalized_query"])
    op.create_index("ix_food_search_caches_locale", "food_search_caches", ["locale"])
    op.create_index("ix_food_search_caches_expires_at", "food_search_caches", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_food_search_caches_expires_at", table_name="food_search_caches")
    op.drop_index("ix_food_search_caches_locale", table_name="food_search_caches")
    op.drop_index("ix_food_search_caches_normalized_query", table_name="food_search_caches")
    op.drop_table("food_search_caches")
