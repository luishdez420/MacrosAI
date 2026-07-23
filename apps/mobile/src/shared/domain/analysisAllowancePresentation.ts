import type { AiUsageAllowance } from "@living-nutrition/shared-types";

export type AnalysisAllowanceKind = "meal" | "label";

export type AnalysisAllowancePresentation = {
  title: string;
  body: string;
  tone: "neutral" | "warning" | "success";
};

/**
 * Keep quota copy factual: rolling allowances can replenish at different
 * times, and a camera review always remains an editable estimate.
 */
export function presentAnalysisAllowance(
  allowance: AiUsageAllowance,
  kind: AnalysisAllowanceKind,
  windowDays: number
): AnalysisAllowancePresentation {
  const label = kind === "meal" ? "meal photo" : "nutrition-label";

  if (!allowance.available) {
    if (allowance.remainingConcurrent !== null && allowance.remainingConcurrent < 1) {
      return {
        title: "Analysis in progress",
        body: `One ${label} analysis is already being prepared. Wait for it to finish before starting another. Manual logging remains available.`,
        tone: "warning",
      };
    }

    return {
      title: "Analysis allowance used",
      body: `There is no ${label} analysis capacity available right now. Allowances refresh gradually over ${windowDays} days. Manual logging remains available.`,
      tone: "warning",
    };
  }

  if (allowance.operationLimit === null) {
    return {
      title: "Analysis availability",
      body: `This account has no current ${label} analysis limit. You still review every food and portion before saving.`,
      tone: "success",
    };
  }

  const remainingOperations = allowance.remainingOperations ?? 0;
  const operationCopy = `${remainingOperations} ${label} ${pluralize(remainingOperations, "analysis")} available`;
  const imageCopy =
    kind === "meal" && allowance.remainingImages !== null
      ? ` ${allowance.remainingImages} photo ${pluralize(allowance.remainingImages, "credit")} remain; extra angles use one credit each.`
      : "";

  return {
    title: "Analysis availability",
    body: `${operationCopy} in your rolling ${windowDays}-day allowance.${imageCopy} You still review every result before saving.`,
    tone: "neutral",
  };
}

function pluralize(value: number, singular: string) {
  if (singular === "analysis") {
    return value === 1 ? singular : "analyses";
  }
  return value === 1 ? singular : `${singular}s`;
}
