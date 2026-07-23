import { useQuery } from "@tanstack/react-query";
import Svg, { Circle, Polyline, Text as SvgText } from "react-native-svg";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { colors, radii, spacing, typography, type ThemePalette } from "@living-nutrition/design-tokens";
import type { RangeInsights } from "@living-nutrition/shared-types";
import { api } from "../../services/api";
import {
  Card,
  ErrorState,
  GlassIconButton,
  InlineNotice,
  MacroStatTile,
  ScreenShell,
  SectionHeader,
  StatusPill,
} from "../../shared/components/LivingUI";
import { useTheme } from "../../shared/theme/ThemeProvider";

const fallbackCalorieGoal = 2200;
const chartWidth = 320;
const chartHeight = 190;
const chartPaddingX = 24;
const chartTopPadding = 18;
const chartBottomPadding = 32;

type ProgressRange = "7" | "30" | "90" | "custom";

const rangeOptions: Array<{ value: Exclude<ProgressRange, "custom">; label: string }> = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "3 months" },
];

type ProgressDay = {
  key: string;
  shortLabel: string;
  calorieTarget: number;
  calories: number;
  proteinGrams: number;
  fiberGrams: number;
  goalMet: boolean;
  hasLoggedMeals: boolean;
};

export function CalendarProgressScreen() {
  const { palette } = useTheme();
  const themed = progressThemeStyles(palette);
  const today = localTodayKey();
  const [selectedRange, setSelectedRange] = useState<ProgressRange>("7");
  const [customStartDate, setCustomStartDate] = useState(() => addDays(today, -6));
  const [customEndDate, setCustomEndDate] = useState(today);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);
  const rangeWindow = getRangeWindow(selectedRange, today, customStartDate, customEndDate);
  const rangeInsights = useQuery({
    queryKey: ["insights", "range", rangeWindow?.startDate, rangeWindow?.endDate],
    queryFn: () => api.getRangeInsights(rangeWindow?.startDate ?? "", rangeWindow?.endDate ?? ""),
    enabled: Boolean(rangeWindow),
    retry: 1,
  });
  const monthlyInsights = useQuery({
    queryKey: ["insights", "monthly", selectedMonth],
    queryFn: () => api.getMonthlyInsights(selectedMonth),
    retry: 1,
  });
  const preferences = useQuery({
    queryKey: ["preferences"],
    queryFn: () => api.getPreferences(),
    retry: 1,
  });
  const fallbackDays = buildDateRange(addDays(today, -6), today).map((day) => ({
    ...day,
    calories: 0,
    calorieTarget: fallbackCalorieGoal,
    proteinGrams: 0,
    fiberGrams: 0,
    goalMet: false,
    hasLoggedMeals: false,
  }));
  const calorieTarget = rangeInsights.data?.calorieTarget ?? fallbackCalorieGoal;
  const progressDays: ProgressDay[] = rangeInsights.data
    ? rangeInsights.data.days.map((day) => {
        const shortLabel = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(
          new Date(`${day.date}T12:00:00`)
        );
        return {
          key: day.date,
          shortLabel,
          calorieTarget: day.calorieTarget,
          calories: day.totals.calories,
          proteinGrams: day.totals.proteinGrams,
          fiberGrams: day.totals.fiberGrams,
          goalMet: day.goalMet,
          hasLoggedMeals: day.mealCount > 0,
        };
      })
    : fallbackDays;
  const goalMetCount = rangeInsights.data?.goalDays ?? 0;
  const averageCalories = rangeInsights.data?.averageCalories ?? 0;
  const averageFiber = rangeInsights.data?.averageFiberGrams ?? 0;
  const isLoading = rangeInsights.isLoading;
  const rangeDuration = rangeInsights.data?.durationDays ?? progressDays.length;
  const selectedDay = progressDays.at(-1);
  const loggedDays = rangeInsights.data?.loggedDays ?? progressDays.filter((day) => day.hasLoggedMeals).length;
  const averageProtein = rangeInsights.data?.averageProteinGrams ?? 0;
  const proteinLoggedDays = progressDays.filter((day) => day.hasLoggedMeals && day.proteinGrams > 0).length;
  const fiberLoggedDays = progressDays.filter((day) => day.hasLoggedMeals && day.fiberGrams > 0).length;
  const isCurrentMonth = selectedMonth === currentMonthKey();
  const weightInsight = buildWeightRangeInsight(
    rangeInsights.data?.weightComparison,
    preferences.data?.unitSystem ?? "metric"
  );

  return (
    <ScreenShell>
      <Card tone="insight" style={styles.progressHero}>
        <Text style={[styles.eyebrow, themed.muted]}>Progress</Text>
        <Text style={[styles.title, themed.ink]}>A calmer view of your rhythm.</Text>
        <Text style={[styles.body, themed.muted]}>
          Your story is based on saved meal snapshots and your daily target, not unconfirmed camera estimates.
        </Text>
        <View style={styles.rangeControls}>
          {rangeOptions.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityLabel={`Show ${option.label} of progress`}
              accessibilityState={{ selected: selectedRange === option.value }}
              onPress={() => setSelectedRange(option.value)}
              style={[styles.rangeChip, themed.rangeChip, selectedRange === option.value ? [styles.rangeChipSelected, themed.rangeChipSelected] : undefined]}
            >
              <Text style={[styles.rangeChipText, { color: selectedRange === option.value ? palette.onPrimary : palette.ink }]}>{option.label}</Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose a custom progress date range"
            accessibilityState={{ selected: selectedRange === "custom" }}
            onPress={() => setSelectedRange("custom")}
            style={[styles.rangeChip, themed.rangeChip, selectedRange === "custom" ? [styles.rangeChipSelected, themed.rangeChipSelected] : undefined]}
          >
            <Text style={[styles.rangeChipText, { color: selectedRange === "custom" ? palette.onPrimary : palette.ink }]}>Custom</Text>
          </Pressable>
        </View>
        {selectedRange === "custom" ? (
          <View style={styles.customRangeRow}>
            <TextInput
              accessibilityLabel="Custom range start date in year month day format"
              style={[styles.dateInput, themed.dateInput]}
              value={customStartDate}
              onChangeText={setCustomStartDate}
              placeholder="2026-07-01"
              placeholderTextColor={palette.muted}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
            />
            <Text style={[styles.rangeHint, themed.muted]}>to</Text>
            <TextInput
              accessibilityLabel="Custom range end date in year month day format"
              style={[styles.dateInput, themed.dateInput]}
              value={customEndDate}
              onChangeText={setCustomEndDate}
              placeholder="2026-07-31"
              placeholderTextColor={palette.muted}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
            />
          </View>
        ) : null}
        {!rangeWindow ? <InlineNotice title="Review custom range" body="Use valid YYYY-MM-DD dates, with an end date on or after the start and no more than 366 days apart." tone="warning" /> : null}
      </Card>

      {rangeInsights.error ? <ErrorState title="Progress could not load" body={rangeInsights.error.message} onRetry={() => void rangeInsights.refetch()} /> : null}

      <Card>
        <SectionHeader
          title="Calories vs goal"
          meta={isLoading ? "Loading..." : `${goalMetCount} goal days in ${rangeDuration}`}
        />
        <ProgressChart days={progressDays} selectedDayKey={selectedDay?.key} />
        <View style={styles.legendRow}>
          <LegendDot color={colors.green} label="Logged calories" />
          <LegendDot color={colors.lime} label="Goal line" />
          <LegendDot color={colors.coral} label="Above goal" />
        </View>
      </Card>

      <View style={styles.metricRow}>
        <MacroStatTile valueMaxFontSizeMultiplier={1.2} valueStyle={styles.metricValue} label="Goal days" value={goalMetCount} suffix={`/${rangeDuration}`} tone="success" />
        <MacroStatTile valueMaxFontSizeMultiplier={1.2} valueStyle={styles.metricValue} label="Avg kcal" value={formatAverageCalories(averageCalories)} tone="neutral" />
        <MacroStatTile valueMaxFontSizeMultiplier={1.2} valueStyle={styles.metricValue} label="Avg protein" value={averageProtein ? Math.round(averageProtein) : "-"} suffix={averageProtein ? "g" : undefined} tone="protein" />
      </View>

      <Card tone="soft" style={styles.insightCard}>
        <Text style={[styles.insightEyebrow, themed.insightText]}>Selected-period observation</Text>
        <Text style={[styles.insightTitle, themed.ink]}>{rangeInsightCopy(goalMetCount, progressDays.filter((day) => day.hasLoggedMeals).length, rangeDuration)}</Text>
        <Text style={[styles.body, themed.muted]}>This is a diary pattern, not medical advice. A missed day is simply a new place to start your rhythm.</Text>
      </Card>

      <Card tone="soft" style={styles.insightCard}>
        <View accessible accessibilityLabel={loggingRhythmAccessibilityLabel(loggedDays, proteinLoggedDays, fiberLoggedDays, rangeDuration)}>
          <Text style={[styles.insightEyebrow, themed.insightText]}>Logging rhythm</Text>
          <Text style={[styles.insightTitle, themed.ink]}>{loggingRhythmCopy(loggedDays, proteinLoggedDays, fiberLoggedDays, rangeDuration)}</Text>
          <View style={styles.metricRow}>
            <MacroStatTile valueMaxFontSizeMultiplier={1.2} valueStyle={styles.metricValue} label="Meal days" value={loggedDays} suffix={`/${rangeDuration}`} tone="neutral" />
            <MacroStatTile valueMaxFontSizeMultiplier={1.2} valueStyle={styles.metricValue} label="Protein days" value={proteinLoggedDays} tone="protein" />
            <MacroStatTile valueMaxFontSizeMultiplier={1.2} valueStyle={styles.metricValue} label="Fiber days" value={fiberLoggedDays} tone="success" />
          </View>
          <Text style={[styles.body, themed.muted]}>This reflects what was saved in your diary, not a nutrition grade or recommendation.</Text>
        </View>
      </Card>

      <Card tone="soft" style={styles.insightCard}>
        <Text style={[styles.insightEyebrow, themed.insightText]}>Weight rhythm</Text>
        <Text style={[styles.insightTitle, themed.ink]}>{weightInsight.title}</Text>
        <Text style={[styles.body, themed.muted]}>{weightInsight.body}</Text>
      </Card>

      <Card tone="soft" style={styles.focusCard}>
        <View style={styles.focusHeader}>
          <View style={styles.focusCopy}>
            <Text style={[styles.insightEyebrow, themed.insightText]}>Day focus</Text>
            <Text style={[styles.insightTitle, themed.ink]}>{selectedDay ? formatDayLabel(selectedDay.key) : "Choose a day"}</Text>
          </View>
          <StatusPill
            label={selectedDay?.goalMet ? "Goal met" : selectedDay?.hasLoggedMeals ? "Review" : "No log"}
            tone={selectedDay?.goalMet ? "success" : selectedDay?.hasLoggedMeals ? "warning" : "neutral"}
          />
        </View>
        <Text style={[styles.body, themed.muted]}>{dayFocusCopy(selectedDay)}</Text>
      </Card>

      <Card tone="soft" style={styles.insightCard}>
        <Text style={[styles.insightEyebrow, themed.insightText]}>Nutrition pattern</Text>
        <Text style={[styles.insightTitle, themed.ink]}>{averageFiber ? `${Math.round(averageFiber)}g average fiber on logged days` : "More logged meals will reveal a fiber pattern."}</Text>
        <Text style={[styles.body, themed.muted]}>Averages use logged days only, so empty diary days do not look like low intake.</Text>
      </Card>

      <Card>
        <View style={styles.monthHeader}>
          <View style={styles.monthTitleCopy}>
            <Text style={[styles.monthTitle, themed.ink]}>Monthly rhythm</Text>
            <Text style={[styles.monthMeta, themed.muted]}>{monthlyInsights.isLoading ? "Loading..." : formatMonthLabel(monthlyInsights.data?.month ?? selectedMonth)}</Text>
          </View>
          <View style={styles.monthControls}>
            <GlassIconButton icon="chevron-back" label="Show previous month" onPress={() => setSelectedMonth((month) => shiftMonth(month, -1))} />
            <GlassIconButton icon="chevron-forward" label="Show next month" onPress={() => setSelectedMonth((month) => shiftMonth(month, 1))} disabled={isCurrentMonth} />
          </View>
        </View>
        <Text style={[styles.body, themed.muted]}>
          A wider view of logged days and goal days for the calendar month. This is based on saved
          meal snapshots.
        </Text>
        <View testID="monthly-rhythm-metrics" style={[styles.metricRow, styles.monthMetricRow]}>
          <MacroStatTile
            valueMaxFontSizeMultiplier={1.2}
            valueStyle={styles.metricValue}
            label="Logged days"
            value={monthlyInsights.data?.loggedDays ?? "-"}
            tone="neutral"
          />
          <MacroStatTile
            valueMaxFontSizeMultiplier={1.2}
            valueStyle={styles.metricValue}
            label="Goal days"
            value={monthlyInsights.data?.goalDays ?? "-"}
            tone="success"
          />
          <MacroStatTile
            valueMaxFontSizeMultiplier={1.1}
            valueStyle={styles.monthlyCalorieMetricValue}
            label="Avg kcal"
            value={formatAverageCalories(monthlyInsights.data?.averageCalories)}
            tone="carbs"
          />
        </View>
        {monthlyInsights.data ? <MonthlyDotCalendar days={monthlyInsights.data.days} /> : null}
        {monthlyInsights.error ? <InlineNotice title="Monthly rhythm could not load" body={monthlyInsights.error.message} tone="warning" actions={[{ label: "Try again", onPress: () => void monthlyInsights.refetch(), variant: "secondary" }]} /> : null}
      </Card>
    </ScreenShell>
  );
}

function formatAverageCalories(value: number | undefined) {
  return value && Number.isFinite(value) ? Math.round(value) : "-";
}

function ProgressChart({
  days,
  selectedDayKey,
}: {
  days: ProgressDay[];
  selectedDayKey?: string;
}) {
  const { palette } = useTheme();
  const maxCalories = Math.max(
    ...days.map((day) => Math.max(day.calories, day.calorieTarget)),
    1
  ) * 1.15;
  const availableWidth = chartWidth - chartPaddingX * 2;
  const availableHeight = chartHeight - chartTopPadding - chartBottomPadding;
  const points = days.map((day, index) => {
    const x = chartPaddingX + (index * availableWidth) / Math.max(days.length - 1, 1);
    const y = yForCalories(day.calories, maxCalories, availableHeight);
    return { ...day, x, y };
  });
  const goalPoints = points.map((point) => ({
    ...point,
    y: yForCalories(point.calorieTarget, maxCalories, availableHeight),
  }));

  const labelStride = days.length <= 7 ? 1 : days.length <= 31 ? 5 : 14;

  return (
    <View accessible accessibilityLabel={`${days.length} day calorie line chart compared with saved calorie goal.`}>
      <Svg width="100%" height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
        <Polyline
          points={goalPoints.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke={colors.lime}
          strokeWidth={3}
          strokeDasharray="8 8"
        />
        <SvgText x={chartPaddingX} y={Math.max((goalPoints[0]?.y ?? 20) - 8, 12)} fill={palette.muted} fontSize="11">
          target
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
            r={point.key === selectedDayKey ? 8 : 6}
            fill={point.goalMet ? colors.green : point.calories > 0 ? colors.coral : palette.surfaceAlt}
            stroke={point.key === selectedDayKey ? palette.ink : palette.surface}
            strokeWidth={point.key === selectedDayKey ? 3 : 2}
          />
        ))}
        {points.filter((_, index) => index % labelStride === 0 || index === points.length - 1).map((point) => (
          <SvgText
            key={`${point.key}-label`}
            x={point.x}
            y={chartHeight - 8}
            fill={palette.muted}
            fontSize="10"
            textAnchor="middle"
          >
            {days.length <= 7 ? point.shortLabel.slice(0, 3) : point.key.slice(5)}
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
  const { palette } = useTheme();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={[styles.legendLabel, { color: palette.muted }]}>{label}</Text>
    </View>
  );
}

function MonthlyDotCalendar({
  days,
}: {
  days: Array<{ date: string; mealCount: number; goalMet: boolean }>;
}) {
  const { palette } = useTheme();
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
            : { backgroundColor: palette.surfaceAlt };

        return (
          <View key={day.date} style={styles.monthDay}>
            <View style={[styles.monthDot, toneStyle]} />
            <Text style={[styles.monthDayLabel, { color: palette.muted }]}>{dayOfMonth}</Text>
          </View>
        );
      })}
    </View>
  );
}

function progressThemeStyles(palette: ThemePalette) {
  return {
    ink: { color: palette.ink },
    muted: { color: palette.muted },
    insightText: { color: palette.mode === "dark" ? "#A9C7F0" : colors.insight },
    rangeChip: { backgroundColor: palette.controlSurface, borderColor: palette.border },
    rangeChipSelected: { backgroundColor: colors.insight, borderColor: palette.highlight },
    dateInput: { backgroundColor: palette.controlSurface, borderColor: palette.border, color: palette.ink },
  };
}

function getRangeWindow(
  range: ProgressRange,
  today: string,
  customStartDate: string,
  customEndDate: string
) {
  if (range === "custom") {
    return validRangeWindow(customStartDate, customEndDate);
  }

  const duration = Number(range);
  return {
    startDate: addDays(today, -(duration - 1)),
    endDate: today,
  };
}

function validRangeWindow(startDate: string, endDate: string) {
  if (!isValidDateKey(startDate) || !isValidDateKey(endDate)) {
    return undefined;
  }

  const duration = differenceInDays(startDate, endDate) + 1;
  if (duration <= 0 || duration > 366) {
    return undefined;
  }

  return { startDate, endDate };
}

function buildDateRange(startDate: string, endDate: string) {
  const duration = differenceInDays(startDate, endDate) + 1;
  if (duration <= 0) {
    return [];
  }

  return Array.from({ length: duration }, (_, index) => {
    const key = addDays(startDate, index);
    return {
      key,
      shortLabel: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(
        new Date(`${key}T12:00:00`)
      ),
    };
  });
}

function localTodayKey() {
  return formatLocalDate(new Date());
}

function addDays(dateKey: string, amount: number) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return formatLocalDate(date);
}

function formatLocalDate(date: Date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function differenceInDays(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

function isValidDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function formatMonthLabel(month: string) {
  const date = new Date(`${month}-01T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return month;
  }

  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date);
}

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

function shiftMonth(month: string, amount: number) {
  const date = new Date(`${month}-01T12:00:00`);
  date.setMonth(date.getMonth() + amount);
  return date.toISOString().slice(0, 7);
}

function formatDayLabel(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return dateKey;
  }

  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(date);
}

function dayFocusCopy(day: ProgressDay | undefined) {
  if (!day || !day.hasLoggedMeals) {
    return "No meal snapshot is available for this day yet. Logging even one meal can make the next weekly view more useful.";
  }

  const calories = Math.round(day.calories);
  const protein = Math.round(day.proteinGrams);
  const calorieTarget = Math.round(day.calorieTarget);
  const difference = Math.abs(calories - calorieTarget);

  if (day.goalMet) {
    return `${calories} kcal and ${protein}g protein were logged. This day aligned with your saved calorie target.`;
  }

  return `${calories} kcal and ${protein}g protein were logged. That is ${difference} kcal ${calories > calorieTarget ? "above" : "below"} your saved target; this is a diary observation, not a judgment.`;
}

function rangeInsightCopy(goalDays: number, loggedDays: number, rangeDuration: number) {
  if (!loggedDays) return "Log a meal whenever you are ready to begin your nutrition picture.";
  if (goalDays) return `You reached your calorie target on ${goalDays} of ${rangeDuration} selected days.`;
  return `${loggedDays} logged day${loggedDays === 1 ? "" : "s"} is a useful starting point for your next rhythm.`;
}

function loggingRhythmCopy(loggedDays: number, proteinLoggedDays: number, fiberLoggedDays: number, rangeDuration: number) {
  if (!loggedDays) {
    return "Log a meal whenever it is useful. Your first saved snapshot will start a new rhythm here.";
  }

  return `Meals were logged on ${loggedDays} of ${rangeDuration} selected days; protein appeared on ${proteinLoggedDays} and fiber appeared on ${fiberLoggedDays} of those days.`;
}

function loggingRhythmAccessibilityLabel(loggedDays: number, proteinLoggedDays: number, fiberLoggedDays: number, rangeDuration: number) {
  return `Logging rhythm. Meals were logged on ${loggedDays} of ${rangeDuration} selected days. Protein was recorded on ${proteinLoggedDays} days. Fiber was recorded on ${fiberLoggedDays} days. This is a diary pattern, not a nutrition grade.`;
}

function buildWeightRangeInsight(
  comparison: RangeInsights["weightComparison"] | undefined,
  unitSystem: "us" | "metric"
) {
  if (!comparison) {
    return {
      title: "Weight pattern is loading.",
      body: "Weight is optional. This selected-period comparison will show the check-ins and goal context it used.",
    };
  }

  if (comparison.status === "insufficient_data") {
    const checkInCopy = comparison.entryCount === 1 ? "one check-in" : "fewer than two check-ins";
    return {
      title: "More check-ins are needed for a comparison.",
      body: `This period has ${checkInCopy}. Add at least two check-ins; three spanning seven days give a more useful descriptive pattern. ${goalContextCopy(comparison)}`,
    };
  }

  const divisor = unitSystem === "us" ? 453.59237 : 1000;
  const unit = unitSystem === "us" ? "lb" : "kg";
  const magnitude = Math.round((Math.abs(comparison.changeGrams ?? 0) / divisor) * 10) / 10;
  const title =
    comparison.trend === "steady"
      ? `No clear weight change across ${comparison.entryCount} check-ins.`
      : `Weight is ${comparison.trend} ${magnitude} ${unit} across ${comparison.entryCount} check-ins.`;
  const periodCopy = comparison.firstLoggedOn && comparison.lastLoggedOn
    ? `from ${formatInsightDate(comparison.firstLoggedOn)} to ${formatInsightDate(comparison.lastLoggedOn)} (${comparison.observationDays} days)`
    : "in the selected period";
  const certaintyCopy = comparison.status === "limited"
    ? "This is still a limited comparison because it needs at least three check-ins spanning seven days."
    : "This is a descriptive pattern, not a prediction or medical recommendation.";

  return {
    title,
    body: `This uses ${comparison.entryCount} saved check-ins ${periodCopy}. ${goalContextCopy(comparison)} ${certaintyCopy}`,
  };
}

function goalContextCopy(comparison: RangeInsights["weightComparison"]) {
  const revisionCopy = comparison.goalRevisionCount === 1
    ? "One effective nutrition-goal revision was present."
    : `${comparison.goalRevisionCount} effective nutrition-goal revisions were present.`;

  if (comparison.goalDirectionContext === "unavailable") {
    return `${revisionCopy} Goal direction was not stored for this historical period.`;
  }

  if (comparison.goalDirectionContext === "changed") {
    return `${revisionCopy} Goal direction changed during this period (${comparison.goalDirections.join(" to ")}).`;
  }

  return `${revisionCopy} Goal direction was ${comparison.goalDirections[0]} throughout this period.`;
}

function formatInsightDate(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? dateKey
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.xs,
  },
  progressHero: { borderRadius: radii.hero },
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
  rangeControls: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.xs, paddingTop: spacing.xs },
  rangeChip: { minHeight: 44, justifyContent: "center", borderRadius: radii.pill, paddingHorizontal: spacing.sm, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth },
  rangeChipSelected: { backgroundColor: colors.insight },
  rangeChipText: { ...typography.caption, color: colors.ink },
  rangeChipTextSelected: { color: colors.white },
  customRangeRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  dateInput: { width: 124, minHeight: 44, borderRadius: radii.md, paddingHorizontal: spacing.sm, backgroundColor: colors.background, color: colors.ink, textAlign: "center", borderWidth: StyleSheet.hairlineWidth },
  rangeHint: { ...typography.caption, flex: 1, color: colors.muted },
  insightCard: { gap: spacing.xs },
  focusCard: { gap: spacing.sm },
  focusHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.sm },
  focusCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  insightEyebrow: { ...typography.eyebrow, color: colors.insight },
  insightTitle: { ...typography.heading, color: colors.ink },
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
    gap: spacing.md,
  },
  metricValue: {
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: -0.4,
  },
  monthlyCalorieMetricValue: {
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: -0.2,
  },
  monthMetricRow: {
    marginBottom: spacing.md,
  },
  monthHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  monthTitleCopy: { flex: 1, minWidth: 0, gap: 2 },
  monthTitle: { ...typography.heading, color: colors.ink },
  monthMeta: { ...typography.caption, color: colors.muted },
  monthControls: { flexDirection: "row", gap: spacing.xs },
  monthGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: spacing.md,
    rowGap: spacing.sm,
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
