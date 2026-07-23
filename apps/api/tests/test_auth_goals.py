from collections.abc import Generator
from datetime import date, timedelta

from fastapi import HTTPException
from tests.http_client import ApiTestClient as TestClient
from pydantic import ValidationError
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db
from app.core.clerk import ClerkIdentity
from app.core.config import Settings, settings
from app.core.tokens import issue_auth_tokens, normalize_device_label
from app.core.passwords import hash_password
from app.main import app
from app.models.user import AuditLog, AuthSession, User, UserPreference
import app.core.auth as auth_module
import app.models as _models  # noqa: F401

LOCAL_PASSWORD = "correct-horse-battery-staple"
NEW_LOCAL_PASSWORD = "another-correct-horse-battery-staple"


def test_device_labels_are_limited_to_generic_app_context() -> None:
    assert normalize_device_label(" Living Nutrition on iOS ") == "Living Nutrition on iOS"
    assert normalize_device_label("Living Nutrition on Android") == "Living Nutrition on Android"
    assert normalize_device_label("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)") is None
    assert normalize_device_label("device-id=4d75c9c6") is None


def test_production_settings_require_strong_jwt_and_disable_dev_compatibility() -> None:
    with pytest.raises(ValidationError, match="JWT_SECRET"):
        Settings(
            environment="production",
            jwt_secret="too-short",
            allow_dev_auth=False,
            allow_legacy_local_tokens=False,
        )

    with pytest.raises(ValidationError, match="Development and legacy"):
        Settings(
            environment="production",
            jwt_secret="a" * 32,
            allow_dev_auth=True,
            allow_legacy_local_tokens=False,
        )

    settings = Settings(
        environment="production",
        jwt_secret="a" * 32,
        identity_provider="clerk",
        clerk_jwks_url="https://clerk.example.test/.well-known/jwks.json",
        clerk_issuer="https://clerk.example.test",
        admin_clerk_subjects="user_security_admin",
        audit_log_retention_days=365,
        audit_delivery_backend="webhook",
        audit_delivery_webhook_url="https://audit.example.test/append-only-events",
        audit_delivery_hmac_secret="audit-delivery-secret-that-is-longer-than-thirty-two-characters",
        allow_dev_auth=False,
        allow_legacy_local_tokens=False,
        rate_limit_backend="redis",
        trusted_proxy_cidrs="10.0.0.0/8",
        nutrition_provider_circuit_breaker_backend="redis",
            metrics_enabled=True,
            metrics_bearer_token="test-metrics-token",
            sentry_dsn="https://public@sentry.example.test/123",
            background_worker_heartbeats_required=True,
            image_storage_backend="s3",
        image_storage_s3_bucket="living-nutrition-private",
    )
    assert settings.jwt_access_token_minutes == 15


def test_local_auth_token_can_store_goal_for_user() -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db() -> Generator[Session, None, None]:
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    try:
        client = TestClient(app)
        session = client.post(
            "/api/v1/auth/register",
            json={
                "email": "luis@example.com",
                "password": LOCAL_PASSWORD,
                "displayName": "Luis",
            },
        )
        assert session.status_code == 200
        token = session.json()["token"]
        refresh_token = session.json()["refreshToken"]
        assert token
        assert refresh_token
        assert session.json()["accessToken"] == token
        assert session.json()["authScheme"] == "jwt"

        created_goal = client.put(
            "/api/v1/goals",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "startsOn": "2026-07-07",
                "caloriesKcal": 2400,
                "proteinGrams": 160,
                "carbohydrateGrams": 280,
                "fatGrams": 70,
                "fiberGrams": 28,
                "sodiumMilligrams": 2300,
            },
        )
        assert created_goal.status_code == 200
        assert created_goal.json()["caloriesKcal"] == 2400

        future_goal = client.put(
            "/api/v1/goals",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "startsOn": "2026-08-01",
                "caloriesKcal": 2200,
                "proteinGrams": 155,
                "carbohydrateGrams": 260,
                "fatGrams": 65,
            },
        )
        assert future_goal.status_code == 200

        loaded_goal = client.get("/api/v1/goals", headers={"Authorization": f"Bearer {token}"})
        assert loaded_goal.status_code == 200
        assert loaded_goal.json()["proteinGrams"] == 160

        goal_history = client.get("/api/v1/goals/history", headers={"Authorization": f"Bearer {token}"})
        assert goal_history.status_code == 200
        assert [entry["startsOn"] for entry in goal_history.json()] == ["2026-08-01", "2026-07-07"]
        assert [entry["caloriesKcal"] for entry in goal_history.json()] == [2200, 2400]

        loaded_session = client.get("/api/v1/auth/session", headers={"Authorization": f"Bearer {token}"})
        assert loaded_session.status_code == 200
        assert loaded_session.json()["email"] == "luis@example.com"

        login = client.post(
            "/api/v1/auth/login",
            json={"email": "luis@example.com", "password": LOCAL_PASSWORD},
        )
        assert login.status_code == 200
        assert login.json()["token"]
        assert login.json()["token"] != token
        assert login.json()["refreshToken"]

        wrong_password = client.post(
            "/api/v1/auth/login",
            json={"email": "luis@example.com", "password": "definitely-wrong"},
        )
        assert wrong_password.status_code == 401

        unknown_user = client.post(
            "/api/v1/auth/login",
            json={"email": "missing@example.com", "password": LOCAL_PASSWORD},
        )
        assert unknown_user.status_code == 401

        default_preferences = client.get("/api/v1/preferences", headers={"Authorization": f"Bearer {token}"})
        assert default_preferences.status_code == 200
        assert default_preferences.json()["unitSystem"] == "metric"
        assert default_preferences.json()["dietaryPreferences"] == []

        updated_preferences = client.put(
            "/api/v1/preferences",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "unitSystem": "us",
                "goalDirection": "cut",
                "onboardingGoal": "lose_gradually",
                "loggingPreference": "kitchen_scale",
                "dietaryPreferences": ["vegetarian", "dairy_free", "vegetarian"],
                "themePreference": "dark",
            },
        )
        assert updated_preferences.status_code == 200
        assert updated_preferences.json()["unitSystem"] == "us"
        assert updated_preferences.json()["goalDirection"] == "cut"
        assert updated_preferences.json()["onboardingGoal"] == "lose_gradually"
        assert updated_preferences.json()["loggingPreference"] == "kitchen_scale"
        assert updated_preferences.json()["dietaryPreferences"] == ["vegetarian", "dairy_free"]
        assert updated_preferences.json()["themePreference"] == "dark"

        loaded_preferences = client.get("/api/v1/preferences", headers={"Authorization": f"Bearer {token}"})
        assert loaded_preferences.status_code == 200
        assert loaded_preferences.json()["unitSystem"] == "us"
        assert loaded_preferences.json()["goalDirection"] == "cut"
        assert loaded_preferences.json()["onboardingGoal"] == "lose_gradually"
        assert loaded_preferences.json()["loggingPreference"] == "kitchen_scale"
        assert loaded_preferences.json()["dietaryPreferences"] == ["vegetarian", "dairy_free"]
        assert loaded_preferences.json()["themePreference"] == "dark"
    finally:
        app.dependency_overrides.clear()


def test_refresh_rotation_and_logout_revoke_access_session() -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db() -> Generator[Session, None, None]:
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    try:
        client = TestClient(app)
        registered = client.post(
            "/api/v1/auth/register",
            headers={"X-Living-Nutrition-Client": " Living Nutrition on iOS "},
            json={
                "email": "refresh@example.com",
                "password": LOCAL_PASSWORD,
                "displayName": "Refresh User",
            },
        )
        assert registered.status_code == 200
        first_access_token = registered.json()["accessToken"]
        first_refresh_token = registered.json()["refreshToken"]

        refreshed = client.post(
            "/api/v1/auth/refresh",
            json={"refreshToken": first_refresh_token},
        )
        assert refreshed.status_code == 200
        second_access_token = refreshed.json()["accessToken"]
        second_refresh_token = refreshed.json()["refreshToken"]
        assert second_access_token != first_access_token
        assert second_refresh_token != first_refresh_token

        reused_refresh = client.post(
            "/api/v1/auth/refresh",
            json={"refreshToken": first_refresh_token},
        )
        assert reused_refresh.status_code == 401

        revoked_access = client.get(
            "/api/v1/auth/session",
            headers={"Authorization": f"Bearer {first_access_token}"},
        )
        assert revoked_access.status_code == 401

        active_session = client.get(
            "/api/v1/auth/session",
            headers={"Authorization": f"Bearer {second_access_token}"},
        )
        assert active_session.status_code == 200
        assert active_session.json()["authScheme"] == "jwt"

        other_login = client.post(
            "/api/v1/auth/login",
            headers={"X-Living-Nutrition-Client": "Living Nutrition on Android"},
            json={"email": "refresh@example.com", "password": LOCAL_PASSWORD},
        )
        assert other_login.status_code == 200
        other_access_token = other_login.json()["accessToken"]

        listed_sessions = client.get(
            "/api/v1/auth/sessions",
            headers={"Authorization": f"Bearer {second_access_token}"},
        )
        assert listed_sessions.status_code == 200
        sessions = listed_sessions.json()["items"]
        assert len(sessions) == 2
        current_session = next(item for item in sessions if item["isCurrent"])
        other_session = next(item for item in sessions if not item["isCurrent"])
        assert current_session["id"] != other_session["id"]
        assert current_session["expiresAt"]
        assert current_session["deviceLabel"] == "Living Nutrition on iOS"
        assert other_session["deviceLabel"] == "Living Nutrition on Android"

        revoke_current = client.delete(
            f"/api/v1/auth/sessions/{current_session['id']}",
            headers={"Authorization": f"Bearer {second_access_token}"},
        )
        assert revoke_current.status_code == 400

        revoke_other = client.delete(
            f"/api/v1/auth/sessions/{other_session['id']}",
            headers={"Authorization": f"Bearer {second_access_token}"},
        )
        assert revoke_other.status_code == 204
        revoked_other_access = client.get(
            "/api/v1/auth/session",
            headers={"Authorization": f"Bearer {other_access_token}"},
        )
        assert revoked_other_access.status_code == 401

        logged_out = client.post(
            "/api/v1/auth/logout",
            json={"refreshToken": second_refresh_token},
        )
        assert logged_out.status_code == 204

        logged_out_access = client.get(
            "/api/v1/auth/session",
            headers={"Authorization": f"Bearer {second_access_token}"},
        )
        assert logged_out_access.status_code == 401

        with TestingSessionLocal() as db:
            events = list(
                db.scalars(
                    select(AuditLog.event_type)
                    .where(AuditLog.user_id == registered.json()["id"])
                ).all()
            )
            assert sorted(events) == [
                "auth.login",
                "auth.logout",
                "auth.refresh",
                "auth.register",
                "auth.session_revoke",
            ]
    finally:
        app.dependency_overrides.clear()


def test_clerk_profiles_provision_migrate_and_protect_user_data(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db() -> Generator[Session, None, None]:
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    def verify(token: str) -> ClerkIdentity:
        if token == "clerk-subject-a":
            return ClerkIdentity(
                subject="user_clerk_a",
                session_id="sess_clerk_a",
                email="clerk@example.com",
                display_name="Clerk User",
            )
        if token == "clerk-subject-b":
            return ClerkIdentity(
                subject="user_clerk_b",
                session_id="sess_clerk_b",
                email="migrated@example.com",
                display_name="Migrated User",
            )
        raise HTTPException(status_code=401, detail="Invalid Clerk session token.")

    monkeypatch.setattr(settings, "identity_provider", "clerk")
    monkeypatch.setattr(settings, "allow_dev_auth", False)
    monkeypatch.setattr(settings, "allow_legacy_local_tokens", False)
    monkeypatch.setattr(settings, "local_account_migration_enabled", True)
    monkeypatch.setattr(settings, "local_account_migration_deadline", date.today() + timedelta(days=7))
    monkeypatch.setattr(auth_module, "verify_clerk_token", verify)
    app.dependency_overrides[get_db] = override_get_db

    try:
        client = TestClient(app)

        unprovisioned_goal = client.get(
            "/api/v1/goals",
            headers={"Authorization": "Bearer clerk-subject-a"},
        )
        assert unprovisioned_goal.status_code == 401

        provisioned = client.post(
            "/api/v1/auth/provision",
            headers={"Authorization": "Bearer clerk-subject-a"},
            json={"email": "clerk@example.com", "displayName": "Clerk User"},
        )
        assert provisioned.status_code == 200
        assert provisioned.json()["authScheme"] == "clerk"
        clerk_user_id = provisioned.json()["id"]

        goal = client.put(
            "/api/v1/goals",
            headers={"Authorization": "Bearer clerk-subject-a"},
            json={
                "caloriesKcal": 2300,
                "proteinGrams": 150,
                "carbohydrateGrams": 260,
                "fatGrams": 70,
            },
        )
        assert goal.status_code == 200

        local_login = client.post(
            "/api/v1/auth/login",
            json={"email": "clerk@example.com", "password": LOCAL_PASSWORD},
        )
        assert local_login.status_code == 410

        with TestingSessionLocal.begin() as db:
            legacy_user = User(
                id="00000000-0000-4000-8000-000000000099",
                email="migrated@example.com",
                display_name="Legacy User",
                password_hash=hash_password(LOCAL_PASSWORD),
                auth_provider="local",
                external_subject="migrated@example.com",
            )
            db.add(legacy_user)
            db.add(UserPreference(user_id=legacy_user.id, locale="en-US", unit_system="metric", timezone="UTC"))
            issue_auth_tokens(legacy_user, db, commit=False)
            db.flush()

        migrated = client.post(
            "/api/v1/auth/migrate-local-account",
            headers={"Authorization": "Bearer clerk-subject-b"},
            json={"email": "migrated@example.com", "password": LOCAL_PASSWORD},
        )
        assert migrated.status_code == 200
        assert migrated.json()["id"] != clerk_user_id
        assert migrated.json()["authScheme"] == "clerk"

        with TestingSessionLocal() as db:
            legacy_user = db.get(User, "00000000-0000-4000-8000-000000000099")
            assert legacy_user
            assert legacy_user.auth_provider == "clerk"
            assert legacy_user.external_subject == "user_clerk_b"
            assert legacy_user.password_hash is None
            legacy_session = db.scalar(select(AuthSession).where(AuthSession.user_id == legacy_user.id))
            assert legacy_session and legacy_session.revoked_at is not None

        wrong_user = client.get(
            "/api/v1/goals",
            headers={"Authorization": "Bearer invalid-clerk-token"},
        )
        assert wrong_user.status_code == 401
    finally:
        app.dependency_overrides.clear()


def test_security_activity_is_limited_to_the_authenticated_account() -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db() -> Generator[Session, None, None]:
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    try:
        client = TestClient(app)
        first = client.post(
            "/api/v1/auth/register",
            json={"email": "activity-first@example.com", "password": LOCAL_PASSWORD},
        )
        second = client.post(
            "/api/v1/auth/register",
            json={"email": "activity-second@example.com", "password": LOCAL_PASSWORD},
        )
        assert first.status_code == 200
        assert second.status_code == 200

        first_activity = client.get(
            "/api/v1/auth/activity?limit=1",
            headers={"Authorization": f"Bearer {first.json()['accessToken']}"},
        )
        assert first_activity.status_code == 200
        body = first_activity.json()
        assert body["items"] == [
            {
                "id": body["items"][0]["id"],
                "eventType": "auth.register",
                "outcome": "success",
                "createdAt": body["items"][0]["createdAt"],
            }
        ]
        assert "requestId" not in body["items"][0]
        assert "clientFingerprint" not in body["items"][0]

        invalid_limit = client.get(
            "/api/v1/auth/activity?limit=26",
            headers={"Authorization": f"Bearer {first.json()['accessToken']}"},
        )
        assert invalid_limit.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_password_change_rotates_current_session_and_revokes_other_devices() -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db() -> Generator[Session, None, None]:
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    try:
        client = TestClient(app)
        registered = client.post(
            "/api/v1/auth/register",
            json={
                "email": "password-change@example.com",
                "password": LOCAL_PASSWORD,
                "displayName": "Password Change",
            },
        )
        assert registered.status_code == 200
        current_access_token = registered.json()["accessToken"]

        other_login = client.post(
            "/api/v1/auth/login",
            json={"email": "password-change@example.com", "password": LOCAL_PASSWORD},
        )
        assert other_login.status_code == 200
        other_access_token = other_login.json()["accessToken"]

        wrong_current_password = client.post(
            "/api/v1/auth/password",
            headers={"Authorization": f"Bearer {current_access_token}"},
            json={"currentPassword": "wrong-current-password", "newPassword": NEW_LOCAL_PASSWORD},
        )
        assert wrong_current_password.status_code == 401
        assert client.get(
            "/api/v1/auth/session",
            headers={"Authorization": f"Bearer {current_access_token}"},
        ).status_code == 200

        unchanged_password = client.post(
            "/api/v1/auth/password",
            headers={"Authorization": f"Bearer {current_access_token}"},
            json={"currentPassword": LOCAL_PASSWORD, "newPassword": LOCAL_PASSWORD},
        )
        assert unchanged_password.status_code == 400

        changed = client.post(
            "/api/v1/auth/password",
            headers={
                "Authorization": f"Bearer {current_access_token}",
                "X-Living-Nutrition-Client": "Living Nutrition on iOS",
            },
            json={"currentPassword": LOCAL_PASSWORD, "newPassword": NEW_LOCAL_PASSWORD},
        )
        assert changed.status_code == 200
        replacement_access_token = changed.json()["accessToken"]
        replacement_refresh_token = changed.json()["refreshToken"]
        assert replacement_access_token
        assert replacement_refresh_token
        assert replacement_access_token != current_access_token

        assert client.get(
            "/api/v1/auth/session",
            headers={"Authorization": f"Bearer {current_access_token}"},
        ).status_code == 401
        assert client.get(
            "/api/v1/auth/session",
            headers={"Authorization": f"Bearer {other_access_token}"},
        ).status_code == 401
        assert client.get(
            "/api/v1/auth/session",
            headers={"Authorization": f"Bearer {replacement_access_token}"},
        ).status_code == 200
        active_sessions = client.get(
            "/api/v1/auth/sessions",
            headers={"Authorization": f"Bearer {replacement_access_token}"},
        )
        assert active_sessions.status_code == 200
        replacement_sessions = active_sessions.json()["items"]
        assert len(replacement_sessions) == 1
        assert replacement_sessions[0]["deviceLabel"] == "Living Nutrition on iOS"
        assert replacement_sessions[0]["isCurrent"] is True

        old_password_login = client.post(
            "/api/v1/auth/login",
            json={"email": "password-change@example.com", "password": LOCAL_PASSWORD},
        )
        assert old_password_login.status_code == 401
        new_password_login = client.post(
            "/api/v1/auth/login",
            json={"email": "password-change@example.com", "password": NEW_LOCAL_PASSWORD},
        )
        assert new_password_login.status_code == 200

        with TestingSessionLocal() as db:
            events = list(
                db.scalars(
                    select(AuditLog.event_type).where(AuditLog.user_id == registered.json()["id"])
                ).all()
            )
            assert "auth.password_change" in events
    finally:
        app.dependency_overrides.clear()


def test_register_can_upgrade_legacy_local_user_without_password_hash() -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db() -> Generator[Session, None, None]:
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    try:
        with TestingSessionLocal() as db:
            db.add(
                User(
                    id="db1a9df8-5336-5de5-aa20-a8f764492dc6",
                    email="legacy@example.com",
                    display_name="Legacy",
                    auth_provider="local",
                    external_subject="legacy@example.com",
                )
            )
            db.commit()

        client = TestClient(app)
        upgraded_session = client.post(
            "/api/v1/auth/register",
            json={
                "email": "legacy@example.com",
                "password": LOCAL_PASSWORD,
                "displayName": "Upgraded",
            },
        )
        assert upgraded_session.status_code == 200
        assert upgraded_session.json()["displayName"] == "Upgraded"

        login = client.post(
            "/api/v1/auth/login",
            json={"email": "legacy@example.com", "password": LOCAL_PASSWORD},
        )
        assert login.status_code == 200
        assert login.json()["email"] == "legacy@example.com"
    finally:
        app.dependency_overrides.clear()


def test_invalid_local_auth_tokens_are_rejected() -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db() -> Generator[Session, None, None]:
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    try:
        client = TestClient(app)
        malformed_token = client.get(
            "/api/v1/auth/session",
            headers={"Authorization": "Bearer local:not-a-uuid"},
        )
        assert malformed_token.status_code == 401

        unsupported_token = client.get(
            "/api/v1/auth/session",
            headers={"Authorization": "Bearer production-token-placeholder"},
        )
        assert unsupported_token.status_code == 401

        missing_user_token = client.get(
            "/api/v1/auth/session",
            headers={"Authorization": "Bearer local:00000000-0000-4000-8000-000000000999"},
        )
        assert missing_user_token.status_code == 401
        assert "sign in again" in missing_user_token.json()["error"]["message"]

        dev_session = client.get("/api/v1/auth/session")
        assert dev_session.status_code == 200
        assert dev_session.json()["authScheme"] == "dev"
    finally:
        app.dependency_overrides.clear()
