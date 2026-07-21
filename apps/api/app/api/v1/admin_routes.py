"""Restricted operational routes that are deliberately not mobile product APIs."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import record_audit_event
from app.core.auth import CurrentUser, ensure_clerk_admin
from app.db.session import get_db
from app.models.analysis import DataCorrectionReport
from app.models.food import FoodSourceRecord, FoodSourceRevision
from app.models.user import AuditLog
from app.schemas.admin import (
    AdminAuditEventList,
    AdminAuditEventRead,
    AdminCorrectionReportList,
    AdminCorrectionReportRead,
    AdminCorrectionReportStatusHistoryRead,
    AdminCorrectionReportUpdate,
    CorrectionReportStatus,
)
from app.services.correction_reports import (
    REPORT_STATUS_DISMISSED,
    REPORT_STATUS_RESOLVED,
    add_status_event,
    status_events_for_report,
    utc_now,
    validate_status_transition,
)

router = APIRouter()


@router.get("/audit-events", response_model=AdminAuditEventList)
def list_audit_events(
    request: Request,
    limit: int = Query(default=50, ge=1, le=100),
    before: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_clerk_admin),
) -> AdminAuditEventList:
    """List minimal operational events without exposing account identifiers."""

    query = select(AuditLog)
    if before is not None:
        query = query.where(AuditLog.created_at < before)
    events = db.scalars(query.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(limit)).all()

    # Audit review is itself sensitive. Record only the reviewer account link,
    # request correlation, and outcome; never persist filters or response data.
    record_audit_event(
        db,
        event_type="admin.audit_review",
        user_id=current_user.id,
        request=request,
    )
    db.commit()

    return AdminAuditEventList(
        items=[
            AdminAuditEventRead(
                id=event.id,
                event_type=event.event_type,
                outcome=event.outcome,
                request_id=event.request_id,
                account_state="linked" if event.user_id else "anonymized",
                created_at=event.created_at,
            )
            for event in events
        ]
    )


@router.get("/correction-reports", response_model=AdminCorrectionReportList)
def list_correction_reports(
    request: Request,
    report_status: CorrectionReportStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=100),
    before: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_clerk_admin),
) -> AdminCorrectionReportList:
    """List correction reports without exposing reporter identities."""

    query = select(DataCorrectionReport)
    if report_status is not None:
        query = query.where(DataCorrectionReport.status == report_status.value)
    if before is not None:
        query = query.where(DataCorrectionReport.created_at < before)
    reports = db.scalars(
        query.order_by(DataCorrectionReport.created_at.desc(), DataCorrectionReport.id.desc()).limit(limit)
    ).all()

    record_audit_event(
        db,
        event_type="admin.correction_report_review",
        user_id=current_user.id,
        request=request,
    )
    db.commit()
    return AdminCorrectionReportList(items=[admin_correction_report_read(report, db) for report in reports])


@router.get("/correction-reports/{report_id}", response_model=AdminCorrectionReportRead)
def get_correction_report(
    report_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_clerk_admin),
) -> AdminCorrectionReportRead:
    report = db.get(DataCorrectionReport, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Correction report not found.")

    record_audit_event(
        db,
        event_type="admin.correction_report_review",
        user_id=current_user.id,
        request=request,
    )
    db.commit()
    return admin_correction_report_read(report, db)


@router.patch("/correction-reports/{report_id}", response_model=AdminCorrectionReportRead)
def update_correction_report(
    report_id: str,
    update: AdminCorrectionReportUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_clerk_admin),
) -> AdminCorrectionReportRead:
    """Apply a one-way staff review transition with a reporter-safe summary."""

    report = db.get(DataCorrectionReport, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Correction report not found.")

    next_status = update.status.value
    validate_status_transition(report.status, next_status)
    user_visible_summary = normalize_optional_text(update.user_visible_summary)
    internal_note = normalize_optional_text(update.internal_note)
    if next_status in {REPORT_STATUS_RESOLVED, REPORT_STATUS_DISMISSED} and not user_visible_summary:
        raise HTTPException(
            status_code=422,
            detail="A user-visible resolution summary is required for a terminal report status.",
        )

    source_revision_id = report.source_revision_id
    if "source_revision_id" in update.model_fields_set:
        source_revision_id = validate_source_revision(
            db,
            report=report,
            source_revision_id=update.source_revision_id,
        )

    timestamp = utc_now()
    report.status = next_status
    report.source_revision_id = source_revision_id
    report.reviewed_by_user_id = current_user.id
    report.resolved_at = timestamp if next_status in {REPORT_STATUS_RESOLVED, REPORT_STATUS_DISMISSED} else None
    if user_visible_summary:
        report.resolution_summary = user_visible_summary
    add_status_event(
        db,
        correction_report_id=report.id,
        status_value=next_status,
        actor_user_id=current_user.id,
        user_visible_summary=user_visible_summary,
        internal_note=internal_note,
        source_revision_id=source_revision_id,
    )
    record_audit_event(
        db,
        event_type="admin.correction_report_status_change",
        user_id=current_user.id,
        request=request,
        outcome=next_status,
    )
    db.commit()
    db.refresh(report)
    return admin_correction_report_read(report, db)


def admin_correction_report_read(
    report: DataCorrectionReport,
    db: Session,
) -> AdminCorrectionReportRead:
    source_record = (
        db.get(FoodSourceRecord, report.food_source_record_id)
        if report.food_source_record_id
        else None
    )
    return AdminCorrectionReportRead(
        id=report.id,
        food_source_record_id=report.food_source_record_id,
        report_type=report.report_type,
        message=report.message,
        status=CorrectionReportStatus(report.status),
        resolution_summary=report.resolution_summary,
        source_revision_id=report.source_revision_id,
        source_display_name=source_record.display_name if source_record else None,
        source_provider=source_record.provider if source_record else None,
        source_external_id=source_record.external_id if source_record else None,
        source_reference=source_record.source_reference if source_record else None,
        created_at=report.created_at,
        updated_at=report.updated_at,
        resolved_at=report.resolved_at,
        status_history=[
            AdminCorrectionReportStatusHistoryRead(
                status=CorrectionReportStatus(event.status),
                user_visible_summary=event.user_visible_summary,
                internal_note=event.internal_note,
                source_revision_id=event.source_revision_id,
                created_at=event.created_at,
            )
            for event in status_events_for_report(db, report.id)
        ],
    )


def validate_source_revision(
    db: Session,
    *,
    report: DataCorrectionReport,
    source_revision_id: str | None,
) -> str | None:
    if source_revision_id is None:
        return None
    revision = db.get(FoodSourceRevision, source_revision_id)
    if not revision or revision.food_source_record_id != report.food_source_record_id:
        raise HTTPException(
            status_code=422,
            detail="Source revision does not belong to the reported food record.",
        )
    return revision.id


def normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        raise HTTPException(status_code=422, detail="Review text cannot be blank.")
    return normalized
