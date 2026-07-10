from fastapi import APIRouter

from app.api.v1 import (
    auth_routes,
    diary_routes,
    food_routes,
    goal_routes,
    insight_routes,
    meal_analysis_routes,
    meal_routes,
    preference_routes,
    user_data_routes,
    weight_routes,
)
from app.db.health import database_health

api_router = APIRouter()


@api_router.get("/health", tags=["system"])
async def api_health() -> dict[str, object]:
    database = database_health()
    return {
        "ok": bool(database["connected"]) and bool(database["schemaReady"]),
        "database": database,
    }


api_router.include_router(auth_routes.router, prefix="/auth", tags=["auth"])
api_router.include_router(food_routes.router, prefix="/foods", tags=["foods"])
api_router.include_router(meal_analysis_routes.router, prefix="/meal-analysis", tags=["analysis"])
api_router.include_router(meal_routes.router, prefix="/meals", tags=["meals"])
api_router.include_router(diary_routes.router, prefix="/diary", tags=["diary"])
api_router.include_router(goal_routes.router, prefix="/goals", tags=["goals"])
api_router.include_router(insight_routes.router, prefix="/insights", tags=["insights"])
api_router.include_router(preference_routes.router, prefix="/preferences", tags=["preferences"])
api_router.include_router(weight_routes.router, prefix="/weight", tags=["weight"])
api_router.include_router(user_data_routes.router, tags=["user-data"])
