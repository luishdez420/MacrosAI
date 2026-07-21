import type { MealCreate } from "@living-nutrition/shared-types";

/** Creates a unique screen-local scope for one confirmed logging flow. */
export function createMealActionScope(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Creates a stable, bounded key for one reviewed meal save action. */
export function mealCreateIdempotencyKey(actionScope: string, meal: MealCreate) {
  return actionIdempotencyKey(actionScope, {
    name: meal.name,
    notes: meal.notes,
    items: meal.items,
  });
}

/** Creates a stable, bounded key for a single retryable action and its payload. */
export function actionIdempotencyKey(actionScope: string, payload: object) {
  const fingerprint = JSON.stringify(payload);

  return `${actionScope}-${stableStringHash(fingerprint)}`.slice(0, 128);
}

function stableStringHash(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}
