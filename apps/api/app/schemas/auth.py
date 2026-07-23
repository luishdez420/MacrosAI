from datetime import datetime

from pydantic import Field

from app.schemas.common import ApiModel


class LocalAuthRequest(ApiModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=256)
    display_name: str | None = Field(default=None, max_length=160)


class UserSession(ApiModel):
    id: str
    email: str | None = None
    display_name: str | None = None
    token: str | None = None
    access_token: str | None = None
    refresh_token: str | None = None
    access_token_expires_at: datetime | None = None
    auth_scheme: str


class RefreshTokenRequest(ApiModel):
    refresh_token: str = Field(min_length=20, max_length=1024)


class PasswordChangeRequest(ApiModel):
    current_password: str = Field(min_length=8, max_length=256)
    new_password: str = Field(min_length=8, max_length=256)


class ClerkProfileProvisionRequest(ApiModel):
    display_name: str | None = Field(default=None, max_length=160)
    email: str | None = Field(default=None, max_length=320)


class LocalAccountMigrationRequest(ApiModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=256)


class AuthSessionRead(ApiModel):
    id: str
    device_label: str | None = None
    created_at: datetime
    last_used_at: datetime | None = None
    expires_at: datetime
    is_current: bool


class AuthSessionList(ApiModel):
    items: list[AuthSessionRead]


class SecurityActivityRead(ApiModel):
    """Safe subset of an account's audit event for the account owner."""

    id: str
    event_type: str
    outcome: str
    created_at: datetime


class SecurityActivityList(ApiModel):
    items: list[SecurityActivityRead]


class AiUsageAllowanceRead(ApiModel):
    """Privacy-minimized capacity for one AI-assisted action."""

    remaining_operations: int | None = Field(default=None, ge=0)
    operation_limit: int | None = Field(default=None, ge=0)
    remaining_images: int | None = Field(default=None, ge=0)
    image_limit: int | None = Field(default=None, ge=0)
    remaining_concurrent: int | None = Field(default=None, ge=0)
    concurrency_limit: int | None = Field(default=None, ge=0)
    available: bool
    next_availability_at: datetime | None = None


class AiUsageSummaryRead(ApiModel):
    """Current-user analysis capacity without entitlement or ledger history."""

    window_days: int = Field(ge=1)
    meal_analysis: AiUsageAllowanceRead
    nutrition_label_analysis: AiUsageAllowanceRead
