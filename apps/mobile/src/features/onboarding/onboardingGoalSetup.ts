import type { NutritionGoalUpdate } from "@living-nutrition/shared-types";

import {
  calculateNutritionRecommendation,
  type GoalDirection,
} from "../../shared/domain/nutritionGoalRecommendation";

export type OnboardingGoalSetupInput = {
  heightCm: string;
  weightKg: string;
  bodyFatPercent: string;
  direction: GoalDirection;
  startsOn: string;
};

export type OnboardingGoalSetupResult =
  | { ok: false; hasEnteredMeasurements: boolean }
  | {
      ok: true;
      goal: NutritionGoalUpdate;
      explanation: string;
    };

export function createOnboardingGoalSetup(input: OnboardingGoalSetupInput): OnboardingGoalSetupResult {
  const heightCm = parseOptionalNumber(input.heightCm);
  const weightKg = parseOptionalNumber(input.weightKg);
  const bodyFatPercent = parseOptionalNumber(input.bodyFatPercent);
  const hasEnteredMeasurements = Boolean(input.heightCm.trim() || input.weightKg.trim() || input.bodyFatPercent.trim());

  if (!heightCm || !weightKg || heightCm < 120 || heightCm > 230 || weightKg < 30 || weightKg > 250) {
    return { ok: false, hasEnteredMeasurements };
  }

  if (bodyFatPercent !== undefined && (bodyFatPercent < 5 || bodyFatPercent > 60)) {
    return { ok: false, hasEnteredMeasurements };
  }

  const recommendation = calculateNutritionRecommendation({
    heightCm,
    weightKg,
    bodyFatPercent,
    direction: input.direction,
  });

  return {
    ok: true,
    goal: {
      startsOn: input.startsOn,
      caloriesKcal: recommendation.caloriesKcal,
      proteinGrams: recommendation.proteinGrams,
      carbohydrateGrams: recommendation.carbohydrateGrams,
      fatGrams: recommendation.fatGrams,
      fiberGrams: 28,
      sodiumMilligrams: 2300,
    },
    explanation: recommendation.explanation,
  };
}

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}
