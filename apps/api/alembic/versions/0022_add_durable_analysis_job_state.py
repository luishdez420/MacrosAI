"""add durable analysis job state and private input metadata

Revision ID: 0022_add_durable_analysis_job_state
Revises: 0021_add_meal_image_lifecycle
Create Date: 2026-07-21 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0022_add_durable_analysis_job_state"
down_revision = "0021_add_meal_image_lifecycle"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("analysis_jobs", sa.Column("error_code", sa.String(length=64), nullable=True))
    op.add_column(
        "analysis_jobs",
        sa.Column("request_payload_json", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
    )
    op.add_column("analysis_jobs", sa.Column("result_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("analysis_jobs", sa.Column("image_count", sa.Integer(), server_default="0", nullable=False))
    op.add_column("analysis_jobs", sa.Column("reference_plate_diameter_mm", sa.Float(), nullable=True))
    op.add_column("analysis_jobs", sa.Column("attempt_count", sa.Integer(), server_default="0", nullable=False))
    op.add_column("analysis_jobs", sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("analysis_jobs", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("analysis_jobs", sa.Column("started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("analysis_jobs", sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("analysis_jobs", sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_analysis_jobs_lease_expires_at", "analysis_jobs", ["lease_expires_at"])
    op.create_index("ix_analysis_jobs_expires_at", "analysis_jobs", ["expires_at"])

    op.create_table(
        "analysis_job_images",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("analysis_job_id", sa.String(length=36), sa.ForeignKey("analysis_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("storage_key", sa.String(length=512), nullable=False),
        sa.Column("capture_angle", sa.String(length=64), nullable=True),
        sa.Column("content_type", sa.String(length=128), server_default="image/jpeg", nullable=False),
        sa.Column("retention_deadline", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deletion_attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("deletion_error_code", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_analysis_job_images_analysis_job_id", "analysis_job_images", ["analysis_job_id"])
    op.create_index("ix_analysis_job_images_retention_deadline", "analysis_job_images", ["retention_deadline"])


def downgrade() -> None:
    op.drop_index("ix_analysis_job_images_retention_deadline", table_name="analysis_job_images")
    op.drop_index("ix_analysis_job_images_analysis_job_id", table_name="analysis_job_images")
    op.drop_table("analysis_job_images")
    op.drop_index("ix_analysis_jobs_expires_at", table_name="analysis_jobs")
    op.drop_index("ix_analysis_jobs_lease_expires_at", table_name="analysis_jobs")
    op.drop_column("analysis_jobs", "cancelled_at")
    op.drop_column("analysis_jobs", "completed_at")
    op.drop_column("analysis_jobs", "started_at")
    op.drop_column("analysis_jobs", "expires_at")
    op.drop_column("analysis_jobs", "lease_expires_at")
    op.drop_column("analysis_jobs", "attempt_count")
    op.drop_column("analysis_jobs", "reference_plate_diameter_mm")
    op.drop_column("analysis_jobs", "image_count")
    op.drop_column("analysis_jobs", "result_json")
    op.drop_column("analysis_jobs", "request_payload_json")
    op.drop_column("analysis_jobs", "error_code")
