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
    label: "Today",
    icon: "home",
    matches: ["/", "/manual-search", "/natural-entry", "/barcode", "/custom-food", "/meal-builder", "/nutrients"],
    prefixes: ["/meal/"],
  },
  { href: "/calendar", label: "Progress", icon: "analytics", matches: ["/calendar"] },
  { href: "/camera", label: "Scan", icon: "scan", matches: ["/camera", "/confirm-meal", "/label-scan"] },
  { href: "/saved-foods", label: "Library", icon: "bookmark", matches: ["/saved-foods", "/recipes"], prefixes: ["/food/"] },
  { href: "/profile", label: "Profile", icon: "person-circle", matches: ["/profile", "/data-controls"] },
];

/** Browse destinations support horizontal page switching; Scan remains an intentional action. */
export const primaryBrowseTabHrefs = ["/", "/calendar", "/saved-foods", "/profile"] as const;

export type PrimaryBrowseTabHref = (typeof primaryBrowseTabHrefs)[number];

export const hiddenTabPaths = new Set(["/camera", "/label-scan", "/onboarding"]);

export function isFloatingTabActive(tab: FloatingTabConfig, pathname: string) {
  return tab.matches.includes(pathname) || Boolean(tab.prefixes?.some((prefix) => pathname.startsWith(prefix)));
}

export function isPrimaryBrowseTab(pathname: string): pathname is PrimaryBrowseTabHref {
  return primaryBrowseTabHrefs.includes(pathname as PrimaryBrowseTabHref);
}

export function adjacentPrimaryBrowseTab(pathname: string, translationX: number): PrimaryBrowseTabHref | null {
  if (!isPrimaryBrowseTab(pathname) || translationX === 0) {
    return null;
  }

  const currentIndex = primaryBrowseTabHrefs.indexOf(pathname);
  const nextIndex = currentIndex + (translationX < 0 ? 1 : -1);
  return primaryBrowseTabHrefs[nextIndex] ?? null;
}

export function shouldSwitchPrimaryBrowseTab({
  translationX,
  translationY,
  velocityX = 0,
}: {
  translationX: number;
  translationY: number;
  velocityX?: number;
}) {
  const horizontalDistance = Math.abs(translationX);
  const verticalDistance = Math.abs(translationY);
  const isHorizontalGesture = horizontalDistance > verticalDistance * 1.35;
  const hasDeliberateDistance = horizontalDistance >= 72;
  const hasDeliberateVelocity = horizontalDistance >= 24 && Math.abs(velocityX) >= 0.7;

  return isHorizontalGesture && (hasDeliberateDistance || hasDeliberateVelocity);
}
