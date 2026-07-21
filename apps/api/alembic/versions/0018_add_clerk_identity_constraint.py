"""add Clerk identity uniqueness

Revision ID: 0018_add_clerk_identity_constraint
Revises: 0017_add_food_source_revisions
Create Date: 2026-07-20 00:00:00.000000
"""

from alembic import op


revision = "0018_add_clerk_identity_constraint"
down_revision = "0017_add_food_source_revisions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_users_auth_provider_subject",
        "users",
        ["auth_provider", "external_subject"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_users_auth_provider_subject", "users", type_="unique")
