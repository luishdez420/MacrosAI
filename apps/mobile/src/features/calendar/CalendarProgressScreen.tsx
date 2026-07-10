import { useQuery } from "@tanstack/react-query";
import Svg, { Circle, Line, Polyline, Text as SvgText } from "react-native-svg";
import { StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing, typography } from "@living-nutrition/design-tokens";
import { api } from "../../services/api";
import {
  Card,
  InlineNotice,
  MacroStatTile,
  ScreenShell,
  SectionHeader,
  StatusPill,
} from "../../shared/components/LivingUI";

const fallbackCalorieGoal = 2200;
const chartWidth = 320;
const chartHeight = 190;
const chartPaddingX = 24;
const chartTopPadding = 18;
const chartBottomPadding = 32;

export function CalendarProgressScreen() {
  const weekStartDate = lastSevenDays()[0].key;
  const currentMonth = new Date().toISOString().slice(0, 7);
  const weeklyInsights = useQuery({
    queryKey: ["insights", "weekly", weekStartDate],
    queryFn: () => api.getWeeklyInsights(weekStartDate),
    retry: 1,
  });
  const monthlyInsights = useQuery({
    queryKey: ["insights", "monthly", currentMonth],
    queryFn: () => api.getMonthlyInsights(currentMonth),
    retry: 1,
  });
  const fallbackDays = lastSevenDays().map((day) => ({
    ...day,
    calories: 0,
    proteinGrams: 0,
    goalMet: false,
    hasLoggedMeals: false,
  }));
  const calorieTarget = weeklyInsights.data?.calorieTarget ?? fallbackCalorieGoal;
  const progressDays = weeklyInsights.data
    ? weeklyInsights.data.days.map((day) => {
        const shortLabel = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(
          new Date(`${day.date}T12:00:00`)
        );
        return {
          key: day.date,
          shortLabel,
          calories: day.totals.calories,
          proteinGrams: day.totals.proteinGrams,
          goalMet: day.goalMet,
          hasLoggedMeals: day.mealCount > 0,
        };
      })
    : fallbackDays;
  const goalMetCount = weeklyInsights.data?.goalDays ?? 0;
  const averageCalories = weeklyInsights.data?.averageCalories ?? 0;
  const isLoading = weeklyInsights.isLoading;
  const firstError = weeklyInsights.error ?? monthlyInsights.error;

  return (
    <ScreenShell>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Progress</Text>
        <Text style={styles.title}>Your week at a glance.</Text>
        <Text style={styles.body}>
          See how your saved meals line up with your calorie goal. This is based on logged diary
          snapshots, not camera guesses.
        </Text>
      </View>

      {firstError ? (
        <InlineNotice
          title="Progress could not fully load"
          body={firstError.message}
          tone="warning"
        />
      ) : null}

      <Card>
        <SectionHeader
          title="Calories vs goal"
          meta={isLoading ? "Loading..." : `${goalMetCount} goal days`}
        />
        <ProgressChart days={progressDays} calorieTarget={calorieTarget} />
        <View style={styles.legendRow}>
          <LegendDot color={colors.green} label="Logged calories" />
          <LegendDot color={colors.lime} label="Goal line" />
          <LegendDot color={colors.coral} label="Above goal" />
        </View>
      </Card>

      <View style={styles.metricRow}>
        <MacroStatTile label="Goal days" value={goalMetCount} suffix="/7" tone="success" />
        <MacroStatTile label="Avg kcal" value={averageCalories || "-"} tone="neutral" />
        <MacroStatTile label="Target" value={Math.round(calorieTarget)} suffix="kcal" tone="carbs" />
      </View>

      <Card>
        <SectionHeader title="Daily check-ins" meta="Last 7 days" />
        <View style={styles.dayList}>
          {progressDays.map((day) => (
            <View key={day.key} style={styles.dayRow}>
              <View style={styles.dayCopy}>
                <Text style={styles.dayLabel}>{day.shortLabel}</Text>
                <Text style={styles.dayMeta}>
                  {day.hasLoggedMeals
                    ? `${Math.round(day.calories)} kcal - ${Math.round(day.proteinGrams)}g protein`
                    : "No meals logged"}
                </Text>
              </View>
              <StatusPill
                label={day.goalMet ? "Goal met" : day.hasLoggedMeals ? "Review" : "No log"}
                tone={day.goalMet ? "success" : day.hasLoggedMeals ? "warning" : "neutral"}
              />
            </View>
          ))}
        </View>
      </Card>

      <Card>
        <SectionHeader
          title="Monthly rhythm"
          meta={monthlyInsights.isLoading ? "Loading..." : formatMonthLabel(monthlyInsights.data?.month ?? currentMonth)}
        />
        <Text style={styles.body}>
          A wider view of logged days and goal days for the calendar month. This is based on saved
          meal snapshots.
        </Text>
        <View style={styles.metricRow}>
          <MacroStatTile
            label="Logged"
            value={monthlyInsights.data?.loggedDays ?? "-"}
            suffix={monthlyInsights.data ? "days" : undefined}
            tone="neutral"
          />
          <MacroStatTile
            label="Goal days"
            value={monthlyInsights.data?.goalDays ?? "-"}
            suffix={monthlyInsights.data ? "days" : undefined}
            tone="success"
          />
          <MacroStatTile
            label="Avg kcal"
            value={monthlyInsights.data?.averageCalories || "-"}
            tone="carbs"
          />
        </View>
        {monthlyInsights.data ? <MonthlyDotCalendar days={monthlyInsights.data.days} /> : null}
      </Card>
    </ScreenShell>
  );
}

function ProgressChart({
  days,
  calorieTarget,
}: {
  days: Array<{ key: string; calories: number; goalMet: boolean; shortLabel: string }>;
  calorieTarget: number;
}) {
  const maxCalories = Math.max(calorieTarget, ...days.map((day) => day.calories), 1) * 1.15;
  const availableWidth = chartWidth - chartPaddingX * 2;
  const availableHeight = chartHeight - chartTopPadding - chartBottomPadding;
  const goalY = yForCalories(calorieTarget, maxCalories, availableHeight);
  const points = days.map((day, index) => {
    const x = chartPaddingX + (index * availableWidth) / Math.max(days.length - 1, 1);
    const y = yForCalories(day.calories, maxCalories, availableHeight);
    return { ...day, x, y };
  });

  return (
    <View accessible accessibilityLabel="Seven day calorie line chart compared with saved calorie goal.">
      <Svg width="100%" height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
        <Line
          x1={chartPaddingX}
          y1={goalY}
          x2={chartWidth - chartPaddingX}
          y2={goalY}
          stroke={colors.lime}
          strokeWidth={3}
          strokeDasharray="8 8"
        />
        <SvgText x={chartPaddingX} y={Math.max(goalY - 8, 12)} fill={colors.muted} fontSize="11">
          goal
        </SvgText>
        <Polyline
          points={points.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke={colors.green}
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.map((point) => (
          <Circle
            key={point.key}
            cx={point.x}
            cy={point.y}
            r={6}
            fill={point.goalMet ? colors.green : point.calories > 0 ? colors.coral : colors.surfaceAlt}
            stroke={colors.white}
            strokeWidth={2}
          />
        ))}
        {points.map((point) => (
          <SvgText
            key={`${point.key}-label`}
            x={point.x}
            y={chartHeight - 8}
            fill={colors.muted}
            fontSize="10"
            textAnchor="middle"
          >
            {point.shortLabel.slice(0, 3)}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

function yForCalories(calories: number, maxCalories: number, availableHeight: number) {
  const normalized = Math.min(Math.max(calories / maxCalories, 0), 1);
  return chartTopPadding + (1 - normalized) * availableHeight;
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

function MonthlyDotCalendar({
  days,
}: {
  days: Array<{ date: string; mealCount: number; goalMet: boolean }>;
}) {
  return (
    <View
      style={styles.monthGrid}
      accessible
      accessibilityLabel="Monthly calendar dots. Green days met the calorie goal, coral days were logged above goal, and muted days have no logged meals."
    >
      {days.map((day) => {
        const date = new Date(`${day.date}T12:00:00`);
        const dayOfMonth = Number.isNaN(date.getTime()) ? day.date.slice(-2) : String(date.getDate());
        const toneStyle = day.goalMet
          ? styles.monthDotGoal
          : day.mealCount > 0
            ? styles.monthDotReview
            : styles.monthDotEmpty;

        return (
          <View key={day.date} style={styles.monthDay}>
            <View style={[styles.monthDot, toneStyle]} />
            <Text style={styles.monthDayLabel}>{dayOfMonth}</Text>
          </View>
        );
      })}
    </View>
  );
}

function lastSevenDays() {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const key = date.toISOString().slice(0, 10);
    return {
      key,
      shortLabel: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date),
    };
  });
}

function formatMonthLabel(month: string) {
  const date = new Date(`${month}-01T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return month;
  }

  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date);
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
  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: radii.pill,
  },
  legendLabel: {
    ...typography.caption,
    color: colors.muted,
  },
  metricRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  dayList: {
    gap: spacing.sm,
  },
  dayRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderRadius: radii.md,
    padding: spacing.md,
    backgroundColor: colors.background,
  },
  dayCopy: {
    flex: 1,
    gap: 2,
  },
  dayLabel: {
    ...typography.heading,
    color: colors.ink,
  },
  dayMeta: {
    ...typography.caption,
    color: colors.muted,
  },
  monthGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  monthDay: {
    width: 34,
    alignItems: "center",
    gap: 4,
  },
  monthDot: {
    width: 14,
    height: 14,
    borderRadius: radii.pill,
  },
  monthDotGoal: {
    backgroundColor: colors.green,
  },
  monthDotReview: {
    backgroundColor: colors.coral,
  },
  monthDotEmpty: {
    backgroundColor: colors.surfaceAlt,
  },
  monthDayLabel: {
    ...typography.caption,
    color: colors.muted,
  },
});
