import type {
  MatchReplayData,
  PlayerSlotId,
  ReplayCueSnap,
  ReplayExplosionSnap,
  ReplayLaserSnap,
  ReplayProjectileSnap,
  ReplaySnapshotEvent,
  ReplayTankSnap,
} from '../games/contracts';
import { generateMazeFromCodeOrParams } from '../../games/tank-battle/map/generateMaze';

export const REPLAY_HIGHLIGHT_LABELS: Record<string, string> = {
  round_start: '回合开始',
  pickup: '拾取道具',
  fire_special: '道具出击',
  shield_break: '护盾击破',
  elimination: '关键淘汰',
  round_end: '回合结算',
};

export interface TankTrailPoint {
  x: number;
  y: number;
}

export interface TankTrailSeries {
  slotId: PlayerSlotId;
  colorHex: string;
  points: TankTrailPoint[];
}

/** 过滤出适合在事件日志与进度条上标示的关键精彩事件 */
export function getHighlightEvents(events: ReplaySnapshotEvent[]): ReplaySnapshotEvent[] {
  return events.filter((ev) => ev.kind !== 'keyframe');
}

/** 将步进下标安全钳制到合法范围 */
export function stepReplayIndex(
  currentIndex: number,
  delta: number,
  totalCount: number
): number {
  if (totalCount <= 0) return 0;
  return Math.max(0, Math.min(totalCount - 1, currentIndex + delta));
}

/** 跳转到上一个或下一个精彩事件（跳过普通采样帧） */
export function findAdjacentHighlightIndex(
  events: ReplaySnapshotEvent[],
  currentIndex: number,
  direction: -1 | 1
): number {
  if (events.length === 0) return 0;
  if (direction === 1) {
    for (let i = currentIndex + 1; i < events.length; i += 1) {
      if (events[i].kind !== 'keyframe') return i;
    }
    return events.length - 1;
  }
  for (let i = currentIndex - 1; i >= 0; i -= 1) {
    if (events[i].kind !== 'keyframe') return i;
  }
  return 0;
}

/** 沿最短圆弧插值角度（弧度） */
export function lerpAngleShortest(a: number, b: number, t: number): number {
  let delta = b - a;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}

function lerpOptional(a: number | undefined, b: number | undefined, t: number): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  const va = a ?? b ?? 0;
  const vb = b ?? a ?? 0;
  return va + (vb - va) * t;
}

/**
 * 在相邻两帧快照之间进行平滑插值，供 60 FPS 流畅复盘动画使用：
 * - 跨回合切换时不插值，直接展示 prev 帧，防止坦克瞬间飞越迷宫
 * - 同回合内插值坦克坐标/炮口角度/后坐力/履带/护盾比例，以及相同 id 弹体位置
 * - 对瞬发激光、爆炸波纹与特效闪光执行平滑衰减推进
 */
export function interpolateReplayFrame(
  prev: ReplaySnapshotEvent,
  next: ReplaySnapshotEvent | undefined,
  rawAlpha: number
): ReplaySnapshotEvent {
  const alpha = Math.max(0, Math.min(1, rawAlpha));
  if (!next || alpha <= 0 || prev.roundNumber !== next.roundNumber) {
    return prev;
  }
  if (alpha >= 1) {
    return next;
  }

  const dtSec = Math.max(0, Math.min(0.25, next.battleTime - prev.battleTime));

  const nextTankById = new Map<string, ReplayTankSnap>();
  for (let i = 0; i < next.tanks.length; i += 1) {
    nextTankById.set(next.tanks[i].slotId, next.tanks[i]);
  }

  const tanks: ReplayTankSnap[] = prev.tanks.map((pt) => {
    const nt = nextTankById.get(pt.slotId);
    if (!nt) return pt;
    return {
      ...pt,
      x: pt.x + (nt.x - pt.x) * alpha,
      y: pt.y + (nt.y - pt.y) * alpha,
      angle: lerpAngleShortest(pt.angle, nt.angle, alpha),
      recoil: lerpOptional(pt.recoil, nt.recoil, alpha),
      shieldRatio: lerpOptional(pt.shieldRatio, nt.shieldRatio, alpha),
      offenseRatio: lerpOptional(pt.offenseRatio, nt.offenseRatio, alpha),
      treadPhase: lerpOptional(pt.treadPhase, nt.treadPhase, alpha),
    };
  });

  const nextProjById = new Map<number, ReplayProjectileSnap>();
  for (let i = 0; i < next.projectiles.length; i += 1) {
    nextProjById.set(next.projectiles[i].id, next.projectiles[i]);
  }

  const projectiles: ReplayProjectileSnap[] = [];
  for (let i = 0; i < prev.projectiles.length; i += 1) {
    const pp = prev.projectiles[i];
    const np = nextProjById.get(pp.id);
    if (np) {
      projectiles.push({
        ...pp,
        x: pp.x + (np.x - pp.x) * alpha,
        y: pp.y + (np.y - pp.y) * alpha,
        vx: pp.vx + (np.vx - pp.vx) * alpha,
        vy: pp.vy + (np.vy - pp.vy) * alpha,
      });
    } else if (alpha < 0.65 && dtSec > 0) {
      // 在帧间即将命中的弹体做轻量速度外推，避免瞬间静止卡顿
      projectiles.push({
        ...pp,
        x: pp.x + pp.vx * dtSec * alpha * 0.8,
        y: pp.y + pp.vy * dtSec * alpha * 0.8,
      });
    }
  }

  const laserBeams: ReplayLaserSnap[] = prev.laserBeams.map((b) => ({
    ...b,
    alpha: Math.max(0.15, (b.alpha ?? 1) * (1 - alpha * 0.6)),
  }));

  const explosions: ReplayExplosionSnap[] = prev.explosions.map((e) => ({
    ...e,
    progress: Math.min(1, (e.progress ?? 0.35) + alpha * 0.45),
  }));

  const cues: ReplayCueSnap[] | undefined = prev.cues
    ? prev.cues
        .map((c) => ({
          ...c,
          progress: Math.min(1, (c.progress ?? 0.25) + alpha * 0.6),
        }))
        .filter((c) => (c.progress ?? 0) < 0.98)
    : undefined;

  return {
    ...prev,
    battleTime: prev.battleTime + (next.battleTime - prev.battleTime) * alpha,
    totalTime: prev.totalTime + (next.totalTime - prev.totalTime) * alpha,
    tanks,
    projectiles,
    laserBeams,
    explosions,
    cues: cues && cues.length > 0 ? cues : undefined,
  };
}

/**
 * 提取当前回合内各存活坦克的近期走位轨迹点（用于 Canvas 渲染战术轨迹线）。
 */
export function extractTankTrails(
  events: ReplaySnapshotEvent[],
  currentIndex: number,
  activeFrame: ReplaySnapshotEvent,
  maxPoints = 18
): TankTrailSeries[] {
  if (events.length === 0 || maxPoints < 2) return [];
  const safeIndex = Math.max(0, Math.min(events.length - 1, currentIndex));
  const roundNumber = activeFrame.roundNumber;

  const seriesMap = new Map<string, TankTrailSeries>();
  for (const t of activeFrame.tanks) {
    seriesMap.set(t.slotId, {
      slotId: t.slotId,
      colorHex: t.colorHex,
      points: [],
    });
  }

  // 向前扫描当前回合的历史快照，收集最多 maxPoints - 1 个轨迹采样点
  const startIdx = Math.max(0, safeIndex - maxPoints * 2);
  for (let i = startIdx; i <= safeIndex; i += 1) {
    const ev = events[i];
    if (!ev || ev.roundNumber !== roundNumber) continue;
    for (const tank of ev.tanks) {
      if (!tank.alive) continue;
      const series = seriesMap.get(tank.slotId);
      if (!series) continue;
      const prevPt = series.points[series.points.length - 1];
      if (!prevPt || Math.hypot(tank.x - prevPt.x, tank.y - prevPt.y) >= 2.5) {
        series.points.push({ x: tank.x, y: tank.y });
      }
    }
  }

  // 将当前实时插值位置追加至轨迹前端，确保播放时丝滑延伸
  for (const tank of activeFrame.tanks) {
    if (!tank.alive) continue;
    const series = seriesMap.get(tank.slotId);
    if (!series) continue;
    const prevPt = series.points[series.points.length - 1];
    if (!prevPt || Math.hypot(tank.x - prevPt.x, tank.y - prevPt.y) >= 1) {
      series.points.push({ x: tank.x, y: tank.y });
    }
    if (series.points.length > maxPoints) {
      series.points = series.points.slice(series.points.length - maxPoints);
    }
  }

  return Array.from(seriesMap.values()).filter((s) => s.points.length >= 2);
}

/**
 * 为本地历史记录持久化压缩超长录像：完整保留所有精彩事件帧，
 * 仅对普通关键帧做均匀抽稀，确保不触发 localStorage 配额溢出。
 */
export function compactReplayForStorage(
  replay: MatchReplayData,
  maxEvents = 220
): MatchReplayData {
  if (replay.events.length <= maxEvents) return replay;

  const highlights: ReplaySnapshotEvent[] = [];
  const keyframes: ReplaySnapshotEvent[] = [];
  for (const ev of replay.events) {
    if (ev.kind !== 'keyframe') highlights.push(ev);
    else keyframes.push(ev);
  }

  const remainingBudget = Math.max(0, maxEvents - highlights.length);
  const keptIndices = new Set<number>(highlights.map((h) => h.index));

  if (remainingBudget > 0 && keyframes.length > 0) {
    const stride = keyframes.length / remainingBudget;
    for (let i = 0; i < remainingBudget; i += 1) {
      const pick = keyframes[Math.min(keyframes.length - 1, Math.floor(i * stride))];
      if (pick) keptIndices.add(pick.index);
    }
  }

  const compacted = replay.events
    .filter((ev) => keptIndices.has(ev.index))
    .map((ev, idx) => ({
      ...ev,
      index: idx,
    }));

  return {
    ...replay,
    events: compacted,
  };
}

/** 格式化录像时间戳（分:秒.十分位） */
export function formatReplayTimestamp(seconds: number): string {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe - Math.floor(safe)) * 10);
  return `${mins}:${String(secs).padStart(2, '0')}.${tenths}`;
}

export type DemoReplayVariant = 'p1_win' | 'p2_comeback' | 'draw';

/**
 * 为 ?demoResults=1 验收模式生成一份包含真实迷宫与高密度 10Hz 战术精彩瞬间的确定性录像序列。
 */
export function createDemoReplayData(
  mapCode = 'TB1-10x7-08-3A9F0C12',
  variant: DemoReplayVariant = 'p1_win'
): MatchReplayData {
  const maze = generateMazeFromCodeOrParams({
    mapCode,
    cols: 10,
    rows: 7,
    extraPassages: 8,
    fallbackSeed: 0x3a9f0c12,
  });

  const events: ReplaySnapshotEvent[] = [];
  const push = (partial: Omit<ReplaySnapshotEvent, 'index'>) => {
    events.push({
      index: events.length,
      ...partial,
    });
  };

  if (variant === 'p2_comeback') {
    // P2 4:5 逆转险胜示范录像（中路直道对抗）
    push({
      roundNumber: 1,
      battleTime: 0,
      totalTime: 0,
      kind: 'round_start',
      headline: '第 1 回合开战',
      scores: { p1: 0, p2: 0 },
      tanks: [
        { slotId: 'p1', displayName: 'P1', colorHex: '#D9432B', x: 150, y: 150, angle: 0, alive: true, hasShield: false, offenseKind: null, ammo: 5, maxAmmo: 5 },
        { slotId: 'p2', displayName: 'P2', colorHex: '#2364C7', x: 850, y: 550, angle: Math.PI, alive: true, hasShield: false, offenseKind: null, ammo: 5, maxAmmo: 5 },
      ],
      projectiles: [],
      drops: [{ id: 1, kind: 'homing', x: 750, y: 550 }],
      mines: [],
      laserBeams: [],
      explosions: [],
    });

    push({
      roundNumber: 1,
      battleTime: 1.2,
      totalTime: 1.2,
      kind: 'pickup',
      headline: 'P2 拾取 追踪弹',
      actorColorHex: '#2364C7',
      scores: { p1: 0, p2: 0 },
      tanks: [
        { slotId: 'p1', displayName: 'P1', colorHex: '#D9432B', x: 260, y: 150, angle: 0.12, alive: true, hasShield: false, offenseKind: null, ammo: 4, maxAmmo: 5 },
        { slotId: 'p2', displayName: 'P2', colorHex: '#2364C7', x: 750, y: 550, angle: -2.9, alive: true, hasShield: false, offenseKind: 'homing', ammo: 5, maxAmmo: 5, offenseRatio: 1 },
      ],
      projectiles: [],
      drops: [],
      mines: [],
      laserBeams: [],
      explosions: [],
      cues: [{ kind: 'pickup', x: 750, y: 550, colorHex: '#2364C7', progress: 0.35 }],
    });

    push({
      roundNumber: 9,
      battleTime: 2.0,
      totalTime: 194.2,
      kind: 'fire_special',
      headline: 'P2 发射追踪弹 · 决胜追击',
      actorColorHex: '#2364C7',
      scores: { p1: 4, p2: 4 },
      tanks: [
        { slotId: 'p1', displayName: 'P1', colorHex: '#D9432B', x: 480, y: 350, angle: 0, alive: true, hasShield: false, offenseKind: null, ammo: 3, maxAmmo: 5 },
        { slotId: 'p2', displayName: 'P2', colorHex: '#2364C7', x: 740, y: 350, angle: Math.PI, alive: true, hasShield: true, offenseKind: null, ammo: 4, maxAmmo: 5, shieldRatio: 0.72, recoil: 0.8 },
      ],
      projectiles: [
        { id: 88, x: 645, y: 348, vx: -280, vy: 12, radius: 6, colorHex: '#2364C7', source: 'homing' },
      ],
      drops: [],
      mines: [],
      laserBeams: [],
      explosions: [],
      cues: [{ kind: 'muzzle', x: 712, y: 350, colorHex: '#2364C7', angle: Math.PI, progress: 0.3 }],
    });

    push({
      roundNumber: 9,
      battleTime: 2.7,
      totalTime: 194.9,
      kind: 'round_end',
      headline: 'P2 逆转赢得比赛（4 : 5）',
      actorColorHex: '#2364C7',
      scores: { p1: 4, p2: 5 },
      tanks: [
        { slotId: 'p1', displayName: 'P1', colorHex: '#D9432B', x: 495, y: 350, angle: 0, alive: false, hasShield: false, offenseKind: null, ammo: 3, maxAmmo: 5 },
        { slotId: 'p2', displayName: 'P2', colorHex: '#2364C7', x: 720, y: 350, angle: Math.PI, alive: true, hasShield: true, offenseKind: null, ammo: 4, maxAmmo: 5, shieldRatio: 0.65 },
      ],
      projectiles: [],
      drops: [],
      mines: [],
      laserBeams: [],
      explosions: [{ x: 495, y: 350, radius: 50, colorHex: '#D9432B', progress: 0.45 }],
    });

    return {
      arenaWidth: maze.width,
      arenaHeight: maze.height,
      gridCols: maze.cols,
      gridRows: maze.rows,
      sampleRateHz: 10,
      walls: maze.walls.map((w) => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 })),
      events,
    };
  }

  if (variant === 'draw') {
    push({
      roundNumber: 6,
      battleTime: 0,
      totalTime: 132.0,
      kind: 'round_start',
      headline: '第 6 回合开战（3 : 3 焦灼战）',
      scores: { p1: 3, p2: 3 },
      tanks: [
        { slotId: 'p1', displayName: 'P1', colorHex: '#D9432B', x: 470, y: 350, angle: 0, alive: true, hasShield: false, offenseKind: null, ammo: 5, maxAmmo: 5 },
        { slotId: 'p2', displayName: 'P2', colorHex: '#2364C7', x: 810, y: 350, angle: Math.PI, alive: true, hasShield: false, offenseKind: null, ammo: 5, maxAmmo: 5 },
      ],
      projectiles: [],
      drops: [],
      mines: [],
      laserBeams: [],
      explosions: [],
    });

    push({
      roundNumber: 6,
      battleTime: 1.4,
      totalTime: 133.4,
      kind: 'keyframe',
      scores: { p1: 3, p2: 3 },
      tanks: [
        { slotId: 'p1', displayName: 'P1', colorHex: '#D9432B', x: 545, y: 350, angle: 0, alive: true, hasShield: false, offenseKind: null, ammo: 4, maxAmmo: 5, recoil: 0.5 },
        { slotId: 'p2', displayName: 'P2', colorHex: '#2364C7', x: 735, y: 350, angle: Math.PI, alive: true, hasShield: false, offenseKind: null, ammo: 4, maxAmmo: 5, recoil: 0.5 },
      ],
      projectiles: [
        { id: 91, x: 615, y: 344, vx: 320, vy: 0, radius: 5, colorHex: '#D9432B', source: 'normal' },
        { id: 92, x: 665, y: 356, vx: -320, vy: 0, radius: 5, colorHex: '#2364C7', source: 'normal' },
      ],
      drops: [],
      mines: [],
      laserBeams: [],
      explosions: [],
    });

    push({
      roundNumber: 6,
      battleTime: 2.0,
      totalTime: 134.0,
      kind: 'round_end',
      headline: '同刻双淘汰 · 双方握手言和（3 : 3）',
      scores: { p1: 3, p2: 3 },
      tanks: [
        { slotId: 'p1', displayName: 'P1', colorHex: '#D9432B', x: 560, y: 350, angle: 0, alive: false, hasShield: false, offenseKind: null, ammo: 4, maxAmmo: 5 },
        { slotId: 'p2', displayName: 'P2', colorHex: '#2364C7', x: 720, y: 350, angle: Math.PI, alive: false, hasShield: false, offenseKind: null, ammo: 4, maxAmmo: 5 },
      ],
      projectiles: [],
      drops: [],
      mines: [],
      laserBeams: [],
      explosions: [
        { x: 560, y: 350, radius: 46, colorHex: '#D9432B', progress: 0.45 },
        { x: 720, y: 350, radius: 46, colorHex: '#2364C7', progress: 0.45 },
      ],
    });

    return {
      arenaWidth: maze.width,
      arenaHeight: maze.height,
      gridCols: maze.cols,
      gridRows: maze.rows,
      sampleRateHz: 10,
      walls: maze.walls.map((w) => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 })),
      events,
    };
  }

  // 主示范录像（TB1-10x7-08-3A9F0C12）：高密度连续关键帧 + 墙面反弹激光 + 散弹三连发 + 6枚破片弹收官
  // 第 1 回合（中路长廊 y=350, x=450..850）
  push({
    roundNumber: 1,
    battleTime: 0,
    totalTime: 0,
    kind: 'round_start',
    headline: '第 1 回合开战',
    scores: { p1: 0, p2: 0 },
    tanks: [
      { slotId: 'p1', displayName: 'P1', colorHex: '#D9432B', x: 455, y: 350, angle: 0, alive: true, hasShield: false, offenseKind: null, ammo: 5, maxAmmo: 5, treadPhase: 0 },
      { slotId: 'p2', displayName: 'P2', colorHex: '#2364C7', x: 845, y: 350, angle: Math.PI, alive: true, hasShield: false, offenseKind: null, ammo: 5, maxAmmo: 5, treadPhase: 0 },
    ],
    projectiles: [],
    drops: [
      { id: 1, kind: 'laser', x: 540, y: 350 },
      { id: 2, kind: 'shield', x: 755, y: 350 },
    ],
    mines: [],
    laserBeams: [],
    explosions: [],
  });

  push({
    roundNumber: 1,
    battleTime: 0.6,
    totalTime: 0.6,
    kind: 'keyframe',
    scores: { p1: 0, p2: 0 },
    tanks: [
      { slotId: 'p1', displayName: 'P1', colorHex: '#D9432B', x: 478, y: 350, angle: 0.03, alive: true, hasShield: false, offenseKind: null, ammo: 5, maxAmmo: 5, treadPhase: 6 },
      { slotId: 'p2', displayName: 'P2', colorHex: '#2364C7', x: 820, y: 350, angle: Math.PI, alive: true, hasShield: false, offenseKind: null, ammo: 4, maxAmmo: 5, recoil: 0.75, treadPhase: 6 },
    ],
    projectiles: [
      { id: 10, x: 778, y: 349, vx: -310, vy: 0, radius: 5, colorHex: '#2364C7', source: 'normal' },
    ],
    drops: [
      { id: 1, kind: 'laser', x: 540, y: 350 },
      { id: 2, kind: 'shield', x: 755, y: 350 },
    ],
    mines: [],
    laserBeams: [],
    explosions: [],
    cues: [{ kind: 'muzzle', x: 792, y: 350, colorHex: '#2364C7', angle: Math.PI, progress: 0.35 }],
  });

  push({
    roundNumber: 1,
    battleTime: 1.1,
    totalTime: 1.1,
    kind: 'keyframe',
    scores: { p1: 0, p2: 0 },
    tanks: [
      { slotId: 'p1', displayName: 'P1', colorHex: '#D9432B', x: 505, y: 354, angle: 0.06, alive: true, hasShield: false, offenseKind: null, ammo: 5, maxAmmo: 5, treadPhase: 12 },
      { slotId: 'p2', displayName: 'P2', colorHex: '#2364C7', x: 785, y: 352, angle: Math.PI, alive: true, hasShield: false, offenseKind: null, ammo: 4, maxAmmo: 5, treadPhase: 12 },
    ],
    projectiles: [
      { id: 10, x: 650, y: 346, vx: -310, vy: -12, radius: 5, colorHex: '#2364C7', source: 'normal' },
    ],
    drops: [
      { id: 1, kind: 'laser', x: 540, y: 350 },
      { id: 2, kind: 'shield', x: 755, y: 350 },
    ],
    mines: [],
    laserBeams: [],
    explosions: [],
  });

  push({
    roundNumber: 1,
    battleTime: 1.8,
    totalTime: 1.8,
    kind: 'pickup',
    headline: 'P1 拾取 激光',
    actorColorHex: '#D9432B',
    scores: { p1: 0, p2: 0 },
    tanks: [
      { slotId: 'p1', displayName: 'P1', colorHex: '#D9432B', x: 535, y: 356, angle: -0.46, alive: true, hasShield: false, offenseKind: 'laser', ammo: 5, maxAmmo: 5, offenseRatio: 1, treadPhase: 4 },
      { slotId: 'p2', displayName: 'P2', colorHex: '#2364C7', x: 745, y: 356, angle: Math.PI, alive: true, hasShield: true, offenseKind: null, ammo: 5, maxAmmo: 5, shieldRatio: 0.94, treadPhase: 4 },
    ],
    projectiles: [],
    drops: [],
    mines: [],
    laserBeams: [],
    explosions: [],
    cues: [
      { kind: 'pickup', x: 535, y: 356, colorHex: '#D9432B', progress: 0.25 },
      { kind: 'pickup', x: 745, y: 356, colorHex: '#0E6BA8', progress: 0.45 },
    ],
  });

  push({
    roundNumber: 1,
    battleTime: 2.3,
    totalTime: 2.3,
    kind: 'keyframe',
    scores: { p1: 0, p2: 0 },
    tanks: [
      { slotId: 'p1', displayName: 'P1', colorHex: '#D9432B', x: 495, y: 360, angle: -0.49, alive: true, hasShield: false, offenseKind: 'laser', ammo: 5, maxAmmo: 5, offenseRatio: 0.92, treadPhase: 10 },
      { slotId: 'p2', displayName: 'P2', colorHex: '#2364C7', x: 720, y: 358, angle: Math.PI, alive: true, hasShield: true, offenseKind: null, ammo: 5, maxAmmo: 5, shieldRatio: 0.86, treadPhase: 10 },
    ],
    projectiles: [],
    drops: [],
    mines: [],
    laserBeams: [],
    explosions: [],
  });

  push({
    roundNumber: 1,
    battleTime: 2.8,
    totalTime: 2.8,
    kind: 'shield_break',
    headline: 'P1 反弹激光 · 击破 P2 护盾',
    actorColorHex: '#D9432B',
    scores: { p1: 0, p2: 0 },
    tanks: [
      { slotId: 'p1', displayName: 'P1', colorHex: '#D9432B', x: 475, y: 362, angle: -0.5, alive: true, hasShield: false, offenseKind: null, ammo: 5, maxAmmo: 5, recoil: 0.9, treadPhase: 14 },
      { slotId: 'p2', displayName: 'P2', colorHex: '#2364C7', x: 705, y: 360, angle: Math.PI, alive: true, hasShield: false, offenseKind: null, ammo: 5, maxAmmo: 5, treadPhase: 14 },
    ],
    projectiles: [],
    drops: [],
    mines: [],
    laserBeams: [
      {
        colorHex: '#D9432B',
        alpha: 1,
        points: [
          { x: 499, y: 349 },
          { x: 582, y: 306 },
          { x: 688, y: 354 },
        ],
      },
    ],
    explosions: [{ x: 705, y: 360, radius: 36, colorHex: '#38BDF8', progress: 0.35 }],
    cues: [
      { kind: 'bounce', x: 582, y: 306, colorHex: '#F97316', progress: 0.3 },
      { kind: 'shield_break', x: 705, y: 360, colorHex: '#38BDF8', progress: 0.35 },
    ],
  });

  push({
    roundNumber: 1,
    battleTime: 3.4,
    totalTime: 3.4,
    kind: 'keyframe',
    scores: { p1: 0, p2: 0 },
    tanks: [
      { slotId: 'p1', displayName: 'P1', colorHex: '#D9432B', x: 515, y: 358, angle: -0.05, alive: true, hasShield: false, offenseKind: null, ammo: 4, maxAmmo: 5, recoil: 0.65, treadPhase: 4 },
      { slotId: 'p2', displayName: 'P2', colorHex: '#2364C7', x: 698, y: 357, angle: Math.PI, alive: true, hasShield: false, offenseKind: null, ammo: 5, maxAmmo: 5, treadPhase: 2 },
    ],
    projectiles: [
      { id: 11, x: 582, y: 356, vx: 320, vy: 0, radius: 5, colorHex: '#D9432B', source: 'normal' },
    ],
    drops: [],
    mines: [],
    laserBeams: [],
    explosions: [],
    cues: [{ kind: 'muzzle', x: 542, y: 356, colorHex: '#D9432B', angle: 0, progress: 0.45 }],
  });

  push({
    roundNumber: 1,
    battleTime: 3.8,
    totalTime: 3.8,
    kind: 'keyframe',
    scores: { p1: 0, p2: 0 },
    tanks: [
      { slotId: 'p1', displayName: 'P1', colorHex: '#D9432B', x: 535, y: 356, angle: 0.02, alive: true, hasShield: false, offenseKind: null, ammo: 4, maxAmmo: 5, treadPhase: 10 },
      { slotId: 'p2', displayName: 'P2', colorHex: '#2364C7', x: 692, y: 356, angle: Math.PI, alive: true, hasShield: false, offenseKind: null, ammo: 5, maxAmmo: 5, treadPhase: 5 },
    ],
    projectiles: [
      { id: 11, x: 652, y: 356, vx: 320, vy: 0, radius: 5, colorHex: '#D9432B', source: 'normal' },
    ],
    drops: [],
    mines: [],
    laserBeams: [],
    explosions: [],
  });

  push({
    roundNumber: 1,
    battleTime: 4.1,
    totalTime: 4.1,
    kind: 'elimination',
    headline: 'P1 命中淘汰 P2',
    actorColorHex: '#D9432B',
    scores: { p1: 1, p2: 0 },
    tanks: [
      { slotId: 'p1', displayName: 'P1', colorHex: '#D9432B', x: 548, y: 356, angle: 0.02, alive: true, hasShield: false, offenseKind: null, ammo: 4, maxAmmo: 5, treadPhase: 14 },
      { slotId: 'p2', displayName: 'P2', colorHex: '#2364C7', x: 690, y: 356, angle: Math.PI, alive: false, hasShield: false, offenseKind: null, ammo: 5, maxAmmo: 5 },
    ],
    projectiles: [],
    drops: [],
    mines: [],
    laserBeams: [],
    explosions: [{ x: 690, y: 356, radius: 48, colorHex: '#2364C7', progress: 0.4 }],
  });

  // 第 2 回合（上路直道 y=50, x=450..940）：P2 反击 -> 散弹三连发淘汰 P1
  push({
    roundNumber: 2,
    battleTime: 0,
    totalTime: 4.1,
    kind: 'round_start',
    headline: '第 2 回合开战（互换出生点）',
    scores: { p1: 1, p2: 0 },
    tanks: [
      { slotId: 'p1', displayName: 'P1', colorHex: '#D9432B', x: 925, y: 50, angle: Math.PI, alive: true, hasShield: false, offenseKind: null, ammo: 5, maxAmmo: 5, treadPhase: 0 },
      { slotId: 'p2', displayName: 'P2', colorHex: '#2364C7', x: 465, y: 50, angle: 0, alive: true, hasShield: false, offenseKind: null, ammo: 5, maxAmmo: 5, treadPhase: 0 },
    ],
    projectiles: [],
    drops: [{ id: 3, kind: 'shotgun', x: 575, y: 50 }],
    mines: [],
    laserBeams: [],
    explosions: [],
  });

  push({
    roundNumber: 2,
    battleTime: 0.8,
    totalTime: 4.9,
    kind: 'keyframe',
    scores: { p1: 1, p2: 0 },
    tanks: [
      { slotId: 'p1', displayName: 'P1', colorHex: '#D9432B', x: 870, y: 50, angle: Math.PI, alive: true, hasShield: false, offenseKind: null, ammo: 5, maxAmmo: 5, treadPhase: 8 },
      { slotId: 'p2', displayName: 'P2', colorHex: '#2364C7', x: 525, y: 50, angle: 0, alive: true, hasShield: false, offenseKind: null, ammo: 5, maxAmmo: 5, treadPhase: 8 },
    ],
    projectiles: [],
    drops: [{ id: 3, kind: 'shotgun', x: 575, y: 50 }],
    mines: [],
    laserBeams: [],
    explosions: [],
  });

  push({
    roundNumber: 2,
    battleTime: 1.5,
    totalTime: 5.6,
    kind: 'pickup',
    headline: 'P2 拾取 三连发',
    actorColorHex: '#2364C7',
    scores: { p1: 1, p2: 0 },
    tanks: [
      { slotId: 'p1', displayName: 'P1', colorHex: '#D9432B', x: 825, y: 50, angle: Math.PI, alive: true, hasShield: false, offenseKind: null, ammo: 5, maxAmmo: 5, treadPhase: 15 },
      { slotId: 'p2', displayName: 'P2', colorHex: '#2364C7', x: 575, y: 50, angle: 0, alive: true, hasShield: false, offenseKind: 'shotgun', ammo: 5, maxAmmo: 5, offenseRatio: 1, treadPhase: 15 },
    ],
    projectiles: [],
    drops: [],
    mines: [],
    laserBeams: [],
    explosions: [],
    cues: [{ kind: 'pickup', x: 575, y: 50, colorHex: '#2364C7', progress: 0.3 }],
  });

  push({
    roundNumber: 2,
    battleTime: 2.1,
    totalTime: 6.2,
    kind: 'fire_special',
    headline: 'P2 发射 三连发散弹',
    actorColorHex: '#2364C7',
    scores: { p1: 1, p2: 0 },
    tanks: [
      { slotId: 'p1', displayName: 'P1', colorHex: '#D9432B', x: 785, y: 50, angle: Math.PI, alive: true, hasShield: false, offenseKind: null, ammo: 4, maxAmmo: 5, treadPhase: 6 },
      { slotId: 'p2', displayName: 'P2', colorHex: '#2364C7', x: 605, y: 50, angle: 0, alive: true, hasShield: false, offenseKind: 'shotgun', ammo: 3, maxAmmo: 5, offenseRatio: 0.85, recoil: 0.85, treadPhase: 6 },
    ],
    projectiles: [
      { id: 21, x: 668, y: 36, vx: 310, vy: -42, radius: 5, colorHex: '#2364C7', source: 'shotgun' },
      { id: 22, x: 675, y: 50, vx: 320, vy: 0, radius: 5, colorHex: '#2364C7', source: 'shotgun' },
      { id: 23, x: 668, y: 64, vx: 310, vy: 42, radius: 5, colorHex: '#2364C7', source: 'shotgun' },
    ],
    drops: [],
    mines: [],
    laserBeams: [],
    explosions: [],
    cues: [{ kind: 'muzzle', x: 632, y: 50, colorHex: '#2364C7', angle: 0, progress: 0.35 }],
  });

  push({
    roundNumber: 2,
    battleTime: 2.5,
    totalTime: 6.6,
    kind: 'elimination',
    headline: 'P2 散弹淘汰 P1 · 扳平比分',
    actorColorHex: '#2364C7',
    scores: { p1: 1, p2: 1 },
    tanks: [
      { slotId: 'p1', displayName: 'P1', colorHex: '#D9432B', x: 770, y: 50, angle: Math.PI, alive: false, hasShield: false, offenseKind: null, ammo: 4, maxAmmo: 5 },
      { slotId: 'p2', displayName: 'P2', colorHex: '#2364C7', x: 620, y: 50, angle: 0, alive: true, hasShield: false, offenseKind: 'shotgun', ammo: 3, maxAmmo: 5, offenseRatio: 0.78, treadPhase: 10 },
    ],
    projectiles: [],
    drops: [],
    mines: [],
    laserBeams: [],
    explosions: [{ x: 770, y: 50, radius: 46, colorHex: '#D9432B', progress: 0.42 }],
  });

  // 决胜回合（中路长廊 y=350, x=450..850）：P1 破片弹 6 碎片收官制胜
  push({
    roundNumber: 9,
    battleTime: 0,
    totalTime: 180.2,
    kind: 'round_start',
    headline: '第 9 回合 · 赛点决胜局',
    scores: { p1: 4, p2: 3 },
    tanks: [
      { slotId: 'p1', displayName: 'P1', colorHex: '#D9432B', x: 465, y: 350, angle: 0, alive: true, hasShield: true, offenseKind: 'frag', ammo: 5, maxAmmo: 5, shieldRatio: 0.85, offenseRatio: 0.9, treadPhase: 0 },
      { slotId: 'p2', displayName: 'P2', colorHex: '#2364C7', x: 825, y: 350, angle: Math.PI, alive: true, hasShield: false, offenseKind: null, ammo: 5, maxAmmo: 5, treadPhase: 0 },
    ],
    projectiles: [],
    drops: [],
    mines: [{ id: 5, x: 745, y: 350, colorHex: '#2364C7', armed: true }],
    laserBeams: [],
    explosions: [],
  });

  push({
    roundNumber: 9,
    battleTime: 0.9,
    totalTime: 181.1,
    kind: 'keyframe',
    scores: { p1: 4, p2: 3 },
    tanks: [
      { slotId: 'p1', displayName: 'P1', colorHex: '#D9432B', x: 500, y: 350, angle: 0.03, alive: true, hasShield: true, offenseKind: null, ammo: 5, maxAmmo: 5, shieldRatio: 0.76, recoil: 0.7, treadPhase: 7 },
      { slotId: 'p2', displayName: 'P2', colorHex: '#2364C7', x: 805, y: 350, angle: Math.PI, alive: true, hasShield: false, offenseKind: null, ammo: 5, maxAmmo: 5, treadPhase: 5 },
    ],
    projectiles: [
      { id: 39, x: 595, y: 350, vx: 310, vy: 0, radius: 7, colorHex: '#D9432B', source: 'frag_parent' },
    ],
    drops: [],
    mines: [{ id: 5, x: 745, y: 350, colorHex: '#2364C7', armed: true }],
    laserBeams: [],
    explosions: [],
  });

  push({
    roundNumber: 9,
    battleTime: 1.5,
    totalTime: 181.7,
    kind: 'fire_special',
    headline: 'P1 破片弹裂解 6 枚弹片',
    actorColorHex: '#D9432B',
    scores: { p1: 4, p2: 3 },
    tanks: [
      { slotId: 'p1', displayName: 'P1', colorHex: '#D9432B', x: 518, y: 350, angle: 0.04, alive: true, hasShield: true, offenseKind: null, ammo: 5, maxAmmo: 5, shieldRatio: 0.7, treadPhase: 12 },
      { slotId: 'p2', displayName: 'P2', colorHex: '#2364C7', x: 795, y: 350, angle: Math.PI, alive: true, hasShield: false, offenseKind: null, ammo: 4, maxAmmo: 5, treadPhase: 9 },
    ],
    projectiles: Array.from({ length: 6 }, (_, i) => {
      const a = (i * Math.PI * 2) / 6;
      return {
        id: 40 + i,
        x: 660 + Math.cos(a) * 26,
        y: 350 + Math.sin(a) * 26,
        vx: Math.cos(a) * 340,
        vy: Math.sin(a) * 340,
        radius: 4,
        colorHex: '#D9432B',
        source: 'frag_shard',
      };
    }),
    drops: [],
    mines: [{ id: 5, x: 745, y: 350, colorHex: '#2364C7', armed: true }],
    laserBeams: [],
    explosions: [{ x: 660, y: 350, radius: 28, colorHex: '#F97316', progress: 0.5 }],
  });

  push({
    roundNumber: 9,
    battleTime: 2.1,
    totalTime: 182.3,
    kind: 'round_end',
    headline: 'P1 赢得本场比赛（5 : 3）',
    actorColorHex: '#D9432B',
    scores: { p1: 5, p2: 3 },
    tanks: [
      { slotId: 'p1', displayName: 'P1', colorHex: '#D9432B', x: 530, y: 350, angle: 0.04, alive: true, hasShield: true, offenseKind: null, ammo: 5, maxAmmo: 5, shieldRatio: 0.64, treadPhase: 15 },
      { slotId: 'p2', displayName: 'P2', colorHex: '#2364C7', x: 785, y: 350, angle: Math.PI, alive: false, hasShield: false, offenseKind: null, ammo: 4, maxAmmo: 5 },
    ],
    projectiles: [],
    drops: [],
    mines: [{ id: 5, x: 745, y: 350, colorHex: '#2364C7', armed: true }],
    laserBeams: [],
    explosions: [{ x: 785, y: 350, radius: 50, colorHex: '#2364C7', progress: 0.42 }],
  });

  return {
    arenaWidth: maze.width,
    arenaHeight: maze.height,
    gridCols: maze.cols,
    gridRows: maze.rows,
    sampleRateHz: 10,
    walls: maze.walls.map((w) => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 })),
    events,
  };
}
