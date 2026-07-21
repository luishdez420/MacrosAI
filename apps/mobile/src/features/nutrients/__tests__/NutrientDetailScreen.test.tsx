import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { themePalettes, type ThemePreference } from "@living-nutrition/design-tokens";
import type { DiaryDay, NutritionGoal } from "@living-nutrition/shared-types";
import { ThemeProvider } from "../../../shared/theme/ThemeProvider";
import { NutrientDetailScreen } from "../NutrientDetailScreen";

const mockGetDiary = jest.fn();
const mockGetGoal = jest.fn();
const mockBack = jest.fn();
let mockParams: { date?: string } = { date: "2026-07-13" };

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: unknown }) => children,
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
}));

jest.mock("../../../services/api", () => ({
  api: {
    getDiary: (...args: unknown[]) => mockGetDiary(...args),
    getGoal: (...args: unknown[]) => mockGetGoal(...args),
  },
}));

describe("NutrientDetailScreen", () => {
  beforeEach(() => {
    mockParams = { date: "2026-07-13" };
    mockGetDiary.mockReset();
    mockGetGoal.mockReset();
    mockBack.mockReset();
  });

  afterEach(cleanup);

  it("renders snapshot-backed nutrient totals, configured targets, and meal contributions", async () => {
    mockGetDiary.mockResolvedValue(diary());
    mockGetGoal.mockResolvedValue(goal());

    const view = await renderWithQueryClient(<NutrientDetailScreen />);

    await waitFor(() => expect(view.getByText("Daily nutrients")).toBeTruthy());

    expect(mockGetDiary).toHaveBeenCalledWith("2026-07-13");
    expect(view.getByLabelText("Protein: 42g. 140g daily target.")).toBeTruthy();
    expect(view.getByLabelText("Fiber: 8g. 28g daily target.")).toBeTruthy();
    expect(view.getByLabelText("Sugar: 6g. No daily target set.")).toBeTruthy();
    expect(view.getByText("Chicken bowl")).toBeTruthy();
    expect(view.getByText("Based on the portions and nutrition sources saved with your meals. Camera-assisted foods remain estimates unless you confirmed them.")).toBeTruthy();
  });

  it("uses an actionable empty state when no meals have been saved", async () => {
    mockGetDiary.mockResolvedValue({ ...diary(), meals: [] });
    mockGetGoal.mockResolvedValue(goal());

    const view = await renderWithQueryClient(<NutrientDetailScreen />);

    await waitFor(() => expect(view.getByText("No saved meals for this day")).toBeTruthy());
    expect(view.getByText("Search food")).toBeTruthy();
  });

  it("shows a retryable recovery state instead of an empty day when loading fails", async () => {
    mockGetDiary.mockRejectedValue(new Error("Network request failed"));
    mockGetGoal.mockResolvedValue(goal());

    const view = await renderWithQueryClient(<NutrientDetailScreen />);

    await waitFor(() => expect(view.getByText("Nutrition detail is unavailable")).toBeTruthy(), { timeout: 4000 });
    expect(view.queryByText("No saved meals for this day")).toBeNull();
  });

  it("keeps the saved-total emphasis readable in dark mode", async () => {
    mockGetDiary.mockResolvedValue(diary());
    mockGetGoal.mockResolvedValue(goal());

    const view = await renderWithQueryClient(<NutrientDetailScreen />, "dark");

    await waitFor(() => expect(view.getByText("Saved daily total")).toBeTruthy());
    expect(StyleSheet.flatten(view.getByText("Saved daily total").props.style).color).toBe(
      themePalettes.dark.actionText
    );
  });
});

function diary(): DiaryDay {
  return {
    date: "2026-07-13",
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
        name: "Chicken bowl",
        mealType: "lunch",
        loggedAt: "2026-07-13T12:00:00Z",
        notes: null,
        createdAt: "2026-07-13T12:00:00Z",
        updatedAt: "2026-07-13T12:00:00Z",
        items: [
          {
            id: "item_1",
            foodId: "usda:1",
            displayName: "Chicken bowl",
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
            sourceExternalId: "1",
            sourceVersion: "Foundation",
            sourceReference: "Fixture source",
            nutrientSnapshotJson: {},
            confidence: { identity: "verified", portion: "verified", nutritionRecord: "high", explanation: "Fixture" },
            userConfirmed: true,
            preparationMethod: null,
            addedOilGrams: 0,
            notes: null,
            createdAt: "2026-07-13T12:00:00Z",
            updatedAt: "2026-07-13T12:00:00Z",
          },
        ],
      },
    ],
  };
}

function goal(): NutritionGoal {
  return {
    id: "goal_1",
    startsOn: "2026-07-13",
    caloriesKcal: 2200,
    proteinGrams: 140,
    carbohydrateGrams: 240,
    fatGrams: 70,
    fiberGrams: 28,
    sodiumMilligrams: 2300,
    createdAt: "2026-07-13T12:00:00Z",
    updatedAt: "2026-07-13T12:00:00Z",
  };
}

async function renderWithQueryClient(element: ReactElement, themePreference: ThemePreference = "light") {
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
        <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
