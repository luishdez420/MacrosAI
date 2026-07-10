import { render } from "@testing-library/react-native";

import { NutrientTable, QualityFlagList, ServingBasisCard } from "../FoodDetailPanels";

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
});
