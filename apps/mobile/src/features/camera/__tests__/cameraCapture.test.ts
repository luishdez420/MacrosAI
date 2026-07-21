import {
  appendMealView,
  formatViewCount,
  maximumMealViews,
  mealCaptureGuidance,
  nextMealCaptureAngle,
} from "../cameraCapture";
import { themePalettes } from "@living-nutrition/design-tokens";
import { cameraThemeStyles } from "../CameraScreen";

const view = (uri: string) => ({ uri, base64: "base64-image", source: "camera" as const });

describe("multi-angle meal capture helpers", () => {
  it("guides capture from angled to top-down to side views", () => {
    expect(nextMealCaptureAngle(0)).toBe("angled");
    expect(mealCaptureGuidance(1)).toMatchObject({ label: "Top-down view" });
    expect(mealCaptureGuidance(2)).toMatchObject({ label: "Side view" });
  });

  it("never stores more than three complementary meal views", () => {
    const photos = [view("file://one"), view("file://two"), view("file://three")];
    const result = appendMealView(photos, view("file://four"));

    expect(maximumMealViews).toBe(3);
    expect(result).toEqual(photos);
  });

  it("formats review copy without implying precision", () => {
    expect(formatViewCount(1)).toBe("1 view");
    expect(formatViewCount(2)).toBe("2 views");
  });

  it("uses the semantic action color for camera permission actions in dark mode", () => {
    expect(cameraThemeStyles(themePalettes.dark).actionText).toEqual({
      color: themePalettes.dark.actionText,
    });
  });
});
