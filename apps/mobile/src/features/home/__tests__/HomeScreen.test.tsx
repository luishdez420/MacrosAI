import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { DiaryDay, NutritionGoal, RangeInsights } from "@living-nutrition/shared-types";
import { formatMealTime } from "../../../shared/domain/mealTiming";
import {
  groupMealsByCategory,
  HomeScreen,
  loggingRhythmAccessibilityLabel,
  loggingRhythmCopy,
  timelineMealVisual,
  timelineSwipeDestination,
} from "../HomeScreen";

const mockGetDiary = jest.fn();
const mockGetGoal = jest.fn();
const mockGetRangeInsights = jest.fn();
const mockGetHydrationEntry = jest.fn();
const mockSaveHydrationEntry = jest.fn();
const mockDeleteHydrationEntry = jest.fn();
const mockDeleteMeal = jest.fn();
const mockCreateMeal = jest.fn();
const mockGetStoredUserId = jest.fn();
const mockQueuedMealCount = jest.fn();
const mockSyncQueuedMeals = jest.fn();
const mockSelectionAsync = jest.fn(() => Promise.resolve());
const mockImpactAsync = jest.fn((_style: unknown) => Promise.resolve());

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: unknown }) => children,
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("../../../services/api", () => ({
  api: {
    getDiary: (...args: unknown[]) => mockGetDiary(...args),
    getGoal: (...args: unknown[]) => mockGetGoal(...args),
    getRangeInsights: (...args: unknown[]) => mockGetRangeInsights(...args),
    getHydrationEntry: (...args: unknown[]) => mockGetHydrationEntry(...args),
    saveHydrationEntry: (...args: unknown[]) => mockSaveHydrationEntry(...args),
    deleteHydrationEntry: (...args: unknown[]) => mockDeleteHydrationEntry(...args),
    deleteMeal: (...args: unknown[]) => mockDeleteMeal(...args),
    createMeal: (...args: unknown[]) => mockCreateMeal(...args),
  },
  getStoredUserId: () => mockGetStoredUserId(),
}));

jest.mock("../../../services/offlineMealQueue", () => ({
  queuedMealCount: (...args: unknown[]) => mockQueuedMealCount(...args),
  syncQueuedMeals: (...args: unknown[]) => mockSyncQueuedMeals(...args),
}));

jest.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  selectionAsync: () => mockSelectionAsync(),
  impactAsync: (style: unknown) => mockImpactAsync(style),
}));

describe("HomeScreen", () => {
  beforeEach(() => {
    mockGetDiary.mockReset();
    mockGetGoal.mockReset();
    mockGetRangeInsights.mockReset();
    mockGetHydrationEntry.mockReset();
    mockSaveHydrationEntry.mockReset();
    mockDeleteHydrationEntry.mockReset();
    mockGetRangeInsights.mockResolvedValue(rangeInsights());
    mockGetHydrationEntry.mockResolvedValue(null);
    mockSaveHydrationEntry.mockResolvedValue({
      id: "hydration_1",
      loggedOn: "2026-07-09",
      milliliters: 250,
      createdAt: "2026-07-09T12:00:00Z",
    });
    mockDeleteMeal.mockReset();
    mockCreateMeal.mockReset();
    mockGetStoredUserId.mockReset();
    mockQueuedMealCount.mockReset();
    mockSyncQueuedMeals.mockReset();
    mockSelectionAsync.mockClear();
    mockImpactAsync.mockClear();
    mockGetStoredUserId.mockResolvedValue("user_1");
    mockQueuedMealCount.mockResolvedValue(0);
  });

  afterEach(async () => {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    cleanup();
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
    expect(view.getByText("Search food")).toBeTruthy();
    expect(view.getByText("Quick entry")).toBeTruthy();
    expect(view.getByText("Build meal")).toBeTruthy();
    expect(view.getByText("Barcode")).toBeTruthy();
    expect(view.getByLabelText("Scan a meal with the camera").props.accessibilityHint).toContain(
      "confirm every food and portion"
    );
    expect(view.getByLabelText("Search verified food records").props.accessibilityHint).toContain(
      "enter the amount eaten"
    );
    expect(view.getByLabelText("Log foods with quick entry").props.accessibilityHint).toContain(
      "explicit weights"
    );
    expect(view.getByLabelText("Build a multi-food meal").props.accessibilityHint).toContain(
      "confirm each portion"
    );
    expect(view.getByLabelText("Open saved recipes").props.accessibilityHint).toContain(
      "source-backed meals"
    );
    expect(view.getByLabelText("Scan a packaged-food barcode").props.accessibilityHint).toContain(
      "confirm the amount eaten"
    );
    expect(view.getByText("1560 remaining today")).toBeTruthy();
    expect(view.getByText("Confirmed")).toBeTruthy();
    expect(view.getAllByText("Lunch").length).toBeGreaterThanOrEqual(1);
    expect(view.getByText(formatMealTime("2026-07-09T12:00:00Z"))).toBeTruthy();
    expect(view.getAllByText("640 kcal").length).toBeGreaterThanOrEqual(1);
    expect(view.getByText("P 42g")).toBeTruthy();
    expect(view.getByText("C 70g")).toBeTruthy();
    expect(view.getByText("F 20g")).toBeTruthy();
    expect(view.getByText("1 food")).toBeTruthy();
    expect(view.getByText("Based on saved meal snapshots and confirmed portions.")).toBeTruthy();
    expect(view.getByText("Edit portions")).toBeTruthy();
    expect(view.getByText("Daily observation")).toBeTruthy();
    expect(view.getByText("Hydration")).toBeTruthy();
    expect(view.getByLabelText(/View nutrition detail for/)).toBeTruthy();
    expect(view.getByLabelText(/Open daily diary for/)).toBeTruthy();
    expect(view.getByLabelText("Water logged: 0 milliliters")).toBeTruthy();
    expect(view.getByText("Optional daily log")).toBeTruthy();
    expect(view.getByLabelText("Open notification settings")).toBeTruthy();
    expect(view.getByText("Lunch contributed the most fiber so far.")).toBeTruthy();
    expect(view.getByText("3 of 7 days logged")).toBeTruthy();
    expect(view.getByLabelText(loggingRhythmAccessibilityLabel(3, 7))).toBeTruthy();
  });

  it("shows confirmed meals waiting locally and syncs them explicitly", async () => {
    mockGetDiary.mockResolvedValue(todayDiary());
    mockGetGoal.mockResolvedValue(goal());
    mockQueuedMealCount.mockResolvedValue(1);
    mockSyncQueuedMeals.mockResolvedValue({ synced: 1, remaining: 0 });

    const view = await renderWithQueryClient(<HomeScreen />);

    await view.findByText("1 confirmed meal waiting to sync");
    expect(view.getByText(/saved only on this device until a sync succeeds/)).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText("Sync now"));
    });

    await waitFor(() => {
      expect(mockSyncQueuedMeals).toHaveBeenCalledWith("user_1", expect.any(Function));
      expect(view.getByText("1 queued meal synced to your diary.")).toBeTruthy();
    });
  });

  it("adds water as an optional persisted daily total", async () => {
    mockGetDiary.mockResolvedValue(todayDiary());
    mockGetGoal.mockResolvedValue(goal());

    const view = await renderWithQueryClient(<HomeScreen />);
    await view.findByLabelText("Add 250 milliliters of water");

    await act(async () => {
      fireEvent.press(view.getByLabelText("Add 250 milliliters of water"));
    });

    await waitFor(() => {
      expect(mockSaveHydrationEntry).toHaveBeenCalledWith(expect.any(String), { milliliters: 250 });
    });
  });

  it("lets a user enter an exact hydration total without presenting a target", async () => {
    mockGetDiary.mockResolvedValue(todayDiary());
    mockGetGoal.mockResolvedValue(goal());

    const view = await renderWithQueryClient(<HomeScreen />);
    await view.findByLabelText("Adjust hydration total");
    fireEvent.press(view.getByLabelText("Adjust hydration total"));
    await view.findByLabelText("Hydration total in milliliters");
    const hydrationInput = view.getByLabelText("Hydration total in milliliters");
    fireEvent.changeText(hydrationInput, "900");
    await waitFor(() => {
      expect(hydrationInput.props.value).toBe("900");
    });

    await act(async () => {
      fireEvent.press(view.getByLabelText("Save hydration total"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockSaveHydrationEntry).toHaveBeenCalledWith(expect.any(String), { milliliters: 900 });
    });
    expect(view.getByText(/not a medical recommendation/)).toBeTruthy();
  });

  it("groups persisted meals in a predictable meal-category order", () => {
    const baseMeal = todayDiary().meals[0];
    const groups = groupMealsByCategory([
      { ...baseMeal, id: "other", mealType: "meal" },
      { ...baseMeal, id: "snack", mealType: "snack" },
      { ...baseMeal, id: "breakfast", mealType: "breakfast" },
      { ...baseMeal, id: "dinner", mealType: "dinner" },
      { ...baseMeal, id: "lunch", mealType: "lunch" },
    ]);

    expect(groups.map((group) => group.label)).toEqual([
      "Breakfast",
      "Lunch",
      "Dinner",
      "Snacks",
      "Other meals",
    ]);
  });

  it("describes seven-day coverage without framing it as a streak or nutrition score", () => {
    expect(loggingRhythmCopy(3, 7)).toBe("3 of 7 days logged");
    expect(loggingRhythmCopy(0, 7)).toBe("Your rhythm starts with one meal.");
    expect(loggingRhythmAccessibilityLabel(3, 7)).toContain("not a nutrition grade");
  });

  it("only reveals timeline actions after a deliberate horizontal swipe", () => {
    expect(timelineSwipeDestination(24)).toBeNull();
    expect(timelineSwipeDestination(56)).toBe("edit");
    expect(timelineSwipeDestination(-56)).toBe("delete");
    expect(timelineSwipeDestination(12, 0.7)).toBe("edit");
    expect(timelineSwipeDestination(-12, -0.7)).toBe("delete");
  });

  it("uses a semantic category placeholder instead of claiming every meal has a photo", () => {
    expect(timelineMealVisual("breakfast")).toMatchObject({ label: "Breakfast", icon: "sunny-outline" });
    expect(timelineMealVisual("lunch")).toMatchObject({ label: "Lunch", icon: "leaf-outline" });
    expect(timelineMealVisual("dinner")).toMatchObject({ label: "Dinner", icon: "moon-outline" });
    expect(timelineMealVisual("snack")).toMatchObject({ label: "Snack", icon: "cafe-outline" });
    expect(timelineMealVisual(undefined)).toMatchObject({ label: "Meal", icon: "restaurant-outline" });
  });

  it("expands a timeline meal into saved food and portion context", async () => {
    mockGetDiary.mockResolvedValue(todayDiary());
    mockGetGoal.mockResolvedValue(goal());

    const view = await renderWithQueryClient(<HomeScreen />);
    const reveal = await view.findByLabelText("Show 1 food in grilled chicken bowl");

    fireEvent.press(reveal);

    await waitFor(() => {
      expect(view.getByText("Hide foods")).toBeTruthy();
      expect(view.getByText("350g • 640 kcal • 42g protein")).toBeTruthy();
      expect(view.getByLabelText("Hide 1 food in grilled chicken bowl")).toBeTruthy();
    });
  });

  it("explains a selected macro with saved-snapshot and adjustable-target language", async () => {
    mockGetDiary.mockResolvedValue(todayDiary());
    mockGetGoal.mockResolvedValue(goal());
    const view = await renderWithQueryClient(<HomeScreen />);

    await view.findByText("grilled chicken bowl");
    await act(async () => {
      fireEvent.press(view.getByLabelText("Protein: 42 of 140 grams"));
    });

    expect(view.getByText("Protein progress")).toBeTruthy();
    expect(view.getByText("42g is logged from saved meal snapshots. About 98g remains for this adjustable daily target.")).toBeTruthy();
  });

  it("uses a structural loading state instead of presenting zero nutrition values", async () => {
    mockGetDiary.mockImplementation(() => new Promise<DiaryDay>(() => undefined));
    mockGetGoal.mockResolvedValue(goal());

    const view = await renderWithQueryClient(<HomeScreen />);

    expect(view.getByLabelText("Loading daily nutrition summary")).toBeTruthy();
    expect(view.getByLabelText("Loading daily macro totals")).toBeTruthy();
    expect(view.getByLabelText("Loading meal timeline")).toBeTruthy();
    expect(view.queryByText("Nothing logged yet")).toBeNull();
    expect(view.queryByText("0 / 2200 kcal")).toBeNull();
  });

  it("shows a recovery state instead of treating a failed diary request as an empty day", async () => {
    mockGetDiary.mockRejectedValue(new Error("Network request failed"));
    mockGetGoal.mockResolvedValue(goal());

    const view = await renderWithQueryClient(<HomeScreen />);

    await waitFor(() => {
      expect(view.getByText("Your daily summary is unavailable")).toBeTruthy();
    });
    expect(view.queryByText("Nothing logged yet")).toBeNull();

    mockGetDiary.mockResolvedValue(todayDiary());
    await act(async () => {
      fireEvent.press(view.getAllByText("Try again")[0]!);
    });

    await waitFor(() => {
      expect(view.getByText("grilled chicken bowl")).toBeTruthy();
    });
  });
});

function rangeInsights(): RangeInsights {
  return {
    startDate: "2026-07-03",
    endDate: "2026-07-09",
    durationDays: 7,
    calorieTarget: 2200,
    loggedDays: 3,
    goalDays: 1,
    averageCalories: 640,
    averageProteinGrams: 42,
    averageFiberGrams: 8,
    weightComparison: {
      status: "insufficient_data",
      trend: "unavailable",
      entryCount: 0,
      firstLoggedOn: null,
      lastLoggedOn: null,
      observationDays: 0,
      changeGrams: null,
      goalDirectionContext: "unavailable",
      goalDirections: [],
      goalRevisionCount: 0,
    },
    days: [],
  };
}

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
        revision: 1,
        name: "grilled chicken bowl",
        mealType: "lunch",
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
