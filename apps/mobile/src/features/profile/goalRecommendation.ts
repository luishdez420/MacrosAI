export type GoalDirection = "maintain" | "cut" | "gain";

type RecommendationInput = {
  heightCm: number;
  weightKg: number;
  bodyFatPercent: number;
  direction: GoalDirection;
};

export type NutritionRecommendation = {
  caloriesKcal: number;
  proteinGrams: number;
  carbohydrateGrams: number;
  fatGrams: number;
  explanation: string;
};

export function calculateNutritionRecommendation({
  heightCm,
  weightKg,
  bodyFatPercent,
  direction,
}: RecommendationInput): NutritionRecommendation {
  const safeWeight = clamp(weightKg, 30, 250);
  const safeHeight = clamp(heightCm, 120, 230);
  const safeBodyFat = clamp(bodyFatPercent, 5, 60);
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
    explanation:
      "Estimate based on lean mass using body-fat input, a moderate activity default, and a conservative calorie adjustment. Revisit weekly as weight trends change.",
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) {
    return minimum;
  }

  return Math.min(Math.max(value, minimum), maximum);
}
