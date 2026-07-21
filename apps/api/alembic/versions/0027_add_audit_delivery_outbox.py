"""add privacy-minimized audit delivery outbox

Revision ID: 0027_add_audit_delivery_outbox
Revises: 0026_add_correction_report_review_history
Create Date: 2026-07-21 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0027_add_audit_delivery_outbox"
down_revision = "0026_add_correction_report_review_history"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_deliveries",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("audit_log_id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_code", sa.String(length=48), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["audit_log_id"], ["audit_logs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("audit_log_id"),
    )
    op.create_index("ix_audit_deliveries_status", "audit_deliveries", ["status"])
    op.create_index("ix_audit_deliveries_next_attempt_at", "audit_deliveries", ["next_attempt_at"])
    op.create_index("ix_audit_deliveries_lease_expires_at", "audit_deliveries", ["lease_expires_at"])
    op.create_index("ix_audit_deliveries_delivered_at", "audit_deliveries", ["delivered_at"])
    # Historical events remain eligible for delivery after the deployment
    # configures its append-only receiver. The payload stays minimal and is
    # generated only by the worker, never copied into this table.
    op.execute(
        """
        INSERT INTO audit_deliveries (id, audit_log_id, status, attempts, created_at)
        SELECT
          substr(md5('living-nutrition-audit-delivery:' || id), 1, 8) || '-' ||
          substr(md5('living-nutrition-audit-delivery:' || id), 9, 4) || '-' ||
          substr(md5('living-nutrition-audit-delivery:' || id), 13, 4) || '-' ||
          substr(md5('living-nutrition-audit-delivery:' || id), 17, 4) || '-' ||
          substr(md5('living-nutrition-audit-delivery:' || id), 21, 12),
          id,
          'pending',
          0,
          created_at
        FROM audit_logs
        """
    )


def downgrade() -> None:
    op.drop_index("ix_audit_deliveries_delivered_at", table_name="audit_deliveries")
    op.drop_index("ix_audit_deliveries_lease_expires_at", table_name="audit_deliveries")
    op.drop_index("ix_audit_deliveries_next_attempt_at", table_name="audit_deliveries")
    op.drop_index("ix_audit_deliveries_status", table_name="audit_deliveries")
    op.drop_table("audit_deliveries")
