"""add private recipe organization tags

Revision ID: 0031_add_recipe_tags
Revises: 0030_add_favorite_food_tags
Create Date: 2026-07-22 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0031_add_recipe_tags"
down_revision = "0030_add_favorite_food_tags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "recipe_tags",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=48), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_recipe_tags_user_name"),
    )
    op.create_index("ix_recipe_tags_user_id", "recipe_tags", ["user_id"])
    op.create_table(
        "recipe_tag_assignments",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("recipe_id", sa.String(length=36), nullable=False),
        sa.Column("recipe_tag_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["recipe_id"], ["recipes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["recipe_tag_id"], ["recipe_tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("recipe_id", "recipe_tag_id", name="uq_recipe_tag_assignments_recipe_tag"),
    )
    op.create_index("ix_recipe_tag_assignments_recipe_id", "recipe_tag_assignments", ["recipe_id"])
    op.create_index("ix_recipe_tag_assignments_recipe_tag_id", "recipe_tag_assignments", ["recipe_tag_id"])


def downgrade() -> None:
    op.drop_index("ix_recipe_tag_assignments_recipe_tag_id", table_name="recipe_tag_assignments")
    op.drop_index("ix_recipe_tag_assignments_recipe_id", table_name="recipe_tag_assignments")
    op.drop_table("recipe_tag_assignments")
    op.drop_index("ix_recipe_tags_user_id", table_name="recipe_tags")
    op.drop_table("recipe_tags")
