import {
  adjacentPrimaryBrowseTab,
  floatingTabs,
  hiddenTabPaths,
  isFloatingTabActive,
  shouldSwitchPrimaryBrowseTab,
} from "../floatingTabsConfig";
import { nextFloatingTabCompactState } from "../ScrollNavigationContext";

describe("floating tabs configuration", () => {
  it("keeps Today as the logging hub tab", () => {
    const homeTab = floatingTabs[0];

    expect(homeTab).toMatchObject({
      href: "/",
      label: "Today",
      icon: "home",
    });
    expect(isFloatingTabActive(homeTab, "/manual-search")).toBe(true);
    expect(isFloatingTabActive(homeTab, "/natural-entry")).toBe(true);
    expect(isFloatingTabActive(homeTab, "/barcode")).toBe(true);
    expect(isFloatingTabActive(homeTab, "/meal-builder")).toBe(true);
    expect(isFloatingTabActive(homeTab, "/meal/meal_1")).toBe(true);
  });

  it("provides a dedicated library destination for saved food and provenance", () => {
    const libraryTab = floatingTabs.find((tab) => tab.href === "/saved-foods");

    expect(libraryTab).toMatchObject({ label: "Library", icon: "bookmark" });
    expect(libraryTab ? isFloatingTabActive(libraryTab, "/food/usda%3A173944") : false).toBe(true);
    expect(libraryTab ? isFloatingTabActive(libraryTab, "/recipes") : false).toBe(true);
    expect(floatingTabs).toHaveLength(5);
  });

  it("labels the graph route as Progress instead of Calendar", () => {
    const progressTab = floatingTabs.find((tab) => tab.href === "/calendar");

    expect(progressTab).toMatchObject({
      label: "Progress",
      icon: "analytics",
    });
    expect(floatingTabs.map((tab) => tab.label)).not.toContain("Calendar");
    expect(progressTab ? isFloatingTabActive(progressTab, "/calendar") : false).toBe(true);
  });

  it("hides tabs on full-screen capture routes", () => {
    expect(hiddenTabPaths.has("/camera")).toBe(true);
    expect(hiddenTabPaths.has("/label-scan")).toBe(true);
    expect(hiddenTabPaths.has("/manual-search")).toBe(false);
  });

  it("compacts navigation only after purposeful downward scroll and restores it promptly", () => {
    expect(nextFloatingTabCompactState({ compact: false, previousOffset: 44, offset: 70 })).toBe(false);
    expect(nextFloatingTabCompactState({ compact: false, previousOffset: 72, offset: 96 })).toBe(true);
    expect(nextFloatingTabCompactState({ compact: true, previousOffset: 96, offset: 85 })).toBe(false);
    expect(nextFloatingTabCompactState({ compact: true, previousOffset: 20, offset: 12 })).toBe(false);
  });

  it("moves deliberately between browsing tabs without making Scan a swipe destination", () => {
    expect(adjacentPrimaryBrowseTab("/", -90)).toBe("/calendar");
    expect(adjacentPrimaryBrowseTab("/calendar", 90)).toBe("/");
    expect(adjacentPrimaryBrowseTab("/calendar", -90)).toBe("/saved-foods");
    expect(adjacentPrimaryBrowseTab("/saved-foods", -90)).toBe("/profile");
    expect(adjacentPrimaryBrowseTab("/profile", -90)).toBeNull();
    expect(adjacentPrimaryBrowseTab("/camera", -90)).toBeNull();
  });

  it("requires a purposeful horizontal gesture before changing browse tabs", () => {
    expect(shouldSwitchPrimaryBrowseTab({ translationX: -20, translationY: 0 })).toBe(false);
    expect(shouldSwitchPrimaryBrowseTab({ translationX: -72, translationY: 10 })).toBe(true);
    expect(shouldSwitchPrimaryBrowseTab({ translationX: -40, translationY: 4, velocityX: -0.8 })).toBe(true);
    expect(shouldSwitchPrimaryBrowseTab({ translationX: -90, translationY: 100 })).toBe(false);
  });
});
