import type { NutrientPer100g } from "@living-nutrition/shared-types";

export function calculateConsumedNutrients(
  nutrientsPer100g: NutrientPer100g,
  consumedGrams: number
): NutrientPer100g {
  const scale = Math.max(consumedGrams, 0) / 100;

  return {
    caloriesKcal: nutrientsPer100g.caloriesKcal * scale,
    proteinGrams: nutrientsPer100g.proteinGrams * scale,
    carbohydrateGrams: nutrientsPer100g.carbohydrateGrams * scale,
    fatGrams: nutrientsPer100g.fatGrams * scale,
    fiberGrams: scaleOptional(nutrientsPer100g.fiberGrams, scale),
    sugarGrams: scaleOptional(nutrientsPer100g.sugarGrams, scale),
    sodiumMilligrams: scaleOptional(nutrientsPer100g.sodiumMilligrams, scale),
  };
}

export function roundNutrientsForDisplay(nutrients: NutrientPer100g): NutrientPer100g {
  return {
    caloriesKcal: roundNumber(nutrients.caloriesKcal),
    proteinGrams: roundNumber(nutrients.proteinGrams),
    carbohydrateGrams: roundNumber(nutrients.carbohydrateGrams),
    fatGrams: roundNumber(nutrients.fatGrams),
    fiberGrams: roundOptional(nutrients.fiberGrams),
    sugarGrams: roundOptional(nutrients.sugarGrams),
    sodiumMilligrams: roundOptional(nutrients.sodiumMilligrams),
  };
}

export function sumNutrients(items: NutrientPer100g[]): NutrientPer100g {
  return items.reduce<NutrientPer100g>(
    (total, item) => ({
      caloriesKcal: total.caloriesKcal + item.caloriesKcal,
      proteinGrams: total.proteinGrams + item.proteinGrams,
      carbohydrateGrams: total.carbohydrateGrams + item.carbohydrateGrams,
      fatGrams: total.fatGrams + item.fatGrams,
      fiberGrams: (total.fiberGrams ?? 0) + (item.fiberGrams ?? 0),
      sugarGrams: (total.sugarGrams ?? 0) + (item.sugarGrams ?? 0),
      sodiumMilligrams: (total.sodiumMilligrams ?? 0) + (item.sodiumMilligrams ?? 0),
    }),
    {
      caloriesKcal: 0,
      proteinGrams: 0,
      carbohydrateGrams: 0,
      fatGrams: 0,
      fiberGrams: 0,
      sugarGrams: 0,
      sodiumMilligrams: 0,
    }
  );
}

function scaleOptional(value: number | undefined, scale: number) {
  return value === undefined ? undefined : value * scale;
}

function roundOptional(value: number | undefined) {
  return value === undefined ? undefined : roundNumber(value);
}

function roundNumber(value: number) {
  return Math.round(value * 10) / 10;
}
