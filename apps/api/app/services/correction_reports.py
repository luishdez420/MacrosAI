"""Shared transition rules for source-data correction reports."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.analysis import DataCorrectionReportStatusEvent

REPORT_STATUS_OPEN = "open"
REPORT_STATUS_TRIAGED = "triaged"
REPORT_STATUS_RESOLVED = "resolved"
REPORT_STATUS_DISMISSED = "dismissed"

ALLOWED_STATUS_TRANSITIONS: dict[str, frozenset[str]] = {
    REPORT_STATUS_OPEN: frozenset({REPORT_STATUS_TRIAGED, REPORT_STATUS_DISMISSED}),
    REPORT_STATUS_TRIAGED: frozenset({REPORT_STATUS_RESOLVED, REPORT_STATUS_DISMISSED}),
    REPORT_STATUS_RESOLVED: frozenset(),
    REPORT_STATUS_DISMISSED: frozenset(),
}


def validate_status_transition(current_status: str, next_status: str) -> None:
    if next_status not in ALLOWED_STATUS_TRANSITIONS.get(current_status, frozenset()):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Correction report cannot transition from {current_status} to {next_status}.",
        )


def add_status_event(
    db: Session,
    *,
    correction_report_id: str,
    status_value: str,
    actor_user_id: str | None,
    user_visible_summary: str | None = None,
    internal_note: str | None = None,
    source_revision_id: str | None = None,
) -> DataCorrectionReportStatusEvent:
    event = DataCorrectionReportStatusEvent(
        correction_report_id=correction_report_id,
        status=status_value,
        actor_user_id=actor_user_id,
        user_visible_summary=user_visible_summary,
        internal_note=internal_note,
        source_revision_id=source_revision_id,
        # Database defaults can be second-precision in local preview. Preserve
        # the actual transition order for owner and staff status histories.
        created_at=utc_now(),
    )
    db.add(event)
    db.flush()
    return event


def status_events_for_report(
    db: Session,
    correction_report_id: str,
) -> list[DataCorrectionReportStatusEvent]:
    return list(
        db.scalars(
            select(DataCorrectionReportStatusEvent)
            .where(DataCorrectionReportStatusEvent.correction_report_id == correction_report_id)
            .order_by(
                DataCorrectionReportStatusEvent.created_at.asc(),
                DataCorrectionReportStatusEvent.id.asc(),
            )
        ).all()
    )


def utc_now() -> datetime:
    return datetime.now(UTC)
