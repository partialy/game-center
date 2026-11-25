import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEV_DEBUG_STORAGE_KEY,
  PerfMetricsCollector,
  getFpsHealthLevel,
  loadDevDebugMode,
  readMemorySnapshot,
  resolveDevDebugMode,
  saveDevDebugMode,
} from './perfMonitor';
import type { StorageLike } from '../settings/preferencesStore';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

test('1. 开发者调试模式解析遵循默认关闭、URL 覆盖与本地持久化', () => {
  const storage = createMemoryStorage();

  assert.equal(resolveDevDebugMode('', storage), false);
  assert.equal(resolveDevDebugMode('?debug=1', storage), true);
  assert.equal(resolveDevDebugMode('?autostart=1&debug=true', storage), true);

  saveDevDebugMode(true, storage);
  assert.equal(storage.getItem(DEV_DEBUG_STORAGE_KEY), '1');
  assert.equal(loadDevDebugMode(storage), true);
  assert.equal(resolveDevDebugMode('', storage), true);

  // URL ?debug=0 应显式覆盖已保存的开启状态
  assert.equal(resolveDevDebugMode('?debug=0', storage), false);
  assert.equal(resolveDevDebugMode('?debug=false', storage), false);

  saveDevDebugMode(false, storage);
  assert.equal(resolveDevDebugMode('', storage), false);
});

test('2. PerfMetricsCollector 准确统计 60fps 与掉帧窗口，并在暂停恢复后过滤大间隔', () => {
  const collector = new PerfMetricsCollector({
    windowMs: 1000,
    publishIntervalMs: 250,
    historyLength: 5,
    maxValidDeltaMs: 500,
  });

  // 稳定 60 FPS（每帧 16.6667ms）
  let t = 1000;
  let publishedCount = 0;
  for (let i = 0; i <= 30; i += 1) {
    if (collector.recordFrame(t, 1)) {
      publishedCount += 1;
    }
    t += 1000 / 60;
  }
  assert.ok(publishedCount >= 1, '达到发布间隔应触发快照通知');
  const steadySnap = collector.getSnapshot(false, null);
  assert.equal(steadySnap.fps, 60);
  assert.ok(Math.abs(steadySnap.avgFrameMs - 16.7) <= 0.2);
  assert.equal(steadySnap.simStepsPerFrame, 1);
  assert.equal(getFpsHealthLevel(steadySnap.fps), 'good');

  // 模拟暂停 5 秒后恢复：resetTiming 应避免把 5000ms 计入帧耗时
  collector.resetTiming();
  t += 5000;
  collector.recordFrame(t, 1);
  for (let i = 0; i < 16; i += 1) {
    t += 1000 / 30; // 恢复后模拟 30 FPS（每帧 33.33ms）
    collector.recordFrame(t, 2);
  }
  const slowSnap = collector.getSnapshot(false, null);
  assert.equal(slowSnap.fps, 30);
  assert.ok(slowSnap.avgFrameMs >= 33 && slowSnap.avgFrameMs <= 34);
  assert.equal(slowSnap.simStepsPerFrame, 2);
  assert.equal(getFpsHealthLevel(slowSnap.fps), 'warn');
  assert.equal(getFpsHealthLevel(24), 'bad');
  assert.ok(slowSnap.fpsHistory.length <= 5, '历史折线长度受 historyLength 限制');
});

test('3. readMemorySnapshot 正确换算 MB 并在非 Chromium 环境下安全降级为 null', () => {
  assert.equal(readMemorySnapshot(null), null);
  assert.equal(readMemorySnapshot({}), null);
  assert.equal(
    readMemorySnapshot({
      memory: { usedJSHeapSize: 100, totalJSHeapSize: 200, jsHeapSizeLimit: 0 },
    }),
    null
  );

  const mb = 1024 * 1024;
  const snap = readMemorySnapshot({
    memory: {
      usedJSHeapSize: 42.5 * mb,
      totalJSHeapSize: 64 * mb,
      jsHeapSizeLimit: 2048 * mb,
    },
  });

  assert.ok(snap !== null);
  assert.equal(snap.usedMb, 42.5);
  assert.equal(snap.totalMb, 64);
  assert.equal(snap.limitMb, 2048);
  assert.ok(Math.abs(snap.usedRatio - 42.5 / 2048) < 1e-4);
});
