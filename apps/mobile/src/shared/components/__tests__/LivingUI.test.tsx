import { fireEvent, render } from "@testing-library/react-native";
import { StyleSheet, View } from "react-native";

import { themePalettes } from "@living-nutrition/design-tokens";
import { ActionButton, formatMacroValue, MacroStatTile, ScreenShell, shouldRevealSwipeAction } from "../LivingUI";
import { ThemeProvider } from "../../theme/ThemeProvider";

const mockImpactAsync = jest.fn<Promise<void>, [unknown]>(() => Promise.resolve());
const mockSelectionAsync = jest.fn(() => Promise.resolve());

jest.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: {
    Light: "light",
    Medium: "medium",
  },
  impactAsync: (style: unknown) => mockImpactAsync(style),
  selectionAsync: () => mockSelectionAsync(),
}));

describe("ActionButton", () => {
  beforeEach(() => {
    mockImpactAsync.mockClear();
    mockSelectionAsync.mockClear();
  });

  it("uses a non-blocking light haptic before invoking an enabled primary action", async () => {
    const onPress = jest.fn();
    const view = await render(
      <ThemeProvider initialPreference="light">
        <ActionButton label="Save meal" onPress={onPress} />
      </ThemeProvider>
    );

    fireEvent.press(view.getByLabelText("Save meal"));

    expect(mockImpactAsync).toHaveBeenCalledWith("light");
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("leaves disabled actions silent", async () => {
    const onPress = jest.fn();
    const view = await render(
      <ThemeProvider initialPreference="light">
        <ActionButton label="Save meal" onPress={onPress} disabled />
      </ThemeProvider>
    );

    fireEvent.press(view.getByLabelText("Save meal"));

    expect(mockImpactAsync).not.toHaveBeenCalled();
    expect(mockSelectionAsync).not.toHaveBeenCalled();
    expect(onPress).not.toHaveBeenCalled();
  });

  it("uses the semantic destructive palette for danger actions", async () => {
    const view = await render(
      <ThemeProvider initialPreference="dark">
        <ActionButton label="Remove recipe" variant="danger" />
      </ThemeProvider>
    );

    expect(StyleSheet.flatten(view.getByLabelText("Remove recipe").props.style).backgroundColor).toBe(
      themePalettes.dark.dangerSurface
    );
    expect(StyleSheet.flatten(view.getByText("Remove recipe").props.style).color).toBe(
      themePalettes.dark.dangerText
    );
  });

  it("keeps shared screen content readable on tablet-width layouts", async () => {
    const view = await render(
      <ThemeProvider initialPreference="light">
        <ScreenShell testID="responsive-shell">
          <View testID="responsive-child" />
        </ScreenShell>
      </ThemeProvider>
    );

    expect(StyleSheet.flatten(view.getByTestId("responsive-shell-content").props.style)).toMatchObject({
      width: "100%",
      maxWidth: 720,
      alignSelf: "center",
    });
  });

  it("requires a deliberate left swipe before revealing a destructive action", () => {
    expect(shouldRevealSwipeAction(-24)).toBe(false);
    expect(shouldRevealSwipeAction(-56)).toBe(true);
    expect(shouldRevealSwipeAction(-10, -0.7)).toBe(true);
    expect(shouldRevealSwipeAction(56)).toBe(false);
  });

  it("keeps macro values and their units together while preserving readable word suffixes", async () => {
    const view = await render(
      <ThemeProvider initialPreference="light">
        <MacroStatTile label="Protein days" value={5} suffix="days" tone="protein" />
      </ThemeProvider>
    );

    const value = view.getByText("5 days");
    expect(value.props.numberOfLines).toBe(1);
    expect(value.props.adjustsFontSizeToFit).toBeUndefined();
    expect(formatMacroValue(128, "g")).toBe("128g");
    expect(formatMacroValue(2, "/7")).toBe("2/7");
  });
});
