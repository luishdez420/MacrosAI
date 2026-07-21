import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";

import { colors, radii, spacing, typography, type ThemePalette } from "@living-nutrition/design-tokens";
import type { FoodSearchResult, MealItemRead, MealRead, NutrientPer100g } from "@living-nutrition/shared-types";
import { api } from "../../services/api";
import {
  ActionButton,
  Card,
  InlineNotice,
  MacroStatTile,
  readableFoodName,
  ScreenShell,
  SectionHeader,
  SourceBadge,
  sourceLabel,
  StatusPill,
} from "../../shared/components/LivingUI";
import { useTheme } from "../../shared/theme/ThemeProvider";
import { foodDetailHref } from "../food-detail/foodDetailLinks";
import {
  buildEditedMealItem,
  buildAddedMealDraft,
  buildAddedMealItem,
  buildReplacementMealItem,
  formatPortionNutrientRows,
  getNutrientsPer100gFromSnapshot,
  parsePositiveNumber,
  roundNumber,
  scaleNutrients,
} from "./mealEditing";
import { combineLocalDateAndTime, dateForLoggedAt, timeForLoggedAt } from "../../shared/domain/mealTiming";

export function MealDetailScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { palette } = useTheme();
  const themed = mealDetailThemeStyles(palette);
  const params = useLocalSearchParams<{ id?: string }>();
  const mealId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [gramsByItemId, setGramsByItemId] = useState<Record<string, string>>({});
  const [replacementsByItemId, setReplacementsByItemId] = useState<Record<string, FoodSearchResult>>({});
  const [addedItems, setAddedItems] = useState<Array<{ item: MealItemRead; food: FoodSearchResult }>>([]);
  const [removedItemIds, setRemovedItemIds] = useState<string[]>([]);
  const [mealDate, setMealDate] = useState("");
  const [mealTime, setMealTime] = useState("");
  const [timeError, setTimeError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [completion, setCompletion] = useState<"updated" | "deleted" | null>(null);
  const meal = useQuery({
    queryKey: ["meal", mealId],
    queryFn: () => api.getMeal(mealId || ""),
    enabled: Boolean(mealId),
  });
  const updateMutation = useMutation({
    mutationFn: ({ updatedMeal, loggedAt }: { updatedMeal: MealRead; loggedAt: string }) =>
      api.updateMeal(updatedMeal.id, {
        name: updatedMeal.name,
        mealType: updatedMeal.mealType,
        loggedAt,
        notes: updatedMeal.notes,
        items: editableItems.map((item) => {
          const grams = parsePositiveNumber(gramsByItemId[item.id]) || item.consumedGrams;
          const replacement = replacementsByItemId[item.id];
          const addedItem = addedItems.find((candidate) => candidate.item.id === item.id);
          if (addedItem) {
            return buildAddedMealItem(replacement ?? addedItem.food, grams);
          }
          return replacement
            ? buildReplacementMealItem(item, replacement, grams)
            : buildEditedMealItem(item, grams);
        }),
      }),
    onSuccess: async (updatedMeal) => {
      await queryClient.invalidateQueries({ queryKey: ["diary"] });
      await queryClient.invalidateQueries({ queryKey: ["meal", updatedMeal.id] });
      setActionError(null);
      setCompletion("updated");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    },
    onError: (error) => setActionError(error.message),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteMeal(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["diary"] });
      setActionError(null);
      setDeleteConfirmationOpen(false);
      setCompletion("deleted");
    },
    onError: (error) => setActionError(error.message),
  });
  const deleteImageMutation = useMutation({
    mutationFn: ({ mealId: targetMealId, imageId }: { mealId: string; imageId: string }) =>
      api.deleteMealImage(targetMealId, imageId),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["meal", variables.mealId] });
      await queryClient.invalidateQueries({ queryKey: ["diary"] });
      setActionError(null);
    },
    onError: (error) => setActionError(error.message),
  });

  useEffect(() => {
    if (!meal.data) {
      return;
    }

    setGramsByItemId(
      Object.fromEntries(meal.data.items.map((item) => [item.id, String(roundNumber(item.consumedGrams))]))
    );
    setMealDate(dateForLoggedAt(meal.data.loggedAt));
    setMealTime(timeForLoggedAt(meal.data.loggedAt));
    setTimeError(null);
    setReplacementsByItemId({});
    setAddedItems([]);
    setRemovedItemIds([]);
  }, [meal.data]);

  const editableItems = meal.data
    ? [
        ...meal.data.items.filter((item) => !removedItemIds.includes(item.id)),
        ...addedItems.map(({ item }) => item),
      ]
    : [];

  function saveMeal() {
    if (!meal.data) {
      return;
    }

    if (!editableItems.length) {
      setActionError("Keep at least one food in this meal, or delete the meal instead.");
      return;
    }

    const loggedAt = combineLocalDateAndTime(mealDate, mealTime);
    if (!loggedAt) {
      setTimeError("Enter a valid local date and 24-hour time, such as 2026-07-12 and 12:30.");
      return;
    }

    Keyboard.dismiss();
    updateMutation.mutate({ updatedMeal: meal.data, loggedAt });
  }

  function requestDelete() {
    if (!meal.data) {
      return;
    }

    setActionError(null);
    setDeleteConfirmationOpen(true);
  }

  function addFood(food: FoodSearchResult) {
    const id = `draft-added-food-${Date.now()}-${addedItems.length}`;
    const item = buildAddedMealDraft(food, id);
    setAddedItems((current) => [...current, { item, food }]);
    setGramsByItemId((current) => ({ ...current, [id]: String(item.consumedGrams) }));
    setActionError(null);
  }

  function removeFood(item: MealItemRead) {
    if (editableItems.length <= 1) {
      setActionError("Keep at least one food in this meal, or delete the meal instead.");
      return;
    }

    if (addedItems.some((candidate) => candidate.item.id === item.id)) {
      setAddedItems((current) => current.filter((candidate) => candidate.item.id !== item.id));
    } else {
      setRemovedItemIds((current) => [...current, item.id]);
    }

    setReplacementsByItemId((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
  }

  function restoreFood(itemId: string) {
    setRemovedItemIds((current) => current.filter((id) => id !== itemId));
  }

  const adjustedTotals = meal.data
    ? totalsForMeal(editableItems, gramsByItemId, replacementsByItemId)
    : emptyNutrients();

  if (completion) {
    return <MealDetailCompletionScreen completion={completion} onViewToday={() => router.replace("/")} />;
  }

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoider}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScreenShell>
          <View style={styles.headerRow}>
            <View style={styles.headerCopy}>
              <Text style={[styles.eyebrow, themed.muted]}>Meal details</Text>
              <Text style={[styles.title, themed.ink]}>
                {meal.data ? readableFoodName(meal.data.name) : "Loading meal"}
              </Text>
              <Text style={[styles.body, themed.muted]}>
                Adjust the actual grams eaten. Macros are recalculated from the saved nutrition snapshot.
              </Text>
            </View>
            <Pressable style={styles.textButton} onPress={() => router.back()}>
              <Text style={[styles.textButtonLabel, themed.actionText]}>Close</Text>
            </Pressable>
          </View>

          {meal.error ? (
            <InlineNotice title="Meal could not load" body={meal.error.message} tone="danger" />
          ) : null}

          {actionError ? (
            <InlineNotice
              title={deleteConfirmationOpen ? "Meal was not deleted" : "Meal was not updated"}
              body={actionError}
              tone="danger"
              actions={[{ label: "Dismiss", onPress: () => setActionError(null), variant: "secondary" }]}
            />
          ) : null}

          {meal.data ? (
            <Card>
              <SectionHeader title="When you ate it" meta="Used to place this meal in your diary" />
              <View style={styles.timeRow}>
                <TextInput
                  accessibilityLabel="Meal date in year month day format"
                  style={[styles.dateInput, themed.input]}
                  value={mealDate}
                  onChangeText={(value) => {
                    setMealDate(value);
                    setTimeError(null);
                  }}
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
                  onChangeText={(value) => {
                    setMealTime(value);
                    setTimeError(null);
                  }}
                  placeholder="12:30"
                  placeholderTextColor={palette.muted}
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                />
                <Text style={[styles.timeHint, themed.muted]}>24-hour local time</Text>
              </View>
              {timeError ? <Text style={[styles.timeError, themed.dangerText]}>{timeError}</Text> : null}
            </Card>
          ) : null}

          {meal.data?.images?.length ? (
            <Card tone="soft">
              <SectionHeader title="Private scan photos" meta={`${meal.data.images.length} kept`} />
              <Text style={[styles.body, themed.muted]}>
                These photos were explicitly kept with this meal. They are private and will be deleted automatically at the scheduled retention deadline. You can remove one now.
              </Text>
              <View style={styles.imagePrivacyList}>
                {meal.data.images.map((image, index) => (
                  <View key={image.id} style={[styles.imagePrivacyRow, themed.subsurface]}>
                    <View style={styles.imagePrivacyCopy}>
                      <Text style={[styles.imagePrivacyTitle, themed.ink]}>Scan photo {index + 1}</Text>
                      <Text style={[styles.sourceText, themed.muted]}>
                        {image.retentionDeadline
                          ? `Scheduled for deletion ${new Date(image.retentionDeadline).toLocaleDateString()}.`
                          : "Scheduled deletion is being confirmed."}
                      </Text>
                    </View>
                    <ActionButton
                      label={deleteImageMutation.isPending ? "Deleting..." : "Delete photo"}
                      variant="secondary"
                      onPress={() => deleteImageMutation.mutate({ mealId: meal.data?.id ?? "", imageId: image.id })}
                      disabled={deleteImageMutation.isPending}
                      accessibilityHint="Permanently removes this private scan photo while keeping the saved meal and nutrition snapshot."
                    />
                  </View>
                ))}
              </View>
            </Card>
          ) : null}

          <Card>
            <SectionHeader title="Adjusted total" meta="Based on portion entered" />
            <Text style={[styles.calorieTotal, themed.ink]}>{Math.round(adjustedTotals.caloriesKcal)} kcal</Text>
            <View style={styles.macroGrid}>
              <MacroStatTile style={styles.macroTile} label="Protein" value={roundNumber(adjustedTotals.proteinGrams)} suffix="g" tone="protein" />
              <MacroStatTile style={styles.macroTile} label="Carbs" value={roundNumber(adjustedTotals.carbohydrateGrams)} suffix="g" tone="carbs" />
              <MacroStatTile style={styles.macroTile} label="Fat" value={roundNumber(adjustedTotals.fatGrams)} suffix="g" tone="fat" />
            </View>
          </Card>

          <FullNutritionBreakdown nutrients={adjustedTotals} />

          <View style={styles.panel}>
            <SectionHeader title="Foods" meta="Add, replace, or remove before saving" />
            {meal.data ? <AddFoodControl onAddFood={addFood} /> : null}
            {editableItems.map((item) => (
              <MealItemEditor
                key={item.id}
                item={item}
                mealId={mealId ?? ""}
                grams={gramsByItemId[item.id] ?? String(roundNumber(item.consumedGrams))}
                replacement={replacementsByItemId[item.id]}
                isAdded={addedItems.some((candidate) => candidate.item.id === item.id)}
                canRemove={editableItems.length > 1}
                onChangeGrams={(value) =>
                  setGramsByItemId((current) => ({
                    ...current,
                    [item.id]: value,
                  }))
                }
                onSelectReplacement={(replacement) =>
                  setReplacementsByItemId((current) => ({ ...current, [item.id]: replacement }))
                }
                onClearReplacement={() =>
                  setReplacementsByItemId((current) => {
                    const next = { ...current };
                    delete next[item.id];
                    return next;
                  })
                }
                onRemove={() => removeFood(item)}
              />
            ))}
            {meal.data && removedItemIds.length ? (
              <InlineNotice
                title={`${removedItemIds.length} food${removedItemIds.length === 1 ? "" : "s"} removed`}
                body="The removed food will stay out of this meal when you save. You can restore it before then."
                tone="warning"
                actions={meal.data.items
                  .filter((item) => removedItemIds.includes(item.id))
                  .map((item) => ({
                    label: `Restore ${readableFoodName(item.displayName)}`,
                    onPress: () => restoreFood(item.id),
                    variant: "secondary" as const,
                  }))}
              />
            ) : null}
            {!meal.data && !meal.isLoading ? <Text style={[styles.body, themed.muted]}>Meal not found.</Text> : null}
          </View>

          {meal.data ? (
            <View style={styles.actionStack}>
              <ActionButton
                label={updateMutation.isPending ? "Saving..." : "Save adjusted meal"}
                onPress={saveMeal}
                disabled={updateMutation.isPending}
              />
              <ActionButton
                label={deleteMutation.isPending ? "Deleting..." : "Delete meal"}
                variant="secondary"
                onPress={requestDelete}
                disabled={deleteMutation.isPending || updateMutation.isPending}
              />
              {deleteConfirmationOpen ? (
                <InlineNotice
                  title={`Delete ${readableFoodName(meal.data.name)}?`}
                  body="This removes the saved meal from your diary. This cannot be undone."
                  tone="danger"
                  actions={[
                    {
                      label: "Keep meal",
                      onPress: () => setDeleteConfirmationOpen(false),
                      variant: "secondary",
                    },
                    {
                      label: deleteMutation.isPending ? "Deleting..." : "Delete meal",
                      onPress: () => deleteMutation.mutate(meal.data.id),
                      variant: "danger",
                      disabled: deleteMutation.isPending,
                    },
                  ]}
                />
              ) : null}
            </View>
          ) : null}
        </ScreenShell>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

function MealDetailCompletionScreen({
  completion,
  onViewToday,
}: {
  completion: "updated" | "deleted";
  onViewToday: () => void;
}) {
  const { palette } = useTheme();
  const themed = mealDetailThemeStyles(palette);
  const updated = completion === "updated";

  return (
    <ScreenShell contentStyle={styles.savedScreenContent}>
      <View style={styles.savedState}>
        <View
          accessible
          accessibilityLabel={updated ? "Meal updated" : "Meal deleted"}
          style={[styles.savedMark, updated ? themed.savedMark : themed.deletedMark]}
        >
          <Ionicons name={updated ? "checkmark" : "trash-outline"} size={30} color={colors.white} />
        </View>
        <Text style={[styles.eyebrow, themed.actionText]}>{updated ? "Diary updated" : "Removed from your diary"}</Text>
        <Text style={[styles.title, themed.ink]}>{updated ? "Meal updated." : "Meal deleted."}</Text>
        <Text style={[styles.body, themed.muted]}>
          {updated
            ? "Your diary now reflects the portions and time you confirmed."
            : "This saved meal and its snapshot are no longer part of your diary totals."}
        </Text>
        <View style={styles.savedActions}>
          <ActionButton label="View Today" onPress={onViewToday} />
        </View>
      </View>
    </ScreenShell>
  );
}

function FullNutritionBreakdown({ nutrients }: { nutrients: NutrientPer100g }) {
  const { palette } = useTheme();
  const themed = mealDetailThemeStyles(palette);

  return (
    <Card>
      <SectionHeader title="Full nutrition" meta="Based on portion entered" />
      <Text style={[styles.breakdownDescription, themed.muted]}>
        Values recalculate from the saved source snapshot as you adjust food amounts. Only nutrients
        preserved with this meal are shown.
      </Text>
      <View style={[styles.nutrientTable, themed.tableBorder]}>
        {formatPortionNutrientRows(nutrients).map((row) => (
          <View
            key={row.label}
            style={[styles.nutrientRow, themed.tableRow]}
            accessible
            accessibilityLabel={row.accessibilityLabel}
          >
            <Text style={[styles.nutrientLabel, themed.muted]}>{row.label}</Text>
            <Text style={[styles.nutrientValue, themed.ink]}>{row.value}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

function MealItemEditor({
  item,
  mealId,
  grams,
  replacement,
  isAdded,
  canRemove,
  onChangeGrams,
  onSelectReplacement,
  onClearReplacement,
  onRemove,
}: {
  item: MealItemRead;
  mealId: string;
  grams: string;
  replacement?: FoodSearchResult;
  isAdded: boolean;
  canRemove: boolean;
  onChangeGrams: (value: string) => void;
  onSelectReplacement: (replacement: FoodSearchResult) => void;
  onClearReplacement: () => void;
  onRemove: () => void;
}) {
  const { palette } = useTheme();
  const themed = mealDetailThemeStyles(palette);
  const [replacementSearchOpen, setReplacementSearchOpen] = useState(false);
  const [replacementQuery, setReplacementQuery] = useState("");
  const consumedGrams = parsePositiveNumber(grams) || item.consumedGrams;
  const replacementSearch = useQuery({
    queryKey: ["meal-detail-replacement-search", item.id, replacementQuery],
    queryFn: () => api.searchFoods(replacementQuery),
    enabled: replacementSearchOpen && replacementQuery.trim().length >= 2,
  });
  const displayedName = replacement?.displayName ?? item.displayName;
  const displayedProvider = replacement?.provider ?? item.sourceProvider;
  const displayedFoodId = replacement?.id ?? item.foodId;
  const nutrientsPer100g = replacement?.nutrientsPer100g ?? getNutrientsPer100gFromSnapshot(item);
  const nutrients = scaleNutrients(nutrientsPer100g, consumedGrams);

  function selectReplacement(food: FoodSearchResult) {
    onSelectReplacement(food);
    setReplacementSearchOpen(false);
    setReplacementQuery("");
  }

  return (
    <Card>
      <View style={styles.itemTop}>
        <View style={styles.itemCopy}>
          <Text style={[styles.itemTitle, themed.ink]}>{readableFoodName(displayedName)}</Text>
          <View style={styles.badgeRow}>
            <SourceBadge label={sourceLabel(displayedProvider)} tone={replacement ? "warning" : "success"} />
            <StatusPill label={replacement ? "Replacement selected" : isAdded ? "Added" : item.userConfirmed ? "Confirmed" : "Needs confirmation"} tone={replacement || !item.userConfirmed ? "warning" : "success"} />
          </View>
        </View>
      </View>

      <View style={styles.amountRow}>
        <View style={styles.amountInputWrap}>
          <Text style={[styles.inputLabel, themed.muted]}>Actual grams eaten</Text>
          <TextInput
            accessibilityLabel={`Actual grams eaten for ${readableFoodName(displayedName)}`}
            style={[styles.amountInput, themed.input]}
            value={grams}
            onChangeText={onChangeGrams}
            placeholderTextColor={palette.muted}
            keyboardType="decimal-pad"
            returnKeyType="done"
            onSubmitEditing={Keyboard.dismiss}
          />
        </View>
        <View style={[styles.servingHint, themed.subsurface]}>
          <Text style={[styles.servingHintValue, themed.ink]}>{Math.round(consumedGrams)}g</Text>
          <Text style={[styles.servingHintLabel, themed.muted]}>used</Text>
        </View>
      </View>

        <Text style={[styles.itemMeta, themed.muted]}>
          {Math.round(nutrients.caloriesKcal)} kcal · {roundNumber(nutrients.proteinGrams)}g protein · {replacement
            ? "Recalculated from the selected record and grams entered."
            : item.confidence.explanation}
        </Text>
      {replacement ? (
        <InlineNotice
          title="Replacement ready to save"
          body={`The provider record for ${readableFoodName(replacement.displayName)} will replace the saved food when you save this meal. The previous source remains in the new snapshot context.`}
          tone="warning"
          actions={[{ label: "Keep previous food", onPress: onClearReplacement, variant: "secondary" }]}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${replacementSearchOpen ? "Close" : "Search for a replacement for"} ${readableFoodName(displayedName)}`}
        accessibilityState={{ expanded: replacementSearchOpen }}
        onPress={() => setReplacementSearchOpen((current) => !current)}
        style={[styles.replaceButton, themed.subsurface]}
      >
        <Ionicons name="search-outline" size={17} color={palette.actionText} />
        <Text style={[styles.replaceButtonText, themed.actionText]}>{replacementSearchOpen ? "Close food search" : "Replace food"}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${readableFoodName(displayedName)} from this meal`}
        accessibilityHint={canRemove ? "The change is not saved until you save this meal." : "A meal must have at least one food."}
        accessibilityState={{ disabled: !canRemove }}
        disabled={!canRemove}
        onPress={onRemove}
        style={[styles.removeButton, themed.removeButton, !canRemove ? styles.disabledButton : null]}
      >
        <Ionicons name="trash-outline" size={17} color={palette.dangerText} />
        <Text style={[styles.removeButtonText, themed.dangerText]}>Remove food</Text>
      </Pressable>
      {replacementSearchOpen ? (
        <View style={styles.replacementSearch}>
          <TextInput
            accessibilityLabel={`Search food records to replace ${readableFoodName(item.displayName)}`}
            accessibilityHint="Select a provider record before saving this meal"
            style={[styles.replacementInput, themed.input]}
            value={replacementQuery}
            onChangeText={setReplacementQuery}
            placeholder="Search provider records"
            placeholderTextColor={palette.muted}
            returnKeyType="search"
            onSubmitEditing={Keyboard.dismiss}
          />
          {replacementSearch.isLoading ? <Text style={[styles.itemMeta, themed.muted]}>Finding provider records...</Text> : null}
          {replacementSearch.error ? <InlineNotice title="Food search could not load" body={replacementSearch.error.message} tone="warning" /> : null}
          {replacementQuery.trim().length >= 2 && replacementSearch.data?.items.length ? (
            <View style={styles.replacementResults}>
              {replacementSearch.data.items.slice(0, 5).map((food) => (
                <Pressable
                  key={food.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${readableFoodName(food.displayName)} as the replacement food`}
                  accessibilityHint={`Uses ${Math.round(food.nutrientsPer100g.caloriesKcal)} calories per 100 grams from ${sourceLabel(food.provider)}`}
                  onPress={() => selectReplacement(food)}
                  style={[styles.replacementResult, themed.subsurface]}
                >
                  <View style={styles.replacementResultCopy}>
                    <Text numberOfLines={2} style={[styles.replacementResultTitle, themed.ink]}>{readableFoodName(food.displayName)}</Text>
                    <Text style={[styles.itemMeta, themed.muted]}>{Math.round(food.nutrientsPer100g.caloriesKcal)} kcal per 100g</Text>
                  </View>
                  <SourceBadge label={sourceLabel(food.provider)} tone={food.recordConfidence === "low" || food.recordConfidence === "medium" ? "warning" : "success"} />
                </Pressable>
              ))}
            </View>
          ) : null}
          {replacementQuery.trim().length >= 2 && replacementSearch.data && !replacementSearch.data.items.length ? (
            <InlineNotice title="No provider records found" body="Try a shorter or more specific food name. Your saved food will stay unchanged unless you select a replacement." tone="warning" />
          ) : null}
        </View>
      ) : null}
      <Link
        href={foodDetailHref(displayedFoodId, {
          mealId,
          itemId: item.id,
          contextLabel: "Saved meal source",
        })}
        asChild
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View nutrition source for ${readableFoodName(displayedName)}`}
          style={[styles.sourceButton, themed.subsurface]}
        >
          <Text style={[styles.sourceButtonText, themed.actionText]}>View source</Text>
        </Pressable>
      </Link>
    </Card>
  );
}

function AddFoodControl({ onAddFood }: { onAddFood: (food: FoodSearchResult) => void }) {
  const { palette } = useTheme();
  const themed = mealDetailThemeStyles(palette);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = useQuery({
    queryKey: ["meal-detail-add-food-search", query],
    queryFn: () => api.searchFoods(query),
    enabled: open && query.trim().length >= 2,
  });

  function selectFood(food: FoodSearchResult) {
    onAddFood(food);
    setOpen(false);
    setQuery("");
  }

  return (
    <View style={styles.addFoodControl}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? "Close add food search" : "Add another food to this meal"}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((current) => !current)}
        style={[styles.addFoodButton, themed.subsurface]}
      >
        <Ionicons name={open ? "close-outline" : "add-outline"} size={19} color={palette.actionText} />
        <Text style={[styles.replaceButtonText, themed.actionText]}>{open ? "Close food search" : "Add food"}</Text>
      </Pressable>
      {open ? (
        <View style={styles.replacementSearch}>
          <TextInput
            accessibilityLabel="Search provider records to add to this meal"
            accessibilityHint="Select a food record, then set the grams eaten before saving"
            style={[styles.replacementInput, themed.input]}
            value={query}
            onChangeText={setQuery}
            placeholder="Search food records"
            placeholderTextColor={palette.muted}
            returnKeyType="search"
            onSubmitEditing={Keyboard.dismiss}
          />
          {search.isLoading ? <Text style={[styles.itemMeta, themed.muted]}>Finding provider records...</Text> : null}
          {search.error ? <InlineNotice title="Food search could not load" body={search.error.message} tone="warning" /> : null}
          {query.trim().length >= 2 && search.data?.items.length ? (
            <View style={styles.replacementResults}>
              {search.data.items.slice(0, 5).map((food) => (
                <Pressable
                  key={food.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${readableFoodName(food.displayName)} to this meal`}
                  accessibilityHint={`Starts at 100 grams and uses ${Math.round(food.nutrientsPer100g.caloriesKcal)} calories per 100 grams from ${sourceLabel(food.provider)}`}
                  onPress={() => selectFood(food)}
                  style={[styles.replacementResult, themed.subsurface]}
                >
                  <View style={styles.replacementResultCopy}>
                    <Text numberOfLines={2} style={[styles.replacementResultTitle, themed.ink]}>{readableFoodName(food.displayName)}</Text>
                    <Text style={[styles.itemMeta, themed.muted]}>{Math.round(food.nutrientsPer100g.caloriesKcal)} kcal per 100g</Text>
                  </View>
                  <SourceBadge label={sourceLabel(food.provider)} tone={food.recordConfidence === "low" || food.recordConfidence === "medium" ? "warning" : "success"} />
                </Pressable>
              ))}
            </View>
          ) : null}
          {query.trim().length >= 2 && search.data && !search.data.items.length ? (
            <InlineNotice title="No provider records found" body="Try a shorter or more specific food name." tone="warning" />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function totalsForMeal(
  items: MealItemRead[],
  gramsByItemId: Record<string, string>,
  replacementsByItemId: Record<string, FoodSearchResult>
): NutrientPer100g {
  return items.reduce<NutrientPer100g>((total, item) => {
    const grams = parsePositiveNumber(gramsByItemId[item.id]) || item.consumedGrams;
    const nutrients = scaleNutrients(replacementsByItemId[item.id]?.nutrientsPer100g ?? getNutrientsPer100gFromSnapshot(item), grams);
    return {
      caloriesKcal: total.caloriesKcal + nutrients.caloriesKcal,
      proteinGrams: total.proteinGrams + nutrients.proteinGrams,
      carbohydrateGrams: total.carbohydrateGrams + nutrients.carbohydrateGrams,
      fatGrams: total.fatGrams + nutrients.fatGrams,
      fiberGrams: (total.fiberGrams ?? 0) + (nutrients.fiberGrams ?? 0),
      sugarGrams: (total.sugarGrams ?? 0) + (nutrients.sugarGrams ?? 0),
      sodiumMilligrams: (total.sodiumMilligrams ?? 0) + (nutrients.sodiumMilligrams ?? 0),
    };
  }, emptyNutrients());
}

function emptyNutrients(): NutrientPer100g {
  return {
    caloriesKcal: 0,
    proteinGrams: 0,
    carbohydrateGrams: 0,
    fatGrams: 0,
    fiberGrams: 0,
    sugarGrams: 0,
    sodiumMilligrams: 0,
  };
}

function mealDetailThemeStyles(palette: ThemePalette) {
  return {
    ink: { color: palette.ink },
    muted: { color: palette.muted },
    actionText: { color: palette.actionText },
    dangerText: { color: palette.dangerText },
    removeButton: { borderColor: palette.dangerText },
    savedMark: { backgroundColor: palette.mode === "dark" ? colors.green : colors.greenDeep },
    deletedMark: { backgroundColor: palette.mode === "dark" ? colors.coral : colors.coral },
    subsurface: { backgroundColor: palette.surfaceAlt },
    tableBorder: { borderColor: palette.border },
    tableRow: { borderBottomColor: palette.border },
    input: {
      backgroundColor: palette.controlSurface,
      borderColor: palette.border,
      color: palette.ink,
    },
  };
}

const styles = StyleSheet.create({
  keyboardAvoider: {
    flex: 1,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  headerCopy: {
    flex: 1,
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
  sourceText: {
    ...typography.caption,
    color: colors.muted,
  },
  textButton: {
    minHeight: 44,
    justifyContent: "center",
  },
  textButtonLabel: {
    ...typography.button,
    color: colors.green,
  },
  calorieTotal: {
    fontSize: 52,
    lineHeight: 58,
    fontWeight: "800",
    color: colors.ink,
  },
  macroGrid: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  macroTile: {
    flexBasis: "30%",
  },
  breakdownDescription: {
    ...typography.caption,
    color: colors.muted,
  },
  nutrientTable: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  nutrientRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  nutrientLabel: {
    ...typography.body,
    color: colors.muted,
  },
  nutrientValue: {
    ...typography.body,
    fontVariant: ["tabular-nums"],
    color: colors.ink,
  },
  timeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dateInput: { width: 128, minHeight: 46, borderRadius: radii.md, paddingHorizontal: spacing.sm, backgroundColor: colors.background, color: colors.ink, textAlign: "center" },
  timeInput: { width: 106, minHeight: 46, borderRadius: radii.md, paddingHorizontal: spacing.sm, backgroundColor: colors.background, color: colors.ink, textAlign: "center" },
  timeHint: { ...typography.caption, flex: 1, color: colors.muted },
  timeError: { ...typography.caption, color: colors.coral },
  panel: {
    gap: spacing.md,
  },
  itemTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  itemCopy: {
    flex: 1,
    gap: spacing.sm,
  },
  itemTitle: {
    ...typography.heading,
    color: colors.ink,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
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
  itemMeta: {
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
  replaceButton: {
    minHeight: 44,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
  },
  replaceButtonText: {
    ...typography.caption,
    fontWeight: "800",
  },
  addFoodControl: {
    gap: spacing.sm,
  },
  addFoodButton: {
    minHeight: 44,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
  },
  removeButton: {
    minHeight: 44,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
  },
  removeButtonText: {
    ...typography.caption,
    fontWeight: "800",
  },
  disabledButton: {
    opacity: 0.45,
  },
  replacementSearch: {
    gap: spacing.sm,
  },
  replacementInput: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    ...typography.body,
  },
  replacementResults: {
    gap: spacing.xs,
  },
  replacementResult: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  replacementResultCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  replacementResultTitle: {
    ...typography.caption,
    fontWeight: "800",
  },
  actionStack: {
    gap: spacing.sm,
  },
  imagePrivacyList: {
    gap: spacing.sm,
  },
  imagePrivacyRow: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  imagePrivacyCopy: {
    flex: 1,
    gap: spacing.xxs,
  },
  imagePrivacyTitle: {
    ...typography.button,
  },
  savedScreenContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  savedState: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.md,
  },
  savedMark: {
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.greenDeep,
  },
  savedActions: {
    alignSelf: "stretch",
    marginTop: spacing.md,
  },
});
