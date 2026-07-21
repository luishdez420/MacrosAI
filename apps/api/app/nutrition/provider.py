from abc import ABC, abstractmethod

from app.schemas.food import FoodSearchResult


class NutritionProviderUnavailableError(RuntimeError):
    """Raised when no configured nutrition provider can complete a live lookup."""


class NutritionProvider(ABC):
    name: str

    @abstractmethod
    async def search_foods(self, query: str, locale: str) -> list[FoodSearchResult]:
        raise NotImplementedError

    @abstractmethod
    async def get_food_by_external_id(self, external_id: str) -> FoodSearchResult | None:
        raise NotImplementedError

    @abstractmethod
    async def get_food_by_barcode(self, barcode: str) -> FoodSearchResult | None:
        raise NotImplementedError
