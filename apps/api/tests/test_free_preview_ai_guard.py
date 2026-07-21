import asyncio

import pytest
from fastapi import HTTPException

from app.analysis import meal_analyzer, nutrition_label_analyzer
from app.api.v1 import meal_analysis_routes
from app.core.config import settings


def test_free_preview_rejects_durable_camera_jobs_before_storage(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ai_features_enabled", False)

    with pytest.raises(HTTPException, match="free preview") as error:
        meal_analysis_routes.require_ai_features_enabled()

    assert error.value.status_code == 503


def test_free_preview_blocks_camera_vision_before_a_provider_request(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ai_features_enabled", False)

    with pytest.raises(HTTPException, match="free preview") as error:
        asyncio.run(meal_analyzer.identify_foods_with_openai(["aGVsbG8="]))

    assert error.value.status_code == 503


def test_free_preview_blocks_label_vision_before_a_provider_request(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ai_features_enabled", False)

    with pytest.raises(HTTPException, match="free preview") as error:
        asyncio.run(nutrition_label_analyzer.analyze_nutrition_label("aGVsbG8="))

    assert error.value.status_code == 503
