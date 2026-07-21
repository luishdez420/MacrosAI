from collections.abc import Generator
import pytest
from fastapi import HTTPException
from tests.http_client import ApiTestClient as TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.core.auth as auth_module
import app.models as _models  # noqa: F401
from app.core.clerk import ClerkIdentity
from app.core.config import settings
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.user import AuditLog


def test_admin_audit_review_is_clerk_only_and_omits_sensitive_account_data(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    testing_session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db() -> Generator[Session, None, None]:
        db = testing_session()
        try:
            yield db
        finally:
            db.close()

    def verify(token: str) -> ClerkIdentity:
        identities = {
            "admin-token": ClerkIdentity(
                subject="user_security_admin",
                session_id="sess_admin",
                email="admin@example.com",
                display_name="Security Admin",
            ),
            "member-token": ClerkIdentity(
                subject="user_member",
                session_id="sess_member",
                email="member@example.com",
                display_name="Member",
            ),
        }
        try:
            return identities[token]
        except KeyError as exc:
            raise HTTPException(status_code=401, detail="Invalid Clerk session token.") from exc

    monkeypatch.setattr(settings, "identity_provider", "clerk")
    monkeypatch.setattr(settings, "allow_dev_auth", False)
    monkeypatch.setattr(settings, "allow_legacy_local_tokens", False)
    monkeypatch.setattr(settings, "admin_clerk_subjects", "user_security_admin")
    monkeypatch.setattr(auth_module, "verify_clerk_token", verify)
    app.dependency_overrides[get_db] = override_get_db

    try:
        client = TestClient(app)
        admin_headers = {"Authorization": "Bearer admin-token"}
        member_headers = {"Authorization": "Bearer member-token"}
        assert client.post("/api/v1/auth/provision", headers=admin_headers, json={}).status_code == 200
        member = client.post("/api/v1/auth/provision", headers=member_headers, json={})
        assert member.status_code == 200

        with testing_session.begin() as db:
            db.add(
                AuditLog(
                    user_id=member.json()["id"],
                    event_type="auth.login",
                    outcome="success",
                    request_id="req-private-correlation",
                    client_fingerprint="one-way-client-fingerprint",
                )
            )

        denied = client.get("/api/v1/admin/audit-events", headers=member_headers)
        assert denied.status_code == 403

        response = client.get("/api/v1/admin/audit-events?limit=10", headers=admin_headers)
        assert response.status_code == 200
        payload = response.json()
        login_event = next(item for item in payload["items"] if item["eventType"] == "auth.login")
        assert login_event == {
            "id": login_event["id"],
            "eventType": "auth.login",
            "outcome": "success",
            "requestId": "req-private-correlation",
            "accountState": "linked",
            "createdAt": login_event["createdAt"],
        }
        serialized = str(payload)
        assert "member@example.com" not in serialized
        assert "one-way-client-fingerprint" not in serialized
        assert "userId" not in serialized
        assert "clientFingerprint" not in serialized

        with testing_session() as db:
            review_event = db.scalar(
                select(AuditLog).where(AuditLog.event_type == "admin.audit_review")
            )
            assert review_event is not None
            assert review_event.user_id == client.get("/api/v1/auth/session", headers=admin_headers).json()["id"]
            assert review_event.request_id is not None
    finally:
        app.dependency_overrides.clear()
