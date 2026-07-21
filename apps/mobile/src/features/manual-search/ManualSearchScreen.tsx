import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Link, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import type { FoodSearchResult, MealCreate, MealType, RecipeRead } from "@living-nutrition/shared-types";
import { colors, radii, spacing, typography, type ThemePalette } from "@living-nutrition/design-tokens";
import { calculateConsumedNutrients, roundNutrientsForDisplay } from "@living-nutrition/validation";
import { api, getStoredUserId } from "../../services/api";
import { queueConfirmedMeal } from "../../services/offlineMealQueue";
import {
  ActionButton,
  Card,
  GlassSurface,
  InlineNotice,
  MacroStatTile,
  readableFoodName,
  SourceBadge,
  StatusPill,
} from "../../shared/components/LivingUI";
import { useTheme } from "../../shared/theme/ThemeProvider";
import { foodDetailHref } from "../food-detail/foodDetailLinks";
import { getOnboardingPreferences } from "../onboarding/onboardingStorage";
import type { LoggingPreference } from "../onboarding/onboardingPreferences";
import { suggestMealTypeForTime } from "../../shared/domain/mealTiming";
import {
  createMealFromFood,
  gramsForPortion,
  getServingGramWeight,
  parsePositiveNumber,
  portionAmountForGrams,
  portionInputLabel,
  portionLabel,
  type PortionMode,
  roundMacro,
  servingSummary,
} from "../food-logging/foodLogging";
import { stickyLogBottomOffset } from "./manualSearchLayout";
import {
  actionIdempotencyKey,
  createMealActionScope,
  mealCreateIdempotencyKey,
} from "../../shared/domain/mealIdempotency";
import { presentApiError } from "../../shared/domain/apiErrorPresentation";
import { canQueueConfirmedMeal } from "../../shared/domain/offlineMealSync";
import { blocksFoodLogging, foodQualityDisplay } from "../../shared/domain/foodQuality";

export function ManualSearchScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { palette } = useTheme();
  const themed = manualThemeStyles(palette);
  const scrollRef = useRef<ScrollView>(null);
  const selectedCardY = useRef(0);
  const shouldScrollToSelectedCard = useRef(false);
  const mealActionScope = useRef(createMealActionScope("manual")).current;
  const recipeLogScopes = useRef(new Map<string, string>());
  const [keyboardBottomInset, setKeyboardBottomInset] = useState(0);
  const [query, setQuery] = useState("");
  const [selectedFood, setSelectedFood] = useState<FoodSearchResult | undefined>(undefined);
  const [portionMode, setPortionMode] = useState<PortionMode>("grams");
  const [amount, setAmount] = useState("100");
  const [mealSaved, setMealSaved] = useState(false);
  const [loggingPreference, setLoggingPreference] = useState<LoggingPreference | undefined>();
  const [formNotice, setFormNotice] = useState<{
    title: string;
    body: string;
    tone: "warning" | "danger";
  } | null>(null);
  const foods = useQuery({
    queryKey: ["foods", query],
    queryFn: () => api.searchFoods(query),
    enabled: query.trim().length >= 2,
  });
  const recentFoods = useQuery({
    queryKey: ["foods", "recent"],
    queryFn: () => api.getRecentFoods(),
    enabled: query.trim().length < 2,
  });
  const favoriteFoods = useQuery({
    queryKey: ["foods", "favorites"],
    queryFn: () => api.getFavoriteFoods(),
    enabled: query.trim().length < 2,
  });
  const recipes = useQuery({
    queryKey: ["recipes", "manual-search-suggestions"],
    queryFn: () => api.listRecipes(),
    enabled: query.trim().length < 2,
  });
  const servingGramWeight = selectedFood ? getServingGramWeight(selectedFood) : undefined;
  const grams = gramsForPortion(portionMode, amount, servingGramWeight);
  const nutrients = selectedFood
    ? calculateConsumedNutrients(selectedFood.nutrientsPer100g, grams)
    : null;
  const displayNutrients = nutrients ? roundNutrientsForDisplay(nutrients) : null;
  const trimmedQuery = query.trim();
  const favoriteItems = favoriteFoods.data?.items ?? [];
  const favoriteIds = new Set(favoriteItems.map((item) => item.id));
  const recentItems = (recentFoods.data?.items ?? []).filter((item) => !favoriteIds.has(item.id));
  const suggestedMealType = suggestMealTypeForTime(localTimeKey()) ?? "meal";
  const suggestedRecipes = (recipes.data ?? [])
    .filter((recipe) => (recipe.mealType ?? "meal") === suggestedMealType)
    .slice(0, 3);
  const searchItems = foods.data?.items ?? [];
  const loadingSavedFoods = favoriteFoods.isLoading || recentFoods.isLoading;
  const logMutation = useMutation({
    mutationFn: ({ meal, idempotencyKey }: { meal: MealCreate; idempotencyKey: string }) =>
      api.createMeal(meal, { idempotencyKey }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["diary"] });
      await queryClient.invalidateQueries({ queryKey: ["foods", "recent"] });
      setMealSaved(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    },
    onError: async (error, variables) => {
      if (canQueueConfirmedMeal(error)) {
        const ownerId = await getStoredUserId();

        if (ownerId) {
          try {
            await queueConfirmedMeal(ownerId, variables.meal, variables.idempotencyKey);
            await queryClient.invalidateQueries({ queryKey: ["offline-meal-queue"] });
            setFormNotice({
              title: "Confirmed meal queued",
              body: "We could not reach Living Nutrition, so this source-backed meal is saved on this device and will stay in your queue until you sync it from Today.",
              tone: "warning",
            });
            return;
          } catch {
            // Keep the original recovery message if device storage is unavailable.
          }
        }
      }

      setFormNotice({
        title: "Meal was not saved",
        body: presentApiError(error, "We couldn't save this meal right now. Try again in a moment.").body,
        tone: "danger",
      });
    },
  });
  const recipeLogMutation = useMutation({
    mutationFn: ({ recipeId, idempotencyKey }: { recipeId: string; idempotencyKey: string }) =>
      api.logRecipe(recipeId, { idempotencyKey }),
    onSuccess: async (_result, variables) => {
      recipeLogScopes.current.delete(variables.recipeId);
      await queryClient.invalidateQueries({ queryKey: ["diary"] });
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
      await queryClient.invalidateQueries({ queryKey: ["foods", "recent"] });
      setMealSaved(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    },
    onError: (error) => {
      setFormNotice({
        title: "Saved meal was not logged",
        body: presentApiError(error, "We couldn't log this saved meal right now. Try again in a moment.").body,
        tone: "danger",
      });
    },
  });

  useEffect(() => {
    const showSubscription = Keyboard.addListener("keyboardDidShow", (event) => {
      setKeyboardBottomInset(Platform.OS === "ios" ? event.endCoordinates.height : 0);
    });
    const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardBottomInset(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    let active = true;

    void getOnboardingPreferences().then((preferences) => {
      if (active) {
        setLoggingPreference(preferences?.loggingPreference);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  function selectFood(food: FoodSearchResult) {
    const defaultServing = getServingGramWeight(food);
    shouldScrollToSelectedCard.current = true;
    setSelectedFood(food);
    setFormNotice(null);

    if (defaultServing && loggingPreference !== "kitchen_scale") {
      setPortionMode("servings");
      setAmount("1");
    } else {
      setPortionMode("grams");
      setAmount("100");
    }

    requestAnimationFrame(scrollToSelectedCard);
  }

  function handleSelectedCardLayout(event: LayoutChangeEvent) {
    selectedCardY.current = event.nativeEvent.layout.y;

    if (shouldScrollToSelectedCard.current) {
      shouldScrollToSelectedCard.current = false;
      requestAnimationFrame(scrollToSelectedCard);
    }
  }

  function scrollToSelectedCard() {
    scrollRef.current?.scrollTo({
      y: Math.max(selectedCardY.current - spacing.sm, 0),
      animated: true,
    });
  }

  function logManualMeal() {
    if (!selectedFood || !nutrients || grams <= 0) {
      setFormNotice({
        title: "Add a valid amount",
        body: "Choose a food and enter grams, ounces, or servings greater than 0 before logging.",
        tone: "warning",
      });
      return;
    }

    if (blocksFoodLogging(selectedFood)) {
      setFormNotice({
        title: "Choose a complete nutrition record",
        body: selectedFood.qualityAssessment?.summary ?? "This record is missing essential per-100g nutrition data and cannot be logged.",
        tone: "danger",
      });
      return;
    }

    Keyboard.dismiss();
    const confirmedMeal = createMealFromFood({
        food: selectedFood,
        grams,
        servingLabel: portionLabel(portionMode, amount, servingGramWeight),
        nutrients,
        servingQuantity: parsePositiveNumber(amount),
        portionMode,
        source: "manual",
      });
    logMutation.mutate({
      meal: confirmedMeal,
      idempotencyKey: mealCreateIdempotencyKey(mealActionScope, confirmedMeal),
    });
  }

  function changePortionMode(nextMode: PortionMode) {
    if (nextMode === portionMode) {
      return;
    }

    setAmount(portionAmountForGrams(nextMode, grams, servingGramWeight));
    setPortionMode(nextMode);
  }

  function renderFoodResult(item: FoodSearchResult) {
    return (
      <Card
        key={item.id}
        style={[
          styles.result,
          selectedFood?.id === item.id ? styles.selectedResult : undefined,
          selectedFood?.id === item.id ? themed.selectedBorder : undefined,
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Select ${readableFoodName(item.displayName)} nutrition record`}
          accessibilityHint={`${Math.round(item.nutrientsPer100g.caloriesKcal)} calories per 100 grams. Opens portion controls.`}
          accessibilityState={{ selected: selectedFood?.id === item.id }}
          style={styles.resultSelectArea}
          onPress={() => {
            Keyboard.dismiss();
            selectFood(item);
          }}
        >
          <View style={styles.resultCopy}>
            <Text numberOfLines={2} style={[styles.resultTitle, themed.ink]}>
              {readableFoodName(item.displayName)}
            </Text>
            <Text numberOfLines={1} style={[styles.resultMeta, themed.muted]}>
              {Math.round(item.nutrientsPer100g.caloriesKcal)} kcal per 100g - {servingSummary(item)}
            </Text>
          </View>
          <View style={styles.resultBadges}>
            <SourceBadge label={item.provider.replaceAll("_", " ")} />
            <StatusPill
              label={foodQualityDisplay(item.qualityAssessment).label}
              tone={foodQualityDisplay(item.qualityAssessment).tone}
            />
          </View>
        </Pressable>
        <Link href={foodDetailHref(item.id)} asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View nutrition source for ${readableFoodName(item.displayName)}`}
            style={[styles.sourceButton, themed.subsurface]}
          >
            <Text style={[styles.sourceButtonText, themed.actionText]}>View source</Text>
          </Pressable>
        </Link>
      </Card>
    );
  }

  function renderSuggestedRecipe(recipe: RecipeRead) {
    const totals = recipe.items.reduce(
      (current, item) => ({
        calories: current.calories + item.calories,
        protein: current.protein + item.proteinGrams,
      }),
      { calories: 0, protein: 0 }
    );

    return (
      <Card key={recipe.id} style={styles.recipeSuggestion}>
        <View style={styles.recipeSuggestionTop}>
          <View style={styles.recipeSuggestionCopy}>
            <Text numberOfLines={2} style={[styles.resultTitle, themed.ink]}>{recipe.name}</Text>
            <Text style={[styles.resultMeta, themed.muted]}>
              {Math.round(totals.calories)} kcal · {Math.round(totals.protein)}g protein · {recipe.items.length} food{recipe.items.length === 1 ? "" : "s"}
            </Text>
          </View>
          <StatusPill label="Saved recipe" tone="success" />
        </View>
        <View style={styles.recipeSuggestionActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Review saved recipe ${recipe.name}`}
            onPress={() => router.push(`/meal-builder?recipeId=${encodeURIComponent(recipe.id)}`)}
            style={[styles.sourceButton, themed.subsurface]}
          >
            <Text style={[styles.sourceButtonText, themed.actionText]}>Review</Text>
          </Pressable>
          <ActionButton
            label={recipeLogMutation.isPending ? "Logging…" : "Log saved meal"}
            onPress={() => {
              const actionScope = recipeLogScopes.current.get(recipe.id) ?? createMealActionScope("recipe-log");
              recipeLogScopes.current.set(recipe.id, actionScope);
              recipeLogMutation.mutate({
                recipeId: recipe.id,
                idempotencyKey: actionIdempotencyKey(actionScope, { recipeId: recipe.id }),
              });
            }}
            disabled={recipeLogMutation.isPending}
            style={styles.recipeLogButton}
          />
        </View>
      </Card>
    );
  }

  if (mealSaved) {
    return (
      <ManualSearchSavedScreen
        onViewToday={() => router.replace("/")}
        onLogAnother={() => router.replace("/manual-search")}
      />
    );
  }

  return (
      <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.content}
            onScrollBeginDrag={Keyboard.dismiss}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.header}>
              <Text style={[styles.eyebrow, themed.muted]}>Manual entry</Text>
              <Text style={[styles.title, themed.ink]}>Search, portion, log.</Text>
              <Text style={[styles.body, themed.muted]}>
                Pick a food record, enter the weight or servings, and we calculate macros from per-100g data.
              </Text>
              <Link href="/saved-foods" asChild>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Manage saved favorite and recent foods"
                  style={styles.manageSavedButton}
                >
                  <Text style={[styles.manageSavedText, themed.actionText]}>Manage saved foods</Text>
                </Pressable>
              </Link>
            </View>

            {formNotice ? (
              <InlineNotice title={formNotice.title} body={formNotice.body} tone={formNotice.tone} />
            ) : null}

            <TextInput
              accessibilityLabel="Search foods by name"
              accessibilityHint="Type at least two characters to search nutrition records."
              style={[styles.input, themed.input]}
              value={query}
              onChangeText={setQuery}
              placeholder="Banana, grilled chicken, brown rice..."
              placeholderTextColor={palette.muted}
              autoCapitalize="none"
              returnKeyType="search"
              blurOnSubmit
            />

            {selectedFood && displayNutrients ? (
              <View onLayout={handleSelectedCardLayout}>
                <Card>
                <View style={styles.selectedHeader}>
                  <View style={styles.selectedCopy}>
                    <Text style={[styles.cardEyebrow, themed.muted]}>Selected food</Text>
                    <Text numberOfLines={3} style={[styles.selectedTitle, themed.ink]}>
                      {readableFoodName(selectedFood.displayName)}
                    </Text>
                    <View style={styles.badgeRow}>
                      <SourceBadge label={selectedFood.provider.replaceAll("_", " ")} tone="success" />
                      <StatusPill
                        label={foodQualityDisplay(selectedFood.qualityAssessment).label}
                        tone={foodQualityDisplay(selectedFood.qualityAssessment).tone}
                      />
                    </View>
                    <Text style={[styles.resultMeta, themed.muted]}>{selectedFood.dataType}</Text>
                    {blocksFoodLogging(selectedFood) ? (
                      <Text style={[styles.warningText, themed.warningText]}>
                        {selectedFood.qualityAssessment?.summary}
                      </Text>
                    ) : null}
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Choose a different food instead of ${readableFoodName(selectedFood.displayName)}`}
                    style={styles.changeButton}
                    onPress={() => setSelectedFood(undefined)}
                  >
                    <Text style={[styles.changeButtonText, themed.actionText]}>Change</Text>
                  </Pressable>
                </View>
                <Link href={foodDetailHref(selectedFood.id)} asChild>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`View nutrition source for ${readableFoodName(selectedFood.displayName)}`}
                    style={[styles.sourceButton, themed.subsurface]}
                  >
                    <Text style={[styles.sourceButtonText, themed.actionText]}>View source</Text>
                  </Pressable>
                </Link>

                <View style={styles.modeRow}>
                  <ModeButton
                    active={portionMode === "grams"}
                    label="Grams"
                    onPress={() => changePortionMode("grams")}
                  />
                  <ModeButton
                    active={portionMode === "ounces"}
                    label="Ounces"
                    onPress={() => changePortionMode("ounces")}
                  />
                  <ModeButton
                    active={portionMode === "servings"}
                    label="Servings"
                    onPress={() => changePortionMode("servings")}
                    disabled={!servingGramWeight}
                  />
                </View>

                <View style={styles.amountRow}>
                  <View style={styles.amountInputWrap}>
                    <Text style={[styles.inputLabel, themed.muted]}>
                      {portionInputLabel(portionMode)}
                    </Text>
                    <TextInput
                      accessibilityLabel={portionInputLabel(portionMode)}
                      accessibilityHint="Enter the amount you ate. Nutrition is calculated from the source record per 100 grams."
                      style={[styles.amountInput, themed.input]}
                      value={amount}
                      onChangeText={setAmount}
                      keyboardType="decimal-pad"
                      placeholder={portionMode === "servings" ? "1" : portionMode === "ounces" ? "3.5" : "100"}
                      placeholderTextColor={palette.muted}
                      returnKeyType="done"
                      blurOnSubmit
                      onFocus={() => requestAnimationFrame(scrollToSelectedCard)}
                      onSubmitEditing={Keyboard.dismiss}
                    />
                  </View>
                  <View style={[styles.servingHint, themed.subsurface]}>
                    <Text style={[styles.servingHintValue, themed.ink]}>{Math.round(grams || 0)}g</Text>
                    <Text style={[styles.servingHintLabel, themed.muted]}>used</Text>
                  </View>
                </View>

                <Text style={[styles.hintText, themed.muted]}>
                  {servingGramWeight
                    ? `1 serving = ${Math.round(servingGramWeight)}g from the source record.`
                    : "Servings are unavailable because this record has no verified gram weight. Use grams or ounces."} {portionMode === "ounces" ? "Ounces are converted to grams before macros are calculated." : ""}
                </Text>

                <View style={styles.macroGrid}>
                  <MacroStatTile style={styles.halfMacroTile} label="Calories" value={Math.round(displayNutrients.caloriesKcal)} suffix="kcal" />
                  <MacroStatTile style={styles.halfMacroTile} label="Protein" value={roundMacro(displayNutrients.proteinGrams)} suffix="g" tone="protein" />
                  <MacroStatTile style={styles.halfMacroTile} label="Carbs" value={roundMacro(displayNutrients.carbohydrateGrams)} suffix="g" tone="carbs" />
                  <MacroStatTile style={styles.halfMacroTile} label="Fat" value={roundMacro(displayNutrients.fatGrams)} suffix="g" tone="fat" />
                </View>
                </Card>
              </View>
            ) : null}

            <View style={styles.resultsList}>
              {trimmedQuery.length >= 2 && foods.error ? (
                <InlineNotice
                  title="Nutrition search is temporarily unavailable"
                  body={presentApiError(
                    foods.error,
                    "We couldn't load nutrition records right now. Try again in a moment."
                  ).body}
                  tone="warning"
                  actions={[{ label: "Try search again", onPress: () => void foods.refetch(), variant: "secondary" }]}
                />
              ) : null}
              {trimmedQuery.length < 2 && (favoriteItems.length || recentItems.length || suggestedRecipes.length) ? (
                <>
                  {suggestedRecipes.length ? (
                    <>
                      <Text style={[styles.resultsHeading, themed.ink]}>Saved for {mealTypeLabel(suggestedMealType)}</Text>
                      <Text style={[styles.suggestionHint, themed.muted]}>
                        Your recipes tagged for this time of day. Review or log a saved, source-backed meal.
                      </Text>
                      {suggestedRecipes.map(renderSuggestedRecipe)}
                    </>
                  ) : null}
                  {favoriteItems.length ? (
                    <>
                      <Text style={[styles.resultsHeading, themed.ink]}>Favorite foods</Text>
                      {favoriteItems.map(renderFoodResult)}
                    </>
                  ) : null}
                  {recentItems.length ? (
                    <>
                      <Text style={[styles.resultsHeading, themed.ink]}>Recent foods</Text>
                      {recentItems.map(renderFoodResult)}
                    </>
                  ) : null}
                </>
              ) : trimmedQuery.length >= 2 && searchItems.length ? (
                <>
                  <Text style={[styles.resultsHeading, themed.ink]}>Search results</Text>
                  {searchItems.map(renderFoodResult)}
                </>
              ) : !foods.error ? (
                <View style={styles.emptyState}>
                  <Text style={[styles.empty, themed.muted]}>
                    {trimmedQuery.length < 2
                      ? loadingSavedFoods
                        ? "Loading saved foods..."
                        : "Type at least two letters, or save recipes and favorite foods to keep them here."
                      : "No foods found yet."}
                  </Text>
                  {trimmedQuery.length >= 2 ? (
                    <Link href="/custom-food" asChild>
                      <Pressable accessibilityRole="button" style={[styles.sourceButton, themed.subsurface]}>
                        <Text style={[styles.sourceButtonText, themed.actionText]}>Create custom food</Text>
                      </Pressable>
                    </Link>
                  ) : null}
                </View>
              ) : null}
            </View>
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
      {selectedFood && displayNutrients ? (
        <View
          style={[
            styles.stickyLogBar,
            {
              bottom: stickyLogBottomOffset({
                safeAreaBottom: insets.bottom,
                keyboardBottomInset,
              }),
            },
          ]}
          pointerEvents="box-none"
        >
          <GlassSurface level="navigation" style={styles.stickyLogCard} contentStyle={styles.stickyLogContent}>
            <View style={styles.stickyLogCopy}>
              <Text numberOfLines={1} style={[styles.stickyLogTitle, themed.ink]}>
                {readableFoodName(selectedFood.displayName)}
              </Text>
              <Text style={[styles.stickyLogMeta, themed.muted]}>
                {Math.round(grams || 0)}g · {Math.round(displayNutrients.caloriesKcal)} kcal
              </Text>
            </View>
            <ActionButton
              label={logMutation.isPending ? "Saving..." : "Log meal"}
              onPress={logManualMeal}
              disabled={logMutation.isPending || blocksFoodLogging(selectedFood)}
              style={styles.stickyLogButton}
            />
          </GlassSurface>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function ManualSearchSavedScreen({
  onViewToday,
  onLogAnother,
}: {
  onViewToday: () => void;
  onLogAnother: () => void;
}) {
  const { palette } = useTheme();
  const themed = manualThemeStyles(palette);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={styles.savedState}>
        <View accessible accessibilityLabel="Meal saved" style={[styles.savedMark, themed.savedMark]}>
          <Ionicons name="checkmark" size={32} color={colors.white} />
        </View>
        <Text style={[styles.eyebrow, themed.muted]}>Saved to your diary</Text>
        <Text style={[styles.title, themed.ink]}>Meal saved.</Text>
        <Text style={[styles.body, themed.muted]}>
          Your diary uses the source record and portion you selected. You can adjust this meal later from Today.
        </Text>
        <View style={styles.savedActions}>
          <ActionButton label="View Today" onPress={onViewToday} />
          <ActionButton label="Log another food" variant="secondary" onPress={onLogAnother} />
        </View>
      </View>
    </SafeAreaView>
  );
}

function ModeButton({
  active,
  label,
  onPress,
  disabled = false,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { palette } = useTheme();
  const themed = manualThemeStyles(palette);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={disabled ? `${label} unavailable because no verified gram serving weight` : label}
      accessibilityState={{ disabled, selected: active }}
      style={[styles.modeButton, themed.subsurface, active ? styles.activeModeButton : undefined, disabled ? styles.disabledModeButton : undefined]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.modeButtonText, { color: active ? palette.onPrimary : palette.ink }, disabled ? [styles.disabledModeButtonText, { color: palette.muted }] : undefined]}>
        {label}
      </Text>
    </Pressable>
  );
}

function manualThemeStyles(palette: ThemePalette) {
  return {
    ink: { color: palette.ink },
    muted: { color: palette.muted },
    actionText: { color: palette.actionText },
    warningText: { color: palette.warningText },
    selectedBorder: { borderColor: palette.actionText },
    subsurface: { backgroundColor: palette.surfaceAlt },
    savedMark: { backgroundColor: palette.mode === "dark" ? colors.green : colors.greenDeep },
    input: { backgroundColor: palette.controlSurface, borderColor: palette.border, color: palette.ink },
  };
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardAvoider: {
    flex: 1,
  },
  content: {
    padding: spacing.xxl,
    paddingBottom: 260,
    gap: spacing.md,
  },
  header: {
    gap: spacing.xs,
  },
  eyebrow: {
    ...typography.eyebrow,
    color: colors.muted,
  },
  title: {
    ...typography.display,
    color: colors.ink,
  },
  body: {
    ...typography.body,
    color: colors.muted,
  },
  manageSavedButton: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
  },
  manageSavedText: {
    ...typography.button,
    color: colors.green,
  },
  input: {
    minHeight: 52,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    backgroundColor: "rgba(255, 255, 255, 0.78)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(20, 37, 29, 0.08)",
    color: colors.ink,
  },
  selectedHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  selectedCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  cardEyebrow: {
    ...typography.eyebrow,
    color: colors.muted,
  },
  selectedTitle: {
    ...typography.heading,
    color: colors.ink,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  changeButton: {
    minHeight: 40,
    justifyContent: "center",
  },
  changeButtonText: {
    ...typography.button,
    color: colors.green,
  },
  modeRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  modeButton: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.background,
  },
  activeModeButton: {
    backgroundColor: colors.green,
  },
  modeButtonText: {
    ...typography.button,
    color: colors.ink,
  },
  activeModeButtonText: {
    color: colors.white,
  },
  disabledModeButton: {
    opacity: 0.52,
  },
  disabledModeButtonText: {
    color: colors.muted,
  },
  amountRow: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "flex-end",
  },
  amountInputWrap: {
    flex: 1,
    gap: spacing.xs,
  },
  inputLabel: {
    ...typography.caption,
    color: colors.muted,
  },
  amountInput: {
    minHeight: 52,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    color: colors.ink,
  },
  servingHint: {
    minWidth: 88,
    minHeight: 52,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceAlt,
  },
  servingHintValue: {
    ...typography.heading,
    color: colors.ink,
  },
  servingHintLabel: {
    ...typography.caption,
    color: colors.muted,
  },
  hintText: {
    ...typography.caption,
    color: colors.muted,
  },
  macroGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  halfMacroTile: {
    flexBasis: "47%",
  },
  disabledButton: {
    opacity: 0.62,
  },
  empty: {
    ...typography.body,
    color: colors.muted,
    paddingTop: spacing.lg,
  },
  resultsList: {
    gap: spacing.sm,
  },
  resultsHeading: {
    ...typography.heading,
    color: colors.ink,
  },
  suggestionHint: { ...typography.caption, color: colors.muted, marginTop: -spacing.xs },
  emptyState: {
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  result: {
    minHeight: 88,
    gap: spacing.sm,
  },
  recipeSuggestion: { gap: spacing.sm },
  recipeSuggestionTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  recipeSuggestionCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  recipeSuggestionActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  recipeLogButton: { flex: 1, minHeight: 44 },
  resultSelectArea: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  resultBadges: {
    alignItems: "flex-end",
    gap: spacing.xs,
    flexShrink: 0,
    maxWidth: 132,
  },
  selectedResult: {
    borderWidth: 2,
    borderColor: colors.green,
  },
  resultTitle: {
    ...typography.heading,
    color: colors.ink,
    flexShrink: 1,
  },
  resultCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  resultMeta: {
    ...typography.caption,
    color: colors.muted,
  },
  sourceButton: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceAlt,
  },
  sourceButtonText: {
    ...typography.button,
    color: colors.green,
  },
  warningText: {
    ...typography.caption,
  },
  stickyLogBar: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
  },
  stickyLogCard: {
    minHeight: 72,
    borderRadius: radii.lg,
  },
  stickyLogContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.sm,
    paddingLeft: spacing.md,
  },
  stickyLogCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  stickyLogTitle: {
    ...typography.button,
    color: colors.ink,
  },
  stickyLogMeta: {
    ...typography.caption,
    color: colors.muted,
  },
  stickyLogButton: {
    minWidth: 132,
    borderRadius: radii.pill,
  },
  savedState: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingHorizontal: spacing.lg },
  savedMark: { width: 72, height: 72, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, backgroundColor: colors.greenDeep },
  savedActions: { alignSelf: "stretch", gap: spacing.sm, marginTop: spacing.sm },
});

function localTimeKey() {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
}

function mealTypeLabel(mealType: MealType) {
  const labels: Record<MealType, string> = {
    breakfast: "breakfast",
    lunch: "lunch",
    dinner: "dinner",
    snack: "snacks",
    meal: "this time of day",
  };

  return labels[mealType];
}
