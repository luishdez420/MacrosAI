import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { themePalettes, type ThemePreference } from "@living-nutrition/design-tokens";
import { ThemeProvider } from "../../../shared/theme/ThemeProvider";
import { CalendarProgressScreen } from "../CalendarProgressScreen";

const mockGetRangeInsights = jest.fn();
const mockGetMonthlyInsights = jest.fn();
const mockGetPreferences = jest.fn();

jest.mock("../../../services/api", () => ({
  api: {
    getRangeInsights: (...args: unknown[]) => mockGetRangeInsights(...args),
    getMonthlyInsights: (...args: unknown[]) => mockGetMonthlyInsights(...args),
    getPreferences: (...args: unknown[]) => mockGetPreferences(...args),
  },
}));

describe("CalendarProgressScreen", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mockGetRangeInsights.mockReset();
    mockGetMonthlyInsights.mockReset();
    mockGetPreferences.mockReset();
    mockGetRangeInsights.mockResolvedValue(rangeInsights());
    mockGetMonthlyInsights.mockResolvedValue(monthlyInsights());
    mockGetPreferences.mockResolvedValue({ unitSystem: "metric", goalDirection: "maintain" });
  });

  it("renders a goal-based line graph and latest-day observation from saved meal insights", async () => {
    mockGetRangeInsights.mockResolvedValue(
      rangeInsights({
        days: [
        insightDay("2026-07-02", 0, 0, false),
        insightDay("2026-07-03", 2150, 118, true),
        insightDay("2026-07-04", 2410, 104, false),
        insightDay("2026-07-05", 1970, 96, true),
        insightDay("2026-07-06", 0, 0, false),
        insightDay("2026-07-07", 1880, 84, false),
        insightDay("2026-07-08", 1995, 101, false),
        ],
      })
    );
    mockGetMonthlyInsights.mockResolvedValue(monthlyInsights());

    const view = await renderWithQueryClient(<CalendarProgressScreen />);

    await waitFor(() => {
      expect(view.getByText("2 goal days in 7")).toBeTruthy();
      expect(view.getByText("2/7")).toBeTruthy();
    });

    expect(view.getByLabelText("7 day calorie line chart compared with saved calorie goal.")).toBeTruthy();
    expect(view.getAllByText("1915").length).toBeGreaterThanOrEqual(1);
    expect(view.getByText("Goal line")).toBeTruthy();
    expect(view.getByText("Above goal")).toBeTruthy();
    expect(view.queryByText("Goal met")).toBeNull();
    expect(view.getByText("Review")).toBeTruthy();
    expect(view.getByText("Avg protein")).toBeTruthy();
    expect(view.getByText("Weight rhythm")).toBeTruthy();
    expect(view.queryByText("Daily check-ins")).toBeNull();
    expect(StyleSheet.flatten(view.getByTestId("monthly-rhythm-metrics").props.style)).toMatchObject({
      marginBottom: 12,
    });
    expect(view.getByLabelText("Show next month").props.accessibilityState.disabled).toBe(true);

    expect(view.getByText(/1995 kcal and 101g protein were logged/)).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByLabelText("Show previous month"));
    });

    await waitFor(() => expect(mockGetMonthlyInsights).toHaveBeenCalledTimes(2));
    expect(mockGetMonthlyInsights.mock.calls[1]?.[0]).not.toBe(
      mockGetMonthlyInsights.mock.calls[0]?.[0]
    );
  });

  it("loads a longer selected range from the range endpoint", async () => {
    mockGetRangeInsights
      .mockResolvedValueOnce(rangeInsights())
      .mockResolvedValueOnce(
        rangeInsights({
          startDate: "2026-06-01",
          endDate: "2026-06-30",
          durationDays: 30,
          loggedDays: 3,
          goalDays: 2,
          averageCalories: 1860,
          averageProteinGrams: 112,
          averageFiberGrams: 24,
          days: Array.from({ length: 30 }, (_, index) =>
            insightDay(`2026-06-${String(index + 1).padStart(2, "0")}`, index === 0 ? 1900 : 0, index === 0 ? 112 : 0, index === 0)
          ),
        })
      );

    const view = await renderWithQueryClient(<CalendarProgressScreen />);
    await waitFor(() => expect(mockGetRangeInsights).toHaveBeenCalledTimes(1));

    await act(async () => {
      fireEvent.press(view.getByLabelText("Show 30 days of progress"));
    });

    await waitFor(() => {
      expect(mockGetRangeInsights).toHaveBeenCalledTimes(2);
      expect(view.getByText("2/30")).toBeTruthy();
      expect(view.getByLabelText("30 day calorie line chart compared with saved calorie goal.")).toBeTruthy();
      expect(view.getByText("112g")).toBeTruthy();
    });
  });

  it("summarizes meal, protein, and fiber logging coverage from saved day totals", async () => {
    mockGetRangeInsights.mockResolvedValue(
      rangeInsights({
        loggedDays: 3,
        days: [
          insightDay("2026-07-02", 2100, 110, true, 20),
          insightDay("2026-07-03", 1850, 0, false, 8),
          insightDay("2026-07-04", 1900, 95, true, 0),
          insightDay("2026-07-05", 0, 0, false),
          insightDay("2026-07-06", 0, 0, false),
          insightDay("2026-07-07", 0, 0, false),
          insightDay("2026-07-08", 0, 0, false),
        ],
      })
    );

    const view = await renderWithQueryClient(<CalendarProgressScreen />);

    await waitFor(() => {
      expect(view.getByText("Logging rhythm")).toBeTruthy();
      expect(view.getByText("Meals were logged on 3 of 7 selected days; protein appeared on 2 and fiber appeared on 2 of those days.")).toBeTruthy();
    });

    expect(view.getByText("Meal days")).toBeTruthy();
    expect(view.getByText("Protein days")).toBeTruthy();
    expect(view.getByText("Fiber days")).toBeTruthy();
    expect(view.getAllByText("2").length).toBeGreaterThanOrEqual(2);
    expect(view.getByLabelText(/This is a diary pattern, not a nutrition grade/)).toBeTruthy();
  });

  it("does not request an invalid custom date range", async () => {
    const view = await renderWithQueryClient(<CalendarProgressScreen />);
    await waitFor(() => expect(mockGetRangeInsights).toHaveBeenCalledTimes(1));

    await act(async () => {
      fireEvent.press(view.getByLabelText("Choose a custom progress date range"));
    });
    const startDateInput = await view.findByLabelText(
      "Custom range start date in year month day format"
    );
    await act(async () => {
      fireEvent.changeText(startDateInput, "invalid-date");
    });

    await waitFor(() => {
      expect(view.getByText("Review custom range")).toBeTruthy();
      expect(mockGetRangeInsights).toHaveBeenCalledTimes(1);
    });
  });

  it("shows the server-calculated weight evidence and historical goal context", async () => {
    mockGetRangeInsights.mockResolvedValue(
      rangeInsights({
        weightComparison: {
          status: "observed",
          trend: "down",
          entryCount: 3,
          firstLoggedOn: "2026-07-02",
          lastLoggedOn: "2026-07-08",
          observationDays: 6,
          changeGrams: -2000,
          goalDirectionContext: "changed",
          goalDirections: ["cut", "gain"],
          goalRevisionCount: 2,
        },
      })
    );

    const view = await renderWithQueryClient(<CalendarProgressScreen />);

    await waitFor(() => {
      expect(view.getByText("Weight is down 2 kg across 3 check-ins.")).toBeTruthy();
      expect(view.getByText(/from Jul 2 to Jul 8 \(6 days\)/)).toBeTruthy();
      expect(view.getByText(/Goal direction changed during this period \(cut to gain\)/)).toBeTruthy();
    });
  });

  it("explains when a selected period has insufficient weight data", async () => {
    mockGetRangeInsights.mockResolvedValue(
      rangeInsights({
        weightComparison: {
          status: "insufficient_data",
          trend: "unavailable",
          entryCount: 1,
          firstLoggedOn: null,
          lastLoggedOn: null,
          observationDays: 0,
          changeGrams: null,
          goalDirectionContext: "unavailable",
          goalDirections: [],
          goalRevisionCount: 0,
        },
      })
    );

    const view = await renderWithQueryClient(<CalendarProgressScreen />);

    await waitFor(() => {
      expect(view.getByText("More check-ins are needed for a comparison.")).toBeTruthy();
      expect(view.getByText(/This period has one check-in/)).toBeTruthy();
      expect(view.getByText(/Goal direction was not stored for this historical period/)).toBeTruthy();
    });
  });

  it("uses semantic dark-theme colors for range selection and custom-date inputs", async () => {
    const view = await renderWithQueryClient(<CalendarProgressScreen />, "dark");
    await view.findByText("Calories vs goal");

    await act(async () => {
      fireEvent.press(view.getByLabelText("Choose a custom progress date range"));
    });

    expect(
      StyleSheet.flatten(view.getByLabelText("Choose a custom progress date range").props.style)?.borderColor
    ).toBe(themePalettes.dark.highlight);
    expect(
      view.getByLabelText("Custom range start date in year month day format").props.placeholderTextColor
    ).toBe(themePalettes.dark.muted);
    expect(
      StyleSheet.flatten(view.getByLabelText("Custom range end date in year month day format").props.style)?.borderColor
    ).toBe(themePalettes.dark.border);
  });
});

function rangeInsights(
  overrides: Partial<{
    startDate: string;
    endDate: string;
    durationDays: number;
    calorieTarget: number;
    loggedDays: number;
    goalDays: number;
    averageCalories: number;
    averageProteinGrams: number;
    averageFiberGrams: number;
    weightComparison: {
      status: "insufficient_data" | "limited" | "observed";
      trend: "up" | "down" | "steady" | "unavailable";
      entryCount: number;
      firstLoggedOn: string | null;
      lastLoggedOn: string | null;
      observationDays: number;
      changeGrams: number | null;
      goalDirectionContext: "consistent" | "changed" | "unavailable";
      goalDirections: Array<"maintain" | "cut" | "gain">;
      goalRevisionCount: number;
    };
    days: ReturnType<typeof insightDay>[];
  }> = {}
) {
  return {
    startDate: "2026-07-02",
    endDate: "2026-07-08",
    durationDays: 7,
    calorieTarget: 2200,
    loggedDays: 5,
    goalDays: 2,
    averageCalories: 1915,
    averageProteinGrams: 101,
    averageFiberGrams: 18,
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
    days: [
      insightDay("2026-07-02", 0, 0, false),
      insightDay("2026-07-03", 2150, 118, true),
      insightDay("2026-07-04", 2410, 104, false),
      insightDay("2026-07-05", 1970, 96, true),
      insightDay("2026-07-06", 0, 0, false),
      insightDay("2026-07-07", 1880, 84, false),
      insightDay("2026-07-08", 1995, 101, false),
    ],
    ...overrides,
  };
}

function monthlyInsights() {
  return {
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
  };
}

function insightDay(date: string, calories: number, proteinGrams: number, goalMet: boolean, fiberGrams = 0) {
  return {
    date,
    calorieTarget: 2200,
    totals: {
      calories,
      proteinGrams,
      carbohydrateGrams: 0,
      fatGrams: 0,
      fiberGrams,
      sugarGrams: 0,
      sodiumMilligrams: 0,
    },
    mealCount: calories > 0 ? 2 : 0,
    goalMet,
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
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <ThemeProvider initialPreference={themePreference}>
        <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
