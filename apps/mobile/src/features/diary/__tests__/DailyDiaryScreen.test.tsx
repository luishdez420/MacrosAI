import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { DiaryDay } from "@living-nutrition/shared-types";
import { ThemeProvider } from "../../../shared/theme/ThemeProvider";
import { DailyDiaryScreen } from "../DailyDiaryScreen";

const mockGetDiary = jest.fn();
const mockBack = jest.fn();
const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: ReactElement }) => children,
  useLocalSearchParams: () => ({ date: "2026-07-12" }),
  useRouter: () => ({ back: mockBack, push: mockPush }),
}));

jest.mock("../../../services/api", () => ({
  api: {
    getDiary: (...args: unknown[]) => mockGetDiary(...args),
  },
}));

describe("DailyDiaryScreen", () => {
  beforeEach(() => {
    mockGetDiary.mockReset();
    mockBack.mockReset();
    mockPush.mockReset();
  });

  it("shows source-backed meals and confirmed saved portions for the selected day", async () => {
    mockGetDiary.mockResolvedValue(diaryWithMeal());

    const view = await renderWithQueryClient(<DailyDiaryScreen />);

    await waitFor(() => expect(view.getByText("Lunch")).toBeTruthy());

    expect(mockGetDiary).toHaveBeenCalledWith("2026-07-12");
    expect(view.getByLabelText("610 calories logged")).toBeTruthy();
    expect(view.getByText("Chicken rice bowl")).toBeTruthy();
    expect(view.getByText("USDA matched")).toBeTruthy();
    expect(view.getByText("Confirmed")).toBeTruthy();
    expect(view.getByLabelText("Open Chicken rice bowl meal details").props.accessibilityHint).toContain(
      "source records"
    );
  });

  it("loads the previous day without changing the current diary route", async () => {
    mockGetDiary.mockResolvedValue(diaryWithMeal());

    const view = await renderWithQueryClient(<DailyDiaryScreen />);

    await waitFor(() => expect(mockGetDiary).toHaveBeenCalledWith("2026-07-12"));
    await act(async () => {
      fireEvent.press(view.getByLabelText("View previous diary day"));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => expect(mockGetDiary).toHaveBeenCalledWith("2026-07-11"));
  });

  it("uses a neutral empty state for a day without meals", async () => {
    mockGetDiary.mockResolvedValue(emptyDiary());

    const view = await renderWithQueryClient(<DailyDiaryScreen />);

    expect(await view.findByText("Nothing saved for this day")).toBeTruthy();
    expect(view.getByText(/reflect what you log, not to judge it/)).toBeTruthy();
  });

  it("shows a retryable error instead of treating a failed diary request as an empty day", async () => {
    mockGetDiary.mockRejectedValue(new Error("Network request failed"));

    const view = await renderWithQueryClient(<DailyDiaryScreen />);

    expect(await view.findByText("This diary day is unavailable")).toBeTruthy();
    expect(view.getByText(/Check your connection/)).toBeTruthy();
    // Daily Diary retries once in production. Let that retry settle inside
    // React's act boundary so it cannot update after this test has completed.
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 350));
    });
    expect(mockGetDiary).toHaveBeenCalledTimes(2);
  });
});

function diaryWithMeal(): DiaryDay {
  return {
    date: "2026-07-12",
    totals: {
      calories: 610,
      proteinGrams: 52,
      carbohydrateGrams: 63,
      fatGrams: 16,
      fiberGrams: 4,
      sugarGrams: 2,
      sodiumMilligrams: 340,
    },
    meals: [
      {
        id: "meal_1",
        name: "Chicken rice bowl",
        mealType: "lunch",
        loggedAt: "2026-07-12T12:30:00.000Z",
        notes: null,
        createdAt: "2026-07-12T12:30:00.000Z",
        updatedAt: "2026-07-12T12:30:00.000Z",
        items: [
          {
            id: "meal_item_1",
            foodId: "usda:173944",
            displayName: "Chicken breast, grilled",
            consumedGrams: 180,
            servingQuantity: 180,
            servingUnit: "grams",
            calories: 610,
            proteinGrams: 52,
            carbohydrateGrams: 63,
            fatGrams: 16,
            fiberGrams: 4,
            sugarGrams: 2,
            sodiumMilligrams: 340,
            sourceProvider: "usda",
            sourceExternalId: "173944",
            sourceVersion: "Foundation",
            sourceReference: "USDA fixture",
            nutrientSnapshotJson: { source: "fixture" },
            confidence: {
              identity: "verified",
              portion: "verified",
              nutritionRecord: "high",
              explanation: "Confirmed source and grams.",
            },
            userConfirmed: true,
            preparationMethod: "grilled",
            addedOilGrams: 0,
            notes: null,
            createdAt: "2026-07-12T12:30:00.000Z",
            updatedAt: "2026-07-12T12:30:00.000Z",
          },
        ],
      },
    ],
  };
}

function emptyDiary(): DiaryDay {
  return {
    date: "2026-07-12",
    totals: {
      calories: 0,
      proteinGrams: 0,
      carbohydrateGrams: 0,
      fatGrams: 0,
      fiberGrams: 0,
      sugarGrams: 0,
      sodiumMilligrams: 0,
    },
    meals: [],
  };
}

async function renderWithQueryClient(element: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });

  return await render(
    <ThemeProvider initialPreference="light">
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
