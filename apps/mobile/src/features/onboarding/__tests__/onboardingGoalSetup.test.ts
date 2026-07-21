import { createOnboardingGoalSetup } from "../onboardingGoalSetup";

describe("createOnboardingGoalSetup", () => {
  const baseInput = {
    heightCm: "175",
    weightKg: "80",
    bodyFatPercent: "",
    direction: "maintain" as const,
    startsOn: "2026-07-13",
  };

  it("creates an explicitly reviewable target using the disclosed default when body fat is omitted", () => {
    const result = createOnboardingGoalSetup(baseInput);

    expect(result).toMatchObject({
      ok: true,
      goal: {
        startsOn: "2026-07-13",
        fiberGrams: 28,
        sodiumMilligrams: 2300,
      },
    });
    expect(result.ok && result.explanation).toContain("20% body-fat default");
  });

  it("keeps body-fat assumptions explicit when an in-range value is provided", () => {
    const result = createOnboardingGoalSetup({ ...baseInput, bodyFatPercent: "18" });

    expect(result.ok && result.explanation).toContain("body-fat value you entered");
  });

  it("rejects incomplete or implausible measurements without producing a target", () => {
    expect(createOnboardingGoalSetup({ ...baseInput, weightKg: "" })).toEqual({
      ok: false,
      hasEnteredMeasurements: true,
    });
    expect(createOnboardingGoalSetup({ ...baseInput, heightCm: "90" })).toEqual({
      ok: false,
      hasEnteredMeasurements: true,
    });
  });
});
