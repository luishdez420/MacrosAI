"""link durable analysis jobs to their AI usage reservations

Revision ID: 0023_link_analysis_jobs_to_ai_usage
Revises: 0022_add_durable_analysis_job_state
Create Date: 2026-07-21 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "0023_link_analysis_jobs_to_ai_usage"
down_revision = "0022_add_durable_analysis_job_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "analysis_jobs",
        sa.Column(
            "ai_usage_record_id",
            sa.String(length=36),
            sa.ForeignKey("ai_usage_records.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_analysis_jobs_ai_usage_record_id", "analysis_jobs", ["ai_usage_record_id"])


def downgrade() -> None:
    op.drop_index("ix_analysis_jobs_ai_usage_record_id", table_name="analysis_jobs")
    op.drop_column("analysis_jobs", "ai_usage_record_id")
