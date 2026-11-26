import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ACCENT_PRESETS,
  DEFAULT_THEME_PREFERENCES,
  applyThemeToDocument,
  loadThemePreferences,
  normalizeHexColor,
  resolveEffectiveThemeMode,
  saveThemePreferences,
  type ResolvedThemeMode,
  type ThemeMode,
  type ThemePreferences,
} from './themeStore';

export interface ThemeContextValue {
  mode: ThemeMode;
  resolvedMode: ResolvedThemeMode;
  accentHex: string;
  setMode: (mode: ThemeMode) => void;
  setAccentHex: (hex: string) => void;
  toggleLightDark: () => void;
  resetTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: DEFAULT_THEME_PREFERENCES.mode,
  resolvedMode: 'light',
  accentHex: ACCENT_PRESETS[0].hex,
  setMode: () => {},
  setAccentHex: () => {},
  toggleLightDark: () => {},
  resetTheme: () => {},
});

function readSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<ThemePreferences>(() => loadThemePreferences());
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(readSystemPrefersDark);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolvedMode = resolveEffectiveThemeMode(prefs.mode, systemPrefersDark);

  useLayoutEffect(() => {
    applyThemeToDocument(resolvedMode, prefs.accentHex);
  }, [resolvedMode, prefs.accentHex]);

  const setMode = useCallback((mode: ThemeMode) => {
    setPrefs((prev) => {
      const next = { ...prev, mode };
      saveThemePreferences(next);
      return next;
    });
  }, []);

  const setAccentHex = useCallback((hex: string) => {
    const safe = normalizeHexColor(hex);
    setPrefs((prev) => {
      const next = { ...prev, accentHex: safe };
      saveThemePreferences(next);
      return next;
    });
  }, []);

  const toggleLightDark = useCallback(() => {
    setPrefs((prev) => {
      const curResolved = resolveEffectiveThemeMode(prev.mode, readSystemPrefersDark());
      const nextMode: ThemeMode = curResolved === 'dark' ? 'light' : 'dark';
      const next = { ...prev, mode: nextMode };
      saveThemePreferences(next);
      return next;
    });
  }, []);

  const resetTheme = useCallback(() => {
    const next = { ...DEFAULT_THEME_PREFERENCES };
    setPrefs(next);
    saveThemePreferences(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode: prefs.mode,
      resolvedMode,
      accentHex: prefs.accentHex,
      setMode,
      setAccentHex,
      toggleLightDark,
      resetTheme,
    }),
    [prefs.mode, prefs.accentHex, resolvedMode, setMode, setAccentHex, toggleLightDark, resetTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
