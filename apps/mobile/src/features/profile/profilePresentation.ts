import type { FoodCorrectionReportSummary, UserDataExport, WeightEntry } from "@living-nutrition/shared-types";

export type MeasurementSystem = "us" | "metric";
export type WeightGoalDirection = "maintain" | "cut" | "gain";

export type ProfileMeasurementInputs = {
  heightFeet: string;
  heightInches: string;
  weightLb: string;
  heightCm: string;
  weightKg: string;
};

export type WeightGoalInsight = {
  title: string;
  body: string;
  tone: "neutral" | "success" | "warning";
};

export function weightDisplayValue(weightGrams: number, measurementSystem: MeasurementSystem) {
  if (measurementSystem === "us") {
    return weightGrams / 453.59237;
  }

  return weightGrams / 1000;
}

export function formatWeight(weightGrams: number, measurementSystem: MeasurementSystem) {
  const value = weightDisplayValue(weightGrams, measurementSystem);
  const unit = measurementSystem === "us" ? "lb" : "kg";
  return `${Math.round(value * 10) / 10} ${unit}`;
}

export function weightInputValue(weightGrams: number, measurementSystem: MeasurementSystem) {
  const value = weightDisplayValue(weightGrams, measurementSystem);
  return String(Math.round(value * 10) / 10);
}

export function convertProfileMeasurementInputs(
  inputs: ProfileMeasurementInputs,
  from: MeasurementSystem,
  to: MeasurementSystem
): ProfileMeasurementInputs {
  if (from === to) {
    return inputs;
  }

  if (from === "us") {
    const feet = parseMeasurementInput(inputs.heightFeet);
    const inches = parseMeasurementInput(inputs.heightInches);
    const pounds = parseMeasurementInput(inputs.weightLb);
    const totalInches = feet * 12 + inches;

    return {
      ...inputs,
      heightCm: String(Math.round(totalInches * 2.54)),
      weightKg: formatOneDecimal(pounds * 0.45359237),
    };
  }

  const centimeters = parseMeasurementInput(inputs.heightCm);
  const kilograms = parseMeasurementInput(inputs.weightKg);
  const totalInches = centimeters / 2.54;
  const feet = Math.floor(totalInches / 12);
  const roundedInches = Math.round(totalInches - feet * 12);
  const normalizedFeet = roundedInches === 12 ? feet + 1 : feet;
  const normalizedInches = roundedInches === 12 ? 0 : roundedInches;

  return {
    ...inputs,
    heightFeet: String(normalizedFeet),
    heightInches: String(normalizedInches),
    weightLb: formatOneDecimal(kilograms / 0.45359237),
  };
}

export function sortWeightEntriesAscending(entries: WeightEntry[]) {
  return [...entries].sort((left, right) => {
    const dateCompare = left.loggedOn.localeCompare(right.loggedOn);

    if (dateCompare !== 0) {
      return dateCompare;
    }

    return left.createdAt.localeCompare(right.createdAt);
  });
}

export function buildWeightTrendSummary(
  entries: WeightEntry[],
  measurementSystem: MeasurementSystem
) {
  const sortedEntries = sortWeightEntriesAscending(entries);

  if (sortedEntries.length < 2) {
    return "Add another weight entry to see a trend.";
  }

  const first = sortedEntries[0];
  const last = sortedEntries[sortedEntries.length - 1];
  const delta = weightDisplayValue(last.weightGrams - first.weightGrams, measurementSystem);
  const unit = measurementSystem === "us" ? "lb" : "kg";
  const roundedDelta = Math.round(Math.abs(delta) * 10) / 10;
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "stable";

  if (direction === "stable") {
    return `Weight is stable across ${sortedEntries.length} entries.`;
  }

  return `Weight is ${direction} ${roundedDelta} ${unit} across ${sortedEntries.length} entries.`;
}

export function buildWeightGoalInsight(
  entries: WeightEntry[],
  measurementSystem: MeasurementSystem,
  direction: WeightGoalDirection
): WeightGoalInsight {
  const sortedEntries = sortWeightEntriesAscending(entries);

  if (sortedEntries.length < 2) {
    return {
      title: "Goal trend needs more data",
      body: "Log at least two weight entries to compare your trend with your selected goal direction.",
      tone: "neutral",
    };
  }

  const first = sortedEntries[0];
  const last = sortedEntries[sortedEntries.length - 1];
  const delta = weightDisplayValue(last.weightGrams - first.weightGrams, measurementSystem);
  const unit = measurementSystem === "us" ? "lb" : "kg";
  const threshold = measurementSystem === "us" ? 0.5 : 0.2;
  const roundedDelta = Math.round(Math.abs(delta) * 10) / 10;
  const trend =
    Math.abs(delta) <= threshold ? "stable" : delta > threshold ? "up" : "down";

  if (direction === "maintain") {
    if (trend === "stable") {
      return {
        title: "Weight trend aligns with maintain",
        body: `Your trend is stable across ${sortedEntries.length} entries, which fits a maintenance goal.`,
        tone: "success",
      };
    }

    return {
      title: "Review maintenance trend",
      body: `Weight is ${trend} ${roundedDelta} ${unit}. If maintenance is still your goal, consider reviewing your calorie target and logged portions.`,
      tone: "warning",
    };
  }

  if (direction === "cut") {
    if (trend === "down") {
      return {
        title: "Weight trend aligns with cut",
        body: `Weight is down ${roundedDelta} ${unit} across ${sortedEntries.length} entries. Keep confirming portions so the trend stays useful.`,
        tone: "success",
      };
    }

    return {
      title: "Review cut progress",
      body:
        trend === "stable"
          ? "Weight is stable so far. If cutting is still your goal, review your calorie target, logged portions, and consistency."
          : `Weight is up ${roundedDelta} ${unit}. If cutting is still your goal, review your calorie target and recent logs.`,
      tone: "warning",
    };
  }

  if (trend === "up") {
    return {
      title: "Weight trend aligns with gain",
      body: `Weight is up ${roundedDelta} ${unit} across ${sortedEntries.length} entries. Keep logging portions consistently to track the trend.`,
      tone: "success",
    };
  }

  return {
    title: "Review gain progress",
    body:
      trend === "stable"
        ? "Weight is stable so far. If gaining is still your goal, review your calorie target, protein target, and meal consistency."
        : `Weight is down ${roundedDelta} ${unit}. If gaining is still your goal, review your calorie target and recent logs.`,
    tone: "warning",
  };
}

export function buildUserDataExportSummary(exportData: UserDataExport) {
  return [
    `${exportData.meals.length} meals`,
    `${exportData.weightEntries.length} weight entries`,
    `${exportData.goals.length} goals`,
    `${exportData.favoriteFoods.length} favorites`,
    `${exportData.recentFoods.length} recent foods`,
    `${exportData.customFoods.length} custom foods`,
  ].join("\n");
}

export function normalizeRetentionDaysInput(value: string) {
  const parsed = Number(value.replace(",", "."));

  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.min(Math.max(Math.round(parsed), 0), 365);
}

export function retentionPreferenceSummary(days: number) {
  if (days === 0) {
    return "Meal images should be deleted as soon as retention enforcement is available.";
  }

  if (days === 1) {
    return "Meal images should be retained for 1 day when retention enforcement is available.";
  }

  return `Meal images should be retained for ${days} days when retention enforcement is available.`;
}

export function correctionReportTypeLabel(value: string) {
  const labels: Record<string, string> = {
    wrong_food_match: "Wrong food match",
    wrong_nutrients: "Wrong nutrients",
    missing_serving: "Missing serving",
    other: "Other issue",
  };

  return labels[value] ?? value.replaceAll("_", " ");
}

export function correctionReportSourceSummary(report: FoodCorrectionReportSummary) {
  const provider = report.sourceProvider
    ? correctionReportProviderLabel(report.sourceProvider)
    : "Source no longer linked";
  return [provider, report.sourceExternalId].filter(Boolean).join(" · ");
}

function correctionReportProviderLabel(provider: string) {
  const labels: Record<string, string> = {
    usda: "USDA FoodData Central",
    open_food_facts: "Open Food Facts",
    commercial: "Commercial provider",
    user: "Custom food",
  };

  return labels[provider] ?? provider.replaceAll("_", " ");
}

function parseMeasurementInput(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatOneDecimal(value: number) {
  return String(Math.round(value * 10) / 10);
}
