import { gramsForPortion, type PortionMode } from "../food-logging/foodLogging";

export type ParsedNaturalEntry = {
  id: string;
  query: string;
  amount: string;
  portionMode: Extract<PortionMode, "grams" | "ounces">;
  grams: number;
  enteredLabel: string;
};

export type NaturalEntryParseResult =
  | { ok: true; items: ParsedNaturalEntry[] }
  | { ok: false; message: string };

const explicitWeightPattern = /^(\d+(?:[.,]\d+)?)\s*(g|gram|grams|oz|ounce|ounces)\s+(.+)$/i;

export function parseNaturalEntry(value: string): NaturalEntryParseResult {
  const segments = value
    .split(/[;\n]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (!segments.length) {
    return {
      ok: false,
      message: "Enter at least one item with an explicit gram or ounce weight.",
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
    const match = explicitWeightPattern.exec(segment);
    if (!match) {
      return {
        ok: false,
        message: `“${segment}” needs an explicit weight, for example “150 g grilled chicken” or “2 oz rice.”`,
      };
    }

    const amount = match[1].replace(",", ".");
    const unit = match[2].toLowerCase();
    const query = match[3].trim().replace(/[.,;]+$/, "");
    const portionMode: ParsedNaturalEntry["portionMode"] = unit.startsWith("o") ? "ounces" : "grams";
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
      enteredLabel:
        portionMode === "ounces" ? `${amount} oz` : `${amount} g`,
    });
  }

  return { ok: true, items };
}
