import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { Link, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, elevations, glass, radii, spacing, typography, type ThemePalette } from "@living-nutrition/design-tokens";
import { ActionButton, GlassIconButton, InlineNotice } from "../../shared/components/LivingUI";
import { useTheme } from "../../shared/theme/ThemeProvider";
import { env } from "../../config/env";
import { fixtureMealPhoto } from "../../e2e/fixtureMeal";
import { type DraftPhoto, useAnalysisDraftStore } from "../../stores/analysisDraftStore";
import {
  appendMealView,
  formatViewCount,
  maximumMealViews,
  mealCaptureGuidance,
} from "./cameraCapture";

const plateReferenceOptions = [
  { label: "25 cm", diameterMm: 250 },
  { label: "28 cm", diameterMm: 280 },
  { label: "30 cm", diameterMm: 300 },
] as const;

export function CameraScreen() {
  const cameraRef = useRef<CameraView>(null);
  const router = useRouter();
  const { palette } = useTheme();
  const themed = cameraThemeStyles(palette);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<"back" | "front">("back");
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [captureMode, setCaptureMode] = useState<"single" | "multi">("single");
  const [capturedPhotos, setCapturedPhotos] = useState<DraftPhoto[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [reducedTransparency, setReducedTransparency] = useState(false);
  const scanPulse = useRef(new Animated.Value(0.7)).current;
  const setDraftPhoto = useAnalysisDraftStore((store) => store.setDraftPhoto);
  const setDraftPhotos = useAnalysisDraftStore((store) => store.setDraftPhotos);
  const referencePlateDiameterMm = useAnalysisDraftStore((store) => store.referencePlateDiameterMm);
  const setReferencePlateDiameterMm = useAnalysisDraftStore((store) => store.setReferencePlateDiameterMm);
  const multiAngleGuidance = mealCaptureGuidance(capturedPhotos.length);

  useEffect(() => {
    let isMounted = true;
    const motionSubscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    const transparencySubscription = AccessibilityInfo.addEventListener(
      "reduceTransparencyChanged",
      setReducedTransparency
    );

    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (isMounted) setReducedMotion(enabled);
    });
    AccessibilityInfo.isReduceTransparencyEnabled().then((enabled) => {
      if (isMounted) setReducedTransparency(enabled);
    });

    return () => {
      isMounted = false;
      motionSubscription.remove();
      transparencySubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      scanPulse.setValue(0.8);
      return undefined;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scanPulse, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(scanPulse, { toValue: 0.56, duration: 1300, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [reducedMotion, scanPulse]);

  function setScannerMode(nextMode: "single" | "multi") {
    setCaptureMode(nextMode);
    if (nextMode === "single") {
      setCapturedPhotos([]);
    }
    setCaptureError(null);
    void Haptics.selectionAsync().catch(() => undefined);
  }

  function addPhotoToMultiAngleDraft(photo: DraftPhoto) {
    setCapturedPhotos((current) => appendMealView(current, photo));
  }

  function reviewMultiAngleDraft() {
    if (!capturedPhotos.length) return;
    setDraftPhotos(capturedPhotos);
    router.push("/confirm-meal");
  }

  function removeLastMultiAnglePhoto() {
    setCapturedPhotos((current) => current.slice(0, -1));
    void Haptics.selectionAsync().catch(() => undefined);
  }

  function useAutomatedTestMeal() {
    if (!env.e2eFixtureMode) return;
    setDraftPhoto(fixtureMealPhoto);
    router.push("/confirm-meal");
  }

  async function capturePhoto() {
    if (isCapturing || isImporting || (captureMode === "multi" && capturedPhotos.length >= maximumMealViews)) return;

    setIsCapturing(true);
    try {
      const photo = await cameraRef.current?.takePictureAsync({ base64: true, quality: 0.78, skipProcessing: false });

      if (!photo?.uri) {
        setCaptureError("The camera did not return a usable meal photo. Try again, import a clear photo, or enter food manually.");
        return;
      }

      setCaptureError(null);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      const draftPhoto = { uri: photo.uri, base64: photo.base64, source: "camera" } as const;
      if (captureMode === "multi") {
        addPhotoToMultiAngleDraft(draftPhoto);
      } else {
        setDraftPhoto(draftPhoto);
        router.push("/confirm-meal");
      }
    } catch {
      setCaptureError("We could not capture that meal photo. Try again, import a clear photo, or enter food manually.");
    } finally {
      setIsCapturing(false);
    }
  }

  async function importPhoto() {
    if (isCapturing || isImporting || (captureMode === "multi" && capturedPhotos.length >= maximumMealViews)) return;

    setIsImporting(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        base64: true,
        quality: 0.8,
      });

      if (result.canceled || !result.assets[0]) return;

      setCaptureError(null);
      const draftPhoto = {
        uri: result.assets[0].uri,
        base64: result.assets[0].base64,
        source: "library",
      } as const;
      if (captureMode === "multi") {
        addPhotoToMultiAngleDraft(draftPhoto);
      } else {
        setDraftPhoto(draftPhoto);
        router.push("/confirm-meal");
      }
    } catch {
      setCaptureError("We could not import that meal photo. Try another image, use the camera, or enter food manually.");
    } finally {
      setIsImporting(false);
    }
  }

  if (!permission) return <View style={styles.screen} />;

  if (!permission.granted) {
    return (
      <SafeAreaView style={[styles.permissionScreen, themed.permissionScreen]}>
        <View style={[styles.permissionMark, themed.permissionMark]}><Ionicons name="camera-outline" size={30} color={colors.green} /></View>
        <Text style={[styles.permissionEyebrow, themed.actionText]}>Camera assist</Text>
        <Text style={[styles.permissionTitle, themed.ink]}>A clear photo makes review easier.</Text>
        <Text style={[styles.permissionBody, themed.muted]}>
          We use a meal photo to suggest visible foods and portions. You review every estimate before anything is saved.
        </Text>
        <ActionButton label="Enable camera" onPress={requestPermission} />
        {env.e2eFixtureMode ? (
          <ActionButton label="Use automated test meal" variant="secondary" onPress={useAutomatedTestMeal} />
        ) : null}
        <Link href="/manual-search" asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search for food manually instead of enabling the camera"
            style={styles.permissionSecondary}
          >
            <Text style={[styles.permissionSecondaryText, themed.actionText]}>Search for food instead</Text>
          </Pressable>
        </Link>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.screen}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} enableTorch={flashEnabled} />
      <View pointerEvents="none" style={styles.cameraShade} />
      <SafeAreaView style={styles.overlay}>
        <View style={styles.topBar}>
          <Link href="/" asChild>
            <Pressable accessibilityRole="button" accessibilityLabel="Close meal scanner" style={styles.topControl}>
              <Ionicons name="close" size={22} color={colors.white} />
            </Pressable>
          </Link>
          <View style={styles.scanModePill}>
            <View style={styles.scanModeDot} />
            <Text style={styles.scanModeText}>Meal scan</Text>
          </View>
          <View style={styles.topRightControls}>
            <GlassIconButton icon={flashEnabled ? "flash" : "flash-outline"} label={flashEnabled ? "Turn flash off" : "Turn flash on"} onPress={() => setFlashEnabled((value) => !value)} tone="dark" />
            <GlassIconButton icon="camera-reverse-outline" label="Switch camera" onPress={() => setFacing((value) => (value === "back" ? "front" : "back"))} tone="dark" />
          </View>
        </View>

        <View pointerEvents="none" style={styles.frameArea}>
          <Animated.View style={[styles.focusHalo, { opacity: scanPulse, transform: [{ scale: scanPulse }] }]} />
          <View style={styles.frameCornerTopLeft} />
          <View style={styles.frameCornerTopRight} />
          <View style={styles.frameCornerBottomLeft} />
          <View style={styles.frameCornerBottomRight} />
          <Text style={styles.frameCaption}>
            {captureMode === "multi" ? multiAngleGuidance.instruction : "Keep the whole plate in view"}
          </Text>
        </View>

        <View style={styles.bottomArea}>
          {env.e2eFixtureMode ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Use automated test meal"
              onPress={useAutomatedTestMeal}
              style={styles.e2eFixtureAction}
            >
              <Text style={styles.e2eFixtureActionText}>Use automated test meal</Text>
            </Pressable>
          ) : null}
          <View style={styles.captureModeRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: captureMode === "single" }}
              accessibilityLabel="Use one meal photo"
              accessibilityHint="Captures one image for an assisted food review. You confirm every food and portion afterward."
              onPress={() => setScannerMode("single")}
              style={[styles.captureModeButton, captureMode === "single" ? styles.captureModeButtonActive : undefined]}
            >
              <Text style={[styles.captureModeLabel, captureMode === "single" ? styles.captureModeLabelActive : undefined]}>
                One photo
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: captureMode === "multi" }}
              accessibilityLabel="Add up to three meal photo angles"
              accessibilityHint="Captures angled, top-down, or side views to clarify visible foods. You still confirm every food and portion."
              onPress={() => setScannerMode("multi")}
              style={[styles.captureModeButton, captureMode === "multi" ? styles.captureModeButtonActive : undefined]}
            >
              <Text style={[styles.captureModeLabel, captureMode === "multi" ? styles.captureModeLabelActive : undefined]}>
                Add angles
              </Text>
            </Pressable>
          </View>
          <View style={styles.plateReferencePanel}>
            <View style={styles.plateReferenceHeader}>
              <View style={styles.plateReferenceTitleRow}>
                <Ionicons name="resize-outline" size={17} color={colors.lime} />
                <Text style={styles.plateReferenceTitle}>Known plate size</Text>
              </View>
              <Text style={styles.plateReferenceOptional}>Optional</Text>
            </View>
            <Text style={styles.plateReferenceBody}>
              Select only when the whole round plate is visible and you know its approximate diameter. It is a visual cue, not an exact weight measurement.
            </Text>
            <View accessibilityRole="radiogroup" accessibilityLabel="Known plate diameter" style={styles.plateReferenceOptions}>
              {plateReferenceOptions.map((option) => {
                const selected = referencePlateDiameterMm === option.diameterMm;
                return (
                  <Pressable
                    key={option.diameterMm}
                    accessibilityRole="radio"
                    accessibilityLabel={`Use an approximately ${option.label} plate as a visual reference`}
                    accessibilityHint="This is only a visual scale cue. You still confirm food grams during review."
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setReferencePlateDiameterMm(selected ? undefined : option.diameterMm);
                      void Haptics.selectionAsync().catch(() => undefined);
                    }}
                    style={[styles.plateReferenceOption, selected ? styles.plateReferenceOptionSelected : undefined]}
                  >
                    <Text style={[styles.plateReferenceOptionText, selected ? styles.plateReferenceOptionTextSelected : undefined]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          {reducedTransparency ? (
            <View style={[styles.guidanceSurface, styles.guidanceSurfaceOpaque]}>
              <Text style={styles.guidanceTitle}>
                {captureMode === "multi"
                  ? `${multiAngleGuidance.label} ${capturedPhotos.length + 1} of ${maximumMealViews}`
                  : "A 45-degree photo works best"}
              </Text>
              <Text style={styles.guidanceBody}>
                {captureMode === "multi"
                  ? `${formatViewCount(capturedPhotos.length)} captured. Extra angles clarify what is visible, but you still review food names, grams, and hidden ingredients.`
                  : "Choose Add angles for a top-down or side photo when it helps clarify a mixed meal. Estimates always need your review."}
              </Text>
            </View>
          ) : (
            <BlurView intensity={glass.blur.navigation} tint="dark" style={styles.guidanceSurface}>
              <Text style={styles.guidanceTitle}>
                {captureMode === "multi"
                  ? `${multiAngleGuidance.label} ${capturedPhotos.length + 1} of ${maximumMealViews}`
                  : "A 45-degree photo works best"}
              </Text>
              <Text style={styles.guidanceBody}>
                {captureMode === "multi"
                  ? `${formatViewCount(capturedPhotos.length)} captured. Extra angles clarify what is visible, but you still review food names, grams, and hidden ingredients.`
                  : "Choose Add angles for a top-down or side photo when it helps clarify a mixed meal. Estimates always need your review."}
              </Text>
            </BlurView>
          )}

          {captureError ? (
            <InlineNotice
              title="Meal photo needs attention"
              body={captureError}
              tone="warning"
              actions={[
                { label: "Try camera", onPress: () => setCaptureError(null), variant: "secondary" },
                { label: "Import photo", onPress: () => void importPhoto(), variant: "secondary" },
              ]}
            />
          ) : null}

          {captureMode === "multi" && capturedPhotos.length ? (
            <View
              accessible
              accessibilityLabel={`${formatViewCount(capturedPhotos.length)} captured for review`}
              style={styles.capturedViewPanel}
            >
              <Text style={styles.capturedViewLabel}>Captured views</Text>
              <View style={styles.capturedViewRow}>
                {capturedPhotos.map((photo, index) => {
                  const guidance = mealCaptureGuidance(index);
                  return (
                    <View key={photo.uri} style={styles.capturedViewItem}>
                      <Image
                        accessibilityLabel={`${guidance.label}, photo ${index + 1} of ${capturedPhotos.length}`}
                        source={{ uri: photo.uri }}
                        style={styles.capturedViewImage}
                      />
                      <Text numberOfLines={1} style={styles.capturedViewCaption}>
                        {guidance.label}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}

          {captureMode === "multi" && capturedPhotos.length ? (
            <View style={styles.multiAngleActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove the last captured meal photo"
                onPress={removeLastMultiAnglePhoto}
                style={styles.multiAngleSecondaryAction}
              >
                <Text style={styles.multiAngleSecondaryText}>Retake last</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Review ${formatViewCount(capturedPhotos.length)} of the meal`}
                onPress={reviewMultiAngleDraft}
                style={styles.multiAnglePrimaryAction}
              >
                <Text style={styles.multiAnglePrimaryText}>Review {formatViewCount(capturedPhotos.length)}</Text>
                <Ionicons name="arrow-forward" size={16} color={colors.ink} />
              </Pressable>
            </View>
          ) : null}

          <View style={styles.captureRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Import a meal photo"
              accessibilityHint="Choose an existing meal photo for assisted review. You confirm every food and portion afterward."
              accessibilityState={{ disabled: isCapturing || isImporting || (captureMode === "multi" && capturedPhotos.length >= maximumMealViews) }}
              disabled={isCapturing || isImporting || (captureMode === "multi" && capturedPhotos.length >= maximumMealViews)}
              onPress={importPhoto}
              style={[styles.sideAction, isCapturing || isImporting || (captureMode === "multi" && capturedPhotos.length >= maximumMealViews) ? styles.sideActionDisabled : undefined]}
            >
              <Ionicons name="images-outline" size={21} color={colors.white} />
              <Text style={styles.sideActionText}>Import</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={captureMode === "multi" ? `Capture ${multiAngleGuidance.label.toLowerCase()}` : "Capture meal photo"}
              accessibilityHint="Captures a photo for an editable assisted meal review."
              accessibilityState={{ disabled: isCapturing || isImporting || (captureMode === "multi" && capturedPhotos.length >= maximumMealViews) }}
              disabled={isCapturing || isImporting || (captureMode === "multi" && capturedPhotos.length >= maximumMealViews)}
              onPress={capturePhoto}
              style={({ pressed }) => [
                styles.captureButton,
                pressed ? styles.capturePressed : undefined,
                isCapturing || isImporting || (captureMode === "multi" && capturedPhotos.length >= maximumMealViews) ? styles.captureDisabled : undefined,
              ]}
            >
              <View style={styles.captureInner} />
            </Pressable>
            <Link href="/barcode" asChild>
              <Pressable accessibilityRole="button" accessibilityLabel="Scan a packaged food barcode" style={styles.sideAction}>
                <Ionicons name="barcode-outline" size={22} color={colors.white} />
                <Text style={styles.sideActionText}>Barcode</Text>
              </Pressable>
            </Link>
          </View>
          {captureMode === "multi" ? (
            <Text accessibilityLiveRegion="polite" style={styles.captureCount}>
              {capturedPhotos.length >= maximumMealViews
                ? "Maximum three views captured. Review when ready."
                : `Capture ${multiAngleGuidance.label.toLowerCase()} ${capturedPhotos.length + 1} of ${maximumMealViews}.`}
            </Text>
          ) : null}
          <Link href="/manual-search" asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Enter food manually instead of using the camera"
              style={styles.manualRoute}
            >
              <Text style={styles.manualRouteText}>Enter food manually</Text>
              <Ionicons name="arrow-forward" size={16} color={colors.white} />
            </Pressable>
          </Link>
        </View>
      </SafeAreaView>
    </View>
  );
}

export function cameraThemeStyles(palette: ThemePalette) {
  return {
    permissionScreen: { backgroundColor: palette.background },
    permissionMark: { backgroundColor: palette.cardAccent },
    ink: { color: palette.ink },
    muted: { color: palette.muted },
    actionText: { color: palette.actionText },
  };
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.charcoal },
  cameraShade: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(5, 13, 9, 0.16)" },
  permissionScreen: { flex: 1, justifyContent: "center", padding: spacing.xxl, gap: spacing.md, backgroundColor: colors.background },
  permissionMark: { width: 64, height: 64, alignItems: "center", justifyContent: "center", borderRadius: radii.lg, backgroundColor: colors.limeSoft },
  permissionEyebrow: { ...typography.eyebrow, color: colors.green },
  permissionTitle: { ...typography.display, color: colors.ink },
  permissionBody: { ...typography.body, color: colors.muted },
  permissionSecondary: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  permissionSecondaryText: { ...typography.button, color: colors.green },
  overlay: { flex: 1, paddingHorizontal: spacing.lg, justifyContent: "space-between" },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: spacing.sm, gap: spacing.sm },
  topControl: { width: 46, height: 46, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, backgroundColor: "rgba(12, 23, 16, 0.54)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.26)" },
  scanModePill: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: spacing.xs, borderRadius: radii.pill, paddingHorizontal: spacing.md, backgroundColor: "rgba(12, 23, 16, 0.54)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.24)" },
  scanModeDot: { width: 7, height: 7, borderRadius: radii.pill, backgroundColor: colors.lime },
  scanModeText: { ...typography.caption, color: colors.white },
  topRightControls: { flexDirection: "row", gap: spacing.xs },
  frameArea: { position: "absolute", left: spacing.xl, right: spacing.xl, top: "25%", height: 300, alignItems: "center", justifyContent: "center" },
  focusHalo: { position: "absolute", width: 246, height: 246, borderRadius: 123, borderWidth: 1.5, borderColor: "rgba(193, 232, 107, 0.92)", shadowColor: colors.lime, shadowOpacity: 0.66, shadowRadius: 22 },
  frameCornerTopLeft: { position: "absolute", top: 6, left: 0, width: 55, height: 55, borderTopWidth: 3, borderLeftWidth: 3, borderColor: colors.lime, borderTopLeftRadius: radii.md },
  frameCornerTopRight: { position: "absolute", top: 6, right: 0, width: 55, height: 55, borderTopWidth: 3, borderRightWidth: 3, borderColor: colors.lime, borderTopRightRadius: radii.md },
  frameCornerBottomLeft: { position: "absolute", bottom: 6, left: 0, width: 55, height: 55, borderBottomWidth: 3, borderLeftWidth: 3, borderColor: colors.lime, borderBottomLeftRadius: radii.md },
  frameCornerBottomRight: { position: "absolute", bottom: 6, right: 0, width: 55, height: 55, borderBottomWidth: 3, borderRightWidth: 3, borderColor: colors.lime, borderBottomRightRadius: radii.md },
  frameCaption: { position: "absolute", bottom: -28, ...typography.caption, color: colors.white, textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 5 },
  bottomArea: { gap: spacing.md, paddingBottom: spacing.md },
  e2eFixtureAction: {
    alignSelf: "center",
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  e2eFixtureActionText: { ...typography.caption, color: colors.white },
  captureModeRow: { alignSelf: "center", flexDirection: "row", gap: spacing.xxs, padding: 3, borderRadius: radii.pill, backgroundColor: "rgba(8, 19, 13, 0.62)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.24)" },
  captureModeButton: { minHeight: 44, justifyContent: "center", borderRadius: radii.pill, paddingHorizontal: spacing.md },
  captureModeButtonActive: { backgroundColor: "rgba(232, 246, 194, 0.96)" },
  captureModeLabel: { ...typography.caption, color: "rgba(255,255,255,0.78)" },
  captureModeLabelActive: { color: colors.ink },
  plateReferencePanel: {
    gap: spacing.xs,
    borderRadius: radii.lg,
    padding: spacing.md,
    backgroundColor: "rgba(8, 19, 13, 0.60)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.24)",
  },
  plateReferenceHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  plateReferenceTitleRow: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  plateReferenceTitle: { ...typography.caption, color: colors.white },
  plateReferenceOptional: { ...typography.caption, color: "rgba(255,255,255,0.65)" },
  plateReferenceBody: { ...typography.caption, color: "rgba(255,255,255,0.78)", lineHeight: 18 },
  plateReferenceOptions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xxs },
  plateReferenceOption: {
    alignItems: "center",
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.30)",
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  plateReferenceOptionSelected: { backgroundColor: colors.lime, borderColor: colors.lime },
  plateReferenceOptionText: { ...typography.caption, color: colors.white },
  plateReferenceOptionTextSelected: { color: colors.ink },
  guidanceSurface: { overflow: "hidden", borderRadius: radii.lg, padding: spacing.md, gap: spacing.xs, borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.24)", backgroundColor: "rgba(11, 22, 16, 0.30)" },
  guidanceSurfaceOpaque: { backgroundColor: "rgba(11, 22, 16, 0.94)" },
  guidanceTitle: { ...typography.heading, color: colors.white },
  guidanceBody: { ...typography.caption, color: "rgba(255,255,255,0.84)" },
  capturedViewPanel: { gap: spacing.xs },
  capturedViewLabel: { ...typography.caption, color: "rgba(255,255,255,0.88)" },
  capturedViewRow: { flexDirection: "row", gap: spacing.sm },
  capturedViewItem: { flex: 1, gap: spacing.xxs },
  capturedViewImage: { width: "100%", aspectRatio: 1.2, borderRadius: radii.sm, backgroundColor: "rgba(255,255,255,0.15)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.32)" },
  capturedViewCaption: { ...typography.caption, color: colors.white },
  multiAngleActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  multiAngleSecondaryAction: { minHeight: 46, justifyContent: "center", borderRadius: radii.pill, paddingHorizontal: spacing.md, backgroundColor: "rgba(8, 19, 13, 0.64)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.28)" },
  multiAngleSecondaryText: { ...typography.caption, color: colors.white },
  multiAnglePrimaryAction: { flex: 1, minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, borderRadius: radii.pill, paddingHorizontal: spacing.md, backgroundColor: colors.lime },
  multiAnglePrimaryText: { ...typography.button, color: colors.ink },
  captureRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md },
  sideAction: { minWidth: 64, minHeight: 54, alignItems: "center", justifyContent: "center", gap: 3 },
  sideActionDisabled: { opacity: 0.4 },
  sideActionText: { ...typography.caption, color: colors.white },
  captureButton: { width: 82, height: 82, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, borderWidth: 3, borderColor: colors.white, backgroundColor: "rgba(255,255,255,0.18)", ...elevations.floating },
  captureInner: { width: 64, height: 64, borderRadius: radii.pill, backgroundColor: colors.white },
  capturePressed: { transform: [{ scale: 0.93 }], opacity: 0.9 },
  captureDisabled: { opacity: 0.45 },
  captureCount: { alignSelf: "center", ...typography.caption, color: "rgba(255,255,255,0.88)", textAlign: "center" },
  manualRoute: { minHeight: 44, flexDirection: "row", alignSelf: "center", alignItems: "center", gap: spacing.xs, borderRadius: radii.pill, paddingHorizontal: spacing.md, backgroundColor: "rgba(11, 22, 16, 0.44)" },
  manualRouteText: { ...typography.caption, color: colors.white },
});
