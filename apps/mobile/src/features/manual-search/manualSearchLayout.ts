import { spacing } from "@living-nutrition/design-tokens";

const floatingTabsClearance = 92;

export function floatingActionBottomOffset({
  safeAreaBottom,
  keyboardBottomInset,
}: {
  safeAreaBottom: number;
  keyboardBottomInset: number;
}) {
  if (keyboardBottomInset > 0) {
    return keyboardBottomInset + spacing.sm;
  }

  return Math.max(safeAreaBottom, spacing.sm) + floatingTabsClearance;
}

export function stickyLogBottomOffset({
  safeAreaBottom,
  keyboardBottomInset,
}: {
  safeAreaBottom: number;
  keyboardBottomInset: number;
}) {
  return floatingActionBottomOffset({ safeAreaBottom, keyboardBottomInset });
}
