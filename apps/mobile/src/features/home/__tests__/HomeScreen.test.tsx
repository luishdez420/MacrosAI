import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { DiaryDay, NutritionGoal } from "@living-nutrition/shared-types";
import { HomeScreen } from "../HomeScreen";

const mockGetDiary = jest.fn();
const mockGetGoal = jest.fn();
const mockDeleteMeal = jest.fn();

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: unknown }) => children,
}));

jest.mock("../../../services/api", () => ({
  api: {
    getDiary: (...args: unknown[]) => mockGetDiary(...args),
    getGoal: (...args: unknown[]) => mockGetGoal(...args),
    deleteMeal: (...args: unknown[]) => mockDeleteMeal(...args),
  },
}));

describe("HomeScreen", () => {
  beforeEach(() => {
    mockGetDiary.mockReset();
    mockGetGoal.mockReset();
    mockDeleteMeal.mockReset();
  });

  it("shows the Home logging hub with today's actions, totals, and meal timeline", async () => {
    mockGetDiary.mockResolvedValue(todayDiary());
    mockGetGoal.mockResolvedValue(goal());

    const view = await renderWithQueryClient(<HomeScreen />);

    await waitFor(() => {
      expect(view.getByText("640 / 2200 kcal")).toBeTruthy();
      expect(view.getByText("grilled chicken bowl")).toBeTruthy();
    });

    expect(mockGetDiary).toHaveBeenCalledTimes(1);
    expect(view.getAllByText("Today").length).toBeGreaterThanOrEqual(1);
    expect(view.getByText("Scan meal")).toBeTruthy();
    expect(view.getByText("Manual entry")).toBeTruthy();
    expect(view.getByText("Natural entry")).toBeTruthy();
    expect(view.getByText("Scan barcode")).toBeTruthy();
    expect(view.getByText("1560 kcal remaining based on your saved goal.")).toBeTruthy();
    expect(view.getByText("Confirmed")).toBeTruthy();
    expect(view.getByText("640 kcal")).toBeTruthy();
    expect(view.getByText("42g protein")).toBeTruthy();
    expect(view.getByText("Based on saved meal snapshots and confirmed portions.")).toBeTruthy();
    expect(view.getByText("Edit portions")).toBeTruthy();
  });
});

function todayDiary(): DiaryDay {
  return {
    date: "2026-07-09",
    totals: {
      calories: 640,
      proteinGrams: 42,
      carbohydrateGrams: 70,
      fatGrams: 20,
      fiberGrams: 8,
      sugarGrams: 6,
      sodiumMilligrams: 520,
    },
    meals: [
      {
        id: "meal_1",
        name: "grilled chicken bowl",
        loggedAt: "2026-07-09T12:00:00Z",
        notes: "Manual entry.",
        createdAt: "2026-07-09T12:00:00Z",
        updatedAt: "2026-07-09T12:00:00Z",
        items: [
          {
            id: "meal_item_1",
            foodId: "usda:123",
            displayName: "grilled chicken bowl",
            consumedGrams: 350,
            servingQuantity: 350,
            servingUnit: "grams",
            calories: 640,
            proteinGrams: 42,
            carbohydrateGrams: 70,
            fatGrams: 20,
            fiberGrams: 8,
            sugarGrams: 6,
            sodiumMilligrams: 520,
            sourceProvider: "usda",
            sourceExternalId: "123",
            sourceVersion: "Foundation",
            sourceReference: "USDA fixture",
            nutrientSnapshotJson: {
              nutrientsPer100g: {
                caloriesKcal: 183,
                proteinGrams: 12,
                carbohydrateGrams: 20,
                fatGrams: 5.7,
              },
            },
            confidence: {
              identity: "verified",
              portion: "verified",
              nutritionRecord: "high",
              explanation: "Selected food record and entered grams.",
            },
            userConfirmed: true,
            preparationMethod: null,
            addedOilGrams: 0,
            notes: "Manual entry.",
            createdAt: "2026-07-09T12:00:00Z",
            updatedAt: "2026-07-09T12:00:00Z",
          },
        ],
      },
    ],
  };
}

function goal(): NutritionGoal {
  return {
    id: "goal_1",
    startsOn: "2026-07-09",
    caloriesKcal: 2200,
    proteinGrams: 140,
    carbohydrateGrams: 240,
    fatGrams: 70,
    fiberGrams: 28,
    sodiumMilligrams: 2300,
    createdAt: "2026-07-09T12:00:00Z",
    updatedAt: "2026-07-09T12:00:00Z",
  };
}

function renderWithQueryClient(element: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });

  return render(
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
  );
}
