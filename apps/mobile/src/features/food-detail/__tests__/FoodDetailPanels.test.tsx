import { render } from "@testing-library/react-native";

import {
  NutrientTable,
  QualityAssessmentPanel,
  QualityFlagList,
  ServingBasisCard,
  SourceConflictPanel,
  SourceHistoryPanel,
} from "../FoodDetailPanels";

describe("food detail panels", () => {
  it("renders nutrients as per-100g rows with accessible labels", async () => {
    const view = await render(
      <NutrientTable
        nutrients={{
          caloriesKcal: 89,
          proteinGrams: 1.1,
          carbohydrateGrams: 22.8,
          fatGrams: 0.3,
          fiberGrams: 2.6,
          sugarGrams: 12.2,
          sodiumMilligrams: 1,
        }}
      />
    );

    expect(view.getByText("Nutrition per 100g")).toBeTruthy();
    expect(view.getByLabelText("Calories: 89 kcal per 100 grams")).toBeTruthy();
    expect(view.getByText("22.8 g")).toBeTruthy();
  });

  it("renders quality warnings with text, not color-only status", async () => {
    const view = await render(<QualityFlagList flags={["energy_macro_mismatch", "possible_kj_confusion"]} />);

    expect(view.getByText("Quality warnings")).toBeTruthy();
    expect(view.getByText("Calories do not match macros")).toBeTruthy();
    expect(view.getByText("Possible kJ/kcal confusion")).toBeTruthy();
  });

  it("explains when incomplete source data cannot be logged", async () => {
    const view = await render(
      <QualityAssessmentPanel
        assessment={{
          status: "insufficient_data",
          signals: ["provider_record", "incomplete_data", "validation_issue"],
          summary: "Essential per-100g nutrition is incomplete or invalid.",
          isBlocking: true,
        }}
      />
    );

    expect(view.getByText("Record quality")).toBeTruthy();
    expect(view.getByText("Insufficient data")).toBeTruthy();
    expect(view.getByText("Do not log")).toBeTruthy();
    expect(view.getByText(/provider record, incomplete per-100g data, validation issue/)).toBeTruthy();
  });

  it("shows whether servings have verified gram weights", async () => {
    const view = await render(
      <ServingBasisCard
        servingOptions={[
          {
            label: "Serving",
            quantity: 1,
            unit: "serving",
          },
          {
            label: "100 grams",
            quantity: 100,
            unit: "grams",
            grams: 100,
          },
        ]}
      />
    );

    expect(view.getByText("No verified gram weight for this serving.")).toBeTruthy();
    expect(view.getByText("100g verified gram weight")).toBeTruthy();
  });

  it("shows provider history without implying that saved meals changed", async () => {
    const view = await render(
      <SourceHistoryPanel
        history={[
          {
            displayName: "Protein drink",
            dataType: "packaged_food",
            brandOwner: "Example Foods",
            publicationDate: null,
            nutrientsPer100g: {
              caloriesKcal: 110,
              proteinGrams: 18,
              carbohydrateGrams: 8,
              fatGrams: 2,
            },
            qualityFlags: [],
            sourceReference: "https://example.test/product",
            sourceRetrievedAt: "2026-07-10T12:00:00.000Z",
          },
        ]}
      />
    );

    expect(view.getByText("Provider record changes")).toBeTruthy();
    expect(view.getByText(/never changes nutrition already saved/)).toBeTruthy();
    expect(view.getByLabelText(/Latest provider source snapshot/)).toBeTruthy();
  });

  it("distinguishes a current provider disagreement from historical evidence", async () => {
    const view = await render(
      <SourceConflictPanel
        conflicts={[
          {
            conflictingProvider: "open_food_facts",
            conflictingExternalId: "bar-2",
            conflictingDisplayName: "Protein bar",
            conflictType: "nutrition_substantial_difference",
            evidence: {},
            firstDetectedAt: "2026-07-10T12:00:00.000Z",
            lastDetectedAt: "2026-07-21T12:00:00.000Z",
            isCurrentConflict: true,
          },
          {
            conflictingProvider: "usda",
            conflictingExternalId: "bar-1",
            conflictingDisplayName: "Previous protein bar",
            conflictType: "nutrition_substantial_difference",
            evidence: {},
            firstDetectedAt: "2026-07-01T12:00:00.000Z",
            lastDetectedAt: "2026-07-05T12:00:00.000Z",
            isCurrentConflict: false,
          },
        ]}
      />
    );

    expect(view.getByText("Provider comparison history")).toBeTruthy();
    expect(view.getByText("Needs review")).toBeTruthy();
    expect(view.getByText("Historical")).toBeTruthy();
    expect(view.getByLabelText(/Current nutrition conflict with Open Food Facts/)).toBeTruthy();
  });
});
