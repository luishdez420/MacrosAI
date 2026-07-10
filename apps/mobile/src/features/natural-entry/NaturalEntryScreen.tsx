import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
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
import { colors, radii, spacing, typography } from "@living-nutrition/design-tokens";
import { calculateConsumedNutrients } from "@living-nutrition/validation";
import { api } from "../../services/api";
import {
  ActionButton,
  Card,
  InlineNotice,
  readableFoodName,
  ScreenShell,
  SourceBadge,
  StatusPill,
} from "../../shared/components/LivingUI";
import { createMealFromFood, portionLabel } from "../food-logging/foodLogging";
import { parseNaturalEntry, type ParsedNaturalEntry } from "./naturalEntryParsing";

type ResolvedEntry = {
  draft: ParsedNaturalEntry;
  candidates: FoodSearchResult[];
  error?: string;
  selectedFoodId?: string;
};

export function NaturalEntryScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [entryText, setEntryText] = useState("150 g grilled chicken; 2 oz cooked rice");
  const [resolvedEntries, setResolvedEntries] = useState<ResolvedEntry[]>([]);
  const [notice, setNotice] = useState<{ title: string; body: string; tone: "warning" | "danger" } | null>(null);

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
    mutationFn: (meal: MealCreate) => api.createMeal(meal),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["diary"] });
      await queryClient.invalidateQueries({ queryKey: ["foods", "recent"] });
      router.replace("/");
    },
    onError: (error) => {
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

    const items = selected.flatMap(({ entry, food }) => {
      if (!food) {
        return [];
      }

      const nutrients = calculateConsumedNutrients(food.nutrientsPer100g, entry.draft.grams);
      return createMealFromFood({
        food,
        grams: entry.draft.grams,
        servingLabel: portionLabel(entry.draft.portionMode, entry.draft.amount, undefined),
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
    logMutation.mutate({
      name: items.length === 1 ? items[0]?.displayName ?? "Natural entry" : "Natural entry meal",
      notes: "Parsed from explicit weights and confirmed provider records.",
      items,
    });
  }

  return (
    <KeyboardAvoidingView style={styles.keyboardAvoider} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScreenShell>
          <View style={styles.header}>
            <Text style={styles.eyebrow}>Natural entry</Text>
            <Text style={styles.title}>Describe it, then confirm the records.</Text>
            <Text style={styles.body}>
              Use explicit grams or ounces and separate foods with semicolons or new lines. Each
              result still needs a source-backed food selection before it can be logged.
            </Text>
          </View>

          <Card>
            <Text style={styles.inputLabel}>Meal description</Text>
            <TextInput
              accessibilityLabel="Meal description with explicit weights"
              multiline
              style={styles.input}
              value={entryText}
              onChangeText={setEntryText}
              placeholder="150 g grilled chicken; 2 oz cooked rice"
              textAlignVertical="top"
              onSubmitEditing={Keyboard.dismiss}
            />
            <Text style={styles.hint}>
              Supported: “150 g grilled chicken” or “2 oz cooked rice”. Cups, pieces, and vague
              portions need a weight first because mass cannot be safely inferred.
            </Text>
            <ActionButton
              label={resolveMutation.isPending ? "Finding food records..." : "Find food records"}
              onPress={resolveEntry}
              disabled={resolveMutation.isPending}
            />
          </Card>

          {notice ? <InlineNotice title={notice.title} body={notice.body} tone={notice.tone} /> : null}

          {resolvedEntries.map((entry) => (
            <Card key={entry.draft.id}>
              <View style={styles.entryHeader}>
                <View style={styles.entryCopy}>
                  <Text style={styles.entryTitle}>{readableFoodName(entry.draft.query)}</Text>
                  <Text style={styles.entryMeta}>
                    {entry.draft.enteredLabel} · {Math.round(entry.draft.grams)}g used for calculation
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
              <View style={styles.candidateList}>
                {entry.candidates.map((candidate) => {
                  const selected = candidate.id === entry.selectedFoodId;
                  return (
                    <Pressable
                      key={candidate.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Use ${readableFoodName(candidate.displayName)} for ${entry.draft.query}`}
                      accessibilityState={{ selected }}
                      style={[styles.candidate, selected ? styles.selectedCandidate : undefined]}
                      onPress={() => selectFood(entry.draft.id, candidate.id)}
                    >
                      <View style={styles.candidateCopy}>
                        <Text numberOfLines={2} style={styles.candidateTitle}>{readableFoodName(candidate.displayName)}</Text>
                        <Text style={styles.entryMeta}>{Math.round(candidate.nutrientsPer100g.caloriesKcal)} kcal per 100g</Text>
                      </View>
                      <SourceBadge label={candidate.provider.replaceAll("_", " ")} tone={selected ? "success" : "neutral"} />
                    </Pressable>
                  );
                })}
              </View>
            </Card>
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
});
