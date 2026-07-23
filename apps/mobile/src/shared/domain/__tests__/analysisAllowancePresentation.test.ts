import { presentAnalysisAllowance } from "../analysisAllowancePresentation";

const availableMealAllowance = {
  remainingOperations: 4,
  operationLimit: 20,
  remainingImages: 9,
  imageLimit: 40,
  remainingConcurrent: 1,
  concurrencyLimit: 1,
  available: true,
  nextAvailabilityAt: null,
};

describe("presentAnalysisAllowance", () => {
  it("explains meal and multi-angle capacity without calling the result exact", () => {
    const presentation = presentAnalysisAllowance(availableMealAllowance, "meal", 30);

    expect(presentation.tone).toBe("neutral");
    expect(presentation.body).toContain("4 meal photo analyses available");
    expect(presentation.body).toContain("9 photo credits remain");
    expect(presentation.body).toContain("review every result before saving");
  });

  it("distinguishes a concurrent analysis from an exhausted allowance", () => {
    const busy = presentAnalysisAllowance(
      { ...availableMealAllowance, available: false, remainingConcurrent: 0 },
      "meal",
      30
    );
    const exhausted = presentAnalysisAllowance(
      { ...availableMealAllowance, available: false, remainingOperations: 0, remainingConcurrent: 1 },
      "label",
      30
    );

    expect(busy.title).toBe("Analysis in progress");
    expect(exhausted.title).toBe("Analysis allowance used");
    expect(exhausted.body).toContain("Manual logging remains available");
  });

  it("does not suggest a paid tier is required for an unlimited internal allowance", () => {
    const presentation = presentAnalysisAllowance(
      {
        ...availableMealAllowance,
        remainingOperations: null,
        operationLimit: null,
        remainingImages: null,
        imageLimit: null,
      },
      "label",
      30
    );

    expect(presentation.tone).toBe("success");
    expect(presentation.body).toContain("no current nutrition-label analysis limit");
  });
});
