"""add a privacy-preserving label to auth sessions

Revision ID: 0016_add_auth_session_device_label
Revises: 0015_add_hydration_entries
Create Date: 2026-07-14 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0016_add_auth_session_device_label"
down_revision = "0015_add_hydration_entries"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "auth_sessions",
        sa.Column("device_label", sa.String(length=96), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("auth_sessions", "device_label")
