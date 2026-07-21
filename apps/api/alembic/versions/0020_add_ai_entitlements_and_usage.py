"""add AI entitlements and usage ledger

Revision ID: 0020_add_ai_entitlements_and_usage
Revises: 0019_add_idempotency_records
Create Date: 2026-07-21 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0020_add_ai_entitlements_and_usage"
down_revision = "0019_add_idempotency_records"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_entitlements",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("tier", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("trial_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index("ix_ai_entitlements_user_id", "ai_entitlements", ["user_id"])
    op.create_table(
        "ai_usage_records",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("operation", sa.String(length=96), nullable=False),
        sa.Column("entitlement_tier", sa.String(length=24), nullable=False),
        sa.Column("idempotency_key_hash", sa.String(length=64), nullable=True),
        sa.Column("units", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("reservation_attempts", sa.Integer(), nullable=False),
        sa.Column("refund_count", sa.Integer(), nullable=False),
        sa.Column("reserved_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("reservation_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("refunded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("refund_reason", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "operation", "idempotency_key_hash", name="uq_ai_usage_user_operation_idempotency_key"),
    )
    op.create_index("ix_ai_usage_records_user_id", "ai_usage_records", ["user_id"])
    op.create_index("ix_ai_usage_records_operation", "ai_usage_records", ["operation"])
    op.create_index("ix_ai_usage_records_status", "ai_usage_records", ["status"])
    op.create_index("ix_ai_usage_records_reservation_expires_at", "ai_usage_records", ["reservation_expires_at"])
    op.create_index("ix_ai_usage_user_operation_reserved", "ai_usage_records", ["user_id", "operation", "reserved_at"])
    op.create_index("ix_ai_usage_status_expires", "ai_usage_records", ["status", "reservation_expires_at"])


def downgrade() -> None:
    op.drop_index("ix_ai_usage_status_expires", table_name="ai_usage_records")
    op.drop_index("ix_ai_usage_user_operation_reserved", table_name="ai_usage_records")
    op.drop_index("ix_ai_usage_records_reservation_expires_at", table_name="ai_usage_records")
    op.drop_index("ix_ai_usage_records_status", table_name="ai_usage_records")
    op.drop_index("ix_ai_usage_records_operation", table_name="ai_usage_records")
    op.drop_index("ix_ai_usage_records_user_id", table_name="ai_usage_records")
    op.drop_table("ai_usage_records")
    op.drop_index("ix_ai_entitlements_user_id", table_name="ai_entitlements")
    op.drop_table("ai_entitlements")
