export type FloatingTabConfig = {
  href: string;
  label: string;
  icon: string;
  matches: string[];
  prefixes?: string[];
};

export const floatingTabs: FloatingTabConfig[] = [
  {
    href: "/",
    label: "Home",
    icon: "home",
    matches: ["/", "/manual-search", "/natural-entry", "/barcode", "/custom-food", "/saved-foods"],
    prefixes: ["/food/", "/meal/"],
  },
  { href: "/calendar", label: "Progress", icon: "analytics", matches: ["/calendar"] },
  { href: "/camera", label: "Scan", icon: "scan-circle", matches: ["/camera", "/confirm-meal", "/label-scan"] },
  { href: "/profile", label: "Profile", icon: "person-circle", matches: ["/profile"] },
];

export const hiddenTabPaths = new Set(["/camera", "/label-scan"]);

export function isFloatingTabActive(tab: FloatingTabConfig, pathname: string) {
  return tab.matches.includes(pathname) || Boolean(tab.prefixes?.some((prefix) => pathname.startsWith(prefix)));
}
