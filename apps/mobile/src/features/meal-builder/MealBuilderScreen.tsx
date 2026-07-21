import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { FoodSearchResult, MealCreate, MealType } from "@living-nutrition/shared-types";
import { colors, radii, spacing, typography, type ThemePalette } from "@living-nutrition/design-tokens";
import { api, getStoredUserId } from "../../services/api";
import { queueConfirmedMeal } from "../../services/offlineMealQueue";
import {
  actionIdempotencyKey,
  createMealActionScope,
  mealCreateIdempotencyKey,
} from "../../shared/domain/mealIdempotency";
import { canQueueConfirmedMeal } from "../../shared/domain/offlineMealSync";
import { presentApiError } from "../../shared/domain/apiErrorPresentation";
import {
  ActionButton,
  Card,
  EmptyState,
  GlassIconButton,
  GlassSurface,
  InlineNotice,
  MacroStatTile,
  readableFoodName,
  ScreenShell,
  SectionHeader,
  SourceBadge,
  StatusPill,
  SwipeActionRow,
} from "../../shared/components/LivingUI";
import { useTheme } from "../../shared/theme/ThemeProvider";
import { parsePositiveNumber, roundMacro } from "../food-logging/foodLogging";
import {
  combineLocalDateAndTime,
  localDateKey,
  localTimeKey,
  suggestMealTypeForTime,
} from "../../shared/domain/mealTiming";
import {
  builderItemFromRecipeItem,
  createMealFromBuilder,
  createRecipeFromBuilder,
  duplicateBuilderItem,
  mealBuilderTotals,
  moveBuilderItem,
  moveBuilderItemByOffset,
  nutrientsForBuilderItem,
  type MealBuilderItem,
} from "./mealBuilder";
import { floatingActionBottomOffset } from "../manual-search/manualSearchLayout";

const mealCategories: Array<{
  value: MealType;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { value: "breakfast", label: "Breakfast", icon: "sunny-outline" },
  { value: "lunch", label: "Lunch", icon: "partly-sunny-outline" },
  { value: "dinner", label: "Dinner", icon: "moon-outline" },
  { value: "snack", label: "Snack", icon: "nutrition-outline" },
  { value: "meal", label: "Any time", icon: "restaurant-outline" },
];

const mealTimePresets = [
  { label: "Breakfast", value: "08:00" },
  { label: "Lunch", value: "12:30" },
  { label: "Dinner", value: "18:30" },
  { label: "Now", value: "now" },
];

const DRAG_REORDER_STEP_PX = 96;

export function MealBuilderScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { palette } = useTheme();
  const themed = mealBuilderThemeStyles(palette);
  const { recipeId: routeRecipeId } = useLocalSearchParams<{ recipeId?: string | string[] }>();
  const recipeId = typeof routeRecipeId === "string" ? routeRecipeId : undefined;
  const queryClient = useQueryClient();
  const mealActionScope = useRef(createMealActionScope("builder")).current;
  const recipeActionScope = useRef(createMealActionScope("recipe")).current;
  const [mealName, setMealName] = useState("");
  const [mealDate, setMealDate] = useState(() => localDateKey());
  const [mealTime, setMealTime] = useState(() => localTimeKey());
  const [mealType, setMealType] = useState<MealType>(() => suggestMealTypeForTime(localTimeKey()) ?? "meal");
  const [mealTypeManuallySelected, setMealTypeManuallySelected] = useState(false);
  const [notes, setNotes] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<MealBuilderItem[]>([]);
  const [loadedRecipeId, setLoadedRecipeId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ title: string; body: string; tone: "warning" | "danger" } | null>(null);
  const [mealSaved, setMealSaved] = useState(false);
  const [keyboardBottomInset, setKeyboardBottomInset] = useState(0);
  const foods = useQuery({
    queryKey: ["meal-builder-foods", query],
    queryFn: () => api.searchFoods(query),
    enabled: query.trim().length >= 2,
  });
  const recipe = useQuery({
    queryKey: ["recipes", recipeId],
    queryFn: () => api.getRecipe(recipeId ?? ""),
    enabled: Boolean(recipeId),
  });
  const totals = mealBuilderTotals(items);
  const saveMutation = useMutation({
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
            setNotice({
              title: "Confirmed meal queued",
              body: "We could not reach Living Nutrition, so this source-backed meal is saved on this device and will stay in your queue until you sync it from Today.",
              tone: "warning",
            });
            return;
          } catch {
            // Use the normal recovery message if device storage is unavailable.
          }
        }
      }

      setNotice({
        title: "Meal was not saved",
        body: presentApiError(error, "We couldn't save this meal right now. Try again in a moment.").body,
        tone: "danger",
      });
    },
  });
  const saveRecipeMutation = useMutation({
    mutationFn: () => {
      const payload = createRecipeFromBuilder({ name: mealName, mealType, notes, items });
      return recipeId
        ? api.updateRecipe(recipeId, payload)
        : api.createRecipe(payload, {
            idempotencyKey: actionIdempotencyKey(recipeActionScope, payload),
          });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
      router.replace("/recipes");
    },
    onError: (error) => setNotice({ title: "Recipe was not saved", body: error.message, tone: "danger" }),
  });

  useEffect(() => {
    if (!recipe.data || recipe.data.id === loadedRecipeId) {
      return;
    }

    setMealName(recipe.data.name);
    setMealType(recipe.data.mealType ?? "meal");
    setMealTypeManuallySelected(true);
    setNotes(recipe.data.notes ?? "");
    setItems(recipe.data.items.map(builderItemFromRecipeItem));
    setLoadedRecipeId(recipe.data.id);
    setNotice(null);
  }, [loadedRecipeId, recipe.data]);

  useEffect(() => {
    if (mealTypeManuallySelected) {
      return;
    }

    const suggestedMealType = suggestMealTypeForTime(mealTime);
    if (suggestedMealType) {
      setMealType(suggestedMealType);
    }
  }, [mealTime, mealTypeManuallySelected]);

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

  function addFood(food: FoodSearchResult) {
    setItems((current) => [
      ...current,
      { id: `${food.id}-${Date.now()}-${current.length}`, food, grams: food.servingSize ? String(Math.round(food.servingSize)) : "100" },
    ]);
    setQuery("");
    setNotice(null);
    Keyboard.dismiss();
  }

  function updateGrams(id: string, grams: string) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, grams } : item));
  }

  function removeItem(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
  }

  function moveItem(id: string, direction: "up" | "down") {
    setItems((current) => moveBuilderItem(current, id, direction));
  }

  function reorderItem(id: string, offset: number) {
    setItems((current) => moveBuilderItemByOffset(current, id, offset));
  }

  function duplicateItem(id: string) {
    setItems((current) => duplicateBuilderItem(current, id, `${id}-copy-${Date.now()}`));
  }

  function saveMeal() {
    const invalidItem = items.find((item) => parsePositiveNumber(item.grams) <= 0);
    if (!items.length || invalidItem) {
      setNotice({
        title: "Review meal portions",
        body: invalidItem ? `${readableFoodName(invalidItem.food.displayName)} needs a weight in grams.` : "Add at least one source-backed food before saving.",
        tone: "warning",
      });
      return;
    }

    const loggedAt = combineLocalDateAndTime(mealDate, mealTime);
    if (!loggedAt) {
      setNotice({
        title: "Review meal time",
        body: "Enter a valid local date and 24-hour time, such as 2026-07-12 and 12:30.",
        tone: "warning",
      });
      return;
    }

    Keyboard.dismiss();
    const confirmedMeal = createMealFromBuilder({ name: mealName, mealType, loggedAt, notes, items });
    saveMutation.mutate({
      meal: confirmedMeal,
      idempotencyKey: mealCreateIdempotencyKey(mealActionScope, confirmedMeal),
    });
  }

  function saveRecipe() {
    const invalidItem = items.find((item) => parsePositiveNumber(item.grams) <= 0);
    if (!items.length || invalidItem) {
      setNotice({
        title: "Review recipe portions",
        body: invalidItem ? `${readableFoodName(invalidItem.food.displayName)} needs a weight in grams.` : "Add at least one source-backed food before saving a recipe.",
        tone: "warning",
      });
      return;
    }
    Keyboard.dismiss();
    saveRecipeMutation.mutate();
  }

  if (mealSaved) {
    return (
      <MealBuilderSavedScreen
        onViewToday={() => router.replace("/")}
        onBuildAnother={() => router.replace("/meal-builder")}
      />
    );
  }

  return (
    <KeyboardAvoidingView style={styles.keyboardAvoider} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={styles.screen}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <ScreenShell contentStyle={items.length ? styles.builderContentWithStickyTotal : undefined}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={[styles.eyebrow, themed.actionText]}>{recipeId ? "Edit recipe" : "Meal builder"}</Text>
              <Text style={[styles.title, themed.ink]}>{recipeId ? "Adjust the portions you want to reuse." : "Build a meal around what you actually ate."}</Text>
              <Text style={[styles.body, themed.muted]}>Every item stays linked to its nutrition source. Logged meals remain unchanged when a recipe is edited.</Text>
            </View>
            <Link href="/" asChild>
              <Pressable accessibilityRole="button" accessibilityLabel="Close meal builder" style={[styles.closeButton, themed.subsurface]}>
                <Ionicons name="close" size={22} color={palette.ink} />
              </Pressable>
            </Link>
          </View>

          {recipe.isLoading ? <InlineNotice title="Loading recipe" body="Preparing your saved source-backed portions…" tone="neutral" /> : null}
          {recipe.error ? <InlineNotice title="Recipe could not load" body={recipe.error.message} tone="danger" actions={[{ label: "Back to recipes", onPress: () => router.replace("/recipes"), variant: "secondary" }]} /> : null}

          <Card tone="insight">
            <Text style={[styles.inputLabel, themed.muted]}>Meal name</Text>
            <TextInput accessibilityLabel="Meal name" style={[styles.input, themed.input]} value={mealName} onChangeText={setMealName} placeholder="e.g. Weekday lunch" placeholderTextColor={palette.muted} />
            <Text style={[styles.inputLabel, themed.muted]}>Notes (optional)</Text>
            <TextInput accessibilityLabel="Meal notes" style={[styles.input, themed.input]} value={notes} onChangeText={setNotes} placeholder="Anything helpful for later" placeholderTextColor={palette.muted} />
            <Text style={[styles.inputLabel, themed.muted]}>Meal category</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel="Meal category" style={styles.categoryGrid}>
              {mealCategories.map((category) => (
                <Pressable
                  key={category.value}
                  accessibilityRole="radio"
                  accessibilityLabel={`Set meal category to ${category.label}`}
                  accessibilityState={{ selected: mealType === category.value }}
                  onPress={() => {
                    setMealType(category.value);
                    setMealTypeManuallySelected(true);
                  }}
                  style={[styles.categoryChip, themed.subsurface, mealType === category.value ? styles.categoryChipSelected : undefined]}
                >
                  <Ionicons name={category.icon} size={16} color={mealType === category.value ? palette.onPrimary : themed.actionText.color} />
                  <Text style={[styles.categoryChipText, { color: mealType === category.value ? palette.onPrimary : palette.ink }]}>{category.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.inputLabel, themed.muted]}>When you ate it</Text>
            <Text style={[styles.categoryHint, themed.muted]}>
              {mealTypeManuallySelected
                ? "Category set manually. Changing the time will not overwrite it."
                : `Suggested ${mealCategories.find((category) => category.value === mealType)?.label.toLowerCase() ?? "meal"} from ${mealTime || "the entered time"}. Choose a category above to override.`}
            </Text>
            <View style={styles.timeRow}>
              <TextInput
                accessibilityLabel="Meal date in year month day format"
                style={[styles.dateInput, themed.input]}
                value={mealDate}
                onChangeText={setMealDate}
                placeholder="2026-07-12"
                placeholderTextColor={palette.muted}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />
              <Text style={[styles.timeHint, themed.muted]}>YYYY-MM-DD</Text>
            </View>
            <View style={styles.timeRow}>
              <TextInput
                accessibilityLabel="Meal time in 24-hour format"
                style={[styles.timeInput, themed.input]}
                value={mealTime}
                onChangeText={setMealTime}
                placeholder="12:30"
                placeholderTextColor={palette.muted}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
              />
              <Text style={[styles.timeHint, themed.muted]}>24-hour time</Text>
            </View>
            <View style={styles.timePresetRow}>
              {mealTimePresets.map((preset) => (
                <Pressable
                  key={preset.label}
                  accessibilityRole="button"
                  accessibilityLabel={`Set meal time to ${preset.label}`}
                  accessibilityHint="Sets the meal time. Choose a category separately to keep it fixed."
                  onPress={() => setMealTime(preset.value === "now" ? localTimeKey() : preset.value)}
                  style={[styles.timePreset, themed.subsurface]}
                >
                  <Text style={[styles.timePresetText, themed.actionText]}>{preset.label}</Text>
                </Pressable>
              ))}
            </View>
          </Card>

          <Card>
            <SectionHeader title="Add foods" meta="Search verified sources" />
            <TextInput
              accessibilityLabel="Search foods to add to the meal"
              style={[styles.searchInput, themed.input]}
              value={query}
              onChangeText={setQuery}
              placeholder="Chicken, rice, avocado..."
              placeholderTextColor={palette.muted}
              returnKeyType="search"
            />
            {foods.isLoading ? <Text style={[styles.helper, themed.muted]}>Finding food records…</Text> : null}
            {foods.error ? <InlineNotice title="Food search could not load" body={foods.error.message} tone="warning" /> : null}
            {query.trim().length >= 2 && foods.data?.items.length ? (
              <View style={styles.resultList}>
                {foods.data.items.slice(0, 5).map((food) => (
                  <Pressable key={food.id} accessibilityRole="button" accessibilityLabel={`Add ${readableFoodName(food.displayName)} to meal`} onPress={() => addFood(food)} style={[styles.resultRow, themed.controlSurface]}>
                    <View style={styles.resultCopy}>
                      <Text numberOfLines={2} style={[styles.resultTitle, themed.ink]}>{readableFoodName(food.displayName)}</Text>
                      <Text style={[styles.helper, themed.muted]}>{Math.round(food.nutrientsPer100g.caloriesKcal)} kcal per 100g</Text>
                    </View>
                    <SourceBadge label={food.provider.replaceAll("_", " ")} />
                    <Ionicons name="add-circle" size={24} color={colors.green} />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </Card>

          {notice ? <InlineNotice title={notice.title} body={notice.body} tone={notice.tone} /> : null}

          <Card tone="soft">
            <SectionHeader title="Meal total" meta={items.length ? `${items.length} item${items.length === 1 ? "" : "s"}` : "No items yet"} />
            <Text style={[styles.totalCalories, themed.ink]}>{Math.round(totals.caloriesKcal)} kcal</Text>
            <View style={styles.macroRow}>
              <MacroStatTile label="Protein" value={roundMacro(totals.proteinGrams)} suffix="g" tone="protein" />
              <MacroStatTile label="Carbs" value={roundMacro(totals.carbohydrateGrams)} suffix="g" tone="carbs" />
              <MacroStatTile label="Fat" value={roundMacro(totals.fatGrams)} suffix="g" tone="fat" />
            </View>
          </Card>

          <View style={styles.itemSection}>
            <SectionHeader title="Meal items" meta="Adjust, duplicate, reorder" />
            {items.length ? items.map((item, index) => <BuilderItem key={item.id} item={item} index={index} totalItems={items.length} onChangeGrams={updateGrams} onMove={moveItem} onReorder={reorderItem} onDuplicate={duplicateItem} onRemove={removeItem} />) : (
              <EmptyState title="Start with a food" body="Search above to add verified nutrition records to this meal." icon="restaurant-outline" />
            )}
          </View>

          <View style={styles.saveActions}>
            <ActionButton label={saveMutation.isPending ? "Saving meal…" : "Save meal"} onPress={saveMeal} disabled={saveMutation.isPending || saveRecipeMutation.isPending || !items.length} />
            <ActionButton label={saveRecipeMutation.isPending ? "Saving recipe…" : recipeId ? "Save recipe changes" : "Save as recipe"} variant="secondary" onPress={saveRecipe} disabled={saveMutation.isPending || saveRecipeMutation.isPending || !items.length || recipe.isLoading || Boolean(recipeId && recipe.error)} />
          </View>
          <Text style={[styles.footerHint, themed.muted]}>Meals log to your diary now. Recipes save the same source-backed portions so you can reuse them later.</Text>
          </ScreenShell>
        </TouchableWithoutFeedback>
        {items.length ? (
          <View
            accessible
            accessibilityLabel={`Meal total: ${Math.round(totals.caloriesKcal)} calories, ${roundMacro(totals.proteinGrams)} grams protein, ${roundMacro(totals.carbohydrateGrams)} grams carbohydrates, and ${roundMacro(totals.fatGrams)} grams fat. Updates as you adjust portions.`}
            style={[
              styles.stickyTotalBar,
              {
                bottom: floatingActionBottomOffset({
                  safeAreaBottom: insets.bottom,
                  keyboardBottomInset,
                }),
              },
            ]}
            pointerEvents="none"
          >
            <GlassSurface level="navigation" style={styles.stickyTotalCard} contentStyle={styles.stickyTotalContent}>
              <View style={styles.stickyTotalCopy}>
                <Text style={[styles.stickyTotalLabel, themed.muted]}>Meal total</Text>
                <Text style={[styles.stickyTotalCalories, themed.ink]}>{Math.round(totals.caloriesKcal)} kcal</Text>
              </View>
              <View style={styles.stickyMacroRow}>
                <Text style={[styles.stickyMacro, { color: colors.protein }]}>P {roundMacro(totals.proteinGrams)}g</Text>
                <Text style={[styles.stickyMacro, { color: colors.carbs }]}>C {roundMacro(totals.carbohydrateGrams)}g</Text>
                <Text style={[styles.stickyMacro, { color: colors.fat }]}>F {roundMacro(totals.fatGrams)}g</Text>
              </View>
            </GlassSurface>
          </View>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

function MealBuilderSavedScreen({
  onViewToday,
  onBuildAnother,
}: {
  onViewToday: () => void;
  onBuildAnother: () => void;
}) {
  const { palette } = useTheme();
  const themed = mealBuilderThemeStyles(palette);

  return (
    <ScreenShell contentStyle={styles.savedScreenContent}>
      <View style={styles.savedState}>
        <View accessible accessibilityLabel="Meal saved" style={[styles.savedMark, themed.savedMark]}>
          <Ionicons name="checkmark" size={32} color={colors.white} />
        </View>
        <Text style={[styles.eyebrow, themed.actionText]}>Saved to your diary</Text>
        <Text style={[styles.title, themed.ink]}>Meal saved.</Text>
        <Text style={[styles.body, themed.muted]}>
          Your diary uses the food sources and portions you entered. You can adjust this meal later from Today.
        </Text>
        <View style={styles.savedActions}>
          <ActionButton label="View Today" onPress={onViewToday} />
          <ActionButton label="Build another meal" variant="secondary" onPress={onBuildAnother} />
        </View>
      </View>
    </ScreenShell>
  );
}

function BuilderItem({ item, index, totalItems, onChangeGrams, onMove, onReorder, onDuplicate, onRemove }: { item: MealBuilderItem; index: number; totalItems: number; onChangeGrams: (id: string, grams: string) => void; onMove: (id: string, direction: "up" | "down") => void; onReorder: (id: string, offset: number) => void; onDuplicate: (id: string) => void; onRemove: (id: string) => void }) {
  const { palette } = useTheme();
  const themed = mealBuilderThemeStyles(palette);
  const nutrients = nutrientsForBuilderItem(item);
  const lowConfidence = item.food.recordConfidence === "low";
  const itemPosition = useRef({ index, totalItems });
  itemPosition.current = { index, totalItems };
  const dragOffset = useRef(new Animated.Value(0)).current;
  const dragOriginIndex = useRef(index);
  const dragDestinationIndex = useRef(index);
  const [isDragging, setIsDragging] = useState(false);
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        Math.abs(gesture.dy) > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderGrant: () => {
        const { index: currentIndex } = itemPosition.current;
        dragOriginIndex.current = currentIndex;
        dragDestinationIndex.current = currentIndex;
        setIsDragging(true);
      },
      onPanResponderMove: (_event, gesture) => {
        const { totalItems: currentTotalItems } = itemPosition.current;
        const destination = dragDestinationForOffset({
          originIndex: dragOriginIndex.current,
          totalItems: currentTotalItems,
          translationY: gesture.dy,
        });

        if (destination !== dragDestinationIndex.current) {
          onReorder(item.id, destination - dragDestinationIndex.current);
          dragDestinationIndex.current = destination;
          void Haptics.selectionAsync().catch(() => undefined);
        }

        dragOffset.setValue(Math.max(-30, Math.min(30, gesture.dy * 0.16)));
      },
      onPanResponderRelease: () => {
        setIsDragging(false);
        Animated.spring(dragOffset, { toValue: 0, useNativeDriver: true, tension: 180, friction: 16 }).start();
      },
      onPanResponderTerminate: () => {
        setIsDragging(false);
        Animated.spring(dragOffset, { toValue: 0, useNativeDriver: true, tension: 180, friction: 16 }).start();
      },
    })
  ).current;

  return (
    <Animated.View style={[styles.draggedItem, isDragging ? styles.draggedItemActive : undefined, { transform: [{ translateY: dragOffset }] }]}>
    <SwipeActionRow
      actionLabel={`Delete ${readableFoodName(item.food.displayName)} from meal`}
      accessibilityHint="Swipe left to reveal delete. Standard move, duplicate, and delete controls remain available."
      onAction={() => onRemove(item.id)}
    >
      <Card style={styles.builderItem}>
      <View style={styles.itemTop}>
        <View
          {...panResponder.panHandlers}
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.dragHandle, themed.subsurface]}
        >
          <Ionicons name="reorder-three-outline" size={22} color={palette.muted} />
        </View>
        <View style={styles.itemCopy}>
          <Text numberOfLines={2} style={[styles.itemTitle, themed.ink]}>{readableFoodName(item.food.displayName)}</Text>
          <Text style={[styles.itemOrder, themed.muted]}>Item {index + 1} of {totalItems}. Drag the handle to reorder live, or use the move controls below.</Text>
          <View style={styles.badgeRow}>
            <SourceBadge label={item.food.provider.replaceAll("_", " ")} />
            <StatusPill label={lowConfidence ? "Review source" : "Source matched"} tone={lowConfidence ? "warning" : "success"} />
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${readableFoodName(item.food.displayName)} from meal`} accessibilityHint="Removes this food from the meal." onPress={() => onRemove(item.id)} style={[styles.removeButton, themed.dangerSurface]}>
          <Ionicons name="trash-outline" size={19} color={colors.coral} />
        </Pressable>
      </View>
      <View style={styles.itemControls}>
        <GlassIconButton icon="chevron-up" label={`Move ${readableFoodName(item.food.displayName)} up`} onPress={() => onMove(item.id, "up")} disabled={index === 0} />
        <GlassIconButton icon="chevron-down" label={`Move ${readableFoodName(item.food.displayName)} down`} onPress={() => onMove(item.id, "down")} disabled={index === totalItems - 1} />
        <GlassIconButton icon="copy-outline" label={`Duplicate ${readableFoodName(item.food.displayName)}`} onPress={() => onDuplicate(item.id)} />
        <Text style={[styles.controlHint, themed.muted]}>Reorder or repeat</Text>
      </View>
      <View style={styles.portionRow}>
        <View style={styles.gramsField}>
          <Text style={[styles.inputLabel, themed.muted]}>Weight in grams</Text>
          <TextInput accessibilityLabel={`Weight in grams for ${readableFoodName(item.food.displayName)}`} style={[styles.gramsInput, themed.input]} value={item.grams} onChangeText={(grams) => onChangeGrams(item.id, grams)} placeholderTextColor={palette.muted} keyboardType="decimal-pad" />
        </View>
        <View style={[styles.itemMacro, themed.subsurface]}>
          <Text style={[styles.itemMacroValue, themed.ink]}>{Math.round(nutrients.caloriesKcal)}</Text>
          <Text style={[styles.itemMacroLabel, themed.actionText]}>kcal</Text>
        </View>
      </View>
      <Text style={[styles.itemMeta, themed.muted]}>{roundMacro(nutrients.proteinGrams)}g protein · {roundMacro(nutrients.carbohydrateGrams)}g carbs · {roundMacro(nutrients.fatGrams)}g fat</Text>
      </Card>
    </SwipeActionRow>
    </Animated.View>
  );
}

export function dragDestinationForOffset({
  originIndex,
  totalItems,
  translationY,
}: {
  originIndex: number;
  totalItems: number;
  translationY: number;
}) {
  if (totalItems <= 1) {
    return 0;
  }

  const requestedOffset = Math.round(translationY / DRAG_REORDER_STEP_PX);
  return Math.min(Math.max(originIndex + requestedOffset, 0), totalItems - 1);
}

function mealBuilderThemeStyles(palette: ThemePalette) {
  return {
    ink: { color: palette.ink },
    muted: { color: palette.muted },
    actionText: { color: palette.actionText },
    controlSurface: { backgroundColor: palette.controlSurface },
    subsurface: { backgroundColor: palette.surfaceAlt },
    dangerSurface: { backgroundColor: palette.mode === "dark" ? "rgba(223, 104, 82, 0.22)" : colors.coralSoft },
    savedMark: { backgroundColor: palette.mode === "dark" ? colors.green : colors.greenDeep },
    input: {
      backgroundColor: palette.controlSurface,
      borderColor: palette.border,
      color: palette.ink,
    },
  };
}

const styles = StyleSheet.create({
  keyboardAvoider: { flex: 1 },
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  headerCopy: { flex: 1, gap: spacing.xs },
  eyebrow: { ...typography.eyebrow, color: colors.green },
  title: { ...typography.display, color: colors.ink },
  body: { ...typography.body, color: colors.muted },
 closeButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, backgroundColor: colors.limeSoft },
 inputLabel: { ...typography.caption, color: colors.muted },
  categoryHint: { ...typography.caption, color: colors.muted, marginTop: -spacing.xs },
 input: { minHeight: 50, borderRadius: radii.md, paddingHorizontal: spacing.md, backgroundColor: "rgba(255,255,255,0.70)", color: colors.ink },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  categoryChip: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.xs, borderRadius: radii.pill, paddingHorizontal: spacing.sm, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.surfaceAlt },
  categoryChipSelected: { backgroundColor: colors.green, borderColor: colors.green },
  categoryChipText: { ...typography.caption, color: colors.ink },
  categoryChipTextSelected: { color: colors.white },
  timeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dateInput: { width: 128, minHeight: 44, borderRadius: radii.md, paddingHorizontal: spacing.sm, backgroundColor: colors.background, color: colors.ink, textAlign: "center" },
  timeInput: { width: 104, minHeight: 44, borderRadius: radii.md, paddingHorizontal: spacing.sm, backgroundColor: colors.background, color: colors.ink, textAlign: "center" },
  timeHint: { ...typography.caption, flex: 1, color: colors.muted },
  timePresetRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  timePreset: { minHeight: 44, justifyContent: "center", borderRadius: radii.pill, paddingHorizontal: spacing.sm, backgroundColor: colors.limeSoft },
  timePresetText: { ...typography.caption, color: colors.greenDeep },
  searchInput: { minHeight: 52, borderRadius: radii.md, paddingHorizontal: spacing.md, backgroundColor: colors.background, color: colors.ink },
  helper: { ...typography.caption, color: colors.muted },
  resultList: { gap: spacing.xs },
  resultRow: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radii.md, padding: spacing.sm, backgroundColor: "rgba(255,255,255,0.58)" },
  resultCopy: { flex: 1, minWidth: 0, gap: 2 },
  resultTitle: { ...typography.caption, color: colors.ink },
  totalCalories: { ...typography.displayLarge, color: colors.ink },
  macroRow: { flexDirection: "row", gap: spacing.sm },
  itemSection: { gap: spacing.sm },
  draggedItem: { zIndex: 0 },
  draggedItemActive: { zIndex: 2, opacity: 0.96 },
  builderItem: { gap: spacing.sm },
  itemTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  dragHandle: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radii.md },
  itemCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  itemTitle: { ...typography.heading, color: colors.ink },
  itemOrder: { ...typography.caption, color: colors.muted },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  removeButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, backgroundColor: colors.coralSoft },
  itemControls: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.xs },
  controlHint: { ...typography.caption, color: colors.muted, marginLeft: spacing.xs },
  portionRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.md },
  gramsField: { flex: 1, gap: spacing.xs },
  gramsInput: { minHeight: 48, borderRadius: radii.md, paddingHorizontal: spacing.md, backgroundColor: colors.background, color: colors.ink },
  itemMacro: { minWidth: 76, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radii.md, backgroundColor: colors.limeSoft },
  itemMacroValue: { ...typography.heading, color: colors.greenDeep },
  itemMacroLabel: { ...typography.caption, color: colors.green },
  itemMeta: { ...typography.caption, color: colors.muted },
  footerHint: { ...typography.caption, color: colors.muted, textAlign: "center" },
  saveActions: { gap: spacing.sm },
  builderContentWithStickyTotal: { paddingBottom: 168 },
  stickyTotalBar: { position: "absolute", left: spacing.lg, right: spacing.lg },
  stickyTotalCard: { minHeight: 70, borderRadius: radii.lg },
  stickyTotalContent: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  stickyTotalCopy: { flexShrink: 0, gap: 1 },
  stickyTotalLabel: { ...typography.caption, color: colors.muted },
  stickyTotalCalories: { ...typography.heading, color: colors.ink },
  stickyMacroRow: { flex: 1, flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", columnGap: spacing.sm, rowGap: spacing.xs },
  stickyMacro: { ...typography.caption, fontVariant: ["tabular-nums"] },
  savedScreenContent: { flexGrow: 1, justifyContent: "center" },
  savedState: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xxl, paddingHorizontal: spacing.md },
  savedMark: { width: 72, height: 72, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.greenDeep },
  savedActions: { alignSelf: "stretch", gap: spacing.sm, marginTop: spacing.sm },
});
