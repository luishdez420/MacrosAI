import type { DietaryPreference, LoggingPreference, OnboardingGoal } from "@living-nutrition/shared-types";

export function onboardingGoalLabel(value: OnboardingGoal) {
  const labels: Record<OnboardingGoal, string> = {
    build_strength: "Build strength",
    maintain_rhythm: "Maintain your rhythm",
    improve_nutrition: "Improve nutrition",
    lose_gradually: "Lose gradually",
    support_performance: "Support performance",
    track_macros: "Track macros",
  };

  return labels[value];
}

export function loggingPreferenceLabel(value: LoggingPreference) {
  return value.replaceAll("_", " ");
}

export function dietaryPreferenceLabel(value: DietaryPreference) {
  const labels: Record<DietaryPreference, string> = {
    vegetarian: "Vegetarian",
    vegan: "Vegan",
    pescatarian: "Pescatarian",
    gluten_free: "Gluten-free",
    dairy_free: "Dairy-free",
  };

  return labels[value];
}

export function goalDirectionForOnboardingGoal(value: OnboardingGoal): "maintain" | "cut" | "gain" {
  if (value === "lose_gradually") {
    return "cut";
  }

  if (value === "build_strength" || value === "support_performance") {
    return "gain";
  }

  return "maintain";
}
