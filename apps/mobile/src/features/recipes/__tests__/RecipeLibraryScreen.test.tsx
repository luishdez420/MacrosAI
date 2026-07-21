import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { RecipeRead } from "@living-nutrition/shared-types";
import { themePalettes, type ThemePreference } from "@living-nutrition/design-tokens";
import { ThemeProvider } from "../../../shared/theme/ThemeProvider";
import { RecipeLibraryScreen } from "../RecipeLibraryScreen";

const mockListRecipes = jest.fn();
const mockLogRecipe = jest.fn();
const mockDeleteRecipe = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockNotificationAsync = jest.fn();

jest.mock("expo-haptics", () => ({
  NotificationFeedbackType: { Success: "success" },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  notificationAsync: (type: unknown) => {
    mockNotificationAsync(type);
    return Promise.resolve();
  },
  impactAsync: () => Promise.resolve(),
  selectionAsync: () => Promise.resolve(),
}));

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: unknown }) => children,
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

jest.mock("../../../services/api", () => ({
  api: {
    listRecipes: (...args: unknown[]) => mockListRecipes(...args),
    logRecipe: (...args: unknown[]) => mockLogRecipe(...args),
    deleteRecipe: (...args: unknown[]) => mockDeleteRecipe(...args),
  },
}));

describe("RecipeLibraryScreen", () => {
  beforeEach(() => {
    mockListRecipes.mockReset();
    mockLogRecipe.mockReset();
    mockDeleteRecipe.mockReset();
    mockPush.mockReset();
    mockReplace.mockReset();
    mockNotificationAsync.mockReset();
  });

  it("shows source-backed recipe totals and opens the editable meal builder", async () => {
    mockListRecipes.mockResolvedValue([recipe()]);

    const view = await renderWithQueryClient(<RecipeLibraryScreen />);

    await waitFor(() => expect(view.getByText("Chicken rice bowl")).toBeTruthy());

    expect(view.getByText("508 kcal")).toBeTruthy();
    expect(view.getByText("52g")).toBeTruthy();
    expect(view.getByText("Lunch · 2 foods · used 3 times")).toBeTruthy();
    expect(view.getByLabelText("Delete Chicken rice bowl").props.accessibilityHint).toContain("Logged meals will not be changed");

    fireEvent.press(view.getByText("Edit recipe"));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/meal-builder",
      params: { recipeId: "recipe_1" },
    });
  });

  it("uses an accessible structural loading state while recipes are pending", async () => {
    let resolveRecipes: (value: RecipeRead[]) => void = () => undefined;
    mockListRecipes.mockImplementation(
      () => new Promise<RecipeRead[]>((resolve) => {
        resolveRecipes = resolve;
      })
    );

    const view = await renderWithQueryClient(<RecipeLibraryScreen />);

    expect(await view.findByLabelText("Loading saved recipes")).toBeTruthy();

    await act(async () => {
      resolveRecipes([recipe()]);
    });

    await waitFor(() => expect(view.getByText("Chicken rice bowl")).toBeTruthy());
  });

  it("confirms a recipe save before letting the user continue to Today", async () => {
    mockListRecipes.mockResolvedValue([recipe()]);
    mockLogRecipe.mockResolvedValue({ recipe: recipe(), meal: { id: "meal_1" } });

    const view = await renderWithQueryClient(<RecipeLibraryScreen />);

    await waitFor(() => expect(view.getByText("Log to today")).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByText("Log to today"));
    });

    await waitFor(() =>
      expect(mockLogRecipe).toHaveBeenCalledWith(
        "recipe_1",
        expect.objectContaining({ idempotencyKey: expect.stringMatching(/^recipe-log-/) })
      )
    );
    expect(await view.findByText("Meal saved.")).toBeTruthy();
    expect(mockNotificationAsync).toHaveBeenCalledWith("success");
    expect(mockReplace).not.toHaveBeenCalled();

    fireEvent.press(view.getByText("View Today"));

    expect(mockReplace).toHaveBeenCalledWith("/");
  });

  it("keeps recipe deletion inside the product before requiring confirmation", async () => {
    mockListRecipes.mockResolvedValue([recipe()]);
    mockDeleteRecipe.mockResolvedValue(undefined);

    const view = await renderWithQueryClient(<RecipeLibraryScreen />);

    await waitFor(() => expect(view.getByLabelText("Delete Chicken rice bowl")).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByLabelText("Delete Chicken rice bowl"));
    });

    expect(await view.findByText("Remove Chicken rice bowl?")).toBeTruthy();
    expect(view.getByText(/Meals already logged from it will remain in your diary/)).toBeTruthy();
    expect(mockDeleteRecipe).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(view.getByLabelText("Remove recipe"));
    });

    await waitFor(() => expect(mockDeleteRecipe).toHaveBeenCalledWith("recipe_1"));
  });

  it("uses semantic dark-theme colors for recipe hierarchy and controls", async () => {
    mockListRecipes.mockResolvedValue([recipe()]);

    const view = await renderWithQueryClient(<RecipeLibraryScreen />, "dark");

    await waitFor(() => expect(view.getByText("Chicken rice bowl")).toBeTruthy());

    expect(StyleSheet.flatten(view.getByText("Recipe library").props.style).color).toBe(
      themePalettes.dark.actionText
    );
    expect(StyleSheet.flatten(view.getByText("Chicken rice bowl").props.style).color).toBe(
      themePalettes.dark.ink
    );
    expect(StyleSheet.flatten(view.getByText("Lunch · 2 foods · used 3 times").props.style).color).toBe(
      themePalettes.dark.muted
    );
    expect(StyleSheet.flatten(view.getByLabelText("Close recipes").props.style).backgroundColor).toBe(
      themePalettes.dark.surfaceAlt
    );
  });
});

function recipe(): RecipeRead {
  return {
    id: "recipe_1",
    name: "Chicken rice bowl",
    mealType: "lunch",
    notes: "Weekday lunch",
    timesUsed: 3,
    createdAt: "2026-07-12T12:00:00Z",
    updatedAt: "2026-07-12T12:00:00Z",
    items: [
      item("recipe_item_1", "Chicken breast", 150, 247.5, 46.5, 0, 5.4),
      item("recipe_item_2", "Cooked white rice", 200, 260, 5.4, 56, 0.6),
    ],
  };
}

function item(
  id: string,
  displayName: string,
  consumedGrams: number,
  calories: number,
  proteinGrams: number,
  carbohydrateGrams: number,
  fatGrams: number
): RecipeRead["items"][number] {
  return {
    id,
    foodId: `usda:${id}`,
    displayName,
    consumedGrams,
    servingQuantity: consumedGrams,
    servingUnit: "grams",
    calories,
    proteinGrams,
    carbohydrateGrams,
    fatGrams,
    fiberGrams: 0,
    sugarGrams: 0,
    sodiumMilligrams: 0,
    sourceProvider: "usda",
    sourceExternalId: id,
    sourceVersion: "Foundation",
    sourceReference: "USDA fixture",
    nutrientSnapshotJson: { source: "fixture" },
    confidence: {
      identity: "verified",
      portion: "verified",
      nutritionRecord: "high",
      explanation: "Confirmed source and grams.",
    },
    userConfirmed: true,
    preparationMethod: null,
    addedOilGrams: 0,
    notes: null,
    createdAt: "2026-07-12T12:00:00Z",
    updatedAt: "2026-07-12T12:00:00Z",
  };
}

function renderWithQueryClient(element: ReactElement, themePreference: ThemePreference = "light") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });

  return render(
    <ThemeProvider initialPreference={themePreference}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
