"""add private folders for saved recipes

Revision ID: 0033_add_recipe_folders
Revises: 0032_add_goal_direction_to_nutrition_goals
Create Date: 2026-07-22 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0033_add_recipe_folders"
down_revision = "0032_add_goal_direction_to_nutrition_goals"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "recipe_folders",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_recipe_folders_user_name"),
    )
    op.create_index("ix_recipe_folders_user_id", "recipe_folders", ["user_id"])
    op.add_column("recipes", sa.Column("folder_id", sa.String(length=36), nullable=True))
    op.create_foreign_key(
        "fk_recipes_folder_id_recipe_folders",
        "recipes",
        "recipe_folders",
        ["folder_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_recipes_folder_id", "recipes", ["folder_id"])


def downgrade() -> None:
    op.drop_index("ix_recipes_folder_id", table_name="recipes")
    op.drop_constraint("fk_recipes_folder_id_recipe_folders", "recipes", type_="foreignkey")
    op.drop_column("recipes", "folder_id")
    op.drop_index("ix_recipe_folders_user_id", table_name="recipe_folders")
    op.drop_table("recipe_folders")
