import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { FoodSearchResult } from "@living-nutrition/shared-types";
import { colors, spacing, typography, type ThemePalette } from "@living-nutrition/design-tokens";
import { api } from "../../services/api";
import {
  ActionButton,
  Card,
  InlineNotice,
  readableFoodName,
  ScreenShell,
  SectionHeader,
  SourceBadge,
  StatusPill,
} from "../../shared/components/LivingUI";
import { useTheme } from "../../shared/theme/ThemeProvider";
import { foodDetailHref } from "../food-detail/foodDetailLinks";
import { servingSummary } from "../food-logging/foodLogging";
import {
  buildSavedFoodRemoveActions,
  filterSavedFoodsByTag,
  filterSavedFoods,
  parseSavedFoodTags,
  savedFoodTags,
  savedFoodFilterLabel,
  savedFoodSortLabel,
  sortSavedFoods,
  type SavedFoodFilter,
  type SavedFoodRemoveAction,
  type SavedFoodSort,
} from "./savedFoodsPresentation";

export function SavedFoodsScreen() {
  const queryClient = useQueryClient();
  const { palette } = useTheme();
  const themed = savedFoodsThemeStyles(palette);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<SavedFoodFilter>("all");
  const [activeSort, setActiveSort] = useState<SavedFoodSort>("default");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [editingTagsForFoodId, setEditingTagsForFoodId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const favorites = useQuery({
    queryKey: ["foods", "favorites"],
    queryFn: () => api.getFavoriteFoods(50),
  });
  const recents = useQuery({
    queryKey: ["foods", "recent"],
    queryFn: () => api.getRecentFoods(20),
  });
  const customFoods = useQuery({
    queryKey: ["foods", "custom"],
    queryFn: () => api.getCustomFoods(50),
  });
  const favoriteIds = new Set((favorites.data?.items ?? []).map((item) => item.id));
  const recentItems = (recents.data?.items ?? []).filter((item) => !favoriteIds.has(item.id));
  const filteredFavoriteItems = sortSavedFoods(
    filterSavedFoods(favorites.data?.items ?? [], searchQuery),
    activeSort
  );
  const availableTags = savedFoodTags(favorites.data?.items ?? []);
  const favoriteItems = filterSavedFoodsByTag(filteredFavoriteItems, activeTag);
  const filteredRecentItems = sortSavedFoods(
    filterSavedFoods(recentItems, searchQuery),
    activeSort
  );
  const customItems = sortSavedFoods(
    filterSavedFoods(customFoods.data?.items ?? [], searchQuery),
    activeSort
  );
  const filterOptions: Array<{ value: SavedFoodFilter; count: number }> = [
    {
      value: "all",
      count: favoriteItems.length + filteredRecentItems.length + customItems.length,
    },
    { value: "favorites", count: favoriteItems.length },
    { value: "recent", count: filteredRecentItems.length },
    { value: "custom", count: customItems.length },
  ];
  const sortOptions: SavedFoodSort[] = ["default", "name", "calories"];
  const removeMutation = useMutation({
    mutationFn: ({ kind, foodId }: SavedFoodRemoveAction) =>
      kind === "favorite" ? api.removeFavoriteFood(foodId) : api.removeRecentFood(foodId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["foods", "favorites"] });
      await queryClient.invalidateQueries({ queryKey: ["foods", "recent"] });
    },
  });
  const bulkRemoveMutation = useMutation({
    mutationFn: async (actions: SavedFoodRemoveAction[]) => {
      await Promise.all(
        actions.map((action) =>
          action.kind === "favorite"
            ? api.removeFavoriteFood(action.foodId)
            : api.removeRecentFood(action.foodId)
        )
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["foods", "favorites"] });
      await queryClient.invalidateQueries({ queryKey: ["foods", "recent"] });
    },
  });
  const updateTagsMutation = useMutation({
    mutationFn: ({ foodId, tags }: { foodId: string; tags: string[] }) =>
      api.updateFavoriteFoodTags(foodId, { tags }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["foods", "favorites"] });
      setEditingTagsForFoodId(null);
      setTagDraft("");
    },
  });

  function beginTagEditing(item: FoodSearchResult) {
    setEditingTagsForFoodId(item.id);
    setTagDraft((item.savedTags ?? []).join(", "));
  }

  function saveTags(foodId: string) {
    updateTagsMutation.mutate({ foodId, tags: parseSavedFoodTags(tagDraft) });
  }

  function confirmBulkRemove(kind: SavedFoodRemoveAction["kind"], items: FoodSearchResult[]) {
    const actions = buildSavedFoodRemoveActions(kind, items);

    if (!actions.length) {
      return;
    }

    const noun = kind === "favorite" ? "favorite" : "recent food";
    Alert.alert(
      `Clear ${actions.length} ${noun}${actions.length === 1 ? "" : "s"}?`,
      searchQuery.trim()
        ? "Only the currently visible search results in this section will be removed."
        : "This removes the visible items from this section. It does not delete meal history.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => bulkRemoveMutation.mutate(actions),
        },
      ]
    );
  }

  return (
    <ScreenShell>
      <View style={styles.header}>
        <Text style={[styles.eyebrow, themed.muted]}>Saved foods</Text>
        <Text style={[styles.title, themed.ink]}>Keep repeat logging tidy.</Text>
        <Text style={[styles.body, themed.muted]}>
          Search across favorites, recents, and custom foods. Favorites are pinned on purpose;
          recents are filled automatically when you log meals.
        </Text>
      </View>

      <Card>
        <SectionHeader title="Find saved foods" meta={`${filterOptions[0].count} visible`} />
        <TextInput
          accessibilityLabel="Search saved foods"
          style={[styles.searchInput, themed.input]}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search name, brand, source, or serving..."
          placeholderTextColor={palette.muted}
          autoCapitalize="none"
          returnKeyType="search"
        />
        <View testID="saved-food-filter-controls" style={[styles.filterRow, styles.filterRowAfterSearch]}>
          {filterOptions.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityLabel={`Show ${savedFoodFilterLabel(option.value)} saved foods`}
              accessibilityState={{ selected: activeFilter === option.value }}
              style={[
                styles.filterChip,
                themed.controlSurface,
                activeFilter === option.value ? styles.activeFilterChip : undefined,
              ]}
              onPress={() => setActiveFilter(option.value)}
            >
              <Text
                style={[styles.filterChipText, { color: activeFilter === option.value ? palette.onPrimary : palette.ink }]}
              >
                {savedFoodFilterLabel(option.value)} {option.count}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.sortBlock}>
          <Text style={[styles.sortLabel, themed.muted]}>Sort visible foods</Text>
          <View style={styles.filterRow}>
            {sortOptions.map((option) => (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityLabel={`Sort saved foods by ${savedFoodSortLabel(option)}`}
                accessibilityState={{ selected: activeSort === option }}
                style={[
                  styles.sortChip,
                  themed.subsurface,
                  activeSort === option ? themed.activeSortChip : undefined,
                ]}
                onPress={() => setActiveSort(option)}
              >
                <Text
                  style={[styles.sortChipText, { color: activeSort === option ? palette.onPrimary : palette.ink }]}
                >
                  {savedFoodSortLabel(option)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Card>

      {availableTags.length ? (
        <Card>
          <SectionHeader title="Favorite tags" meta="Private to you" />
          <Text style={[styles.tagHint, themed.muted]}>
            Filter favorites by the labels you use to organize repeat foods.
          </Text>
          <View style={styles.filterRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show favorites with any tag"
              accessibilityState={{ selected: activeTag === null }}
              style={[
                styles.tagFilterChip,
                themed.controlSurface,
                activeTag === null ? styles.activeFilterChip : undefined,
              ]}
              onPress={() => setActiveTag(null)}
            >
              <Text style={[styles.filterChipText, { color: activeTag === null ? palette.onPrimary : palette.ink }]}>
                All tags
              </Text>
            </Pressable>
            {availableTags.map((tag) => (
              <Pressable
                key={tag}
                accessibilityRole="button"
                accessibilityLabel={`Filter favorites by ${tag}`}
                accessibilityState={{ selected: activeTag === tag }}
                style={[
                  styles.tagFilterChip,
                  themed.controlSurface,
                  activeTag === tag ? styles.activeFilterChip : undefined,
                ]}
                onPress={() => setActiveTag(activeTag === tag ? null : tag)}
              >
                <Text style={[styles.filterChipText, { color: activeTag === tag ? palette.onPrimary : palette.ink }]}>
                  {tag}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}

      {removeMutation.error ? (
        <InlineNotice
          title="Saved food was not updated"
          body={removeMutation.error.message}
          tone="warning"
        />
      ) : null}

      {bulkRemoveMutation.error ? (
        <InlineNotice
          title="Saved foods were not cleared"
          body={bulkRemoveMutation.error.message}
          tone="warning"
        />
      ) : null}

      {updateTagsMutation.error ? (
        <InlineNotice
          title="Favorite tags were not updated"
          body={updateTagsMutation.error.message}
          tone="warning"
        />
      ) : null}

      {activeFilter === "all" || activeFilter === "favorites" ? (
        <SavedFoodSection
          title="Favorites"
          meta={`${favoriteItems.length} pinned`}
          isLoading={favorites.isLoading}
          emptyText={
            searchQuery.trim()
              ? "No favorites match this search."
              : "No favorites yet. Open a food source and tap Add to favorites."
          }
          items={favoriteItems}
          actionLabel="Remove favorite"
          onRemove={(foodId) => removeMutation.mutate({ kind: "favorite", foodId })}
          bulkActionLabel="Clear visible favorites"
          onBulkRemove={() => confirmBulkRemove("favorite", favoriteItems)}
          removing={removeMutation.isPending}
          bulkRemoving={bulkRemoveMutation.isPending}
          editingTagsForFoodId={editingTagsForFoodId}
          tagDraft={tagDraft}
          onTagDraftChange={setTagDraft}
          onBeginTagEditing={beginTagEditing}
          onCancelTagEditing={() => {
            setEditingTagsForFoodId(null);
            setTagDraft("");
          }}
          onSaveTags={saveTags}
          tagsSaving={updateTagsMutation.isPending}
        />
      ) : null}

      {activeFilter === "all" || activeFilter === "recent" ? (
        <SavedFoodSection
          title="Recent foods"
          meta={`${filteredRecentItems.length} recent`}
          isLoading={recents.isLoading}
          emptyText={
            searchQuery.trim()
              ? "No recent foods match this search."
              : "Recently logged foods will appear here after you save meals."
          }
          items={filteredRecentItems}
          actionLabel="Remove recent"
          onRemove={(foodId) => removeMutation.mutate({ kind: "recent", foodId })}
          bulkActionLabel="Clear visible recents"
          onBulkRemove={() => confirmBulkRemove("recent", filteredRecentItems)}
          removing={removeMutation.isPending}
          bulkRemoving={bulkRemoveMutation.isPending}
        />
      ) : null}

      {activeFilter === "all" || activeFilter === "custom" ? (
        <SavedFoodSection
          title="Custom foods"
          meta={`${customItems.length} custom`}
          isLoading={customFoods.isLoading}
          emptyText={
            searchQuery.trim()
              ? "No custom foods match this search."
              : "Create a custom food when providers do not have the record you need."
          }
          items={customItems}
          actionLabel="Edit custom"
          actionHref={(foodId) => `/custom-food?foodId=${encodeURIComponent(foodId)}`}
          removing={removeMutation.isPending}
          bulkRemoving={bulkRemoveMutation.isPending}
        />
      ) : null}

      <Link href="/manual-search" asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Return to manual food search"
          style={styles.manualLink}
        >
          <Text style={[styles.manualLinkText, themed.actionText]}>Back to manual search</Text>
        </Pressable>
      </Link>
    </ScreenShell>
  );
}

function SavedFoodSection({
  title,
  meta,
  isLoading,
  emptyText,
  items,
  actionLabel,
  onRemove,
  bulkActionLabel,
  onBulkRemove,
  actionHref,
  removing,
  bulkRemoving,
  editingTagsForFoodId,
  tagDraft,
  onTagDraftChange,
  onBeginTagEditing,
  onCancelTagEditing,
  onSaveTags,
  tagsSaving,
}: {
  title: string;
  meta: string;
  isLoading: boolean;
  emptyText: string;
  items: FoodSearchResult[];
  actionLabel: string;
  onRemove?: (foodId: string) => void;
  bulkActionLabel?: string;
  onBulkRemove?: () => void;
  actionHref?: (foodId: string) => string;
  removing: boolean;
  bulkRemoving: boolean;
  editingTagsForFoodId?: string | null;
  tagDraft?: string;
  onTagDraftChange?: (value: string) => void;
  onBeginTagEditing?: (item: FoodSearchResult) => void;
  onCancelTagEditing?: () => void;
  onSaveTags?: (foodId: string) => void;
  tagsSaving?: boolean;
}) {
  const { palette } = useTheme();
  const themed = savedFoodsThemeStyles(palette);

  return (
    <Card>
      <SectionHeader title={title} meta={isLoading ? "Loading..." : meta} />
      {items.length && onBulkRemove ? (
        <ActionButton
          label={bulkRemoving ? "Clearing..." : bulkActionLabel ?? "Clear visible"}
          variant="secondary"
          onPress={onBulkRemove}
          disabled={bulkRemoving || removing}
          style={styles.bulkAction}
        />
      ) : null}
      <View style={styles.list}>
        {items.length ? (
          items.map((item) => (
            <View key={item.id} style={[styles.foodRow, themed.controlSurface]}>
              <View style={styles.foodCopy}>
                <Text numberOfLines={2} style={[styles.foodTitle, themed.ink]}>
                  {readableFoodName(item.displayName)}
                </Text>
                <Text numberOfLines={1} style={[styles.foodMeta, themed.muted]}>
                  {Math.round(item.nutrientsPer100g.caloriesKcal)} kcal per 100g - {servingSummary(item)}
                </Text>
                <View style={styles.badgeRow}>
                  <SourceBadge label={item.provider.replaceAll("_", " ")} />
                  <StatusPill
                    label={item.recordConfidence}
                    tone={item.recordConfidence === "low" ? "warning" : "success"}
                  />
                </View>
                {(item.savedTags ?? []).length ? (
                  <View accessibilityLabel="Private favorite tags" style={styles.badgeRow}>
                    {(item.savedTags ?? []).map((tag) => (
                      <StatusPill key={tag} label={tag} tone="neutral" />
                    ))}
                  </View>
                ) : null}
              </View>
              <View style={styles.actions}>
                <Link href={foodDetailHref(item.id)} asChild>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`View nutrition source for ${readableFoodName(item.displayName)}`}
                    style={[styles.sourceButton, themed.subsurface]}
                  >
                    <Text style={[styles.sourceButtonText, themed.actionText]}>Source</Text>
                  </Pressable>
                </Link>
                {actionHref ? (
                  <Link href={actionHref(item.id)} asChild>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${actionLabel} ${readableFoodName(item.displayName)}`}
                      style={[styles.sourceButton, themed.subsurface]}
                    >
                      <Text style={[styles.sourceButtonText, themed.actionText]}>{actionLabel}</Text>
                    </Pressable>
                  </Link>
                ) : (
                  <>
                    {onBeginTagEditing ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Organize tags for ${readableFoodName(item.displayName)}`}
                        style={[styles.sourceButton, themed.subsurface]}
                        onPress={() => onBeginTagEditing(item)}
                      >
                        <Text style={[styles.sourceButtonText, themed.actionText]}>Tags</Text>
                      </Pressable>
                    ) : null}
                    <ActionButton
                      label={removing ? "Updating..." : actionLabel}
                      variant="secondary"
                      onPress={() => onRemove?.(item.id)}
                      disabled={removing}
                    />
                  </>
                )}
              </View>
              {editingTagsForFoodId === item.id ? (
                <View style={[styles.tagEditor, themed.subsurface]}>
                  <Text style={[styles.tagEditorLabel, themed.ink]}>Private tags</Text>
                  <TextInput
                    accessibilityLabel={`Private tags for ${readableFoodName(item.displayName)}`}
                    accessibilityHint="Separate up to ten tags with commas."
                    value={tagDraft}
                    onChangeText={onTagDraftChange}
                    placeholder="Breakfast, quick, meal prep"
                    placeholderTextColor={palette.muted}
                    style={[styles.tagInput, themed.input]}
                    autoCapitalize="words"
                    maxLength={489}
                  />
                  <Text style={[styles.tagEditorHint, themed.muted]}>
                    Only you can see these labels. They do not change the nutrition source.
                  </Text>
                  <View style={styles.tagEditorActions}>
                    <ActionButton
                      label="Cancel"
                      variant="secondary"
                      onPress={onCancelTagEditing}
                      disabled={tagsSaving}
                    />
                    <ActionButton
                      label={tagsSaving ? "Saving..." : "Save tags"}
                      onPress={() => onSaveTags?.(item.id)}
                      disabled={tagsSaving}
                    />
                  </View>
                </View>
              ) : null}
            </View>
          ))
        ) : (
          <Text style={[styles.empty, themed.muted]}>{isLoading ? "Loading saved foods..." : emptyText}</Text>
        )}
      </View>
    </Card>
  );
}

function savedFoodsThemeStyles(palette: ThemePalette) {
  return {
    ink: { color: palette.ink },
    muted: { color: palette.muted },
    actionText: { color: palette.actionText },
    controlSurface: { backgroundColor: palette.controlSurface },
    subsurface: { backgroundColor: palette.surfaceAlt },
    activeSortChip: { backgroundColor: colors.green },
    input: {
      backgroundColor: palette.controlSurface,
      borderColor: palette.border,
      color: palette.ink,
    },
  };
}

const styles = StyleSheet.create({
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
  list: {
    gap: spacing.sm,
  },
  bulkAction: {
    marginBottom: spacing.sm,
  },
  searchInput: {
    minHeight: 52,
    borderRadius: 18,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    color: colors.ink,
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  filterRowAfterSearch: {
    marginTop: spacing.sm,
  },
  filterChip: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
  },
  activeFilterChip: {
    backgroundColor: colors.green,
  },
  filterChipText: {
    ...typography.button,
    color: colors.ink,
  },
  activeFilterChipText: {
    color: colors.white,
  },
  sortBlock: {
    gap: spacing.xs,
  },
  tagHint: {
    ...typography.caption,
  },
  tagFilterChip: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: 999,
    paddingHorizontal: spacing.md,
  },
  sortLabel: {
    ...typography.caption,
    color: colors.muted,
  },
  sortChip: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceAlt,
  },
  activeSortChip: {
    backgroundColor: colors.ink,
  },
  sortChipText: {
    ...typography.caption,
    color: colors.ink,
    fontWeight: "700",
  },
  activeSortChipText: {
    color: colors.white,
  },
  foodRow: {
    gap: spacing.md,
    borderRadius: 28,
    padding: spacing.md,
    backgroundColor: colors.background,
  },
  foodCopy: {
    gap: spacing.xs,
  },
  foodTitle: {
    ...typography.heading,
    color: colors.ink,
  },
  foodMeta: {
    ...typography.caption,
    color: colors.muted,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  actions: {
    gap: spacing.sm,
  },
  tagEditor: {
    gap: spacing.xs,
    borderRadius: 20,
    padding: spacing.sm,
  },
  tagEditorLabel: {
    ...typography.caption,
    fontWeight: "700",
  },
  tagInput: {
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: spacing.sm,
  },
  tagEditorHint: {
    ...typography.caption,
  },
  tagEditorActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  sourceButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: colors.surfaceAlt,
  },
  sourceButtonText: {
    ...typography.button,
    color: colors.green,
  },
  empty: {
    ...typography.body,
    color: colors.muted,
  },
  manualLink: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  manualLinkText: {
    ...typography.button,
    color: colors.green,
  },
});
