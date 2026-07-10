from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session, selectinload

from app.api.v1.auth_routes import session_from_user
from app.api.v1.food_routes import food_result_from_record
from app.api.v1.goal_routes import goal_to_read
from app.api.v1.meal_routes import meal_to_read
from app.api.v1.preference_routes import get_or_create_preferences, preference_to_read
from app.api.v1.weight_routes import weight_entry_to_read
from app.core.auth import CurrentUser, ensure_current_user
from app.core.audit import record_audit_event
from app.db.session import get_db
from app.models.analysis import AnalysisJob, AnalysisJobItem, DataCorrectionReport
from app.models.food import CustomFood, FoodSourceRecord
from app.models.meal import Meal, MealImage, MealItem
from app.models.user import AuditLog, AuthSession, FavoriteFood, NutritionGoal, RecentFood, User, UserPreference, WeightEntry
from app.schemas.export import UserDataExportRead
from app.schemas.food import FoodCorrectionReportList, FoodCorrectionReportSummary, ProviderName

router = APIRouter()


@router.get("/correction-reports", response_model=FoodCorrectionReportList)
def list_current_user_correction_reports(
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> FoodCorrectionReportList:
    reports = db.scalars(
        select(DataCorrectionReport)
        .where(DataCorrectionReport.user_id == current_user.id)
        .order_by(DataCorrectionReport.created_at.desc())
        .limit(limit)
    ).all()

    return FoodCorrectionReportList(
        items=[correction_report_summary(report, db) for report in reports]
    )


@router.get("/export", response_model=UserDataExportRead)
def export_current_user_data(
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> UserDataExportRead:
    user = db.get(User, current_user.id)
    preferences = get_or_create_preferences(db, current_user.id)
    goals = db.scalars(
        select(NutritionGoal)
        .where(NutritionGoal.user_id == current_user.id)
        .order_by(NutritionGoal.starts_on.desc(), NutritionGoal.created_at.desc())
    ).all()
    weight_entries = db.scalars(
        select(WeightEntry)
        .where(WeightEntry.user_id == current_user.id)
        .order_by(WeightEntry.logged_on.desc(), WeightEntry.created_at.desc())
    ).all()
    meals = db.scalars(
        select(Meal)
        .where(Meal.user_id == current_user.id)
        .options(selectinload(Meal.items))
        .order_by(Meal.logged_at.desc(), Meal.created_at.desc())
    ).all()
    favorite_records = db.scalars(
        select(FoodSourceRecord)
        .join(FavoriteFood, FavoriteFood.food_source_record_id == FoodSourceRecord.id)
        .where(FavoriteFood.user_id == current_user.id)
        .order_by(FavoriteFood.created_at.desc())
    ).all()
    recent_records = db.scalars(
        select(FoodSourceRecord)
        .join(RecentFood, RecentFood.food_source_record_id == FoodSourceRecord.id)
        .where(RecentFood.user_id == current_user.id)
        .order_by(RecentFood.last_used_at.desc())
    ).all()
    custom_records = db.scalars(
        select(FoodSourceRecord)
        .join(CustomFood, CustomFood.food_source_record_id == FoodSourceRecord.id)
        .where(CustomFood.user_id == current_user.id)
        .order_by(CustomFood.updated_at.desc(), CustomFood.created_at.desc())
    ).all()

    export = UserDataExportRead(
        generated_at=datetime.now(UTC),
        user=session_from_user(user, db, auth_scheme=current_user.auth_scheme, include_tokens=False),
        preferences=preference_to_read(preferences),
        goals=[goal_to_read(goal) for goal in goals],
        weight_entries=[weight_entry_to_read(entry) for entry in weight_entries],
        meals=[meal_to_read(meal) for meal in meals],
        favorite_foods=[food_result_from_record(record) for record in favorite_records],
        recent_foods=[food_result_from_record(record) for record in recent_records],
        custom_foods=[food_result_from_record(record) for record in custom_records],
    )
    record_audit_event(db, event_type="user_data.export", user_id=current_user.id, request=request)
    db.commit()
    return export


@router.delete("/account", status_code=204)
def delete_current_user_account(
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> None:
    meal_ids = list(
        db.scalars(select(Meal.id).where(Meal.user_id == current_user.id)).all()
    )
    analysis_job_ids = list(
        db.scalars(select(AnalysisJob.id).where(AnalysisJob.user_id == current_user.id)).all()
    )
    custom_food_source_record_ids = list(
        db.scalars(
            select(CustomFood.food_source_record_id).where(CustomFood.user_id == current_user.id)
        ).all()
    )
    record_audit_event(db, event_type="user_data.account_delete", user_id=current_user.id, request=request)

    if meal_ids:
        db.execute(delete(MealImage).where(MealImage.meal_id.in_(meal_ids)))
        db.execute(update(DataCorrectionReport).where(DataCorrectionReport.meal_item_id.in_(select(MealItem.id).where(MealItem.meal_id.in_(meal_ids)))).values(meal_item_id=None))
        db.execute(delete(MealItem).where(MealItem.meal_id.in_(meal_ids)))
        db.execute(delete(Meal).where(Meal.id.in_(meal_ids)))

    if analysis_job_ids:
        db.execute(delete(AnalysisJobItem).where(AnalysisJobItem.analysis_job_id.in_(analysis_job_ids)))
        db.execute(delete(AnalysisJob).where(AnalysisJob.id.in_(analysis_job_ids)))

    db.execute(update(DataCorrectionReport).where(DataCorrectionReport.user_id == current_user.id).values(user_id=None))
    db.execute(delete(FavoriteFood).where(FavoriteFood.user_id == current_user.id))
    db.execute(delete(RecentFood).where(RecentFood.user_id == current_user.id))
    db.execute(delete(CustomFood).where(CustomFood.user_id == current_user.id))

    if custom_food_source_record_ids:
        db.execute(
            delete(FoodSourceRecord).where(FoodSourceRecord.id.in_(custom_food_source_record_ids))
        )

    db.execute(delete(WeightEntry).where(WeightEntry.user_id == current_user.id))
    db.execute(delete(NutritionGoal).where(NutritionGoal.user_id == current_user.id))
    db.execute(delete(UserPreference).where(UserPreference.user_id == current_user.id))
    db.execute(delete(AuthSession).where(AuthSession.user_id == current_user.id))
    db.execute(update(AuditLog).where(AuditLog.user_id == current_user.id).values(user_id=None))
    db.execute(delete(User).where(User.id == current_user.id))
    db.commit()


def correction_report_summary(
    report: DataCorrectionReport,
    db: Session,
) -> FoodCorrectionReportSummary:
    source_record = (
        db.get(FoodSourceRecord, report.food_source_record_id)
        if report.food_source_record_id
        else None
    )
    source_provider = normalize_provider(source_record.provider) if source_record else None

    return FoodCorrectionReportSummary(
        id=report.id,
        food_source_record_id=report.food_source_record_id,
        report_type=report.report_type,
        message=report.message,
        status=report.status,
        created_at=report.created_at,
        source_display_name=source_record.display_name if source_record else None,
        source_provider=source_provider,
        source_external_id=source_record.external_id if source_record else None,
        source_reference=source_record.source_reference if source_record else None,
    )


def normalize_provider(value: str) -> ProviderName | None:
    try:
        return ProviderName(value)
    except ValueError:
        return None
