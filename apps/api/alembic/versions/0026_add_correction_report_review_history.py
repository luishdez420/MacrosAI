"""add correction-report review history

Revision ID: 0026_add_correction_report_review_history
Revises: 0025_add_food_source_conflicts
Create Date: 2026-07-21 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0026_add_correction_report_review_history"
down_revision = "0025_add_food_source_conflicts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "data_correction_reports",
        sa.Column("resolution_summary", sa.Text(), nullable=True),
    )
    op.add_column(
        "data_correction_reports",
        sa.Column("source_revision_id", sa.String(length=36), nullable=True),
    )
    op.add_column(
        "data_correction_reports",
        sa.Column("reviewed_by_user_id", sa.String(length=36), nullable=True),
    )
    op.add_column(
        "data_correction_reports",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )
    op.create_foreign_key(
        "fk_data_correction_reports_source_revision_id",
        "data_correction_reports",
        "food_source_revisions",
        ["source_revision_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_data_correction_reports_reviewed_by_user_id",
        "data_correction_reports",
        "users",
        ["reviewed_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_data_correction_reports_source_revision_id",
        "data_correction_reports",
        ["source_revision_id"],
    )
    op.create_index(
        "ix_data_correction_reports_reviewed_by_user_id",
        "data_correction_reports",
        ["reviewed_by_user_id"],
    )
    op.create_table(
        "data_correction_report_status_events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("correction_report_id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("user_visible_summary", sa.Text(), nullable=True),
        sa.Column("internal_note", sa.Text(), nullable=True),
        sa.Column("source_revision_id", sa.String(length=36), nullable=True),
        sa.Column("actor_user_id", sa.String(length=36), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["correction_report_id"],
            ["data_correction_reports.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["source_revision_id"],
            ["food_source_revisions.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_data_correction_report_status_events_correction_report_id",
        "data_correction_report_status_events",
        ["correction_report_id"],
    )
    op.create_index(
        "ix_data_correction_report_status_events_status",
        "data_correction_report_status_events",
        ["status"],
    )
    op.create_index(
        "ix_data_correction_report_status_events_source_revision_id",
        "data_correction_report_status_events",
        ["source_revision_id"],
    )
    op.create_index(
        "ix_data_correction_report_status_events_actor_user_id",
        "data_correction_report_status_events",
        ["actor_user_id"],
    )
    # Existing reports predate status history. Preserve their current state as
    # the first user-visible event instead of silently treating them as new.
    op.execute(
        """
        INSERT INTO data_correction_report_status_events
          (id, correction_report_id, status, user_visible_summary, created_at)
        SELECT
          id,
          id,
          status,
          CASE WHEN status = 'open' THEN 'Report submitted.' ELSE NULL END,
          created_at
        FROM data_correction_reports
        """
    )


def downgrade() -> None:
    op.drop_index(
        "ix_data_correction_report_status_events_actor_user_id",
        table_name="data_correction_report_status_events",
    )
    op.drop_index(
        "ix_data_correction_report_status_events_source_revision_id",
        table_name="data_correction_report_status_events",
    )
    op.drop_index(
        "ix_data_correction_report_status_events_status",
        table_name="data_correction_report_status_events",
    )
    op.drop_index(
        "ix_data_correction_report_status_events_correction_report_id",
        table_name="data_correction_report_status_events",
    )
    op.drop_table("data_correction_report_status_events")
    op.drop_index(
        "ix_data_correction_reports_reviewed_by_user_id",
        table_name="data_correction_reports",
    )
    op.drop_index(
        "ix_data_correction_reports_source_revision_id",
        table_name="data_correction_reports",
    )
    op.drop_constraint(
        "fk_data_correction_reports_reviewed_by_user_id",
        "data_correction_reports",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_data_correction_reports_source_revision_id",
        "data_correction_reports",
        type_="foreignkey",
    )
    op.drop_column("data_correction_reports", "updated_at")
    op.drop_column("data_correction_reports", "reviewed_by_user_id")
    op.drop_column("data_correction_reports", "source_revision_id")
    op.drop_column("data_correction_reports", "resolution_summary")
