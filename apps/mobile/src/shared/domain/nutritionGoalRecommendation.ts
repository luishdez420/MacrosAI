export type GoalDirection = "maintain" | "cut" | "gain";

type RecommendationInput = {
  heightCm: number;
  weightKg: number;
  bodyFatPercent?: number;
  direction: GoalDirection;
};

export type NutritionRecommendation = {
  caloriesKcal: number;
  proteinGrams: number;
  carbohydrateGrams: number;
  fatGrams: number;
  explanation: string;
};

/**
 * Provides a clearly labeled general-wellness starting point, not a medical prescription.
 * A missing body-fat estimate uses the disclosed 20% default rather than pretending it is known.
 */
export function calculateNutritionRecommendation({
  heightCm,
  weightKg,
  bodyFatPercent,
  direction,
}: RecommendationInput): NutritionRecommendation {
  const safeWeight = clamp(weightKg, 30, 250);
  const safeHeight = clamp(heightCm, 120, 230);
  const hasEnteredBodyFat = Number.isFinite(bodyFatPercent);
  const safeBodyFat = hasEnteredBodyFat ? clamp(bodyFatPercent ?? 20, 5, 60) : 20;
  const leanMassKg = safeWeight * (1 - safeBodyFat / 100);
  const bmr = 370 + 21.6 * leanMassKg;
  const activityMultiplier = 1.35;
  const maintenance = bmr * activityMultiplier + Math.max(0, safeHeight - 170) * 2;
  const adjustment = direction === "cut" ? -300 : direction === "gain" ? 250 : 0;
  const calories = Math.round(clamp(maintenance + adjustment, 1200, 4500));
  const protein = Math.round(clamp(leanMassKg * 2, 60, 260));
  const fat = Math.round(clamp(safeWeight * 0.8, 40, 140));
  const caloriesAfterProteinAndFat = calories - protein * 4 - fat * 9;
  const carbs = Math.max(0, Math.round(caloriesAfterProteinAndFat / 4));

  return {
    caloriesKcal: calories,
    proteinGrams: protein,
    carbohydrateGrams: carbs,
    fatGrams: fat,
    explanation: hasEnteredBodyFat
      ? "Estimated from the body-fat value you entered, a moderate activity default, and a conservative calorie adjustment. Review it as your routine or weight trend changes."
      : "Estimated with a disclosed 20% body-fat default, a moderate activity default, and a conservative calorie adjustment. Review it as your routine or weight trend changes.",
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) {
    return minimum;
  }

  return Math.min(Math.max(value, minimum), maximum);
}
