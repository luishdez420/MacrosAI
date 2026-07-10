import { floatingTabs, hiddenTabPaths, isFloatingTabActive } from "../floatingTabsConfig";

describe("floating tabs configuration", () => {
  it("keeps Home as the logging hub tab", () => {
    const homeTab = floatingTabs[0];

    expect(homeTab).toMatchObject({
      href: "/",
      label: "Home",
      icon: "home",
    });
    expect(isFloatingTabActive(homeTab, "/manual-search")).toBe(true);
    expect(isFloatingTabActive(homeTab, "/natural-entry")).toBe(true);
    expect(isFloatingTabActive(homeTab, "/barcode")).toBe(true);
    expect(isFloatingTabActive(homeTab, "/food/usda%3A173944")).toBe(true);
    expect(isFloatingTabActive(homeTab, "/meal/meal_1")).toBe(true);
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
});
