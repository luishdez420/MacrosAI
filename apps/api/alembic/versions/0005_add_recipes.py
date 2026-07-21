"""add recipes

Revision ID: 0005_add_recipes
Revises: 0004_add_audit_logs
Create Date: 2026-07-12 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "0005_add_recipes"
down_revision = "0004_add_audit_logs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "recipes",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=256), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("times_used", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_recipes_user_id", "recipes", ["user_id"])
    op.create_table(
        "recipe_items",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("recipe_id", sa.String(length=36), sa.ForeignKey("recipes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("food_id", sa.String(length=192), nullable=False),
        sa.Column("display_name", sa.String(length=512), nullable=False),
        sa.Column("consumed_grams", sa.Float(), nullable=False),
        sa.Column("serving_quantity", sa.Float(), nullable=True),
        sa.Column("serving_unit", sa.String(length=64), nullable=True),
        sa.Column("calories", sa.Float(), nullable=False),
        sa.Column("protein_grams", sa.Float(), nullable=False),
        sa.Column("carbohydrate_grams", sa.Float(), nullable=False),
        sa.Column("fat_grams", sa.Float(), nullable=False),
        sa.Column("fiber_grams", sa.Float(), nullable=True),
        sa.Column("sugar_grams", sa.Float(), nullable=True),
        sa.Column("sodium_milligrams", sa.Float(), nullable=True),
        sa.Column("source_provider", sa.String(length=64), nullable=False),
        sa.Column("source_external_id", sa.String(length=128), nullable=False),
        sa.Column("source_version", sa.String(length=128), nullable=True),
        sa.Column("source_reference", sa.String(length=512), nullable=True),
        sa.Column("identity_confidence", sa.String(length=32), nullable=False),
        sa.Column("portion_confidence", sa.String(length=32), nullable=False),
        sa.Column("nutrition_record_confidence", sa.String(length=32), nullable=False),
        sa.Column("confidence_explanation", sa.Text(), nullable=False),
        sa.Column("user_confirmed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("preparation_method", sa.String(length=64), nullable=True),
        sa.Column("added_oil_grams", sa.Float(), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("nutrient_snapshot_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_recipe_items_recipe_id", "recipe_items", ["recipe_id"])


def downgrade() -> None:
    op.drop_index("ix_recipe_items_recipe_id", table_name="recipe_items")
    op.drop_table("recipe_items")
    op.drop_index("ix_recipes_user_id", table_name="recipes")
    op.drop_table("recipes")
