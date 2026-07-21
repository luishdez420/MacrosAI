from functools import lru_cache
from datetime import date, timedelta
from ipaddress import ip_network
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from pydantic import AnyHttpUrl, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

CONFIG_FILE = Path(__file__).resolve()
API_ROOT = CONFIG_FILE.parents[2]
REPO_ROOT = CONFIG_FILE.parents[4]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", API_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: str = "development"
    database_url: str = "postgresql+psycopg://living:living@localhost:5432/living_nutrition"
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret: str = Field(default="change-me-in-development")
    jwt_issuer: str = "living-nutrition-api"
    jwt_audience: str = "living-nutrition-mobile"
    jwt_access_token_minutes: int = Field(default=15, ge=5, le=120)
    jwt_refresh_token_days: int = Field(default=30, ge=1, le=180)
    identity_provider: Literal["local", "clerk"] = "local"
    clerk_jwks_url: AnyHttpUrl | None = None
    clerk_issuer: str | None = None
    clerk_audience: str | None = None
    clerk_jwks_cache_seconds: int = Field(default=900, ge=60, le=86_400)
    # Clerk subjects are configured only in managed server environments. They
    # are never accepted from a mobile request or returned by audit APIs.
    admin_clerk_subjects: str = ""
    local_account_migration_enabled: bool = False
    local_account_migration_deadline: date | None = None
    allow_dev_auth: bool = True
    allow_legacy_local_tokens: bool = True
    # Device E2E builds use deterministic local food and camera fixtures. This
    # mode must never be enabled for a deployed production environment.
    e2e_fixture_mode: bool = False
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"
    # A free or local preview can keep all manual/provider-backed flows online
    # while blocking image features before any billable vision request occurs.
    ai_features_enabled: bool = True
    usda_api_key: str = "DEMO_KEY"
    open_food_facts_base_url: AnyHttpUrl = "https://world.openfoodfacts.org"
    nutrition_provider_timeout_seconds: float = Field(default=8.0, gt=0, le=60)
    nutrition_provider_max_attempts: int = Field(default=3, ge=1, le=5)
    nutrition_provider_retry_backoff_seconds: float = Field(default=0.2, ge=0, le=5)
    nutrition_provider_max_retry_delay_seconds: float = Field(default=2.0, ge=0, le=30)
    nutrition_provider_circuit_breaker_backend: Literal["memory", "redis"] = "memory"
    nutrition_provider_circuit_breaker_redis_key_prefix: str = "living-nutrition:provider-circuit:v1"
    nutrition_provider_circuit_breaker_failure_threshold: int = Field(default=3, ge=1, le=20)
    nutrition_provider_circuit_breaker_recovery_seconds: int = Field(default=30, ge=1, le=3_600)
    nutrition_provider_circuit_breaker_probe_lease_seconds: int = Field(default=10, ge=1, le=300)
    food_search_cache_ttl_seconds: int = Field(default=900, ge=30, le=86_400)
    food_source_refresh_lease_seconds: int = Field(default=30, ge=5, le=600)
    food_source_refresh_retry_base_seconds: int = Field(default=60, ge=5, le=86_400)
    food_source_refresh_retry_max_seconds: int = Field(default=3_600, ge=5, le=604_800)
    food_source_refresh_retry_jitter_ratio: float = Field(default=0.2, ge=0, le=1)
    # A separate low-priority worker refreshes only a bounded set of stale
    # provider records. Request paths continue to use the same lease/backoff.
    food_source_refresh_worker_poll_seconds: int = Field(default=900, ge=30, le=86_400)
    food_source_refresh_worker_batch_size: int = Field(default=25, ge=1, le=100)
    idempotency_pending_ttl_seconds: int = Field(default=300, ge=30, le=3_600)
    idempotency_response_ttl_seconds: int = Field(default=86_400, ge=300, le=604_800)
    ai_quota_window_days: int = Field(default=30, ge=1, le=90)
    ai_quota_reservation_ttl_seconds: int = Field(default=600, ge=60, le=3_600)
    ai_quota_free_meal_analysis_limit: int = Field(default=20, ge=0, le=10_000)
    ai_quota_free_label_analysis_limit: int = Field(default=10, ge=0, le=10_000)
    ai_quota_free_images_limit: int = Field(default=40, ge=0, le=30_000)
    ai_quota_free_concurrent_limit: int = Field(default=1, ge=0, le=100)
    ai_quota_trial_meal_analysis_limit: int = Field(default=60, ge=0, le=10_000)
    ai_quota_trial_label_analysis_limit: int = Field(default=30, ge=0, le=10_000)
    ai_quota_trial_images_limit: int = Field(default=120, ge=0, le=30_000)
    ai_quota_trial_concurrent_limit: int = Field(default=2, ge=0, le=100)
    ai_quota_paid_meal_analysis_limit: int = Field(default=300, ge=0, le=100_000)
    ai_quota_paid_label_analysis_limit: int = Field(default=100, ge=0, le=100_000)
    ai_quota_paid_images_limit: int = Field(default=600, ge=0, le=300_000)
    ai_quota_paid_concurrent_limit: int = Field(default=3, ge=0, le=100)
    ai_quota_disabled_meal_analysis_limit: int = Field(default=0, ge=0, le=10_000)
    ai_quota_disabled_label_analysis_limit: int = Field(default=0, ge=0, le=10_000)
    ai_quota_disabled_images_limit: int = Field(default=0, ge=0, le=30_000)
    ai_quota_disabled_concurrent_limit: int = Field(default=0, ge=0, le=100)
    rate_limit_enabled: bool = True
    rate_limit_backend: Literal["memory", "redis"] = "memory"
    rate_limit_redis_key_prefix: str = "living-nutrition:rate-limit:v1"
    trusted_proxy_cidrs: str = ""
    rate_limit_auth_max_requests: int = Field(default=12, ge=1, le=500)
    rate_limit_auth_window_seconds: int = Field(default=60, ge=1, le=3600)
    # Public provider-catalog search is deliberately bounded independently
    # from credential and paid-analysis operations.
    rate_limit_food_search_max_requests: int = Field(default=30, ge=1, le=1_000)
    rate_limit_food_search_window_seconds: int = Field(default=60, ge=1, le=3_600)
    rate_limit_analysis_max_requests: int = Field(default=12, ge=1, le=500)
    rate_limit_analysis_window_seconds: int = Field(default=60, ge=1, le=3600)
    rate_limit_analysis_user_max_requests: int = Field(default=6, ge=1, le=500)
    rate_limit_analysis_user_window_seconds: int = Field(default=60, ge=1, le=3600)
    metrics_enabled: bool = False
    metrics_bearer_token: str | None = None
    # Error reporting is opt-in outside production. DSNs are project ingestion
    # identifiers, not credentials, but they are still environment-managed.
    sentry_dsn: AnyHttpUrl | None = None
    sentry_traces_sample_rate: float = Field(default=0.0, ge=0.0, le=1.0)
    cors_origins: list[str] = ["http://localhost:8081", "exp://localhost:8081"]
    image_retention_days: int = Field(default=30, ge=1, le=3650)
    image_retention_worker_poll_seconds: int = Field(default=300, ge=30, le=3600)
    image_signed_url_seconds: int = Field(default=300, ge=30, le=900)
    # Product/legal owners choose this deployment value. Production rejects an
    # unset policy rather than silently retaining operational records forever.
    audit_log_retention_days: int | None = Field(default=None, ge=1, le=3650)
    # Production sends only a privacy-minimized audit envelope to a managed
    # append-only receiver. The receiver, not the API, is responsible for its
    # WORM/immutable storage policy.
    audit_delivery_backend: Literal["disabled", "webhook"] = "disabled"
    audit_delivery_webhook_url: AnyHttpUrl | None = None
    audit_delivery_hmac_secret: str | None = None
    audit_delivery_timeout_seconds: float = Field(default=5.0, gt=0, le=30)
    audit_delivery_lease_seconds: int = Field(default=60, ge=5, le=600)
    audit_delivery_retry_base_seconds: int = Field(default=30, ge=5, le=86_400)
    audit_delivery_retry_max_seconds: int = Field(default=3_600, ge=5, le=604_800)
    analysis_job_lease_seconds: int = Field(default=300, ge=30, le=3600)
    analysis_job_expiry_hours: int = Field(default=24, ge=1, le=168)
    analysis_job_worker_poll_seconds: int = Field(default=3, ge=1, le=60)
    # Local storage is intentionally preview/test only. It exposes no URL and
    # is a seam for the future S3-compatible production implementation.
    image_storage_backend: Literal["local", "s3"] = "local"
    image_storage_local_root: str = "/tmp/living-nutrition-private-images"
    image_storage_s3_bucket: str | None = None
    image_storage_s3_prefix: str = "living-nutrition"
    # `cloudflare_r2` uses the S3 API but rejects AWS SSE request headers; R2
    # encrypts every object at rest without those headers instead.
    image_storage_s3_compatibility: Literal["aws", "cloudflare_r2"] = "aws"
    image_storage_s3_region: str | None = None
    image_storage_s3_endpoint_url: str | None = None
    image_storage_s3_kms_key_id: str | None = None
    image_storage_s3_access_key_id: str | None = None
    image_storage_s3_secret_access_key: str | None = None
    auto_migrate_on_startup: bool = False

    @field_validator("local_account_migration_deadline", "audit_log_retention_days", mode="before")
    @classmethod
    def normalize_optional_environment_value(cls, value: object) -> object:
        # `.env` files commonly represent optional values as an empty assignment.
        # Treat that as unset before Pydantic attempts to parse it as a date or integer.
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_postgres_driver_url(cls, value: object) -> object:
        """Use psycopg for generic managed-Postgres connection strings.

        Render exposes a standard `postgresql://` connection string, while this
        project installs psycopg 3 rather than psycopg2. Keeping the conversion
        at the configuration boundary makes Render and other managed Postgres
        URLs work without storing provider-specific URLs in source control.
        """

        if not isinstance(value, str):
            return value
        if value.startswith("postgres://"):
            return f"postgresql+psycopg://{value.removeprefix('postgres://')}"
        if value.startswith("postgresql://"):
            return f"postgresql+psycopg://{value.removeprefix('postgresql://')}"
        return value

    @field_validator("trusted_proxy_cidrs")
    @classmethod
    def normalize_trusted_proxy_cidrs(cls, value: str) -> str:
        """Validate a compact comma-separated CIDR allowlist at startup."""

        normalized: list[str] = []
        for candidate in value.split(","):
            cidr = candidate.strip()
            if not cidr:
                continue
            try:
                normalized.append(str(ip_network(cidr, strict=False)))
            except ValueError as exc:
                raise ValueError("TRUSTED_PROXY_CIDRS must contain valid CIDR ranges.") from exc
        return ",".join(normalized)

    @field_validator("admin_clerk_subjects")
    @classmethod
    def normalize_admin_clerk_subjects(cls, value: str) -> str:
        subjects = {subject.strip() for subject in value.split(",") if subject.strip()}
        return ",".join(sorted(subjects))

    @property
    def admin_clerk_subject_set(self) -> frozenset[str]:
        return frozenset(subject for subject in self.admin_clerk_subjects.split(",") if subject)

    @model_validator(mode="after")
    def validate_production_security(self) -> "Settings":
        if self.food_source_refresh_retry_max_seconds < self.food_source_refresh_retry_base_seconds:
            raise ValueError(
                "FOOD_SOURCE_REFRESH_RETRY_MAX_SECONDS must be at least FOOD_SOURCE_REFRESH_RETRY_BASE_SECONDS."
            )
        if self.audit_delivery_retry_max_seconds < self.audit_delivery_retry_base_seconds:
            raise ValueError(
                "AUDIT_DELIVERY_RETRY_MAX_SECONDS must be at least AUDIT_DELIVERY_RETRY_BASE_SECONDS."
            )
        if self.environment.lower() == "production":
            if self.e2e_fixture_mode:
                raise ValueError("E2E_FIXTURE_MODE must be disabled in production.")
            if self.jwt_secret == "change-me-in-development" or len(self.jwt_secret) < 32:
                raise ValueError("JWT_SECRET must be a unique value with at least 32 characters in production.")
            if self.allow_dev_auth or self.allow_legacy_local_tokens:
                raise ValueError("Development and legacy token auth must be disabled in production.")
            if not self.rate_limit_enabled or self.rate_limit_backend != "redis":
                raise ValueError(
                    "RATE_LIMIT_ENABLED must be true and RATE_LIMIT_BACKEND must be redis in production."
                )
            if self.nutrition_provider_circuit_breaker_backend != "redis":
                raise ValueError(
                    "NUTRITION_PROVIDER_CIRCUIT_BREAKER_BACKEND must be redis in production."
                )
            if not self.trusted_proxy_cidrs:
                raise ValueError(
                    "TRUSTED_PROXY_CIDRS must explicitly list the production proxy CIDRs."
                )
            if not self.metrics_enabled or not self.metrics_bearer_token:
                raise ValueError(
                    "METRICS_ENABLED must be true and METRICS_BEARER_TOKEN must be set in production."
                )
            if not self.sentry_dsn:
                raise ValueError("SENTRY_DSN must be set in production.")
            if self.sentry_dsn.scheme != "https":
                raise ValueError("SENTRY_DSN must use HTTPS in production.")
            if self.identity_provider != "clerk":
                raise ValueError("IDENTITY_PROVIDER must be clerk in production.")
            if not self.clerk_jwks_url or not self.clerk_issuer:
                raise ValueError("CLERK_JWKS_URL and CLERK_ISSUER are required in production.")
            if not self.admin_clerk_subject_set:
                raise ValueError("ADMIN_CLERK_SUBJECTS must include at least one authorized Clerk subject in production.")
            if self.audit_log_retention_days is None:
                raise ValueError(
                    "AUDIT_LOG_RETENTION_DAYS must be explicitly set in production."
                )
            if self.audit_delivery_backend != "webhook":
                raise ValueError("Production requires AUDIT_DELIVERY_BACKEND=webhook.")
            if not self.audit_delivery_webhook_url or not self.audit_delivery_hmac_secret:
                raise ValueError(
                    "AUDIT_DELIVERY_WEBHOOK_URL and AUDIT_DELIVERY_HMAC_SECRET are required in production."
                )
            if self.audit_delivery_webhook_url.scheme != "https":
                raise ValueError("AUDIT_DELIVERY_WEBHOOK_URL must use HTTPS in production.")
            if len(self.audit_delivery_hmac_secret) < 32:
                raise ValueError("AUDIT_DELIVERY_HMAC_SECRET must be at least 32 characters in production.")
            if self.image_storage_backend != "s3" or not self.image_storage_s3_bucket:
                raise ValueError("Production requires IMAGE_STORAGE_BACKEND=s3 and IMAGE_STORAGE_S3_BUCKET.")
            if self.image_storage_s3_compatibility == "cloudflare_r2":
                if not self.image_storage_s3_endpoint_url or not self.image_storage_s3_endpoint_url.startswith(
                    "https://"
                ):
                    raise ValueError(
                        "Cloudflare R2 storage requires an HTTPS IMAGE_STORAGE_S3_ENDPOINT_URL."
                    )
                r2_hostname = urlparse(self.image_storage_s3_endpoint_url).hostname
                if not r2_hostname or not r2_hostname.endswith(".r2.cloudflarestorage.com"):
                    raise ValueError(
                        "Cloudflare R2 storage requires an account-specific r2.cloudflarestorage.com endpoint."
                    )
                if self.image_storage_s3_region != "auto":
                    raise ValueError("Cloudflare R2 storage requires IMAGE_STORAGE_S3_REGION=auto.")
                if self.image_storage_s3_kms_key_id:
                    raise ValueError("Cloudflare R2 does not support IMAGE_STORAGE_S3_KMS_KEY_ID.")
                if not self.image_storage_s3_access_key_id or not self.image_storage_s3_secret_access_key:
                    raise ValueError(
                        "Cloudflare R2 storage requires IMAGE_STORAGE_S3_ACCESS_KEY_ID and "
                        "IMAGE_STORAGE_S3_SECRET_ACCESS_KEY."
                    )
            if self.local_account_migration_enabled:
                if not self.local_account_migration_deadline:
                    raise ValueError(
                        "LOCAL_ACCOUNT_MIGRATION_DEADLINE is required when local migration is enabled."
                    )
                if self.local_account_migration_deadline > date.today() + timedelta(days=90):
                    raise ValueError("Local-account migration may be enabled for at most 90 days in production.")

        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
