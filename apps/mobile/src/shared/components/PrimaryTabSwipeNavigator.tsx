import * as Haptics from "expo-haptics";
import { usePathname, useRouter } from "expo-router";
import { useMemo, type PropsWithChildren } from "react";
import { PanResponder, StyleSheet, View } from "react-native";

import {
  adjacentPrimaryBrowseTab,
  isPrimaryBrowseTab,
  shouldSwitchPrimaryBrowseTab,
} from "./floatingTabsConfig";

/** Lets browse destinations behave like pages without making camera capture a swipe target. */
export function PrimaryTabSwipeNavigator({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const router = useRouter();

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) => {
          if (!isPrimaryBrowseTab(pathname)) {
            return false;
          }

          return (
            Math.abs(gesture.dx) > 14 &&
            Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.35 &&
            adjacentPrimaryBrowseTab(pathname, gesture.dx) !== null
          );
        },
        onPanResponderRelease: (_event, gesture) => {
          const destination = adjacentPrimaryBrowseTab(pathname, gesture.dx);

          if (
            destination &&
            shouldSwitchPrimaryBrowseTab({
              translationX: gesture.dx,
              translationY: gesture.dy,
              velocityX: gesture.vx,
            })
          ) {
            void Haptics.selectionAsync().catch(() => undefined);
            router.replace(destination);
          }
        },
      }),
    [pathname, router]
  );

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
