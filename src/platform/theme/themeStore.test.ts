import assert from 'node:assert/strict';
import test from 'node:test';
import type { StorageLike } from '../settings/preferencesStore';
import {
  ACCENT_PRESETS,
  computeAccentHoverHex,
  computeContrastForeground,
  DEFAULT_THEME_PREFERENCES,
  loadThemePreferences,
  normalizeHexColor,
  resolveEffectiveThemeMode,
  saveThemePreferences,
} from './themeStore';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

test('normalizeHexColor 标准化合法 6 位与 3 位色值并回退非法输入', () => {
  assert.equal(normalizeHexColor('#2563eb'), '#2563EB');
  assert.equal(normalizeHexColor(' #0af '), '#00AAFF');
  assert.equal(normalizeHexColor('invalid'), DEFAULT_THEME_PREFERENCES.accentHex);
  assert.equal(normalizeHexColor('', '#10B981'), '#10B981');
  assert.equal(normalizeHexColor(undefined, '#8B5CF6'), '#8B5CF6');
});

test('computeContrastForeground 对亮色与暗色强调色计算可读前景文字', () => {
  // 深蓝/深紫应配纯白文字
  assert.equal(computeContrastForeground('#2563EB'), '#FFFFFF');
  assert.equal(computeContrastForeground('#111827'), '#FFFFFF');
  assert.equal(computeContrastForeground('#E85D3F'), '#FFFFFF');
  // 浅黄/浅青/纯白应配深炭黑文字
  assert.equal(computeContrastForeground('#FACC15'), '#111827');
  assert.equal(computeContrastForeground('#A7F3D0'), '#111827');
  assert.equal(computeContrastForeground('#FFFFFF'), '#111827');
});

test('computeAccentHoverHex 在浅色模式压暗并在深色模式提亮', () => {
  const lightHover = computeAccentHoverHex('#646464', 'light');
  const darkHover = computeAccentHoverHex('#646464', 'dark');
  assert.equal(lightHover, '#505050');
  assert.equal(darkHover, '#767676');
  // 边界钳位不溢出
  assert.equal(computeAccentHoverHex('#000000', 'light'), '#000000');
  assert.equal(computeAccentHoverHex('#FFFFFF', 'dark'), '#FFFFFF');
});

test('resolveEffectiveThemeMode 正确解析浅色、深色与跟随系统', () => {
  assert.equal(resolveEffectiveThemeMode('light', true), 'light');
  assert.equal(resolveEffectiveThemeMode('dark', false), 'dark');
  assert.equal(resolveEffectiveThemeMode('system', true), 'dark');
  assert.equal(resolveEffectiveThemeMode('system', false), 'light');
});

test('loadThemePreferences 与 saveThemePreferences 持久化并兼容损坏存储', () => {
  const storage = createMemoryStorage();
  assert.deepEqual(loadThemePreferences(storage), DEFAULT_THEME_PREFERENCES);

  saveThemePreferences({ mode: 'dark', accentHex: ACCENT_PRESETS[2].hex }, storage);
  assert.deepEqual(loadThemePreferences(storage), {
    mode: 'dark',
    accentHex: ACCENT_PRESETS[2].hex,
  });

  // 损坏 JSON 安全回退
  storage.setItem('local_arena_theme_v1', '{broken-json');
  assert.deepEqual(loadThemePreferences(storage), DEFAULT_THEME_PREFERENCES);

  // 非法字段安全回退
  storage.setItem('local_arena_theme_v1', JSON.stringify({ mode: 'neon', accentHex: 'zzz' }));
  assert.deepEqual(loadThemePreferences(storage), DEFAULT_THEME_PREFERENCES);
});
