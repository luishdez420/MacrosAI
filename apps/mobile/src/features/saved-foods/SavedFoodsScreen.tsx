import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { FoodSearchResult } from "@living-nutrition/shared-types";
import { colors, spacing, typography } from "@living-nutrition/design-tokens";
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
import { foodDetailHref } from "../food-detail/foodDetailLinks";
import { servingSummary } from "../food-logging/foodLogging";
import {
  buildSavedFoodRemoveActions,
  filterSavedFoods,
  savedFoodFilterLabel,
  savedFoodSortLabel,
  sortSavedFoods,
  type SavedFoodFilter,
  type SavedFoodRemoveAction,
  type SavedFoodSort,
} from "./savedFoodsPresentation";

export function SavedFoodsScreen() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<SavedFoodFilter>("all");
  const [activeSort, setActiveSort] = useState<SavedFoodSort>("default");
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
  const favoriteItems = sortSavedFoods(
    filterSavedFoods(favorites.data?.items ?? [], searchQuery),
    activeSort
  );
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
        <Text style={styles.eyebrow}>Saved foods</Text>
        <Text style={styles.title}>Keep repeat logging tidy.</Text>
        <Text style={styles.body}>
          Search across favorites, recents, and custom foods. Favorites are pinned on purpose;
          recents are filled automatically when you log meals.
        </Text>
      </View>

      <Card>
        <SectionHeader title="Find saved foods" meta={`${filterOptions[0].count} visible`} />
        <TextInput
          accessibilityLabel="Search saved foods"
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search name, brand, source, or serving..."
          autoCapitalize="none"
          returnKeyType="search"
        />
        <View style={styles.filterRow}>
          {filterOptions.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityLabel={`Show ${savedFoodFilterLabel(option.value)} saved foods`}
              style={[
                styles.filterChip,
                activeFilter === option.value ? styles.activeFilterChip : undefined,
              ]}
              onPress={() => setActiveFilter(option.value)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  activeFilter === option.value ? styles.activeFilterChipText : undefined,
                ]}
              >
                {savedFoodFilterLabel(option.value)} {option.count}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.sortBlock}>
          <Text style={styles.sortLabel}>Sort visible foods</Text>
          <View style={styles.filterRow}>
            {sortOptions.map((option) => (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityLabel={`Sort saved foods by ${savedFoodSortLabel(option)}`}
                style={[
                  styles.sortChip,
                  activeSort === option ? styles.activeSortChip : undefined,
                ]}
                onPress={() => setActiveSort(option)}
              >
                <Text
                  style={[
                    styles.sortChipText,
                    activeSort === option ? styles.activeSortChipText : undefined,
                  ]}
                >
                  {savedFoodSortLabel(option)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Card>

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
        <Pressable accessibilityRole="button" style={styles.manualLink}>
          <Text style={styles.manualLinkText}>Back to manual search</Text>
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
}) {
  return (
    <Card>
      <SectionHeader title={title} meta={isLoading ? "Loading..." : meta} />
      {items.length && onBulkRemove ? (
        <ActionButton
          label={bulkRemoving ? "Clearing..." : bulkActionLabel ?? "Clear visible"}
          variant="secondary"
          onPress={onBulkRemove}
          disabled={bulkRemoving || removing}
        />
      ) : null}
      <View style={styles.list}>
        {items.length ? (
          items.map((item) => (
            <View key={item.id} style={styles.foodRow}>
              <View style={styles.foodCopy}>
                <Text numberOfLines={2} style={styles.foodTitle}>
                  {readableFoodName(item.displayName)}
                </Text>
                <Text numberOfLines={1} style={styles.foodMeta}>
                  {Math.round(item.nutrientsPer100g.caloriesKcal)} kcal per 100g - {servingSummary(item)}
                </Text>
                <View style={styles.badgeRow}>
                  <SourceBadge label={item.provider.replaceAll("_", " ")} />
                  <StatusPill
                    label={item.recordConfidence}
                    tone={item.recordConfidence === "low" ? "warning" : "success"}
                  />
                </View>
              </View>
              <View style={styles.actions}>
                <Link href={foodDetailHref(item.id)} asChild>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`View nutrition source for ${readableFoodName(item.displayName)}`}
                    style={styles.sourceButton}
                  >
                    <Text style={styles.sourceButtonText}>Source</Text>
                  </Pressable>
                </Link>
                {actionHref ? (
                  <Link href={actionHref(item.id)} asChild>
                    <Pressable accessibilityRole="button" style={styles.sourceButton}>
                      <Text style={styles.sourceButtonText}>{actionLabel}</Text>
                    </Pressable>
                  </Link>
                ) : (
                  <ActionButton
                    label={removing ? "Updating..." : actionLabel}
                    variant="secondary"
                    onPress={() => onRemove?.(item.id)}
                    disabled={removing}
                  />
                )}
              </View>
            </View>
          ))
        ) : (
          <Text style={styles.empty}>{isLoading ? "Loading saved foods..." : emptyText}</Text>
        )}
      </View>
    </Card>
  );
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
  filterChip: {
    minHeight: 42,
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
  sortLabel: {
    ...typography.caption,
    color: colors.muted,
  },
  sortChip: {
    minHeight: 38,
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
