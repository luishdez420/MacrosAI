import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import Svg, { Circle, Line, Polyline, Text as SvgText } from "react-native-svg";

import { colors, radii, spacing, typography } from "@living-nutrition/design-tokens";
import type {
  AuthSessionSummary,
  FoodCorrectionReportSummary,
  NutritionGoalUpdate,
  WeightEntry,
  WeightEntryCreate,
} from "@living-nutrition/shared-types";
import { api, clearStoredSession, signOutStoredSession, storeSession } from "../../services/api";
import {
  ActionButton,
  Card,
  InlineNotice,
  MacroStatTile,
  ScreenShell,
  SectionHeader,
  StatusPill,
} from "../../shared/components/LivingUI";
import { foodDetailHref } from "../food-detail/foodDetailLinks";
import {
  calculateNutritionRecommendation,
  type GoalDirection,
} from "./goalRecommendation";
import {
  buildWeightTrendSummary,
  buildWeightGoalInsight,
  buildUserDataExportSummary,
  correctionReportSourceSummary,
  correctionReportTypeLabel,
  convertProfileMeasurementInputs,
  formatWeight,
  normalizeRetentionDaysInput,
  retentionPreferenceSummary,
  sortWeightEntriesAscending,
  weightInputValue,
  weightDisplayValue,
  type MeasurementSystem,
} from "./profilePresentation";

const directionOptions: Array<{ label: string; value: GoalDirection }> = [
  { label: "Maintain", value: "maintain" },
  { label: "Cut", value: "cut" },
  { label: "Gain", value: "gain" },
];

export function ProfileScreen() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("you@example.com");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("Living Nutrition User");
  const [measurementSystem, setMeasurementSystem] = useState<MeasurementSystem>("us");
  const [heightFeet, setHeightFeet] = useState("5");
  const [heightInches, setHeightInches] = useState("9");
  const [weightLb, setWeightLb] = useState("176");
  const [heightCm, setHeightCm] = useState("175");
  const [weightKg, setWeightKg] = useState("80");
  const [bodyFatPercent, setBodyFatPercent] = useState("20");
  const [weightNote, setWeightNote] = useState("");
  const [editingWeightEntry, setEditingWeightEntry] = useState<WeightEntry | null>(null);
  const [imageRetentionDays, setImageRetentionDays] = useState("30");
  const [preferenceNotice, setPreferenceNotice] = useState<string | null>(null);
  const [retentionNotice, setRetentionNotice] = useState<string | null>(null);
  const [direction, setDirection] = useState<GoalDirection>("maintain");
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api.getSession(),
    retry: 1,
  });
  const goal = useQuery({
    queryKey: ["goal"],
    queryFn: () => api.getGoal(),
    retry: 1,
  });
  const preferences = useQuery({
    queryKey: ["preferences"],
    queryFn: () => api.getPreferences(),
    retry: 1,
  });
  const weightEntries = useQuery({
    queryKey: ["weight"],
    queryFn: () => api.listWeightEntries(8),
    retry: 1,
  });
  const correctionReports = useQuery({
    queryKey: ["correction-reports"],
    queryFn: () => api.getCorrectionReports(5),
    retry: 1,
  });
  const authSessions = useQuery({
    queryKey: ["auth-sessions"],
    queryFn: () => api.listAuthSessions(),
    enabled: session.data?.authScheme === "jwt",
    retry: 1,
  });
  const normalizedStats = normalizeBodyStats({
    measurementSystem,
    heightCm,
    weightKg,
    heightFeet,
    heightInches,
    weightLb,
  });
  const recommendation = calculateNutritionRecommendation({
    heightCm: normalizedStats.heightCm,
    weightKg: normalizedStats.weightKg,
    bodyFatPercent: parseNumber(bodyFatPercent),
    direction,
  });
  const weightGoalInsight = buildWeightGoalInsight(
    weightEntries.data ?? [],
    measurementSystem,
    direction
  );
  const authMutation = useMutation({
    mutationFn: () => api.register({ email, password, displayName }),
    onSuccess: async (createdSession) => {
      await storeSession(createdSession);
      try {
        await api.updatePreferences({ unitSystem: measurementSystem });
        setPreferenceNotice(null);
      } catch (error) {
        setPreferenceNotice(error instanceof Error ? error.message : "Try saving your unit preference again.");
      }
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      await queryClient.invalidateQueries({ queryKey: ["preferences"] });
      await queryClient.invalidateQueries({ queryKey: ["diary"] });
      await queryClient.invalidateQueries({ queryKey: ["goal"] });
    },
    onError: (error) => {
      Alert.alert("Profile was not saved", error.message);
    },
  });
  const goalMutation = useMutation({
    mutationFn: (payload: NutritionGoalUpdate) => api.updateGoal(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["goal"] });
      await queryClient.invalidateQueries({ queryKey: ["diary"] });
    },
    onError: (error) => {
      Alert.alert("Goal was not saved", error.message);
    },
  });
  const preferenceMutation = useMutation({
    mutationFn: (unitSystem: MeasurementSystem) => api.updatePreferences({ unitSystem }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["preferences"] });
      setPreferenceNotice(null);
    },
    onError: (error) => {
      setPreferenceNotice(error.message);
    },
  });
  const retentionMutation = useMutation({
    mutationFn: (days: number) => api.updatePreferences({ imageRetentionDays: days }),
    onSuccess: async (updatedPreferences) => {
      setImageRetentionDays(String(updatedPreferences.imageRetentionDays));
      setRetentionNotice(null);
      await queryClient.invalidateQueries({ queryKey: ["preferences"] });
    },
    onError: (error) => {
      setRetentionNotice(error.message);
    },
  });
  const weightMutation = useMutation({
    mutationFn: (payload: WeightEntryCreate) => api.saveWeightEntry(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["weight"] });
      setWeightNote("");
      setEditingWeightEntry(null);
    },
    onError: (error) => {
      Alert.alert("Weight was not saved", error.message);
    },
  });
  const deleteWeightMutation = useMutation({
    mutationFn: (loggedOn: string) => api.deleteWeightEntry(loggedOn),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["weight"] });
      setEditingWeightEntry(null);
    },
    onError: (error) => {
      Alert.alert("Weight was not deleted", error.message);
    },
  });
  const exportMutation = useMutation({
    mutationFn: () => api.exportUserData(),
    onSuccess: (exportData) => {
      Alert.alert(
        "Data export ready",
        `${buildUserDataExportSummary(exportData)}\n\nThis is a JSON export from the current account data available on this device/API session.`
      );
    },
    onError: (error) => {
      Alert.alert("Data export failed", error.message);
    },
  });
  const deleteAccountMutation = useMutation({
    mutationFn: () => api.deleteAccount(),
    onSuccess: async () => {
      await clearStoredSession();
      await queryClient.invalidateQueries();
      Alert.alert("Account deleted", "Account data has been removed from this API session.");
    },
    onError: (error) => {
      Alert.alert("Account was not deleted", error.message);
    },
  });
  const revokeSessionMutation = useMutation({
    mutationFn: (sessionId: string) => api.revokeAuthSession(sessionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth-sessions"] });
    },
    onError: (error) => {
      Alert.alert("Session was not revoked", error.message);
    },
  });

  useEffect(() => {
    if (session.data?.email) {
      setEmail(session.data.email);
    }

    if (session.data?.displayName) {
      setDisplayName(session.data.displayName);
    }
  }, [session.data?.displayName, session.data?.email]);

  useEffect(() => {
    if (
      preferences.data?.unitSystem &&
      !preferenceMutation.isPending &&
      preferences.data.unitSystem !== measurementSystem
    ) {
      applyMeasurementSystem(preferences.data.unitSystem, false);
    }
  }, [measurementSystem, preferenceMutation.isPending, preferences.data?.unitSystem]);

  useEffect(() => {
    if (preferences.data && !retentionMutation.isPending) {
      setImageRetentionDays(String(preferences.data.imageRetentionDays));
    }
  }, [preferences.data, retentionMutation.isPending]);

  function saveProfile() {
    Keyboard.dismiss();

    if (password.trim().length < 8) {
      Alert.alert("Password needed", "Use at least 8 characters for this local profile.");
      return;
    }

    authMutation.mutate();
  }

  function saveGoal() {
    Keyboard.dismiss();
    preferenceMutation.mutate(measurementSystem);
    goalMutation.mutate({
      startsOn: new Date().toISOString().slice(0, 10),
      caloriesKcal: recommendation.caloriesKcal,
      proteinGrams: recommendation.proteinGrams,
      carbohydrateGrams: recommendation.carbohydrateGrams,
      fatGrams: recommendation.fatGrams,
      fiberGrams: 28,
      sodiumMilligrams: 2300,
    });
  }

  function chooseMeasurementSystem(value: MeasurementSystem) {
    applyMeasurementSystem(value, true);
  }

  function applyMeasurementSystem(value: MeasurementSystem, persistPreference: boolean) {
    if (value !== measurementSystem) {
      const converted = convertProfileMeasurementInputs(
        {
          heightFeet,
          heightInches,
          weightLb,
          heightCm,
          weightKg,
        },
        measurementSystem,
        value
      );

      setHeightFeet(converted.heightFeet);
      setHeightInches(converted.heightInches);
      setWeightLb(converted.weightLb);
      setHeightCm(converted.heightCm);
      setWeightKg(converted.weightKg);
      setMeasurementSystem(value);
    }

    if (persistPreference) {
      preferenceMutation.mutate(value);
    }
  }

  function saveImageRetentionPreference() {
    Keyboard.dismiss();
    const days = normalizeRetentionDaysInput(imageRetentionDays);

    if (days === undefined) {
      setRetentionNotice("Enter a number from 0 to 365 days.");
      return;
    }

    setImageRetentionDays(String(days));
    retentionMutation.mutate(days);
  }

  function saveWeight() {
    Keyboard.dismiss();

    if (normalizedStats.weightKg <= 0) {
      Alert.alert("Weight was not saved", "Enter a valid weight before logging.");
      return;
    }

    weightMutation.mutate({
      loggedOn: editingWeightEntry?.loggedOn ?? new Date().toISOString().slice(0, 10),
      weightGrams: normalizedStats.weightKg * 1000,
      notes: weightNote.trim() || null,
    });
  }

  function beginEditWeight(entry: WeightEntry) {
    Keyboard.dismiss();
    setEditingWeightEntry(entry);
    setWeightNote(entry.notes ?? "");

    if (measurementSystem === "us") {
      setWeightLb(weightInputValue(entry.weightGrams, "us"));
      return;
    }

    setWeightKg(weightInputValue(entry.weightGrams, "metric"));
  }

  function cancelEditWeight() {
    setEditingWeightEntry(null);
    setWeightNote("");
  }

  function confirmDeleteWeight(entry: WeightEntry) {
    Alert.alert(
      "Delete weight entry?",
      `${formatWeight(entry.weightGrams, measurementSystem)} from ${formatDisplayDate(entry.loggedOn)} will be removed.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteWeightMutation.mutate(entry.loggedOn),
        },
      ]
    );
  }

  async function signOut() {
    await signOutStoredSession();
    await queryClient.invalidateQueries();
  }

  function confirmRevokeSession(activeSession: AuthSessionSummary) {
    Alert.alert(
      "Revoke this session?",
      "The other device will need to sign in again before it can access your nutrition data.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revoke session",
          style: "destructive",
          onPress: () => revokeSessionMutation.mutate(activeSession.id),
        },
      ]
    );
  }

  function confirmDeleteAccount() {
    Alert.alert(
      "Delete local account?",
      "This removes your local profile, goals, meals, weight entries, favorites, recents, custom foods, and analysis jobs from this API. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete account",
          style: "destructive",
          onPress: () => deleteAccountMutation.mutate(),
        },
      ]
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoider}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScreenShell>
            <View style={styles.header}>
              <Text style={styles.eyebrow}>Profile</Text>
              <Text style={styles.title}>Goals that travel with you.</Text>
              <Text style={styles.body}>
                Sign in locally for now with an email and password, then set a calorie ceiling and
                macro target based on your body stats. This keeps logged meals tied to your profile
                token while production account security is built out.
              </Text>
            </View>

            <Card>
              <SectionHeader
                title="Account"
                meta={session.data?.authScheme === "jwt" || session.data?.authScheme === "local-token" ? "Signed in" : "Local dev"}
              />
              <View style={styles.formGrid}>
                <LabeledInput label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
                <LabeledInput
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                />
                <LabeledInput label="Display name" value={displayName} onChangeText={setDisplayName} />
              </View>
              <Text style={styles.conversionText}>
                Local passwords are hashed. Sessions use short-lived access tokens with refresh rotation.
                Production OAuth and account recovery are still planned.
              </Text>
              <View style={styles.buttonRow}>
                <ActionButton
                  label={authMutation.isPending ? "Saving..." : "Save profile"}
                  onPress={saveProfile}
                  disabled={authMutation.isPending}
                  style={styles.flexButton}
                />
                <ActionButton label="Sign out" variant="secondary" onPress={signOut} style={styles.flexButton} />
              </View>
            </Card>

            <Card>
              <SectionHeader
                title="Active sessions"
                meta={
                  session.data?.authScheme !== "jwt"
                    ? "Local preview"
                    : authSessions.isLoading
                      ? "Loading..."
                      : `${authSessions.data?.items.length ?? 0} active`
                }
              />
              <Text style={styles.body}>
                Review signed-in devices for this local account. Use Sign out above for this device,
                or revoke another active session below.
              </Text>
              {session.data?.authScheme !== "jwt" ? (
                <Text style={styles.conversionText}>
                  Sign in with a local account to review refresh sessions. Development preview access
                  does not create a revocable session.
                </Text>
              ) : authSessions.isError ? (
                <InlineNotice
                  title="Sessions could not load"
                  body={authSessions.error.message}
                  tone="warning"
                  actions={[
                    {
                      label: "Retry",
                      onPress: () => {
                        void authSessions.refetch();
                      },
                    },
                  ]}
                />
              ) : authSessions.isLoading ? (
                <Text style={styles.conversionText}>Checking active sessions...</Text>
              ) : authSessions.data?.items.length ? (
                <View style={styles.sessionList}>
                  {authSessions.data.items.map((activeSession) => (
                    <AuthSessionRow
                      key={activeSession.id}
                      session={activeSession}
                      isRevoking={revokeSessionMutation.isPending}
                      onRevoke={confirmRevokeSession}
                    />
                  ))}
                </View>
              ) : (
                <Text style={styles.conversionText}>No active refresh sessions were found.</Text>
              )}
            </Card>

            <Card>
              <SectionHeader title="Data controls" meta="Privacy draft" />
              <Text style={styles.body}>
                Export a JSON snapshot of your profile, goals, weight entries, meals, and saved foods
                for the current local account. You can also delete this local account. Enforced image
                deletion and production account lifecycle controls are still planned.
              </Text>
              <ActionButton
                label={exportMutation.isPending ? "Preparing export..." : "Export my data"}
                onPress={() => exportMutation.mutate()}
                disabled={exportMutation.isPending}
              />
              <ActionButton
                label={deleteAccountMutation.isPending ? "Deleting account..." : "Delete local account"}
                variant="secondary"
                onPress={confirmDeleteAccount}
                disabled={deleteAccountMutation.isPending}
              />
              <View style={styles.formGrid}>
                <LabeledInput
                  label="Image retention days"
                  value={imageRetentionDays}
                  onChangeText={setImageRetentionDays}
                  keyboardType="decimal-pad"
                />
                <Text style={styles.conversionText}>
                  {retentionPreferenceSummary(normalizeRetentionDaysInput(imageRetentionDays) ?? 30)}
                </Text>
                {retentionNotice ? (
                  <InlineNotice title="Retention preference was not saved" body={retentionNotice} tone="warning" />
                ) : null}
                <ActionButton
                  label={retentionMutation.isPending ? "Saving retention..." : "Save retention preference"}
                  variant="secondary"
                  onPress={saveImageRetentionPreference}
                  disabled={retentionMutation.isPending}
                />
              </View>
            </Card>

            <Card>
              <SectionHeader
                title="Source reports"
                meta={correctionReports.isLoading ? "Loading..." : `${correctionReports.data?.items.length ?? 0} recent`}
              />
              <Text style={styles.body}>
                Recent nutrition-source issues you reported. These stay open until a review workflow
                is added; flagged records should still be reviewed before logging.
              </Text>
              {correctionReports.isError ? (
                <InlineNotice
                  title="Reports could not load"
                  body={correctionReports.error.message}
                  tone="warning"
                  actions={[
                    {
                      label: "Retry",
                      onPress: () => {
                        void correctionReports.refetch();
                      },
                    },
                  ]}
                />
              ) : correctionReports.isLoading ? (
                <Text style={styles.body}>Checking recent source reports...</Text>
              ) : correctionReports.data?.items.length ? (
                <View style={styles.reportList}>
                  {correctionReports.data.items.map((report) => (
                    <CorrectionReportRow key={report.id} report={report} />
                  ))}
                </View>
              ) : (
                <Text style={styles.body}>
                  No source reports yet. If a provider record looks wrong, open View source and send
                  a correction report.
                </Text>
              )}
            </Card>

            <Card>
              <SectionHeader title="Goal recommendation" meta="Editable inputs" />
              <View style={styles.segmentRow}>
                <Pressable
                  style={[styles.segment, measurementSystem === "us" ? styles.activeSegment : undefined]}
                  onPress={() => chooseMeasurementSystem("us")}
                >
                  <Text style={[styles.segmentText, measurementSystem === "us" ? styles.activeSegmentText : undefined]}>
                    US
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.segment, measurementSystem === "metric" ? styles.activeSegment : undefined]}
                  onPress={() => chooseMeasurementSystem("metric")}
                >
                  <Text style={[styles.segmentText, measurementSystem === "metric" ? styles.activeSegmentText : undefined]}>
                    Metric
                  </Text>
                </Pressable>
              </View>
              {preferenceNotice ? (
                <InlineNotice
                  title="Unit preference was not saved"
                  body={preferenceNotice}
                  tone="warning"
                />
              ) : null}
              <View style={styles.formGrid}>
                {measurementSystem === "us" ? (
                  <>
                    <View style={styles.splitRow}>
                      <LabeledInput
                        label="Height (ft)"
                        value={heightFeet}
                        onChangeText={setHeightFeet}
                        keyboardType="decimal-pad"
                      />
                      <LabeledInput
                        label="Height (in)"
                        value={heightInches}
                        onChangeText={setHeightInches}
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <LabeledInput
                      label="Weight (lb)"
                      value={weightLb}
                      onChangeText={setWeightLb}
                      keyboardType="decimal-pad"
                    />
                  </>
                ) : (
                  <>
                    <LabeledInput
                      label="Height (cm)"
                      value={heightCm}
                      onChangeText={setHeightCm}
                      keyboardType="decimal-pad"
                    />
                    <LabeledInput
                      label="Weight (kg)"
                      value={weightKg}
                      onChangeText={setWeightKg}
                      keyboardType="decimal-pad"
                    />
                  </>
                )}
                <LabeledInput label="Body fat (%)" value={bodyFatPercent} onChangeText={setBodyFatPercent} keyboardType="decimal-pad" />
              </View>
              <Text style={styles.conversionText}>{normalizedStats.label}</Text>
              <View style={styles.segmentRow}>
                {directionOptions.map((option) => (
                  <Pressable
                    key={option.value}
                    style={[styles.segment, direction === option.value ? styles.activeSegment : undefined]}
                    onPress={() => setDirection(option.value)}
                  >
                    <Text style={[styles.segmentText, direction === option.value ? styles.activeSegmentText : undefined]}>
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.goalSummary}>
                <Text style={styles.goalCalories}>{recommendation.caloriesKcal}</Text>
                <Text style={styles.goalLabel}>recommended max kcal/day</Text>
                <StatusPill label={direction} tone="success" />
              </View>
              <View style={styles.macroGrid}>
                <MacroStatTile style={styles.macroTile} label="Protein" value={recommendation.proteinGrams} suffix="g" tone="protein" />
                <MacroStatTile style={styles.macroTile} label="Carbs" value={recommendation.carbohydrateGrams} suffix="g" tone="carbs" />
                <MacroStatTile style={styles.macroTile} label="Fat" value={recommendation.fatGrams} suffix="g" tone="fat" />
              </View>
              <InlineNotice title="Recommendation note" body={recommendation.explanation} tone="neutral" />
              <ActionButton
                label={goalMutation.isPending ? "Saving goal..." : "Use this goal"}
                onPress={saveGoal}
                disabled={goalMutation.isPending}
              />
            </Card>

            <Card>
              <SectionHeader title="Current saved goal" />
              {goal.data ? (
                <>
                  <Text style={styles.currentGoal}>{Math.round(goal.data.caloriesKcal)} kcal max</Text>
                  <Text style={styles.body}>
                    {Math.round(goal.data.proteinGrams)}g protein · {Math.round(goal.data.carbohydrateGrams)}g carbs ·{" "}
                    {Math.round(goal.data.fatGrams)}g fat
                  </Text>
                </>
              ) : (
                <Text style={styles.body}>No saved goal yet. Use the recommendation above to start.</Text>
              )}
            </Card>

            <Card>
              <SectionHeader
                title="Weight tracker"
                meta={weightEntries.isLoading ? "Loading..." : `${weightEntries.data?.length ?? 0} entries`}
              />
              <Text style={styles.body}>
                Log today’s weight using the same unit mode above. This is separate from your calorie
                recommendation. Use Edit below to correct a previous entry.
              </Text>
              {editingWeightEntry ? (
                <InlineNotice
                  title={`Editing ${formatDisplayDate(editingWeightEntry.loggedOn)}`}
                  body="Saving will update this entry's weight and note while keeping the original date."
                  tone="neutral"
                />
              ) : null}
              <Text style={styles.currentGoal}>
                {editingWeightEntry
                  ? `${formatWeight(normalizedStats.weightKg * 1000, measurementSystem)} for ${formatDisplayDate(editingWeightEntry.loggedOn)}`
                  : normalizedStats.weightLabel}
              </Text>
              <LabeledInput
                label="Note (optional)"
                value={weightNote}
                onChangeText={setWeightNote}
              />
              <View style={styles.buttonRow}>
                <ActionButton
                  label={
                    weightMutation.isPending
                      ? "Saving weight..."
                      : editingWeightEntry
                        ? "Save weight edit"
                        : "Log today's weight"
                  }
                  onPress={saveWeight}
                  disabled={weightMutation.isPending}
                  style={styles.flexButton}
                />
                {editingWeightEntry ? (
                  <ActionButton
                    label="Cancel edit"
                    variant="secondary"
                    onPress={cancelEditWeight}
                    style={styles.flexButton}
                  />
                ) : null}
              </View>
              <WeightTrendChart
                entries={weightEntries.data ?? []}
                measurementSystem={measurementSystem}
              />
              <InlineNotice
                title={weightGoalInsight.title}
                body={weightGoalInsight.body}
                tone={weightGoalInsight.tone}
              />
              <View style={styles.weightHistory}>
                {(weightEntries.data ?? []).length ? (
                  weightEntries.data?.map((entry) => (
                    <View key={entry.id} style={styles.weightRow}>
                      <View style={styles.weightCopy}>
                        <Text style={styles.weightDate}>{formatDisplayDate(entry.loggedOn)}</Text>
                        <Text style={styles.weightMeta}>{entry.notes || "No note"}</Text>
                      </View>
                      <View style={styles.weightActions}>
                        <Text style={styles.weightValue}>{formatWeight(entry.weightGrams, measurementSystem)}</Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Edit weight entry from ${formatDisplayDate(entry.loggedOn)}`}
                          style={styles.weightEditButton}
                          onPress={() => beginEditWeight(entry)}
                          disabled={weightMutation.isPending}
                        >
                          <Text style={styles.weightEditText}>Edit</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Delete weight entry from ${formatDisplayDate(entry.loggedOn)}`}
                          style={styles.weightDeleteButton}
                          onPress={() => confirmDeleteWeight(entry)}
                          disabled={deleteWeightMutation.isPending}
                        >
                          <Text style={styles.weightDeleteText}>
                            {deleteWeightMutation.isPending ? "Deleting..." : "Delete"}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={styles.body}>
                    No weight entries yet. Your first entry will appear here after saving.
                  </Text>
                )}
              </View>
            </Card>
        </ScreenShell>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

function LabeledInput({
  label,
  value,
  onChangeText,
  keyboardType,
  secureTextEntry,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: "default" | "decimal-pad" | "email-address";
  secureTextEntry?: boolean;
}) {
  return (
    <View style={styles.inputWrap}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        autoCapitalize="none"
        returnKeyType="done"
        onSubmitEditing={Keyboard.dismiss}
      />
    </View>
  );
}

function AuthSessionRow({
  session,
  isRevoking,
  onRevoke,
}: {
  session: AuthSessionSummary;
  isRevoking: boolean;
  onRevoke: (session: AuthSessionSummary) => void;
}) {
  const activity = session.lastUsedAt
    ? `Last refreshed ${formatTimestamp(session.lastUsedAt)}`
    : `Created ${formatTimestamp(session.createdAt)}`;

  return (
    <View style={styles.sessionRow}>
      <View style={styles.sessionCopy}>
        <View style={styles.sessionTitleRow}>
          <Text style={styles.sessionTitle}>{session.isCurrent ? "This device" : "Other device"}</Text>
          <StatusPill label={session.isCurrent ? "Current" : "Active"} tone="success" />
        </View>
        <Text style={styles.sessionMeta}>{activity}</Text>
        <Text style={styles.sessionMeta}>Expires {formatTimestamp(session.expiresAt)}</Text>
      </View>
      {session.isCurrent ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Revoke another active session"
          style={[styles.revokeSessionButton, isRevoking ? styles.disabledButton : undefined]}
          disabled={isRevoking}
          onPress={() => onRevoke(session)}
        >
          <Text style={styles.revokeSessionText}>{isRevoking ? "Revoking..." : "Revoke"}</Text>
        </Pressable>
      )}
    </View>
  );
}

function CorrectionReportRow({ report }: { report: FoodCorrectionReportSummary }) {
  const sourceName = report.sourceDisplayName || "Source record unavailable";
  const statusTone = report.status === "open" ? "warning" : "success";

  return (
    <View style={styles.reportRow}>
      <View style={styles.reportRowHeader}>
        <View style={styles.reportCopy}>
          <Text numberOfLines={2} style={styles.reportTitle}>
            {sourceName}
          </Text>
          <Text style={styles.reportMeta}>
            {correctionReportTypeLabel(report.reportType)} · {formatTimestamp(report.createdAt)}
          </Text>
        </View>
        <StatusPill label={report.status} tone={statusTone} style={styles.reportStatus} />
      </View>
      <Text numberOfLines={3} style={styles.body}>
        {report.message}
      </Text>
      <View style={styles.reportFooter}>
        <Text numberOfLines={1} style={styles.conversionText}>
          {correctionReportSourceSummary(report)}
        </Text>
        {report.foodSourceRecordId ? (
          <Link href={foodDetailHref(report.foodSourceRecordId)} asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View nutrition source for ${sourceName}`}
              style={styles.reportSourceButton}
            >
              <Text style={styles.reportSourceText}>View source</Text>
            </Pressable>
          </Link>
        ) : null}
      </View>
    </View>
  );
}

function parseNumber(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeBodyStats({
  measurementSystem,
  heightCm,
  weightKg,
  heightFeet,
  heightInches,
  weightLb,
}: {
  measurementSystem: MeasurementSystem;
  heightCm: string;
  weightKg: string;
  heightFeet: string;
  heightInches: string;
  weightLb: string;
}) {
  if (measurementSystem === "us") {
    const feet = parseNumber(heightFeet);
    const inches = parseNumber(heightInches);
    const pounds = parseNumber(weightLb);
    const totalInches = feet * 12 + inches;
    const normalizedHeightCm = totalInches * 2.54;
    const normalizedWeightKg = pounds * 0.45359237;

    return {
      heightCm: normalizedHeightCm,
      weightKg: normalizedWeightKg,
      weightLabel: `${Math.round(pounds * 10) / 10} lb today`,
      label: `Using ${Math.round(normalizedHeightCm)} cm and ${Math.round(normalizedWeightKg)} kg for the recommendation.`,
    };
  }

  const normalizedHeightCm = parseNumber(heightCm);
  const normalizedWeightKg = parseNumber(weightKg);
  const totalInches = normalizedHeightCm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches - feet * 12);
  const pounds = Math.round(normalizedWeightKg / 0.45359237);

  return {
    heightCm: normalizedHeightCm,
    weightKg: normalizedWeightKg,
    weightLabel: `${Math.round(normalizedWeightKg * 10) / 10} kg today`,
    label: `About ${feet} ft ${inches} in and ${pounds} lb in US units.`,
  };
}

function formatDisplayDate(value: string) {
  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatTimestamp(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function WeightTrendChart({
  entries,
  measurementSystem,
}: {
  entries: WeightEntry[];
  measurementSystem: MeasurementSystem;
}) {
  const sortedEntries = sortWeightEntriesAscending(entries).slice(-8);
  const unit = measurementSystem === "us" ? "lb" : "kg";
  const chartWidth = 320;
  const chartHeight = 150;
  const paddingX = 24;
  const paddingTop = 18;
  const paddingBottom = 30;
  const values = sortedEntries.map((entry) => weightDisplayValue(entry.weightGrams, measurementSystem));
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = Math.max(maximum - minimum, 1);
  const points = sortedEntries.map((entry, index) => {
    const x = paddingX + (index * (chartWidth - paddingX * 2)) / Math.max(sortedEntries.length - 1, 1);
    const value = weightDisplayValue(entry.weightGrams, measurementSystem);
    const normalized = (value - minimum) / range;
    const y = paddingTop + (1 - normalized) * (chartHeight - paddingTop - paddingBottom);
    return { ...entry, x, y, value };
  });

  if (sortedEntries.length < 2) {
    return (
      <View style={styles.weightTrendEmpty}>
        <Text style={styles.weightTrendTitle}>Weight trend</Text>
        <Text style={styles.body}>Add another entry to draw a trend line in your preferred units.</Text>
      </View>
    );
  }

  return (
    <View
      style={styles.weightTrendCard}
      accessible
      accessibilityLabel={buildWeightTrendSummary(sortedEntries, measurementSystem)}
    >
      <View style={styles.weightTrendHeader}>
        <View>
          <Text style={styles.weightTrendTitle}>Weight trend</Text>
          <Text style={styles.weightTrendMeta}>{buildWeightTrendSummary(sortedEntries, measurementSystem)}</Text>
        </View>
        <StatusPill label={unit} tone="neutral" />
      </View>
      <Svg width="100%" height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
        <Line
          x1={paddingX}
          y1={paddingTop}
          x2={paddingX}
          y2={chartHeight - paddingBottom}
          stroke={colors.surfaceAlt}
          strokeWidth={2}
        />
        <Line
          x1={paddingX}
          y1={chartHeight - paddingBottom}
          x2={chartWidth - paddingX}
          y2={chartHeight - paddingBottom}
          stroke={colors.surfaceAlt}
          strokeWidth={2}
        />
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
            key={point.id}
            cx={point.x}
            cy={point.y}
            r={5}
            fill={colors.lime}
            stroke={colors.white}
            strokeWidth={2}
          />
        ))}
        <SvgText x={paddingX + 4} y={paddingTop + 10} fill={colors.muted} fontSize="10">
          {Math.round(maximum * 10) / 10}
        </SvgText>
        <SvgText x={paddingX + 4} y={chartHeight - paddingBottom - 8} fill={colors.muted} fontSize="10">
          {Math.round(minimum * 10) / 10}
        </SvgText>
        {points.map((point, index) => (
          <SvgText
            key={`${point.id}-date`}
            x={point.x}
            y={chartHeight - 8}
            fill={colors.muted}
            fontSize="10"
            textAnchor="middle"
          >
            {index === 0 || index === points.length - 1 ? shortDate(point.loggedOn) : ""}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

function shortDate(value: string) {
  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value.slice(5);
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "numeric",
    day: "numeric",
  }).format(date);
}

const styles = StyleSheet.create({
  keyboardAvoider: {
    flex: 1,
  },
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
  formGrid: {
    gap: spacing.md,
  },
  splitRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  inputWrap: {
    flex: 1,
    gap: spacing.xs,
  },
  inputLabel: {
    ...typography.caption,
    color: colors.muted,
  },
  input: {
    minHeight: 52,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    color: colors.ink,
  },
  buttonRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  flexButton: {
    flex: 1,
  },
  segmentRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.background,
  },
  activeSegment: {
    backgroundColor: colors.green,
  },
  segmentText: {
    ...typography.button,
    color: colors.ink,
  },
  activeSegmentText: {
    color: colors.white,
  },
  conversionText: {
    ...typography.caption,
    color: colors.muted,
  },
  goalSummary: {
    alignItems: "flex-start",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  goalCalories: {
    fontSize: 56,
    lineHeight: 62,
    fontWeight: "800",
    color: colors.ink,
  },
  goalLabel: {
    ...typography.caption,
    color: colors.muted,
  },
  macroGrid: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  macroTile: {
    flexBasis: "30%",
  },
  currentGoal: {
    ...typography.heading,
    color: colors.ink,
  },
  reportList: {
    gap: spacing.sm,
  },
  reportRow: {
    gap: spacing.sm,
    borderRadius: radii.lg,
    padding: spacing.md,
    backgroundColor: colors.background,
  },
  reportRowHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  reportCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  reportTitle: {
    ...typography.heading,
    color: colors.ink,
  },
  reportMeta: {
    ...typography.caption,
    color: colors.muted,
  },
  reportStatus: {
    flexShrink: 0,
  },
  reportFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  reportSourceButton: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  reportSourceText: {
    ...typography.button,
    color: colors.green,
  },
  sessionList: {
    gap: spacing.sm,
  },
  sessionRow: {
    gap: spacing.sm,
    borderRadius: radii.lg,
    padding: spacing.md,
    backgroundColor: colors.background,
  },
  sessionCopy: {
    gap: spacing.xs,
  },
  sessionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  sessionTitle: {
    ...typography.heading,
    color: colors.ink,
  },
  sessionMeta: {
    ...typography.caption,
    color: colors.muted,
  },
  revokeSessionButton: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  revokeSessionText: {
    ...typography.button,
    color: colors.coral,
  },
  disabledButton: {
    opacity: 0.55,
  },
  weightHistory: {
    gap: spacing.sm,
  },
  weightTrendCard: {
    gap: spacing.sm,
    borderRadius: radii.lg,
    padding: spacing.md,
    backgroundColor: colors.background,
  },
  weightTrendEmpty: {
    gap: spacing.xs,
    borderRadius: radii.lg,
    padding: spacing.md,
    backgroundColor: colors.background,
  },
  weightTrendHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  weightTrendTitle: {
    ...typography.heading,
    color: colors.ink,
  },
  weightTrendMeta: {
    ...typography.caption,
    color: colors.muted,
  },
  weightRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderRadius: radii.md,
    padding: spacing.md,
    backgroundColor: colors.background,
  },
  weightCopy: {
    flex: 1,
    gap: 2,
  },
  weightDate: {
    ...typography.body,
    color: colors.ink,
    fontWeight: "700",
  },
  weightMeta: {
    ...typography.caption,
    color: colors.muted,
  },
  weightValue: {
    ...typography.heading,
    color: colors.green,
  },
  weightActions: {
    alignItems: "flex-end",
    gap: spacing.xs,
  },
  weightEditButton: {
    minHeight: 36,
    justifyContent: "center",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surfaceAlt,
  },
  weightEditText: {
    ...typography.caption,
    color: colors.green,
    fontWeight: "700",
  },
  weightDeleteButton: {
    minHeight: 36,
    justifyContent: "center",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surfaceAlt,
  },
  weightDeleteText: {
    ...typography.caption,
    color: colors.coral,
    fontWeight: "700",
  },
});
