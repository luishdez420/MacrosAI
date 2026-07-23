import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { colors, radii, spacing, typography, type ThemePalette } from "@living-nutrition/design-tokens";
import { AnalysisAllowanceNotice } from "../../shared/components/AnalysisAllowanceNotice";
import {
  ActionButton,
  Card,
  InlineNotice,
  ScreenShell,
} from "../../shared/components/LivingUI";
import { api } from "../../services/api";
import { useLabelDraftStore } from "../../stores/labelDraftStore";
import { useTheme } from "../../shared/theme/ThemeProvider";

export function LabelScanScreen() {
  const router = useRouter();
  const { palette } = useTheme();
  const themed = labelThemeStyles(palette);
  const params = useLocalSearchParams<{ barcode?: string }>();
  const barcode = normalizeBarcode(stringParam(params.barcode));
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [labelUri, setLabelUri] = useState<string | null>(null);
  const [labelBase64, setLabelBase64] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const labelAnalysisKeyRef = useRef<string | null>(null);
  const setLabelDraft = useLabelDraftStore((store) => store.setDraft);
  const clearLabelDraft = useLabelDraftStore((store) => store.clearDraft);

  useEffect(() => {
    clearLabelDraft();
  }, [clearLabelDraft]);

  async function captureLabel() {
    try {
      setIsCapturing(true);
      const photo = await cameraRef.current?.takePictureAsync({
        base64: true,
        quality: 0.82,
        skipProcessing: false,
      });

      if (!photo?.uri) {
        setAnalysisError("The camera did not return a usable label photo. Try capturing it again or import a clear image.");
        return;
      }

      setLabelUri(photo.uri);
      setLabelBase64(photo.base64 || null);
      labelAnalysisKeyRef.current = createLabelAnalysisKey();
      setAnalysisError(null);
    } catch {
      setAnalysisError("We could not capture that label photo. Try again, import a clear image, or enter the values manually.");
    } finally {
      setIsCapturing(false);
    }
  }

  async function importLabel() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        base64: true,
        quality: 0.85,
      });

      if (result.canceled || !result.assets[0]?.uri) {
        return;
      }

      setLabelUri(result.assets[0].uri);
      setLabelBase64(result.assets[0].base64 || null);
      labelAnalysisKeyRef.current = createLabelAnalysisKey();
      setAnalysisError(null);
    } catch {
      setAnalysisError("We could not import that label photo. Try another image, use the camera, or enter the values manually.");
    }
  }

  function continueToCustomFood() {
    const search = new URLSearchParams();

    if (labelUri) {
      search.set("labelCaptured", "1");
      setLabelDraft({ photoUri: labelUri });
    }

    if (barcode) {
      search.set("barcode", barcode);
    }

    const query = search.toString();
    router.push(query ? `/custom-food?${query}` : "/custom-food");
  }

  async function analyzeLabel() {
    if (!labelUri || !labelBase64) {
      setAnalysisError(
        "This photo did not include readable image data. Retake it or import another image."
      );
      return;
    }

    setAnalysisError(null);
    setIsAnalyzing(true);
    const idempotencyKey = labelAnalysisKeyRef.current || createLabelAnalysisKey();
    labelAnalysisKeyRef.current = idempotencyKey;

    try {
      const analysis = await api.analyzeNutritionLabel({
        imageBase64: labelBase64,
        barcode,
      }, { idempotencyKey });
      setLabelDraft({ photoUri: labelUri, analysis });
      const search = new URLSearchParams({ labelCaptured: "1", labelAnalyzed: "1" });
      if (barcode) {
        search.set("barcode", barcode);
      }
      router.push(`/custom-food?${search.toString()}`);
    } catch (error) {
      setAnalysisError(
        error instanceof Error
          ? error.message
          : "The label could not be analyzed. Retake it or enter values manually."
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  if (!permission) {
    return <View style={[styles.screen, { backgroundColor: palette.background }]} />;
  }

  if (!permission.granted) {
    return (
      <ScreenShell scroll={false} contentStyle={styles.permissionScreen}>
        <Card tone="soft" style={styles.permissionCard}>
          <View style={[styles.permissionIcon, themed.permissionIcon]}>
            <Ionicons name="document-text-outline" size={30} color={colors.green} />
          </View>
          <Text style={[styles.permissionEyebrow, themed.muted]}>Custom food review</Text>
          <Text style={[styles.title, themed.ink]}>Label capture needs camera access.</Text>
          <Text style={[styles.body, themed.muted]}>
            A clear label photo helps you compare package values before creating a custom food. Nothing is saved from the photo automatically.
          </Text>
          <ActionButton label="Enable camera" onPress={requestPermission} />
          <ActionButton label="Import label photo" variant="secondary" onPress={importLabel} />
          <ActionButton label="Enter nutrition manually" variant="quiet" onPress={continueToCustomFood} />
        </Card>
      </ScreenShell>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      {labelUri ? (
        <Image source={{ uri: labelUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
      )}
      <SafeAreaView style={styles.overlay}>
        <View style={styles.topBar}>
          <Link href={barcode ? `/custom-food?barcode=${encodeURIComponent(barcode)}` : "/custom-food"} asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close nutrition label capture"
              style={[styles.roundButton, themed.roundButton]}
              onPress={clearLabelDraft}
            >
              <Text style={[styles.roundButtonText, themed.ink]}>Close</Text>
            </Pressable>
          </Link>
          <Pressable accessibilityRole="button" accessibilityLabel="Import a nutrition label photo" style={[styles.roundButton, themed.roundButton]} onPress={importLabel}>
            <Text style={[styles.roundButtonText, themed.ink]}>Import</Text>
          </Pressable>
        </View>

        <View style={styles.guidance}>
          <Text style={styles.guidanceTitle}>Photograph the nutrition facts label</Text>
          <Text style={styles.guidanceText}>
            Keep the label flat, bright, and readable. Extracted values are never saved until you compare and confirm them.
          </Text>
          {barcode ? (
            <Text style={styles.guidanceText}>Barcode: {barcode}</Text>
          ) : null}
        </View>

        <View style={styles.frame} />

        <InlineNotice
          title={analysisError ? "Label analysis needs attention" : "Review is always required"}
          body={
            analysisError ||
            "We only extract clearly visible values. You must compare every result with the original label before saving. The photo is not persisted by this flow."
          }
          tone={analysisError ? "warning" : "neutral"}
        />
        <AnalysisAllowanceNotice kind="label" />

        <View style={[styles.bottomBar, themed.bottomBar]}>
          {labelUri ? (
            <View style={styles.analysisActions}>
              <View style={styles.analysisActionRow}>
                <ActionButton
                  label="Retake"
                  variant="secondary"
                  onPress={() => {
                  setLabelUri(null);
                  setLabelBase64(null);
                  labelAnalysisKeyRef.current = null;
                  setAnalysisError(null);
                  clearLabelDraft();
                  }}
                  disabled={isAnalyzing}
                  style={styles.bottomButton}
                />
                <ActionButton
                  label={isAnalyzing ? "Reading label..." : "Extract values"}
                  onPress={analyzeLabel}
                  disabled={isAnalyzing}
                  style={styles.bottomButton}
                />
              </View>
              <ActionButton
                label="Enter manually"
                variant="secondary"
                onPress={continueToCustomFood}
                disabled={isAnalyzing}
              />
            </View>
          ) : (
            <>
              <ActionButton label="Import" variant="secondary" onPress={importLabel} style={styles.bottomButton} />
              <Pressable
              accessibilityRole="button"
              accessibilityLabel="Capture nutrition label photo"
              accessibilityHint="Takes a photo for review. Extracted values are never saved automatically."
                style={[styles.captureButton, isCapturing ? styles.disabled : undefined]}
                onPress={captureLabel}
                disabled={isCapturing}
              >
                <View style={styles.captureInner} />
              </Pressable>
              <ActionButton label="Enter manually" variant="secondary" onPress={continueToCustomFood} style={styles.bottomButton} />
            </>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeBarcode(value: string | undefined) {
  return String(value || "").replace(/\D/g, "");
}

function createLabelAnalysisKey() {
  return `label-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ink,
  },
  permissionScreen: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.xl,
  },
  permissionCard: { gap: spacing.md },
  permissionIcon: { width: 64, height: 64, alignItems: "center", justifyContent: "center", borderRadius: radii.lg },
  permissionEyebrow: { ...typography.eyebrow },
  overlay: {
    flex: 1,
    justifyContent: "space-between",
    padding: spacing.lg,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  roundButton: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
  },
  roundButtonText: {
    ...typography.button,
    color: colors.ink,
  },
  title: {
    ...typography.display,
    color: colors.ink,
  },
  body: {
    ...typography.body,
    color: colors.muted,
  },
  guidance: {
    gap: spacing.xs,
    borderRadius: radii.lg,
    padding: spacing.md,
    backgroundColor: "rgba(12, 24, 20, 0.68)",
  },
  guidanceTitle: {
    ...typography.heading,
    color: colors.white,
  },
  guidanceText: {
    ...typography.body,
    color: colors.surface,
  },
  frame: {
    minHeight: 260,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.lime,
    backgroundColor: "rgba(190, 230, 76, 0.08)",
  },
  bottomBar: {
    minHeight: 88,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    borderRadius: radii.lg,
    padding: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bottomButton: {
    flex: 1,
  },
  analysisActions: {
    flex: 1,
    gap: spacing.sm,
  },
  analysisActionRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  captureButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: colors.white,
    backgroundColor: colors.lime,
  },
  captureInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.white,
  },
  disabled: {
    opacity: 0.62,
  },
});

function labelThemeStyles(palette: ThemePalette) {
  return {
    ink: { color: palette.ink },
    muted: { color: palette.muted },
    permissionIcon: { backgroundColor: palette.mode === "dark" ? "rgba(47, 91, 57, 0.82)" : colors.limeSoft },
    roundButton: { backgroundColor: palette.utilityGlass, borderColor: palette.border, borderWidth: StyleSheet.hairlineWidth },
    bottomBar: { backgroundColor: palette.navigationGlass, borderColor: palette.border },
  };
}
