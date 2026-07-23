import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { themePalettes, type ThemePreference } from "@living-nutrition/design-tokens";
import type { FoodDetail, MealRead } from "@living-nutrition/shared-types";
import { ThemeProvider } from "../../../shared/theme/ThemeProvider";
import { FoodDetailScreen } from "../FoodDetailScreen";

const mockGetFood = jest.fn();
const mockGetMeal = jest.fn();
const mockGetFavoriteFoods = jest.fn();
const mockAddFavoriteFood = jest.fn();
const mockRemoveFavoriteFood = jest.fn();
const mockCreateFoodCorrectionReport = jest.fn();
const mockBack = jest.fn();
let mockParams: {
  id?: string;
  mealId?: string;
  itemId?: string;
  contextLabel?: string;
} = {};

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ back: mockBack }),
}));

jest.mock("../../../services/api", () => ({
  api: {
    getFood: (...args: unknown[]) => mockGetFood(...args),
    getMeal: (...args: unknown[]) => mockGetMeal(...args),
    getFavoriteFoods: (...args: unknown[]) => mockGetFavoriteFoods(...args),
    addFavoriteFood: (...args: unknown[]) => mockAddFavoriteFood(...args),
    removeFavoriteFood: (...args: unknown[]) => mockRemoveFavoriteFood(...args),
    createFoodCorrectionReport: (...args: unknown[]) => mockCreateFoodCorrectionReport(...args),
  },
}));

describe("FoodDetailScreen", () => {
  beforeEach(() => {
    mockParams = { id: "usda:173944", contextLabel: "Manual search source" };
    mockGetFood.mockReset();
    mockGetMeal.mockReset();
    mockGetFavoriteFoods.mockReset();
    mockAddFavoriteFood.mockReset();
    mockRemoveFavoriteFood.mockReset();
    mockCreateFoodCorrectionReport.mockReset();
    mockBack.mockReset();
    mockGetFavoriteFoods.mockResolvedValue({ items: [] });
  });

  it("renders provider provenance, quality warnings, serving options, and per-100g nutrients", async () => {
    mockGetFood.mockResolvedValue(bananaDetail());

    const view = await renderWithQueryClient(<FoodDetailScreen />);

    await waitFor(() => {
      expect(view.getByText("Nutrition per 100g")).toBeTruthy();
    });

    expect(mockGetFood).toHaveBeenCalledWith("usda:173944");
    expect(view.getByText("Manual search source")).toBeTruthy();
    expect(view.getAllByText("Bananas, raw").length).toBeGreaterThan(0);
    expect(view.getAllByText("USDA FoodData Central").length).toBeGreaterThan(0);
    expect(view.getByText("Serving does not match per-100g data")).toBeTruthy();
    expect(view.getByText("No verified gram weight for this serving.")).toBeTruthy();
    expect(view.getByLabelText("Calories: 89 kcal per 100 grams")).toBeTruthy();
    expect(view.getByText("https://fdc.nal.usda.gov/fdc-app.html#/food-details/173944/nutrients")).toBeTruthy();
    expect(view.getByText("208")).toBeTruthy();
  });

  it("shows saved meal snapshot provenance when live food lookup fails", async () => {
    mockParams = {
      id: "usda:gone",
      mealId: "meal_1",
      itemId: "meal_item_1",
      contextLabel: "Saved meal source",
    };
    mockGetFood.mockRejectedValue(new Error("Network request failed"));
    mockGetMeal.mockResolvedValue(savedMeal());

    const view = await renderWithQueryClient(<FoodDetailScreen />);

    await waitFor(
      () => {
        expect(view.getByText("Showing saved snapshot")).toBeTruthy();
      },
      { timeout: 4000 }
    );

    expect(mockGetFood).toHaveBeenCalledWith("usda:gone");
    expect(mockGetMeal).toHaveBeenCalledWith("meal_1");
    expect(view.getByText("Saved meal source")).toBeTruthy();
    expect(view.getByText(/Saved meal snapshot/)).toBeTruthy();
    expect(view.getByText("Live source unavailable")).toBeTruthy();
    expect(view.getByText("Logged portion")).toBeTruthy();
    expect(view.getByLabelText("Calories: 89 kcal per 100 grams")).toBeTruthy();
  });

  it("keeps source actions and correction placeholders readable in dark mode", async () => {
    mockGetFood.mockResolvedValue(bananaDetail());

    const view = await renderWithQueryClient(<FoodDetailScreen />, "dark");

    await waitFor(() => expect(view.getByText("Nutrition per 100g")).toBeTruthy());
    expect(StyleSheet.flatten(view.getByText("Close").props.style).color).toBe(
      themePalettes.dark.actionText
    );
    expect(view.getByPlaceholderText(/calories look too high/).props.placeholderTextColor).toBe(
      themePalettes.dark.muted
    );
  });
});

function bananaDetail(): FoodDetail {
  return {
    id: "usda:173944",
    displayName: "Bananas, raw",
    provider: "usda",
    externalId: "173944",
    dataType: "Foundation",
    brandOwner: null,
    publicationDate: "2024-04-01",
    servingSize: 118,
    servingSizeUnit: "g",
    householdServingText: "1 medium banana",
    nutrientsPer100g: {
      caloriesKcal: 89,
      proteinGrams: 1.1,
      carbohydrateGrams: 22.8,
      fatGrams: 0.3,
      fiberGrams: 2.6,
      sugarGrams: 12.2,
      sodiumMilligrams: 1,
    },
    originalNutrientIds: {
      caloriesKcal: "208",
      proteinGrams: "203",
    },
    qualityFlags: ["serving_per_100g_conflict"],
    recordConfidence: "medium",
    sourceReference: "https://fdc.nal.usda.gov/fdc-app.html#/food-details/173944/nutrients",
    retrievedAt: "2026-07-09T12:00:00.000Z",
    servingOptions: [
      {
        label: "Medium banana",
        quantity: 1,
        unit: "piece",
      },
      {
        label: "100 grams",
        quantity: 100,
        unit: "grams",
        grams: 100,
      },
    ],
    provenanceSummary: "USDA Foundation Food record normalized per 100 grams.",
    retrievalHistory: [
      {
        displayName: "Bananas, raw",
        dataType: "Foundation",
        brandOwner: null,
        publicationDate: "2024-04-01",
        nutrientsPer100g: {
          caloriesKcal: 89,
          proteinGrams: 1.1,
          carbohydrateGrams: 22.8,
          fatGrams: 0.3,
        },
        qualityFlags: [],
        sourceReference: "https://fdc.nal.usda.gov/fdc-app.html#/food-details/173944/nutrients",
        sourceRetrievedAt: "2026-07-09T12:00:00.000Z",
      },
    ],
    sourceConflicts: [],
  };
}

function savedMeal(): MealRead {
  return {
    id: "meal_1",
    revision: 1,
    name: "Snack",
    loggedAt: "2026-07-09T12:00:00.000Z",
    notes: null,
    createdAt: "2026-07-09T12:00:00.000Z",
    updatedAt: "2026-07-09T12:00:00.000Z",
    items: [
      {
        id: "meal_item_1",
        foodId: "usda:gone",
        displayName: "Bananas, raw",
        consumedGrams: 118,
        servingQuantity: 118,
        servingUnit: "grams",
        calories: 105,
        proteinGrams: 1.3,
        carbohydrateGrams: 27,
        fatGrams: 0.4,
        fiberGrams: 3.1,
        sugarGrams: 14.4,
        sodiumMilligrams: 1.2,
        sourceProvider: "usda",
        sourceExternalId: "gone",
        sourceVersion: "Foundation",
        sourceReference: "Saved USDA source URL",
        nutrientSnapshotJson: {
          nutrientsPer100g: {
            caloriesKcal: 89,
            proteinGrams: 1.1,
            carbohydrateGrams: 22.8,
            fatGrams: 0.3,
            fiberGrams: 2.6,
            sugarGrams: 12.2,
            sodiumMilligrams: 1,
          },
          servingLabel: "118g confirmed",
          originalNutrientIds: {
            caloriesKcal: "208",
          },
        },
        confidence: {
          identity: "verified",
          portion: "verified",
          nutritionRecord: "high",
          explanation: "Saved from source record.",
        },
        userConfirmed: true,
        preparationMethod: "raw",
        addedOilGrams: 0,
        notes: null,
        createdAt: "2026-07-09T12:00:00.000Z",
        updatedAt: "2026-07-09T12:00:00.000Z",
      },
    ],
  };
}

function renderWithQueryClient(element: ReactElement, themePreference: ThemePreference = "light") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });

  return render(
    <ThemeProvider initialPreference={themePreference}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <QueryClientProvider client={queryClient}>
          {element}
        </QueryClientProvider>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
