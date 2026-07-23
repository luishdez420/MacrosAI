"""add privacy-safe background worker heartbeats

Revision ID: 0028_add_worker_heartbeats
Revises: 0027_add_audit_delivery_outbox
Create Date: 2026-07-21 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0028_add_worker_heartbeats"
down_revision = "0027_add_audit_delivery_outbox"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "worker_heartbeats",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("worker_name", sa.String(length=64), nullable=False),
        sa.Column("instance_id", sa.String(length=36), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("worker_name", "instance_id", name="uq_worker_heartbeats_name_instance"),
    )
    op.create_index("ix_worker_heartbeats_worker_name", "worker_heartbeats", ["worker_name"])
    op.create_index("ix_worker_heartbeats_last_seen_at", "worker_heartbeats", ["last_seen_at"])
    op.create_index(
        "ix_worker_heartbeats_name_last_seen",
        "worker_heartbeats",
        ["worker_name", "last_seen_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_worker_heartbeats_name_last_seen", table_name="worker_heartbeats")
    op.drop_index("ix_worker_heartbeats_last_seen_at", table_name="worker_heartbeats")
    op.drop_index("ix_worker_heartbeats_worker_name", table_name="worker_heartbeats")
    op.drop_table("worker_heartbeats")
