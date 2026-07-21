import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";

import type { FoodSearchResult, MealAnalysisJob, MealAnalysisResult } from "@living-nutrition/shared-types";
import { themePalettes } from "@living-nutrition/design-tokens";
import { ApiClientError } from "@living-nutrition/api-client";
import { useAnalysisDraftStore } from "../../../stores/analysisDraftStore";
import {
  cameraReviewCues,
  confirmationThemeStyles,
  MealConfirmationScreen,
} from "../MealConfirmationScreen";

const mockHealthCheck = jest.fn();
const mockCreateMealAnalysisJob = jest.fn();
const mockGetMealAnalysisJob = jest.fn();
const mockCancelMealAnalysisJob = jest.fn();
const mockCreateMeal = jest.fn();
const mockCreateFoodCorrectionReport = jest.fn();
const mockSearchFoods = jest.fn();
const mockGetFavoriteFoods = jest.fn();
const mockGetRecentFoods = jest.fn();
const mockReplace = jest.fn();
const mockGetStoredUserId = jest.fn();
const mockQueueConfirmedMeal = jest.fn();
const mockNotificationAsync = jest.fn((_type: unknown) => Promise.resolve());
const mockImpactAsync = jest.fn((_style: unknown) => Promise.resolve());
const mockSelectionAsync = jest.fn(() => Promise.resolve());

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: unknown }) => children,
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock("../../../services/api", () => ({
  api: {
    healthCheck: (...args: unknown[]) => mockHealthCheck(...args),
    createMealAnalysisJob: (...args: unknown[]) => mockCreateMealAnalysisJob(...args),
    getMealAnalysisJob: (...args: unknown[]) => mockGetMealAnalysisJob(...args),
    cancelMealAnalysisJob: (...args: unknown[]) => mockCancelMealAnalysisJob(...args),
    createMeal: (...args: unknown[]) => mockCreateMeal(...args),
    createFoodCorrectionReport: (...args: unknown[]) => mockCreateFoodCorrectionReport(...args),
    searchFoods: (...args: unknown[]) => mockSearchFoods(...args),
    getFavoriteFoods: (...args: unknown[]) => mockGetFavoriteFoods(...args),
    getRecentFoods: (...args: unknown[]) => mockGetRecentFoods(...args),
  },
  getStoredUserId: () => mockGetStoredUserId(),
}));

jest.mock("../../../services/offlineMealQueue", () => ({
  queueConfirmedMeal: (...args: unknown[]) => mockQueueConfirmedMeal(...args),
}));

jest.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Success: "success" },
  impactAsync: (style: unknown) => mockImpactAsync(style),
  selectionAsync: () => mockSelectionAsync(),
  notificationAsync: (type: unknown) => mockNotificationAsync(type),
}));

describe("MealConfirmationScreen", () => {
  beforeEach(() => {
    mockHealthCheck.mockReset();
    mockCreateMealAnalysisJob.mockReset();
    mockGetMealAnalysisJob.mockReset();
    mockCancelMealAnalysisJob.mockReset();
    mockCreateMeal.mockReset();
    mockCreateFoodCorrectionReport.mockReset();
    mockSearchFoods.mockReset();
    mockGetFavoriteFoods.mockReset();
    mockGetRecentFoods.mockReset();
    mockReplace.mockReset();
    mockGetStoredUserId.mockReset();
    mockQueueConfirmedMeal.mockReset();
    mockNotificationAsync.mockClear();
    mockImpactAsync.mockClear();
    mockSelectionAsync.mockClear();
    mockHealthCheck.mockResolvedValue({ status: "ok" });
    mockCreateMealAnalysisJob.mockResolvedValue(queuedAnalysisJob());
    mockGetMealAnalysisJob.mockResolvedValue(completedAnalysisJob());
    mockCancelMealAnalysisJob.mockResolvedValue({ ...queuedAnalysisJob(), status: "cancelled" });
    mockCreateMeal.mockImplementation(() => new Promise(() => undefined));
    mockGetStoredUserId.mockResolvedValue(undefined);
    mockQueueConfirmedMeal.mockResolvedValue(undefined);
    mockGetFavoriteFoods.mockResolvedValue({ items: [] });
    mockGetRecentFoods.mockResolvedValue({ items: [] });
    mockSearchFoods.mockImplementation((query: string) => ({
      items: ["ranch", "dressing"].some((term) => query.toLowerCase().includes(term))
        ? [ranchDressing()]
        : [],
    }));
    useAnalysisDraftStore.setState({
      draftPhoto: {
        uri: "file://camera-meal.jpg",
        base64: "base64-meal",
        source: "camera",
      },
      draftPhotos: [],
      referencePlateDiameterMm: undefined,
    });
  });

  afterEach(() => {
    cleanup();
    useAnalysisDraftStore.setState({
      draftPhoto: undefined,
      draftPhotos: [],
      referencePlateDiameterMm: undefined,
    });
  });

  it("blocks camera meal logging until food identity, preparation, and add-on portions are reviewed", async () => {
    const view = await renderWithQueryClient(<MealConfirmationScreen />);

    await waitFor(() => {
      expect(view.getByText("Detected foods")).toBeTruthy();
    });
    expect(view.getByText("This photo's portion estimate needs confirmation. Adjust grams if the scan looks off.")).toBeTruthy();
    expect(view.getByText("Scan cues to review")).toBeTruthy();
    expect(view.getByText("Estimated visible portion: 110-190g. Confirm the amount you ate below.")).toBeTruthy();
    expect(view.getByText(/Possible details to review: cooking oil, marinade/)).toBeTruthy();

    await fireEvent.press(view.getByText("Log meal"));

    await waitFor(() => {
      expect(view.getByText(/Review Grilled chicken breast before logging/)).toBeTruthy();
    });
    expect(mockCreateMeal).not.toHaveBeenCalled();

    await fireEvent.press(view.getByText("Confirm this food"));
    await waitFor(() => {
      expect(view.getByText("Food confirmed")).toBeTruthy();
    });
    await fireEvent.press(view.getByText("Grilled"));
    await waitFor(() => {
      expect(view.getByText("Reviewed")).toBeTruthy();
    });

    await fireEvent.press(
      view.getByLabelText("Add sauce, topping, or other provider-backed add-on")
    );
    await waitFor(() => {
      expect(view.getByLabelText("Search provider-backed add-ons")).toBeTruthy();
    });
    expect(view.getByText("Start with a common add-on")).toBeTruthy();
    await fireEvent.press(view.getByLabelText("Search provider-backed add-ons for dressing"));
    await waitFor(() => {
      expect(view.getByLabelText("Search provider-backed add-ons").props.value).toBe("dressing");
    });
    await fireEvent.changeText(
      view.getByPlaceholderText("Search ranch, cheese, sugar, avocado..."),
      "ranch"
    );
    await waitFor(() => {
      expect(view.getByText("Ranch dressing")).toBeTruthy();
    });
    await fireEvent.press(view.getByText("Add"));
    await waitFor(() => {
      expect(view.getByText("View add-on source")).toBeTruthy();
    });
    expect(view.getByText("1 add-on · enter grams")).toBeTruthy();
    expect(view.getByLabelText("View nutrition source for Ranch dressing add-on")).toBeTruthy();

    await fireEvent.press(view.getByLabelText("1 add-on; 1 add-on needs grams before logging. Hide add-on management."));
    await waitFor(() => {
      expect(view.queryByLabelText("Search provider-backed add-ons")).toBeNull();
      expect(view.getByText("1 add-on · enter grams")).toBeTruthy();
    });
    await fireEvent.press(view.getByLabelText("Manage meal add-ons"));
    await waitFor(() => {
      expect(view.getByLabelText("Grams for Ranch dressing add-on")).toBeTruthy();
    });

    await fireEvent.changeText(view.getByLabelText("Grams for Ranch dressing add-on"), "");
    await waitFor(() => {
      expect(view.getByLabelText("Grams for Ranch dressing add-on").props.value).toBe("");
    });
    await fireEvent.press(view.getByText("Log meal"));

    await waitFor(() => {
      expect(view.getByText(/Review add-on portions for Grilled chicken breast before logging/)).toBeTruthy();
    });
    expect(mockCreateMeal).not.toHaveBeenCalled();

    await fireEvent.changeText(view.getByLabelText("Grams for Ranch dressing add-on"), "20");
    mockCreateMeal.mockResolvedValueOnce({ id: "meal_1" });
    await fireEvent.press(view.getByText("Log meal"));

    await waitFor(() => {
      expect(mockCreateMeal).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(view.getByLabelText("Meal saved")).toBeTruthy();
    });

    const payload = mockCreateMeal.mock.calls[0]?.[0];
    const requestOptions = mockCreateMeal.mock.calls[0]?.[1];
    expect(payload).toMatchObject({
      name: "Chicken plate",
      items: [
        {
          foodId: "usda:12345",
          displayName: "Grilled chicken breast",
          consumedGrams: 145,
          servingUnit: "grams",
          sourceProvider: "usda",
          sourceExternalId: "12345",
          userConfirmed: true,
          preparationMethod: "grilled",
          confidence: {
            portion: "verified",
            explanation: "Food source matched from the scan; calories are based on the portion entered.",
          },
          nutrientSnapshotJson: {
            detectedName: "chicken",
            identityConfirmed: true,
            preparationMethod: "grilled",
            confirmedGrams: 145,
            addOns: [
              {
                displayName: "Ranch dressing",
                grams: 20,
                provider: "usda",
                externalId: "67890",
              },
            ],
          },
        },
        {
          foodId: "usda:67890",
          displayName: "Ranch dressing add-on",
          consumedGrams: 20,
          servingUnit: "grams",
          sourceProvider: "usda",
          sourceExternalId: "67890",
          userConfirmed: true,
          preparationMethod: "add_on",
          confidence: {
            identity: "verified",
            portion: "verified",
            explanation: "Provider-backed add-on selected during camera confirmation.",
          },
        },
      ],
    });
    expect(requestOptions).toEqual({
      idempotencyKey: expect.stringMatching(/^analysis[_-]/),
    });
  });

  it("shows conflicting multi-view cues as a review requirement without promoting the match", async () => {
    const result = mealAnalysis();
    result.imageCount = 3;
    result.items[0].viewEvidence = {
      status: "conflicting",
      observedInViewIndexes: [1, 2],
      candidateEvidence: [
        { label: "roasted chicken breast", observedInViewIndexes: [1, 2] },
      ],
      explanation: "Submitted views gave competing identity cues. Choose or search for the food that matches what you ate.",
    };
    mockGetMealAnalysisJob.mockResolvedValueOnce(completedAnalysisJob(result));
    const view = await renderWithQueryClient(<MealConfirmationScreen />);

    await view.findByText("Views need your choice");
    expect(view.getByText(/competing identity cues/)).toBeTruthy();
    await fireEvent.press(view.getByText("Replace food"));
    await waitFor(() => {
      expect(view.getByText("Roasted chicken breast")).toBeTruthy();
      expect(view.getByText("Scan cue in 2 of 3 submitted views.")).toBeTruthy();
    });
    expect(view.getByText("Needs review")).toBeTruthy();
  });

  it("lets the user choose a provider-backed scan alternative before confirming the meal", async () => {
    const view = await renderWithQueryClient(<MealConfirmationScreen />);

    expect(await view.findByText("Provider-backed alternatives")).toBeTruthy();
    expect(
      view.getByText(/Their order is a review aid, not a claim of accuracy/i)
    ).toBeTruthy();

    await fireEvent.press(
      view.getByLabelText("Use suggested provider record Roasted chicken breast")
    );

    expect(await view.findByText("User replacement selected from usda.")).toBeTruthy();
    expect(view.getByText("Food confirmed")).toBeTruthy();
    expect(
      view.getByLabelText("View nutrition source for Roasted chicken breast")
    ).toBeTruthy();
  });

  it("queues a reviewed camera meal after an ambiguous save failure without storing the photo", async () => {
    mockCreateMeal.mockRejectedValueOnce(new ApiClientError("Offline", { status: 0 }));
    mockGetStoredUserId.mockResolvedValue("user-camera");
    const view = await renderWithQueryClient(<MealConfirmationScreen />);

    await view.findByText("Detected foods");
    await fireEvent.press(view.getByText("Confirm this food"));
    await view.findByText("Food confirmed");
    await fireEvent.press(view.getByText("Grilled"));
    await view.findByText("Reviewed");
    await fireEvent.press(view.getByText("Log meal"));

    await waitFor(() => {
      expect(mockQueueConfirmedMeal).toHaveBeenCalledWith(
        "user-camera",
        expect.objectContaining({ name: "Chicken plate" }),
        expect.stringMatching(/^analysis[_-]/)
      );
      expect(view.getByText("Confirmed meal queued")).toBeTruthy();
      expect(view.getByText(/saved on this device/)).toBeTruthy();
      expect(view.getByText("Go to Today")).toBeTruthy();
    });

    expect(mockQueueConfirmedMeal.mock.calls[0]?.[1]).not.toHaveProperty("imageBase64");
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("shows an evidence-based success state after a confirmed meal is persisted", async () => {
    mockCreateMeal.mockResolvedValueOnce({ id: "meal_saved" });
    const view = await renderWithQueryClient(<MealConfirmationScreen />);

    await view.findByText("Detected foods");
    await fireEvent.press(view.getByText("Confirm this food"));
    await view.findByText("Food confirmed");
    await fireEvent.press(view.getByText("Grilled"));
    await view.findByText("Reviewed");
    await fireEvent.press(view.getByText("Log meal"));

    await waitFor(() => {
      expect(view.getByText("Meal saved.")).toBeTruthy();
    });
    expect(view.getByLabelText("Meal saved")).toBeTruthy();
    expect(mockNotificationAsync).toHaveBeenCalledWith("success");
    expect(useAnalysisDraftStore.getState().draftPhoto).toBeUndefined();

    await fireEvent.press(view.getByText("View Today"));
    expect(mockReplace).toHaveBeenCalledWith("/");
  });

  it("offers keyboard-free portion and oil adjustments with descriptive labels", async () => {
    const view = await renderWithQueryClient(<MealConfirmationScreen />);

    await view.findByText("Detected foods");
    await fireEvent.press(
      view.getByLabelText("Increase weight for Grilled chicken breast by 25 grams")
    );

    await waitFor(() => {
      expect(
        view.getByLabelText("Confirm weight in grams for Grilled chicken breast").props.value
      ).toBe("170");
    });

    await fireEvent.press(
      view.getByLabelText("Increase added oil or butter for Grilled chicken breast by 5 grams")
    );

    await waitFor(() => {
      expect(
        view.getByLabelText("Added oil or butter grams for Grilled chicken breast").props.value
      ).toBe("5");
    });
    expect(view.getByText("5 grams")).toBeTruthy();
  });

  it("describes correction controls and provider-backed searches to screen readers", async () => {
    const view = await renderWithQueryClient(<MealConfirmationScreen />);

    await view.findByText("Detected foods");
    expect(
      view.getByLabelText("Search for a replacement food manually instead of Grilled chicken breast")
    ).toBeTruthy();
    expect(
      view.getByLabelText("Confirm weight in grams for Grilled chicken breast").props.accessibilityHint
    ).toContain("provider record");
    expect(
      view.getByLabelText("Add sauce, topping, or other provider-backed add-on")
    ).toBeTruthy();
    expect(
      view.getByLabelText("Show source-match report options for Grilled chicken breast").props
        .accessibilityState.expanded
    ).toBe(false);

    await fireEvent.press(
      view.getByLabelText("Show food replacement search for Grilled chicken breast")
    );

    expect(
      view.getByLabelText("Search replacement nutrition records for Grilled chicken breast")
    ).toBeTruthy();
    expect(
      view.getByLabelText("Hide food replacement search for Grilled chicken breast").props
        .accessibilityState.expanded
    ).toBe(true);

    await fireEvent.press(
      view.getByLabelText("Add sauce, topping, or other provider-backed add-on")
    );

    expect(view.getByLabelText("Search provider-backed add-ons")).toBeTruthy();
  });

  it("reuses favorite add-on records but requires an explicit gram amount", async () => {
    mockGetFavoriteFoods.mockResolvedValueOnce({ items: [ranchDressing()] });
    const view = await renderWithQueryClient(<MealConfirmationScreen />);

    await view.findByText("Detected foods");
    await fireEvent.press(
      view.getByLabelText("Add sauce, topping, or other provider-backed add-on")
    );

    expect(await view.findByText("Favorite add-ons")).toBeTruthy();
    await fireEvent.press(view.getByLabelText("Add favorite add-on Ranch dressing"));

    await waitFor(() => {
      expect(view.getByLabelText("Grams for Ranch dressing add-on").props.value).toBe("");
      expect(view.getByText("1 add-on · enter grams")).toBeTruthy();
      expect(view.getByText("1 add-on needs an explicit gram amount before logging.")).toBeTruthy();
    });
  });

  it("reorders multiple add-ons with accessible ordering controls", async () => {
    const cheese = parmesanCheese();
    mockGetFavoriteFoods.mockResolvedValueOnce({ items: [ranchDressing()] });
    mockGetRecentFoods.mockResolvedValueOnce({ items: [cheese] });
    const view = await renderWithQueryClient(<MealConfirmationScreen />);

    await view.findByText("Detected foods");
    await fireEvent.press(view.getByLabelText("Add sauce, topping, or other provider-backed add-on"));
    await view.findByText("Favorite add-ons");
    await view.findByText("Recent add-ons");
    await fireEvent.press(view.getByLabelText("Add favorite add-on Ranch dressing"));
    await fireEvent.press(view.getByLabelText("Add recent add-on Parmesan cheese"));

    await waitFor(() => {
      expect(view.getByLabelText("Move Ranch dressing add-on up").props.accessibilityState).toEqual({ disabled: true });
      expect(view.getByLabelText("Move Parmesan cheese add-on up").props.accessibilityState).toEqual({ disabled: false });
    });

    await fireEvent.press(view.getByLabelText("Move Parmesan cheese add-on up"));

    await waitFor(() => {
      const gramInputs = view.getAllByLabelText(/Grams for .* add-on/);
      expect(gramInputs.map((input) => input.props.accessibilityLabel)).toEqual([
        "Grams for Parmesan cheese add-on",
        "Grams for Ranch dressing add-on",
      ]);
      expect(view.getByLabelText("Move Parmesan cheese add-on up").props.accessibilityState).toEqual({ disabled: true });
    });

    await fireEvent.changeText(view.getByLabelText("Grams for Parmesan cheese add-on"), "12");
    await fireEvent.changeText(view.getByLabelText("Grams for Ranch dressing add-on"), "20");
    await fireEvent.press(view.getByLabelText("Confirm Grilled chicken breast"));
    await fireEvent.press(view.getByText("Grilled"));
    mockCreateMeal.mockResolvedValueOnce({ id: "meal_with_ordered_add_ons" });
    await fireEvent.press(view.getByText("Log meal"));

    await waitFor(() => {
      const meal = mockCreateMeal.mock.calls[0]?.[0];
      expect(meal.items.slice(-2).map((item: { displayName: string }) => item.displayName)).toEqual([
        "Parmesan cheese add-on",
        "Ranch dressing add-on",
      ]);
    });
  });

  it("sends every captured angle and preserves the multi-view count on the saved snapshot", async () => {
    mockGetMealAnalysisJob.mockResolvedValue(
      completedAnalysisJob({
        ...mealAnalysis(),
        imageCount: 2,
        referencePlateDiameterMm: 280,
      })
    );
    useAnalysisDraftStore.setState({
      draftPhoto: {
        uri: "file://angled.jpg",
        base64: "angled-base64",
        source: "camera",
      },
      draftPhotos: [
        { uri: "file://angled.jpg", base64: "angled-base64", source: "camera" },
        { uri: "file://top-down.jpg", base64: "top-down-base64", source: "camera" },
      ],
      referencePlateDiameterMm: 280,
    });

    const view = await renderWithQueryClient(<MealConfirmationScreen />);

    await waitFor(() => {
      expect(mockCreateMealAnalysisJob).toHaveBeenCalledWith(expect.objectContaining({
        imageBase64: "angled-base64",
        imagesBase64: ["angled-base64", "top-down-base64"],
        referencePlateDiameterMm: 280,
        idempotencyKey: expect.stringMatching(/^meal-analysis:/),
      }));
    });
    await view.findByText("Detected foods");
    expect(view.getByText(/Multiple angles can clarify visible foods/)).toBeTruthy();
    expect(view.getByText(/Multiple views can clarify visible foods, but portions still need confirmation/)).toBeTruthy();
    expect(view.getByText(/Optional plate reference: about 28 cm across/)).toBeTruthy();
    expect(view.getByLabelText("Meal photo 1 of 2")).toBeTruthy();
    await fireEvent.press(view.getByLabelText("Show meal photo 2 of 2"));
    await view.findByLabelText("Meal photo 2 of 2");

    await fireEvent.press(view.getByText("Confirm this food"));
    await view.findByText("Food confirmed");
    await fireEvent.press(view.getByText("Grilled"));
    await view.findByText("Reviewed");
    await fireEvent.press(view.getByText("Log meal"));

    await waitFor(() => {
      expect(mockCreateMeal).toHaveBeenCalledTimes(1);
    });
    expect(mockCreateMeal.mock.calls[0]?.[0].items[0].nutrientSnapshotJson).toMatchObject({
      analysisImageCount: 2,
      referencePlateDiameterMm: 280,
      qualityAssessment: {
        status: "complete",
        isBlocking: false,
      },
    });
  });

  it("cancels in-flight analysis and returns to the camera", async () => {
    mockGetMealAnalysisJob.mockResolvedValue(queuedAnalysisJob());
    const view = await renderWithQueryClient(<MealConfirmationScreen />);

    await view.findByText("Cancel");
    await fireEvent.press(view.getByLabelText("Cancel meal analysis and return to camera"));

    await waitFor(() => {
      expect(mockCancelMealAnalysisJob).toHaveBeenCalledWith("analysis-job-1");
      expect(mockReplace).toHaveBeenCalledWith("/camera");
    });
  });

  it("retries a failed analysis without discarding the captured meal photo", async () => {
    mockCreateMealAnalysisJob
      .mockRejectedValueOnce(new Error("Cannot reach the nutrition API"))
      .mockResolvedValueOnce(queuedAnalysisJob());
    const view = await renderWithQueryClient(<MealConfirmationScreen />);

    await view.findByText("API connection failed");
    await fireEvent.press(view.getByText("Try analysis again"));

    await view.findByText("Detected foods");
    expect(mockCreateMealAnalysisJob).toHaveBeenCalledTimes(2);
    expect(useAnalysisDraftStore.getState().draftPhoto?.uri).toBe("file://camera-meal.jpg");
  });
});

describe("confirmationThemeStyles", () => {
  it("keeps review controls readable with the dark semantic palette", () => {
    const dark = confirmationThemeStyles(themePalettes.dark);

    expect(dark.subsurface).toEqual({ backgroundColor: themePalettes.dark.surfaceAlt });
    expect(dark.input).toEqual({
      backgroundColor: themePalettes.dark.controlSurface,
      borderColor: themePalettes.dark.border,
      color: themePalettes.dark.ink,
    });
    expect(dark.actionText).toEqual({ color: themePalettes.dark.actionText });
    expect(dark.warningText).toEqual({ color: themePalettes.dark.warningText });
    expect(dark.dangerSurface).toEqual({ backgroundColor: themePalettes.dark.dangerSurface });
    expect(dark.dangerText).toEqual({ color: themePalettes.dark.dangerText });
  });
});

describe("cameraReviewCues", () => {
  it("keeps model hints clearly review-only", () => {
    const cues = cameraReviewCues(mealAnalysis().items[0]);

    expect(cues.portion).toBe(
      "Estimated visible portion: 110-190g. Confirm the amount you ate below."
    );
    expect(cues.preparation).toContain("Visible preparation cue: grilled.");
    expect(cues.hiddenIngredients).toBe(
      "Possible details to review: cooking oil, marinade. These are prompts, not confirmed ingredients."
    );
  });
});

function ranchDressing(): FoodSearchResult {
  return {
    id: "usda:67890",
    displayName: "Ranch dressing",
    provider: "usda",
    externalId: "67890",
    dataType: "FNDDS",
    brandOwner: null,
    publicationDate: "2025-01-01",
    servingSize: 30,
    servingSizeUnit: "g",
    householdServingText: "2 tbsp",
    nutrientsPer100g: {
      caloriesKcal: 430,
      proteinGrams: 1,
      carbohydrateGrams: 6,
      fatGrams: 45,
      fiberGrams: 0,
      sugarGrams: 4,
      sodiumMilligrams: 900,
    },
    originalNutrientIds: {
      caloriesKcal: "208",
    },
    qualityFlags: ["serving_per_100g_conflict"],
    qualityAssessment: {
      status: "needs_review",
      signals: ["provider_record", "conflicting_data"],
      summary: "The provider record has a comparison warning. Review it before logging.",
      isBlocking: false,
    },
    recordConfidence: "medium",
    sourceReference: "USDA FoodData Central ranch fixture",
    retrievedAt: "2026-07-09T12:00:00.000Z",
  };
}

function parmesanCheese(): FoodSearchResult {
  return {
    ...ranchDressing(),
    id: "usda:1123",
    externalId: "1123",
    displayName: "Parmesan cheese",
  };
}

function queuedAnalysisJob(): MealAnalysisJob {
  return {
    id: "analysis-job-1",
    status: "queued",
    imageCount: 1,
    attemptCount: 1,
    createdAt: "2026-07-21T12:00:00.000Z",
    expiresAt: "2026-07-22T12:00:00.000Z",
    result: null,
    errorCode: null,
  };
}

function completedAnalysisJob(result: MealAnalysisResult = mealAnalysis()): MealAnalysisJob {
  return {
    ...queuedAnalysisJob(),
    status: "needs_review",
    completedAt: "2026-07-21T12:00:01.000Z",
    result,
  };
}

function mealAnalysis(): MealAnalysisResult {
  return {
    id: "analysis_1",
    status: "ready",
    mealName: "Chicken plate",
    summary: "Estimated grilled chicken breast.",
    notes: "Single photo estimate requires review.",
    imageCount: 1,
    totalNutrients: {
      caloriesKcal: 239,
      proteinGrams: 45,
      carbohydrateGrams: 0,
      fatGrams: 5.2,
      fiberGrams: 0,
      sugarGrams: 0,
      sodiumMilligrams: 107,
    },
    confidence: {
      identity: "medium",
      portion: "low",
      nutritionRecord: "high",
      explanation: "Visible food matched to a provider record; portion is estimated.",
    },
    createdAt: "2026-07-09T12:00:00.000Z",
    items: [
      {
        id: "item_1",
        detectedName: "chicken",
        candidateLabels: ["grilled chicken breast", "roasted chicken breast"],
        candidateFoods: [
          {
            id: "usda:67891",
            displayName: "Roasted chicken breast",
            provider: "usda",
            externalId: "67891",
            dataType: "FNDDS",
            brandOwner: null,
            publicationDate: "2025-01-01",
            servingSize: null,
            servingSizeUnit: null,
            householdServingText: null,
            nutrientsPer100g: {
              caloriesKcal: 185,
              proteinGrams: 30,
              carbohydrateGrams: 0,
              fatGrams: 6,
              fiberGrams: 0,
              sugarGrams: 0,
              sodiumMilligrams: 90,
            },
            originalNutrientIds: { caloriesKcal: "208" },
            qualityFlags: [],
            recordConfidence: "high",
            sourceReference: "USDA FoodData Central roasted chicken fixture",
            retrievedAt: "2026-07-09T12:00:00.000Z",
          },
        ],
        displayName: "Grilled chicken breast",
        provider: "usda",
        externalId: "12345",
        dataType: "FNDDS",
        sourceReference: "USDA FoodData Central fixture",
        qualityAssessment: {
          status: "complete",
          signals: ["provider_record"],
          summary: "The normalized provider record passed the app's basic completeness checks. Confirm the portion you ate.",
          isBlocking: false,
        },
        servingGrams: 145,
        servingLabel: "estimated portion",
        portionRangeGrams: { minimum: 110, maximum: 190 },
        visiblePreparation: "grilled",
        possibleHiddenIngredients: ["cooking oil", "marinade"],
        viewEvidence: {
          status: "single_view",
          observedInViewIndexes: [1],
          candidateEvidence: [
            { label: "grilled chicken breast", observedInViewIndexes: [1] },
          ],
          explanation: "One photo supplied this scan cue. Confirm the food before logging.",
        },
        nutrients: {
          caloriesKcal: 165,
          proteinGrams: 31,
          carbohydrateGrams: 0,
          fatGrams: 3.6,
          fiberGrams: 0,
          sugarGrams: 0,
          sodiumMilligrams: 74,
        },
        confidence: {
          identity: "medium",
          portion: "low",
          nutritionRecord: "high",
          explanation: "Matched from the scan, but portion and preparation need confirmation.",
        },
        needsReview: true,
        notes: "Oil quantity cannot be determined from the image.",
      },
    ],
  };
}

function renderWithQueryClient(element: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      {element}
    </QueryClientProvider>
  );
}
