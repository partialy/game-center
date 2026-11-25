import type { CustomBotScriptRecord } from '../games/contracts';
import { PLAYER_COLOR_PALETTE } from '../input/bindings';
import type { StorageLike, StoreLoadResult, StoreSaveResult } from '../settings/preferencesStore';

const STORAGE_VERSION = 1;
const KEY_CUSTOM_BOTS_PREFIX = 'local_arena_custom_bots_v1_';
const memoryFallback = new Map<string, string>();

function getStorage(custom?: StorageLike): { storage: StorageLike; isFallback: boolean } {
  if (custom) return { storage: custom, isFallback: false };
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const probe = '__local_arena_bot_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return { storage: window.localStorage, isFallback: false };
    }
  } catch {
    // fallback to memory
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

/** 校验自定义 AI 选手名称与乱斗席位名称（支持中文、英文、数字、连字符与空格，1~16 字） */
export function validateCustomBotName(rawName: string): string | null {
  const trimmed = rawName.trim();
  if (trimmed.length === 0) return '请输入 AI 选手名称';
  if (trimmed.length > 16) return '名称长度请控制在 16 个字符以内';
  return null;
}

export function validateArenaSeatName(rawName: string): string | null {
  const trimmed = rawName.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 16) return '名称长度请控制在 16 个字符以内';
  return null;
}

export function loadCustomBotScripts(
  gameId: string,
  customStorage?: StorageLike
): StoreLoadResult<CustomBotScriptRecord[]> {
  const key = `${KEY_CUSTOM_BOTS_PREFIX}${gameId}`;
  const { storage } = getStorage(customStorage);
  try {
    const raw = storage.getItem(key);
    if (!raw) return { value: [], notice: null };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || !Array.isArray(parsed.scripts)) {
      return { value: [], notice: '自定义 AI 脚本库格式异常，已重置为空列表。' };
    }

    const list: CustomBotScriptRecord[] = [];
    for (const item of parsed.scripts) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      if (typeof rec.id !== 'string' || typeof rec.code !== 'string') continue;
      const val = (rec.validation ?? {}) as Record<string, unknown>;
      list.push({
        id: rec.id,
        gameId: typeof rec.gameId === 'string' ? rec.gameId : gameId,
        name:
          typeof rec.name === 'string' && rec.name.trim()
            ? rec.name.trim().slice(0, 16)
            : '自定义 AI',
        defaultColorHex:
          typeof rec.defaultColorHex === 'string'
            ? rec.defaultColorHex
            : PLAYER_COLOR_PALETTE[0].hex,
        tierLabel:
          typeof rec.tierLabel === 'string' && rec.tierLabel.trim()
            ? rec.tierLabel.trim().slice(0, 12)
            : '自定义',
        authorModel:
          typeof rec.authorModel === 'string' ? rec.authorModel.trim().slice(0, 24) : '',
        description:
          typeof rec.description === 'string' ? rec.description.trim().slice(0, 160) : '',
        code: rec.code,
        validation: {
          status:
            val.status === 'verified' || val.status === 'error' ? val.status : 'untested',
          checkedAt: typeof val.checkedAt === 'number' ? val.checkedAt : 0,
          ticksSimulated: typeof val.ticksSimulated === 'number' ? val.ticksSimulated : 0,
          avgDecisionMs: typeof val.avgDecisionMs === 'number' ? val.avgDecisionMs : 0,
          maxDecisionMs: typeof val.maxDecisionMs === 'number' ? val.maxDecisionMs : 0,
          actionsTriggered: Array.isArray(val.actionsTriggered)
            ? val.actionsTriggered.filter((x): x is string => typeof x === 'string')
            : [],
          errorMessage: typeof val.errorMessage === 'string' ? val.errorMessage : undefined,
        },
        createdAt: typeof rec.createdAt === 'number' ? rec.createdAt : Date.now(),
        updatedAt: typeof rec.updatedAt === 'number' ? rec.updatedAt : Date.now(),
      });
    }

    return { value: list, notice: null };
  } catch {
    return { value: [], notice: '自定义 AI 脚本库读取失败，已使用空列表。' };
  }
}

export function saveCustomBotScripts(
  gameId: string,
  scripts: CustomBotScriptRecord[],
  customStorage?: StorageLike
): StoreSaveResult {
  const key = `${KEY_CUSTOM_BOTS_PREFIX}${gameId}`;
  const { storage, isFallback } = getStorage(customStorage);
  try {
    storage.setItem(key, JSON.stringify({ version: STORAGE_VERSION, scripts }));
    if (isFallback) {
      return {
        ok: false,
        error: '浏览器本地存储受限，自定义 AI 脚本仅在本次会话内存中保留。',
      };
    }
    return { ok: true, error: null };
  } catch {
    return {
      ok: false,
      error: '自定义 AI 脚本保存失败（可能超出浏览器本地存储配额）。',
    };
  }
}

export function createCustomBotId(): string {
  return `custom_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e5).toString(36)}`;
}

export function exportCustomBotScriptsJson(
  gameId: string,
  scripts: CustomBotScriptRecord[]
): string {
  return JSON.stringify(
    {
      schema: 'local-arena-custom-bots-v1',
      gameId,
      exportedAt: new Date().toISOString(),
      scripts,
    },
    null,
    2
  );
}

export function parseImportedCustomBotScriptsJson(
  rawJson: string,
  targetGameId: string
): { ok: true; scripts: CustomBotScriptRecord[] } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    const rawList = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.scripts)
      ? parsed.scripts
      : null;
    if (!rawList) {
      return { ok: false, error: '导入 JSON 格式无效，未找到 scripts 数组。' };
    }
    const now = Date.now();
    const result: CustomBotScriptRecord[] = [];
    for (const item of rawList) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      if (typeof rec.code !== 'string' || !rec.code.trim()) continue;
      result.push({
        id: createCustomBotId(),
        gameId: targetGameId,
        name:
          typeof rec.name === 'string' && rec.name.trim()
            ? rec.name.trim().slice(0, 16)
            : `导入 AI ${result.length + 1}`,
        defaultColorHex:
          typeof rec.defaultColorHex === 'string'
            ? rec.defaultColorHex
            : PLAYER_COLOR_PALETTE[result.length % PLAYER_COLOR_PALETTE.length].hex,
        tierLabel:
          typeof rec.tierLabel === 'string' && rec.tierLabel.trim()
            ? rec.tierLabel.trim().slice(0, 12)
            : '导入',
        authorModel:
          typeof rec.authorModel === 'string' ? rec.authorModel.trim().slice(0, 24) : '',
        description:
          typeof rec.description === 'string' ? rec.description.trim().slice(0, 160) : '',
        code: rec.code,
        validation: {
          status: 'untested',
          checkedAt: 0,
          ticksSimulated: 0,
          avgDecisionMs: 0,
          maxDecisionMs: 0,
          actionsTriggered: [],
        },
        createdAt: now,
        updatedAt: now,
      });
    }
    if (result.length === 0) {
      return { ok: false, error: '未在导入文件中解析到有效的 AI 脚本条目。' };
    }
    return { ok: true, scripts: result };
  } catch {
    return { ok: false, error: 'JSON 解析失败，请检查文件内容是否完整。' };
  }
}
