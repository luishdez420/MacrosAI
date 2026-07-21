import { gramsForPortion, type PortionMode } from "../food-logging/foodLogging";

export type ParsedNaturalEntry = {
  id: string;
  query: string;
  amount: string;
  portionMode: PortionMode;
  grams?: number;
  enteredLabel: string;
};

export type NaturalEntryParseResult =
  | { ok: true; items: ParsedNaturalEntry[] }
  | { ok: false; message: string };

const explicitWeightPattern = /^(\d+(?:[.,]\d+)?)\s*(g|gram|grams|oz|ounce|ounces)\s+(.+)$/i;
const sourceServingPattern = /^(\d+(?:[.,]\d+)?|one|two|three|four|five|six|half|quarter)\s+(?:(servings?)\s+)?(.+)$/i;
const quantityWords: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  half: 0.5,
  quarter: 0.25,
};
const unsupportedVolumePrefix = /^(cup|cups|tbsp|tablespoon|tablespoons|tsp|teaspoon|teaspoons|ml|milliliter|milliliters|fl\.?\s*oz)\b/i;

export function parseNaturalEntry(value: string): NaturalEntryParseResult {
  const segments = value
    .split(/[;\n]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (!segments.length) {
    return {
      ok: false,
      message: "Enter at least one food with grams, ounces, or a count to match to a verified source serving.",
    };
  }

  if (segments.length > 6) {
    return {
      ok: false,
      message: "Use up to six items at a time so each provider match can be reviewed.",
    };
  }

  const items: ParsedNaturalEntry[] = [];

  for (const [index, segment] of segments.entries()) {
    const weightMatch = explicitWeightPattern.exec(segment);
    if (weightMatch) {
      const amount = weightMatch[1].replace(",", ".");
      const unit = weightMatch[2].toLowerCase();
      const query = weightMatch[3].trim().replace(/[.,;]+$/, "");
      const portionMode: Extract<PortionMode, "grams" | "ounces"> = unit.startsWith("o")
        ? "ounces"
        : "grams";
      const grams = gramsForPortion(portionMode, amount, undefined);

      if (!query || grams <= 0) {
        return {
          ok: false,
          message: `“${segment}” could not be used. Add a food name after the explicit weight.`,
        };
      }

      items.push({
        id: `natural_${index + 1}`,
        query,
        amount,
        portionMode,
        grams,
        enteredLabel: portionMode === "ounces" ? `${amount} oz` : `${amount} g`,
      });
      continue;
    }

    const servingMatch = sourceServingPattern.exec(segment);
    if (!servingMatch) {
      return {
        ok: false,
        message: `“${segment}” needs grams, ounces, or a count such as “two eggs” that you can match to a verified source serving.`,
      };
    }

    const amountValue = parseServingAmount(servingMatch[1]);
    const amount = String(amountValue);
    const query = servingMatch[3].trim().replace(/[.,;]+$/, "");

    if (!query || amountValue <= 0) {
      return {
        ok: false,
        message: `“${segment}” could not be used. Add a food name after the quantity.`,
      };
    }

    if (unsupportedVolumePrefix.test(query)) {
      return {
        ok: false,
        message: `“${segment}” uses a volume measure. Use grams or ounces because volume cannot be safely converted without a verified food-specific mapping.`,
      };
    }

    items.push({
      id: `natural_${index + 1}`,
      query,
      amount,
      portionMode: "servings",
      enteredLabel: `${amount} ${amountValue === 1 ? "serving" : "servings"} from the selected source`,
    });
  }

  return { ok: true, items };
}

export function gramsForNaturalEntry(
  entry: ParsedNaturalEntry,
  servingGramWeight: number | undefined
) {
  return entry.grams ?? gramsForPortion(entry.portionMode, entry.amount, servingGramWeight);
}

function parseServingAmount(value: string) {
  const normalized = value.toLowerCase();
  return quantityWords[normalized] ?? Number(normalized.replace(",", "."));
}
