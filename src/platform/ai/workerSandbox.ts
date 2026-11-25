import type {
  BotActionIntent,
  BotRuntimeStatus,
  BotValidationReport,
  PlayerSlotId,
} from '../games/contracts';
import {
  sanitizeBotActionIntent,
  transpileUserBotScript,
} from './scriptTranspiler';

export const WORKER_INIT_TIMEOUT_MS = 350;
export const WORKER_DECIDE_HARD_TIMEOUT_MS = 150;
export const WORKER_RESPAWN_COOLDOWN_MS = 900;

interface WorkerInitMessage {
  type: 'init';
  compiledBody: string;
  slotId: PlayerSlotId;
  seed: number;
  validActionIds: string[];
}

interface WorkerDecideMessage {
  type: 'decide';
  requestId: number;
  obs: unknown;
  dtSeconds: number;
}

interface WorkerReplyMessage {
  type: 'init_ok' | 'init_err' | 'decide_ok' | 'decide_err';
  requestId?: number;
  intent?: BotActionIntent;
  elapsedMs?: number;
  error?: string;
}

/**
 * 生成隔离的 Web Worker 引导源码：
 * - 在执行任何用户代码前，先遮蔽并置空高危网络/存储/外部脚本加载接口
 * - 统一适配 createBot / decide / defaultExport / module.exports 四种导出写法
 * - 每步严格用白名单过滤动作输出，返回纯值对象与单步执行耗时
 */
export function buildSandboxWorkerSource(): string {
  return `
"use strict";

// 遮蔽外部网络、外部脚本加载与本地存储接口，确保粘贴脚本处于纯计算沙箱
const BLOCKED_GLOBALS = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'importScripts',
  'indexedDB',
  'caches',
  'BroadcastChannel',
  'SharedWorker',
  'Worker',
  'openDatabase',
  'FileReaderSync'
];
for (let i = 0; i < BLOCKED_GLOBALS.length; i++) {
  const name = BLOCKED_GLOBALS[i];
  try {
    Object.defineProperty(self, name, {
      value: undefined,
      writable: false,
      configurable: false,
    });
  } catch (_) {
    try { self[name] = undefined; } catch (__) {}
  }
}

let decideFn = null;
let botState = {};
let validActions = [];

function createSeededRandom(seed) {
  let s = (seed >>> 0) || 1;
  return function nextRandom() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resolveDecideFunction(exportsBag, ctx) {
  if (typeof exportsBag.createBot === 'function') {
    const inst = exportsBag.createBot(ctx);
    if (typeof inst === 'function') return inst;
    if (inst && typeof inst.decide === 'function') {
      return (obs, state, dt) => inst.decide(obs, state, dt);
    }
  }
  if (typeof exportsBag.decide === 'function') {
    return exportsBag.decide;
  }
  const def = exportsBag.defaultExport;
  if (typeof def === 'function') {
    // 兼容 export default function createBot(ctx) 或 export default function decide(obs)
    try {
      const maybeInst = def(ctx);
      if (typeof maybeInst === 'function') return maybeInst;
      if (maybeInst && typeof maybeInst.decide === 'function') {
        return (obs, state, dt) => maybeInst.decide(obs, state, dt);
      }
    } catch (_) {
      // 回退为直接决策函数
    }
    return def;
  }
  if (def && typeof def.createBot === 'function') {
    const inst = def.createBot(ctx);
    if (typeof inst === 'function') return inst;
    if (inst && typeof inst.decide === 'function') {
      return (obs, state, dt) => inst.decide(obs, state, dt);
    }
  }
  if (def && typeof def.decide === 'function') {
    return (obs, state, dt) => def.decide(obs, state, dt);
  }
  const cjs = exportsBag.moduleExports;
  if (typeof cjs === 'function') {
    return cjs;
  }
  if (cjs && typeof cjs.createBot === 'function') {
    const inst = cjs.createBot(ctx);
    if (typeof inst === 'function') return inst;
    if (inst && typeof inst.decide === 'function') {
      return (obs, state, dt) => inst.decide(obs, state, dt);
    }
  }
  if (cjs && typeof cjs.decide === 'function') {
    return (obs, state, dt) => cjs.decide(obs, state, dt);
  }
  return null;
}

function sanitize(raw) {
  const out = {};
  for (let i = 0; i < validActions.length; i++) {
    const k = validActions[i];
    out[k] = Boolean(raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, k) && raw[k]);
  }
  return out;
}

self.onmessage = function(ev) {
  const msg = ev.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'init') {
    validActions = Array.isArray(msg.validActionIds) ? msg.validActionIds.slice() : [];
    botState = {};
    try {
      const factory = new Function(msg.compiledBody);
      const bag = factory();
      const ctx = {
        slotId: msg.slotId,
        seed: msg.seed,
        random: createSeededRandom(msg.seed),
      };
      const fn = resolveDecideFunction(bag, ctx);
      if (typeof fn !== 'function') {
        self.postMessage({
          type: 'init_err',
          error: '未找到有效的入口函数，请导出 createBot(ctx) 或 decide(obs, state)。',
        });
        return;
      }
      decideFn = fn;
      self.postMessage({ type: 'init_ok' });
    } catch (err) {
      self.postMessage({
        type: 'init_err',
        error: err && err.message ? String(err.message) : String(err),
      });
    }
    return;
  }

  if (msg.type === 'decide') {
    if (typeof decideFn !== 'function') {
      self.postMessage({
        type: 'decide_err',
        requestId: msg.requestId,
        error: '脚本尚未完成初始化',
      });
      return;
    }
    const t0 = performance.now();
    try {
      const rawIntent = decideFn(msg.obs, botState, msg.dtSeconds);
      const elapsedMs = performance.now() - t0;
      self.postMessage({
        type: 'decide_ok',
        requestId: msg.requestId,
        intent: sanitize(rawIntent),
        elapsedMs,
      });
    } catch (err) {
      const elapsedMs = performance.now() - t0;
      self.postMessage({
        type: 'decide_err',
        requestId: msg.requestId,
        elapsedMs,
        error: err && err.message ? String(err.message) : String(err),
      });
    }
  }
};
`;
}

function createEmptyIntent(validActionIds: readonly string[]): BotActionIntent {
  const out: BotActionIntent = {};
  for (const id of validActionIds) {
    out[id] = false;
  }
  return out;
}

/**
 * 单个自定义 AI 席位的非阻塞 Web Worker 运行器：
 * - 60Hz 主循环只读 `getLatestIntent()`，绝不阻塞画布渲染
 * - 每隔 2 帧（30Hz）仅在 Worker 空闲时派发最新观测快照，天然背压防止消息堆积
 * - 超过 150ms 硬超时立即 terminate() 彻底强杀死循环，并按冷却窗口自动重启
 */
export class WorkerBotRunner {
  readonly slotId: PlayerSlotId;
  private readonly compiledBody: string;
  private readonly seed: number;
  private readonly validActionIds: string[];

  private worker: Worker | null = null;
  private workerUrl: string | null = null;
  private initialized = false;
  private inFlightRequestId: number | null = null;
  private requestSeq = 1;
  private watchdogTimer: number | null = null;
  private respawnAtMs = 0;
  private destroyed = false;

  private latestIntent: BotActionIntent;
  private status: BotRuntimeStatus;
  private samples = 0;

  constructor(
    slotId: PlayerSlotId,
    rawCode: string,
    seed: number,
    validActionIds: readonly string[]
  ) {
    this.slotId = slotId;
    this.seed = seed;
    this.validActionIds = [...validActionIds];
    this.latestIntent = createEmptyIntent(this.validActionIds);
    this.status = {
      slotId,
      state: 'ready',
      avgMs: 0,
      timeoutCount: 0,
      errorCount: 0,
    };

    const transpiled = transpileUserBotScript(rawCode);
    if (!transpiled.ok) {
      this.compiledBody = '';
      this.status = {
        ...this.status,
        state: 'error',
        errorCount: 1,
        lastMessage: transpiled.errorMessage,
      };
      return;
    }

    this.compiledBody = transpiled.compiledBody;
    this.spawnWorker();
  }

  getLatestIntent(): BotActionIntent {
    return this.latestIntent;
  }

  getStatus(): BotRuntimeStatus {
    return { ...this.status };
  }

  /** 若 Worker 空闲则派发一次异步决策，绝不阻塞调用方 */
  dispatchObservation(obs: unknown, dtSeconds: number): void {
    if (this.destroyed || !this.compiledBody) return;

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!this.worker) {
      if (now >= this.respawnAtMs) {
        this.spawnWorker();
      }
      return;
    }

    if (!this.initialized || this.inFlightRequestId !== null) {
      return;
    }

    const requestId = this.requestSeq;
    this.requestSeq += 1;
    this.inFlightRequestId = requestId;

    this.clearWatchdog();
    this.watchdogTimer = window.setTimeout(() => {
      this.handleHardTimeout(requestId);
    }, WORKER_DECIDE_HARD_TIMEOUT_MS);

    const payload: WorkerDecideMessage = {
      type: 'decide',
      requestId,
      obs,
      dtSeconds,
    };
    try {
      this.worker.postMessage(payload);
    } catch (err) {
      this.clearWatchdog();
      this.inFlightRequestId = null;
      this.status = {
        ...this.status,
        state: 'error',
        errorCount: this.status.errorCount + 1,
        lastMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.teardownWorker();
  }

  private spawnWorker(): void {
    if (this.destroyed || typeof Worker === 'undefined' || typeof Blob === 'undefined') {
      return;
    }
    this.teardownWorker();

    const blob = new Blob([buildSandboxWorkerSource()], {
      type: 'application/javascript',
    });
    const url = URL.createObjectURL(blob);
    this.workerUrl = url;

    const worker = new Worker(url);
    this.worker = worker;
    this.initialized = false;
    this.inFlightRequestId = null;

    worker.onmessage = (ev: MessageEvent<WorkerReplyMessage>) => {
      if (this.destroyed || worker !== this.worker) return;
      const msg = ev.data;
      if (!msg) return;

      if (msg.type === 'init_ok') {
        this.clearWatchdog();
        this.initialized = true;
        this.status = {
          ...this.status,
          state: 'running',
        };
        return;
      }

      if (msg.type === 'init_err') {
        this.clearWatchdog();
        this.initialized = false;
        this.latestIntent = createEmptyIntent(this.validActionIds);
        this.status = {
          ...this.status,
          state: 'error',
          errorCount: this.status.errorCount + 1,
          lastMessage: msg.error ?? '脚本初始化失败',
        };
        this.teardownWorker();
        this.respawnAtMs = Number.POSITIVE_INFINITY;
        return;
      }

      if (msg.type === 'decide_ok' && msg.requestId === this.inFlightRequestId) {
        this.clearWatchdog();
        this.inFlightRequestId = null;
        this.latestIntent = sanitizeBotActionIntent(msg.intent, this.validActionIds);
        const ms = typeof msg.elapsedMs === 'number' ? msg.elapsedMs : 0;
        this.samples += 1;
        this.status = {
          ...this.status,
          state: 'running',
          avgMs:
            this.samples === 1
              ? ms
              : this.status.avgMs * 0.85 + ms * 0.15,
        };
        return;
      }

      if (msg.type === 'decide_err' && msg.requestId === this.inFlightRequestId) {
        this.clearWatchdog();
        this.inFlightRequestId = null;
        this.latestIntent = createEmptyIntent(this.validActionIds);
        this.status = {
          ...this.status,
          state: 'error',
          errorCount: this.status.errorCount + 1,
          lastMessage: msg.error ?? '单步决策抛出异常',
        };
      }
    };

    worker.onerror = (ev) => {
      if (this.destroyed || worker !== this.worker) return;
      this.clearWatchdog();
      this.inFlightRequestId = null;
      this.latestIntent = createEmptyIntent(this.validActionIds);
      this.status = {
        ...this.status,
        state: 'error',
        errorCount: this.status.errorCount + 1,
        lastMessage: ev.message || 'Worker 运行时错误',
      };
      this.teardownWorker();
      this.respawnAtMs = performance.now() + WORKER_RESPAWN_COOLDOWN_MS;
    };

    this.clearWatchdog();
    this.watchdogTimer = window.setTimeout(() => {
      if (!this.initialized && !this.destroyed) {
        this.handleHardTimeout(-1);
      }
    }, WORKER_INIT_TIMEOUT_MS);

    const initMsg: WorkerInitMessage = {
      type: 'init',
      compiledBody: this.compiledBody,
      slotId: this.slotId,
      seed: this.seed,
      validActionIds: this.validActionIds,
    };
    worker.postMessage(initMsg);
  }

  private handleHardTimeout(requestId: number): void {
    if (this.destroyed) return;
    if (requestId !== -1 && this.inFlightRequestId !== requestId) return;

    this.clearWatchdog();
    this.inFlightRequestId = null;
    this.latestIntent = createEmptyIntent(this.validActionIds);
    this.teardownWorker();

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.respawnAtMs = now + WORKER_RESPAWN_COOLDOWN_MS;
    this.status = {
      ...this.status,
      state: 'timeout',
      timeoutCount: this.status.timeoutCount + 1,
      lastMessage:
        requestId === -1
          ? `初始化超过 ${WORKER_INIT_TIMEOUT_MS}ms（疑似死循环），已强杀隔离`
          : `单步决策超过 ${WORKER_DECIDE_HARD_TIMEOUT_MS}ms（疑似死循环），已强杀熔断`,
    };
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer !== null) {
      window.clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private teardownWorker(): void {
    this.clearWatchdog();
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        // ignore
      }
      this.worker = null;
    }
    if (this.workerUrl) {
      try {
        URL.revokeObjectURL(this.workerUrl);
      } catch {
        // ignore
      }
      this.workerUrl = null;
    }
    this.initialized = false;
    this.inFlightRequestId = null;
  }
}

export interface DryRunValidationParams<TWorld> {
  rawCode: string;
  validActionIds: readonly string[];
  ticks?: number;
  seed?: number;
  createDryRun: () => {
    world: TWorld;
    selfSlotId: PlayerSlotId;
    buildObservation: (world: TWorld, selfSlotId: PlayerSlotId, tick: number) => unknown;
    stepWorld: (intent: BotActionIntent, dtSeconds: number) => void;
  };
}

/**
 * 沙箱试跑校验器（在浏览器中启用真实独立 Web Worker，彻底拦截死循环与运行时报错）：
 * - 步骤 1：提取代码并转译 JS/TS
 * - 步骤 2：在隔离 Worker 中初始化脚本（350ms 强杀保护）
 * - 步骤 3：连续驱动真实地图 120 帧无头试跑（每步 150ms 硬超时保护），统计耗时与触发动作
 */
export async function validateCustomBotInWorker<TWorld>(
  params: DryRunValidationParams<TWorld>
): Promise<BotValidationReport> {
  const checkedAt = Date.now();
  const transpiled = transpileUserBotScript(params.rawCode);
  if (!transpiled.ok) {
    return {
      status: 'error',
      checkedAt,
      ticksSimulated: 0,
      avgDecisionMs: 0,
      maxDecisionMs: 0,
      actionsTriggered: [],
      errorMessage: transpiled.errorMessage,
    };
  }

  const totalTicks = params.ticks ?? 120;
  const seed = params.seed ?? 20260401;
  const sim = params.createDryRun();

  // 浏览器环境：使用独立 Blob Web Worker 彻底隔离并防护死循环
  if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined') {
    const blob = new Blob([buildSandboxWorkerSource()], {
      type: 'application/javascript',
    });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);

    const cleanup = () => {
      try {
        worker.terminate();
      } catch {
        // ignore
      }
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    };

    const callWorker = (
      msg: WorkerInitMessage | WorkerDecideMessage,
      timeoutMs: number
    ): Promise<WorkerReplyMessage> =>
      new Promise((resolve, reject) => {
        let settled = false;
        const timer = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(
            new Error(
              msg.type === 'init'
                ? `脚本初始化超过 ${timeoutMs}ms（可能存在顶层死循环），沙箱已自动终止。`
                : `第 ${msg.requestId} 步决策超过 ${timeoutMs}ms（可能存在死循环或过度计算），沙箱已强杀保护。`
            )
          );
        }, timeoutMs);

        worker.onmessage = (ev: MessageEvent<WorkerReplyMessage>) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          resolve(ev.data);
        };
        worker.onerror = (ev) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          reject(new Error(ev.message || 'Worker 运行时异常'));
        };
        worker.postMessage(msg);
      });

    try {
      const initReply = await callWorker(
        {
          type: 'init',
          compiledBody: transpiled.compiledBody,
          slotId: sim.selfSlotId,
          seed,
          validActionIds: [...params.validActionIds],
        },
        WORKER_INIT_TIMEOUT_MS
      );

      if (initReply.type !== 'init_ok') {
        cleanup();
        return {
          status: 'error',
          checkedAt,
          ticksSimulated: 0,
          avgDecisionMs: 0,
          maxDecisionMs: 0,
          actionsTriggered: [],
          errorMessage: initReply.error ?? '脚本初始化失败',
        };
      }

      const dtSeconds = 1 / 60;
      let totalMs = 0;
      let maxMs = 0;
      const triggered = new Set<string>();

      for (let tick = 1; tick <= totalTicks; tick += 1) {
        const obs = sim.buildObservation(sim.world, sim.selfSlotId, tick);
        const reply = await callWorker(
          {
            type: 'decide',
            requestId: tick,
            obs,
            dtSeconds,
          },
          WORKER_DECIDE_HARD_TIMEOUT_MS
        );

        if (reply.type !== 'decide_ok') {
          cleanup();
          return {
            status: 'error',
            checkedAt,
            ticksSimulated: tick - 1,
            avgDecisionMs: tick > 1 ? totalMs / (tick - 1) : 0,
            maxDecisionMs: maxMs,
            actionsTriggered: Array.from(triggered),
            errorMessage: `第 ${tick} 步执行报错：${reply.error ?? '未知错误'}`,
          };
        }

        const ms = reply.elapsedMs ?? 0;
        totalMs += ms;
        if (ms > maxMs) maxMs = ms;

        const cleanIntent = sanitizeBotActionIntent(reply.intent, params.validActionIds);
        for (const [k, v] of Object.entries(cleanIntent)) {
          if (v) triggered.add(k);
        }
        sim.stepWorld(cleanIntent, dtSeconds);
      }

      cleanup();
      return {
        status: 'verified',
        checkedAt,
        ticksSimulated: totalTicks,
        avgDecisionMs: Number((totalMs / totalTicks).toFixed(2)),
        maxDecisionMs: Number(maxMs.toFixed(2)),
        actionsTriggered: Array.from(triggered),
      };
    } catch (err) {
      cleanup();
      return {
        status: 'error',
        checkedAt,
        ticksSimulated: 0,
        avgDecisionMs: 0,
        maxDecisionMs: 0,
        actionsTriggered: [],
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Node 无头单元测试回退路径（同构逻辑验证，不依赖浏览器 Worker API）
  return evaluateBotScriptHeadless(
    transpiled.compiledBody,
    sim,
    params.validActionIds,
    totalTicks,
    seed,
    checkedAt
  );
}

/** 仅供 Node 无头测试环境使用的同构试跑校验 */
function evaluateBotScriptHeadless<TWorld>(
  compiledBody: string,
  sim: {
    world: TWorld;
    selfSlotId: PlayerSlotId;
    buildObservation: (world: TWorld, selfSlotId: PlayerSlotId, tick: number) => unknown;
    stepWorld: (intent: BotActionIntent, dtSeconds: number) => void;
  },
  validActionIds: readonly string[],
  totalTicks: number,
  seed: number,
  checkedAt: number
): BotValidationReport {
  try {
    // eslint-disable-next-line no-new-func
    const bag = new Function(compiledBody)() as {
      createBot?: (ctx: unknown) => unknown;
      decide?: (obs: unknown, state: unknown, dt: number) => unknown;
      defaultExport?: unknown;
      moduleExports?: unknown;
    };

    let s = (seed >>> 0) || 1;
    const ctx = {
      slotId: sim.selfSlotId,
      seed,
      random: () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
    };

    let decideFn: ((obs: unknown, state: Record<string, unknown>, dt: number) => unknown) | null =
      null;
    if (typeof bag.createBot === 'function') {
      const inst = bag.createBot(ctx) as
        | ((obs: unknown, state: Record<string, unknown>, dt: number) => unknown)
        | { decide?: (obs: unknown, state: Record<string, unknown>, dt: number) => unknown };
      if (typeof inst === 'function') decideFn = inst;
      else if (inst && typeof inst.decide === 'function') {
        decideFn = (obs, state, dt) => inst.decide!(obs, state, dt);
      }
    } else if (typeof bag.decide === 'function') {
      decideFn = bag.decide;
    } else if (typeof bag.defaultExport === 'function') {
      const fn = bag.defaultExport as (arg: unknown) => unknown;
      try {
        const inst = fn(ctx) as { decide?: (obs: unknown, state: Record<string, unknown>, dt: number) => unknown } | null;
        if (inst && typeof inst.decide === 'function') {
          decideFn = (obs, state, dt) => inst.decide!(obs, state, dt);
        } else {
          decideFn = fn as (obs: unknown, state: Record<string, unknown>, dt: number) => unknown;
        }
      } catch {
        decideFn = fn as (obs: unknown, state: Record<string, unknown>, dt: number) => unknown;
      }
    }

    if (!decideFn) {
      return {
        status: 'error',
        checkedAt,
        ticksSimulated: 0,
        avgDecisionMs: 0,
        maxDecisionMs: 0,
        actionsTriggered: [],
        errorMessage: '未找到有效的入口函数，请导出 createBot(ctx) 或 decide(obs, state)。',
      };
    }

    const botState: Record<string, unknown> = {};
    const dtSeconds = 1 / 60;
    let totalMs = 0;
    let maxMs = 0;
    const triggered = new Set<string>();

    for (let tick = 1; tick <= totalTicks; tick += 1) {
      const obs = sim.buildObservation(sim.world, sim.selfSlotId, tick);
      const t0 = performance.now();
      const rawIntent = decideFn(obs, botState, dtSeconds);
      const ms = performance.now() - t0;
      totalMs += ms;
      if (ms > maxMs) maxMs = ms;

      const cleanIntent = sanitizeBotActionIntent(rawIntent, validActionIds);
      for (const [k, v] of Object.entries(cleanIntent)) {
        if (v) triggered.add(k);
      }
      sim.stepWorld(cleanIntent, dtSeconds);
    }

    return {
      status: 'verified',
      checkedAt,
      ticksSimulated: totalTicks,
      avgDecisionMs: Number((totalMs / totalTicks).toFixed(2)),
      maxDecisionMs: Number(maxMs.toFixed(2)),
      actionsTriggered: Array.from(triggered),
    };
  } catch (err) {
    return {
      status: 'error',
      checkedAt,
      ticksSimulated: 0,
      avgDecisionMs: 0,
      maxDecisionMs: 0,
      actionsTriggered: [],
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
