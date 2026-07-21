from collections.abc import Generator
from datetime import UTC, datetime

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
from app.models.food import FoodSourceRecord, FoodSourceRevision
from app.models.user import AuditLog


def test_clerk_admin_can_triage_reports_without_exposing_reporter_identity(
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
            "reporter-token": ClerkIdentity(
                subject="user_reporter",
                session_id="sess_reporter",
                email="reporter@example.com",
                display_name="Reporter",
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
        reporter_headers = {"Authorization": "Bearer reporter-token"}
        member_headers = {"Authorization": "Bearer member-token"}
        for headers in (admin_headers, reporter_headers, member_headers):
            assert client.post("/api/v1/auth/provision", headers=headers, json={}).status_code == 200

        with testing_session.begin() as db:
            source_record = make_source_record("reported-food", "Reported food")
            unrelated_record = make_source_record("other-food", "Other food")
            db.add_all([source_record, unrelated_record])
            db.flush()
            revision = make_revision(source_record)
            unrelated_revision = make_revision(unrelated_record)
            db.add_all([revision, unrelated_revision])
            db.flush()
            food_id = source_record.id
            revision_id = revision.id
            unrelated_revision_id = unrelated_revision.id

        created = client.post(
            f"/api/v1/foods/{food_id}/correction-reports",
            headers=reporter_headers,
            json={
                "reportType": "wrong_nutrients",
                "message": "Protein and calories do not match this product label.",
            },
        )
        assert created.status_code == 201
        report_id = created.json()["id"]
        assert created.json()["statusHistory"] == [
            {
                "status": "open",
                "summary": "Report submitted.",
                "createdAt": created.json()["statusHistory"][0]["createdAt"],
            }
        ]

        assert client.get("/api/v1/admin/correction-reports", headers=member_headers).status_code == 403
        listed = client.get("/api/v1/admin/correction-reports?status=open", headers=admin_headers)
        assert listed.status_code == 200
        report = listed.json()["items"][0]
        assert report["id"] == report_id
        assert report["sourceExternalId"] == "reported-food"
        assert "reporter@example.com" not in str(listed.json())
        assert "userId" not in str(listed.json())

        invalid_revision = client.patch(
            f"/api/v1/admin/correction-reports/{report_id}",
            headers=admin_headers,
            json={
                "status": "triaged",
                "userVisibleSummary": "We are checking this source record.",
                "sourceRevisionId": unrelated_revision_id,
            },
        )
        assert invalid_revision.status_code == 422

        triaged = client.patch(
            f"/api/v1/admin/correction-reports/{report_id}",
            headers=admin_headers,
            json={
                "status": "triaged",
                "userVisibleSummary": "We are checking this source record.",
                "internalNote": "Compared the submitted label with the provider snapshot.",
                "sourceRevisionId": revision_id,
            },
        )
        assert triaged.status_code == 200
        assert triaged.json()["status"] == "triaged"
        assert triaged.json()["statusHistory"][-1]["internalNote"] == (
            "Compared the submitted label with the provider snapshot."
        )

        owner_history = client.get("/api/v1/correction-reports", headers=reporter_headers)
        assert owner_history.status_code == 200
        owner_report = owner_history.json()["items"][0]
        assert owner_report["status"] == "triaged"
        assert owner_report["statusHistory"][-1] == {
            "status": "triaged",
            "summary": "We are checking this source record.",
            "createdAt": owner_report["statusHistory"][-1]["createdAt"],
        }
        assert "internalNote" not in str(owner_report)
        assert "reporter@example.com" not in str(owner_report)

        resolved = client.patch(
            f"/api/v1/admin/correction-reports/{report_id}",
            headers=admin_headers,
            json={
                "status": "resolved",
                "userVisibleSummary": "We linked the updated provider revision for review.",
            },
        )
        assert resolved.status_code == 200
        assert resolved.json()["status"] == "resolved"
        assert resolved.json()["sourceRevisionId"] == revision_id
        assert client.patch(
            f"/api/v1/admin/correction-reports/{report_id}",
            headers=admin_headers,
            json={
                "status": "dismissed",
                "userVisibleSummary": "This should not run.",
            },
        ).status_code == 409

        with testing_session() as db:
            events = list(
                db.scalars(
                    select(AuditLog).where(
                        AuditLog.event_type == "admin.correction_report_status_change"
                    )
                ).all()
            )
            assert [event.outcome for event in events] == ["triaged", "resolved"]
            assert all(event.request_id for event in events)
    finally:
        app.dependency_overrides.clear()


def make_source_record(external_id: str, display_name: str) -> FoodSourceRecord:
    return FoodSourceRecord(
        provider="usda",
        external_id=external_id,
        display_name=display_name,
        data_type="Foundation",
        nutrients_per_100g={
            "caloriesKcal": 100,
            "proteinGrams": 5,
            "carbohydrateGrams": 15,
            "fatGrams": 2,
        },
        original_nutrient_ids={},
        quality_flags=[],
        source_reference=f"https://fdc.nal.usda.gov/{external_id}",
        retrieved_at=datetime.now(UTC),
    )


def make_revision(record: FoodSourceRecord) -> FoodSourceRevision:
    return FoodSourceRevision(
        food_source_record_id=record.id,
        display_name=record.display_name,
        data_type=record.data_type,
        brand_owner=record.brand_owner,
        publication_date=record.publication_date,
        nutrients_per_100g=record.nutrients_per_100g,
        serving_size=record.serving_size,
        serving_size_unit=record.serving_size_unit,
        household_serving_text=record.household_serving_text,
        original_nutrient_ids=record.original_nutrient_ids,
        quality_flags=record.quality_flags,
        source_reference=record.source_reference,
        source_retrieved_at=record.retrieved_at,
    )
