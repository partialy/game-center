import type { MatchResultEvent } from '../games/contracts';
import type { StorageLike } from '../settings/preferencesStore';
import { compactReplayForStorage, createDemoReplayData } from '../replay/replayEngine';
import { createDemoMatchResult } from '../analytics/matchAnalytics';

const STORAGE_KEY_MATCH_HISTORY = 'local_arena_match_history_v1';
const STORAGE_VERSION = 1;
export const MAX_HISTORY_RECORDS = 8;

export interface MatchHistoryRecord {
  id: string;
  completedAt: number;
  gameId: string;
  result: MatchResultEvent;
}

const memoryFallback = new Map<string, string>();

function getStorage(custom?: StorageLike): StorageLike {
  if (custom) return custom;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const probe = '__local_arena_history_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    }
  } catch {
    // 浏览器禁用存储或隐私模式下退回会话内存
  }
  return {
    getItem: (k) => memoryFallback.get(k) ?? null,
    setItem: (k, v) => {
      memoryFallback.set(k, v);
    },
    removeItem: (k) => {
      memoryFallback.delete(k);
    },
  };
}

function isValidMatchResult(raw: unknown): raw is MatchResultEvent {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.gameId === 'string' &&
    Array.isArray(r.winnerSlotIds) &&
    typeof r.isTie === 'boolean' &&
    typeof r.totalRounds === 'number' &&
    typeof r.mapCode === 'string' &&
    Array.isArray(r.players) &&
    r.players.length > 0
  );
}

/** 从本地存储读取最近对局历史（自动忽略损坏记录并按时间倒序返回） */
export function loadMatchHistory(customStorage?: StorageLike): MatchHistoryRecord[] {
  const storage = getStorage(customStorage);
  try {
    const raw = storage.getItem(STORAGE_KEY_MATCH_HISTORY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { version?: number; records?: unknown };
    if (!parsed || !Array.isArray(parsed.records)) return [];

    const valid: MatchHistoryRecord[] = [];
    for (const item of parsed.records) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      if (
        typeof obj.id === 'string' &&
        typeof obj.completedAt === 'number' &&
        Number.isFinite(obj.completedAt) &&
        typeof obj.gameId === 'string' &&
        isValidMatchResult(obj.result)
      ) {
        valid.push({
          id: obj.id,
          completedAt: obj.completedAt,
          gameId: obj.gameId,
          result: obj.result,
        });
      }
    }
    return valid
      .sort((a, b) => b.completedAt - a.completedAt)
      .slice(0, MAX_HISTORY_RECORDS);
  } catch {
    return [];
  }
}

/** 将历史记录安全写入本地存储：遇到配额限制时优先压缩/剥离最旧记录的录像数据，保留对局统计 */
function persistMatchHistoryRecords(
  records: MatchHistoryRecord[],
  customStorage?: StorageLike
): boolean {
  const storage = getStorage(customStorage);
  // 存储副本：压缩每条记录的录像关键帧密度（保留 100% 精彩事件），内存中仍保留完整高精录像
  const storageReady: MatchHistoryRecord[] = records.slice(0, MAX_HISTORY_RECORDS).map((rec) => ({
    ...rec,
    result: rec.result.replay
      ? {
          ...rec.result,
          replay: compactReplayForStorage(rec.result.replay, 220),
        }
      : rec.result,
  }));

  try {
    storage.setItem(
      STORAGE_KEY_MATCH_HISTORY,
      JSON.stringify({ version: STORAGE_VERSION, records: storageReady })
    );
    return true;
  } catch {
    // 第一次写入超限时，逐步剥离较旧记录的录像序列（保留最新 2 场的录像与全部历史战绩统计）
    const trimmed = storageReady.map((rec, idx) =>
      idx < 2
        ? {
            ...rec,
            result: rec.result.replay
              ? { ...rec.result, replay: compactReplayForStorage(rec.result.replay, 90) }
              : rec.result,
          }
        : {
            ...rec,
            result: { ...rec.result, replay: undefined },
          }
    );
    try {
      storage.setItem(
        STORAGE_KEY_MATCH_HISTORY,
        JSON.stringify({ version: STORAGE_VERSION, records: trimmed })
      );
      return true;
    } catch {
      return false;
    }
  }
}

/** 追加一场新结束的对局到历史记录顶部并持久化，返回最新列表与新记录 */
export function appendMatchHistory(
  result: MatchResultEvent,
  existing: MatchHistoryRecord[],
  customStorage?: StorageLike,
  nowMs = Date.now()
): {
  records: MatchHistoryRecord[];
  newRecord: MatchHistoryRecord;
  persisted: boolean;
} {
  const uniqueSuffix = Math.floor((nowMs % 100000) + Math.random() * 9000);
  const newRecord: MatchHistoryRecord = {
    id: `match_${nowMs}_${uniqueSuffix}`,
    completedAt: nowMs,
    gameId: result.gameId,
    result,
  };
  const records = [newRecord, ...existing].slice(0, MAX_HISTORY_RECORDS);
  const persisted = persistMatchHistoryRecords(records, customStorage);
  return { records, newRecord, persisted };
}

/** 清空本地对局历史记录 */
export function clearMatchHistory(customStorage?: StorageLike): void {
  const storage = getStorage(customStorage);
  try {
    storage.removeItem(STORAGE_KEY_MATCH_HISTORY);
  } catch {
    // 忽略受限存储清除错误
  }
}

/** 格式化历史对局时间标签 */
export function formatHistoryTimestamp(completedAtMs: number, nowMs = Date.now()): string {
  const diffSec = Math.max(0, Math.floor((nowMs - completedAtMs) / 1000));
  if (diffSec < 60) return '刚刚';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;

  const date = new Date(completedAtMs);
  const nowDate = new Date(nowMs);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const isSameDay =
    date.getFullYear() === nowDate.getFullYear() &&
    date.getMonth() === nowDate.getMonth() &&
    date.getDate() === nowDate.getDate();

  if (isSameDay) {
    return `今天 ${hh}:${mm}`;
  }
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${month}/${day} ${hh}:${mm}`;
}

/**
 * 为 ?demoResults=1 验收模式生成 4 场有不同胜负、数据分布与录像的历史记录。
 */
export function createDemoMatchHistory(nowMs = Date.now()): MatchHistoryRecord[] {
  const primary = createDemoMatchResult();

  const comebackResult: MatchResultEvent = {
    gameId: 'tank-battle',
    winnerSlotIds: ['p2'],
    isTie: false,
    scores: { p1: 4, p2: 5 },
    drawRounds: 0,
    totalRounds: 9,
    totalBattleSeconds: 195,
    mapCode: 'TB1-10x7-08-7C41E20B',
    players: [
      {
        slotId: 'p1',
        displayName: 'P1',
        colorHex: '#D9432B',
        score: 4,
        stats: {
          kills: 4,
          selfEliminations: 1,
          deaths: 5,
          shotsFired: 29,
          hitsLanded: 8,
          itemsPicked: 5,
          itemsUsed: 4,
          itemUsageByKind: {
            rapid_fire: 2,
            frag: 1,
            shield: 1,
          },
        },
      },
      {
        slotId: 'p2',
        displayName: 'P2',
        colorHex: '#2364C7',
        score: 5,
        stats: {
          kills: 5,
          selfEliminations: 0,
          deaths: 4,
          shotsFired: 21,
          hitsLanded: 10,
          itemsPicked: 7,
          itemsUsed: 6,
          itemUsageByKind: {
            homing: 3,
            shield: 2,
            laser: 1,
          },
        },
      },
    ],
    replay: createDemoReplayData('TB1-10x7-08-7C41E20B', 'p2_comeback'),
  };

  const drawResult: MatchResultEvent = {
    gameId: 'tank-battle',
    winnerSlotIds: ['p1', 'p2'],
    isTie: true,
    scores: { p1: 3, p2: 3 },
    drawRounds: 2,
    totalRounds: 8,
    totalBattleSeconds: 134,
    mapCode: 'TB1-10x7-08-19B8F4A1',
    players: [
      {
        slotId: 'p1',
        displayName: 'P1',
        colorHex: '#D9432B',
        score: 3,
        stats: {
          kills: 4,
          selfEliminations: 1,
          deaths: 5,
          shotsFired: 18,
          hitsLanded: 6,
          itemsPicked: 4,
          itemsUsed: 3,
          itemUsageByKind: {
            shotgun: 2,
            mine: 1,
          },
        },
      },
      {
        slotId: 'p2',
        displayName: 'P2',
        colorHex: '#2364C7',
        score: 3,
        stats: {
          kills: 4,
          selfEliminations: 1,
          deaths: 5,
          shotsFired: 20,
          hitsLanded: 7,
          itemsPicked: 4,
          itemsUsed: 3,
          itemUsageByKind: {
            laser: 1,
            shield: 2,
          },
        },
      },
    ],
    replay: createDemoReplayData('TB1-10x7-08-19B8F4A1', 'draw'),
  };

  const sweepResult: MatchResultEvent = {
    gameId: 'tank-battle',
    winnerSlotIds: ['p1'],
    isTie: false,
    scores: { p1: 5, p2: 1 },
    drawRounds: 0,
    totalRounds: 6,
    totalBattleSeconds: 112,
    mapCode: 'TB1-10x7-08-52D6A910',
    players: [
      {
        slotId: 'p1',
        displayName: 'P1',
        colorHex: '#D9432B',
        score: 5,
        stats: {
          kills: 5,
          selfEliminations: 0,
          deaths: 1,
          shotsFired: 16,
          hitsLanded: 9,
          itemsPicked: 5,
          itemsUsed: 5,
          itemUsageByKind: {
            laser: 2,
            frag: 2,
            shield: 1,
          },
        },
      },
      {
        slotId: 'p2',
        displayName: 'P2',
        colorHex: '#2364C7',
        score: 1,
        stats: {
          kills: 1,
          selfEliminations: 0,
          deaths: 5,
          shotsFired: 19,
          hitsLanded: 3,
          itemsPicked: 2,
          itemsUsed: 2,
          itemUsageByKind: {
            shotgun: 1,
            mine: 1,
          },
        },
      },
    ],
    replay: createDemoReplayData('TB1-10x7-08-52D6A910', 'p1_win'),
  };

  return [
    {
      id: 'demo_match_1',
      completedAt: nowMs - 20_000,
      gameId: 'tank-battle',
      result: primary,
    },
    {
      id: 'demo_match_2',
      completedAt: nowMs - 14 * 60_000,
      gameId: 'tank-battle',
      result: comebackResult,
    },
    {
      id: 'demo_match_3',
      completedAt: nowMs - 42 * 60_000,
      gameId: 'tank-battle',
      result: drawResult,
    },
    {
      id: 'demo_match_4',
      completedAt: nowMs - 95 * 60_000,
      gameId: 'tank-battle',
      result: sweepResult,
    },
  ];
}
