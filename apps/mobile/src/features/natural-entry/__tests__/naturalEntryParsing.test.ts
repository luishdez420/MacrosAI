import { gramsForNaturalEntry, parseNaturalEntry } from "../naturalEntryParsing";

describe("natural entry parsing", () => {
  it("parses explicit gram and ounce items separated by semicolons", () => {
    const result = parseNaturalEntry("150 g grilled chicken; 2 oz cooked rice");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.items).toMatchObject([
      { query: "grilled chicken", amount: "150", portionMode: "grams", grams: 150 },
      { query: "cooked rice", amount: "2", portionMode: "ounces" },
    ]);
    expect(result.items[1]?.grams).toBeCloseTo(56.69904625, 8);
  });

  it("parses simple counts but waits for a selected source serving gram weight", () => {
    const result = parseNaturalEntry("two scrambled eggs; half avocado");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.items).toMatchObject([
      { query: "scrambled eggs", amount: "2", portionMode: "servings" },
      { query: "avocado", amount: "0.5", portionMode: "servings" },
    ]);
    expect(gramsForNaturalEntry(result.items[0]!, 50)).toBe(100);
    expect(gramsForNaturalEntry(result.items[1]!, undefined)).toBe(0);
  });

  it("rejects volumes without a verified food-specific mass mapping", () => {
    const result = parseNaturalEntry("one cup cooked rice");

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.message).toContain("volume measure");
    }
  });
});
