import {
  combineLocalDateAndTime,
  dateForLoggedAt,
  formatMealTime,
  localDateKey,
  localTimeKey,
  suggestMealTypeForTime,
  timeForLoggedAt,
  updateLoggedAtTime,
} from "../mealTiming";

describe("meal timing", () => {
  it("combines a validated local date and time without misreading the clock as UTC", () => {
    const expected = new Date(2026, 6, 12, 8, 5, 0, 0).toISOString();

    expect(combineLocalDateAndTime("2026-07-12", "08:05")).toBe(expected);
    expect(combineLocalDateAndTime("2026-07-12", "8:05")).toBe(expected);
  });

  it("rejects invalid dates and times", () => {
    expect(combineLocalDateAndTime("2026-02-30", "08:05")).toBeUndefined();
    expect(combineLocalDateAndTime("2026-07-12", "24:00")).toBeUndefined();
    expect(combineLocalDateAndTime("2026-07-12", "8pm")).toBeUndefined();
  });

  it("preserves the local meal date when changing only its time", () => {
    const original = new Date(2026, 6, 12, 12, 0, 0, 0).toISOString();
    const expected = new Date(2026, 6, 12, 18, 30, 0, 0).toISOString();

    expect(updateLoggedAtTime(original, "18:30")).toBe(expected);
    expect(dateForLoggedAt(expected)).toBe("2026-07-12");
    expect(timeForLoggedAt(expected)).toBe("18:30");
    expect(formatMealTime(expected)).not.toBe("Time unavailable");
  });

  it("formats local date and time keys with leading zeroes", () => {
    const value = new Date(2026, 0, 2, 3, 4, 0, 0);

    expect(localDateKey(value)).toBe("2026-01-02");
    expect(localTimeKey(value)).toBe("03:04");
  });

  it("suggests a neutral meal category from a valid local clock time", () => {
    expect(suggestMealTypeForTime("08:00")).toBe("breakfast");
    expect(suggestMealTypeForTime("11:00")).toBe("lunch");
    expect(suggestMealTypeForTime("18:30")).toBe("dinner");
    expect(suggestMealTypeForTime("22:15")).toBe("snack");
    expect(suggestMealTypeForTime("25:00")).toBeUndefined();
    expect(suggestMealTypeForTime("evening")).toBeUndefined();
  });
});
