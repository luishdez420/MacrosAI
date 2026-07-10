import { create } from "zustand";

import type { NutritionLabelAnalysis } from "@living-nutrition/shared-types";

type LabelDraft = {
  photoUri: string;
  analysis?: NutritionLabelAnalysis;
};

type LabelDraftState = {
  draft?: LabelDraft;
  setDraft: (draft: LabelDraft) => void;
  clearDraft: () => void;
};

export const useLabelDraftStore = create<LabelDraftState>((set) => ({
  draft: undefined,
  setDraft: (draft) => set({ draft }),
  clearDraft: () => set({ draft: undefined }),
}));
