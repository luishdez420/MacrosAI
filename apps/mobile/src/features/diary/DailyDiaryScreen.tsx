import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { DiaryDay, MealRead, MealType } from "@living-nutrition/shared-types";
import { colors, radii, spacing, typography, type ThemePalette } from "@living-nutrition/design-tokens";
import { api } from "../../services/api";
import {
  Card,
  EmptyState,
  ErrorState,
  MacroStatTile,
  readableFoodName,
  ScreenShell,
  SectionHeader,
  SkeletonBlock,
  SourceBadge,
  sourceLabel,
  StatusPill,
} from "../../shared/components/LivingUI";
import { formatMealTime } from "../../shared/domain/mealTiming";
import { useTheme } from "../../shared/theme/ThemeProvider";

const mealTypeOrder: MealType[] = ["breakfast", "lunch", "dinner", "snack", "meal"];

export function DailyDiaryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ date?: string }>();
  const today = currentDateKey();
  const requestedDate = normalizedDate(params.date, today);
  const [selectedDate, setSelectedDate] = useState(requestedDate);
  const { palette } = useTheme();
  const themed = diaryThemeStyles(palette);
  const diary = useQuery<DiaryDay>({
    queryKey: ["diary", selectedDate],
    queryFn: () => api.getDiary(selectedDate),
    retry: 1,
    retryDelay: 300,
  });

  useEffect(() => {
    setSelectedDate(requestedDate);
  }, [requestedDate]);

  const isToday = selectedDate === today;
  const totals = diary.data?.totals;
  const mealGroups = groupMeals(diary.data?.meals ?? []);

  return (
    <ScreenShell>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={[styles.eyebrow, themed.actionText]}>Diary</Text>
          <Text style={[styles.title, themed.ink]}>Your day, clearly recorded.</Text>
          <Text style={[styles.body, themed.muted]}>
            Review the portions and source-backed meal snapshots you saved for this date.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close daily diary"
          accessibilityHint="Returns to Today"
          onPress={() => router.back()}
          style={[styles.closeButton, themed.subsurface]}
        >
          <Ionicons name="close" size={22} color={palette.ink} />
        </Pressable>
      </View>

      <DateNavigator
        date={selectedDate}
        isToday={isToday}
        onPrevious={() => setSelectedDate((current) => addDays(current, -1))}
        onNext={() => setSelectedDate((current) => addDays(current, 1))}
        onToday={() => setSelectedDate(today)}
      />

      {diary.isLoading && !diary.data ? <DiaryLoadingSkeleton /> : null}
      {diary.error && !diary.data ? (
        <ErrorState
          title="This diary day is unavailable"
          body="Check your connection, then try loading this day again."
          onRetry={() => void diary.refetch()}
        />
      ) : null}

      {diary.data && totals ? (
        <>
          {diary.error ? (
            <ErrorState
              title="Showing your last loaded diary"
              body="We couldn't refresh this day just now. The meal snapshots below are from your last successful load."
              onRetry={() => void diary.refetch()}
            />
          ) : null}
          <Card tone="accent" style={styles.summaryCard}>
            <Text style={[styles.summaryLabel, themed.muted]}>{isToday ? "Today so far" : formatDateLabel(selectedDate)}</Text>
            <Text accessibilityLabel={`${Math.round(totals.calories)} calories logged`} style={[styles.calorieValue, themed.ink]}>
              {Math.round(totals.calories)} <Text style={[styles.calorieUnit, themed.muted]}>kcal</Text>
            </Text>
            <Text style={[styles.summaryCopy, themed.muted]}>
              {diary.data.meals.length
                ? `${diary.data.meals.length} meal${diary.data.meals.length === 1 ? "" : "s"} saved. Totals use the portions you confirmed.`
                : "No meals saved for this day yet."}
            </Text>
            <View style={styles.macroRow}>
              <MacroStatTile label="Protein" value={Math.round(totals.proteinGrams)} suffix="g" tone="protein" />
              <MacroStatTile label="Carbs" value={Math.round(totals.carbohydrateGrams)} suffix="g" tone="carbs" />
              <MacroStatTile label="Fat" value={Math.round(totals.fatGrams)} suffix="g" tone="fat" />
            </View>
          </Card>

          {mealGroups.length ? (
            <View style={styles.mealStack}>
              {mealGroups.map((group) => (
                <View key={group.id} style={styles.mealGroup}>
                  <SectionHeader title={group.label} meta={`${group.meals.length} meal${group.meals.length === 1 ? "" : "s"}`} />
                  {group.meals.map((meal) => <DiaryMealCard key={meal.id} meal={meal} />)}
                </View>
              ))}
            </View>
          ) : (
            <EmptyState
              title="Nothing saved for this day"
              body="Add a meal whenever it is useful. Your diary is here to reflect what you log, not to judge it."
              actionLabel={isToday ? "Add a food" : "Return to Today"}
              onAction={() => router.push(isToday ? "/manual-search" : "/")}
              icon="restaurant-outline"
            />
          )}
        </>
      ) : null}
    </ScreenShell>
  );
}

function DateNavigator({ date, isToday, onPrevious, onNext, onToday }: {
  date: string;
  isToday: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  const { palette } = useTheme();
  const themed = diaryThemeStyles(palette);

  return (
    <View style={[styles.dateNavigator, themed.subsurface]}>
      <Pressable accessibilityRole="button" accessibilityLabel="View previous diary day" onPress={onPrevious} style={[styles.dateButton, themed.controlSurface]}>
        <Ionicons name="chevron-back" size={20} color={palette.ink} />
      </Pressable>
      <View style={styles.dateCopy}>
        <Text style={[styles.dateLabel, themed.ink]}>{isToday ? "Today" : formatDateLabel(date)}</Text>
        {!isToday ? <Pressable accessibilityRole="button" accessibilityLabel="Jump to today's diary" onPress={onToday}><Text style={[styles.todayLink, themed.actionText]}>Jump to today</Text></Pressable> : null}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="View next diary day" onPress={onNext} style={[styles.dateButton, themed.controlSurface]}>
        <Ionicons name="chevron-forward" size={20} color={palette.ink} />
      </Pressable>
    </View>
  );
}

function DiaryMealCard({ meal }: { meal: MealRead }) {
  const { palette } = useTheme();
  const themed = diaryThemeStyles(palette);
  const totals = mealTotals(meal);
  const allConfirmed = meal.items.every((item) => item.userConfirmed);
  const firstProvider = meal.items[0]?.sourceProvider;

  return (
    <Link href={`/meal/${meal.id}`} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${readableFoodName(meal.name)} meal details`}
        accessibilityHint="Review saved portions, nutrition, and source records"
        style={({ pressed }) => [styles.mealCard, themed.card, pressed ? styles.mealCardPressed : undefined]}
      >
        <View style={styles.mealTop}>
          <View style={[styles.mealIcon, mealTypeColor(meal.mealType, palette.mode)]}>
            <Ionicons name={mealTypeIcon(meal.mealType)} size={19} color={mealTypeIconColor(meal.mealType)} />
          </View>
          <View style={styles.mealCopy}>
            <Text numberOfLines={2} style={[styles.mealName, themed.ink]}>{readableFoodName(meal.name)}</Text>
            <Text style={[styles.mealMeta, themed.muted]}>{formatMealTime(meal.loggedAt)} · {meal.items.length} food{meal.items.length === 1 ? "" : "s"} · {Math.round(totals.calories)} kcal</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={palette.muted} />
        </View>
        <View accessibilityLabel={`${Math.round(totals.protein)} grams protein, ${Math.round(totals.carbs)} grams carbs, ${Math.round(totals.fat)} grams fat`} style={styles.macroSummary}>
          <Text style={[styles.macroSummaryText, themed.protein]}>P {Math.round(totals.protein)}g</Text>
          <Text style={[styles.macroSummaryText, themed.carbs]}>C {Math.round(totals.carbs)}g</Text>
          <Text style={[styles.macroSummaryText, themed.fat]}>F {Math.round(totals.fat)}g</Text>
        </View>
        <View style={styles.badgeRow}>
          {firstProvider ? <SourceBadge label={sourceLabel(firstProvider)} tone={allConfirmed ? "success" : "warning"} /> : null}
          <StatusPill label={allConfirmed ? "Confirmed" : "Needs review"} tone={allConfirmed ? "success" : "warning"} />
        </View>
      </Pressable>
    </Link>
  );
}

function DiaryLoadingSkeleton() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading daily diary" style={styles.loadingStack}>
      <Card tone="accent" style={styles.summaryCard}>
        <SkeletonBlock height={16} width="34%" />
        <SkeletonBlock height={54} width="54%" />
        <SkeletonBlock height={18} width="78%" />
        <View style={styles.macroRow}>
          <SkeletonBlock height={82} width="31%" />
          <SkeletonBlock height={82} width="31%" />
          <SkeletonBlock height={82} width="31%" />
        </View>
      </Card>
      {["diary-meal-skeleton-1", "diary-meal-skeleton-2"].map((key) => <Card key={key} style={styles.loadingMealCard}><SkeletonBlock height={22} width="68%" /><SkeletonBlock height={16} width="52%" /><SkeletonBlock height={30} width="48%" /></Card>)}
    </View>
  );
}

function groupMeals(meals: MealRead[]) {
  return mealTypeOrder
    .map((mealType) => ({ id: mealType, label: mealTypeLabel(mealType), meals: meals.filter((meal) => (meal.mealType ?? "meal") === mealType) }))
    .filter((group) => group.meals.length);
}

function mealTotals(meal: MealRead) {
  return meal.items.reduce((total, item) => ({ calories: total.calories + item.calories, protein: total.protein + item.proteinGrams, carbs: total.carbs + item.carbohydrateGrams, fat: total.fat + item.fatGrams }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

function mealTypeLabel(mealType: MealType) {
  return { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack", meal: "Other meals" }[mealType];
}

function mealTypeIcon(mealType: MealType | undefined): keyof typeof Ionicons.glyphMap {
  const icons: Record<MealType, keyof typeof Ionicons.glyphMap> = {
    breakfast: "sunny-outline",
    lunch: "leaf-outline",
    dinner: "moon-outline",
    snack: "cafe-outline",
    meal: "restaurant-outline",
  };

  return icons[mealType ?? "meal"];
}

function mealTypeIconColor(mealType: MealType | undefined) {
  return { breakfast: colors.carbs, lunch: colors.fiber, dinner: colors.protein, snack: colors.fat, meal: colors.insight }[mealType ?? "meal"];
}

function mealTypeColor(mealType: MealType | undefined, mode: ThemePalette["mode"]) {
  const light = { breakfast: colors.carbsSoft, lunch: colors.limeSoft, dinner: colors.proteinSoft, snack: colors.fatSoft, meal: colors.insightSoft }[mealType ?? "meal"];
  const dark = { breakfast: "rgba(129, 92, 26, 0.80)", lunch: "rgba(41, 91, 57, 0.82)", dinner: "rgba(67, 51, 101, 0.82)", snack: "rgba(107, 54, 68, 0.82)", meal: "rgba(48, 78, 113, 0.82)" }[mealType ?? "meal"];
  return { backgroundColor: mode === "dark" ? dark : light };
}

function normalizedDate(value: string | string[] | undefined, fallback: string) {
  const date = Array.isArray(value) ? value[0] : value;
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : fallback;
}

function currentDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + amount);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function formatDateLabel(date: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date(`${date}T12:00:00`));
}

function diaryThemeStyles(palette: ThemePalette) {
  return {
    ink: { color: palette.ink }, muted: { color: palette.muted }, actionText: { color: palette.actionText }, subsurface: { backgroundColor: palette.surfaceAlt }, controlSurface: { backgroundColor: palette.controlSurface }, card: { backgroundColor: palette.contentGlass, borderColor: palette.border }, protein: { color: palette.mode === "dark" ? "#CFB4FF" : colors.protein }, carbs: { color: palette.warningText }, fat: { color: palette.mode === "dark" ? "#F6A1B0" : colors.fat },
  };
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  headerCopy: { flex: 1, gap: spacing.xs },
  eyebrow: { ...typography.eyebrow }, title: { ...typography.display }, body: { ...typography.body },
  closeButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radii.pill },
  dateNavigator: { minHeight: 68, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, borderRadius: radii.lg, padding: spacing.sm },
  dateButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: radii.pill },
  dateCopy: { flex: 1, alignItems: "center", gap: 2 }, dateLabel: { ...typography.heading }, todayLink: { ...typography.caption, fontWeight: "700" },
  summaryCard: { gap: spacing.md }, summaryLabel: { ...typography.caption, fontWeight: "700" },
  calorieValue: { fontSize: 48, lineHeight: 54, fontWeight: "800", fontVariant: ["tabular-nums"] }, calorieUnit: { ...typography.heading }, summaryCopy: { ...typography.body }, macroRow: { flexDirection: "row", gap: spacing.sm },
  mealStack: { gap: spacing.xl }, mealGroup: { gap: spacing.sm }, mealCard: { gap: spacing.md, borderRadius: radii.lg, borderWidth: 1, padding: spacing.md }, mealCardPressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  mealTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm }, mealIcon: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: radii.md }, mealCopy: { flex: 1, gap: 2 }, mealName: { ...typography.heading }, mealMeta: { ...typography.caption },
  macroSummary: { flexDirection: "row", gap: spacing.sm }, macroSummaryText: { ...typography.caption, fontWeight: "800" }, badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  loadingStack: { gap: spacing.lg }, loadingMealCard: { gap: spacing.sm },
});
