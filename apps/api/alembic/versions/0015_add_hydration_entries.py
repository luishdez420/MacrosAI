"""add hydration entries

Revision ID: 0015_add_hydration_entries
Revises: 0014_add_dietary_preferences
Create Date: 2026-07-13 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0015_add_hydration_entries"
down_revision = "0014_add_dietary_preferences"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "hydration_entries",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("logged_on", sa.Date(), nullable=False),
        sa.Column("milliliters", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "logged_on", name="uq_hydration_entries_user_date"),
    )
    op.create_index("ix_hydration_entries_user_id", "hydration_entries", ["user_id"], unique=False)
    op.create_index("ix_hydration_entries_logged_on", "hydration_entries", ["logged_on"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_hydration_entries_logged_on", table_name="hydration_entries")
    op.drop_index("ix_hydration_entries_user_id", table_name="hydration_entries")
    op.drop_table("hydration_entries")
