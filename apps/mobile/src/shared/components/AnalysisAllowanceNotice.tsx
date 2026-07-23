import { useEffect, useState } from "react";

import type { AiUsageSummary } from "@living-nutrition/shared-types";

import { api } from "../../services/api";
import { presentAnalysisAllowance, type AnalysisAllowanceKind } from "../domain/analysisAllowancePresentation";
import { InlineNotice } from "./LivingUI";

export function AnalysisAllowanceNotice({ kind }: { kind: AnalysisAllowanceKind }) {
  const [summary, setSummary] = useState<AiUsageSummary | null>(null);

  useEffect(() => {
    let active = true;
    // This is an advisory read. Keep camera and label capture operable in
    // lightweight preview/test shells and let the request-time guard decide.
    void Promise.resolve()
      .then(() => api.getAiUsageSummary())
      .then((value) => {
        if (active) setSummary(value);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  if (!summary) {
    // Availability checks are advisory. A transient read failure must not
    // prevent manual logging or change the authoritative request-time check.
    return null;
  }

  const capacity = kind === "meal" ? summary.mealAnalysis : summary.nutritionLabelAnalysis;
  const presentation = presentAnalysisAllowance(capacity, kind, summary.windowDays);
  return (
    <InlineNotice
      title={presentation.title}
      body={presentation.body}
      tone={presentation.tone}
      accessibilityLabel={`${presentation.title}. ${presentation.body}`}
    />
  );
}
