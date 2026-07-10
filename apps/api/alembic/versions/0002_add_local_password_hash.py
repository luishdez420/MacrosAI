"""add local password hash

Revision ID: 0002_add_local_password_hash
Revises: 0001_initial_schema
Create Date: 2026-07-09 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "0002_add_local_password_hash"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("password_hash", sa.String(length=512), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "password_hash")
