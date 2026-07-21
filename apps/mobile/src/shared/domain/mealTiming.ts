import type { MealType } from "@living-nutrition/shared-types";

/** Format and validate local meal times without treating a clock value as UTC. */
export function localDateKey(value = new Date()) {
  return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
}

export function localTimeKey(value = new Date()) {
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

export function combineLocalDateAndTime(dateKey: string, timeText: string): string | undefined {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim());
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(timeText.trim());

  if (!dateMatch || !timeMatch) {
    return undefined;
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const value = new Date(year, month - 1, day, hour, minute, 0, 0);

  if (
    month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 ||
    value.getFullYear() !== year || value.getMonth() !== month - 1 || value.getDate() !== day
  ) {
    return undefined;
  }

  return value.toISOString();
}

export function timeForLoggedAt(loggedAt: string) {
  const value = new Date(loggedAt);
  return Number.isNaN(value.getTime()) ? localTimeKey() : localTimeKey(value);
}

export function dateForLoggedAt(loggedAt: string) {
  const value = new Date(loggedAt);
  return Number.isNaN(value.getTime()) ? localDateKey() : localDateKey(value);
}

export function updateLoggedAtTime(loggedAt: string, timeText: string): string | undefined {
  const value = new Date(loggedAt);
  if (Number.isNaN(value.getTime())) {
    return undefined;
  }

  return combineLocalDateAndTime(localDateKey(value), timeText);
}

export function formatMealTime(loggedAt: string) {
  const value = new Date(loggedAt);
  if (Number.isNaN(value.getTime())) {
    return "Time unavailable";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

/**
 * Suggest a diary category from the user's entered local clock time. This is
 * only a starting point; callers must preserve an explicit user override.
 */
export function suggestMealTypeForTime(timeText: string): MealType | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeText.trim());
  if (!match) {
    return undefined;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    return undefined;
  }

  if (hour >= 5 && hour < 11) {
    return "breakfast";
  }
  if (hour >= 11 && hour < 16) {
    return "lunch";
  }
  if (hour >= 16 && hour < 21) {
    return "dinner";
  }
  return "snack";
}
