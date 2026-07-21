import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
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

import type { FoodSearchResult, MealCreate } from "@living-nutrition/shared-types";
import { colors, radii, spacing, typography, type ThemePalette } from "@living-nutrition/design-tokens";
import { calculateConsumedNutrients } from "@living-nutrition/validation";
import { api, getStoredUserId } from "../../services/api";
import { queueConfirmedMeal } from "../../services/offlineMealQueue";
import {
  ActionButton,
  Card,
  InlineNotice,
  readableFoodName,
  ScreenShell,
  SourceBadge,
  StatusPill,
} from "../../shared/components/LivingUI";
import { useTheme } from "../../shared/theme/ThemeProvider";
import { createMealActionScope, mealCreateIdempotencyKey } from "../../shared/domain/mealIdempotency";
import { canQueueConfirmedMeal } from "../../shared/domain/offlineMealSync";
import {
  createMealFromFood,
  getServingGramWeight,
  portionLabel,
} from "../food-logging/foodLogging";
import {
  gramsForNaturalEntry,
  parseNaturalEntry,
  type ParsedNaturalEntry,
} from "./naturalEntryParsing";

type ResolvedEntry = {
  draft: ParsedNaturalEntry;
  candidates: FoodSearchResult[];
  error?: string;
  selectedFoodId?: string;
};

export function NaturalEntryScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { palette } = useTheme();
  const themed = naturalEntryThemeStyles(palette);
  const mealActionScope = useRef(createMealActionScope("natural")).current;
  const [entryText, setEntryText] = useState("150 g grilled chicken; two eggs");
  const [resolvedEntries, setResolvedEntries] = useState<ResolvedEntry[]>([]);
  const [notice, setNotice] = useState<{ title: string; body: string; tone: "warning" | "danger" } | null>(null);
  const [mealSaved, setMealSaved] = useState(false);

  const resolveMutation = useMutation({
    mutationFn: async (items: ParsedNaturalEntry[]) =>
      Promise.all(
        items.map(async (draft): Promise<ResolvedEntry> => {
          try {
            const response = await api.searchFoods(draft.query);
            return { draft, candidates: response.items.slice(0, 3) };
          } catch (error) {
            return {
              draft,
              candidates: [],
              error: error instanceof Error ? error.message : "Search failed.",
            };
          }
        })
      ),
    onSuccess: (entries) => {
      setResolvedEntries(entries);
      setNotice(null);
    },
  });
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
            setNotice({
              title: "Confirmed meal queued",
              body: "We could not reach Living Nutrition, so these source-backed foods are saved on this device and will stay in your queue until you sync them from Today.",
              tone: "warning",
            });
            return;
          } catch {
            // Use the normal recovery message if device storage is unavailable.
          }
        }
      }

      setNotice({ title: "Meal was not saved", body: error.message, tone: "danger" });
    },
  });

  function resolveEntry() {
    Keyboard.dismiss();
    const parsed = parseNaturalEntry(entryText);
    if (!parsed.ok) {
      setResolvedEntries([]);
      setNotice({ title: "Review the entry", body: parsed.message, tone: "warning" });
      return;
    }

    resolveMutation.mutate(parsed.items);
  }

  function selectFood(entryId: string, foodId: string) {
    setResolvedEntries((entries) =>
      entries.map((entry) =>
        entry.draft.id === entryId ? { ...entry, selectedFoodId: foodId } : entry
      )
    );
    setNotice(null);
  }

  function logNaturalMeal() {
    const selected = resolvedEntries.map((entry) => ({
      entry,
      food: entry.candidates.find((candidate) => candidate.id === entry.selectedFoodId),
    }));
    const missingSelection = selected.find(({ food }) => !food);

    if (missingSelection) {
      setNotice({
        title: "Choose every food record",
        body: `Select a source-backed match for “${missingSelection.entry.draft.query}” before logging.`,
        tone: "warning",
      });
      return;
    }

    const missingServingWeight = selected.find(({ entry, food }) =>
      food
        ? gramsForNaturalEntry(entry.draft, getServingGramWeight(food)) <= 0
        : false
    );
    if (missingServingWeight?.food) {
      setNotice({
        title: "Serving weight needs confirmation",
        body: `“${readableFoodName(missingServingWeight.food.displayName)}” has no verified gram weight for a serving. Use grams or ounces instead.`,
        tone: "warning",
      });
      return;
    }

    const items = selected.flatMap(({ entry, food }) => {
      if (!food) {
        return [];
      }

      const servingGramWeight = getServingGramWeight(food);
      const grams = gramsForNaturalEntry(entry.draft, servingGramWeight);
      const nutrients = calculateConsumedNutrients(food.nutrientsPer100g, grams);
      return createMealFromFood({
        food,
        grams,
        servingLabel: portionLabel(entry.draft.portionMode, entry.draft.amount, servingGramWeight),
        nutrients,
        servingQuantity: Number(entry.draft.amount),
        portionMode: entry.draft.portionMode,
        source: "natural",
      }).items;
    });

    if (!items.length) {
      return;
    }

    Keyboard.dismiss();
    const confirmedMeal: MealCreate = {
      name: items.length === 1 ? items[0]?.displayName ?? "Natural entry" : "Natural entry meal",
      notes: "Parsed from user-entered quantities and confirmed provider records.",
      items,
    };
    logMutation.mutate({
      meal: confirmedMeal,
      idempotencyKey: mealCreateIdempotencyKey(mealActionScope, confirmedMeal),
    });
  }

  if (mealSaved) {
    return <NaturalEntrySavedScreen onViewToday={() => router.replace("/")} onLogAnother={() => router.replace("/natural-entry")} />;
  }

  return (
    <KeyboardAvoidingView style={styles.keyboardAvoider} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScreenShell>
          <View style={styles.header}>
            <Text style={[styles.eyebrow, themed.actionText]}>Natural entry</Text>
            <Text style={[styles.title, themed.ink]}>Describe it, then confirm the records.</Text>
            <Text style={[styles.body, themed.muted]}>
              Use grams, ounces, or simple counts and separate foods with semicolons or new lines.
              Each result still needs a source-backed food selection before it can be logged.
            </Text>
          </View>

          <Card>
            <Text style={[styles.inputLabel, themed.muted]}>Meal description</Text>
            <TextInput
              accessibilityLabel="Meal description with weights or source-serving counts"
              multiline
              style={[styles.input, themed.input]}
              value={entryText}
              onChangeText={setEntryText}
              placeholder="150 g grilled chicken; two eggs"
              placeholderTextColor={palette.muted}
              textAlignVertical="top"
              onSubmitEditing={Keyboard.dismiss}
            />
            <Text style={[styles.hint, themed.muted]}>
              Supported: “150 g grilled chicken”, “2 oz cooked rice”, or “two eggs”. Counts only
              work when the selected source has a verified gram serving. Cups and volume measures
              need grams or ounces because mass cannot be safely inferred.
            </Text>
            <ActionButton
              label={resolveMutation.isPending ? "Finding food records..." : "Find food records"}
              onPress={resolveEntry}
              disabled={resolveMutation.isPending}
            />
          </Card>

          {notice ? <InlineNotice title={notice.title} body={notice.body} tone={notice.tone} /> : null}

          {resolvedEntries.map((entry) => (
            <NaturalEntryCard
              key={entry.draft.id}
              entry={entry}
              onSelectFood={selectFood}
              palette={palette}
              themed={themed}
            />
          ))}

          {resolvedEntries.length ? (
            <ActionButton
              label={logMutation.isPending ? "Logging meal..." : "Log confirmed meal"}
              onPress={logNaturalMeal}
              disabled={logMutation.isPending || resolveMutation.isPending}
            />
          ) : null}
        </ScreenShell>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

function NaturalEntrySavedScreen({ onViewToday, onLogAnother }: { onViewToday: () => void; onLogAnother: () => void }) {
  const { palette } = useTheme();
  const themed = naturalEntryThemeStyles(palette);

  return (
    <ScreenShell contentStyle={styles.savedScreenContent}>
      <View style={styles.savedState}>
        <View accessible accessibilityLabel="Meal saved" style={[styles.savedMark, themed.savedMark]}>
          <Ionicons name="checkmark" size={32} color={colors.white} />
        </View>
        <Text style={[styles.eyebrow, themed.actionText]}>Saved to your diary</Text>
        <Text style={[styles.title, themed.ink]}>Meal saved.</Text>
        <Text style={[styles.body, themed.muted]}>Your diary uses the food records and quantities you confirmed. You can adjust this meal later from Today.</Text>
        <View style={styles.savedActions}>
          <ActionButton label="View Today" onPress={onViewToday} />
          <ActionButton label="Log another meal" variant="secondary" onPress={onLogAnother} />
        </View>
      </View>
    </ScreenShell>
  );
}

function NaturalEntryCard({
  entry,
  onSelectFood,
  palette,
  themed,
}: {
  entry: ResolvedEntry;
  onSelectFood: (entryId: string, foodId: string) => void;
  palette: ThemePalette;
  themed: ReturnType<typeof naturalEntryThemeStyles>;
}) {
  const selectedFood = entry.candidates.find((candidate) => candidate.id === entry.selectedFoodId);
  const servingGramWeight = selectedFood ? getServingGramWeight(selectedFood) : undefined;
  const grams = selectedFood ? gramsForNaturalEntry(entry.draft, servingGramWeight) : entry.draft.grams;
  const needsServingWeight = entry.draft.portionMode === "servings" && Boolean(selectedFood) && !grams;

  return (
    <Card>
      <View style={styles.entryHeader}>
        <View style={styles.entryCopy}>
          <Text style={[styles.entryTitle, themed.ink]}>{readableFoodName(entry.draft.query)}</Text>
          <Text style={[styles.entryMeta, themed.muted]}>
            {entry.draft.enteredLabel} · {grams ? `${Math.round(grams)}g used for calculation` : "select a verified serving weight"}
          </Text>
        </View>
        <StatusPill label={entry.selectedFoodId ? "Selected" : "Needs selection"} tone={entry.selectedFoodId ? "success" : "warning"} />
      </View>
      {entry.error ? <InlineNotice title="Search could not finish" body={entry.error} tone="warning" /> : null}
      {!entry.error && !entry.candidates.length ? (
        <InlineNotice
          title="No source-backed match"
          body="Try a simpler food name or use Manual Search to create a custom food."
          tone="warning"
        />
      ) : null}
      {needsServingWeight ? (
        <InlineNotice
          title="Serving gram weight unavailable"
          body="This record cannot safely convert the count you entered. Choose another record or use grams or ounces."
          tone="warning"
        />
      ) : null}
      <View accessibilityRole="radiogroup" accessibilityLabel={`Food records for ${entry.draft.query}`} style={styles.candidateList}>
        {entry.candidates.map((candidate) => {
          const selected = candidate.id === entry.selectedFoodId;
          const candidateServingWeight = getServingGramWeight(candidate);
          const candidateGrams = gramsForNaturalEntry(entry.draft, candidateServingWeight);
          const countNeedsVerifiedWeight = entry.draft.portionMode === "servings" && !candidateGrams;
          return (
            <Pressable
              key={candidate.id}
              accessibilityRole="radio"
              accessibilityLabel={`Use ${readableFoodName(candidate.displayName)} for ${entry.draft.query}`}
              accessibilityHint={
                countNeedsVerifiedWeight
                  ? "This record has no verified gram weight for the count you entered."
                  : undefined
              }
              accessibilityState={{ selected }}
              style={[styles.candidate, themed.controlSurface, selected ? styles.selectedCandidate : undefined]}
              onPress={() => onSelectFood(entry.draft.id, candidate.id)}
            >
              <View style={styles.candidateCopy}>
                <Text numberOfLines={2} style={[styles.candidateTitle, themed.ink]}>{readableFoodName(candidate.displayName)}</Text>
                <Text style={[styles.entryMeta, themed.muted]}>
                  {entry.draft.portionMode === "servings"
                    ? candidateGrams
                      ? `${Math.round(candidateGrams)}g from ${entry.draft.amount} source serving${Number(entry.draft.amount) === 1 ? "" : "s"}`
                      : "No verified gram weight for this serving"
                    : `${Math.round(candidate.nutrientsPer100g.caloriesKcal)} kcal per 100g`}
                </Text>
              </View>
              <SourceBadge label={candidate.provider.replaceAll("_", " ")} tone={selected ? "success" : "neutral"} />
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

function naturalEntryThemeStyles(palette: ThemePalette) {
  return {
    ink: { color: palette.ink },
    muted: { color: palette.muted },
    actionText: { color: palette.actionText },
    controlSurface: { backgroundColor: palette.controlSurface },
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
  header: { gap: spacing.xs },
  eyebrow: { ...typography.eyebrow, color: colors.muted },
  title: { ...typography.display, color: colors.ink },
  body: { ...typography.body, color: colors.muted },
  inputLabel: { ...typography.caption, color: colors.muted },
  input: {
    minHeight: 126,
    borderRadius: radii.md,
    padding: spacing.md,
    backgroundColor: colors.background,
    color: colors.ink,
  },
  hint: { ...typography.caption, color: colors.muted },
  entryHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  entryCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  entryTitle: { ...typography.heading, color: colors.ink },
  entryMeta: { ...typography.caption, color: colors.muted },
  candidateList: { gap: spacing.sm },
  candidate: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radii.md,
    padding: spacing.md,
    backgroundColor: colors.background,
  },
  selectedCandidate: { borderWidth: 2, borderColor: colors.green },
  candidateCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  candidateTitle: { ...typography.button, color: colors.ink },
  savedScreenContent: { flexGrow: 1, justifyContent: "center" },
  savedState: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xxl, paddingHorizontal: spacing.md },
  savedMark: { width: 72, height: 72, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, backgroundColor: colors.greenDeep },
  savedActions: { alignSelf: "stretch", gap: spacing.sm, marginTop: spacing.sm },
});
