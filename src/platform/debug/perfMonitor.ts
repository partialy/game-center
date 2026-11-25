import type { StorageLike } from '../settings/preferencesStore';

export const DEV_DEBUG_STORAGE_KEY = 'local_arena_dev_debug_v1';

export interface PerformanceMemoryLike {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export interface MemorySnapshot {
  usedMb: number;
  totalMb: number;
  limitMb: number;
  /** 占 JS 堆上限比例（0~1） */
  usedRatio: number;
}

export interface PerfSnapshot {
  fps: number;
  avgFrameMs: number;
  maxFrameMs: number;
  simStepsPerFrame: number;
  aiComputeMs?: number;
  aiOverBudget?: boolean;
  fpsHistory: number[];
  memory: MemorySnapshot | null;
  paused: boolean;
}

export type FpsHealthLevel = 'good' | 'warn' | 'bad';

const BYTES_PER_MB = 1024 * 1024;

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // 忽略隐私模式或存储受限异常
  }
  return null;
}

export function loadDevDebugMode(customStorage?: StorageLike | null): boolean {
  const storage = customStorage !== undefined ? customStorage : getDefaultStorage();
  if (!storage) return false;
  try {
    return storage.getItem(DEV_DEBUG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveDevDebugMode(enabled: boolean, customStorage?: StorageLike | null): void {
  const storage = customStorage !== undefined ? customStorage : getDefaultStorage();
  if (!storage) return;
  try {
    storage.setItem(DEV_DEBUG_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // 忽略存储写入受限
  }
}

/**
 * 解析当前是否启用开发者调试模式：
 * 1. URL 参数 ?debug=1 / ?debug=true 显式开启，?debug=0 / ?debug=false 显式关闭
 * 2. 否则回退读取本地持久化开关（默认关闭，不影响普通玩家界面）
 */
export function resolveDevDebugMode(
  search?: string,
  customStorage?: StorageLike | null
): boolean {
  const rawSearch =
    search !== undefined
      ? search
      : typeof window !== 'undefined'
      ? window.location.search
      : '';
  const params = new URLSearchParams(rawSearch);
  const debugParam = params.get('debug')?.trim().toLowerCase();
  if (debugParam === '1' || debugParam === 'true') return true;
  if (debugParam === '0' || debugParam === 'false') return false;
  return loadDevDebugMode(customStorage);
}

/** 安全读取浏览器 JS 堆内存信息（Chromium 提供 performance.memory，其它内核返回 null） */
export function readMemorySnapshot(perfObj?: unknown): MemorySnapshot | null {
  const target =
    perfObj !== undefined
      ? perfObj
      : typeof performance !== 'undefined'
      ? performance
      : null;

  if (!target || typeof target !== 'object') return null;
  const mem = (target as { memory?: Partial<PerformanceMemoryLike> }).memory;
  if (
    !mem ||
    typeof mem.usedJSHeapSize !== 'number' ||
    typeof mem.totalJSHeapSize !== 'number' ||
    typeof mem.jsHeapSizeLimit !== 'number' ||
    !Number.isFinite(mem.usedJSHeapSize) ||
    !Number.isFinite(mem.totalJSHeapSize) ||
    !Number.isFinite(mem.jsHeapSizeLimit) ||
    mem.jsHeapSizeLimit <= 0
  ) {
    return null;
  }

  const usedMb = Math.round((mem.usedJSHeapSize / BYTES_PER_MB) * 10) / 10;
  const totalMb = Math.round((mem.totalJSHeapSize / BYTES_PER_MB) * 10) / 10;
  const limitMb = Math.round((mem.jsHeapSizeLimit / BYTES_PER_MB) * 10) / 10;
  const usedRatio = Math.max(0, Math.min(1, mem.usedJSHeapSize / mem.jsHeapSizeLimit));

  return { usedMb, totalMb, limitMb, usedRatio };
}

export function getFpsHealthLevel(fps: number): FpsHealthLevel {
  if (fps >= 55) return 'good';
  if (fps >= 30) return 'warn';
  return 'bad';
}

interface FrameSample {
  timestampMs: number;
  deltaMs: number;
  simSteps: number;
  aiMs: number;
}

export interface PerfCollectorOptions {
  /** 滑动统计窗口长度（毫秒） */
  windowMs?: number;
  /** UI 发布节流间隔（毫秒） */
  publishIntervalMs?: number;
  /** 历史折线点数上限 */
  historyLength?: number;
  /** 视为切后台/暂停断层的最大单帧间隔（毫秒） */
  maxValidDeltaMs?: number;
}

/**
 * 游戏主循环帧率与帧耗时采样器：
 * - 在固定滚动窗口内统计平滑 FPS、平均帧耗时与峰值帧耗时
 * - 节流通知频率（默认每 250ms 一次），避免高频触发 React 重渲染
 * - 暂停/恢复时重置时间基准，防止长时间暂停造成假掉帧
 */
export class PerfMetricsCollector {
  private readonly windowMs: number;
  private readonly publishIntervalMs: number;
  private readonly historyLength: number;
  private readonly maxValidDeltaMs: number;

  private samples: FrameSample[] = [];
  private fpsHistory: number[] = [];
  private lastTimestampMs: number | null = null;
  private lastPublishMs: number | null = null;
  private cachedFps = 0;
  private cachedAvgFrameMs = 0;
  private cachedMaxFrameMs = 0;
  private cachedSimSteps = 0;
  private cachedAiMs = 0;
  private cachedAiOverBudget = false;

  constructor(options: PerfCollectorOptions = {}) {
    this.windowMs = options.windowMs ?? 1000;
    this.publishIntervalMs = options.publishIntervalMs ?? 250;
    this.historyLength = options.historyLength ?? 32;
    this.maxValidDeltaMs = options.maxValidDeltaMs ?? 500;
  }

  /** 在暂停、恢复或重新启用监控时清除时间基准，避免跨暂停间隔污染统计 */
  resetTiming(): void {
    this.lastTimestampMs = null;
  }

  /** 清空全部采样与历史记录 */
  clear(): void {
    this.samples = [];
    this.fpsHistory = [];
    this.lastTimestampMs = null;
    this.lastPublishMs = null;
    this.cachedFps = 0;
    this.cachedAvgFrameMs = 0;
    this.cachedMaxFrameMs = 0;
    this.cachedSimSteps = 0;
    this.cachedAiMs = 0;
    this.cachedAiOverBudget = false;
  }

  /**
   * 记录一帧主循环回调。
   * 当达到发布节流间隔时更新聚合指标并返回 true，供外部拉取最新快照。
   */
  recordFrame(timestampMs: number, simSteps: number, aiComputeMs = 0): boolean {
    if (this.lastTimestampMs === null) {
      this.lastTimestampMs = timestampMs;
      if (this.lastPublishMs === null) {
        this.lastPublishMs = timestampMs;
      }
      return false;
    }

    const deltaMs = timestampMs - this.lastTimestampMs;
    this.lastTimestampMs = timestampMs;

    if (deltaMs <= 0 || deltaMs > this.maxValidDeltaMs) {
      return false;
    }

    this.samples.push({ timestampMs, deltaMs, simSteps, aiMs: aiComputeMs });

    const cutoff = timestampMs - this.windowMs;
    while (this.samples.length > 0 && this.samples[0].timestampMs < cutoff) {
      this.samples.shift();
    }

    if (
      this.lastPublishMs === null ||
      timestampMs - this.lastPublishMs >= this.publishIntervalMs
    ) {
      this.lastPublishMs = timestampMs;
      this.recomputeAggregates();
      return true;
    }

    return false;
  }

  getSnapshot(paused: boolean, perfObj?: unknown): PerfSnapshot {
    return {
      fps: this.cachedFps,
      avgFrameMs: this.cachedAvgFrameMs,
      maxFrameMs: this.cachedMaxFrameMs,
      simStepsPerFrame: this.cachedSimSteps,
      aiComputeMs: this.cachedAiMs,
      aiOverBudget: this.cachedAiOverBudget,
      fpsHistory: [...this.fpsHistory],
      memory: readMemorySnapshot(perfObj),
      paused,
    };
  }

  private recomputeAggregates(): void {
    if (this.samples.length === 0) {
      this.cachedFps = 0;
      this.cachedAvgFrameMs = 0;
      this.cachedMaxFrameMs = 0;
      this.cachedSimSteps = 0;
      this.cachedAiMs = 0;
      this.cachedAiOverBudget = false;
      return;
    }

    let totalDelta = 0;
    let maxDelta = 0;
    let totalSteps = 0;
    let totalAiMs = 0;
    let maxAiMs = 0;
    for (const sample of this.samples) {
      totalDelta += sample.deltaMs;
      if (sample.deltaMs > maxDelta) maxDelta = sample.deltaMs;
      totalSteps += sample.simSteps;
      totalAiMs += sample.aiMs;
      if (sample.aiMs > maxAiMs) maxAiMs = sample.aiMs;
    }

    const avgMs = totalDelta / this.samples.length;
    const fps = avgMs > 0 ? Math.min(240, Math.round(1000 / avgMs)) : 0;

    this.cachedFps = fps;
    this.cachedAvgFrameMs = Math.round(avgMs * 10) / 10;
    this.cachedMaxFrameMs = Math.round(maxDelta * 10) / 10;
    this.cachedSimSteps = Math.round((totalSteps / this.samples.length) * 10) / 10;
    this.cachedAiMs = Math.round((totalAiMs / this.samples.length) * 100) / 100;
    this.cachedAiOverBudget = maxAiMs > 16.67;

    this.fpsHistory.push(fps);
    if (this.fpsHistory.length > this.historyLength) {
      this.fpsHistory.shift();
    }
  }
}
