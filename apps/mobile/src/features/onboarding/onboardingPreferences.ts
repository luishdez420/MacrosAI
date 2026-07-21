import {
  dietaryPreferenceValues,
  loggingPreferenceValues,
  onboardingGoalValues,
  type DietaryPreference as SharedDietaryPreference,
  type LoggingPreference as SharedLoggingPreference,
  type OnboardingGoal,
} from "@living-nutrition/shared-types";
import type { NutritionGoalUpdate } from "@living-nutrition/shared-types";
import {
  goalDirectionForOnboardingGoal,
  dietaryPreferenceLabel,
  loggingPreferenceLabel,
  onboardingGoalLabel,
} from "../../shared/domain/onboardingPersonalization";

export const loggingPreferences = loggingPreferenceValues;

export type LoggingPreference = SharedLoggingPreference;

export const dietaryPreferences = dietaryPreferenceValues;

export type DietaryPreference = SharedDietaryPreference;

export const goalPreferences = onboardingGoalValues;

export type GoalPreference = OnboardingGoal;

export type OnboardingPreferences = {
  loggingPreference: LoggingPreference;
  goalPreference: GoalPreference;
  dietaryPreferences: DietaryPreference[];
  initialNutritionGoal?: NutritionGoalUpdate;
};

export const defaultOnboardingPreferences: OnboardingPreferences = {
  loggingPreference: "package_labels",
  goalPreference: "maintain_rhythm",
  dietaryPreferences: [],
};

export const goalPreferenceLabel = onboardingGoalLabel;
export { dietaryPreferenceLabel, loggingPreferenceLabel };
export const goalDirectionForPreference = goalDirectionForOnboardingGoal;
