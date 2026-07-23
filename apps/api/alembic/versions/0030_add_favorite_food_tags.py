"""add private saved-food organization tags

Revision ID: 0030_add_favorite_food_tags
Revises: 0029_add_meal_revisions
Create Date: 2026-07-22 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0030_add_favorite_food_tags"
down_revision = "0029_add_meal_revisions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "favorite_food_tags",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=48), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_favorite_food_tags_user_name"),
    )
    op.create_index("ix_favorite_food_tags_user_id", "favorite_food_tags", ["user_id"])

    op.create_table(
        "favorite_food_tag_assignments",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("favorite_food_id", sa.String(length=36), nullable=False),
        sa.Column("favorite_food_tag_id", sa.String(length=36), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["favorite_food_id"], ["favorite_foods.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["favorite_food_tag_id"], ["favorite_food_tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "favorite_food_id",
            "favorite_food_tag_id",
            name="uq_favorite_food_tag_assignments_favorite_tag",
        ),
    )
    op.create_index(
        "ix_favorite_food_tag_assignments_favorite_food_id",
        "favorite_food_tag_assignments",
        ["favorite_food_id"],
    )
    op.create_index(
        "ix_favorite_food_tag_assignments_favorite_food_tag_id",
        "favorite_food_tag_assignments",
        ["favorite_food_tag_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_favorite_food_tag_assignments_favorite_food_tag_id",
        table_name="favorite_food_tag_assignments",
    )
    op.drop_index(
        "ix_favorite_food_tag_assignments_favorite_food_id",
        table_name="favorite_food_tag_assignments",
    )
    op.drop_table("favorite_food_tag_assignments")
    op.drop_index("ix_favorite_food_tags_user_id", table_name="favorite_food_tags")
    op.drop_table("favorite_food_tags")
