"""add provider food-source revisions

Revision ID: 0017_add_food_source_revisions
Revises: 0016_add_auth_session_device_label
Create Date: 2026-07-14 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0017_add_food_source_revisions"
down_revision = "0016_add_auth_session_device_label"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "food_source_revisions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("food_source_record_id", sa.String(length=36), nullable=False),
        sa.Column("display_name", sa.String(length=512), nullable=False),
        sa.Column("data_type", sa.String(length=128), nullable=False),
        sa.Column("brand_owner", sa.String(length=256), nullable=True),
        sa.Column("publication_date", sa.Date(), nullable=True),
        sa.Column("nutrients_per_100g", sa.JSON(), nullable=False),
        sa.Column("serving_size", sa.Float(), nullable=True),
        sa.Column("serving_size_unit", sa.String(length=64), nullable=True),
        sa.Column("household_serving_text", sa.String(length=256), nullable=True),
        sa.Column("original_nutrient_ids", sa.JSON(), nullable=False),
        sa.Column("quality_flags", sa.JSON(), nullable=False),
        sa.Column("source_reference", sa.String(length=512), nullable=False),
        sa.Column("source_retrieved_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["food_source_record_id"], ["food_source_records.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_food_source_revisions_food_source_record_id",
        "food_source_revisions",
        ["food_source_record_id"],
    )
    op.create_index(
        "ix_food_source_revisions_source_retrieved_at",
        "food_source_revisions",
        ["source_retrieved_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_food_source_revisions_source_retrieved_at", table_name="food_source_revisions")
    op.drop_index("ix_food_source_revisions_food_source_record_id", table_name="food_source_revisions")
    op.drop_table("food_source_revisions")
