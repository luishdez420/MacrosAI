import {
  gramsForPortion,
  portionAmountForGrams,
  portionInputLabel,
  portionLabel,
} from "../foodLogging";

describe("food logging portions", () => {
  it("converts ounces to grams before nutrition calculations", () => {
    expect(gramsForPortion("ounces", "2", 100)).toBeCloseTo(56.69904625, 8);
    expect(portionLabel("ounces", "2", 100)).toBe("2 oz (56.7g)");
  });

  it("preserves a portion approximately when switching between grams and ounces", () => {
    expect(portionAmountForGrams("ounces", 100, 100)).toBe("3.527");
    expect(gramsForPortion("ounces", portionAmountForGrams("ounces", 100, 100), 100)).toBeCloseTo(
      100,
      1
    );
  });

  it("keeps serving labels separate from weight labels", () => {
    expect(portionInputLabel("grams")).toBe("Weight in grams");
    expect(portionInputLabel("ounces")).toBe("Weight in ounces");
    expect(portionInputLabel("servings")).toBe("Number of servings");
  });

  it("refuses to infer grams for a serving without a verified gram weight", () => {
    expect(gramsForPortion("servings", "1", undefined)).toBe(0);
    expect(portionAmountForGrams("servings", 100, undefined)).toBe("");
    expect(portionLabel("servings", "1", undefined)).toBe(
      "1 serving (gram weight not verified)"
    );
  });
});
