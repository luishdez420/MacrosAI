import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { Link, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { MealType, RecipeRead } from "@living-nutrition/shared-types";
import { colors, radii, spacing, typography, type ThemePalette } from "@living-nutrition/design-tokens";
import { api } from "../../services/api";
import { actionIdempotencyKey, createMealActionScope } from "../../shared/domain/mealIdempotency";
import {
  ActionButton,
  Card,
  EmptyState,
  ErrorState,
  InlineNotice,
  MacroStatTile,
  ScreenShell,
  SkeletonBlock,
} from "../../shared/components/LivingUI";
import { useTheme } from "../../shared/theme/ThemeProvider";

export function RecipeLibraryScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { palette } = useTheme();
  const themed = recipeThemeStyles(palette);
  const [actionError, setActionError] = useState<string | null>(null);
  const [recipeAwaitingDeletionId, setRecipeAwaitingDeletionId] = useState<string | null>(null);
  const [recipeLogged, setRecipeLogged] = useState(false);
  const recipeLogScopes = useRef(new Map<string, string>());
  const recipes = useQuery({ queryKey: ["recipes"], queryFn: () => api.listRecipes() });
  const logMutation = useMutation({
    mutationFn: ({ recipeId, idempotencyKey }: { recipeId: string; idempotencyKey: string }) =>
      api.logRecipe(recipeId, { idempotencyKey }),
    onSuccess: async (_result, variables) => {
      recipeLogScopes.current.delete(variables.recipeId);
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ["diary"] });
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
      await queryClient.invalidateQueries({ queryKey: ["foods", "recent"] });
      setRecipeLogged(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    },
    onError: (error) => setActionError(error.message),
  });
  const deleteMutation = useMutation({
    mutationFn: (recipeId: string) => api.deleteRecipe(recipeId),
    onSuccess: async () => {
      setActionError(null);
      setRecipeAwaitingDeletionId(null);
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
    },
    onError: (error) => setActionError(error.message),
  });

  if (recipeLogged) {
    return (
      <RecipeLoggedScreen
        onViewToday={() => router.replace("/")}
        onLogAnother={() => setRecipeLogged(false)}
      />
    );
  }

  return (
    <ScreenShell>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={[styles.eyebrow, themed.actionText]}>Recipe library</Text>
          <Text style={[styles.title, themed.ink]}>Repeat meals without rebuilding them.</Text>
          <Text style={[styles.body, themed.muted]}>Recipes preserve the source-backed foods and portions you chose. Logging one creates a new editable meal snapshot.</Text>
        </View>
        <Link href="/" asChild>
          <Pressable accessibilityRole="button" accessibilityLabel="Close recipes" style={[styles.closeButton, themed.subsurface]}><Ionicons name="close" size={22} color={palette.ink} /></Pressable>
        </Link>
      </View>
      {recipes.error ? <ErrorState title="Recipes could not load" body={recipes.error.message} onRetry={() => void recipes.refetch()} /> : null}
      {actionError ? <InlineNotice title="Recipe action could not finish" body={actionError} tone="danger" actions={[{ label: "Dismiss", onPress: () => setActionError(null), variant: "secondary" }]} /> : null}
      {recipes.isLoading ? <RecipeLibrarySkeleton /> : null}
      {!recipes.isLoading && !recipes.data?.length ? (
        <EmptyState title="No recipes yet" body="Build a multi-food meal, then save it as a recipe whenever you want to reuse the same portions." actionLabel="Build a meal" onAction={() => router.push("/meal-builder")} icon="layers-outline" />
      ) : null}
      {recipes.data?.map((recipe) => (
        <RecipeCard
          key={recipe.id}
          recipe={recipe}
          saving={logMutation.isPending}
          deleting={deleteMutation.isPending && recipeAwaitingDeletionId === recipe.id}
          deleteConfirmationOpen={recipeAwaitingDeletionId === recipe.id}
          onLog={() => {
            const actionScope = recipeLogScopes.current.get(recipe.id) ?? createMealActionScope("recipe-log");
            recipeLogScopes.current.set(recipe.id, actionScope);
            logMutation.mutate({
              recipeId: recipe.id,
              idempotencyKey: actionIdempotencyKey(actionScope, { recipeId: recipe.id }),
            });
          }}
          onEdit={() => router.push({ pathname: "/meal-builder", params: { recipeId: recipe.id } })}
          onRequestDelete={() => setRecipeAwaitingDeletionId(recipe.id)}
          onCancelDelete={() => setRecipeAwaitingDeletionId(null)}
          onConfirmDelete={() => deleteMutation.mutate(recipe.id)}
        />
      ))}
    </ScreenShell>
  );
}

function RecipeLoggedScreen({
  onViewToday,
  onLogAnother,
}: {
  onViewToday: () => void;
  onLogAnother: () => void;
}) {
  const { palette } = useTheme();
  const themed = recipeThemeStyles(palette);

  return (
    <ScreenShell contentStyle={styles.savedScreenContent}>
      <View style={styles.savedState}>
        <View accessible accessibilityLabel="Meal saved" style={[styles.savedMark, themed.savedMark]}>
          <Ionicons name="checkmark" size={32} color={colors.white} />
        </View>
        <Text style={[styles.eyebrow, themed.actionText]}>Saved to your diary</Text>
        <Text style={[styles.title, themed.ink]}>Meal saved.</Text>
        <Text style={[styles.body, themed.muted]}>
          Your recipe was logged as a new meal with the source-backed portions you saved. You can adjust it later from Today.
        </Text>
        <View style={styles.savedActions}>
          <ActionButton label="View Today" onPress={onViewToday} />
          <ActionButton label="Back to recipes" variant="secondary" onPress={onLogAnother} />
        </View>
      </View>
    </ScreenShell>
  );
}

function RecipeLibrarySkeleton() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading saved recipes" style={styles.loadingStack}>
      {["recipe-skeleton-1", "recipe-skeleton-2"].map((key) => (
        <Card key={key} style={styles.loadingCard}>
          <View style={styles.loadingHeading}>
            <SkeletonBlock width="54%" height={20} />
            <SkeletonBlock width={44} height={44} />
          </View>
          <SkeletonBlock width="72%" height={14} />
          <SkeletonBlock width="34%" height={32} />
          <View style={styles.loadingMacroRow}>
            <SkeletonBlock width="31%" height={88} />
            <SkeletonBlock width="31%" height={88} />
            <SkeletonBlock width="31%" height={88} />
          </View>
          <SkeletonBlock width="100%" height={52} />
        </Card>
      ))}
    </View>
  );
}

function RecipeCard({
  recipe,
  saving,
  deleting,
  deleteConfirmationOpen,
  onLog,
  onEdit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  recipe: RecipeRead;
  saving: boolean;
  deleting: boolean;
  deleteConfirmationOpen: boolean;
  onLog: () => void;
  onEdit: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const { palette } = useTheme();
  const themed = recipeThemeStyles(palette);
  const totals = recipe.items.reduce((total, item) => ({
    calories: total.calories + item.calories,
    protein: total.protein + item.proteinGrams,
    carbs: total.carbs + item.carbohydrateGrams,
    fat: total.fat + item.fatGrams,
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

  return (
    <Card>
      <View style={styles.recipeTop}>
        <View style={styles.recipeCopy}>
          <Text numberOfLines={2} style={[styles.recipeTitle, themed.ink]}>{recipe.name}</Text>
          <Text style={[styles.recipeMeta, themed.muted]}>{mealTypeLabel(recipe.mealType)} · {recipe.items.length} food{recipe.items.length === 1 ? "" : "s"} · used {recipe.timesUsed} time{recipe.timesUsed === 1 ? "" : "s"}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${recipe.name}`} accessibilityHint="Opens an inline confirmation. Logged meals will not be changed." onPress={onRequestDelete} disabled={deleting || saving} style={[styles.deleteButton, themed.dangerSurface]}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
      </View>
      {deleteConfirmationOpen ? (
        <InlineNotice
          title={`Remove ${recipe.name}?`}
          body="This removes the saved recipe only. Meals already logged from it will remain in your diary."
          tone="danger"
          actions={[
            { label: "Keep recipe", onPress: onCancelDelete, variant: "secondary" },
            { label: deleting ? "Removing recipe…" : "Remove recipe", onPress: onConfirmDelete, variant: "danger", disabled: deleting },
          ]}
        />
      ) : null}
      {recipe.notes ? <Text style={[styles.recipeNotes, themed.muted]}>{recipe.notes}</Text> : null}
      <Text style={[styles.calorieValue, themed.ink]}>{Math.round(totals.calories)} kcal</Text>
      <View style={styles.macroRow}>
        <MacroStatTile label="Protein" value={Math.round(totals.protein)} suffix="g" tone="protein" />
        <MacroStatTile label="Carbs" value={Math.round(totals.carbs)} suffix="g" tone="carbs" />
        <MacroStatTile label="Fat" value={Math.round(totals.fat)} suffix="g" tone="fat" />
      </View>
      <ActionButton label="Edit recipe" variant="secondary" onPress={onEdit} disabled={saving || deleting} />
      <ActionButton label={saving ? "Logging…" : "Log to today"} onPress={onLog} disabled={saving || deleting} />
    </Card>
  );
}

function mealTypeLabel(mealType: MealType | undefined) {
  const labels: Record<MealType, string> = {
    breakfast: "Breakfast",
    lunch: "Lunch",
    dinner: "Dinner",
    snack: "Snack",
    meal: "Any time",
  };

  return labels[mealType ?? "meal"];
}

function recipeThemeStyles(palette: ThemePalette) {
  return {
    ink: { color: palette.ink },
    muted: { color: palette.muted },
    actionText: { color: palette.actionText },
    subsurface: { backgroundColor: palette.surfaceAlt },
    dangerSurface: { backgroundColor: palette.mode === "dark" ? "rgba(223, 104, 82, 0.22)" : colors.coralSoft },
    savedMark: { backgroundColor: palette.mode === "dark" ? colors.green : colors.greenDeep },
  };
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  headerCopy: { flex: 1, gap: spacing.xs },
  eyebrow: { ...typography.eyebrow, color: colors.green },
  title: { ...typography.display, color: colors.ink },
  body: { ...typography.body, color: colors.muted },
  closeButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, backgroundColor: colors.limeSoft },
  recipeTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  recipeCopy: { flex: 1, gap: spacing.xs },
  recipeTitle: { ...typography.heading, color: colors.ink },
  recipeMeta: { ...typography.caption, color: colors.muted },
  recipeNotes: { ...typography.body, color: colors.muted },
  deleteButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, backgroundColor: colors.coralSoft },
  calorieValue: { ...typography.display, color: colors.ink },
  macroRow: { flexDirection: "row", gap: spacing.sm },
  loadingStack: { gap: spacing.xl },
  loadingCard: { gap: spacing.md },
  loadingHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  loadingMacroRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  savedScreenContent: { flexGrow: 1, justifyContent: "center" },
  savedState: { alignItems: "center", justifyContent: "center", gap: spacing.md, paddingVertical: spacing.xxl, paddingHorizontal: spacing.md },
  savedMark: { width: 72, height: 72, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, backgroundColor: colors.greenDeep },
  savedActions: { alignSelf: "stretch", gap: spacing.sm, marginTop: spacing.md },
});
