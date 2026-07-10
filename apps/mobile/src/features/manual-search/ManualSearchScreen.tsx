import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

import type { FoodSearchResult, MealCreate } from "@living-nutrition/shared-types";
import { colors, radii, spacing, typography } from "@living-nutrition/design-tokens";
import { calculateConsumedNutrients, roundNutrientsForDisplay } from "@living-nutrition/validation";
import { api } from "../../services/api";
import {
  ActionButton,
  Card,
  InlineNotice,
  MacroStatTile,
  readableFoodName,
  SourceBadge,
  StatusPill,
} from "../../shared/components/LivingUI";
import { foodDetailHref } from "../food-detail/foodDetailLinks";
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

export function ManualSearchScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const selectedCardY = useRef(0);
  const shouldScrollToSelectedCard = useRef(false);
  const [keyboardBottomInset, setKeyboardBottomInset] = useState(0);
  const [query, setQuery] = useState("");
  const [selectedFood, setSelectedFood] = useState<FoodSearchResult | undefined>(undefined);
  const [portionMode, setPortionMode] = useState<PortionMode>("grams");
  const [amount, setAmount] = useState("100");
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
  const searchItems = foods.data?.items ?? [];
  const loadingSavedFoods = favoriteFoods.isLoading || recentFoods.isLoading;
  const logMutation = useMutation({
    mutationFn: (meal: MealCreate) => api.createMeal(meal),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["diary"] });
      await queryClient.invalidateQueries({ queryKey: ["foods", "recent"] });
      router.replace("/");
    },
    onError: (error) => {
      setFormNotice({
        title: "Meal was not saved",
        body: error.message,
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

  function selectFood(food: FoodSearchResult) {
    const defaultServing = getServingGramWeight(food);
    shouldScrollToSelectedCard.current = true;
    setSelectedFood(food);
    setFormNotice(null);

    if (defaultServing) {
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

    Keyboard.dismiss();
    logMutation.mutate(
      createMealFromFood({
        food: selectedFood,
        grams,
        servingLabel: portionLabel(portionMode, amount, servingGramWeight),
        nutrients,
        servingQuantity: parsePositiveNumber(amount),
        portionMode,
        source: "manual",
      })
    );
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
      <View
        key={item.id}
        style={[
          styles.result,
          selectedFood?.id === item.id ? styles.selectedResult : undefined,
        ]}
      >
        <Pressable
          accessibilityRole="button"
          style={styles.resultSelectArea}
          onPress={() => {
            Keyboard.dismiss();
            selectFood(item);
          }}
        >
          <View style={styles.resultCopy}>
            <Text numberOfLines={2} style={styles.resultTitle}>
              {readableFoodName(item.displayName)}
            </Text>
            <Text numberOfLines={1} style={styles.resultMeta}>
              {Math.round(item.nutrientsPer100g.caloriesKcal)} kcal per 100g - {servingSummary(item)}
            </Text>
          </View>
          <View style={styles.resultBadges}>
            <SourceBadge label={item.provider.replaceAll("_", " ")} />
            <StatusPill
              label={item.recordConfidence}
              tone={item.recordConfidence === "low" ? "warning" : "success"}
            />
          </View>
        </Pressable>
        <Link href={foodDetailHref(item.id)} asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View nutrition source for ${readableFoodName(item.displayName)}`}
            style={styles.sourceButton}
          >
            <Text style={styles.sourceButtonText}>View source</Text>
          </Pressable>
        </Link>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
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
              <Text style={styles.eyebrow}>Manual entry</Text>
              <Text style={styles.title}>Search, portion, log.</Text>
              <Text style={styles.body}>
                Pick a food record, enter the weight or servings, and we calculate macros from per-100g data.
              </Text>
              <Link href="/saved-foods" asChild>
                <Pressable accessibilityRole="button" style={styles.manageSavedButton}>
                  <Text style={styles.manageSavedText}>Manage saved foods</Text>
                </Pressable>
              </Link>
            </View>

            {formNotice ? (
              <InlineNotice title={formNotice.title} body={formNotice.body} tone={formNotice.tone} />
            ) : null}

            <TextInput
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder="Banana, grilled chicken, brown rice..."
              autoCapitalize="none"
              returnKeyType="search"
              blurOnSubmit
            />

            {selectedFood && displayNutrients ? (
              <View onLayout={handleSelectedCardLayout}>
                <Card>
                <View style={styles.selectedHeader}>
                  <View style={styles.selectedCopy}>
                    <Text style={styles.cardEyebrow}>Selected food</Text>
                    <Text numberOfLines={3} style={styles.selectedTitle}>
                      {readableFoodName(selectedFood.displayName)}
                    </Text>
                    <View style={styles.badgeRow}>
                      <SourceBadge label={selectedFood.provider.replaceAll("_", " ")} tone="success" />
                      <StatusPill
                        label={`${selectedFood.recordConfidence} confidence`}
                        tone={selectedFood.recordConfidence === "low" ? "warning" : "success"}
                      />
                    </View>
                    <Text style={styles.resultMeta}>{selectedFood.dataType}</Text>
                  </View>
                  <Pressable style={styles.changeButton} onPress={() => setSelectedFood(undefined)}>
                    <Text style={styles.changeButtonText}>Change</Text>
                  </Pressable>
                </View>
                <Link href={foodDetailHref(selectedFood.id)} asChild>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`View nutrition source for ${readableFoodName(selectedFood.displayName)}`}
                    style={styles.sourceButton}
                  >
                    <Text style={styles.sourceButtonText}>View source</Text>
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
                    <Text style={styles.inputLabel}>
                      {portionInputLabel(portionMode)}
                    </Text>
                    <TextInput
                      style={styles.amountInput}
                      value={amount}
                      onChangeText={setAmount}
                      keyboardType="decimal-pad"
                      placeholder={portionMode === "servings" ? "1" : portionMode === "ounces" ? "3.5" : "100"}
                      returnKeyType="done"
                      blurOnSubmit
                      onFocus={() => requestAnimationFrame(scrollToSelectedCard)}
                      onSubmitEditing={Keyboard.dismiss}
                    />
                  </View>
                  <View style={styles.servingHint}>
                    <Text style={styles.servingHintValue}>{Math.round(grams || 0)}g</Text>
                    <Text style={styles.servingHintLabel}>used</Text>
                  </View>
                </View>

                <Text style={styles.hintText}>
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
              {trimmedQuery.length < 2 && (favoriteItems.length || recentItems.length) ? (
                <>
                  {favoriteItems.length ? (
                    <>
                      <Text style={styles.resultsHeading}>Favorite foods</Text>
                      {favoriteItems.map(renderFoodResult)}
                    </>
                  ) : null}
                  {recentItems.length ? (
                    <>
                      <Text style={styles.resultsHeading}>Recent foods</Text>
                      {recentItems.map(renderFoodResult)}
                    </>
                  ) : null}
                </>
              ) : trimmedQuery.length >= 2 && searchItems.length ? (
                <>
                  <Text style={styles.resultsHeading}>Search results</Text>
                  {searchItems.map(renderFoodResult)}
                </>
              ) : (
                <View style={styles.emptyState}>
                  <Text style={styles.empty}>
                    {trimmedQuery.length < 2
                      ? loadingSavedFoods
                        ? "Loading saved foods..."
                        : "Type at least two letters, or favorite foods to keep them here."
                      : "No foods found yet."}
                  </Text>
                  {trimmedQuery.length >= 2 ? (
                    <Link href="/custom-food" asChild>
                      <Pressable accessibilityRole="button" style={styles.sourceButton}>
                        <Text style={styles.sourceButtonText}>Create custom food</Text>
                      </Pressable>
                    </Link>
                  ) : null}
                </View>
              )}
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
          <View style={styles.stickyLogCard}>
            <View style={styles.stickyLogCopy}>
              <Text numberOfLines={1} style={styles.stickyLogTitle}>
                {readableFoodName(selectedFood.displayName)}
              </Text>
              <Text style={styles.stickyLogMeta}>
                {Math.round(grams || 0)}g · {Math.round(displayNutrients.caloriesKcal)} kcal
              </Text>
            </View>
            <ActionButton
              label={logMutation.isPending ? "Saving..." : "Log meal"}
              onPress={logManualMeal}
              disabled={logMutation.isPending}
              style={styles.stickyLogButton}
            />
          </View>
        </View>
      ) : null}
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={disabled ? `${label} unavailable because no verified gram serving weight` : label}
      accessibilityState={{ disabled, selected: active }}
      style={[styles.modeButton, active ? styles.activeModeButton : undefined, disabled ? styles.disabledModeButton : undefined]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.modeButtonText, active ? styles.activeModeButtonText : undefined, disabled ? styles.disabledModeButtonText : undefined]}>
        {label}
      </Text>
    </Pressable>
  );
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
    padding: spacing.lg,
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
    backgroundColor: colors.surface,
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
  emptyState: {
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  result: {
    minHeight: 78,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
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
  stickyLogBar: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
  },
  stickyLogCard: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: radii.lg,
    padding: spacing.sm,
    paddingLeft: spacing.md,
    backgroundColor: "rgba(255, 255, 255, 0.97)",
    shadowColor: colors.ink,
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
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
});
