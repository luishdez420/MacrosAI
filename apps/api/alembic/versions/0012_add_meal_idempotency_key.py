"""add meal create idempotency key

Revision ID: 0012_add_meal_idempotency_key
Revises: 0011_add_onboarding_personalization
Create Date: 2026-07-13 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "0012_add_meal_idempotency_key"
down_revision = "0011_add_onboarding_personalization"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("meals", sa.Column("idempotency_key", sa.String(length=128), nullable=True))
    op.create_unique_constraint(
        "uq_meals_user_idempotency_key",
        "meals",
        ["user_id", "idempotency_key"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_meals_user_idempotency_key", "meals", type_="unique")
    op.drop_column("meals", "idempotency_key")
