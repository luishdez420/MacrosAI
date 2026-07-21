import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { DiaryDay, NutritionGoal } from "@living-nutrition/shared-types";
import { colors, radii, spacing, typography } from "@living-nutrition/design-tokens";
import { api } from "../../services/api";
import {
  Card,
  EmptyState,
  ErrorState,
  GlassIconButton,
  InlineNotice,
  ScreenShell,
  SectionHeader,
  SkeletonBlock,
  SourceBadge,
  sourceLabel,
} from "../../shared/components/LivingUI";
import { useTheme } from "../../shared/theme/ThemeProvider";
import {
  buildMealContributions,
  buildNutrientDetailRows,
  formatNutrientAmount,
  formatNutrientTarget,
  getNutrientDetailDate,
  nutrientProgress,
  type NutrientDetailRow,
} from "./nutritionDetailPresentation";

export function NutrientDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ date?: string | string[] }>();
  const date = getNutrientDetailDate(params.date);
  const { palette } = useTheme();
  const diary = useQuery<DiaryDay>({
    queryKey: ["diary", date],
    queryFn: () => api.getDiary(date),
    retry: 1,
    retryDelay: 300,
  });
  const goal = useQuery<NutritionGoal | null>({
    queryKey: ["goal"],
    queryFn: () => api.getGoal(),
    retry: 1,
    retryDelay: 300,
  });

  const isLoading = diary.isLoading && !diary.data;
  const hasLoadError = Boolean(diary.error && !diary.data);
  const rows = diary.data ? buildNutrientDetailRows(diary.data.totals, goal.data) : [];
  const contributions = diary.data ? buildMealContributions(diary.data.meals) : [];

  return (
    <ScreenShell>
      <View style={styles.header}>
        <GlassIconButton icon="chevron-back" label="Return to Today" onPress={() => router.back()} />
        <View style={styles.headerCopy}>
          <Text style={[styles.eyebrow, { color: palette.muted }]}>Nutrition detail</Text>
          <Text style={[styles.title, { color: palette.ink }]}>{formatDate(date)}</Text>
        </View>
      </View>

      {isLoading ? <NutrientDetailSkeleton /> : null}
      {hasLoadError ? (
        <ErrorState
          title="Nutrition detail is unavailable"
          body="We couldn't load this day's saved meal snapshots. Check your connection, then try again."
          onRetry={() => void diary.refetch()}
        />
      ) : null}

      {diary.data ? (
        <>
          <Card tone="accent" style={styles.hero}>
            <Text style={[styles.eyebrow, { color: palette.actionText }]}>Saved daily total</Text>
            <Text style={[styles.calorieValue, { color: palette.ink }]}>
              {Math.round(diary.data.totals.calories)}
              <Text style={[styles.calorieUnit, { color: palette.muted }]}> kcal</Text>
            </Text>
            <Text style={[styles.body, { color: palette.muted }]}>
              Based on the portions and nutrition sources saved with your meals. Camera-assisted foods remain estimates unless you confirmed them.
            </Text>
            <View style={[styles.heroMeta, { backgroundColor: palette.controlSurface, borderColor: palette.border }]}>
              <Ionicons name="layers-outline" size={16} color={palette.actionText} />
              <Text style={[styles.heroMetaText, { color: palette.ink }]}>
                {diary.data.meals.length} meal{diary.data.meals.length === 1 ? "" : "s"} logged
              </Text>
            </View>
          </Card>

          {diary.error ? (
            <InlineNotice
              title="Showing your last loaded nutrition detail"
              body="These saved snapshots are still available, but we couldn't refresh them just now."
              tone="warning"
              actions={[{ label: "Try again", onPress: () => void diary.refetch(), variant: "secondary" }]}
            />
          ) : null}

          <Card>
            <SectionHeader title="Daily nutrients" meta="Saved portions" />
            <View style={styles.rowStack}>
              {rows.slice(0, 4).map((row) => <NutrientProgressRow key={row.key} row={row} />)}
            </View>
          </Card>

          <Card tone="soft">
            <SectionHeader title="Other recorded nutrients" meta="No inferred targets" />
            <View style={styles.rowStack}>
              {rows.slice(4).map((row) => <NutrientProgressRow key={row.key} row={row} />)}
            </View>
            <Text style={[styles.caption, { color: palette.muted }]}>
              Fiber and sodium only compare with a target when you have set one. Sugar is displayed from available food records without a target or judgment.
            </Text>
          </Card>

          <Card tone="insight">
            <Text style={[styles.insightEyebrow, { color: colors.insight }]}>How to read this</Text>
            <Text style={[styles.insightTitle, { color: palette.ink }]}>Useful context, not a score.</Text>
            <Text style={[styles.body, { color: palette.muted }]}>
              Your targets are adjustable planning tools. This screen does not diagnose nutrition, infer medical needs, or turn an unlogged meal into a zero.
            </Text>
          </Card>

          <View style={styles.contributionHeader}>
            <SectionHeader title="Meal contributions" meta={`${contributions.length} saved`} />
          </View>
          {contributions.length ? (
            contributions.map((meal) => (
              <Link key={meal.id} href={`/meal/${meal.id}`} asChild>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`View ${meal.name}, ${Math.round(meal.calories)} calories, ${Math.round(meal.proteinGrams)} grams protein`}
                  accessibilityHint="Open this meal to review its saved portions and nutrition sources"
                  style={({ pressed }) => [styles.mealPressable, pressed ? styles.pressed : undefined]}
                >
                  <Card style={styles.mealCard}>
                    <View style={styles.mealTopRow}>
                      <View style={styles.mealTitleWrap}>
                        <Text numberOfLines={2} style={[styles.mealTitle, { color: palette.ink }]}>{meal.name}</Text>
                        <Text style={[styles.mealMeta, { color: palette.muted }]}>
                          {meal.itemCount} food{meal.itemCount === 1 ? "" : "s"} · {Math.round(meal.calories)} kcal
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={palette.muted} />
                    </View>
                    <View
                      accessible
                      accessibilityLabel={`${Math.round(meal.proteinGrams)} grams protein, ${Math.round(meal.carbohydrateGrams)} grams carbohydrates, ${Math.round(meal.fatGrams)} grams fat`}
                      style={styles.macroRow}
                    >
                      <Text style={[styles.macroValue, { color: colors.protein }]}>P {Math.round(meal.proteinGrams)}g</Text>
                      <Text style={[styles.macroValue, { color: colors.carbs }]}>C {Math.round(meal.carbohydrateGrams)}g</Text>
                      <Text style={[styles.macroValue, { color: colors.fat }]}>F {Math.round(meal.fatGrams)}g</Text>
                    </View>
                    <View style={styles.sourceRow}>
                      {meal.sourceProviders.slice(0, 2).map((provider) => (
                        <SourceBadge key={provider} label={sourceLabel(provider)} tone="success" />
                      ))}
                      {meal.sourceProviders.length > 2 ? <SourceBadge label={`+${meal.sourceProviders.length - 2} sources`} /> : null}
                    </View>
                  </Card>
                </Pressable>
              </Link>
            ))
          ) : (
            <EmptyState
              title="No saved meals for this day"
              body="Add a meal to see its calories, macros, and available micronutrients here."
              actionLabel="Search food"
              onAction={() => router.push("/manual-search")}
              icon="nutrition-outline"
            />
          )}
        </>
      ) : null}
    </ScreenShell>
  );
}

function NutrientProgressRow({ row }: { row: NutrientDetailRow }) {
  const { palette } = useTheme();
  const progress = nutrientProgress(row.value, row.target);
  const color = toneColor(row.tone, palette);
  const amount = formatNutrientAmount(row.value, row.unit);
  const target = formatNutrientTarget(row);

  return (
    <View accessible accessibilityLabel={`${row.label}: ${amount}. ${target}.`} style={styles.nutrientRow}>
      <View style={styles.nutrientTopRow}>
        <Text style={[styles.nutrientLabel, { color: palette.ink }]}>{row.label}</Text>
        <Text style={[styles.nutrientAmount, { color: palette.ink }]}>{amount}</Text>
      </View>
      <View style={styles.nutrientBottomRow}>
        <Text style={[styles.nutrientTarget, { color: palette.muted }]}>{target}</Text>
        {progress !== undefined ? <Text style={[styles.nutrientPercent, { color }]}>{Math.round((row.value / (row.target || 1)) * 100)}%</Text> : null}
      </View>
      {progress !== undefined ? (
        <View style={[styles.progressTrack, { backgroundColor: palette.progressTrack }]}>
          <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: color }]} />
        </View>
      ) : null}
    </View>
  );
}

function NutrientDetailSkeleton() {
  return (
    <>
      <Card tone="accent" style={styles.hero}>
        <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading nutrition detail">
          <SkeletonBlock height={14} width="32%" />
          <View style={styles.skeletonGap} />
          <SkeletonBlock height={48} width="46%" />
          <View style={styles.skeletonGap} />
          <SkeletonBlock height={18} width="90%" />
        </View>
      </Card>
      <Card>
        <SkeletonBlock height={20} width="42%" />
        <SkeletonBlock height={72} />
        <SkeletonBlock height={72} />
        <SkeletonBlock height={72} />
      </Card>
    </>
  );
}

function toneColor(tone: NutrientDetailRow["tone"], palette: ReturnType<typeof useTheme>["palette"]) {
  return {
    neutral: palette.actionText,
    protein: colors.protein,
    carbs: colors.carbs,
    fat: colors.fat,
    fiber: colors.fiber,
    insight: colors.insight,
  }[tone];
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(
    new Date(`${date}T12:00:00`)
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  headerCopy: { flex: 1, gap: spacing.xxs },
  eyebrow: { ...typography.eyebrow },
  title: { ...typography.heading },
  hero: { gap: spacing.md },
  calorieValue: { ...typography.displayLarge, fontVariant: ["tabular-nums"] },
  calorieUnit: { ...typography.heading },
  body: { ...typography.body },
  heroMeta: { alignSelf: "flex-start", minHeight: 36, flexDirection: "row", alignItems: "center", gap: spacing.xs, borderRadius: radii.pill, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.sm },
  heroMetaText: { ...typography.caption },
  rowStack: { gap: spacing.md },
  nutrientRow: { gap: spacing.xs },
  nutrientTopRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.md },
  nutrientBottomRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  nutrientLabel: { ...typography.heading },
  nutrientAmount: { ...typography.button, fontVariant: ["tabular-nums"] },
  nutrientTarget: { ...typography.caption, flex: 1 },
  nutrientPercent: { ...typography.caption, fontVariant: ["tabular-nums"] },
  progressTrack: { height: 8, overflow: "hidden", borderRadius: radii.pill },
  progressFill: { height: "100%", minWidth: 3, borderRadius: radii.pill },
  caption: { ...typography.caption },
  insightEyebrow: { ...typography.eyebrow },
  insightTitle: { ...typography.heading },
  contributionHeader: { marginTop: spacing.xs },
  mealPressable: { borderRadius: radii.lg },
  pressed: { transform: [{ scale: 0.985 }], opacity: 0.92 },
  mealCard: { gap: spacing.sm },
  mealTopRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  mealTitleWrap: { flex: 1, gap: spacing.xxs },
  mealTitle: { ...typography.heading },
  mealMeta: { ...typography.caption },
  macroRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  macroValue: { ...typography.caption, fontVariant: ["tabular-nums"] },
  sourceRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  skeletonGap: { height: spacing.sm },
});
