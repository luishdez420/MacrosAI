import type { DraftPhoto } from "../../stores/analysisDraftStore";

export const maximumMealViews = 3;

export type MealCaptureAngle = "angled" | "top_down" | "side";

const captureAngleGuidance: Record<MealCaptureAngle, { label: string; instruction: string }> = {
  angled: {
    label: "Angled view",
    instruction: "Start at about 45 degrees with the whole plate visible.",
  },
  top_down: {
    label: "Top-down view",
    instruction: "Capture the whole plate from above to clarify separate foods.",
  },
  side: {
    label: "Side view",
    instruction: "Use a side view only when it helps show visible height or layers.",
  },
};

export function nextMealCaptureAngle(viewCount: number): MealCaptureAngle {
  if (viewCount <= 0) return "angled";
  if (viewCount === 1) return "top_down";
  return "side";
}

export function mealCaptureGuidance(viewCount: number) {
  return captureAngleGuidance[nextMealCaptureAngle(viewCount)];
}

export function appendMealView(views: DraftPhoto[], photo: DraftPhoto): DraftPhoto[] {
  if (views.length >= maximumMealViews) return views;
  return [...views, photo];
}

export function formatViewCount(count: number): string {
  return `${count} ${count === 1 ? "view" : "views"}`;
}
