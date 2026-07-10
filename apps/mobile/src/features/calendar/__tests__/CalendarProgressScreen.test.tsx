import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { CalendarProgressScreen } from "../CalendarProgressScreen";

const mockGetWeeklyInsights = jest.fn();
const mockGetMonthlyInsights = jest.fn();

jest.mock("../../../services/api", () => ({
  api: {
    getWeeklyInsights: (...args: unknown[]) => mockGetWeeklyInsights(...args),
    getMonthlyInsights: (...args: unknown[]) => mockGetMonthlyInsights(...args),
  },
}));

describe("CalendarProgressScreen", () => {
  beforeEach(() => {
    mockGetWeeklyInsights.mockReset();
    mockGetMonthlyInsights.mockReset();
  });

  it("renders a goal-based line graph and day-level goal status from backend insights", async () => {
    mockGetWeeklyInsights.mockResolvedValue({
      startDate: "2026-07-02",
      endDate: "2026-07-08",
      calorieTarget: 2200,
      goalDays: 2,
      averageCalories: 1915,
      days: [
        insightDay("2026-07-02", 0, 0, false),
        insightDay("2026-07-03", 2150, 118, true),
        insightDay("2026-07-04", 2410, 104, false),
        insightDay("2026-07-05", 1970, 96, true),
        insightDay("2026-07-06", 0, 0, false),
        insightDay("2026-07-07", 1880, 84, false),
        insightDay("2026-07-08", 1995, 101, false),
      ],
    });
    mockGetMonthlyInsights.mockResolvedValue({
      month: "2026-07",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      calorieTarget: 2200,
      loggedDays: 5,
      goalDays: 2,
      averageCalories: 1915,
      days: [
        insightDay("2026-07-01", 0, 0, false),
        insightDay("2026-07-02", 0, 0, false),
        insightDay("2026-07-03", 2150, 118, true),
      ],
    });

    const view = await renderWithQueryClient(<CalendarProgressScreen />);

    await waitFor(() => {
      expect(view.getByText("2 goal days")).toBeTruthy();
      expect(view.getByText("2/7")).toBeTruthy();
    });

    expect(view.getByLabelText("Seven day calorie line chart compared with saved calorie goal.")).toBeTruthy();
    expect(view.getAllByText("1915").length).toBeGreaterThanOrEqual(1);
    expect(view.getByText("Goal line")).toBeTruthy();
    expect(view.getByText("Above goal")).toBeTruthy();
    expect(view.getAllByText("Goal met")).toHaveLength(2);
    expect(view.getAllByText("Review").length).toBeGreaterThan(0);
    expect(view.getAllByText("No log").length).toBeGreaterThan(0);
  });
});

function insightDay(date: string, calories: number, proteinGrams: number, goalMet: boolean) {
  return {
    date,
    totals: {
      calories,
      proteinGrams,
      carbohydrateGrams: 0,
      fatGrams: 0,
      fiberGrams: 0,
      sugarGrams: 0,
      sodiumMilligrams: 0,
    },
    mealCount: calories > 0 ? 2 : 0,
    goalMet,
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
