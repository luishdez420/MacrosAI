import { spacing } from "@living-nutrition/design-tokens";

import { floatingActionBottomOffset, stickyLogBottomOffset } from "../manualSearchLayout";

describe("manual search layout helpers", () => {
  it("keeps the sticky log action above the floating tabs when the keyboard is hidden", () => {
    expect(stickyLogBottomOffset({ safeAreaBottom: 34, keyboardBottomInset: 0 })).toBe(126);
  });

  it("uses keyboard clearance without also adding tab clearance when the keyboard is visible", () => {
    expect(stickyLogBottomOffset({ safeAreaBottom: 34, keyboardBottomInset: 336 })).toBe(
      336 + spacing.sm
    );
  });

  it("shares the same safe offset with other floating meal actions", () => {
    expect(floatingActionBottomOffset({ safeAreaBottom: 0, keyboardBottomInset: 0 })).toBe(
      spacing.sm + 92
    );
  });
});
