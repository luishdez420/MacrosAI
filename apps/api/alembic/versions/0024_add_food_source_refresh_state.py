"""add bounded stale food-source refresh state

Revision ID: 0024_add_food_source_refresh_state
Revises: 0023_link_analysis_jobs_to_ai_usage
Create Date: 2026-07-21 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0024_add_food_source_refresh_state"
down_revision = "0023_link_analysis_jobs_to_ai_usage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "food_source_records",
        sa.Column("refresh_attempted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "food_source_records",
        sa.Column("refresh_not_before", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "food_source_records",
        sa.Column(
            "refresh_failure_count",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
    )
    op.create_index(
        "ix_food_source_records_refresh_not_before",
        "food_source_records",
        ["refresh_not_before"],
    )


def downgrade() -> None:
    op.drop_index("ix_food_source_records_refresh_not_before", table_name="food_source_records")
    op.drop_column("food_source_records", "refresh_failure_count")
    op.drop_column("food_source_records", "refresh_not_before")
    op.drop_column("food_source_records", "refresh_attempted_at")
