import * as SecureStore from "expo-secure-store";

import {
  defaultOnboardingPreferences,
  dietaryPreferences,
  goalPreferences,
  loggingPreferences,
  type OnboardingPreferences,
} from "./onboardingPreferences";
import { nutritionGoalUpdateSchema } from "@living-nutrition/shared-types";

const onboardingKey = "living-nutrition.onboarding.v1.complete";
const onboardingPreferencesKey = "living-nutrition.onboarding.v1.preferences";

export async function hasCompletedOnboarding() {
  try {
    return (await SecureStore.getItemAsync(onboardingKey)) === "true";
  } catch {
    // An unavailable keychain must never keep someone out of their diary.
    return true;
  }
}

export async function getOnboardingPreferences(): Promise<OnboardingPreferences | undefined> {
  try {
    const storedValue = await SecureStore.getItemAsync(onboardingPreferencesKey);

    if (!storedValue) {
      return undefined;
    }

    const parsedValue: unknown = JSON.parse(storedValue);

    return normalizeOnboardingPreferences(parsedValue);
  } catch {
    return undefined;
  }
}

export async function completeOnboarding(
  preferences: OnboardingPreferences = defaultOnboardingPreferences
) {
  try {
    await SecureStore.setItemAsync(onboardingKey, "true");
  } catch {
    // Continue to Today if secure storage is unavailable in a development preview.
  }

  try {
    await SecureStore.setItemAsync(onboardingPreferencesKey, JSON.stringify(preferences));
  } catch {
    // Completion should never be blocked when optional local preferences cannot be saved.
  }
}

function normalizeOnboardingPreferences(value: unknown): OnboardingPreferences | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Partial<OnboardingPreferences>;
  const loggingPreference = candidate.loggingPreference;
  const goalPreference = candidate.goalPreference;

  if (
    typeof loggingPreference !== "string" ||
    !loggingPreferences.includes(loggingPreference as OnboardingPreferences["loggingPreference"]) ||
    typeof goalPreference !== "string" ||
    !goalPreferences.includes(goalPreference as OnboardingPreferences["goalPreference"])
  ) {
    return undefined;
  }

  return {
    loggingPreference: loggingPreference as OnboardingPreferences["loggingPreference"],
    goalPreference: goalPreference as OnboardingPreferences["goalPreference"],
    dietaryPreferences: Array.isArray(candidate.dietaryPreferences)
      ? candidate.dietaryPreferences.filter((item): item is OnboardingPreferences["dietaryPreferences"][number] =>
          typeof item === "string" && dietaryPreferences.includes(item as OnboardingPreferences["dietaryPreferences"][number])
        )
      : defaultOnboardingPreferences.dietaryPreferences,
    initialNutritionGoal: normalizeInitialNutritionGoal(candidate.initialNutritionGoal),
  };
}

function normalizeInitialNutritionGoal(value: unknown) {
  const parsed = nutritionGoalUpdateSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
