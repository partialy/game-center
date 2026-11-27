import type {
  ActionInputState,
  AnalogMoveVector,
  BotAgentInstance,
  BotRuntimeStatus,
  GameDefinition,
  GameRenderer,
  GameSession,
  HudState,
  InputFrame,
  MatchLaunchSnapshot,
  MatchResultEvent,
  PlayerConfig,
  PlayerSlotId,
} from '../games/contracts';
import { WorkerBotRunner } from '../ai/workerSandbox';
import { KeyboardInputHub } from '../input/keyboard';
import { VirtualTouchInputSource } from '../input/virtualInput';
import { soundEngine } from './audio';

const FIXED_STEP_SECONDS = 1 / 60;
const MAX_FRAME_DT_SECONDS = 0.05;
const WORKER_DISPATCH_EVERY_N_TICKS = 2; // 30Hz 异步观测派发，兼顾低延迟与 60FPS 零卡顿

const IDLE_ACTION_STATE: ActionInputState = {
  held: false,
  justPressed: false,
  justReleased: false,
};

function hashSlotSeed(baseSeed: number, slotId: string): number {
  let h = (baseSeed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < slotId.length; i += 1) {
    h = Math.imul(h ^ slotId.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return h || 1;
}

/**
 * 统一 AI 输入驱动器（同时支持内置同步 TS 脚本与外部隔离 Web Worker 自定义脚本）：
 * - 内置 AI 槽位：60Hz 同步调用 decide()，保持既有确定性与零开销
 * - 自定义 AI 槽位：每 2 帧（30Hz）向独立 Blob Worker 异步派发观测快照并缓存最新动作意图，绝不阻塞主线程
 * - 自动维护上一帧按住状态，合成精确的 held / justPressed / justReleased 边沿信号
 */
export class BotInputDriver<TWorld = unknown> {
  private readonly syncAgents = new Map<PlayerSlotId, BotAgentInstance<TWorld>>();
  private readonly workerRunners = new Map<PlayerSlotId, WorkerBotRunner>();
  private readonly prevHeldBySlot = new Map<PlayerSlotId, Record<string, boolean>>();
  private readonly buildObservation?: (
    world: TWorld,
    selfSlotId: PlayerSlotId,
    tick: number
  ) => unknown;
  private tickCounter = 0;

  constructor(
    game: Pick<
      GameDefinition<never, TWorld>,
      'botModels' | 'defaultBotModelId' | 'actions' | 'aiSdk'
    >,
    players: PlayerConfig[],
    sessionSeed: number
  ) {
    const models = game.botModels ?? [];
    const validActionIds = (game.actions ?? []).map((a) => a.id);
    this.buildObservation = game.aiSdk
      ? (w, id, tick) => game.aiSdk!.buildObservation(w, id, tick)
      : undefined;

    const fallbackModel =
      models.find((m) => m.id === game.defaultBotModelId) ?? models[0];

    for (const player of players) {
      if (player.controller !== 'ai') continue;
      const seed = hashSlotSeed(sessionSeed, player.slotId);

      // 自定义外部脚本：统一托管至独立 Web Worker 沙箱
      if (
        player.aiSource === 'custom' &&
        typeof player.customBotCode === 'string' &&
        player.customBotCode.trim().length > 0 &&
        this.buildObservation
      ) {
        const runner = new WorkerBotRunner(
          player.slotId,
          player.customBotCode,
          seed,
          validActionIds
        );
        this.workerRunners.set(player.slotId, runner);
        this.prevHeldBySlot.set(player.slotId, {});
        continue;
      }

      const model =
        models.find((m) => m.id === player.aiModelId) ?? fallbackModel;
      if (!model) continue;
      this.syncAgents.set(player.slotId, model.createAgent(seed));
      this.prevHeldBySlot.set(player.slotId, {});
    }
  }

  hasBots(): boolean {
    return this.syncAgents.size > 0 || this.workerRunners.size > 0;
  }

  hasWorkerBots(): boolean {
    return this.workerRunners.size > 0;
  }

  getRuntimeStatuses(): Record<PlayerSlotId, BotRuntimeStatus> {
    const out: Record<PlayerSlotId, BotRuntimeStatus> = {};
    for (const [slotId, runner] of this.workerRunners.entries()) {
      out[slotId] = runner.getStatus();
    }
    return out;
  }

  resetEdges(): void {
    for (const slotId of this.prevHeldBySlot.keys()) {
      this.prevHeldBySlot.set(slotId, {});
    }
  }

  destroy(): void {
    for (const runner of this.workerRunners.values()) {
      runner.destroy();
    }
    this.workerRunners.clear();
    this.syncAgents.clear();
    this.prevHeldBySlot.clear();
  }

  composeFrame(
    world: TWorld,
    dtSeconds: number,
    humanFrame: InputFrame
  ): InputFrame {
    if (this.syncAgents.size === 0 && this.workerRunners.size === 0) {
      return humanFrame;
    }

    this.tickCounter += 1;
    const shouldDispatchWorker =
      this.tickCounter === 1 || this.tickCounter % WORKER_DISPATCH_EVERY_N_TICKS === 0;

    const aiStatesBySlot = new Map<PlayerSlotId, Record<string, ActionInputState>>();

    const commitSlotIntent = (slotId: PlayerSlotId, intent: Record<string, boolean>) => {
      const prevHeld = this.prevHeldBySlot.get(slotId) ?? {};
      const nextHeld: Record<string, boolean> = {};
      const slotStates: Record<string, ActionInputState> = {};

      const actionKeys = new Set<string>([
        ...Object.keys(prevHeld),
        ...Object.keys(intent),
      ]);

      for (const actionId of actionKeys) {
        const held = Boolean(intent[actionId]);
        const wasHeld = Boolean(prevHeld[actionId]);
        if (held) {
          nextHeld[actionId] = true;
        }
        slotStates[actionId] = {
          held,
          justPressed: held && !wasHeld,
          justReleased: !held && wasHeld,
        };
      }

      this.prevHeldBySlot.set(slotId, nextHeld);
      aiStatesBySlot.set(slotId, slotStates);
    };

    for (const [slotId, agent] of this.syncAgents.entries()) {
      const intent = agent.decide(world, slotId, dtSeconds);
      commitSlotIntent(slotId, intent);
    }

    for (const [slotId, runner] of this.workerRunners.entries()) {
      if (shouldDispatchWorker && this.buildObservation) {
        const obs = this.buildObservation(world, slotId, this.tickCounter);
        runner.dispatchObservation(obs, dtSeconds * WORKER_DISPATCH_EVERY_N_TICKS);
      }
      commitSlotIntent(slotId, runner.getLatestIntent());
    }

    return {
      getAction(slotId: PlayerSlotId, actionId: string): ActionInputState {
        const aiSlot = aiStatesBySlot.get(slotId);
        if (aiSlot) {
          return aiSlot[actionId] ?? IDLE_ACTION_STATE;
        }
        return humanFrame.getAction(slotId, actionId);
      },
      getMoveVector(slotId: PlayerSlotId): AnalogMoveVector | null {
        if (aiStatesBySlot.has(slotId)) {
          return null;
        }
        return humanFrame.getMoveVector?.(slotId) ?? null;
      },
    };
  }
}

export interface SessionHostCallbacks {
  onHudUpdate: (hud: HudState) => void;
  onPausedChange: (paused: boolean, reason?: string) => void;
  onMatchFinished: (result: MatchResultEvent) => void;
  /** 可选：自定义 Worker AI 运行状态变化时回调（用于实时超时/报错状态显示） */
  onBotStatusUpdate?: (statuses: Record<PlayerSlotId, BotRuntimeStatus>) => void;
  /** 可选：每渲染帧回调一次，用于开发者调试模式下的实时 FPS 与 AI 耗时监控 */
  onFrame?: (timestampMs: number, simSteps: number, aiComputeMs: number) => void;
}

/**
 * 平台会话宿主：
 * - 以固定 60 步/秒驱动模拟，单调时钟累加并限制帧间隔 <= 0.05s
 * - 自动路由人类键盘输入、内置 AI 与隔离 Worker 自定义 AI 输入（支持 2~8 席混战）
 * - 独立管理 Canvas DPR 缩放与 ResizeObserver
 * - 统一处理暂停、标签页切入后台自动暂停与恢复时重置时间基准
 * - 仅在 HUD 离散展示内容发生变化时通知 React，避免 60Hz 无效重渲染
 */
export class SessionHost<TRules = Record<string, unknown>, TWorld = unknown> {
  private readonly session: GameSession<TWorld>;
  private readonly renderer: GameRenderer<TWorld>;
  private readonly inputHub: KeyboardInputHub;
  private readonly virtualInput = new VirtualTouchInputSource();
  private readonly primaryHumanSlotId: PlayerSlotId | null;
  private readonly botDriver: BotInputDriver<TWorld>;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly callbacks: SessionHostCallbacks;

  private rafId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private lastTimestampMs: number | null = null;
  private accumulatorSeconds = 0;
  private paused = false;
  private destroyed = false;
  private matchFinishedEmitted = false;
  private lastHudSignature = '';
  private lastBotStatusSignature = '';

  constructor(
    game: GameDefinition<TRules, TWorld>,
    snapshot: MatchLaunchSnapshot<TRules>,
    canvas: HTMLCanvasElement,
    callbacks: SessionHostCallbacks
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('无法初始化 2D 渲染上下文');
    }
    this.ctx = ctx;
    this.callbacks = callbacks;
    this.session = game.createSession(snapshot);
    this.renderer = game.createRenderer();
    this.renderer.setDebugMode?.(false);

    // 仅将人类玩家接入键盘监听，AI 槽位不占用任何物理键位（Esc 暂停仍始终可用）
    const humanPlayers = snapshot.players.filter((p) => p.controller !== 'ai');
    this.primaryHumanSlotId = humanPlayers[0]?.slotId ?? null;
    this.inputHub = new KeyboardInputHub(humanPlayers, () => {
      this.togglePause('user');
    });
    this.botDriver = new BotInputDriver(
      game as unknown as GameDefinition<never, TWorld>,
      snapshot.players,
      snapshot.sessionSeed
    );
  }

  start(): void {
    if (this.destroyed) return;
    this.inputHub.attach();
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    this.resizeCanvas();
    if (typeof ResizeObserver !== 'undefined' && this.canvas.parentElement) {
      this.resizeObserver = new ResizeObserver(() => {
        this.resizeCanvas();
      });
      this.resizeObserver.observe(this.canvas.parentElement);
    }
    window.addEventListener('resize', this.handleWindowResize);

    // 首次发布 HUD 并绘制初始帧
    this.publishHudIfChanged(true);
    this.renderer.render(this.ctx, this.session.getWorldState(), 0);

    this.lastTimestampMs = null;
    this.rafId = window.requestAnimationFrame(this.loop);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.inputHub.detach();
    this.virtualInput.clearAll();
    this.botDriver.destroy();
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('resize', this.handleWindowResize);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  isPaused(): boolean {
    return this.paused;
  }

  pause(reason = 'user'): void {
    if (this.destroyed || this.paused || this.matchFinishedEmitted) return;
    this.paused = true;
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.inputHub.clearAll();
    this.virtualInput.clearAll();
    this.botDriver.resetEdges();
    this.accumulatorSeconds = 0;
    this.lastTimestampMs = null;
    this.renderer.render(this.ctx, this.session.getWorldState(), 0);
    this.callbacks.onPausedChange(true, reason);
  }

  resume(): void {
    if (this.destroyed || !this.paused || this.matchFinishedEmitted) return;
    this.paused = false;
    this.inputHub.clearAll();
    this.virtualInput.clearAll();
    this.botDriver.resetEdges();
    this.accumulatorSeconds = 0;
    this.lastTimestampMs = null;
    this.callbacks.onPausedChange(false);
    if (this.rafId === null && !this.destroyed) {
      this.rafId = window.requestAnimationFrame(this.loop);
    }
  }

  togglePause(reason = 'user'): void {
    if (this.paused) {
      this.resume();
    } else {
      this.pause(reason);
    }
  }

  setVirtualMoveStick(x: number, y: number, magnitude: number): void {
    if (this.paused || !this.primaryHumanSlotId) return;
    this.virtualInput.setMoveStick(x, y, magnitude);
  }

  setVirtualFirePressed(pressed: boolean): void {
    this.setVirtualActionPressed('fire', pressed, true);
  }

  setVirtualActionPressed(actionId: string, pressed: boolean, autoRepeat = false): void {
    if (this.paused || !this.primaryHumanSlotId) {
      if (!pressed) this.virtualInput.setActionPressed(actionId, false, autoRepeat);
      return;
    }
    this.virtualInput.setActionPressed(actionId, pressed, autoRepeat);
  }

  setDebugMode(enabled: boolean): void {
    this.renderer.setDebugMode?.(enabled);
    if (this.paused && !this.destroyed) {
      this.renderer.render(this.ctx, this.session.getWorldState(), 0);
    }
  }

  getSession(): GameSession<TWorld> {
    return this.session;
  }

  syncHudNow(): void {
    if (this.destroyed) return;
    this.publishHudIfChanged(true);
    if (this.paused) {
      this.renderer.render(this.ctx, this.session.getWorldState(), 0);
    }
  }

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden && !this.paused && !this.matchFinishedEmitted) {
      this.pause('background');
    }
  };

  private readonly handleWindowResize = (): void => {
    this.resizeCanvas();
  };

  private resizeCanvas(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    // 优先使用未受 CSS 90° 横屏旋转影响的布局宽高，回退 getBoundingClientRect
    const rawW = parent.clientWidth || parent.getBoundingClientRect().width;
    const rawH = parent.clientHeight || parent.getBoundingClientRect().height;
    const cssWidth = Math.max(240, Math.floor(rawW));
    const cssHeight = Math.max(180, Math.floor(rawH));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nextW = Math.round(cssWidth * dpr);
    const nextH = Math.round(cssHeight * dpr);
    if (this.canvas.width !== nextW || this.canvas.height !== nextH) {
      this.canvas.width = nextW;
      this.canvas.height = nextH;
    }
    this.renderer.resize(cssWidth, cssHeight, dpr);
    if (this.paused) {
      this.renderer.render(this.ctx, this.session.getWorldState(), 0);
    }
  }

  private readonly loop = (timestampMs: number): void => {
    if (this.destroyed || this.paused) {
      this.rafId = null;
      return;
    }

    if (this.lastTimestampMs === null) {
      this.lastTimestampMs = timestampMs;
    }
    const rawDt = Math.max(0, (timestampMs - this.lastTimestampMs) / 1000);
    this.lastTimestampMs = timestampMs;
    const frameDt = Math.min(rawDt, MAX_FRAME_DT_SECONDS);

    let steps = 0;
    let totalAiMs = 0;
    if (!this.matchFinishedEmitted) {
      this.accumulatorSeconds += frameDt;
      // 防止单帧执行过多补步导致掉帧雪崩
      const maxStepsPerFrame = 4;
      while (this.accumulatorSeconds >= FIXED_STEP_SECONDS && steps < maxStepsPerFrame) {
        const kbFrame = this.inputHub.sampleFrame();
        const humanFrame = this.composeHumanFrame(kbFrame, performance.now());
        const aiT0 = performance.now();
        const inputFrame = this.botDriver.composeFrame(
          this.session.getWorldState(),
          FIXED_STEP_SECONDS,
          humanFrame
        );
        totalAiMs += performance.now() - aiT0;
        const result = this.session.step(FIXED_STEP_SECONDS, inputFrame);
        for (const sound of result.sounds) {
          soundEngine.play(sound);
        }
        if (result.matchResult && !this.matchFinishedEmitted) {
          this.matchFinishedEmitted = true;
          this.publishHudIfChanged(true);
          this.callbacks.onMatchFinished(result.matchResult);
          break;
        }
        this.accumulatorSeconds -= FIXED_STEP_SECONDS;
        steps += 1;
      }
      this.publishHudIfChanged(false);
    }

    this.renderer.render(this.ctx, this.session.getWorldState(), frameDt);
    this.callbacks.onFrame?.(timestampMs, steps, totalAiMs);

    if (!this.destroyed && !this.paused && !this.matchFinishedEmitted) {
      this.rafId = window.requestAnimationFrame(this.loop);
    } else {
      this.rafId = null;
    }
  };

  private composeHumanFrame(kbFrame: InputFrame, nowMs: number): InputFrame {
    const touchSlotId = this.primaryHumanSlotId;
    if (!touchSlotId) {
      return kbFrame;
    }
    const virtualActions = this.virtualInput.sampleAllActions(nowMs);
    const hasVirtualActions = Object.keys(virtualActions).length > 0;
    const touchMove = this.virtualInput.getMoveVector();

    if (!hasVirtualActions && !touchMove) {
      return kbFrame;
    }

    return {
      getAction(slotId: PlayerSlotId, actionId: string): ActionInputState {
        const kb = kbFrame.getAction(slotId, actionId);
        if (slotId !== touchSlotId) {
          return kb;
        }
        const virt = virtualActions[actionId];
        if (!virt) {
          return kb;
        }
        return {
          held: kb.held || virt.held,
          justPressed: kb.justPressed || virt.justPressed,
          justReleased: (kb.justReleased && !virt.held) || (virt.justReleased && !kb.held),
        };
      },
      getMoveVector(slotId: PlayerSlotId): AnalogMoveVector | null {
        if (slotId === touchSlotId && touchMove) {
          return touchMove;
        }
        return kbFrame.getMoveVector?.(slotId) ?? null;
      },
    };
  }

  private publishHudIfChanged(force: boolean): void {
    const hud = this.session.getHudState();
    const signature = computeHudSignature(hud);
    if (force || signature !== this.lastHudSignature) {
      this.lastHudSignature = signature;
      this.callbacks.onHudUpdate(hud);
    }
    if (this.botDriver.hasWorkerBots() && this.callbacks.onBotStatusUpdate) {
      const statuses = this.botDriver.getRuntimeStatuses();
      const statusSig = Object.values(statuses)
        .map((s) => `${s.slotId}:${s.state}:${s.timeoutCount}:${s.errorCount}:${s.lastMessage ?? ''}`)
        .join('|');
      if (force || statusSig !== this.lastBotStatusSignature) {
        this.lastBotStatusSignature = statusSig;
        this.callbacks.onBotStatusUpdate(statuses);
      }
    }
  }
}

function computeHudSignature(hud: HudState): string {
  const parts: string[] = [
    hud.phase,
    String(hud.roundNumber),
    String(Math.ceil(hud.countdownSeconds * 10)),
    String(Math.floor(hud.battleElapsedSeconds)),
    hud.roundTimeRemainingSeconds === null
      ? '-'
      : String(Math.ceil(hud.roundTimeRemainingSeconds)),
    hud.roundBanner ? `${hud.roundBanner.roundNumber}:${hud.roundBanner.reason}:${Math.ceil(hud.roundBanner.nextRoundInSeconds)}` : '-',
    hud.customSignature ?? '-',
  ];
  for (const p of hud.players) {
    parts.push(
      `${p.slotId}:${p.score}:${p.alive ? 1 : 0}:${p.ammo}:${Math.round(p.reloadProgress * 20)}:${
        p.hp !== undefined ? Math.ceil(p.hp) : '-'
      }/${p.maxHp ?? '-'}:${p.weaponKind ?? '-'}:${p.weaponCount ?? '-'}:${p.nearbyPickupLabel ?? '-'}`
    );
    for (const s of p.statusItems) {
      parts.push(
        `${s.id}:${s.valueText}:${s.remainingSeconds !== undefined ? Math.ceil(s.remainingSeconds * 10) : '-'}:${s.remainingCharges ?? '-'}`
      );
    }
  }
  return parts.join('|');
}
