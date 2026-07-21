"""add durable provider food-source conflicts

Revision ID: 0025_add_food_source_conflicts
Revises: 0024_add_food_source_refresh_state
Create Date: 2026-07-21 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0025_add_food_source_conflicts"
down_revision = "0024_add_food_source_refresh_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "food_source_conflicts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("first_food_source_record_id", sa.String(length=36), nullable=False),
        sa.Column("second_food_source_record_id", sa.String(length=36), nullable=False),
        sa.Column("normalized_name", sa.String(length=512), nullable=False),
        sa.Column("conflict_type", sa.String(length=64), nullable=False),
        sa.Column("evidence_json", sa.JSON(), nullable=False),
        sa.Column(
            "first_detected_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("last_detected_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["first_food_source_record_id"],
            ["food_source_records.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["second_food_source_record_id"],
            ["food_source_records.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "first_food_source_record_id",
            "second_food_source_record_id",
            "conflict_type",
            name="uq_food_source_conflicts_pair_type",
        ),
    )
    op.create_index(
        "ix_food_source_conflicts_first_food_source_record_id",
        "food_source_conflicts",
        ["first_food_source_record_id"],
    )
    op.create_index(
        "ix_food_source_conflicts_second_food_source_record_id",
        "food_source_conflicts",
        ["second_food_source_record_id"],
    )
    op.create_index(
        "ix_food_source_conflicts_normalized_name",
        "food_source_conflicts",
        ["normalized_name"],
    )
    op.create_index(
        "ix_food_source_conflicts_conflict_type",
        "food_source_conflicts",
        ["conflict_type"],
    )
    op.create_index(
        "ix_food_source_conflicts_last_detected_at",
        "food_source_conflicts",
        ["last_detected_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_food_source_conflicts_last_detected_at", table_name="food_source_conflicts")
    op.drop_index("ix_food_source_conflicts_conflict_type", table_name="food_source_conflicts")
    op.drop_index("ix_food_source_conflicts_normalized_name", table_name="food_source_conflicts")
    op.drop_index(
        "ix_food_source_conflicts_second_food_source_record_id",
        table_name="food_source_conflicts",
    )
    op.drop_index(
        "ix_food_source_conflicts_first_food_source_record_id",
        table_name="food_source_conflicts",
    )
    op.drop_table("food_source_conflicts")
