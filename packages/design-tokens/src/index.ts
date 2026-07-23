/**
 * Living Nutrition's shared visual language. Components should consume these
 * values instead of introducing screen-specific colors or geometry.
 */
export const colors = {
  background: "#F2F5EE",
  backgroundDeep: "#E5EDE0",
  backgroundWarm: "#FAF8F1",
  surface: "#FFFFFF",
  surfaceAlt: "#E6EFDE",
  surfaceMuted: "#D8E6D0",
  ink: "#14251D",
  inkSoft: "#25382E",
  muted: "#64746A",
  mutedSoft: "#8A998F",
  green: "#1C7453",
  greenDeep: "#12563D",
  lime: "#B8DE59",
  limeSoft: "#E6F2C9",
  coral: "#D46B58",
  coralSoft: "#F7E2DE",
  protein: "#7352A3",
  proteinSoft: "#EAE2F5",
  carbs: "#D69B25",
  carbsSoft: "#F8ECD0",
  fat: "#CB6473",
  fatSoft: "#F8E0E5",
  fiber: "#3E8B63",
  insight: "#5379A6",
  insightSoft: "#E1EAF5",
  white: "#FFFFFF",
  charcoal: "#131914",
  darkSurface: "#1B241E",
  darkSurfaceAlt: "#253229",
  darkMuted: "#A9B8AC",
  darkInk: "#F2F7EF",
};

export const glass = {
  navigation: "rgba(250, 253, 247, 0.72)",
  content: "rgba(255, 255, 255, 0.76)",
  utility: "rgba(255, 255, 255, 0.62)",
  darkNavigation: "rgba(22, 31, 25, 0.76)",
  darkContent: "rgba(28, 38, 31, 0.80)",
  border: "rgba(255, 255, 255, 0.70)",
  darkBorder: "rgba(255, 255, 255, 0.13)",
  highlight: "rgba(255, 255, 255, 0.52)",
  backdrop: "rgba(20, 37, 29, 0.16)",
  blur: {
    navigation: 52,
    content: 28,
    utility: 14,
  },
};

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  giant: 48,
};

export const radii = {
  xs: 10,
  sm: 14,
  md: 18,
  lg: 24,
  xl: 30,
  hero: 34,
  pill: 999,
};

export const elevations = {
  navigation: {
    shadowColor: "#223227",
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  content: {
    shadowColor: "#223227",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 9 },
    elevation: 5,
  },
  floating: {
    shadowColor: "#0A1A11",
    shadowOpacity: 0.24,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
};

export const typography = {
  display: {
    fontSize: 34,
    lineHeight: 39,
    fontWeight: "800" as const,
    letterSpacing: -0.8,
  },
  displayLarge: {
    fontSize: 48,
    lineHeight: 53,
    fontWeight: "800" as const,
    letterSpacing: -1.4,
  },
  heading: {
    fontSize: 19,
    lineHeight: 25,
    fontWeight: "700" as const,
    letterSpacing: -0.2,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "500" as const,
  },
  caption: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600" as const,
  },
  eyebrow: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800" as const,
    letterSpacing: 1.15,
    textTransform: "uppercase" as const,
  },
  stat: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: "800" as const,
    letterSpacing: -0.7,
  },
  button: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800" as const,
  },
};

export const motion = {
  tap: 130,
  control: 210,
  reveal: 320,
  spring: {
    damping: 18,
    stiffness: 190,
    mass: 0.8,
  },
};

export const haptics = {
  selection: "selection",
  capture: "medium",
  success: "success",
  warning: "warning",
} as const;

export const themes = {
  light: {
    background: colors.background,
    surface: colors.surface,
    ink: colors.ink,
    muted: colors.muted,
    glass: glass.content,
  },
  dark: {
    background: colors.charcoal,
    surface: colors.darkSurface,
    ink: colors.darkInk,
    muted: colors.darkMuted,
    glass: glass.darkContent,
  },
} as const;

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = Exclude<ThemePreference, "system">;

/**
 * Semantic colors are intentionally separate from brand and macro colors. They
 * let the app switch material, copy, and atmospheric colors without changing
 * nutrition meaning (protein, carbohydrate, fat, and fiber stay consistent).
 */
export type ThemePalette = {
  mode: ResolvedTheme;
  statusBar: "dark" | "light";
  background: string;
  backgroundWarm: string;
  backgroundDeep: string;
  surface: string;
  surfaceAlt: string;
  surfaceMuted: string;
  ink: string;
  inkSoft: string;
  muted: string;
  mutedSoft: string;
  navigationGlass: string;
  contentGlass: string;
  utilityGlass: string;
  border: string;
  highlight: string;
  backdrop: string;
  orbPrimary: string;
  orbSecondary: string;
  cardSoft: string;
  cardAccent: string;
  cardInsight: string;
  controlSurface: string;
  controlSurfaceMuted: string;
  progressTrack: string;
  overlay: string;
  onPrimary: string;
  iconOnDark: string;
  actionText: string;
  warningText: string;
  dangerText: string;
  dangerSurface: string;
};

export const themePalettes: Record<ResolvedTheme, ThemePalette> = {
  light: {
    mode: "light",
    statusBar: "dark",
    background: colors.background,
    backgroundWarm: colors.backgroundWarm,
    backgroundDeep: colors.backgroundDeep,
    surface: colors.surface,
    surfaceAlt: colors.surfaceAlt,
    surfaceMuted: colors.surfaceMuted,
    ink: colors.ink,
    inkSoft: colors.inkSoft,
    muted: colors.muted,
    mutedSoft: colors.mutedSoft,
    navigationGlass: glass.navigation,
    contentGlass: glass.content,
    utilityGlass: glass.utility,
    border: glass.border,
    highlight: glass.highlight,
    backdrop: glass.backdrop,
    orbPrimary: colors.limeSoft,
    orbSecondary: colors.insightSoft,
    cardSoft: "rgba(245, 249, 241, 0.82)",
    cardAccent: "rgba(232, 245, 194, 0.86)",
    cardInsight: "rgba(229, 237, 248, 0.84)",
    // Controls need a distinct fill in light mode. Pure translucent white
    // disappears into the page and makes inputs and secondary actions easy to miss.
    controlSurface: "#EAF2E4",
    controlSurfaceMuted: "#DCEAD4",
    progressTrack: "rgba(20, 37, 29, 0.10)",
    overlay: "rgba(20, 37, 29, 0.16)",
    onPrimary: colors.white,
    iconOnDark: colors.white,
    actionText: colors.green,
    warningText: "#926512",
    dangerText: colors.coral,
    dangerSurface: "#F8E3DC",
  },
  dark: {
    mode: "dark",
    statusBar: "light",
    background: "#111814",
    backgroundWarm: "#17211B",
    backgroundDeep: "#0B100D",
    surface: "#1B241E",
    surfaceAlt: "#26332A",
    surfaceMuted: "#314235",
    ink: "#F2F7EF",
    inkSoft: "#D5E0D5",
    muted: "#A9B8AC",
    mutedSoft: "#78867B",
    navigationGlass: glass.darkNavigation,
    contentGlass: glass.darkContent,
    utilityGlass: "rgba(40, 53, 44, 0.76)",
    border: glass.darkBorder,
    highlight: "rgba(255, 255, 255, 0.13)",
    backdrop: "rgba(2, 6, 3, 0.42)",
    orbPrimary: "#304525",
    orbSecondary: "#1A3043",
    cardSoft: "rgba(35, 47, 39, 0.88)",
    cardAccent: "rgba(50, 72, 35, 0.88)",
    cardInsight: "rgba(34, 52, 72, 0.88)",
    controlSurface: "rgba(44, 58, 48, 0.86)",
    controlSurfaceMuted: "rgba(52, 69, 57, 0.92)",
    progressTrack: "rgba(239, 248, 238, 0.16)",
    overlay: "rgba(0, 0, 0, 0.40)",
    onPrimary: "#F8FCF5",
    iconOnDark: "#F8FCF5",
    actionText: "#A8D47E",
    warningText: "#F3C65A",
    dangerText: "#FFA193",
    dangerSurface: "rgba(167, 79, 73, 0.28)",
  },
};
