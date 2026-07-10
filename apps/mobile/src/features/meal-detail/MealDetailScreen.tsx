import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
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

import { colors, radii, spacing, typography } from "@living-nutrition/design-tokens";
import type { MealItemRead, MealRead, NutrientPer100g } from "@living-nutrition/shared-types";
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
import { foodDetailHref } from "../food-detail/foodDetailLinks";
import {
  buildEditedMealItem,
  getNutrientsPer100gFromSnapshot,
  parsePositiveNumber,
  roundNumber,
  scaleNutrients,
} from "./mealEditing";

export function MealDetailScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string }>();
  const mealId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [gramsByItemId, setGramsByItemId] = useState<Record<string, string>>({});
  const meal = useQuery({
    queryKey: ["meal", mealId],
    queryFn: () => api.getMeal(mealId || ""),
    enabled: Boolean(mealId),
  });
  const updateMutation = useMutation({
    mutationFn: (updatedMeal: MealRead) =>
      api.updateMeal(updatedMeal.id, {
        name: updatedMeal.name,
        notes: updatedMeal.notes,
        items: updatedMeal.items.map((item) => {
          const grams = parsePositiveNumber(gramsByItemId[item.id]) || item.consumedGrams;
          return buildEditedMealItem(item, grams);
        }),
      }),
    onSuccess: async (updatedMeal) => {
      await queryClient.invalidateQueries({ queryKey: ["diary"] });
      await queryClient.invalidateQueries({ queryKey: ["meal", updatedMeal.id] });
      router.replace("/");
    },
    onError: (error) => {
      Alert.alert("Meal was not updated", error.message);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteMeal(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["diary"] });
      router.replace("/");
    },
    onError: (error) => {
      Alert.alert("Meal was not deleted", error.message);
    },
  });

  useEffect(() => {
    if (!meal.data) {
      return;
    }

    setGramsByItemId(
      Object.fromEntries(meal.data.items.map((item) => [item.id, String(roundNumber(item.consumedGrams))]))
    );
  }, [meal.data]);

  function saveMeal() {
    if (!meal.data) {
      return;
    }

    Keyboard.dismiss();
    updateMutation.mutate(meal.data);
  }

  function confirmDelete() {
    if (!meal.data) {
      return;
    }

    Alert.alert("Delete meal?", `${readableFoodName(meal.data.name)} will be removed from your diary.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => deleteMutation.mutate(meal.data.id),
      },
    ]);
  }

  const adjustedTotals = meal.data ? totalsForMeal(meal.data.items, gramsByItemId) : emptyNutrients();

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoider}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScreenShell>
          <View style={styles.headerRow}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>Meal details</Text>
              <Text style={styles.title}>
                {meal.data ? readableFoodName(meal.data.name) : "Loading meal"}
              </Text>
              <Text style={styles.body}>
                Adjust the actual grams eaten. Macros are recalculated from the saved nutrition snapshot.
              </Text>
            </View>
            <Pressable style={styles.textButton} onPress={() => router.back()}>
              <Text style={styles.textButtonLabel}>Close</Text>
            </Pressable>
          </View>

          {meal.error ? (
            <InlineNotice title="Meal could not load" body={meal.error.message} tone="danger" />
          ) : null}

          <Card>
            <SectionHeader title="Adjusted total" meta="Based on portion entered" />
            <Text style={styles.calorieTotal}>{Math.round(adjustedTotals.caloriesKcal)} kcal</Text>
            <View style={styles.macroGrid}>
              <MacroStatTile style={styles.macroTile} label="Protein" value={roundNumber(adjustedTotals.proteinGrams)} suffix="g" tone="protein" />
              <MacroStatTile style={styles.macroTile} label="Carbs" value={roundNumber(adjustedTotals.carbohydrateGrams)} suffix="g" tone="carbs" />
              <MacroStatTile style={styles.macroTile} label="Fat" value={roundNumber(adjustedTotals.fatGrams)} suffix="g" tone="fat" />
            </View>
          </Card>

          <View style={styles.panel}>
            <SectionHeader title="Foods" />
            {meal.data?.items.map((item) => (
              <MealItemEditor
                key={item.id}
                item={item}
                mealId={meal.data.id}
                grams={gramsByItemId[item.id] ?? String(roundNumber(item.consumedGrams))}
                onChangeGrams={(value) =>
                  setGramsByItemId((current) => ({
                    ...current,
                    [item.id]: value,
                  }))
                }
              />
            ))}
            {!meal.data && !meal.isLoading ? <Text style={styles.body}>Meal not found.</Text> : null}
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
                onPress={confirmDelete}
                disabled={deleteMutation.isPending}
              />
            </View>
          ) : null}
        </ScreenShell>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

function MealItemEditor({
  item,
  mealId,
  grams,
  onChangeGrams,
}: {
  item: MealItemRead;
  mealId: string;
  grams: string;
  onChangeGrams: (value: string) => void;
}) {
  const consumedGrams = parsePositiveNumber(grams) || item.consumedGrams;
  const nutrientsPer100g = getNutrientsPer100gFromSnapshot(item);
  const nutrients = scaleNutrients(nutrientsPer100g, consumedGrams);

  return (
    <Card>
      <View style={styles.itemTop}>
        <View style={styles.itemCopy}>
          <Text style={styles.itemTitle}>{readableFoodName(item.displayName)}</Text>
          <View style={styles.badgeRow}>
            <SourceBadge label={sourceLabel(item.sourceProvider)} tone="success" />
            <StatusPill label={item.userConfirmed ? "Confirmed" : "Needs confirmation"} tone={item.userConfirmed ? "success" : "warning"} />
          </View>
        </View>
      </View>

      <View style={styles.amountRow}>
        <View style={styles.amountInputWrap}>
          <Text style={styles.inputLabel}>Actual grams eaten</Text>
          <TextInput
            style={styles.amountInput}
            value={grams}
            onChangeText={onChangeGrams}
            keyboardType="decimal-pad"
            returnKeyType="done"
            onSubmitEditing={Keyboard.dismiss}
          />
        </View>
        <View style={styles.servingHint}>
          <Text style={styles.servingHintValue}>{Math.round(consumedGrams)}g</Text>
          <Text style={styles.servingHintLabel}>used</Text>
        </View>
      </View>

        <Text style={styles.itemMeta}>
          {Math.round(nutrients.caloriesKcal)} kcal · {roundNumber(nutrients.proteinGrams)}g protein ·{" "}
          {item.confidence.explanation}
        </Text>
      <Link
        href={foodDetailHref(item.foodId, {
          mealId,
          itemId: item.id,
          contextLabel: "Saved meal source",
        })}
        asChild
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View nutrition source for ${readableFoodName(item.displayName)}`}
          style={styles.sourceButton}
        >
          <Text style={styles.sourceButtonText}>View source</Text>
        </Pressable>
      </Link>
    </Card>
  );
}

function totalsForMeal(items: MealItemRead[], gramsByItemId: Record<string, string>): NutrientPer100g {
  return items.reduce<NutrientPer100g>((total, item) => {
    const grams = parsePositiveNumber(gramsByItemId[item.id]) || item.consumedGrams;
    const nutrients = scaleNutrients(getNutrientsPer100gFromSnapshot(item), grams);
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
  actionStack: {
    gap: spacing.sm,
  },
});
