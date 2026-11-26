import type { StorageLike } from '../settings/preferencesStore';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedThemeMode = 'light' | 'dark';

export interface ThemePreferences {
  mode: ThemeMode;
  accentHex: string;
}

export interface AccentPreset {
  id: string;
  label: string;
  hex: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'vermilion', label: '战术朱红', hex: '#E85D3F' },
  { id: 'cobalt', label: '星际钴蓝', hex: '#2563EB' },
  { id: 'emerald', label: '翡翠战术', hex: '#10B981' },
  { id: 'amber', label: '琥珀熔金', hex: '#D97706' },
  { id: 'violet', label: '深邃紫晶', hex: '#8B5CF6' },
  { id: 'teal', label: '海青战术', hex: '#0891B2' },
];

export const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
  mode: 'system',
  accentHex: ACCENT_PRESETS[0].hex,
};

const STORAGE_KEY_THEME = 'local_arena_theme_v1';

/**
 * 校验并标准化 `#RRGGBB` 十六进制色值；非法输入安全回退默认强调色。
 */
export function normalizeHexColor(
  raw: string | undefined | null,
  fallback = DEFAULT_THEME_PREFERENCES.accentHex
): string {
  if (!raw || typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  const fullMatch = /^#([0-9a-fA-F]{6})$/.exec(trimmed);
  if (fullMatch) {
    return `#${fullMatch[1].toUpperCase()}`;
  }
  const shortMatch = /^#([0-9a-fA-F]{3})$/.exec(trimmed);
  if (shortMatch) {
    const [r, g, b] = shortMatch[1].toUpperCase().split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return fallback;
}

function parseRgb(hex: string): [number, number, number] {
  const safe = normalizeHexColor(hex);
  const r = parseInt(safe.slice(1, 3), 16);
  const g = parseInt(safe.slice(3, 5), 16);
  const b = parseInt(safe.slice(5, 7), 16);
  return [r, g, b];
}

/**
 * 按 WCAG 2.1 相对亮度计算强调色上的高对比前景色（纯白或深炭黑），
 * 确保任意用户自选强调色在按钮与高亮标签上均满足清晰可读性。
 */
export function computeContrastForeground(hex: string): '#FFFFFF' | '#111827' {
  const [r, g, b] = parseRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.42 ? '#111827' : '#FFFFFF';
}

/**
 * 根据当前浅/深色模式自动派生强调色悬停态。
 */
export function computeAccentHoverHex(hex: string, resolvedMode: ResolvedThemeMode): string {
  const [r, g, b] = parseRgb(hex);
  const shift = resolvedMode === 'dark' ? 18 : -20;
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n + shift)));
  const toHex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(clamp(r))}${toHex(clamp(g))}${toHex(clamp(b))}`;
}

export function resolveEffectiveThemeMode(
  mode: ThemeMode,
  systemPrefersDark: boolean
): ResolvedThemeMode {
  if (mode === 'light') return 'light';
  if (mode === 'dark') return 'dark';
  return systemPrefersDark ? 'dark' : 'light';
}

export function loadThemePreferences(customStorage?: StorageLike): ThemePreferences {
  const storage =
    customStorage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
  if (!storage) return { ...DEFAULT_THEME_PREFERENCES };

  try {
    const raw = storage.getItem(STORAGE_KEY_THEME);
    if (!raw) return { ...DEFAULT_THEME_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<ThemePreferences>;
    const mode: ThemeMode =
      parsed.mode === 'light' || parsed.mode === 'dark' || parsed.mode === 'system'
        ? parsed.mode
        : DEFAULT_THEME_PREFERENCES.mode;
    const accentHex = normalizeHexColor(parsed.accentHex, DEFAULT_THEME_PREFERENCES.accentHex);
    return { mode, accentHex };
  } catch {
    return { ...DEFAULT_THEME_PREFERENCES };
  }
}

export function saveThemePreferences(
  prefs: ThemePreferences,
  customStorage?: StorageLike
): void {
  const storage =
    customStorage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
  if (!storage) return;
  try {
    storage.setItem(
      STORAGE_KEY_THEME,
      JSON.stringify({
        mode: prefs.mode,
        accentHex: normalizeHexColor(prefs.accentHex),
      })
    );
  } catch {
    // 忽略隐私模式或配额限制
  }
}

/**
 * 将主题状态直接写入 `<html class="dark|light" data-theme="...">` 与 HeroUI v3 CSS 变量，
 * 做到零 Provider 开销、全局原子同步且不闪烁。
 */
export function applyThemeToDocument(
  resolvedMode: ResolvedThemeMode,
  accentHex: string
): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const safeAccent = normalizeHexColor(accentHex);
  const fg = computeContrastForeground(safeAccent);
  const hover = computeAccentHoverHex(safeAccent, resolvedMode);

  root.classList.remove('light', 'dark');
  root.classList.add(resolvedMode);
  root.setAttribute('data-theme', resolvedMode);
  root.style.colorScheme = resolvedMode;

  root.style.setProperty('--accent', safeAccent);
  root.style.setProperty('--accent-foreground', fg);
  root.style.setProperty('--accent-hover', hover);
  root.style.setProperty('--focus', safeAccent);
}
