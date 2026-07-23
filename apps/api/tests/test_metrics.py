from tests.http_client import ApiTestClient as TestClient

from app.api.v1 import router as api_router_module
from app.core.config import settings
from app.core.metrics import metrics
from app.main import app
from app.services.worker_heartbeats import WorkerHealthReport


def test_metrics_endpoint_is_hidden_when_disabled(monkeypatch) -> None:
    monkeypatch.setattr(settings, "metrics_enabled", False)

    response = TestClient(app).get("/metrics")

    assert response.status_code == 404


def test_metrics_endpoint_requires_the_configured_bearer_token(monkeypatch) -> None:
    monkeypatch.setattr(settings, "metrics_enabled", True)
    monkeypatch.setattr(settings, "metrics_bearer_token", "test-scrape-token")

    client = TestClient(app)
    assert client.get("/metrics").status_code == 404

    response = client.get("/metrics", headers={"Authorization": "Bearer test-scrape-token"})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain; version=0.0.4")


def test_metrics_emit_normalized_routes_rate_limit_outcomes_and_readiness_gauges(monkeypatch) -> None:
    monkeypatch.setattr(settings, "metrics_enabled", True)
    monkeypatch.setattr(settings, "metrics_bearer_token", "test-scrape-token")
    monkeypatch.setattr(
        api_router_module,
        "database_health",
        lambda: {"connected": True, "schemaReady": True},
    )
    metrics.record_rate_limit_decision(policy="analysis", outcome="denied")
    client = TestClient(app)

    health = client.get("/api/v1/health")
    readiness = client.get("/api/v1/health/ready")
    scrape = client.get("/metrics", headers={"Authorization": "Bearer test-scrape-token"})

    assert health.status_code == 200
    assert readiness.status_code == 200
    body = scrape.text
    assert 'living_nutrition_http_requests_total{method="GET",route="/api/v1/health",status="200"} 1' in body
    assert 'living_nutrition_rate_limit_decisions_total{outcome="denied",policy="analysis"} 1' in body
    assert 'living_nutrition_dependency_healthy{dependency="database"} 1' in body
    assert 'living_nutrition_dependency_healthy{dependency="rate_limiter"} 1' in body
    assert 'living_nutrition_dependency_healthy{dependency="provider_circuit_breaker"} 1' in body
    assert "requestId" not in body
    assert "127.0.0.1" not in body


def test_readiness_emits_aggregate_background_worker_health_metrics(monkeypatch) -> None:
    monkeypatch.setattr(settings, "metrics_enabled", True)
    monkeypatch.setattr(settings, "metrics_bearer_token", "test-scrape-token")
    monkeypatch.setattr(settings, "background_worker_heartbeats_required", True)
    monkeypatch.setattr(
        api_router_module,
        "database_health",
        lambda: {"connected": True, "schemaReady": True},
    )
    monkeypatch.setattr(
        api_router_module,
        "background_worker_health",
        lambda: WorkerHealthReport(
            required=True,
            healthy=True,
            backend="database",
            workers={
                "meal_analysis": True,
                "image_retention": True,
                "food_source_refresh": True,
            },
        ),
    )

    client = TestClient(app)
    assert client.get("/api/v1/health/ready").status_code == 200
    body = client.get("/metrics", headers={"Authorization": "Bearer test-scrape-token"}).text

    assert 'living_nutrition_background_worker_healthy{worker="meal_analysis"} 1' in body
    assert 'living_nutrition_background_worker_healthy{worker="image_retention"} 1' in body
    assert 'living_nutrition_background_worker_healthy{worker="food_source_refresh"} 1' in body
