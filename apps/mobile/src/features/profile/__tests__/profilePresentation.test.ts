import type { WeightEntry } from "@living-nutrition/shared-types";

import {
  buildWeightTrendSummary,
  buildWeightGoalInsight,
  buildUserDataExportSummary,
  correctionReportSourceSummary,
  correctionReportTypeLabel,
  convertProfileMeasurementInputs,
  formatWeight,
  normalizeRetentionDaysInput,
  retentionPreferenceSummary,
  sortWeightEntriesAscending,
  weightDisplayValue,
  weightInputValue,
} from "../profilePresentation";

describe("profile weight presentation", () => {
  it("formats weight in the selected unit system", () => {
    expect(formatWeight(80000, "metric")).toBe("80 kg");
    expect(formatWeight(80000, "us")).toBe("176.4 lb");
    expect(Math.round(weightDisplayValue(45359.237, "us") * 10) / 10).toBe(100);
  });

  it("formats weight edit input values in the selected unit system", () => {
    expect(weightInputValue(80000, "metric")).toBe("80");
    expect(weightInputValue(80000, "us")).toBe("176.4");
  });

  it("converts profile height and weight inputs from US to metric", () => {
    expect(
      convertProfileMeasurementInputs(
        {
          heightFeet: "5",
          heightInches: "9",
          weightLb: "176",
          heightCm: "",
          weightKg: "",
        },
        "us",
        "metric"
      )
    ).toEqual({
      heightFeet: "5",
      heightInches: "9",
      weightLb: "176",
      heightCm: "175",
      weightKg: "79.8",
    });
  });

  it("converts profile height and weight inputs from metric to US", () => {
    expect(
      convertProfileMeasurementInputs(
        {
          heightFeet: "",
          heightInches: "",
          weightLb: "",
          heightCm: "183",
          weightKg: "80",
        },
        "metric",
        "us"
      )
    ).toEqual({
      heightFeet: "6",
      heightInches: "0",
      weightLb: "176.4",
      heightCm: "183",
      weightKg: "80",
    });
  });

  it("sorts weight entries chronologically", () => {
    const sorted = sortWeightEntriesAscending([
      weightEntry("entry_2", "2026-07-08", 79500),
      weightEntry("entry_1", "2026-07-01", 80000),
      weightEntry("entry_3", "2026-07-05", 79800),
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual(["entry_1", "entry_3", "entry_2"]);
  });

  it("summarizes weight trend in the selected unit", () => {
    const entries = [
      weightEntry("entry_2", "2026-07-08", 79500),
      weightEntry("entry_1", "2026-07-01", 80000),
    ];

    expect(buildWeightTrendSummary(entries, "metric")).toBe(
      "Weight is down 0.5 kg across 2 entries."
    );
    expect(buildWeightTrendSummary(entries, "us")).toBe(
      "Weight is down 1.1 lb across 2 entries."
    );
  });

  it("prompts for another entry when no trend can be drawn", () => {
    expect(buildWeightTrendSummary([weightEntry("entry_1", "2026-07-01", 80000)], "us")).toBe(
      "Add another weight entry to see a trend."
    );
  });

  it("connects weight trends to the selected goal direction", () => {
    const downTrend = [
      weightEntry("entry_1", "2026-07-01", 80000),
      weightEntry("entry_2", "2026-07-08", 79500),
    ];
    const upTrend = [
      weightEntry("entry_1", "2026-07-01", 79500),
      weightEntry("entry_2", "2026-07-08", 80000),
    ];
    const stableTrend = [
      weightEntry("entry_1", "2026-07-01", 80000),
      weightEntry("entry_2", "2026-07-08", 80100),
    ];

    expect(buildWeightGoalInsight(downTrend, "metric", "cut").tone).toBe("success");
    expect(buildWeightGoalInsight(upTrend, "metric", "cut").tone).toBe("warning");
    expect(buildWeightGoalInsight(upTrend, "metric", "gain").tone).toBe("success");
    expect(buildWeightGoalInsight(stableTrend, "metric", "maintain").tone).toBe("success");
  });

  it("asks for more weight entries before giving goal-trend feedback", () => {
    expect(buildWeightGoalInsight([weightEntry("entry_1", "2026-07-01", 80000)], "us", "cut")).toEqual({
      title: "Goal trend needs more data",
      body: "Log at least two weight entries to compare your trend with your selected goal direction.",
      tone: "neutral",
    });
  });

  it("summarizes user data export counts", () => {
    expect(
      buildUserDataExportSummary({
        generatedAt: "2026-07-08T12:00:00Z",
        user: {
          id: "user_1",
          email: "luis@example.com",
          displayName: "Luis",
          token: null,
          authScheme: "local-token",
        },
        preferences: {
          id: "prefs_1",
          locale: "en-US",
          unitSystem: "us",
          dayStartTime: "00:00",
          timezone: "UTC",
          imageRetentionDays: 30,
          createdAt: "2026-07-08T12:00:00Z",
          updatedAt: "2026-07-08T12:00:00Z",
        },
        goals: [],
        weightEntries: [weightEntry("entry_1", "2026-07-01", 80000)],
        meals: [],
        favoriteFoods: [food("food_1", "Banana")],
        recentFoods: [food("food_2", "Rice")],
        customFoods: [],
      })
    ).toBe("0 meals\n1 weight entries\n0 goals\n1 favorites\n1 recent foods\n0 custom foods");
  });

  it("normalizes image retention preference input", () => {
    expect(normalizeRetentionDaysInput("30")).toBe(30);
    expect(normalizeRetentionDaysInput("30.6")).toBe(31);
    expect(normalizeRetentionDaysInput("-2")).toBe(0);
    expect(normalizeRetentionDaysInput("400")).toBe(365);
    expect(normalizeRetentionDaysInput("later")).toBeUndefined();
  });

  it("summarizes image retention preference copy", () => {
    expect(retentionPreferenceSummary(0)).toBe(
      "Meal images should be deleted as soon as retention enforcement is available."
    );
    expect(retentionPreferenceSummary(1)).toBe(
      "Meal images should be retained for 1 day when retention enforcement is available."
    );
    expect(retentionPreferenceSummary(30)).toBe(
      "Meal images should be retained for 30 days when retention enforcement is available."
    );
  });

  it("formats source correction report labels and source summaries", () => {
    expect(correctionReportTypeLabel("wrong_nutrients")).toBe("Wrong nutrients");
    expect(correctionReportTypeLabel("serving_conflict")).toBe("serving conflict");
    expect(
      correctionReportSourceSummary({
        id: "report_1",
        foodSourceRecordId: "food_1",
        reportType: "wrong_nutrients",
        message: "Calories look too high.",
        status: "open",
        createdAt: "2026-07-08T12:00:00Z",
        sourceDisplayName: "Bananas, raw",
        sourceProvider: "usda",
        sourceExternalId: "173944",
        sourceReference: "https://fdc.example/173944",
      })
    ).toBe("USDA FoodData Central · 173944");
  });
});

function weightEntry(id: string, loggedOn: string, weightGrams: number): WeightEntry {
  return {
    id,
    loggedOn,
    weightGrams,
    notes: null,
    createdAt: `${loggedOn}T12:00:00.000Z`,
  };
}

function food(id: string, displayName: string) {
  return {
    id,
    displayName,
    provider: "usda" as const,
    externalId: id,
    dataType: "Foundation",
    brandOwner: null,
    nutrientsPer100g: {
      caloriesKcal: 100,
      proteinGrams: 1,
      carbohydrateGrams: 20,
      fatGrams: 0,
    },
    recordConfidence: "high" as const,
    sourceReference: "fixture",
  };
}
