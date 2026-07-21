"""add meal image retention and deletion state

Revision ID: 0021_add_meal_image_lifecycle
Revises: 0020_add_ai_entitlements_and_usage
Create Date: 2026-07-21 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "0021_add_meal_image_lifecycle"
down_revision = "0020_add_ai_entitlements_and_usage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("meal_images", sa.Column("retention_deadline", sa.DateTime(timezone=True), nullable=True))
    op.add_column("meal_images", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("meal_images", sa.Column("deletion_attempts", sa.Integer(), server_default="0", nullable=False))
    op.add_column("meal_images", sa.Column("deletion_error_code", sa.String(length=64), nullable=True))
    op.create_index("ix_meal_images_retention_deadline", "meal_images", ["retention_deadline"])


def downgrade() -> None:
    op.drop_index("ix_meal_images_retention_deadline", table_name="meal_images")
    op.drop_column("meal_images", "deletion_error_code")
    op.drop_column("meal_images", "deletion_attempts")
    op.drop_column("meal_images", "deleted_at")
    op.drop_column("meal_images", "retention_deadline")
