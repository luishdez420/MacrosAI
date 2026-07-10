"""initial production schema

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-07-06 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("display_name", sa.String(length=160), nullable=True),
        sa.Column("auth_provider", sa.String(length=64), nullable=False),
        sa.Column("external_subject", sa.String(length=256), nullable=True),
        *timestamps(),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )
    op.create_index("ix_users_external_subject", "users", ["external_subject"])

    op.create_table(
        "food_source_records",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("provider", sa.String(length=64), nullable=False),
        sa.Column("external_id", sa.String(length=128), nullable=False),
        sa.Column("display_name", sa.String(length=512), nullable=False),
        sa.Column("data_type", sa.String(length=128), nullable=False),
        sa.Column("brand_owner", sa.String(length=256), nullable=True),
        sa.Column("publication_date", sa.Date(), nullable=True),
        sa.Column("nutrients_per_100g", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("serving_size", sa.Float(), nullable=True),
        sa.Column("serving_size_unit", sa.String(length=64), nullable=True),
        sa.Column("household_serving_text", sa.String(length=256), nullable=True),
        sa.Column("original_nutrient_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("quality_flags", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("source_reference", sa.String(length=512), nullable=False),
        sa.Column("retrieved_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        *timestamps(),
        sa.UniqueConstraint("provider", "external_id", name="uq_food_source_records_provider_external"),
    )
    op.create_index("ix_food_source_records_provider", "food_source_records", ["provider"])
    op.create_index("ix_food_source_records_external_id", "food_source_records", ["external_id"])

    op.create_table(
        "user_preferences",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("locale", sa.String(length=16), nullable=False),
        sa.Column("unit_system", sa.String(length=16), nullable=False),
        sa.Column("day_start_time", sa.String(length=8), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column("image_retention_days", sa.Integer(), nullable=False),
        *timestamps(),
        sa.UniqueConstraint("user_id", name="uq_user_preferences_user_id"),
    )

    op.create_table(
        "nutrition_goals",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("calories_kcal", sa.Float(), nullable=False),
        sa.Column("protein_grams", sa.Float(), nullable=False),
        sa.Column("carbohydrate_grams", sa.Float(), nullable=False),
        sa.Column("fat_grams", sa.Float(), nullable=False),
        sa.Column("fiber_grams", sa.Float(), nullable=True),
        sa.Column("sodium_milligrams", sa.Float(), nullable=True),
        *timestamps(),
    )
    op.create_index("ix_nutrition_goals_user_id", "nutrition_goals", ["user_id"])

    op.create_table(
        "weight_entries",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("logged_on", sa.Date(), nullable=False),
        sa.Column("weight_grams", sa.Float(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("user_id", "logged_on", name="uq_weight_entries_user_date"),
    )
    op.create_index("ix_weight_entries_user_id", "weight_entries", ["user_id"])
    op.create_index("ix_weight_entries_logged_on", "weight_entries", ["logged_on"])

    op.create_table(
        "food_servings",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("food_source_record_id", sa.String(length=36), sa.ForeignKey("food_source_records.id", ondelete="CASCADE"), nullable=False),
        sa.Column("label", sa.String(length=256), nullable=False),
        sa.Column("quantity", sa.Float(), nullable=False),
        sa.Column("unit", sa.String(length=64), nullable=False),
        sa.Column("grams", sa.Float(), nullable=True),
        sa.Column("milliliters", sa.Float(), nullable=True),
        sa.Column("source_reference", sa.String(length=512), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
    )
    op.create_index("ix_food_servings_food_source_record_id", "food_servings", ["food_source_record_id"])

    op.create_table(
        "nutrient_definitions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=256), nullable=False),
        sa.Column("unit", sa.String(length=32), nullable=False),
        sa.Column("source_provider", sa.String(length=64), nullable=True),
        sa.Column("source_nutrient_id", sa.String(length=64), nullable=True),
        sa.UniqueConstraint("code", name="uq_nutrient_definitions_code"),
    )

    op.create_table(
        "food_nutrients",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("food_source_record_id", sa.String(length=36), sa.ForeignKey("food_source_records.id", ondelete="CASCADE"), nullable=False),
        sa.Column("nutrient_definition_id", sa.String(length=36), sa.ForeignKey("nutrient_definitions.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("amount_per_100g", sa.Float(), nullable=False),
        sa.Column("original_amount", sa.Float(), nullable=True),
        sa.Column("original_unit", sa.String(length=32), nullable=True),
        sa.UniqueConstraint("food_source_record_id", "nutrient_definition_id", name="uq_food_nutrients_food_nutrient"),
    )
    op.create_index("ix_food_nutrients_food_source_record_id", "food_nutrients", ["food_source_record_id"])
    op.create_index("ix_food_nutrients_nutrient_definition_id", "food_nutrients", ["nutrient_definition_id"])

    op.create_table(
        "custom_foods",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("food_source_record_id", sa.String(length=36), sa.ForeignKey("food_source_records.id", ondelete="CASCADE"), nullable=False),
        sa.Column("display_name", sa.String(length=512), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("verified_by_user", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        *timestamps(),
    )
    op.create_index("ix_custom_foods_user_id", "custom_foods", ["user_id"])
    op.create_index("ix_custom_foods_food_source_record_id", "custom_foods", ["food_source_record_id"])

    op.create_table(
        "meals",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=256), nullable=False),
        sa.Column("logged_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        *timestamps(),
    )
    op.create_index("ix_meals_user_id", "meals", ["user_id"])
    op.create_index("ix_meals_logged_at", "meals", ["logged_at"])

    op.create_table(
        "meal_items",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("meal_id", sa.String(length=36), sa.ForeignKey("meals.id", ondelete="CASCADE"), nullable=False),
        sa.Column("food_source_record_id", sa.String(length=36), sa.ForeignKey("food_source_records.id", ondelete="SET NULL"), nullable=True),
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
        sa.Column("user_confirmed", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("preparation_method", sa.String(length=64), nullable=True),
        sa.Column("added_oil_grams", sa.Float(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("nutrient_snapshot_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        *timestamps(),
    )
    op.create_index("ix_meal_items_meal_id", "meal_items", ["meal_id"])
    op.create_index("ix_meal_items_food_source_record_id", "meal_items", ["food_source_record_id"])

    op.create_table(
        "meal_images",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("meal_id", sa.String(length=36), sa.ForeignKey("meals.id", ondelete="CASCADE"), nullable=False),
        sa.Column("storage_key", sa.String(length=512), nullable=False),
        sa.Column("capture_angle", sa.String(length=64), nullable=True),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("metadata_removed", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_meal_images_meal_id", "meal_images", ["meal_id"])

    op.create_table(
        "favorite_foods",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("food_source_record_id", sa.String(length=36), sa.ForeignKey("food_source_records.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("user_id", "food_source_record_id", name="uq_favorite_foods_user_food"),
    )

    op.create_table(
        "recent_foods",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("food_source_record_id", sa.String(length=36), sa.ForeignKey("food_source_records.id", ondelete="CASCADE"), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("use_count", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.UniqueConstraint("user_id", "food_source_record_id", name="uq_recent_foods_user_food"),
    )

    op.create_table(
        "analysis_jobs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("idempotency_key", sa.String(length=256), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("meal_summary", sa.String(length=512), nullable=True),
        sa.Column("warnings_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("provider", sa.String(length=64), nullable=True),
        sa.Column("provider_request_id", sa.String(length=128), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        *timestamps(),
        sa.UniqueConstraint("user_id", "idempotency_key", name="uq_analysis_jobs_user_idempotency"),
    )
    op.create_index("ix_analysis_jobs_user_id", "analysis_jobs", ["user_id"])
    op.create_index("ix_analysis_jobs_status", "analysis_jobs", ["status"])

    op.create_table(
        "analysis_job_items",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("analysis_job_id", sa.String(length=36), sa.ForeignKey("analysis_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("temporary_id", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=256), nullable=False),
        sa.Column("candidate_labels", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("identity_confidence", sa.Float(), nullable=False),
        sa.Column("estimated_grams", sa.Float(), nullable=True),
        sa.Column("portion_range_min_grams", sa.Float(), nullable=True),
        sa.Column("portion_range_max_grams", sa.Float(), nullable=True),
        sa.Column("portion_confidence", sa.Float(), nullable=False),
        sa.Column("visible_preparation", sa.String(length=128), nullable=True),
        sa.Column("possible_hidden_ingredients", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("requires_confirmation", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_analysis_job_items_analysis_job_id", "analysis_job_items", ["analysis_job_id"])

    op.create_table(
        "data_correction_reports",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("food_source_record_id", sa.String(length=36), sa.ForeignKey("food_source_records.id", ondelete="SET NULL"), nullable=True),
        sa.Column("meal_item_id", sa.String(length=36), sa.ForeignKey("meal_items.id", ondelete="SET NULL"), nullable=True),
        sa.Column("report_type", sa.String(length=64), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_data_correction_reports_user_id", "data_correction_reports", ["user_id"])
    op.create_index("ix_data_correction_reports_food_source_record_id", "data_correction_reports", ["food_source_record_id"])
    op.create_index("ix_data_correction_reports_meal_item_id", "data_correction_reports", ["meal_item_id"])


def downgrade() -> None:
    op.drop_table("data_correction_reports")
    op.drop_table("analysis_job_items")
    op.drop_table("analysis_jobs")
    op.drop_table("recent_foods")
    op.drop_table("favorite_foods")
    op.drop_table("meal_images")
    op.drop_table("meal_items")
    op.drop_table("meals")
    op.drop_table("custom_foods")
    op.drop_table("food_nutrients")
    op.drop_table("nutrient_definitions")
    op.drop_table("food_servings")
    op.drop_table("weight_entries")
    op.drop_table("nutrition_goals")
    op.drop_table("user_preferences")
    op.drop_table("food_source_records")
    op.drop_table("users")
