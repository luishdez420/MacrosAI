import { create } from "zustand";

export type DraftPhoto = {
  uri: string;
  base64?: string | null;
  source: "camera" | "library";
};

type AnalysisDraftState = {
  draftPhoto?: DraftPhoto;
  /** The first photo remains the preview image; up to three views support a clearer scan. */
  draftPhotos: DraftPhoto[];
  /** Optional visual scale cue supplied by the user, never a substitute for gram confirmation. */
  referencePlateDiameterMm?: number;
  setDraftPhoto: (photo: DraftPhoto) => void;
  setDraftPhotos: (photos: DraftPhoto[]) => void;
  setReferencePlateDiameterMm: (diameterMm?: number) => void;
  clearDraft: () => void;
};

export const useAnalysisDraftStore = create<AnalysisDraftState>((set) => ({
  draftPhoto: undefined,
  draftPhotos: [],
  referencePlateDiameterMm: undefined,
  setDraftPhoto: (photo) => set({ draftPhoto: photo, draftPhotos: [photo] }),
  setDraftPhotos: (photos) => {
    const boundedPhotos = photos.slice(0, 3);
    set({
      draftPhoto: boundedPhotos[0],
      draftPhotos: boundedPhotos,
    });
  },
  setReferencePlateDiameterMm: (referencePlateDiameterMm) => set({ referencePlateDiameterMm }),
  clearDraft: () => set({ draftPhoto: undefined, draftPhotos: [], referencePlateDiameterMm: undefined }),
}));
