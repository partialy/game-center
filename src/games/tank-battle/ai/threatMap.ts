import {
  hasLineOfSight,
  sweepMovingCircleAgainstMovingCircle,
} from '../simulation/collision';
import {
  TANK_BARREL_LENGTH,
  TANK_RADIUS,
  type MazeData,
  type MineEntity,
  type ProjectileEntity,
  type TankBattleRules,
  type TankEntity,
  type TankWorldState,
  type Vec2,
} from '../types';
import {
  getMazeGeometryCache,
  traceProjectileTrajectory,
  type MazeGeometryCache,
  type PredictedTrajectory,
  type TrajectorySegment,
} from './physicsPrediction';

export interface OpponentEstimate {
  slotId: string;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  speed: number;
  alive: boolean;
  hasShield: boolean;
  offenseKind: string | null;
  fireReady: boolean;
  ammo: number;
}

/**
 * 仅依据当前公开世界状态记录存活对手的近几步位移，每回合自动清空旧历史。
 */
export class OpponentMotionTracker {
  private lastRound = -1;
  private lastBattleTime = -1;
  private readonly samples = new Map<
    string,
    { x: number; y: number; angle: number; vx: number; vy: number }
  >();

  update(world: TankWorldState): OpponentEstimate[] {
    if (this.lastRound !== world.roundNumber || world.battleTime < this.lastBattleTime) {
      this.lastRound = world.roundNumber;
      this.lastBattleTime = world.battleTime;
      this.samples.clear();
    }

    const dt = world.battleTime - this.lastBattleTime;
    this.lastBattleTime = world.battleTime;
    const maxSpeed = Math.max(world.rules.tankForwardSpeed, world.rules.tankReverseSpeed);
    const out: OpponentEstimate[] = [];

    for (let i = 0; i < world.tanks.length; i += 1) {
      const t = world.tanks[i];
      if (!t.alive) continue;

      const prev = this.samples.get(t.slotId);
      let vx = 0;
      let vy = 0;
      if (prev && dt > 1e-4 && dt < 0.25) {
        let ivx = (t.x - prev.x) / dt;
        let ivy = (t.y - prev.y) / dt;
        const mag = Math.hypot(ivx, ivy);
        if (mag > maxSpeed * 1.05) {
          const s = maxSpeed / mag;
          ivx *= s;
          ivy *= s;
        }
        vx = prev.vx * 0.55 + ivx * 0.45;
        vy = prev.vy * 0.55 + ivy * 0.45;
      }

      this.samples.set(t.slotId, { x: t.x, y: t.y, angle: t.angle, vx, vy });
      out.push({
        slotId: t.slotId,
        x: t.x,
        y: t.y,
        angle: t.angle,
        vx,
        vy,
        speed: Math.hypot(vx, vy),
        alive: t.alive,
        hasShield: Boolean(t.shield),
        offenseKind: t.offense?.kind ?? null,
        fireReady: world.battleTime + 1e-6 >= t.fireReadyAt,
        ammo: t.ammo,
      });
    }

    return out;
  }

  reset(): void {
    this.lastRound = -1;
    this.lastBattleTime = -1;
    this.samples.clear();
  }
}

export interface SharedCachedProjectile {
  entity: ProjectileEntity;
  trajectory: PredictedTrajectory;
  allSegments: TrajectorySegment[];
}

export interface SharedStepContext {
  signature: string;
  mazeCache: MazeGeometryCache;
  projectiles: SharedCachedProjectile[];
}

let sharedCacheEnabled = true;

export function setSharedStepCacheEnabled(enabled: boolean): void {
  sharedCacheEnabled = enabled;
}

export function isSharedStepCacheEnabled(): boolean {
  return sharedCacheEnabled;
}

const worldStepCacheMap = new WeakMap<TankWorldState, SharedStepContext>();

function buildProjectileStepSignature(world: TankWorldState): string {
  const projs = world.projectiles;
  let projHash = `${projs.length}`;
  for (let i = 0; i < projs.length; i += 1) {
    const p = projs[i];
    projHash += `:${p.id},${Math.round(p.x * 10)},${Math.round(p.y * 10)},${Math.round(p.vx)},${Math.round(p.vy)},${p.selfDamageUnlocked ? 1 : 0}`;
  }
  return `${world.maze.mapCode}|${world.roundNumber}|${Math.round(world.battleTime * 10000)}|${projHash}`;
}

function collectAllTrajectorySegments(traj: PredictedTrajectory): TrajectorySegment[] {
  if (!traj.childShards || traj.childShards.length === 0) {
    return traj.segments;
  }
  const all = traj.segments.slice();
  for (let i = 0; i < traj.childShards.length; i += 1) {
    const child = traj.childShards[i];
    for (let j = 0; j < child.segments.length; j += 1) {
      all.push(child.segments[j]);
    }
  }
  return all;
}

/**
 * 在同一个模拟步内，所有内置 AI 共享一次基础迷宫拓扑与最多 5 次反弹（含第 5 次后飞行段）的弹道追踪结果。
 */
export function getSharedStepContext(world: TankWorldState): SharedStepContext {
  const sig = buildProjectileStepSignature(world);
  if (sharedCacheEnabled) {
    const existing = worldStepCacheMap.get(world);
    if (existing && existing.signature === sig) {
      return existing;
    }
  }

  const mazeCache = getMazeGeometryCache(world.maze);
  const projectiles: SharedCachedProjectile[] = [];
  const horizonSeconds = Math.min(2.6, Math.max(1.8, world.rules.normalBulletLifetimeSeconds));

  for (let i = 0; i < world.projectiles.length; i += 1) {
    const p = world.projectiles[i];
    const owner = world.tanks.find((t) => t.slotId === p.ownerSlotId);
    const traj = traceProjectileTrajectory(world.maze, world.rules, {
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      radius: p.radius,
      speed: p.speed,
      source: p.source,
      ownerSlotId: p.ownerSlotId,
      selfDamageUnlocked: p.selfDamageUnlocked,
      startTime: world.battleTime,
      expiresAtBattleTime: p.expiresAtBattleTime,
      maxBounces: 5,
      includePostBounceTail: true,
      maxHorizonSeconds: horizonSeconds,
      detonateAtBattleTime: p.detonateAtBattleTime,
      expandFragShards: p.source === 'frag_parent',
      ownerPosAtStart: owner && owner.alive ? { x: owner.x, y: owner.y } : undefined,
      tanksForHoming: p.source === 'homing' ? world.tanks : undefined,
      repathTimer: p.repathTimer,
      waypoint: p.waypoint ?? null,
    });
    projectiles.push({
      entity: p,
      trajectory: traj,
      allSegments: collectAllTrajectorySegments(traj),
    });
  }

  const built: SharedStepContext = {
    signature: sig,
    mazeCache,
    projectiles,
  };

  if (sharedCacheEnabled) {
    worldStepCacheMap.set(world, built);
  }
  return built;
}

export interface PoseSample {
  x: number;
  y: number;
  t: number;
}

export interface PathSafetyReport {
  lethal: boolean;
  shieldBroken: boolean;
  minTtc: number;
  minClearance: number;
  dangerScore: number;
  mineHazard: number;
  gunlineExposure: number;
  mostDangerousProjId: number | null;
  mostDangerousPoint: Vec2 | null;
}

/**
 * 评估一条候选轨迹（时间对齐的离散位姿序列）面对全量弹幕（含反弹、破片、追踪、己方未解锁弹）、
 * 全部地雷（含未布防与己方地雷）以及敌方枪线的风险。
 */
export function evaluatePoseSequenceSafety(
  world: TankWorldState,
  shared: SharedStepContext,
  self: TankEntity,
  poses: ReadonlyArray<PoseSample>,
  maxBounceThreat: number,
  includePost5thTail: boolean,
  opponents: ReadonlyArray<OpponentEstimate>,
  checkGunlines: boolean
): PathSafetyReport {
  if (poses.length === 0) {
    return {
      lethal: false,
      shieldBroken: false,
      minTtc: Infinity,
      minClearance: Infinity,
      dangerScore: 0,
      mineHazard: 0,
      gunlineExposure: 0,
      mostDangerousProjId: null,
      mostDangerousPoint: null,
    };
  }

  const tStart = poses[0].t;
  const tEnd = poses[poses.length - 1].t;
  let poseMinX = poses[0].x;
  let poseMaxX = poses[0].x;
  let poseMinY = poses[0].y;
  let poseMaxY = poses[0].y;
  for (let i = 1; i < poses.length; i += 1) {
    const p = poses[i];
    if (p.x < poseMinX) poseMinX = p.x;
    if (p.x > poseMaxX) poseMaxX = p.x;
    if (p.y < poseMinY) poseMinY = p.y;
    if (p.y > poseMaxY) poseMaxY = p.y;
  }

  const hasShield = Boolean(self.shield);
  const shieldExpires = self.shield?.expiresAtBattleTime ?? -1;
  const shieldGrace = self.shieldGraceUntil;
  const rules = world.rules;
  const hitMargin = 2.2;
  const nearDangerPad = 20;
  const cullPad = TANK_RADIUS + nearDangerPad + 12;

  let minTtc = Infinity;
  let minClearance = Infinity;
  let dangerScore = 0;
  let mineHazard = 0;
  let gunlineExposure = 0;
  let lethal = false;
  let shieldBroken = false;
  let shieldBreakTime = Infinity;
  let mostDangerousProjId: number | null = null;
  let mostDangerousPoint: Vec2 | null = null;

  const registerHit = (hitTime: number, projId: number | null, pt: Vec2) => {
    const ttc = Math.max(0, hitTime - tStart);
    if (ttc < minTtc) {
      minTtc = ttc;
      mostDangerousProjId = projId;
      mostDangerousPoint = pt;
    }
    if (hitTime < shieldGrace - 1e-6) {
      return;
    }
    if (hasShield && hitTime < shieldExpires - 1e-6 && !shieldBroken) {
      shieldBroken = true;
      shieldBreakTime = hitTime;
      dangerScore += 42 / Math.max(0.12, ttc);
      return;
    }
    if (
      shieldBroken &&
      hitTime < shieldBreakTime + rules.shieldBreakGraceSeconds - 1e-6
    ) {
      return;
    }
    lethal = true;
    dangerScore += 400 / Math.max(0.08, ttc);
  };

  // 1. 弹幕轨迹碰撞与近掠威胁评估（时间窗 + 包围盒快速剔除不可能相交段）
  for (let pIdx = 0; pIdx < shared.projectiles.length; pIdx += 1) {
    const cached = shared.projectiles[pIdx];
    const segs = cached.allSegments;

    for (let sIdx = 0; sIdx < segs.length; sIdx += 1) {
      const seg = segs[sIdx];
      if (!includePost5thTail && seg.bounceIndex > maxBounceThreat) {
        continue;
      }
      if (includePost5thTail && seg.bounceIndex > maxBounceThreat && seg.bounceIndex !== 5) {
        continue;
      }
      if (seg.ownerSlotId === self.slotId && !seg.selfDamageUnlocked) {
        continue;
      }
      if (seg.endTime < tStart || seg.startTime > tEnd) {
        continue;
      }
      const sMinX = (seg.x1 < seg.x2 ? seg.x1 : seg.x2) - cullPad;
      const sMaxX = (seg.x1 > seg.x2 ? seg.x1 : seg.x2) + cullPad;
      if (sMaxX < poseMinX || sMinX > poseMaxX) continue;
      const sMinY = (seg.y1 < seg.y2 ? seg.y1 : seg.y2) - cullPad;
      const sMaxY = (seg.y1 > seg.y2 ? seg.y1 : seg.y2) + cullPad;
      if (sMaxY < poseMinY || sMinY > poseMaxY) continue;

      for (let k = 0; k < poses.length - 1; k += 1) {
        const a = poses[k];
        const b = poses[k + 1];
        const ovStart = Math.max(a.t, seg.startTime);
        const ovEnd = Math.min(b.t, seg.endTime);
        const ovDt = ovEnd - ovStart;
        if (ovDt <= 1e-6) continue;

        const poseDt = Math.max(1e-6, b.t - a.t);
        const tankVx = (b.x - a.x) / poseDt;
        const tankVy = (b.y - a.y) / poseDt;

        const tx0 = a.x + tankVx * (ovStart - a.t);
        const ty0 = a.y + tankVy * (ovStart - a.t);
        const px0 = seg.x1 + seg.vx * (ovStart - seg.startTime);
        const py0 = seg.y1 + seg.vy * (ovStart - seg.startTime);

        // 精确命中判定
        const hitT = sweepMovingCircleAgainstMovingCircle(
          px0,
          py0,
          seg.vx,
          seg.vy,
          seg.radius,
          tx0,
          ty0,
          tankVx,
          tankVy,
          TANK_RADIUS + hitMargin,
          ovDt
        );
        if (hitT !== null) {
          const hitTime = ovStart + ovDt * hitT;
          registerHit(hitTime, cached.entity.id, {
            x: px0 + seg.vx * (ovDt * hitT),
            y: py0 + seg.vy * (ovDt * hitT),
          });
          minClearance = 0;
          break;
        }

        // 近掠危险度（不直接击中也惩罚贴弹飞行）
        const midDt = ovDt * 0.5;
        const dx = (px0 + seg.vx * midDt) - (tx0 + tankVx * midDt);
        const dy = (py0 + seg.vy * midDt) - (ty0 + tankVy * midDt);
        const centerDist = Math.hypot(dx, dy);
        const clearance = centerDist - (TANK_RADIUS + seg.radius);
        if (clearance < minClearance) {
          minClearance = clearance;
        }
        if (clearance < nearDangerPad) {
          const ttc = Math.max(0.08, ovStart + midDt - tStart);
          const prox = (nearDangerPad - clearance) / nearDangerPad;
          dangerScore += (prox * prox * 26) / ttc;
          if (ttc < minTtc && mostDangerousPoint === null) {
            mostDangerousProjId = cached.entity.id;
            mostDangerousPoint = { x: px0, y: py0 };
          }
        }
      }
    }
  }

  // 2. 地雷评估（含所有座位的已布防及未布防地雷，严格依据触发/爆炸半径与隔墙遮挡）
  if (world.mines.length > 0) {
    const triggerR = rules.mineTriggerRadius + TANK_RADIUS + 4;
    const blastR = rules.mineBlastRadius + TANK_RADIUS + 4;
    for (let mIdx = 0; mIdx < world.mines.length; mIdx += 1) {
      const mine: MineEntity = world.mines[mIdx];
      for (let k = 0; k < poses.length; k += 2) {
        const p = poses[k];
        const d = Math.hypot(p.x - mine.x, p.y - mine.y);
        if (d > blastR + 28) continue;
        if (!hasLineOfSight(world.maze, mine.x, mine.y, p.x, p.y)) continue;

        const armed = p.t >= mine.armedAtBattleTime - 0.05;
        if (armed && d <= triggerR) {
          registerHit(p.t, null, { x: mine.x, y: mine.y });
          mineHazard += 250;
          break;
        }
        if (d <= blastR) {
          const weight = armed ? 90 : 45;
          const pen = ((blastR - d) / blastR) * weight;
          mineHazard += pen;
          dangerScore += pen;
        }
      }
    }
  }

  // 3. 对手潜在枪线暴露评估
  if (checkGunlines && opponents.length > 0) {
    const endPose = poses[poses.length - 1];
    for (let i = 0; i < opponents.length; i += 1) {
      const op = opponents[i];
      if (!op.alive || op.slotId === self.slotId) continue;
      if (op.ammo <= 0 && !op.offenseKind) continue;

      const dx = endPose.x - op.x;
      const dy = endPose.y - op.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 640 || dist < 1) continue;
      if (!hasLineOfSight(world.maze, op.x, op.y, endPose.x, endPose.y)) continue;

      const aimAngle = Math.atan2(dy, dx);
      const aimAlign = Math.abs(
        Math.atan2(Math.sin(aimAngle - op.angle), Math.cos(aimAngle - op.angle))
      );
      const cone = op.offenseKind === 'shotgun' ? 0.45 : 0.25;
      const selfOnCooldown = self.fireReadyAt > endPose.t + 0.06;
      const outgunned = op.offenseKind === 'laser' || (op.offenseKind === 'shotgun' && dist < 240);
      const multiEnemy = opponents.length > 2;
      // 我方装弹冷却中、被激光/近距散弹压制或多人夹击时规避枪线；自身枪口就绪单挑时不怯战退缩
      if (!selfOnCooldown && !outgunned && !multiEnemy) {
        continue;
      }
      const cooldownVulnerability = selfOnCooldown && op.fireReady ? 2.6 : 1.0;
      const threatFactor =
        (op.fireReady ? 1.0 : 0.4) *
        (aimAlign <= cone ? 1.8 : 0.65) *
        (op.offenseKind === 'laser' ? 1.8 : 1.0) *
        cooldownVulnerability;
      const exposure = ((threatFactor * 24) / Math.max(80, dist)) * 100;
      gunlineExposure += exposure;
      dangerScore += exposure;
    }
  }

  // 4. 破片母弹倒数近爆点额外规避（防止直接贴到即将引爆的母弹）
  for (let i = 0; i < shared.projectiles.length; i += 1) {
    const traj = shared.projectiles[i].trajectory;
    if (traj.terminatedBy === 'detonated' && traj.detonationPos && traj.detonationTime !== null) {
      const endPose = poses[poses.length - 1];
      const dtDet = traj.detonationTime - tStart;
      if (dtDet >= 0 && dtDet <= 1.2) {
        const dDet = Math.hypot(endPose.x - traj.detonationPos.x, endPose.y - traj.detonationPos.y);
        if (dDet < 110 && hasLineOfSight(world.maze, traj.detonationPos.x, traj.detonationPos.y, endPose.x, endPose.y)) {
          dangerScore += (110 - dDet) * 0.45;
        }
      }
    }
  }

  return {
    lethal,
    shieldBroken,
    minTtc,
    minClearance,
    dangerScore,
    mineHazard,
    gunlineExposure,
    mostDangerousProjId,
    mostDangerousPoint,
  };
}

/**
 * 评估静态格点在到达时刻 tArrival 下的风险（供路径规划器加权使用）。
 */
export function evaluateCellThreatAtTime(
  maze: MazeData,
  shared: SharedStepContext,
  self: TankEntity,
  cellCenter: Vec2,
  tArrival: number,
  maxBounceThreat: number,
  opponents: ReadonlyArray<OpponentEstimate>
): number {
  let risk = 0;
  const timeWin = 0.28;

  for (let i = 0; i < shared.projectiles.length; i += 1) {
    const segs = shared.projectiles[i].allSegments;
    for (let s = 0; s < segs.length; s += 1) {
      const seg = segs[s];
      if (seg.bounceIndex > maxBounceThreat) continue;
      if (seg.ownerSlotId === self.slotId && !seg.selfDamageUnlocked) continue;
      if (seg.endTime < tArrival - timeWin || seg.startTime > tArrival + timeWin) continue;

      // 计算到达时刻子弹近似坐标与格心距离
      const tClamped = Math.max(seg.startTime, Math.min(seg.endTime, tArrival));
      const bx = seg.x1 + seg.vx * (tClamped - seg.startTime);
      const by = seg.y1 + seg.vy * (tClamped - seg.startTime);
      const d = Math.hypot(cellCenter.x - bx, cellCenter.y - by);
      if (d < 68) {
        risk += (68 - d) * 2.2;
      }
    }
  }

  // 敌方直视枪线与护盾/武器压迫
  for (let i = 0; i < opponents.length; i += 1) {
    const op = opponents[i];
    if (!op.alive || op.slotId === self.slotId) continue;
    const d = Math.hypot(cellCenter.x - op.x, cellCenter.y - op.y);
    if (d < 520 && hasLineOfSight(maze, op.x, op.y, cellCenter.x, cellCenter.y)) {
      risk += op.offenseKind === 'laser' ? 55 : 22;
      if (d < TANK_BARREL_LENGTH + 110) risk += 18;
    }
  }

  return risk;
}
