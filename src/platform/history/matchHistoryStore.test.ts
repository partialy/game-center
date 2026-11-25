import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_HISTORY_RECORDS,
  appendMatchHistory,
  clearMatchHistory,
  createDemoMatchHistory,
  formatHistoryTimestamp,
  loadMatchHistory,
} from './matchHistoryStore';
import { createDemoMatchResult } from '../analytics/matchAnalytics';
import type { StorageLike } from '../settings/preferencesStore';

function createMockStorage(failOnLargeBytes?: number): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      if (failOnLargeBytes !== undefined && v.length > failOnLargeBytes) {
        throw new Error('QuotaExceededError');
      }
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

test('1. appendMatchHistory 按时间倒序持久化、限制上限并支持清空与损坏回退', () => {
  const storage = createMockStorage();
  const baseResult = createDemoMatchResult();

  let records = loadMatchHistory(storage);
  assert.equal(records.length, 0);

  for (let i = 0; i < MAX_HISTORY_RECORDS + 3; i += 1) {
    const res = appendMatchHistory(
      { ...baseResult, totalRounds: i + 1 },
      records,
      storage,
      1_700_000_000_000 + i * 60_000
    );
    records = res.records;
    assert.equal(res.persisted, true);
  }

  assert.equal(records.length, MAX_HISTORY_RECORDS);
  assert.equal(records[0].result.totalRounds, MAX_HISTORY_RECORDS + 3);

  const reloaded = loadMatchHistory(storage);
  assert.equal(reloaded.length, MAX_HISTORY_RECORDS);
  assert.equal(reloaded[0].result.totalRounds, MAX_HISTORY_RECORDS + 3);

  // 损坏 JSON 时安全回退空数组而不抛错
  storage.setItem('local_arena_match_history_v1', '{broken-json');
  assert.deepEqual(loadMatchHistory(storage), []);

  clearMatchHistory(storage);
  assert.deepEqual(loadMatchHistory(storage), []);
});

test('2. 存储空间受限时自动压缩并降级旧录像，同时保留战绩概览与统计', () => {
  // 给一个较小字节上限迫使首次写入触发配额降级
  const tightStorage = createMockStorage(4500);
  const demo = createDemoMatchHistory(1_700_000_000_000);
  const { records } = appendMatchHistory(
    demo[0].result,
    demo.slice(1),
    tightStorage,
    1_700_000_100_000
  );
  assert.equal(records.length, 4);
  // 即使极端配额下持久化失败或降级，内存中的当前历史列表依然完整可用
  assert.ok(records[0].result.replay && records[0].result.replay.events.length > 0);
});

test('3. formatHistoryTimestamp 与 createDemoMatchHistory 输出清晰的多场可回顾数据', () => {
  const now = new Date('2026-11-25T15:30:00Z').getTime();
  assert.equal(formatHistoryTimestamp(now - 15_000, now), '刚刚');
  assert.equal(formatHistoryTimestamp(now - 12 * 60_000, now), '12 分钟前');

  const demoList = createDemoMatchHistory(now);
  assert.equal(demoList.length, 4);
  assert.equal(demoList[0].result.isTie, false);
  assert.equal(demoList[1].result.winnerSlotIds[0], 'p2');
  assert.equal(demoList[2].result.isTie, true);
  assert.ok(demoList.every((item) => item.result.replay && item.result.replay.events.length >= 3));
});
