import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { ReactElement } from "react";

import { OnboardingScreen } from "../OnboardingScreen";

const mockReplace = jest.fn();
const mockSetItem = jest.fn();
const mockRequestPermission = jest.fn();
const mockUpdatePreferences = jest.fn();
const mockUpdateGoal = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock("expo-secure-store", () => ({
  setItemAsync: (...args: unknown[]) => mockSetItem(...args),
}));

jest.mock("expo-camera", () => ({
  useCameraPermissions: () => [{ granted: false }, mockRequestPermission],
}));

jest.mock("../../../services/api", () => ({
  api: {
    updatePreferences: (...args: unknown[]) => mockUpdatePreferences(...args),
    updateGoal: (...args: unknown[]) => mockUpdateGoal(...args),
  },
}));

describe("OnboardingScreen", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockSetItem.mockReset();
    mockRequestPermission.mockReset();
    mockUpdatePreferences.mockReset();
    mockUpdateGoal.mockReset();
    mockSetItem.mockResolvedValue(undefined);
    mockRequestPermission.mockResolvedValue(undefined);
    mockUpdatePreferences.mockResolvedValue(undefined);
    mockUpdateGoal.mockResolvedValue(undefined);
  });

  it("explains the editable estimate workflow and persists a skip", async () => {
    const view = await renderWithSafeArea(<OnboardingScreen />);

    expect(view.getByText("Understand your meals in seconds.")).toBeTruthy();
    expect(view.getByText(/Your meals stay editable after every scan/)).toBeTruthy();
    expect(view.getByTestId("onboarding-scroll").props.keyboardDismissMode).toBe("on-drag");
    expect(view.getByTestId("onboarding-scroll").props.keyboardShouldPersistTaps).toBe("handled");
    fireEvent.press(view.getByText("Skip"));

    await waitFor(() => {
      expect(mockSetItem).toHaveBeenCalledWith("living-nutrition.onboarding.v1.complete", "true");
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
  });

  it("persists the selected goal and conservative logging method", async () => {
    const view = await renderWithSafeArea(<OnboardingScreen />);

    fireEvent.press(view.getByText("Continue"));
    await waitFor(() => expect(view.getByText("AI estimates. You confirm.")).toBeTruthy());
    fireEvent.press(view.getByText("Continue"));
    await waitFor(() => expect(view.getByText("Track macros")).toBeTruthy());
    fireEvent.press(view.getByText("Track macros"));
    await waitFor(() => {
      expect(view.getByLabelText("Use Track macros as my nutrition direction").props.accessibilityState.selected).toBe(true);
    });
    fireEvent.press(view.getByText("Continue"));
    await waitFor(() => expect(view.getByText("Optional. Leave this blank to choose a target later in Profile.")).toBeTruthy());
    fireEvent.press(view.getByText("Continue"));
    await waitFor(() => expect(view.getByText("Select any that are helpful")).toBeTruthy());
    fireEvent.press(view.getByLabelText("Vegetarian"));
    await waitFor(() => {
      expect(view.getByLabelText("Vegetarian").props.accessibilityState.checked).toBe(true);
    });
    fireEvent.press(view.getByText("Continue"));
    await waitFor(() => expect(view.getByText("kitchen scale")).toBeTruthy());
    expect(
      view.getByLabelText("Enable camera access for future meal and barcode scans").props.accessibilityState.selected
    ).toBe(false);
    fireEvent.press(view.getByText("kitchen scale"));
    await waitFor(() => {
      expect(view.getByLabelText("Use kitchen scale as my usual logging method").props.accessibilityState.selected).toBe(true);
    });
    fireEvent.press(view.getByText("Start tracking"));

    await waitFor(() => {
      expect(mockSetItem).toHaveBeenCalledWith(
        "living-nutrition.onboarding.v1.preferences",
        JSON.stringify({
          goalPreference: "track_macros",
          loggingPreference: "kitchen_scale",
          dietaryPreferences: ["vegetarian"],
        })
      );
      expect(mockUpdatePreferences).toHaveBeenCalledWith({
        onboardingGoal: "track_macros",
        loggingPreference: "kitchen_scale",
        dietaryPreferences: ["vegetarian"],
        goalDirection: "maintain",
      });
      expect(mockReplace).toHaveBeenCalledWith("/");
      expect(mockUpdateGoal).not.toHaveBeenCalled();
    });
  });

  it("lets users go back to revise a previous onboarding choice before saving", async () => {
    const view = await renderWithSafeArea(<OnboardingScreen />);

    expect(view.queryByLabelText("Go back one onboarding step")).toBeNull();
    fireEvent.press(view.getByText("Continue"));
    await waitFor(() => expect(view.getByText("AI estimates. You confirm.")).toBeTruthy());
    fireEvent.press(view.getByLabelText("Go back one onboarding step"));

    await waitFor(() => {
      expect(view.getByText("Understand your meals in seconds.")).toBeTruthy();
      expect(view.queryByLabelText("Go back one onboarding step")).toBeNull();
    });
  });

  it("saves an explicitly accepted onboarding target locally and syncs it when available", async () => {
    const view = await renderWithSafeArea(<OnboardingScreen />);

    fireEvent.press(view.getByText("Continue"));
    await waitFor(() => expect(view.getByText("AI estimates. You confirm.")).toBeTruthy());
    fireEvent.press(view.getByText("Continue"));
    await waitFor(() => expect(view.getByText("Track macros")).toBeTruthy());
    fireEvent.press(view.getByText("Continue"));
    await waitFor(() => expect(view.getByLabelText("Height in centimeters for an estimated daily target")).toBeTruthy());
    await act(async () => {
      fireEvent.changeText(view.getByLabelText("Height in centimeters for an estimated daily target"), "175");
    });
    await act(async () => {
      fireEvent.changeText(view.getByLabelText("Weight in kilograms for an estimated daily target"), "80");
    });

    await waitFor(() => expect(view.getByText("Estimated daily target")).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByLabelText("Use this estimated daily target"));
    });
    await waitFor(() => {
      expect(view.getByLabelText("Use this estimated daily target").props.accessibilityState.checked).toBe(true);
    });
    fireEvent.press(view.getByText("Continue"));
    await waitFor(() => expect(view.getByText("Select any that are helpful")).toBeTruthy());
    fireEvent.press(view.getByText("Continue"));
    await waitFor(() => expect(view.getByText("Start tracking")).toBeTruthy());
    fireEvent.press(view.getByText("Start tracking"));

    await waitFor(() => {
      expect(mockUpdateGoal).toHaveBeenCalledWith(expect.objectContaining({
        caloriesKcal: expect.any(Number),
        proteinGrams: expect.any(Number),
        carbohydrateGrams: expect.any(Number),
        fatGrams: expect.any(Number),
        fiberGrams: 28,
        sodiumMilligrams: 2300,
      }));
      expect(mockSetItem).toHaveBeenCalledWith(
        "living-nutrition.onboarding.v1.preferences",
        expect.stringContaining("initialNutritionGoal")
      );
    });
  });
});

function renderWithSafeArea(element: ReactElement) {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      {element}
    </SafeAreaProvider>
  );
}
