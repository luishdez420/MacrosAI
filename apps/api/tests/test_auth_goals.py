from collections.abc import Generator

from fastapi.testclient import TestClient
from pydantic import ValidationError
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db
from app.core.config import Settings
from app.main import app
from app.models.user import AuditLog, User
import app.models as _models  # noqa: F401

LOCAL_PASSWORD = "correct-horse-battery-staple"


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
        allow_dev_auth=False,
        allow_legacy_local_tokens=False,
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

        loaded_goal = client.get("/api/v1/goals", headers={"Authorization": f"Bearer {token}"})
        assert loaded_goal.status_code == 200
        assert loaded_goal.json()["proteinGrams"] == 160

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

        updated_preferences = client.put(
            "/api/v1/preferences",
            headers={"Authorization": f"Bearer {token}"},
            json={"unitSystem": "us"},
        )
        assert updated_preferences.status_code == 200
        assert updated_preferences.json()["unitSystem"] == "us"

        loaded_preferences = client.get("/api/v1/preferences", headers={"Authorization": f"Bearer {token}"})
        assert loaded_preferences.status_code == 200
        assert loaded_preferences.json()["unitSystem"] == "us"
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
