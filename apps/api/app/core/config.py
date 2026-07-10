from functools import lru_cache
from pathlib import Path

from pydantic import AnyHttpUrl, Field, model_validator
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
    allow_dev_auth: bool = True
    allow_legacy_local_tokens: bool = True
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"
    usda_api_key: str = "DEMO_KEY"
    open_food_facts_base_url: AnyHttpUrl = "https://world.openfoodfacts.org"
    nutrition_provider_timeout_seconds: float = Field(default=8.0, gt=0, le=60)
    nutrition_provider_max_attempts: int = Field(default=3, ge=1, le=5)
    nutrition_provider_retry_backoff_seconds: float = Field(default=0.2, ge=0, le=5)
    nutrition_provider_max_retry_delay_seconds: float = Field(default=2.0, ge=0, le=30)
    rate_limit_enabled: bool = True
    rate_limit_auth_max_requests: int = Field(default=12, ge=1, le=500)
    rate_limit_auth_window_seconds: int = Field(default=60, ge=1, le=3600)
    rate_limit_analysis_max_requests: int = Field(default=12, ge=1, le=500)
    rate_limit_analysis_window_seconds: int = Field(default=60, ge=1, le=3600)
    cors_origins: list[str] = ["http://localhost:8081", "exp://localhost:8081"]
    image_retention_days: int = 30
    auto_migrate_on_startup: bool = False

    @model_validator(mode="after")
    def validate_production_security(self) -> "Settings":
        if self.environment.lower() == "production":
            if self.jwt_secret == "change-me-in-development" or len(self.jwt_secret) < 32:
                raise ValueError("JWT_SECRET must be a unique value with at least 32 characters in production.")
            if self.allow_dev_auth or self.allow_legacy_local_tokens:
                raise ValueError("Development and legacy token auth must be disabled in production.")

        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
