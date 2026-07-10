from fastapi import APIRouter, Depends

from app.analysis.meal_analyzer import analyze_meal_photo
from app.nutrition.provider_registry import NutritionProviderRegistry, get_provider_registry
from app.schemas.analysis import MealAnalysisRequest, MealAnalysisResult

router = APIRouter()


@router.post("", response_model=MealAnalysisResult)
async def create_meal_analysis(
    request: MealAnalysisRequest,
    registry: NutritionProviderRegistry = Depends(get_provider_registry),
) -> MealAnalysisResult:
    return await analyze_meal_photo(request.image_base64, registry)
