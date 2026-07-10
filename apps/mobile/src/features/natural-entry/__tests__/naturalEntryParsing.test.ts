import { parseNaturalEntry } from "../naturalEntryParsing";

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

  it("rejects portions without an explicit safe mass", () => {
    const result = parseNaturalEntry("one cup cooked rice");

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.message).toContain("explicit weight");
    }
  });
});
