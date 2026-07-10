import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import { useLabelDraftStore } from "../../../stores/labelDraftStore";
import { LabelScanScreen } from "../LabelScanScreen";

const mockTakePicture = jest.fn();
const mockAnalyzeNutritionLabel = jest.fn();
const mockPush = jest.fn();

jest.mock("expo-camera", () => {
  const React = require("react");
  const { View } = require("react-native");

  return {
    CameraView: React.forwardRef((_props: unknown, ref: unknown) => {
      React.useImperativeHandle(ref, () => ({ takePictureAsync: mockTakePicture }));
      return React.createElement(View, { testID: "mock-label-camera" });
    }),
    useCameraPermissions: () => [{ granted: true }, jest.fn()],
  };
});

jest.mock("expo-image-picker", () => ({
  MediaTypeOptions: { Images: "Images" },
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: unknown }) => children,
  useLocalSearchParams: () => ({ barcode: "0 12345-67890 5" }),
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("../../../services/api", () => ({
  api: {
    analyzeNutritionLabel: (...args: unknown[]) => mockAnalyzeNutritionLabel(...args),
  },
}));

describe("LabelScanScreen", () => {
  beforeEach(() => {
    mockTakePicture.mockReset();
    mockAnalyzeNutritionLabel.mockReset();
    mockPush.mockReset();
    useLabelDraftStore.getState().clearDraft();
  });

  it("extracts into a temporary review draft and never saves directly", async () => {
    mockTakePicture.mockResolvedValue({
      uri: "file:///nutrition-label.jpg",
      base64: "aGVsbG8gd29ybGQ=",
    });
    mockAnalyzeNutritionLabel.mockResolvedValue(labelAnalysis());
    const view = await render(<LabelScanScreen />);

    await act(async () => {
      fireEvent.press(view.getByLabelText("Capture nutrition label photo"));
    });
    await waitFor(() => expect(view.getByText("Extract values")).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByText("Extract values"));
    });

    await waitFor(() => {
      expect(mockAnalyzeNutritionLabel).toHaveBeenCalledWith({
        imageBase64: "aGVsbG8gd29ybGQ=",
        barcode: "012345678905",
      });
      expect(mockPush).toHaveBeenCalledWith(
        "/custom-food?labelCaptured=1&labelAnalyzed=1&barcode=012345678905"
      );
    });
    expect(useLabelDraftStore.getState().draft).toMatchObject({
      photoUri: "file:///nutrition-label.jpg",
      analysis: { displayName: "Oat bar", requiresConfirmation: true },
    });
  });

  it("keeps manual entry available when extraction fails", async () => {
    mockTakePicture.mockResolvedValue({
      uri: "file:///blurry-label.jpg",
      base64: "aGVsbG8gd29ybGQ=",
    });
    mockAnalyzeNutritionLabel.mockRejectedValue(new Error("The label could not be read reliably."));
    const view = await render(<LabelScanScreen />);

    await act(async () => {
      fireEvent.press(view.getByLabelText("Capture nutrition label photo"));
    });
    await act(async () => {
      fireEvent.press(view.getByText("Extract values"));
    });

    await waitFor(() => {
      expect(view.getByText("Label analysis needs attention")).toBeTruthy();
      expect(view.getByText("The label could not be read reliably.")).toBeTruthy();
      expect(view.getByText("Enter manually")).toBeTruthy();
    });
  });
});

function labelAnalysis() {
  return {
    displayName: "Oat bar",
    brandOwner: "Test Foods",
    barcode: "012345678905",
    servingSizeText: "1 bar (40 g)",
    servingSizeGrams: 40,
    nutritionBasis: "per_serving",
    labelNutrients: {
      caloriesKcal: 160,
      proteinGrams: 4,
      carbohydrateGrams: 24,
      fatGrams: 6,
      fiberGrams: 3,
      sugarGrams: 8,
      sodiumMilligrams: 120,
    },
    nutrientsPer100g: {
      caloriesKcal: 400,
      proteinGrams: 10,
      carbohydrateGrams: 60,
      fatGrams: 15,
      fiberGrams: 7.5,
      sugarGrams: 20,
      sodiumMilligrams: 300,
    },
    confidence: "high",
    qualityFlags: [],
    warnings: ["Compare every value with the original label."],
    requiresConfirmation: true,
  };
}
