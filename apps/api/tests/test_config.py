import pytest
from pydantic import ValidationError

from app.core.config import Settings


def production_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "environment": "production",
        "jwt_secret": "a-production-secret-that-is-longer-than-thirty-two-characters",
        "identity_provider": "clerk",
        "clerk_jwks_url": "https://clerk.example.test/.well-known/jwks.json",
        "clerk_issuer": "https://clerk.example.test",
        "admin_clerk_subjects": "user_security_admin",
        "audit_log_retention_days": 365,
        "audit_delivery_backend": "webhook",
        "audit_delivery_webhook_url": "https://audit.example.test/append-only-events",
        "audit_delivery_hmac_secret": "audit-delivery-secret-that-is-longer-than-thirty-two-characters",
        "allow_dev_auth": False,
        "allow_legacy_local_tokens": False,
        "image_storage_backend": "s3",
        "image_storage_s3_bucket": "living-nutrition-private",
        "nutrition_provider_circuit_breaker_backend": "redis",
        "metrics_enabled": True,
        "metrics_bearer_token": "metrics-token-for-production-tests",
        "sentry_dsn": "https://public@sentry.example.test/123",
    }
    values.update(overrides)
    return Settings(**values)


def test_production_settings_require_redis_rate_limiting() -> None:
    with pytest.raises(ValidationError, match="RATE_LIMIT_BACKEND must be redis"):
        production_settings(rate_limit_backend="memory")


def test_production_settings_accept_redis_rate_limiting() -> None:
    settings = production_settings(
        rate_limit_backend="redis",
        trusted_proxy_cidrs="10.0.0.0/8,fd00::/8",
    )

    assert settings.rate_limit_backend == "redis"
    assert settings.trusted_proxy_cidrs == "10.0.0.0/8,fd00::/8"


def test_production_settings_require_an_explicit_trusted_proxy_policy() -> None:
    with pytest.raises(ValidationError, match="TRUSTED_PROXY_CIDRS"):
        production_settings(rate_limit_backend="redis")


def test_production_settings_require_protected_metrics() -> None:
    with pytest.raises(ValidationError, match="METRICS_ENABLED"):
        production_settings(
            rate_limit_backend="redis",
            trusted_proxy_cidrs="10.0.0.0/8",
            metrics_enabled=False,
        )


def test_production_settings_require_a_secure_sentry_dsn() -> None:
    with pytest.raises(ValidationError, match="SENTRY_DSN must be set"):
        production_settings(
            rate_limit_backend="redis",
            trusted_proxy_cidrs="10.0.0.0/8",
            sentry_dsn=None,
        )

    with pytest.raises(ValidationError, match="SENTRY_DSN must use HTTPS"):
        production_settings(
            rate_limit_backend="redis",
            trusted_proxy_cidrs="10.0.0.0/8",
            sentry_dsn="http://public@sentry.example.test/123",
        )


def test_production_settings_require_an_authorized_clerk_audit_reviewer() -> None:
    with pytest.raises(ValidationError, match="ADMIN_CLERK_SUBJECTS"):
        production_settings(
            rate_limit_backend="redis",
            trusted_proxy_cidrs="10.0.0.0/8",
            admin_clerk_subjects="",
    )


def test_production_settings_require_an_explicit_audit_retention_policy() -> None:
    with pytest.raises(ValidationError, match="AUDIT_LOG_RETENTION_DAYS"):
        production_settings(
            rate_limit_backend="redis",
            trusted_proxy_cidrs="10.0.0.0/8",
            audit_log_retention_days=None,
        )


def test_production_settings_require_signed_audit_delivery() -> None:
    with pytest.raises(ValidationError, match="AUDIT_DELIVERY_BACKEND=webhook"):
        production_settings(
            rate_limit_backend="redis",
            trusted_proxy_cidrs="10.0.0.0/8",
            audit_delivery_backend="disabled",
        )

    with pytest.raises(ValidationError, match="AUDIT_DELIVERY_WEBHOOK_URL"):
        production_settings(
            rate_limit_backend="redis",
            trusted_proxy_cidrs="10.0.0.0/8",
            audit_delivery_hmac_secret=None,
        )

    with pytest.raises(ValidationError, match="must use HTTPS"):
        production_settings(
            rate_limit_backend="redis",
            trusted_proxy_cidrs="10.0.0.0/8",
            audit_delivery_webhook_url="http://audit.example.test/events",
        )


def test_production_settings_require_shared_provider_circuit_state() -> None:
    with pytest.raises(ValidationError, match="NUTRITION_PROVIDER_CIRCUIT_BREAKER_BACKEND"):
        production_settings(
            rate_limit_backend="redis",
            trusted_proxy_cidrs="10.0.0.0/8",
            nutrition_provider_circuit_breaker_backend="memory",
        )


def test_rejects_refresh_backoff_maximum_below_its_base() -> None:
    with pytest.raises(ValidationError, match="FOOD_SOURCE_REFRESH_RETRY_MAX_SECONDS"):
        Settings(
            food_source_refresh_retry_base_seconds=120,
            food_source_refresh_retry_max_seconds=60,
        )


def test_production_settings_reject_local_or_unconfigured_image_storage() -> None:
    with pytest.raises(ValidationError, match="IMAGE_STORAGE_BACKEND=s3"):
        production_settings(
            rate_limit_backend="redis",
            trusted_proxy_cidrs="10.0.0.0/8",
            image_storage_backend="local",
        )


def test_production_settings_reject_e2e_fixture_mode() -> None:
    with pytest.raises(ValidationError, match="E2E_FIXTURE_MODE"):
        production_settings(
            rate_limit_backend="redis",
            trusted_proxy_cidrs="10.0.0.0/8",
            e2e_fixture_mode=True,
        )


def test_trusted_proxy_cidrs_reject_invalid_networks() -> None:
    with pytest.raises(ValidationError, match="TRUSTED_PROXY_CIDRS"):
        Settings(trusted_proxy_cidrs="not-a-network")


def test_optional_migration_deadline_accepts_an_empty_environment_value() -> None:
    settings = Settings(local_account_migration_deadline="")

    assert settings.local_account_migration_deadline is None


def test_normalizes_standard_managed_postgres_urls_for_psycopg() -> None:
    assert Settings(database_url="postgresql://user:pass@example.test/database").database_url == (
        "postgresql+psycopg://user:pass@example.test/database"
    )
    assert Settings(database_url="postgres://user:pass@example.test/database").database_url == (
        "postgresql+psycopg://user:pass@example.test/database"
    )


def test_production_r2_storage_requires_r2_compatible_settings() -> None:
    common = {
        "rate_limit_backend": "redis",
        "trusted_proxy_cidrs": "10.0.0.0/8",
        "image_storage_s3_compatibility": "cloudflare_r2",
    }
    with pytest.raises(ValidationError, match="IMAGE_STORAGE_S3_ENDPOINT_URL"):
        production_settings(**common)

    with pytest.raises(ValidationError, match="r2.cloudflarestorage.com"):
        production_settings(
            **common,
            image_storage_s3_endpoint_url="https://storage.example.test",
        )

    settings = production_settings(
        **common,
        image_storage_s3_endpoint_url="https://account-id.r2.cloudflarestorage.com",
        image_storage_s3_region="auto",
        image_storage_s3_access_key_id="r2-access-key",
        image_storage_s3_secret_access_key="r2-secret-key",
    )

    assert settings.image_storage_s3_compatibility == "cloudflare_r2"
