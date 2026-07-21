import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Link, useRouter } from "expo-router";
import { AccessibilityInfo, Alert, Animated, PanResponder, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { colors, motion, radii, spacing, typography, type ThemePalette } from "@living-nutrition/design-tokens";
import type { DiaryDay, HydrationEntry, MealRead, MealType, RangeInsights } from "@living-nutrition/shared-types";
import { env } from "../../config/env";
import { createFixtureQueuedMeal } from "../../e2e/fixtureMeal";
import { api, getStoredUserId } from "../../services/api";
import { queueConfirmedMeal, queuedMealCount, syncQueuedMeals } from "../../services/offlineMealQueue";
import { loadPendingAnalysisJob } from "../../services/pendingAnalysisJob";
import { MacroRing } from "../../shared/components/MacroRing";
import { formatMealTime } from "../../shared/domain/mealTiming";
import {
  Card,
  EmptyState,
  ErrorState,
  InlineNotice,
  MacroProgressBar,
  MacroStatTile,
  readableFoodName,
  ScreenShell,
  SectionHeader,
  SkeletonBlock,
  SourceBadge,
  sourceLabel,
  StatusPill,
} from "../../shared/components/LivingUI";
import { useTheme } from "../../shared/theme/ThemeProvider";

const fallbackCalorieGoal = 2200;
const timelineSwipeRevealDistance = 92;
const timelineSwipeCommitDistance = 56;
type MacroFocus = "protein" | "carbs" | "fat";

export type TimelineSwipeDestination = "edit" | "delete" | null;

export function timelineSwipeDestination(
  translationX: number,
  velocityX = 0
): TimelineSwipeDestination {
  if (translationX >= timelineSwipeCommitDistance || velocityX >= 0.65) {
    return "edit";
  }

  if (translationX <= -timelineSwipeCommitDistance || velocityX <= -0.65) {
    return "delete";
  }

  return null;
}

export function HomeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { palette } = useTheme();
  const themed = homeThemeStyles(palette);
  const today = getTodayKey();
  const [selectedDate, setSelectedDate] = useState(today);
  const [focusedMacro, setFocusedMacro] = useState<MacroFocus | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const diary = useQuery<DiaryDay>({
    queryKey: ["diary", selectedDate],
    queryFn: () => api.getDiary(selectedDate),
    retry: 1,
    retryDelay: 300,
  });
  const rhythmStartDate = addDays(selectedDate, -6);
  const loggingRhythm = useQuery<RangeInsights>({
    queryKey: ["insights", "home-rhythm", rhythmStartDate, selectedDate],
    queryFn: () => api.getRangeInsights(rhythmStartDate, selectedDate),
    retry: 0,
  });
  const goal = useQuery({
    queryKey: ["goal"],
    queryFn: () => api.getGoal(),
    retry: 1,
  });
  const offlineQueue = useQuery({
    queryKey: ["offline-meal-queue"],
    queryFn: async () => {
      const ownerId = await getStoredUserId();
      return ownerId ? queuedMealCount(ownerId) : 0;
    },
    retry: 0,
  });
  const pendingAnalysisJob = useQuery<string | null>({
    queryKey: ["pending-analysis-job"],
    queryFn: async () => {
      const ownerId = await getStoredUserId();
      return ownerId ? (await loadPendingAnalysisJob(ownerId)) ?? null : null;
    },
    retry: 0,
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
  const timelineGroups = groupMealsByCategory(meals);
  const hasMeals = meals.length > 0;
  const isInitialDiaryLoading = diary.isLoading && !diary.data;
  const hasDiaryLoadError = Boolean(diary.error && !diary.data);
  const calorieTarget = goal.data?.caloriesKcal ?? fallbackCalorieGoal;
  const remainingCalories = Math.round(calorieTarget - totals.calories);
  const selectedDateIsToday = selectedDate === today;
  const dailyObservation = buildDailyObservation(meals);
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
  const syncQueuedMealsMutation = useMutation({
    mutationFn: async () => {
      const ownerId = await getStoredUserId();
      if (!ownerId) {
        return { synced: 0, remaining: 0 };
      }

      return syncQueuedMeals(ownerId, api.createMeal);
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["offline-meal-queue"] });
      if (result.synced > 0) {
        await queryClient.invalidateQueries({ queryKey: ["diary"] });
        await queryClient.invalidateQueries({ queryKey: ["foods", "recent"] });
      }
      setSyncNotice(
        result.remaining
          ? `${result.synced} meal${result.synced === 1 ? "" : "s"} synced. ${result.remaining} still waiting for a connection.`
          : result.synced
            ? `${result.synced} queued meal${result.synced === 1 ? "" : "s"} synced to your diary.`
            : "Your queued meals are still waiting for a connection."
      );
    },
    onError: () => {
      setSyncNotice("Your confirmed meals remain safely queued on this device. Try syncing again when you are connected.");
    },
  });
  const queueFixtureMealMutation = useMutation({
    mutationFn: async () => {
      const ownerId = await getStoredUserId();

      if (!ownerId) {
        throw new Error("The automated test account is unavailable.");
      }

      await queueConfirmedMeal(ownerId, createFixtureQueuedMeal(), "e2e-fixture-queued-banana-v1");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["offline-meal-queue"] });
    },
    onError: () => {
      setSyncNotice("The automated queue fixture could not be saved on this device.");
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
      <View style={styles.topHeader}>
        <View style={styles.topHeaderCopy}>
          <Text style={[styles.eyebrow, themed.eyebrow]}>Living Nutrition</Text>
          <Text style={[styles.greeting, themed.ink]}>{getGreeting()}.</Text>
          <Text style={[styles.headerDate, themed.muted]}>{selectedDateIsToday ? formatDateLabel(selectedDate) : "Viewing " + formatDateLabel(selectedDate)}</Text>
        </View>
        <View style={styles.headerActions}>
          <Link href="/notifications" asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open notification settings"
              accessibilityHint="Manage the optional local daily hydration reminder"
              style={[styles.headerIconButton, themed.avatarButton]}
            >
              <Ionicons name="notifications-outline" size={19} color={colors.greenDeep} />
            </Pressable>
          </Link>
          <Link href="/profile" asChild>
            <Pressable accessibilityRole="button" accessibilityLabel="Open profile" style={[styles.headerIconButton, themed.avatarButton]}>
              <Ionicons name="person" size={19} color={colors.greenDeep} />
            </Pressable>
          </Link>
        </View>
      </View>

      {loggingRhythm.data ? (
        <View
          accessible
          accessibilityLabel={loggingRhythmAccessibilityLabel(
            loggingRhythm.data.loggedDays,
            loggingRhythm.data.durationDays
          )}
          style={[styles.loggingRhythm, themed.loggingRhythm]}
        >
          <Ionicons name="leaf-outline" size={16} color={themed.loggingRhythmIcon.color} />
          <View style={styles.loggingRhythmCopy}>
            <Text style={[styles.loggingRhythmLabel, themed.muted]}>Logging rhythm</Text>
            <Text style={[styles.loggingRhythmValue, themed.ink]}>
              {loggingRhythmCopy(loggingRhythm.data.loggedDays, loggingRhythm.data.durationDays)}
            </Text>
          </View>
        </View>
      ) : null}

      {offlineQueue.data ? (
        <InlineNotice
          title={`${offlineQueue.data} confirmed meal${offlineQueue.data === 1 ? "" : "s"} waiting to sync`}
          body="These meals use the portions and nutrition sources you already confirmed. They are saved only on this device until a sync succeeds."
          tone="warning"
          actions={[
            {
              label: syncQueuedMealsMutation.isPending ? "Syncing..." : "Sync now",
              onPress: () => syncQueuedMealsMutation.mutate(),
              variant: "secondary",
            },
          ]}
        />
      ) : null}

      {env.e2eFixtureMode ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Queue automated test meal"
          accessibilityHint="Available only in the dedicated automated-test build. Saves a confirmed source-backed meal locally, then lets the test replay it through the normal sync control."
          disabled={queueFixtureMealMutation.isPending}
          onPress={() => queueFixtureMealMutation.mutate()}
          style={styles.e2eFixtureControl}
        >
          <Text style={styles.e2eFixtureControlText}>
            {queueFixtureMealMutation.isPending ? "Queueing test meal..." : "Queue automated test meal"}
          </Text>
        </Pressable>
      ) : null}

      {syncNotice ? <InlineNotice title="Meal sync" body={syncNotice} tone="warning" /> : null}

      {pendingAnalysisJob.data ? (
        <InlineNotice
          title="Meal analysis ready to resume"
          body="Your meal is still waiting for review. It has not been logged."
          tone="warning"
          actions={[{ label: "Resume review", onPress: () => router.push("/confirm-meal"), variant: "secondary" }]}
        />
      ) : null}

        {isInitialDiaryLoading ? (
          <TodaySummarySkeleton />
        ) : hasDiaryLoadError ? (
          <TodaySummaryError onRetry={() => void diary.refetch()} />
        ) : (
        <Card tone="accent" style={styles.hero}>
          <View style={[styles.dateNavigator, themed.subsurface]}>
            <Pressable style={[styles.dateNavButton, themed.controlSurface]} onPress={() => setSelectedDate(addDays(selectedDate, -1))}>
              <Text style={styles.dateNavText}>‹</Text>
            </Pressable>
            <View style={styles.dateCenter}>
              <Text style={[styles.eyebrow, themed.eyebrow]}>{selectedDateIsToday ? "Today" : "Diary date"}</Text>
              <Text style={[styles.dateLabel, themed.ink]}>{formatDateLabel(selectedDate)}</Text>
            </View>
            <Pressable style={[styles.dateNavButton, themed.controlSurface]} onPress={() => setSelectedDate(addDays(selectedDate, 1))}>
              <Text style={styles.dateNavText}>›</Text>
            </Pressable>
          </View>
          {!selectedDateIsToday ? (
            <Pressable style={styles.todayButton} onPress={() => setSelectedDate(today)}>
              <Text style={styles.todayButtonText}>Jump back to today</Text>
            </Pressable>
          ) : null}
          <View style={styles.heroMainRow}>
            <View style={styles.heroCopy}>
              <Text style={styles.heroLabel}>Daily target</Text>
              <Text style={[styles.calorieValue, themed.ink]}>{Math.round(totals.calories)}<Text style={[styles.calorieUnit, themed.muted]}> kcal</Text></Text>
              <Text style={[styles.heroText, themed.muted]}>
                {remainingCalories >= 0
                  ? `${remainingCalories} remaining today`
                  : `${Math.abs(remainingCalories)} above today’s target`}
              </Text>
              <Text style={[styles.heroInsight, themed.greenText]}>
                {hasMeals
                  ? proteinInsight(totals.proteinGrams, goal.data?.proteinGrams ?? 0)
                  : "Start with a scan, barcode, or food search."
                }
              </Text>
            </View>
            <MacroRing value={Math.round(totals.calories)} target={calorieTarget} size={132} strokeWidth={12} />
          </View>
          <View style={styles.heroProgress}>
            <MacroProgressBar label="Protein" value={totals.proteinGrams} target={goal.data?.proteinGrams ?? 140} tone="protein" selected={focusedMacro === "protein"} onPress={() => setFocusedMacro((current) => current === "protein" ? null : "protein")} />
            <MacroProgressBar label="Carbs" value={totals.carbohydrateGrams} target={goal.data?.carbohydrateGrams ?? 240} tone="carbs" selected={focusedMacro === "carbs"} onPress={() => setFocusedMacro((current) => current === "carbs" ? null : "carbs")} />
            <MacroProgressBar label="Fat" value={totals.fatGrams} target={goal.data?.fatGrams ?? 70} tone="fat" selected={focusedMacro === "fat"} onPress={() => setFocusedMacro((current) => current === "fat" ? null : "fat")} />
          </View>
          {focusedMacro ? (
            <InlineNotice
              title={macroFocusCopy(focusedMacro, totals, goal.data).title}
              body={macroFocusCopy(focusedMacro, totals, goal.data).body}
              tone={focusedMacro === "protein" ? "protein" : focusedMacro === "carbs" ? "carbs" : "fat"}
            />
          ) : null}
        </Card>
        )}

        {diary.error && diary.data ? (
          <InlineNotice
            title="Showing your last loaded diary"
            body="We couldn't refresh this day just now. Your saved meal snapshots are still visible."
            tone="warning"
            actions={[{ label: "Try again", onPress: () => void diary.refetch(), variant: "secondary" }]}
          />
        ) : null}

        <View style={styles.quickActionHeader}>
          <SectionHeader title="Add to today" meta="Choose your quickest way" />
        </View>
        <View style={styles.actionGrid}>
          <Link href="/camera" asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Scan a meal with the camera"
              accessibilityHint="Opens an assisted food review. You confirm every food and portion before logging."
              style={[styles.action, themed.action, styles.primaryAction, themed.primaryAction]}
            >
              <View style={[styles.actionIcon, themed.controlSurface]}><Ionicons name="scan-outline" size={24} color={colors.greenDeep} /></View>
              <Text style={[styles.actionTitle, themed.ink]}>Scan meal</Text>
              <Text style={[styles.actionText, themed.muted]}>Review an assisted estimate.</Text>
            </Pressable>
          </Link>
          <Link href="/manual-search" asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Search verified food records"
              accessibilityHint="Find a nutrition source, then enter the amount eaten."
              style={[styles.action, themed.action]}
            >
              <View style={[styles.actionIcon, themed.controlSurface]}><Ionicons name="search-outline" size={23} color={colors.green} /></View>
              <Text style={[styles.actionTitle, themed.ink]}>Search food</Text>
              <Text style={[styles.actionText, themed.muted]}>Use a verified record.</Text>
            </Pressable>
          </Link>
          <Link href="/natural-entry" asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Log foods with quick entry"
              accessibilityHint="Enter multiple foods with explicit weights, then confirm a nutrition source for each one."
              style={[styles.action, themed.action]}
            >
              <View style={[styles.actionIcon, themed.controlSurface]}><Ionicons name="text-outline" size={22} color={colors.green} /></View>
              <Text style={[styles.actionTitle, themed.ink]}>Quick entry</Text>
              <Text style={[styles.actionText, themed.muted]}>Add explicit weights.</Text>
            </Pressable>
          </Link>
          <Link href="/meal-builder" asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Build a multi-food meal"
              accessibilityHint="Combine source-backed foods and confirm each portion before logging."
              style={[styles.action, themed.action]}
            >
              <View style={[styles.actionIcon, themed.controlSurface]}><Ionicons name="layers-outline" size={22} color={colors.green} /></View>
              <Text style={[styles.actionTitle, themed.ink]}>Build meal</Text>
              <Text style={[styles.actionText, themed.muted]}>Combine several foods.</Text>
            </Pressable>
          </Link>
          <Link href="/recipes" asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open saved recipes"
              accessibilityHint="Review and reuse previously saved source-backed meals."
              style={[styles.action, themed.action]}
            >
              <View style={[styles.actionIcon, themed.controlSurface]}><Ionicons name="bookmark-outline" size={22} color={colors.green} /></View>
              <Text style={[styles.actionTitle, themed.ink]}>Recipes</Text>
              <Text style={[styles.actionText, themed.muted]}>Reuse saved meals.</Text>
            </Pressable>
          </Link>
          <Link href="/barcode" asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Scan a packaged-food barcode"
              accessibilityHint="Matches a package record, then asks you to confirm the amount eaten."
              style={[styles.action, themed.action]}
            >
              <View style={[styles.actionIcon, themed.controlSurface]}><Ionicons name="barcode-outline" size={23} color={colors.green} /></View>
              <Text style={[styles.actionTitle, themed.ink]}>Barcode</Text>
              <Text style={[styles.actionText, themed.muted]}>Match package details.</Text>
            </Pressable>
          </Link>
        </View>

        {!hasDiaryLoadError ? (
          <View style={styles.panel}>
            <View style={styles.nutritionHeaderRow}>
              <SectionHeader
                title={selectedDateIsToday ? "Today" : "Selected day"}
                meta={isInitialDiaryLoading ? "Loading nutrition" : `${Math.round(totals.calories)} / ${Math.round(calorieTarget)} kcal`}
              />
              {!isInitialDiaryLoading ? (
                <Link href={`/nutrients?date=${encodeURIComponent(selectedDate)}`} asChild>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`View nutrition detail for ${formatDateLabel(selectedDate)}`}
                    accessibilityHint="Review saved nutrients, targets, and meal contributions"
                    style={[styles.nutritionDetailButton, themed.controlSurface]}
                  >
                    <Text style={[styles.nutritionDetailButtonText, themed.greenText]}>Details</Text>
                  </Pressable>
                </Link>
              ) : null}
            </View>
            {isInitialDiaryLoading ? (
              <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading daily macro totals" style={styles.metricRow}>
                <SkeletonBlock height={98} style={styles.metricSkeleton} />
                <SkeletonBlock height={98} style={styles.metricSkeleton} />
                <SkeletonBlock height={98} style={styles.metricSkeleton} />
              </View>
            ) : (
              <View style={styles.metricRow}>
                <MacroStatTile label="Protein" value={Math.round(totals.proteinGrams)} suffix="g" tone="protein" />
                <MacroStatTile label="Carbs" value={Math.round(totals.carbohydrateGrams)} suffix="g" tone="carbs" />
                <MacroStatTile label="Fat" value={Math.round(totals.fatGrams)} suffix="g" tone="fat" />
              </View>
            )}
          </View>
        ) : null}

        <HydrationModule selectedDate={selectedDate} selectedDateIsToday={selectedDateIsToday} />

        {isInitialDiaryLoading ? (
          <DailyObservationSkeleton />
        ) : hasDiaryLoadError ? null : (
          <Card tone="soft" style={styles.dailyObservationCard}>
            <Text style={styles.dailyObservationEyebrow}>Daily observation</Text>
            <Text style={[styles.dailyObservationTitle, themed.ink]}>{dailyObservation.title}</Text>
            <Text style={[styles.dailyObservationBody, themed.muted]}>{dailyObservation.body}</Text>
          </Card>
        )}

        <View style={styles.panel}>
          <View style={styles.timelineHeaderRow}>
            <SectionHeader title="Meal timeline" />
            {!isInitialDiaryLoading ? (
              <Link href={`/diary?date=${encodeURIComponent(selectedDate)}`} asChild>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open daily diary for ${formatDateLabel(selectedDate)}`}
                  accessibilityHint="Review all saved meals for this day"
                  style={[styles.diaryLink, themed.controlSurface]}
                >
                  <Text style={[styles.diaryLinkText, themed.greenText]}>Full diary</Text>
                </Pressable>
              </Link>
            ) : null}
          </View>
          {isInitialDiaryLoading ? (
            <TimelineLoadingSkeleton />
          ) : hasDiaryLoadError ? (
            <ErrorState
              title="Your diary is unavailable"
              body="Check your connection, then try loading this day again."
              onRetry={() => void diary.refetch()}
            />
          ) : hasMeals ? (
            timelineGroups.map((group) => (
              <View key={group.id} style={styles.timelineGroup}>
                <SectionHeader title={group.label} meta={`${group.meals.length} meal${group.meals.length === 1 ? "" : "s"}`} />
                {group.meals.map((meal, index) => (
                  <TimelineMealCard
                    key={meal.id}
                    index={index}
                    mealName={readableFoodName(meal.name)}
                    onEdit={() => router.push(`/meal/${meal.id}`)}
                    onDelete={() => confirmDeleteMeal(meal)}
                    deleteDisabled={deleteMealMutation.isPending}
                  >
                    <View style={styles.timelineTop}>
                      <MealTimelineVisual mealType={meal.mealType} />
                      <View style={styles.timelineHeaderCopy}>
                        <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.timelineTitle, themed.ink]}>
                          {readableFoodName(meal.name)}
                        </Text>
                        <View style={styles.timelineMetaRow}>
                          <Text style={[styles.timelineMeta, themed.muted]}>{formatMealTime(meal.loggedAt)}</Text>
                          <Text style={[styles.timelineDot, themed.muted]}>•</Text>
                          <Text style={[styles.timelineMeta, themed.muted]}>
                            {Math.round(meal.items.reduce((total, item) => total + item.calories, 0))} kcal
                          </Text>
                          <Text style={[styles.timelineDot, themed.muted]}>•</Text>
                          <Text style={[styles.timelineMeta, themed.muted]}>
                            {meal.items.length} food{meal.items.length === 1 ? "" : "s"}
                          </Text>
                        </View>
                      </View>
                      <StatusPill
                        label={mealStatusLabel(meal)}
                        tone={meal.items.every((item) => item.userConfirmed) ? "success" : "warning"}
                        style={styles.timelineStatus}
                      />
                    </View>
                <View
                  accessible
                  accessibilityLabel={`Macros: ${Math.round(meal.items.reduce((total, item) => total + item.proteinGrams, 0))} grams protein, ${Math.round(meal.items.reduce((total, item) => total + item.carbohydrateGrams, 0))} grams carbohydrates, ${Math.round(meal.items.reduce((total, item) => total + item.fatGrams, 0))} grams fat`}
                  style={styles.timelineNutrientRow}
                >
                  <Text style={[styles.timelineNutrient, themed.timelineProtein]}>P {Math.round(meal.items.reduce((total, item) => total + item.proteinGrams, 0))}g</Text>
                  <Text style={[styles.timelineNutrient, themed.timelineCarbs]}>C {Math.round(meal.items.reduce((total, item) => total + item.carbohydrateGrams, 0))}g</Text>
                  <Text style={[styles.timelineNutrient, themed.timelineFat]}>F {Math.round(meal.items.reduce((total, item) => total + item.fatGrams, 0))}g</Text>
                </View>
                <SourceBadge label={sourceLabel(meal.items[0]?.sourceProvider)} tone={meal.items.every((item) => item.userConfirmed) ? "success" : "warning"} />
                <Text numberOfLines={1} style={[styles.timelineSnapshot, themed.muted]}>
                  Based on saved meal snapshots and confirmed portions.
                </Text>
                <TimelineMealDetails meal={meal} />
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
                ))}
              </View>
            ))
          ) : (
            <EmptyState
              title="Nothing logged yet"
              body="A balanced picture builds one meal at a time. Add your next meal whenever you’re ready."
              actionLabel="Scan or add food"
              onAction={() => router.push("/camera")}
              icon="restaurant-outline"
            />
          )}
        </View>
    </ScreenShell>
  );
}

function TodaySummarySkeleton() {
  return (
    <Card tone="accent" style={styles.hero}>
      <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading daily nutrition summary" style={styles.loadingStack}>
        <SkeletonBlock height={14} width="28%" />
        <SkeletonBlock height={46} width="48%" />
        <SkeletonBlock height={18} width="66%" />
        <View style={styles.loadingRing} />
      </View>
      <View style={styles.loadingProgress}>
        <SkeletonBlock height={38} />
        <SkeletonBlock height={38} />
        <SkeletonBlock height={38} />
      </View>
    </Card>
  );
}

function TodaySummaryError({ onRetry }: { onRetry: () => void }) {
  return (
    <ErrorState
      title="Your daily summary is unavailable"
      body="We couldn't load this day's saved meal snapshots. You can still add food while we reconnect."
      onRetry={onRetry}
    />
  );
}

function DailyObservationSkeleton() {
  return (
    <Card tone="soft" style={styles.dailyObservationCard}>
      <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading daily observation" style={styles.loadingStack}>
        <SkeletonBlock height={12} width="34%" />
        <SkeletonBlock height={22} width="74%" />
        <SkeletonBlock height={18} width="94%" />
      </View>
    </Card>
  );
}

function HydrationModule({
  selectedDate,
  selectedDateIsToday,
}: {
  selectedDate: string;
  selectedDateIsToday: boolean;
}) {
  const queryClient = useQueryClient();
  const { palette } = useTheme();
  const themed = homeThemeStyles(palette);
  const hydration = useQuery<HydrationEntry | null>({
    queryKey: ["hydration", selectedDate],
    queryFn: () => api.getHydrationEntry(selectedDate),
    retry: 1,
    retryDelay: 300,
  });
  const [editorOpen, setEditorOpen] = useState(false);
  const [draftMilliliters, setDraftMilliliters] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const currentMilliliters = hydration.data?.milliliters ?? 0;
  const isInitialLoading = hydration.isLoading && !hydration.data;
  const hasLoadError = Boolean(hydration.error && !hydration.data);
  const mutation = useMutation({
    mutationFn: async (milliliters: number) => {
      if (milliliters > 0) {
        await api.saveHydrationEntry(selectedDate, { milliliters });
        return;
      }

      await api.deleteHydrationEntry(selectedDate);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["hydration", selectedDate] });
      setEditorOpen(false);
      setNotice(null);
    },
    onError: (error) => {
      setNotice(error.message || "We couldn't save this hydration total. Try again when you are connected.");
    },
  });

  useEffect(() => {
    setEditorOpen(false);
    setNotice(null);
  }, [selectedDate]);

  function addWater(milliliters: number) {
    mutation.mutate(Math.min(currentMilliliters + milliliters, 20_000));
  }

  function saveManualTotal() {
    const nextMilliliters = Number(draftMilliliters);
    if (!Number.isInteger(nextMilliliters) || nextMilliliters < 1 || nextMilliliters > 20_000) {
      setNotice("Enter a whole-number total between 1 and 20,000 mL.");
      return;
    }

    mutation.mutate(nextMilliliters);
  }

  function confirmClear() {
    Alert.alert(
      "Clear hydration total?",
      `This removes the ${currentMilliliters} mL total from ${selectedDateIsToday ? "today" : "this day"}.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Clear", style: "destructive", onPress: () => mutation.mutate(0) },
      ]
    );
  }

  return (
    <Card tone="insight" style={styles.hydrationCard}>
      <View style={styles.hydrationHeader}>
        <View style={styles.hydrationHeaderCopy}>
          <Text style={[styles.hydrationEyebrow, { color: colors.insight }]}>Optional daily log</Text>
          <Text style={[styles.hydrationTitle, themed.ink]}>Hydration</Text>
        </View>
        <View accessible accessibilityLabel={`Water logged: ${currentMilliliters} milliliters`} style={[styles.hydrationDroplet, themed.hydrationDroplet]}>
          <Ionicons name="water" size={21} color={colors.insight} />
        </View>
      </View>

      {isInitialLoading ? (
        <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading hydration total" style={styles.hydrationLoading}>
          <SkeletonBlock height={40} width="40%" />
          <SkeletonBlock height={18} width="90%" />
        </View>
      ) : hasLoadError ? (
        <ErrorState
          title="Hydration is unavailable"
          body="Check your connection, then try loading this day again."
          onRetry={() => void hydration.refetch()}
        />
      ) : (
        <>
          <Text style={[styles.hydrationValue, themed.ink]}>{currentMilliliters}<Text style={[styles.hydrationUnit, themed.muted]}> mL</Text></Text>
          <Text style={[styles.hydrationBody, themed.muted]}>
            Log water if it helps you notice your routine. This total is optional and not a medical recommendation.
          </Text>
          <View style={styles.hydrationActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add 250 milliliters of water"
              disabled={mutation.isPending || currentMilliliters >= 20_000}
              onPress={() => addWater(250)}
              style={({ pressed }) => [styles.hydrationQuickAction, themed.hydrationQuickAction, pressed ? styles.hydrationPressed : undefined]}
            >
              <Text style={[styles.hydrationQuickActionText, { color: colors.insight }]}>+250 mL</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add 500 milliliters of water"
              disabled={mutation.isPending || currentMilliliters >= 20_000}
              onPress={() => addWater(500)}
              style={({ pressed }) => [styles.hydrationQuickAction, themed.hydrationQuickAction, pressed ? styles.hydrationPressed : undefined]}
            >
              <Text style={[styles.hydrationQuickActionText, { color: colors.insight }]}>+500 mL</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Adjust hydration total"
              accessibilityState={{ expanded: editorOpen }}
              disabled={mutation.isPending}
              onPress={() => {
                setDraftMilliliters(currentMilliliters ? String(currentMilliliters) : "");
                setEditorOpen((current) => !current);
              }}
              style={({ pressed }) => [styles.hydrationTextAction, pressed ? styles.hydrationPressed : undefined]}
            >
              <Text style={[styles.hydrationTextActionText, { color: colors.insight }]}>Adjust total</Text>
            </Pressable>
          </View>
          {editorOpen ? (
            <View style={[styles.hydrationEditor, themed.hydrationEditor]}>
              <Text style={[styles.hydrationInputLabel, themed.muted]}>Total water in milliliters</Text>
              <View style={styles.hydrationEditorRow}>
                <TextInput
                  accessibilityLabel="Hydration total in milliliters"
                  value={draftMilliliters}
                  onChangeText={setDraftMilliliters}
                  keyboardType="number-pad"
                  maxLength={5}
                  placeholder="e.g. 750"
                  placeholderTextColor={palette.muted}
                  style={[styles.hydrationInput, themed.hydrationInput, themed.ink]}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Save hydration total"
                  disabled={mutation.isPending}
                  onPress={saveManualTotal}
                  style={({ pressed }) => [styles.hydrationSaveAction, themed.hydrationSaveAction, pressed ? styles.hydrationPressed : undefined]}
                >
                  <Text style={[styles.hydrationSaveActionText, themed.hydrationSaveActionText]}>{mutation.isPending ? "Saving..." : "Save"}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          {currentMilliliters > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear hydration total"
              disabled={mutation.isPending}
              onPress={confirmClear}
              style={({ pressed }) => [styles.hydrationClearAction, pressed ? styles.hydrationPressed : undefined]}
            >
              <Text style={[styles.hydrationClearActionText, { color: palette.dangerText }]}>Clear this day</Text>
            </Pressable>
          ) : null}
          {notice ? <InlineNotice title="Hydration" body={notice} tone="warning" /> : null}
        </>
      )}
    </Card>
  );
}

function TimelineLoadingSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading meal timeline" style={styles.timelineLoading}>
      {[0, 1].map((index) => (
        <Card key={index} style={styles.timelineCard}>
          <SkeletonBlock height={22} width={index === 0 ? "72%" : "58%"} />
          <SkeletonBlock height={16} width="48%" />
          <SkeletonBlock height={18} width="88%" />
        </Card>
      ))}
    </View>
  );
}

function TimelineMealDetails({ meal }: { meal: MealRead }) {
  const [expanded, setExpanded] = useState(false);
  const { palette } = useTheme();
  const themed = homeThemeStyles(palette);
  const itemLabel = `${meal.items.length} food${meal.items.length === 1 ? "" : "s"}`;

  return (
    <View style={styles.timelineDetails}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? "Hide" : "Show"} ${itemLabel} in ${readableFoodName(meal.name)}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => [styles.expandButton, themed.expandButton, pressed ? styles.expandButtonPressed : undefined]}
      >
        <Text style={[styles.expandButtonText, themed.greenText]}>{expanded ? "Hide foods" : `Show ${itemLabel}`}</Text>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={17} color={colors.green} />
      </Pressable>
      {expanded ? (
        <View style={styles.expandedFoods}>
          {meal.items.map((item) => (
            <View key={item.id} style={[styles.expandedFoodRow, themed.subsurface]}>
              <View style={styles.expandedFoodCopy}>
                <Text numberOfLines={2} style={[styles.expandedFoodName, themed.ink]}>{readableFoodName(item.displayName)}</Text>
                <Text style={[styles.expandedFoodMeta, themed.muted]}>
                  {Math.round(item.consumedGrams)}g • {Math.round(item.calories)} kcal • {Math.round(item.proteinGrams)}g protein
                </Text>
              </View>
              <SourceBadge label={sourceLabel(item.sourceProvider)} tone={item.userConfirmed ? "success" : "warning"} />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

type TimelineMealVisual = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  lightBackground: string;
  darkBackground: string;
  iconColor: string;
};

export function timelineMealVisual(mealType: MealType | undefined): TimelineMealVisual {
  switch (mealType) {
    case "breakfast":
      return { label: "Breakfast", icon: "sunny-outline", lightBackground: colors.carbsSoft, darkBackground: "rgba(129, 92, 26, 0.80)", iconColor: colors.carbs };
    case "lunch":
      return { label: "Lunch", icon: "leaf-outline", lightBackground: colors.limeSoft, darkBackground: "rgba(41, 91, 57, 0.82)", iconColor: colors.fiber };
    case "dinner":
      return { label: "Dinner", icon: "moon-outline", lightBackground: colors.proteinSoft, darkBackground: "rgba(67, 51, 101, 0.82)", iconColor: colors.protein };
    case "snack":
      return { label: "Snack", icon: "cafe-outline", lightBackground: colors.fatSoft, darkBackground: "rgba(107, 54, 68, 0.82)", iconColor: colors.fat };
    default:
      return { label: "Meal", icon: "restaurant-outline", lightBackground: colors.insightSoft, darkBackground: "rgba(48, 78, 113, 0.82)", iconColor: colors.insight };
  }
}

function MealTimelineVisual({ mealType }: { mealType: MealType | undefined }) {
  const { palette } = useTheme();
  const visual = timelineMealVisual(mealType);

  return (
    <View
      accessible
      accessibilityLabel={`${visual.label} meal placeholder`}
      style={[styles.timelineMealVisual, { backgroundColor: palette.mode === "dark" ? visual.darkBackground : visual.lightBackground }]}
    >
      <Ionicons name={visual.icon} size={23} color={visual.iconColor} />
    </View>
  );
}

function homeThemeStyles(palette: ThemePalette) {
  return {
    ink: { color: palette.ink },
    muted: { color: palette.muted },
    eyebrow: { color: palette.muted },
    greenText: { color: palette.mode === "dark" ? "#9DE2B4" : colors.greenDeep },
    avatarButton: { backgroundColor: palette.mode === "dark" ? "rgba(62, 92, 49, 0.88)" : colors.limeSoft, borderColor: palette.border },
    subsurface: { backgroundColor: palette.surfaceAlt },
    controlSurface: { backgroundColor: palette.controlSurface },
    action: { backgroundColor: palette.contentGlass, borderColor: palette.border },
    primaryAction: { backgroundColor: palette.mode === "dark" ? "rgba(57, 85, 40, 0.92)" : colors.limeSoft },
    loggingRhythm: {
      backgroundColor: palette.mode === "dark" ? "rgba(45, 88, 58, 0.72)" : "rgba(229, 243, 206, 0.92)",
      borderColor: palette.border,
    },
    loggingRhythmIcon: { color: palette.mode === "dark" ? "#9DE2B4" : colors.greenDeep },
    expandButton: { backgroundColor: palette.mode === "dark" ? "rgba(50, 88, 58, 0.86)" : colors.limeSoft },
    hydrationDroplet: { backgroundColor: palette.mode === "dark" ? "rgba(54, 78, 111, 0.84)" : "rgba(220, 239, 246, 0.94)" },
    hydrationQuickAction: { backgroundColor: palette.mode === "dark" ? "rgba(54, 78, 111, 0.84)" : "rgba(220, 239, 246, 0.94)", borderColor: palette.border },
    hydrationEditor: { backgroundColor: palette.surfaceAlt, borderColor: palette.border },
    hydrationInput: { backgroundColor: palette.controlSurface, borderColor: palette.border },
    hydrationSaveAction: { backgroundColor: colors.insight },
    hydrationSaveActionText: { color: palette.mode === "dark" ? "#0B151D" : "#FFFFFF" },
    timelineProtein: { color: palette.mode === "dark" ? "#CFB4FF" : colors.protein, backgroundColor: palette.mode === "dark" ? "rgba(70, 50, 104, 0.82)" : colors.proteinSoft },
    timelineCarbs: { color: palette.warningText, backgroundColor: palette.mode === "dark" ? "rgba(98, 73, 21, 0.82)" : colors.carbsSoft },
    timelineFat: { color: palette.mode === "dark" ? "#F6A1B0" : colors.fat, backgroundColor: palette.mode === "dark" ? "rgba(100, 49, 57, 0.82)" : colors.fatSoft },
  };
}

function TimelineMealCard({
  children,
  index,
  mealName,
  onEdit,
  onDelete,
  deleteDisabled,
}: {
  children: ReactNode;
  index: number;
  mealName: string;
  onEdit: () => void;
  onDelete: () => void;
  deleteDisabled: boolean;
}) {
  const entrance = useRef(new Animated.Value(0)).current;
  const translationX = useRef(new Animated.Value(0)).current;
  const currentTranslation = useRef(0);
  const reducedMotion = useReducedMotionPreference();
  const reducedMotionRef = useRef(reducedMotion);
  const revealedActionRef = useRef<TimelineSwipeDestination>(null);
  const [revealedAction, setRevealedAction] = useState<TimelineSwipeDestination>(null);

  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  const settleSwipe = (destination: TimelineSwipeDestination) => {
    const nextTranslation =
      destination === "edit"
        ? timelineSwipeRevealDistance
        : destination === "delete"
          ? -timelineSwipeRevealDistance
          : 0;

    currentTranslation.current = nextTranslation;
    setRevealedAction(destination);

    if (destination && destination !== revealedActionRef.current && !reducedMotionRef.current) {
      void Haptics.selectionAsync().catch(() => undefined);
    }
    revealedActionRef.current = destination;

    if (reducedMotionRef.current) {
      translationX.setValue(nextTranslation);
      return;
    }

    Animated.spring(translationX, {
      toValue: nextTranslation,
      useNativeDriver: true,
      speed: 22,
      bounciness: 0,
    }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderMove: (_, gesture) => {
        const nextTranslation = Math.max(
          -timelineSwipeRevealDistance,
          Math.min(timelineSwipeRevealDistance, currentTranslation.current + gesture.dx)
        );
        translationX.setValue(nextTranslation);
      },
      onPanResponderRelease: (_, gesture) => {
        const nextTranslation = Math.max(
          -timelineSwipeRevealDistance,
          Math.min(timelineSwipeRevealDistance, currentTranslation.current + gesture.dx)
        );
        settleSwipe(timelineSwipeDestination(nextTranslation, gesture.vx));
      },
      onPanResponderTerminate: () => settleSwipe(null),
    })
  ).current;

  useEffect(() => {
    if (reducedMotion) {
      entrance.setValue(1);
      return undefined;
    }

    entrance.setValue(0);
    Animated.timing(entrance, {
      toValue: 1,
      duration: motion.reveal,
      delay: Math.min(index, 6) * 45,
      useNativeDriver: true,
    }).start();
  }, [entrance, index, reducedMotion]);

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
      <View style={styles.timelineSwipeContainer}>
        <View
          accessible={revealedAction !== null}
          accessibilityElementsHidden={revealedAction === null}
          importantForAccessibility={revealedAction === null ? "no-hide-descendants" : "yes"}
          style={styles.timelineSwipeActions}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit portions for ${mealName}`}
            onPress={() => {
              settleSwipe(null);
              onEdit();
            }}
            style={[styles.timelineSwipeAction, styles.timelineSwipeEditAction]}
          >
            <Ionicons color={colors.white} name="create-outline" size={20} />
            <Text style={styles.timelineSwipeActionText}>Edit</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Delete ${mealName}`}
            disabled={deleteDisabled}
            onPress={() => {
              settleSwipe(null);
              onDelete();
            }}
            style={[styles.timelineSwipeAction, styles.timelineSwipeDeleteAction, deleteDisabled && styles.timelineSwipeActionDisabled]}
          >
            <Ionicons color={colors.white} name="trash-outline" size={20} />
            <Text style={styles.timelineSwipeActionText}>{deleteDisabled ? "Deleting" : "Delete"}</Text>
          </Pressable>
        </View>
        <Animated.View
          {...panResponder.panHandlers}
          accessibilityHint="Swipe right to reveal edit or left to reveal delete. Standard edit and delete controls are below."
          style={{ transform: [{ translateX: translationX }] }}
        >
          <Card style={styles.timelineCard}>{children}</Card>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

function useReducedMotionPreference() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let active = true;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      if (active) setReducedMotion(enabled);
    });

    const getReducedMotion = AccessibilityInfo.isReduceMotionEnabled;
    if (typeof getReducedMotion === "function") {
      void getReducedMotion().then((enabled) => {
        if (active) setReducedMotion(enabled);
      }).catch(() => undefined);
    }

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reducedMotion;
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

export function groupMealsByCategory(meals: MealRead[]) {
  const groups: Array<{ id: MealType; label: string }> = [
    { id: "breakfast", label: "Breakfast" },
    { id: "lunch", label: "Lunch" },
    { id: "dinner", label: "Dinner" },
    { id: "snack", label: "Snacks" },
    { id: "meal", label: "Other meals" },
  ];

  return groups
    .map((group) => ({
      ...group,
      meals: meals.filter((meal) => (meal.mealType ?? "meal") === group.id),
    }))
    .filter((group) => group.meals.length > 0);
}

function getGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function proteinInsight(protein: number, target: number) {
  if (!target) return "Your daily totals are based on saved meal snapshots.";
  const remaining = Math.max(Math.round(target - protein), 0);
  return remaining > 0 ? `About ${remaining} g of protein remains for your target.` : "Your protein target is met for this day.";
}

export function loggingRhythmCopy(loggedDays: number, durationDays: number) {
  if (loggedDays <= 0) {
    return "Your rhythm starts with one meal.";
  }

  return `${loggedDays} of ${durationDays} days logged`;
}

export function loggingRhythmAccessibilityLabel(loggedDays: number, durationDays: number) {
  return `Logging rhythm: ${loggingRhythmCopy(loggedDays, durationDays)}. This reflects saved diary coverage, not a nutrition grade.`;
}

function macroFocusCopy(
  macro: MacroFocus,
  totals: DiaryDay["totals"],
  goal: { proteinGrams?: number; carbohydrateGrams?: number; fatGrams?: number } | null | undefined
) {
  const details = {
    protein: { label: "Protein", value: totals.proteinGrams, target: goal?.proteinGrams ?? 140 },
    carbs: { label: "Carbohydrates", value: totals.carbohydrateGrams, target: goal?.carbohydrateGrams ?? 240 },
    fat: { label: "Fat", value: totals.fatGrams, target: goal?.fatGrams ?? 70 },
  }[macro];
  const remaining = Math.max(Math.round(details.target - details.value), 0);

  return {
    title: `${details.label} progress`,
    body: remaining
      ? `${Math.round(details.value)}g is logged from saved meal snapshots. About ${remaining}g remains for this adjustable daily target.`
      : `${Math.round(details.value)}g is logged from saved meal snapshots. This total has reached the current adjustable daily target.`,
  };
}

function buildDailyObservation(meals: MealRead[]) {
  if (!meals.length) {
    return {
      title: "Your day will take shape one meal at a time.",
      body: "When you log a meal, this space will reflect your saved nutrition snapshots.",
    };
  }

  const mealWithMostFiber = meals.reduce((current, meal) => {
    const fiber = meal.items.reduce((total, item) => total + (item.fiberGrams ?? 0), 0);
    const currentFiber = current.items.reduce((total, item) => total + (item.fiberGrams ?? 0), 0);
    return fiber > currentFiber ? meal : current;
  });
  const fiber = mealWithMostFiber.items.reduce((total, item) => total + (item.fiberGrams ?? 0), 0);

  if (fiber > 0) {
    return {
      title: `${mealCategoryLabel(mealWithMostFiber.mealType)} contributed the most fiber so far.`,
      body: `About ${Math.round(fiber)}g comes from ${readableFoodName(mealWithMostFiber.name)} based on its saved meal snapshot.`,
    };
  }

  const mealWithMostProtein = meals.reduce((current, meal) => {
    const protein = meal.items.reduce((total, item) => total + item.proteinGrams, 0);
    const currentProtein = current.items.reduce((total, item) => total + item.proteinGrams, 0);
    return protein > currentProtein ? meal : current;
  });
  const protein = mealWithMostProtein.items.reduce((total, item) => total + item.proteinGrams, 0);

  return {
    title: `${mealCategoryLabel(mealWithMostProtein.mealType)} carries the most protein so far.`,
    body: `About ${Math.round(protein)}g comes from ${readableFoodName(mealWithMostProtein.name)} based on its saved meal snapshot.`,
  };
}

function mealCategoryLabel(mealType: MealType | undefined) {
  return mealType === "snack" ? "Snacks" : mealType ? mealType[0].toUpperCase() + mealType.slice(1) : "This meal";
}

const styles = StyleSheet.create({
  topHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  topHeaderCopy: { flex: 1, gap: 2 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  loggingRhythm: {
    minHeight: 50,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  loggingRhythmCopy: { gap: 1 },
  loggingRhythmLabel: { ...typography.caption, color: colors.muted },
  loggingRhythmValue: { ...typography.button, color: colors.ink },
  greeting: { ...typography.heading, color: colors.ink },
  headerDate: { ...typography.caption, color: colors.muted },
  headerIconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.limeSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(28, 116, 83, 0.16)",
  },
  hero: {
    gap: spacing.lg,
    borderRadius: radii.hero,
  },
  nutritionHeaderRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  nutritionDetailButton: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  nutritionDetailButtonText: { ...typography.caption },
  loadingStack: { gap: spacing.sm },
  loadingRing: { position: "absolute", top: 4, right: 0, width: 112, height: 112, borderRadius: radii.pill, borderWidth: 10, borderColor: "rgba(20, 37, 29, 0.12)" },
  loadingProgress: { gap: spacing.sm },
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
    flex: 1,
  },
  eyebrow: {
    ...typography.eyebrow,
    color: colors.muted,
  },
  heroMainRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  heroLabel: {
    ...typography.eyebrow,
    color: colors.greenDeep,
  },
  calorieValue: {
    ...typography.displayLarge,
    color: colors.ink,
  },
  calorieUnit: { ...typography.caption, color: colors.muted },
  heroText: {
    ...typography.body,
    color: colors.muted,
  },
  heroInsight: {
    ...typography.caption,
    color: colors.greenDeep,
    maxWidth: 240,
  },
  errorText: {
    ...typography.caption,
    color: colors.coral,
  },
  heroProgress: { gap: spacing.sm },
  quickActionHeader: { marginTop: spacing.xs },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  action: {
    flexGrow: 1,
    flexBasis: "46%",
    minHeight: 142,
    borderRadius: radii.lg,
    padding: spacing.md,
    backgroundColor: "rgba(255, 255, 255, 0.72)",
    justifyContent: "space-between",
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.8)",
  },
  primaryAction: {
    backgroundColor: colors.limeSoft,
  },
  actionIcon: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: radii.md, backgroundColor: "rgba(255,255,255,0.72)" },
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
  dailyObservationCard: { gap: spacing.xs },
  dailyObservationEyebrow: { ...typography.eyebrow, color: colors.insight },
  dailyObservationTitle: { ...typography.heading, color: colors.ink },
  dailyObservationBody: { ...typography.body, color: colors.muted },
  hydrationCard: { gap: spacing.sm },
  hydrationHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  hydrationHeaderCopy: { flex: 1, gap: 2 },
  hydrationEyebrow: { ...typography.eyebrow },
  hydrationTitle: { ...typography.heading, color: colors.ink },
  hydrationDroplet: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: radii.pill },
  hydrationLoading: { gap: spacing.sm },
  hydrationValue: { ...typography.displayLarge, color: colors.ink },
  hydrationUnit: { ...typography.body, color: colors.muted },
  hydrationBody: { ...typography.body, color: colors.muted },
  hydrationActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  hydrationQuickAction: { minHeight: 44, justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.pill, paddingHorizontal: spacing.md },
  hydrationQuickActionText: { ...typography.button },
  hydrationTextAction: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.sm },
  hydrationTextActionText: { ...typography.button },
  hydrationPressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  hydrationEditor: { gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.sm },
  e2eFixtureControl: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.greenDeep,
  },
  e2eFixtureControlText: { color: colors.white, ...typography.button },
  hydrationInputLabel: { ...typography.caption, color: colors.muted },
  hydrationEditorRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  hydrationInput: { flex: 1, minHeight: 48, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.sm, paddingHorizontal: spacing.sm, ...typography.body },
  hydrationSaveAction: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radii.sm, paddingHorizontal: spacing.md },
  hydrationSaveActionText: { ...typography.button },
  hydrationClearAction: { alignSelf: "flex-start", minHeight: 40, justifyContent: "center" },
  hydrationClearActionText: { ...typography.button },
  timelineLoading: { gap: spacing.sm },
  timelineHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  diaryLink: {
    minHeight: 40,
    justifyContent: "center",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
  },
  diaryLinkText: {
    ...typography.caption,
    fontWeight: "800",
  },
  metricRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  metricSkeleton: { flex: 1, minWidth: 0, borderRadius: radii.md },
  timelineCard: {
    gap: spacing.xs,
  },
  timelineSwipeContainer: {
    borderRadius: radii.lg,
    overflow: "hidden",
  },
  timelineSwipeActions: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "stretch",
  },
  timelineSwipeAction: {
    width: timelineSwipeRevealDistance,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
  },
  timelineSwipeEditAction: {
    backgroundColor: colors.green,
  },
  timelineSwipeDeleteAction: {
    backgroundColor: colors.coral,
  },
  timelineSwipeActionDisabled: {
    opacity: 0.62,
  },
  timelineSwipeActionText: {
    ...typography.caption,
    color: colors.white,
    fontWeight: "700",
  },
  timelineGroup: {
    gap: spacing.sm,
  },
  timelineTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  timelineMealVisual: {
    width: 48,
    height: 48,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
  },
  timelineHeaderCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  timelineTitle: {
    ...typography.heading,
    color: colors.ink,
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
  },
  timelineMeta: {
    ...typography.caption,
    color: colors.muted,
  },
  timelineNutrientRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  timelineNutrient: {
    ...typography.caption,
    borderRadius: radii.pill,
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
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
  timelineDetails: { gap: spacing.xs, paddingTop: spacing.xs },
  expandButton: {
    minHeight: 40,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.limeSoft,
  },
  expandButtonPressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
  expandButtonText: { ...typography.caption, color: colors.greenDeep },
  expandedFoods: { gap: spacing.xs, paddingTop: spacing.xs },
  expandedFoodRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radii.md,
    padding: spacing.sm,
    backgroundColor: colors.background,
  },
  expandedFoodCopy: { flex: 1, minWidth: 0, gap: 2 },
  expandedFoodName: { ...typography.caption, color: colors.ink },
  expandedFoodMeta: { ...typography.caption, color: colors.muted },
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
