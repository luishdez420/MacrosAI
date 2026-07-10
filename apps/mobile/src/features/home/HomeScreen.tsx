import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { Alert, Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { colors, radii, spacing, typography } from "@living-nutrition/design-tokens";
import type { DiaryDay, MealRead } from "@living-nutrition/shared-types";
import { api } from "../../services/api";
import { MacroRing } from "../../shared/components/MacroRing";
import {
  Card,
  MacroStatTile,
  readableFoodName,
  ScreenShell,
  SectionHeader,
  SourceBadge,
  sourceLabel,
  StatusPill,
} from "../../shared/components/LivingUI";

const fallbackCalorieGoal = 2200;

export function HomeScreen() {
  const queryClient = useQueryClient();
  const today = getTodayKey();
  const [selectedDate, setSelectedDate] = useState(today);
  const diary = useQuery<DiaryDay>({
    queryKey: ["diary", selectedDate],
    queryFn: () => api.getDiary(selectedDate),
    retry: 1,
  });
  const goal = useQuery({
    queryKey: ["goal"],
    queryFn: () => api.getGoal(),
    retry: 1,
  });
  const totals = diary.data?.totals ?? {
    calories: 0,
    proteinGrams: 0,
    carbohydrateGrams: 0,
    fatGrams: 0,
    fiberGrams: 0,
    sugarGrams: 0,
    sodiumMilligrams: 0,
  };
  const meals = diary.data?.meals ?? [];
  const hasMeals = meals.length > 0;
  const calorieTarget = goal.data?.caloriesKcal ?? fallbackCalorieGoal;
  const remainingCalories = Math.round(calorieTarget - totals.calories);
  const selectedDateIsToday = selectedDate === today;
  const deleteMealMutation = useMutation({
    mutationFn: (mealId: string) => api.deleteMeal(mealId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["diary"] });
      await queryClient.invalidateQueries({ queryKey: ["foods", "recent"] });
    },
    onError: (error) => {
      Alert.alert("Meal was not deleted", error.message);
    },
  });

  function confirmDeleteMeal(meal: MealRead) {
    Alert.alert(
      "Delete meal?",
      `${readableFoodName(meal.name)} will be removed from ${selectedDateIsToday ? "today's" : "this day's"} diary.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteMealMutation.mutate(meal.id),
        },
      ]
    );
  }

  return (
    <ScreenShell>
        <Card style={styles.hero}>
          <View style={styles.dateNavigator}>
            <Pressable style={styles.dateNavButton} onPress={() => setSelectedDate(addDays(selectedDate, -1))}>
              <Text style={styles.dateNavText}>‹</Text>
            </Pressable>
            <View style={styles.dateCenter}>
              <Text style={styles.eyebrow}>{selectedDateIsToday ? "Today" : "Diary date"}</Text>
              <Text style={styles.dateLabel}>{formatDateLabel(selectedDate)}</Text>
            </View>
            <Pressable style={styles.dateNavButton} onPress={() => setSelectedDate(addDays(selectedDate, 1))}>
              <Text style={styles.dateNavText}>›</Text>
            </Pressable>
          </View>
          {!selectedDateIsToday ? (
            <Pressable style={styles.todayButton} onPress={() => setSelectedDate(today)}>
              <Text style={styles.todayButtonText}>Jump back to today</Text>
            </Pressable>
          ) : null}
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>Living Nutrition</Text>
            <Text style={styles.title}>
              {hasMeals
                ? `${selectedDateIsToday ? "Today" : "This day"}, backed by food data.`
                : selectedDateIsToday
                  ? "Scan a meal. Get a real estimate."
                  : "No meals logged for this day."}
            </Text>
            <Text style={styles.heroText}>
              {hasMeals
                ? "Your totals are loaded from saved meal snapshots, so history stays stable."
                : selectedDateIsToday
                  ? "Your dashboard starts filling in after your first saved scan or manual log."
                  : "Use the calendar controls to review another day or jump back to today."}
            </Text>
            <Text style={remainingCalories >= 0 ? styles.remainingText : styles.overTargetText}>
              {remainingCalories >= 0
                ? `${remainingCalories} kcal remaining based on your saved goal.`
                : `${Math.abs(remainingCalories)} kcal above your saved goal.`}
            </Text>
            {diary.error ? <Text style={styles.errorText}>{diary.error.message}</Text> : null}
          </View>
          <MacroRing
            value={Math.round(totals.calories)}
            target={calorieTarget}
            size={126}
            strokeWidth={13}
          />
        </Card>

        <View style={styles.actionStack}>
          <Link href="/camera" asChild>
            <Pressable style={[styles.action, styles.primaryAction]}>
              <View>
                <Text style={styles.actionEyebrow}>Camera</Text>
                <Text style={styles.actionTitle}>Scan meal</Text>
              </View>
              <Text style={styles.actionText}>
                Identify foods, match USDA records, and show an estimate you can log immediately.
              </Text>
            </Pressable>
          </Link>
          <Link href="/manual-search" asChild>
            <Pressable style={styles.action}>
              <View>
                <Text style={styles.actionEyebrow}>Search</Text>
                <Text style={styles.actionTitle}>Manual entry</Text>
              </View>
              <Text style={styles.actionText}>Look up a food record directly when camera is not ideal.</Text>
            </Pressable>
          </Link>
          <Link href="/natural-entry" asChild>
            <Pressable style={styles.action}>
              <View>
                <Text style={styles.actionEyebrow}>Describe</Text>
                <Text style={styles.actionTitle}>Natural entry</Text>
              </View>
              <Text style={styles.actionText}>
                Enter explicit weights in grams or ounces, then confirm each nutrition record.
              </Text>
            </Pressable>
          </Link>
          <Link href="/barcode" asChild>
            <Pressable style={styles.action}>
              <View>
                <Text style={styles.actionEyebrow}>Packaged food</Text>
                <Text style={styles.actionTitle}>Scan barcode</Text>
              </View>
              <Text style={styles.actionText}>
                Match package label data, confirm servings or grams, then save it to today’s diary.
              </Text>
            </Pressable>
          </Link>
        </View>

        <View style={styles.panel}>
          <SectionHeader
            title={selectedDateIsToday ? "Today" : "Selected day"}
            meta={`${Math.round(totals.calories)} / ${Math.round(calorieTarget)} kcal`}
          />
          <View style={styles.metricRow}>
            <MacroStatTile label="Protein" value={Math.round(totals.proteinGrams)} suffix="g" tone="protein" />
            <MacroStatTile label="Carbs" value={Math.round(totals.carbohydrateGrams)} suffix="g" tone="carbs" />
            <MacroStatTile label="Fat" value={Math.round(totals.fatGrams)} suffix="g" tone="fat" />
          </View>
        </View>

        <View style={styles.panel}>
          <SectionHeader title="Meal timeline" />
          {hasMeals ? (
            meals.map((meal, index) => (
              <TimelineMealCard key={meal.id} index={index}>
                <View style={styles.timelineTop}>
                  <Text numberOfLines={2} ellipsizeMode="tail" style={styles.timelineTitle}>
                    {readableFoodName(meal.name)}
                  </Text>
                  <StatusPill
                    label={mealStatusLabel(meal)}
                    tone={meal.items.every((item) => item.userConfirmed) ? "success" : "warning"}
                    style={styles.timelineStatus}
                  />
                </View>
                <View style={styles.timelineMetaRow}>
                  <Text style={styles.timelineMeta}>
                    {Math.round(meal.items.reduce((total, item) => total + item.calories, 0))} kcal
                  </Text>
                  <Text style={styles.timelineDot}>•</Text>
                  <Text style={styles.timelineMeta}>
                    {Math.round(meal.items.reduce((total, item) => total + item.proteinGrams, 0))}g protein
                  </Text>
                  <SourceBadge label={sourceLabel(meal.items[0]?.sourceProvider)} tone="success" />
                </View>
                <Text numberOfLines={1} style={styles.timelineSnapshot}>
                  Based on saved meal snapshots and confirmed portions.
                </Text>
                <View style={styles.timelineActions}>
                  <Link href={`/meal/${meal.id}`} asChild>
                    <Pressable style={styles.editButton}>
                      <Text style={styles.editButtonText}>Edit portions</Text>
                    </Pressable>
                  </Link>
                  <Pressable
                    style={styles.deleteButton}
                    onPress={() => confirmDeleteMeal(meal)}
                    disabled={deleteMealMutation.isPending}
                  >
                    <Text style={styles.deleteButtonText}>
                      {deleteMealMutation.isPending ? "Deleting..." : "Delete"}
                    </Text>
                  </Pressable>
                </View>
              </TimelineMealCard>
            ))
          ) : (
            <Text style={styles.muted}>
              {diary.isLoading
                ? "Loading today’s diary..."
                : "Your saved meals will appear here with source badges and confidence notes."}
            </Text>
          )}
        </View>
    </ScreenShell>
  );
}

function TimelineMealCard({
  children,
  index,
}: {
  children: ReactNode;
  index: number;
}) {
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    entrance.setValue(0);
    Animated.timing(entrance, {
      toValue: 1,
      duration: 360,
      delay: Math.min(index, 6) * 45,
      useNativeDriver: true,
    }).start();
  }, [entrance, index]);

  return (
    <Animated.View
      style={{
        opacity: entrance,
        transform: [
          {
            translateY: entrance.interpolate({
              inputRange: [0, 1],
              outputRange: [12, 0],
            }),
          },
        ],
      }}
    >
      <Card style={styles.timelineCard}>{children}</Card>
    </Animated.View>
  );
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateKey: string, days: number) {
  const value = new Date(`${dateKey}T12:00:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function formatDateLabel(dateKey: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${dateKey}T12:00:00`));
}

function mealStatusLabel(meal: MealRead) {
  return meal.items.every((item) => item.userConfirmed) ? "Confirmed" : "Needs confirmation";
}

const styles = StyleSheet.create({
  hero: {
    gap: spacing.lg,
  },
  dateNavigator: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderRadius: radii.lg,
    padding: spacing.sm,
    backgroundColor: colors.background,
  },
  dateNavButton: {
    width: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  dateNavText: {
    fontSize: 30,
    lineHeight: 32,
    fontWeight: "800",
    color: colors.green,
  },
  dateCenter: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  dateLabel: {
    ...typography.heading,
    color: colors.ink,
  },
  todayButton: {
    alignSelf: "flex-start",
    minHeight: 38,
    justifyContent: "center",
  },
  todayButtonText: {
    ...typography.button,
    color: colors.green,
  },
  heroCopy: {
    gap: spacing.sm,
  },
  eyebrow: {
    ...typography.eyebrow,
    color: colors.muted,
  },
  title: {
    ...typography.display,
    color: colors.ink,
  },
  heroText: {
    ...typography.body,
    color: colors.muted,
  },
  remainingText: {
    ...typography.caption,
    color: colors.green,
  },
  overTargetText: {
    ...typography.caption,
    color: colors.coral,
  },
  errorText: {
    ...typography.caption,
    color: colors.coral,
  },
  actionStack: {
    gap: spacing.md,
  },
  action: {
    minHeight: 128,
    borderRadius: radii.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    justifyContent: "space-between",
    gap: spacing.md,
  },
  primaryAction: {
    backgroundColor: colors.lime,
  },
  actionEyebrow: {
    ...typography.eyebrow,
    color: colors.muted,
  },
  actionTitle: {
    ...typography.heading,
    color: colors.ink,
  },
  actionText: {
    ...typography.body,
    color: colors.muted,
  },
  panel: {
    gap: spacing.md,
  },
  metricRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  timelineCard: {
    gap: spacing.xs,
  },
  timelineTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  timelineTitle: {
    ...typography.heading,
    color: colors.ink,
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  timelineStatus: {
    maxWidth: 122,
  },
  timelineMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  timelineMeta: {
    ...typography.caption,
    color: colors.muted,
  },
  timelineDot: {
    ...typography.caption,
    color: colors.muted,
  },
  timelineSnapshot: {
    ...typography.caption,
    color: colors.muted,
    paddingTop: spacing.xs,
  },
  timelineActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingTop: spacing.xs,
  },
  editButton: {
    minHeight: 40,
    justifyContent: "center",
  },
  editButtonText: {
    ...typography.button,
    color: colors.green,
  },
  deleteButton: {
    minHeight: 40,
    justifyContent: "center",
  },
  deleteButtonText: {
    ...typography.button,
    color: colors.coral,
  },
  muted: {
    ...typography.body,
    color: colors.muted,
  },
});
