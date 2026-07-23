import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { Link, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { MealType, RecipeFolderRead, RecipeRead } from "@living-nutrition/shared-types";
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
import {
  filterRecipes,
  recipeFilterLabel,
  recipeSortLabel,
  sortRecipes,
  type RecipeFilter,
  type RecipeSort,
} from "./recipePresentation";

export function RecipeLibraryScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { palette } = useTheme();
  const themed = recipeThemeStyles(palette);
  const [actionError, setActionError] = useState<string | null>(null);
  const [recipeAwaitingDeletionId, setRecipeAwaitingDeletionId] = useState<string | null>(null);
  const [recipeLogged, setRecipeLogged] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<RecipeFilter>("all");
  const [activeSort, setActiveSort] = useState<RecipeSort>("recent");
  const [activeFolder, setActiveFolder] = useState<"all" | "unfiled" | string>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderDrafts, setFolderDrafts] = useState<Record<string, string>>({});
  const [folderAwaitingDeletionId, setFolderAwaitingDeletionId] = useState<string | null>(null);
  const recipeLogScopes = useRef(new Map<string, string>());
  const recipes = useQuery({ queryKey: ["recipes"], queryFn: () => api.listRecipes() });
  const folders = useQuery({ queryKey: ["recipe-folders"], queryFn: () => api.listRecipeFolders() });
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
  const tagMutation = useMutation({
    mutationFn: ({ recipeId, tags }: { recipeId: string; tags: string[] }) =>
      api.updateRecipeTags(recipeId, { tags }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
      setActionError(null);
    },
    onError: (error) => setActionError(error.message),
  });
  const createFolderMutation = useMutation({
    mutationFn: (name: string) => api.createRecipeFolder({ name }),
    onSuccess: async () => {
      setActionError(null);
      setNewFolderName("");
      await queryClient.invalidateQueries({ queryKey: ["recipe-folders"] });
    },
    onError: (error) => setActionError(error.message),
  });
  const folderAssignmentMutation = useMutation({
    mutationFn: ({ recipeId, folderId }: { recipeId: string; folderId: string | null }) =>
      api.updateRecipe(recipeId, { folderId }),
    onSuccess: async () => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
    },
    onError: (error) => setActionError(error.message),
  });
  const favoriteMutation = useMutation({
    mutationFn: ({ recipeId, isFavorite }: { recipeId: string; isFavorite: boolean }) =>
      api.updateRecipe(recipeId, { isFavorite }),
    onSuccess: async () => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
    },
    onError: (error) => setActionError(error.message),
  });
  const updateFolderMutation = useMutation({
    mutationFn: ({ folderId, name }: { folderId: string; name: string }) =>
      api.updateRecipeFolder(folderId, { name }),
    onSuccess: async (_folder, variables) => {
      setActionError(null);
      setFolderDrafts((drafts) => ({ ...drafts, [variables.folderId]: variables.name }));
      await queryClient.invalidateQueries({ queryKey: ["recipe-folders"] });
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
    },
    onError: (error) => setActionError(error.message),
  });
  const deleteFolderMutation = useMutation({
    mutationFn: (folderId: string) => api.deleteRecipeFolder(folderId),
    onSuccess: async (_result, folderId) => {
      setActionError(null);
      setFolderAwaitingDeletionId(null);
      setFolderDrafts((drafts) => {
        const { [folderId]: _removed, ...remaining } = drafts;
        return remaining;
      });
      setActiveFolder((selected) => (selected === folderId ? "all" : selected));
      await queryClient.invalidateQueries({ queryKey: ["recipe-folders"] });
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
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
  const filteredRecipes = sortRecipes(
    filterRecipes(
      recipes.data ?? [],
      searchQuery,
      activeFilter,
      activeFolder === "all" ? undefined : activeFolder === "unfiled" ? null : activeFolder,
      favoritesOnly
    ),
    activeSort
  );
  const filterOptions: RecipeFilter[] = ["all", "breakfast", "lunch", "dinner", "snack", "meal"];
  const sortOptions: RecipeSort[] = ["recent", "most_used", "name"];

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
      {folders.error ? <InlineNotice title="Folders could not load" body={folders.error.message} tone="danger" actions={[{ label: "Try again", onPress: () => void folders.refetch(), variant: "secondary" }]} /> : null}
      {actionError ? <InlineNotice title="Recipe action could not finish" body={actionError} tone="danger" actions={[{ label: "Dismiss", onPress: () => setActionError(null), variant: "secondary" }]} /> : null}
      {recipes.isLoading ? <RecipeLibrarySkeleton /> : null}
      {!recipes.isLoading && !recipes.data?.length ? (
        <EmptyState title="No recipes yet" body="Build a multi-food meal, then save it as a recipe whenever you want to reuse the same portions." actionLabel="Build a meal" onAction={() => router.push("/meal-builder")} icon="layers-outline" />
      ) : null}
      {!recipes.isLoading && recipes.data?.length ? (
        <Card style={styles.organizeCard}>
          <View style={styles.organizeHeader}>
            <Text style={[styles.organizeTitle, themed.ink]}>Find recipes</Text>
            <Text style={[styles.organizeMeta, themed.muted]}>{filteredRecipes.length} visible</Text>
          </View>
          <TextInput
            accessibilityLabel="Search recipes"
            style={[styles.searchInput, themed.controlSurface, themed.ink]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search name, note, or ingredient..."
            placeholderTextColor={palette.muted}
            autoCapitalize="none"
            returnKeyType="search"
          />
          <Text style={[styles.organizeLabel, themed.muted]}>Meal time</Text>
          <View style={styles.chipRow}>
            {filterOptions.map((filter) => (
              <Pressable
                key={filter}
                accessibilityRole="button"
                accessibilityLabel={`Show ${recipeFilterLabel(filter)} recipes`}
                accessibilityState={{ selected: activeFilter === filter }}
                style={[
                  styles.filterChip,
                  themed.controlSurface,
                  activeFilter === filter ? styles.activeChip : undefined,
                ]}
                onPress={() => setActiveFilter(filter)}
              >
                <Text style={[styles.chipText, { color: activeFilter === filter ? palette.onPrimary : palette.ink }]}>
                  {recipeFilterLabel(filter)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.organizeLabel, themed.muted]}>Folder</Text>
          <View style={styles.chipRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show all recipe folders"
              accessibilityState={{ selected: activeFolder === "all" }}
              style={[styles.filterChip, themed.controlSurface, activeFolder === "all" ? styles.activeChip : undefined]}
              onPress={() => setActiveFolder("all")}
            >
              <Text style={[styles.chipText, { color: activeFolder === "all" ? palette.onPrimary : palette.ink }]}>All folders</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show unfiled recipes"
              accessibilityState={{ selected: activeFolder === "unfiled" }}
              style={[styles.filterChip, themed.controlSurface, activeFolder === "unfiled" ? styles.activeChip : undefined]}
              onPress={() => setActiveFolder("unfiled")}
            >
              <Text style={[styles.chipText, { color: activeFolder === "unfiled" ? palette.onPrimary : palette.ink }]}>Unfiled</Text>
            </Pressable>
            {(folders.data ?? []).map((folder) => (
              <Pressable
                key={folder.id}
                accessibilityRole="button"
                accessibilityLabel={`Show ${folder.name} recipes`}
                accessibilityState={{ selected: activeFolder === folder.id }}
                style={[styles.filterChip, themed.controlSurface, activeFolder === folder.id ? styles.activeChip : undefined]}
                onPress={() => setActiveFolder(folder.id)}
              >
                <Text style={[styles.chipText, { color: activeFolder === folder.id ? palette.onPrimary : palette.ink }]}>{folder.name}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.organizeLabel, themed.muted]}>Saved</Text>
          <View style={styles.chipRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show favorite recipes only"
              accessibilityState={{ selected: favoritesOnly }}
              style={[styles.filterChip, themed.controlSurface, favoritesOnly ? styles.activeChip : undefined]}
              onPress={() => setFavoritesOnly((value) => !value)}
            >
              <Text style={[styles.chipText, { color: favoritesOnly ? palette.onPrimary : palette.ink }]}>Favorites only</Text>
            </Pressable>
          </View>
          <View style={styles.newFolderRow}>
            <TextInput
              accessibilityLabel="New recipe folder name"
              value={newFolderName}
              onChangeText={setNewFolderName}
              placeholder="New folder, for example Weeknight"
              placeholderTextColor={palette.muted}
              style={[styles.newFolderInput, themed.controlSurface, themed.ink]}
              maxLength={64}
              returnKeyType="done"
            />
            <ActionButton
              label={createFolderMutation.isPending ? "Adding…" : "Add folder"}
              variant="secondary"
              onPress={() => createFolderMutation.mutate(newFolderName.trim())}
              disabled={!newFolderName.trim() || createFolderMutation.isPending}
            />
          </View>
          {(folders.data ?? []).length ? (
            <View style={styles.folderManagementPanel}>
              <Text style={[styles.organizeLabel, themed.muted]}>Manage folders</Text>
              {(folders.data ?? []).map((folder) => {
                const draft = folderDrafts[folder.id] ?? folder.name;
                const pendingDelete = folderAwaitingDeletionId === folder.id;
                const savingFolder = updateFolderMutation.isPending && updateFolderMutation.variables?.folderId === folder.id;
                const deletingFolder = deleteFolderMutation.isPending && deleteFolderMutation.variables === folder.id;

                return (
                  <View key={folder.id} style={styles.folderManagementItem}>
                    <TextInput
                      accessibilityLabel={`Folder name for ${folder.name}`}
                      value={draft}
                      onChangeText={(name) => setFolderDrafts((drafts) => ({ ...drafts, [folder.id]: name }))}
                      placeholderTextColor={palette.muted}
                      style={[styles.newFolderInput, themed.controlSurface, themed.ink]}
                      maxLength={64}
                      returnKeyType="done"
                    />
                    <View style={styles.folderManagementActions}>
                      <ActionButton
                        label={savingFolder ? "Saving…" : "Rename"}
                        variant="secondary"
                        onPress={() => updateFolderMutation.mutate({ folderId: folder.id, name: draft.trim() })}
                        disabled={!draft.trim() || draft.trim() === folder.name || savingFolder || deletingFolder}
                        style={styles.folderManagementAction}
                      />
                      <ActionButton
                        label={pendingDelete ? "Keep folder" : "Delete"}
                        variant="secondary"
                        onPress={() => setFolderAwaitingDeletionId(pendingDelete ? null : folder.id)}
                        disabled={savingFolder || deletingFolder}
                        style={styles.folderManagementAction}
                      />
                    </View>
                    {pendingDelete ? (
                      <InlineNotice
                        title={`Delete ${folder.name}?`}
                        body="Recipes will stay saved and move to Unfiled. Logged meals will not change."
                        tone="danger"
                        actions={[
                          { label: "Keep folder", onPress: () => setFolderAwaitingDeletionId(null), variant: "secondary" },
                          { label: deletingFolder ? "Deleting…" : "Delete folder", onPress: () => deleteFolderMutation.mutate(folder.id), variant: "danger", disabled: deletingFolder },
                        ]}
                      />
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : null}
          <Text style={[styles.organizeLabel, themed.muted]}>Sort recipes</Text>
          <View style={styles.chipRow}>
            {sortOptions.map((sort) => (
              <Pressable
                key={sort}
                accessibilityRole="button"
                accessibilityLabel={`Sort recipes by ${recipeSortLabel(sort)}`}
                accessibilityState={{ selected: activeSort === sort }}
                style={[
                  styles.sortChip,
                  themed.subsurface,
                  activeSort === sort ? styles.activeChip : undefined,
                ]}
                onPress={() => setActiveSort(sort)}
              >
                <Text style={[styles.chipText, { color: activeSort === sort ? palette.onPrimary : palette.ink }]}>
                  {recipeSortLabel(sort)}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}
      {!recipes.isLoading && recipes.data?.length && !filteredRecipes.length ? (
        <EmptyState
          title="No recipes match"
          body="Try a different ingredient, meal time, or sort option. Your saved recipes are unchanged."
        />
      ) : null}
      {filteredRecipes.map((recipe) => (
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
          savingTags={tagMutation.isPending}
          onSaveTags={(tags) => tagMutation.mutate({ recipeId: recipe.id, tags })}
          folders={folders.data ?? []}
          savingFolder={folderAssignmentMutation.isPending}
          onSaveFolder={(folderId) => folderAssignmentMutation.mutate({ recipeId: recipe.id, folderId })}
          savingFavorite={favoriteMutation.isPending && favoriteMutation.variables?.recipeId === recipe.id}
          onToggleFavorite={() => favoriteMutation.mutate({ recipeId: recipe.id, isFavorite: !recipe.isFavorite })}
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
  savingTags,
  onSaveTags,
  folders,
  savingFolder,
  onSaveFolder,
  savingFavorite,
  onToggleFavorite,
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
  savingTags: boolean;
  onSaveTags: (tags: string[]) => void;
  folders: RecipeFolderRead[];
  savingFolder: boolean;
  onSaveFolder: (folderId: string | null) => void;
  savingFavorite: boolean;
  onToggleFavorite: () => void;
}) {
  const { palette } = useTheme();
  const themed = recipeThemeStyles(palette);
  const totals = recipe.items.reduce((total, item) => ({
    calories: total.calories + item.calories,
    protein: total.protein + item.proteinGrams,
    carbs: total.carbs + item.carbohydrateGrams,
    fat: total.fat + item.fatGrams,
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
  const [tagText, setTagText] = useState((recipe.tags ?? []).join(", "));

  return (
    <Card>
      <View style={styles.recipeTop}>
        <View style={styles.recipeCopy}>
          <Text numberOfLines={2} style={[styles.recipeTitle, themed.ink]}>{recipe.name}</Text>
          <Text style={[styles.recipeMeta, themed.muted]}>{mealTypeLabel(recipe.mealType)} · {recipe.items.length} food{recipe.items.length === 1 ? "" : "s"} · used {recipe.timesUsed} time{recipe.timesUsed === 1 ? "" : "s"}</Text>
        </View>
        <View style={styles.recipeActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${recipe.isFavorite ? "Remove" : "Add"} ${recipe.name} ${recipe.isFavorite ? "from" : "to"} favorite recipes`}
            accessibilityState={{ selected: Boolean(recipe.isFavorite), busy: savingFavorite }}
            onPress={onToggleFavorite}
            disabled={deleting || saving || savingFavorite}
            style={[styles.favoriteButton, themed.favoriteSurface, recipe.isFavorite ? styles.favoriteButtonSelected : undefined]}
          >
            <Ionicons name={recipe.isFavorite ? "bookmark" : "bookmark-outline"} size={18} color={recipe.isFavorite ? colors.white : palette.ink} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${recipe.name}`} accessibilityHint="Opens an inline confirmation. Logged meals will not be changed." onPress={onRequestDelete} disabled={deleting || saving || savingFavorite} style={[styles.deleteButton, themed.dangerSurface]}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
        </View>
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
      <View style={styles.folderPanel}>
        <Text style={[styles.tagLabel, themed.muted]}>Folder</Text>
        <View style={styles.chipRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Move ${recipe.name} to no folder`}
            accessibilityState={{ selected: !recipe.folderId }}
            style={[styles.recipeFolderChip, themed.controlSurface, !recipe.folderId ? styles.activeChip : undefined]}
            disabled={savingFolder || saving || deleting}
            onPress={() => onSaveFolder(null)}
          >
            <Text style={[styles.chipText, { color: !recipe.folderId ? palette.onPrimary : palette.ink }]}>Unfiled</Text>
          </Pressable>
          {folders.map((folder) => (
            <Pressable
              key={folder.id}
              accessibilityRole="button"
              accessibilityLabel={`Move ${recipe.name} to ${folder.name}`}
              accessibilityState={{ selected: recipe.folderId === folder.id }}
              style={[styles.recipeFolderChip, themed.controlSurface, recipe.folderId === folder.id ? styles.activeChip : undefined]}
              disabled={savingFolder || saving || deleting}
              onPress={() => onSaveFolder(folder.id)}
            >
              <Text style={[styles.chipText, { color: recipe.folderId === folder.id ? palette.onPrimary : palette.ink }]}>{folder.name}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.tagPanel}>
        <Text style={[styles.tagLabel, themed.muted]}>Private tags</Text>
        <TextInput
          accessibilityLabel={`Private tags for ${recipe.name}`}
          value={tagText}
          onChangeText={setTagText}
          placeholder="Quick, weekday, family..."
          placeholderTextColor={palette.muted}
          style={[styles.tagInput, themed.controlSurface, themed.ink]}
        />
        <ActionButton
          label={savingTags ? "Saving tags…" : "Save tags"}
          variant="secondary"
          onPress={() => onSaveTags(tagText.split(",").map((tag) => tag.trim()).filter(Boolean))}
          disabled={savingTags || saving || deleting}
        />
      </View>
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
    controlSurface: { backgroundColor: palette.controlSurface },
    favoriteSurface: { backgroundColor: palette.surfaceAlt },
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
  organizeCard: { gap: spacing.sm },
  organizeHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  organizeTitle: { ...typography.heading, color: colors.ink },
  organizeMeta: { ...typography.caption, color: colors.muted },
  organizeLabel: { ...typography.caption, color: colors.muted, marginTop: spacing.xs },
  searchInput: { minHeight: 52, borderRadius: radii.md, paddingHorizontal: spacing.md },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  newFolderRow: { gap: spacing.xs, marginTop: spacing.xs },
  folderManagementPanel: { gap: spacing.sm, marginTop: spacing.xs },
  folderManagementItem: { gap: spacing.xs },
  folderManagementActions: { flexDirection: "row", gap: spacing.xs },
  folderManagementAction: { flex: 1 },
  newFolderInput: { minHeight: 48, borderRadius: radii.md, paddingHorizontal: spacing.md },
  filterChip: { minHeight: 44, justifyContent: "center", borderRadius: radii.pill, paddingHorizontal: spacing.md },
  sortChip: { minHeight: 44, justifyContent: "center", borderRadius: radii.pill, paddingHorizontal: spacing.md },
  activeChip: { backgroundColor: colors.green },
  chipText: { ...typography.caption, fontWeight: "700" },
  closeButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, backgroundColor: colors.limeSoft },
  recipeTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  recipeActions: { flexDirection: "row", gap: spacing.xs },
  recipeCopy: { flex: 1, gap: spacing.xs },
  recipeTitle: { ...typography.heading, color: colors.ink },
  recipeMeta: { ...typography.caption, color: colors.muted },
  recipeNotes: { ...typography.body, color: colors.muted },
  tagPanel: { gap: spacing.xs },
  folderPanel: { gap: spacing.xs },
  tagLabel: { ...typography.caption, color: colors.muted },
  tagInput: { minHeight: 48, borderRadius: radii.md, paddingHorizontal: spacing.md },
  recipeFolderChip: { minHeight: 40, justifyContent: "center", borderRadius: radii.pill, paddingHorizontal: spacing.sm },
  deleteButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, backgroundColor: colors.coralSoft },
  favoriteButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radii.pill },
  favoriteButtonSelected: { backgroundColor: colors.green },
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
