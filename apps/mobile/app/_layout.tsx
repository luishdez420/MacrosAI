import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Sentry from "@sentry/react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { View, StyleSheet } from "react-native";

import { FloatingTabs } from "../src/shared/components/FloatingTabs";
import { PrimaryTabSwipeNavigator } from "../src/shared/components/PrimaryTabSwipeNavigator";
import { ScrollNavigationProvider } from "../src/shared/components/ScrollNavigationContext";
import { ThemeProvider, useTheme } from "../src/shared/theme/ThemeProvider";
import { configureNotificationPresentation } from "../src/services/hydrationReminder";
import { ManagedAuthProvider } from "../src/features/auth/ClerkAuthGate";
import { env } from "../src/config/env";
import { configureMobileErrorReporting } from "../src/services/errorReporting";

configureMobileErrorReporting();

function RootLayout() {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ManagedAuthProvider>
            <ThemedRoot />
          </ManagedAuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

export default env.sentryDsn ? Sentry.wrap(RootLayout) : RootLayout;

function ThemedRoot() {
  const { palette } = useTheme();

  useEffect(() => {
    configureNotificationPresentation();
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: palette.background }]}>
      <StatusBar style={palette.statusBar} />
      <ScrollNavigationProvider>
        <PrimaryTabSwipeNavigator>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: {
                backgroundColor: palette.background,
              },
            }}
          />
        </PrimaryTabSwipeNavigator>
        <FloatingTabs />
      </ScrollNavigationProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
