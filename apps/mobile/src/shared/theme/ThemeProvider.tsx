import * as SecureStore from "expo-secure-store";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from "react";
import { useColorScheme } from "react-native";

import {
  themePalettes,
  type ResolvedTheme,
  type ThemePalette,
  type ThemePreference,
} from "@living-nutrition/design-tokens";

const themePreferenceKey = "living-nutrition.theme-preference.v1";

type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  palette: ThemePalette;
  setThemePreference: (preference: ThemePreference) => Promise<void>;
};

function resolveTheme(preference: ThemePreference, systemScheme: "light" | "dark" | null | undefined): ResolvedTheme {
  if (preference === "system") {
    return systemScheme === "dark" ? "dark" : "light";
  }

  return preference;
}

const defaultTheme = resolveTheme("system", "light");
const ThemeContext = createContext<ThemeContextValue>({
  preference: "system",
  resolvedTheme: defaultTheme,
  palette: themePalettes[defaultTheme],
  setThemePreference: async () => undefined,
});

type ThemeProviderProps = PropsWithChildren<{
  initialPreference?: ThemePreference;
}>;

export function ThemeProvider({ children, initialPreference = "system" }: ThemeProviderProps) {
  const systemScheme = useColorScheme();
  const [preference, setPreference] = useState<ThemePreference>(initialPreference);

  useEffect(() => {
    let active = true;

    void SecureStore.getItemAsync(themePreferenceKey)
      .then((stored) => {
        if (active && isThemePreference(stored)) {
          setPreference(stored);
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  const setThemePreference = useCallback(async (nextPreference: ThemePreference) => {
    setPreference(nextPreference);
    try {
      await SecureStore.setItemAsync(themePreferenceKey, nextPreference);
    } catch {
      // The current session still honors the user's choice if secure local storage is unavailable.
    }
  }, []);
  const resolvedTheme = resolveTheme(preference, systemScheme);
  const value: ThemeContextValue = {
    preference,
    resolvedTheme,
    palette: themePalettes[resolvedTheme],
    setThemePreference,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}
