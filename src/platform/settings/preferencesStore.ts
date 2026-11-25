import type {
  ArenaSeatConfig,
  GameDefinition,
  GameMode,
  PlayerProfile,
  PlayerSlotId,
  RulePreset,
  SingleMatchup,
} from '../games/contracts';
import { PLAYER_COLOR_PALETTE } from '../input/bindings';

const STORAGE_VERSION = 1;
const KEY_PROFILES = 'local_arena_profiles_v1';
const KEY_BINDINGS_PREFIX = 'local_arena_bindings_v1_';
const KEY_RULES_PREFIX = 'local_arena_rules_v1_';
const KEY_PRESETS_PREFIX = 'local_arena_presets_v1_';
const KEY_MODE_PREFS = 'local_arena_mode_prefs_v1';
const KEY_ARENA_SEATS_PREFIX = 'local_arena_brawl_seats_v1_';
const KEY_MOBILE_PREFS = 'local_arena_mobile_prefs_v1';

export interface MobilePreferences {
  /** 虚拟摇杆与开火按键透明度百分比（10 ~ 80） */
  virtualControlsOpacity: number;
}

export interface ModePreferences {
  gameMode: GameMode;
  singleMatchup: SingleMatchup;
  aiModelBySlot: Record<PlayerSlotId, string>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StoreLoadResult<T> {
  value: T;
  notice: string | null;
}

export interface StoreSaveResult {
  ok: boolean;
  error: string | null;
}

const memoryFallback = new Map<string, string>();

function getStorage(custom?: StorageLike): { storage: StorageLike; isFallback: boolean } {
  if (custom) return { storage: custom, isFallback: false };
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const testKey = '__local_arena_probe__';
      window.localStorage.setItem(testKey, '1');
      window.localStorage.removeItem(testKey);
      return { storage: window.localStorage, isFallback: false };
    }
  } catch {
    // 浏览器禁用或配额受限时退回当前会话内存存储
  }
  return {
    isFallback: true,
    storage: {
      getItem: (k) => memoryFallback.get(k) ?? null,
      setItem: (k, v) => {
        memoryFallback.set(k, v);
      },
      removeItem: (k) => {
        memoryFallback.delete(k);
      },
    },
  };
}

export function getDefaultProfiles(count = 2): PlayerProfile[] {
  const slots: PlayerProfile[] = [];
  for (let i = 0; i < count; i += 1) {
    slots.push({
      slotId: `p${i + 1}`,
      name: '',
      colorHex: PLAYER_COLOR_PALETTE[i % PLAYER_COLOR_PALETTE.length].hex,
    });
  }
  return slots;
}

function readJsonRecord(key: string, customStorage?: StorageLike): {
  found: boolean;
  data: unknown;
  corrupted: boolean;
} {
  const { storage } = getStorage(customStorage);
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { found: false, data: null, corrupted: false };
    const parsed: unknown = JSON.parse(raw);
    return { found: true, data: parsed, corrupted: false };
  } catch {
    return { found: true, data: null, corrupted: true };
  }
}

function writeJsonRecord(key: string, payload: unknown, customStorage?: StorageLike): StoreSaveResult {
  const { storage, isFallback } = getStorage(customStorage);
  try {
    storage.setItem(key, JSON.stringify(payload));
    if (isFallback) {
      return {
        ok: false,
        error: '浏览器本地存储不可用，当前设置仅在本次会话内存中生效。',
      };
    }
    return { ok: true, error: null };
  } catch {
    memoryFallback.set(key, JSON.stringify(payload));
    return {
      ok: false,
      error: '保存到本地存储失败，当前设置仅在本次会话内保留。',
    };
  }
}

function modeStorageSuffix(mode: GameMode): string {
  if (mode === 'single') return '_single';
  if (mode === 'brawl') return '_brawl';
  return '';
}

export function getDefaultArenaSeats(
  count = 4,
  builtinModelIds: string[] = ['rookie', 'tactical', 'elite', 'nightmare']
): ArenaSeatConfig[] {
  const safeCount = Math.max(2, Math.min(8, count));
  const pool = builtinModelIds.length > 0 ? builtinModelIds : ['tactical'];
  const seats: ArenaSeatConfig[] = [];
  for (let i = 0; i < safeCount; i += 1) {
    seats.push({
      slotId: `p${i + 1}`,
      name: '',
      colorHex: PLAYER_COLOR_PALETTE[i % PLAYER_COLOR_PALETTE.length].hex,
      controller: 'ai',
      aiSource: 'builtin',
      aiModelId: pool[i % pool.length],
    });
  }
  return seats;
}

export function loadArenaSeats(
  gameId: string,
  builtinModelIds: string[] = ['rookie', 'tactical', 'elite', 'nightmare'],
  customStorage?: StorageLike
): StoreLoadResult<ArenaSeatConfig[]> {
  const defaults = getDefaultArenaSeats(4, builtinModelIds);
  const res = readJsonRecord(`${KEY_ARENA_SEATS_PREFIX}${gameId}`, customStorage);
  if (!res.found) return { value: defaults, notice: null };
  if (res.corrupted || typeof res.data !== 'object' || res.data === null) {
    return { value: defaults, notice: '乱斗阵容记录已损坏，已恢复默认 4 席 AI 阵容。' };
  }
  const obj = res.data as Record<string, unknown>;
  if (!Array.isArray(obj.seats) || obj.seats.length < 2) {
    return { value: defaults, notice: null };
  }

  const parsed: ArenaSeatConfig[] = [];
  for (let i = 0; i < Math.min(8, obj.seats.length); i += 1) {
    const raw = obj.seats[i];
    if (!raw || typeof raw !== 'object') continue;
    const rec = raw as Record<string, unknown>;
    parsed.push({
      slotId: `p${parsed.length + 1}`,
      name: typeof rec.name === 'string' ? rec.name.slice(0, 16) : '',
      colorHex:
        typeof rec.colorHex === 'string'
          ? rec.colorHex
          : PLAYER_COLOR_PALETTE[parsed.length % PLAYER_COLOR_PALETTE.length].hex,
      controller: rec.controller === 'human' ? 'human' : 'ai',
      aiSource: rec.aiSource === 'custom' ? 'custom' : 'builtin',
      aiModelId:
        typeof rec.aiModelId === 'string' && rec.aiModelId.trim()
          ? rec.aiModelId
          : builtinModelIds[parsed.length % Math.max(1, builtinModelIds.length)] ?? 'tactical',
    });
  }

  if (parsed.length < 2) {
    return { value: defaults, notice: null };
  }
  return { value: parsed, notice: null };
}

export function saveArenaSeats(
  gameId: string,
  seats: ArenaSeatConfig[],
  customStorage?: StorageLike
): StoreSaveResult {
  return writeJsonRecord(
    `${KEY_ARENA_SEATS_PREFIX}${gameId}`,
    { version: STORAGE_VERSION, seats },
    customStorage
  );
}

export function loadModePreferences(
  defaultModelId = 'tactical',
  customStorage?: StorageLike
): StoreLoadResult<ModePreferences> {
  const defaults: ModePreferences = {
    gameMode: 'multi',
    singleMatchup: 'human_vs_ai',
    aiModelBySlot: {
      p1: defaultModelId,
      p2: defaultModelId,
    },
  };

  const res = readJsonRecord(KEY_MODE_PREFS, customStorage);
  if (!res.found) return { value: defaults, notice: null };
  if (res.corrupted || typeof res.data !== 'object' || res.data === null) {
    return { value: defaults, notice: '模式偏好记录已损坏，已恢复默认模式配置。' };
  }

  const obj = res.data as Record<string, unknown>;
  const gameMode: GameMode =
    obj.gameMode === 'single'
      ? 'single'
      : obj.gameMode === 'brawl'
      ? 'brawl'
      : 'multi';
  const singleMatchup: SingleMatchup =
    obj.singleMatchup === 'ai_vs_ai' ? 'ai_vs_ai' : 'human_vs_ai';

  const aiModelBySlot: Record<PlayerSlotId, string> = { ...defaults.aiModelBySlot };
  if (typeof obj.aiModelBySlot === 'object' && obj.aiModelBySlot !== null) {
    for (const [slotId, modelId] of Object.entries(
      obj.aiModelBySlot as Record<string, unknown>
    )) {
      if (typeof modelId === 'string' && modelId.trim()) {
        aiModelBySlot[slotId] = modelId;
      }
    }
  }

  return {
    value: {
      gameMode,
      singleMatchup,
      aiModelBySlot,
    },
    notice: null,
  };
}

export function saveModePreferences(
  prefs: ModePreferences,
  customStorage?: StorageLike
): StoreSaveResult {
  return writeJsonRecord(
    KEY_MODE_PREFS,
    {
      version: STORAGE_VERSION,
      gameMode: prefs.gameMode,
      singleMatchup: prefs.singleMatchup,
      aiModelBySlot: prefs.aiModelBySlot,
    },
    customStorage
  );
}

export function loadPlayerProfiles(
  playerCount = 2,
  customStorage?: StorageLike
): StoreLoadResult<PlayerProfile[]> {
  const defaults = getDefaultProfiles(playerCount);
  const res = readJsonRecord(KEY_PROFILES, customStorage);
  if (!res.found) return { value: defaults, notice: null };
  if (res.corrupted || typeof res.data !== 'object' || res.data === null) {
    return { value: defaults, notice: '玩家资料记录已损坏，已恢复为默认设置。' };
  }
  const obj = res.data as Record<string, unknown>;
  if (!Array.isArray(obj.profiles)) {
    return { value: defaults, notice: '玩家资料格式无效，已恢复为默认设置。' };
  }

  const loadedBySlot = new Map<string, PlayerProfile>();
  for (const item of obj.profiles) {
    if (typeof item === 'object' && item !== null) {
      const rec = item as Record<string, unknown>;
      if (typeof rec.slotId === 'string' && typeof rec.colorHex === 'string') {
        loadedBySlot.set(rec.slotId, {
          slotId: rec.slotId,
          name: typeof rec.name === 'string' ? rec.name : '',
          colorHex: rec.colorHex,
        });
      }
    }
  }

  const merged = defaults.map((def) => loadedBySlot.get(def.slotId) ?? def);
  return { value: merged, notice: null };
}

export function savePlayerProfiles(
  profiles: PlayerProfile[],
  customStorage?: StorageLike
): StoreSaveResult {
  return writeJsonRecord(
    KEY_PROFILES,
    { version: STORAGE_VERSION, profiles },
    customStorage
  );
}

export function loadGameBindings(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  game: GameDefinition<any, any>,
  customStorage?: StorageLike
): StoreLoadResult<Record<PlayerSlotId, Record<string, string>>> {
  const defaults: Record<PlayerSlotId, Record<string, string>> = {};
  for (const [slotId, map] of Object.entries(game.defaultBindingsBySlot)) {
    defaults[slotId] = { ...map };
  }

  const res = readJsonRecord(`${KEY_BINDINGS_PREFIX}${game.id}`, customStorage);
  if (!res.found) return { value: defaults, notice: null };
  if (res.corrupted || typeof res.data !== 'object' || res.data === null) {
    return { value: defaults, notice: '按键配置记录已损坏，已恢复默认按键。' };
  }

  const obj = res.data as Record<string, unknown>;
  const rawBindings = obj.bindingsBySlot;
  if (typeof rawBindings !== 'object' || rawBindings === null) {
    return { value: defaults, notice: '按键配置格式无效，已恢复默认按键。' };
  }

  const merged: Record<PlayerSlotId, Record<string, string>> = {};
  const rawMap = rawBindings as Record<string, unknown>;
  for (const [slotId, defSlot] of Object.entries(defaults)) {
    const savedSlot = rawMap[slotId];
    const nextSlot: Record<string, string> = { ...defSlot };
    if (typeof savedSlot === 'object' && savedSlot !== null) {
      const rec = savedSlot as Record<string, unknown>;
      for (const action of game.actions) {
        if (typeof rec[action.id] === 'string' && rec[action.id]) {
          nextSlot[action.id] = rec[action.id] as string;
        }
      }
    }
    merged[slotId] = nextSlot;
  }

  return { value: merged, notice: null };
}

export function saveGameBindings(
  gameId: string,
  bindingsBySlot: Record<PlayerSlotId, Record<string, string>>,
  customStorage?: StorageLike
): StoreSaveResult {
  return writeJsonRecord(
    `${KEY_BINDINGS_PREFIX}${gameId}`,
    { version: STORAGE_VERSION, bindingsBySlot },
    customStorage
  );
}

export function loadGameRules<TRules>(
  game: GameDefinition<TRules, unknown>,
  customStorage?: StorageLike,
  mode: GameMode = 'multi'
): StoreLoadResult<TRules> {
  const key = `${KEY_RULES_PREFIX}${game.id}${modeStorageSuffix(mode)}`;
  const res = readJsonRecord(key, customStorage);
  if (!res.found) {
    return { value: game.getDefaultRules(), notice: null };
  }
  if (res.corrupted || typeof res.data !== 'object' || res.data === null) {
    return {
      value: game.getDefaultRules(),
      notice: '规则配置记录已损坏，已使用默认值。',
    };
  }
  const obj = res.data as Record<string, unknown>;
  const migrated = game.migrateRules(obj.rules);
  return {
    value: migrated.rules,
    notice: migrated.recoveredFromError ? '部分规则记录已损坏，已回退为默认值。' : null,
  };
}

export function saveGameRules<TRules>(
  gameId: string,
  rulesVersion: number,
  rules: TRules,
  customStorage?: StorageLike,
  mode: GameMode = 'multi'
): StoreSaveResult {
  const key = `${KEY_RULES_PREFIX}${gameId}${modeStorageSuffix(mode)}`;
  return writeJsonRecord(
    key,
    { version: STORAGE_VERSION, rulesVersion, rules },
    customStorage
  );
}

export function loadRulePresets<TRules>(
  game: GameDefinition<TRules, unknown>,
  customStorage?: StorageLike,
  mode: GameMode = 'multi'
): StoreLoadResult<RulePreset<TRules>[]> {
  const key = `${KEY_PRESETS_PREFIX}${game.id}${modeStorageSuffix(mode)}`;
  const res = readJsonRecord(key, customStorage);
  if (!res.found) return { value: [], notice: null };
  if (res.corrupted || typeof res.data !== 'object' || res.data === null) {
    return { value: [], notice: '规则预设记录已损坏，已重置预设列表。' };
  }
  const obj = res.data as Record<string, unknown>;
  if (!Array.isArray(obj.presets)) {
    return { value: [], notice: '规则预设格式无效，已重置预设列表。' };
  }

  const validPresets: RulePreset<TRules>[] = [];
  for (const item of obj.presets) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.id !== 'string' || typeof rec.name !== 'string') continue;
    const migrated = game.migrateRules(rec.rules);
    validPresets.push({
      id: rec.id,
      name: rec.name.trim() || '未命名预设',
      rulesVersion: game.rulesVersion,
      rules: migrated.rules,
      updatedAt: typeof rec.updatedAt === 'number' ? rec.updatedAt : Date.now(),
    });
  }

  return { value: validPresets, notice: null };
}

export function saveRulePresets<TRules>(
  gameId: string,
  presets: RulePreset<TRules>[],
  customStorage?: StorageLike,
  mode: GameMode = 'multi'
): StoreSaveResult {
  const key = `${KEY_PRESETS_PREFIX}${gameId}${modeStorageSuffix(mode)}`;
  return writeJsonRecord(
    key,
    { version: STORAGE_VERSION, presets },
    customStorage
  );
}

export function clampVirtualControlsOpacity(value: number): number {
  if (!Number.isFinite(value)) return 55;
  return Math.max(10, Math.min(80, Math.round(value)));
}

export function loadMobilePreferences(
  customStorage?: StorageLike
): StoreLoadResult<MobilePreferences> {
  const defaults: MobilePreferences = { virtualControlsOpacity: 55 };
  const res = readJsonRecord(KEY_MOBILE_PREFS, customStorage);
  if (!res.found || res.corrupted || typeof res.data !== 'object' || res.data === null) {
    return { value: defaults, notice: null };
  }
  const rawOpacity = (res.data as Record<string, unknown>).virtualControlsOpacity;
  const parsedOpacity =
    typeof rawOpacity === 'number' ? clampVirtualControlsOpacity(rawOpacity) : 55;
  return {
    value: { virtualControlsOpacity: parsedOpacity },
    notice: null,
  };
}

export function saveMobilePreferences(
  prefs: MobilePreferences,
  customStorage?: StorageLike
): StoreSaveResult {
  return writeJsonRecord(
    KEY_MOBILE_PREFS,
    {
      version: STORAGE_VERSION,
      virtualControlsOpacity: clampVirtualControlsOpacity(prefs.virtualControlsOpacity),
    },
    customStorage
  );
}
