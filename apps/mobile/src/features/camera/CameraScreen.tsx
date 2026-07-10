import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { Link, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, radii, spacing, typography } from "@living-nutrition/design-tokens";
import { useAnalysisDraftStore } from "../../stores/analysisDraftStore";

export function CameraScreen() {
  const cameraRef = useRef<CameraView>(null);
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<"back" | "front">("back");
  const [reducedMotion, setReducedMotion] = useState(false);
  const scanPulse = useRef(new Animated.Value(0.75)).current;
  const setDraftPhoto = useAnalysisDraftStore((store) => store.setDraftPhoto);

  useEffect(() => {
    let isMounted = true;
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReducedMotion
    );

    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (isMounted) {
        setReducedMotion(enabled);
      }
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      scanPulse.setValue(0.75);
      return undefined;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scanPulse, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scanPulse, {
          toValue: 0.35,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();

    return () => {
      animation.stop();
    };
  }, [reducedMotion, scanPulse]);

  async function capturePhoto() {
    try {
      const photo = await cameraRef.current?.takePictureAsync({
        base64: true,
        quality: 0.78,
        skipProcessing: false,
      });

      if (!photo?.uri) {
        Alert.alert("Photo unavailable", "Try taking the meal photo again.");
        return;
      }

      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      setDraftPhoto({
        uri: photo.uri,
        base64: photo.base64,
        source: "camera",
      });
      router.push("/confirm-meal");
    } catch (error) {
      Alert.alert("Camera capture failed", "Try again, or import a meal photo from your library.");
    }
  }

  async function importPhoto() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        base64: true,
        quality: 0.8,
      });

      if (result.canceled || !result.assets[0]) {
        return;
      }

      setDraftPhoto({
        uri: result.assets[0].uri,
        base64: result.assets[0].base64,
        source: "library",
      });
      router.push("/confirm-meal");
    } catch {
      Alert.alert("Import failed", "Try another photo or use the camera.");
    }
  }

  if (!permission) {
    return <View style={styles.screen} />;
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.permissionScreen}>
        <Text style={styles.title}>Camera assist needs permission.</Text>
        <Text style={styles.body}>
          Meal photos are analyzed on demand. Results are estimates and work best after you confirm
          the visible foods and portion.
        </Text>
        <Pressable style={styles.primaryButton} onPress={requestPermission}>
          <Text style={styles.primaryButtonText}>Enable camera</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.screen}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
      />
      <SafeAreaView style={styles.overlay}>
        <View style={styles.topBar}>
          <Link href="/" asChild>
            <Pressable style={styles.roundButton}>
              <Text style={styles.roundButtonText}>Close</Text>
            </Pressable>
          </Link>
          <Link href="/barcode" asChild>
            <Pressable style={styles.roundButton}>
              <Text style={styles.roundButtonText}>Barcode</Text>
            </Pressable>
          </Link>
          <Pressable
            style={styles.roundButton}
            onPress={() => setFacing((current) => (current === "back" ? "front" : "back"))}
          >
            <Text style={styles.roundButtonText}>Flip</Text>
          </Pressable>
        </View>

        <View style={styles.guidance}>
          <Text style={styles.guidanceTitle}>Keep the whole plate visible</Text>
          <Text style={styles.guidanceText}>
            A clear top-down or 45 degree photo helps us identify foods and estimate the serving.
          </Text>
        </View>

        <Animated.View style={[styles.scanFrame, { opacity: scanPulse }]} />

        <View style={styles.bottomBar}>
          <Pressable style={styles.secondaryButton} onPress={importPhoto}>
            <Text style={styles.secondaryButtonText}>Import</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Capture meal photo"
            style={styles.captureButton}
            onPress={capturePhoto}
          >
            <View style={styles.captureInner} />
          </Pressable>
          <Link href="/manual-search" asChild>
            <Pressable style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Manual</Text>
            </Pressable>
          </Link>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ink,
  },
  permissionScreen: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.background,
  },
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
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(12, 24, 20, 0.58)",
  },
  roundButtonText: {
    ...typography.caption,
    color: colors.white,
  },
  guidance: {
    marginTop: "auto",
    marginBottom: spacing.xl,
    gap: spacing.xs,
  },
  guidanceTitle: {
    ...typography.heading,
    color: colors.white,
  },
  guidanceText: {
    ...typography.body,
    color: colors.white,
    maxWidth: 300,
  },
  scanFrame: {
    position: "absolute",
    left: spacing.xl,
    right: spacing.xl,
    top: "28%",
    height: 270,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.lime,
    shadowColor: colors.lime,
    shadowOpacity: 0.7,
    shadowRadius: 18,
  },
  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  captureButton: {
    width: 82,
    height: 82,
    borderRadius: 41,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.18)",
  },
  captureInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.white,
  },
  secondaryButton: {
    minWidth: 92,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: "rgba(255, 255, 255, 0.86)",
  },
  secondaryButtonText: {
    ...typography.caption,
    color: colors.ink,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: radii.md,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    ...typography.button,
    color: colors.white,
  },
  title: {
    ...typography.display,
    color: colors.ink,
  },
  body: {
    ...typography.body,
    color: colors.muted,
  },
});
