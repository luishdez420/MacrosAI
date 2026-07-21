"""Privacy-minimized schemas for server-side operational review."""

from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import Field

from app.schemas.common import ApiModel


class AdminAuditEventRead(ApiModel):
    id: str
    event_type: str
    outcome: str
    request_id: str | None = None
    account_state: Literal["linked", "anonymized"]
    created_at: datetime


class AdminAuditEventList(ApiModel):
    items: list[AdminAuditEventRead]


class CorrectionReportStatus(StrEnum):
    open = "open"
    triaged = "triaged"
    resolved = "resolved"
    dismissed = "dismissed"


class AdminCorrectionReportStatusHistoryRead(ApiModel):
    status: CorrectionReportStatus
    user_visible_summary: str | None = None
    internal_note: str | None = None
    source_revision_id: str | None = None
    created_at: datetime


class AdminCorrectionReportRead(ApiModel):
    id: str
    food_source_record_id: str | None = None
    report_type: str
    message: str
    status: CorrectionReportStatus
    resolution_summary: str | None = None
    source_revision_id: str | None = None
    source_display_name: str | None = None
    source_provider: str | None = None
    source_external_id: str | None = None
    source_reference: str | None = None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None = None
    status_history: list[AdminCorrectionReportStatusHistoryRead] = Field(default_factory=list)


class AdminCorrectionReportList(ApiModel):
    items: list[AdminCorrectionReportRead]


class AdminCorrectionReportUpdate(ApiModel):
    status: CorrectionReportStatus
    user_visible_summary: str | None = Field(default=None, min_length=2, max_length=1000)
    internal_note: str | None = Field(default=None, min_length=2, max_length=2000)
    source_revision_id: str | None = Field(default=None, max_length=36)
