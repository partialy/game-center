import type {
  MatchReplayData,
  ReplayCueSnap,
  ReplayEventKind,
  ReplaySnapshotEvent,
  SoundEventKind,
} from '../../../platform/games/contracts';
import { ITEM_LABELS, type TankEntity, type TankWorldState } from '../types';

/** 10 Hz 精细关键帧采样间隔（每 0.1s 采样一次，兼顾流畅复盘与低开销） */
const KEYFRAME_INTERVAL_SECONDS = 0.1;
/** 弹体反弹/开火/抵消即时关键帧的最小防抖间隔，避免连发瞬间产生冗余帧 */
const MICRO_EVENT_MIN_GAP_SECONDS = 0.045;
/** 内存中保留的最大快照帧数，超出后仅对普通关键帧做自适应抽稀，完整保留精彩事件 */
const MAX_REPLAY_EVENTS = 1800;

function computeShieldRatio(tank: TankEntity, battleTime: number): number | undefined {
  if (!tank.shield || tank.shield.durationSeconds <= 0) return undefined;
  const remaining = Math.max(0, tank.shield.expiresAtBattleTime - battleTime);
  return Math.round((remaining / tank.shield.durationSeconds) * 100) / 100;
}

function computeOffenseRatio(tank: TankEntity, battleTime: number): number | undefined {
  const offense = tank.offense;
  if (!offense) return undefined;
  if (offense.kind === 'rapid_fire' && offense.maxShots > 0) {
    const timeRatio =
      offense.durationSeconds > 0
        ? Math.max(0, offense.expiresAtBattleTime - battleTime) / offense.durationSeconds
        : 1;
    const shotRatio = Math.max(0, offense.remainingShots) / offense.maxShots;
    return Math.round(Math.min(timeRatio, shotRatio) * 100) / 100;
  }
  if (offense.durationSeconds <= 0) return 1;
  const remaining = Math.max(0, offense.expiresAtBattleTime - battleTime);
  return Math.round((remaining / offense.durationSeconds) * 100) / 100;
}

/**
 * 高精度对局快照事件记录器（纯逻辑，零 DOM 依赖）：
 * - 在回合开战、道具拾取、特殊道具出击、破盾、淘汰、回合结束瞬间记录精彩事件快照
 * - 在子弹撞墙反弹、普通开火、弹幕抵消时以轻量防抖补充精确拐点帧，杜绝轨迹切角
 * - 平时每 0.1s（10 Hz）采样一次含弹药、护盾进度、后坐力、履带相位与即时特效的轻量关键帧
 */
export class TankReplayRecorder {
  private readonly events: ReplaySnapshotEvent[] = [];
  private lastSampleRound = -1;
  private lastSampleBattleTime = -1;
  private lastMicroEventBattleTime = -1;

  recordSnapshot(
    world: TankWorldState,
    kind: ReplayEventKind,
    headline?: string,
    actorColorHex?: string
  ): void {
    const cues: ReplayCueSnap[] = [];
    for (let i = 0; i < world.visualCues.length && cues.length < 8; i += 1) {
      const c = world.visualCues[i];
      if (
        c.kind === 'muzzle' ||
        c.kind === 'bounce' ||
        c.kind === 'cancel' ||
        c.kind === 'pickup' ||
        c.kind === 'shield_break'
      ) {
        cues.push({
          kind: c.kind,
          x: Math.round(c.x * 10) / 10,
          y: Math.round(c.y * 10) / 10,
          colorHex: c.colorHex,
          angle: c.angle !== undefined ? Math.round(c.angle * 1000) / 1000 : undefined,
          progress: 0.15,
        });
      }
    }

    const snap: ReplaySnapshotEvent = {
      index: this.events.length,
      roundNumber: world.roundNumber,
      battleTime: Math.round(world.battleTime * 100) / 100,
      totalTime: Math.round((world.totalBattleTime + world.battleTime) * 100) / 100,
      kind,
      headline,
      actorColorHex,
      scores: { ...world.scores },
      tanks: world.tanks.map((t) => ({
        slotId: t.slotId,
        displayName: t.displayName,
        colorHex: t.colorHex,
        x: Math.round(t.x * 10) / 10,
        y: Math.round(t.y * 10) / 10,
        angle: Math.round(t.angle * 1000) / 1000,
        alive: t.alive,
        hasShield: Boolean(t.shield),
        offenseKind: t.offense ? t.offense.kind : null,
        ammo: t.ammo,
        maxAmmo: t.maxAmmo,
        shieldRatio: computeShieldRatio(t, world.battleTime),
        offenseRatio: computeOffenseRatio(t, world.battleTime),
        recoil: t.recoilOffset > 0.05 ? Math.round(t.recoilOffset * 100) / 100 : 0,
        treadPhase: Math.round((t.treadDistance % 16) * 10) / 10,
      })),
      projectiles: world.projectiles.map((p) => ({
        id: p.id,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        vx: Math.round(p.vx),
        vy: Math.round(p.vy),
        radius: p.radius,
        colorHex: p.colorHex,
        source: p.source,
      })),
      drops: world.drops.map((d) => ({
        id: d.id,
        kind: d.kind,
        x: Math.round(d.x),
        y: Math.round(d.y),
      })),
      mines: world.mines.map((m) => ({
        id: m.id,
        x: Math.round(m.x),
        y: Math.round(m.y),
        colorHex: m.colorHex,
        armed: world.battleTime + 1e-9 >= m.armedAtBattleTime,
      })),
      laserBeams: world.laserBeams.map((b) => ({
        colorHex: b.colorHex,
        alpha:
          b.maxVisualSeconds > 0
            ? Math.round(
                Math.max(0.15, Math.min(1, b.remainingVisualSeconds / b.maxVisualSeconds)) * 100
              ) / 100
            : 1,
        points: b.points.map((pt) => ({
          x: Math.round(pt.x),
          y: Math.round(pt.y),
        })),
      })),
      explosions: world.explosions.map((e) => ({
        x: Math.round(e.x),
        y: Math.round(e.y),
        radius: e.radius,
        colorHex: e.colorHex,
        progress:
          e.maxVisualSeconds > 0
            ? Math.round(
                Math.max(0, Math.min(1, 1 - e.remainingVisualSeconds / e.maxVisualSeconds)) * 100
              ) / 100
            : 0.4,
      })),
      cues: cues.length > 0 ? cues : undefined,
    };

    this.events.push(snap);
    this.lastSampleRound = world.roundNumber;
    this.lastSampleBattleTime = world.battleTime;

    if (this.events.length > MAX_REPLAY_EVENTS) {
      this.compactKeyframes();
    }
  }

  /** 根据本模拟步产生的声音、视觉与结算事件自动决定是否记录精彩事件、拐点帧或周期关键帧 */
  recordStep(
    world: TankWorldState,
    sounds: SoundEventKind[],
    eliminatedSlotIds: ReadonlySet<string>,
    roundEndedReason?: string
  ): void {
    // 零分配扫描音效列表，避免每模拟步额外创建 Set
    let hasShieldBreak = false;
    let hasLaser = false;
    let hasFrag = false;
    let hasHoming = false;
    let hasShotgun = false;
    let hasMine = false;
    let hasPickup = false;
    let hasMicroMotionEvent = false;

    for (let i = 0; i < sounds.length; i += 1) {
      const s = sounds[i];
      if (s === 'shield_break') hasShieldBreak = true;
      else if (s === 'fire_laser') hasLaser = true;
      else if (s === 'fire_frag') hasFrag = true;
      else if (s === 'fire_homing') hasHoming = true;
      else if (s === 'fire_shotgun') hasShotgun = true;
      else if (s === 'place_mine') hasMine = true;
      else if (s === 'pickup') hasPickup = true;
      else if (s === 'bounce' || s === 'fire_normal' || s === 'cancel_bullet') {
        hasMicroMotionEvent = true;
      }
    }

    if (roundEndedReason) {
      const winner = world.tanks.find((t) => t.slotId === world.roundWinnerSlotId);
      this.recordSnapshot(
        world,
        'round_end',
        `第 ${world.roundNumber} 回合 · ${roundEndedReason}`,
        winner?.colorHex
      );
      return;
    }

    if (eliminatedSlotIds.size > 0) {
      const fallenNames = world.tanks
        .filter((t) => eliminatedSlotIds.has(t.slotId))
        .map((t) => t.displayName);
      const survivor = world.tanks.find((t) => t.alive);
      this.recordSnapshot(
        world,
        'elimination',
        fallenNames.length > 1
          ? `同刻淘汰：${fallenNames.join(' 与 ')}`
          : `${fallenNames[0] ?? '坦克'} 被击毁`,
        survivor?.colorHex
      );
      return;
    }

    if (hasShieldBreak) {
      const cue = world.visualCues.find((c) => c.kind === 'shield_break');
      this.recordSnapshot(world, 'shield_break', '护盾被击破', cue?.colorHex);
      return;
    }

    if (hasLaser || hasFrag || hasHoming || hasShotgun || hasMine) {
      const label = hasLaser
        ? '发射 激光'
        : hasFrag
        ? '发射 破片弹'
        : hasHoming
        ? '发射 追踪弹'
        : hasShotgun
        ? '发射 三连发散弹'
        : '布置 隐形地雷';
      const actorCue = world.visualCues.find((c) => c.kind === 'muzzle');
      this.recordSnapshot(world, 'fire_special', label, actorCue?.colorHex);
      return;
    }

    if (hasPickup) {
      const cue = world.visualCues.find((c) => c.kind === 'pickup');
      const picker = cue
        ? world.tanks.find((t) => t.colorHex === cue.colorHex)
        : undefined;
      const itemKind = picker?.offense?.kind ?? (picker?.shield ? 'shield' : undefined);
      const itemLabel = itemKind ? ITEM_LABELS[itemKind] : '战术道具';
      this.recordSnapshot(
        world,
        'pickup',
        `${picker ? `${picker.displayName} ` : ''}拾取 ${itemLabel}`,
        picker?.colorHex ?? cue?.colorHex
      );
      return;
    }

    // 精确捕捉反弹/开火/抵消拐点帧（带轻量防抖，既保证弹道折角精确又不刷爆帧数）
    const roundChanged = this.lastSampleRound !== world.roundNumber;
    if (
      hasMicroMotionEvent &&
      (roundChanged ||
        world.battleTime - this.lastMicroEventBattleTime >= MICRO_EVENT_MIN_GAP_SECONDS)
    ) {
      this.lastMicroEventBattleTime = world.battleTime;
      this.recordSnapshot(world, 'keyframe');
      return;
    }

    // 定期 10 Hz 采样关键帧以支撑丝滑动画与精细复盘
    if (
      roundChanged ||
      world.battleTime - this.lastSampleBattleTime >= KEYFRAME_INTERVAL_SECONDS
    ) {
      this.recordSnapshot(world, 'keyframe');
    }
  }

  /** 当超长对局达到上限时稀疏化非精彩普通帧，完整保留所有精彩事件与关键特效帧 */
  private compactKeyframes(): void {
    let toggle = false;
    const kept: ReplaySnapshotEvent[] = [];
    for (let i = 0; i < this.events.length; i += 1) {
      const ev = this.events[i];
      if (ev.kind !== 'keyframe') {
        kept.push(ev);
      } else {
        toggle = !toggle;
        if (toggle) kept.push(ev);
      }
    }
    this.events.length = 0;
    for (let i = 0; i < kept.length; i += 1) {
      kept[i].index = i;
      this.events.push(kept[i]);
    }
  }

  exportReplay(world: TankWorldState): MatchReplayData {
    return {
      arenaWidth: world.maze.width,
      arenaHeight: world.maze.height,
      gridCols: world.maze.cols,
      gridRows: world.maze.rows,
      sampleRateHz: Math.round(1 / KEYFRAME_INTERVAL_SECONDS),
      walls: world.maze.walls.map((w) => ({
        x1: w.x1,
        y1: w.y1,
        x2: w.x2,
        y2: w.y2,
      })),
      events: this.events.map((ev, idx) => ({
        ...ev,
        index: idx,
      })),
    };
  }
}
