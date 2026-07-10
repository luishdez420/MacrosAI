import { create } from "zustand";

type DraftPhoto = {
  uri: string;
  base64?: string | null;
  source: "camera" | "library";
};

type AnalysisDraftState = {
  draftPhoto?: DraftPhoto;
  setDraftPhoto: (photo: DraftPhoto) => void;
  clearDraft: () => void;
};

export const useAnalysisDraftStore = create<AnalysisDraftState>((set) => ({
  draftPhoto: undefined,
  setDraftPhoto: (photo) => set({ draftPhoto: photo }),
  clearDraft: () => set({ draftPhoto: undefined }),
}));
