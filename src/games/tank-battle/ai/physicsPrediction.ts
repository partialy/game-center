import {
  computeHomingVelocity,
  FRAG_SHARD_SPEED_MULT,
  LASER_RAY_RADIUS,
  PROJECTILE_WALL_NUDGE,
  resolveMuzzleSpawn,
  traceLaserRay,
} from '../combat/projectiles';
import {
  computeMinePlacement,
  computeShotgunPelletAngles,
  FRAG_PARENT_RADIUS,
  FRAG_PARENT_SPEED_MULT,
  RAPID_FIRE_SPEED_MULT,
} from '../combat/weapons';
import { worldToCellIndex } from '../map/generateMaze';
import {
  hasLineOfSight,
  resolveCircleMazeCollision,
  sweepCircleAgainstMaze,
  sweepMovingCircleAgainstMovingCircle,
  sweepPointAgainstCircle,
} from '../simulation/collision';
import {
  stepTankMotion,
  type TankMotionInput,
  type TankMotionPose,
} from '../simulation/movement';
import {
  CELL_SIZE,
  DROP_PICKUP_RADIUS,
  FRAG_SHARD_RADIUS,
  NORMAL_BULLET_RADIUS,
  SPECIAL_BULLET_RADIUS,
  TANK_RADIUS,
  type ItemKind,
  type MazeData,
  type OffensiveSlotState,
  type ProjectileEntity,
  type ProjectileSourceKind,
  type ShieldSlotState,
  type TankBattleRules,
  type TankEntity,
  type TankWorldState,
  type Vec2,
} from '../types';

export const SIM_STEP_SECONDS = 1 / 60;

export interface MazeGeometryCache {
  cols: number;
  rows: number;
  cellCount: number;
  /** 展平 N×N 最短步数矩阵：distMatrix[from * N + to] */
  distMatrix: Int16Array;
  /** 展平 N×N 下一跳矩阵：nextHopMatrix[from * N + to] */
  nextHopMatrix: Int16Array;
  /** 每格通道自由度（1 为死胡同，2 为走廊，3+ 为路口） */
  cellDegrees: Uint8Array;
}

const mazeGeometryCacheMap = new WeakMap<MazeData, MazeGeometryCache>();

/**
 * 为整张迷宫构建一次静态全源最短路与路口拓扑索引（WeakMap 自动随地图回收）。
 */
export function getMazeGeometryCache(maze: MazeData): MazeGeometryCache {
  const existing = mazeGeometryCacheMap.get(maze);
  if (existing) return existing;

  const cellCount = maze.cells.length;
  const distMatrix = new Int16Array(cellCount * cellCount).fill(-1);
  const nextHopMatrix = new Int16Array(cellCount * cellCount).fill(-1);
  const cellDegrees = new Uint8Array(cellCount);
  const queue = new Int16Array(cellCount);

  for (let src = 0; src < cellCount; src += 1) {
    cellDegrees[src] = maze.cells[src].neighbors.length;
    const rowOffset = src * cellCount;
    distMatrix[rowOffset + src] = 0;
    nextHopMatrix[rowOffset + src] = src;

    let head = 0;
    let tail = 0;
    const startNeighbors = maze.cells[src].neighbors;
    for (let i = 0; i < startNeighbors.length; i += 1) {
      const nb = startNeighbors[i];
      distMatrix[rowOffset + nb] = 1;
      nextHopMatrix[rowOffset + nb] = nb;
      queue[tail++] = nb;
    }

    while (head < tail) {
      const cur = queue[head++];
      const curDist = distMatrix[rowOffset + cur];
      const firstHop = nextHopMatrix[rowOffset + cur];
      const neighbors = maze.cells[cur].neighbors;
      for (let i = 0; i < neighbors.length; i += 1) {
        const nb = neighbors[i];
        if (distMatrix[rowOffset + nb] === -1) {
          distMatrix[rowOffset + nb] = curDist + 1;
          nextHopMatrix[rowOffset + nb] = firstHop;
          queue[tail++] = nb;
        }
      }
    }
  }

  const built: MazeGeometryCache = {
    cols: maze.cols,
    rows: maze.rows,
    cellCount,
    distMatrix,
    nextHopMatrix,
    cellDegrees,
  };
  mazeGeometryCacheMap.set(maze, built);
  return built;
}

export interface TrajectorySegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  vx: number;
  vy: number;
  startTime: number;
  endTime: number;
  radius: number;
  bounceIndex: number;
  selfDamageUnlocked: boolean;
  source: ProjectileSourceKind;
  ownerSlotId: string;
}

export interface PredictedTrajectory {
  segments: TrajectorySegment[];
  bouncesExecuted: number;
  terminatedBy: 'wall_limit' | 'expired' | 'detonated' | 'horizon';
  detonationPos: Vec2 | null;
  detonationTime: number | null;
  childShards?: PredictedTrajectory[];
}

export interface TraceTrajectoryOptions {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  speed: number;
  source: ProjectileSourceKind;
  ownerSlotId: string;
  selfDamageUnlocked: boolean;
  startTime: number;
  expiresAtBattleTime: number;
  maxBounces: number;
  /** 仅 Lv.5 等需要追踪第 N 次反弹后继续飞行的片段时设为 true */
  includePostBounceTail?: boolean;
  maxHorizonSeconds?: number;
  detonateAtBattleTime?: number;
  expandFragShards?: boolean;
  ownerPosAtStart?: Vec2;
  /** 若提供坦克列表，追踪弹每步按真实逻辑转向；否则沿当前速度直线推进 */
  tanksForHoming?: ReadonlyArray<{ slotId: string; x: number; y: number; alive: boolean }>;
  repathTimer?: number;
  waypoint?: Vec2 | null;
}

/**
 * 同源弹体轨迹预测（无副作用）：
 * - 使用与实战完全一致的 sweepCircleAgainstMaze、0.35 法线微推与反射公式
 * - 正确追踪 selfDamageUnlocked（首次撞墙或离开发射者机身碰撞体后解锁）
 * - 支持最多 maxBounces 次墙面反弹（及第五次反弹后的延续飞行段）
 */
export function traceProjectileTrajectory(
  maze: MazeData,
  rules: TankBattleRules,
  opts: TraceTrajectoryOptions
): PredictedTrajectory {
  const segments: TrajectorySegment[] = [];
  const horizonEnd =
    opts.maxHorizonSeconds !== undefined
      ? Math.min(opts.expiresAtBattleTime, opts.startTime + opts.maxHorizonSeconds)
      : opts.expiresAtBattleTime;

  const endTimeLimit =
    opts.source === 'frag_parent' && opts.detonateAtBattleTime !== undefined
      ? Math.min(horizonEnd, opts.detonateAtBattleTime)
      : horizonEnd;

  let curX = opts.x;
  let curY = opts.y;
  let vx = opts.vx;
  let vy = opts.vy;
  let curTime = opts.startTime;
  let selfUnlocked = opts.selfDamageUnlocked;
  let bounceIndex = 0;

  // 追踪弹需要逐固定步更新速度方向
  if (opts.source === 'homing' && opts.tanksForHoming && opts.tanksForHoming.length > 0) {
    let repathTimer = opts.repathTimer ?? 0;
    let waypoint = opts.waypoint ?? null;
    const maxBounceAllowed = opts.includePostBounceTail ? opts.maxBounces + 1 : opts.maxBounces;

    while (curTime + 1e-6 < endTimeLimit) {
      const stepDt = Math.min(SIM_STEP_SECONDS, endTimeLimit - curTime);
      const steered = computeHomingVelocity(
        maze,
        opts.tanksForHoming,
        opts.ownerSlotId,
        curX,
        curY,
        vx,
        vy,
        opts.speed,
        rules.homingTurnRateDeg,
        stepDt,
        repathTimer,
        waypoint
      );
      vx = steered.vx;
      vy = steered.vy;
      repathTimer = steered.repathTimer;
      waypoint = steered.waypoint;

      let remDt = stepDt;
      let hitBounceLimit = false;
      for (let sub = 0; sub < 6 && remDt > 1e-6; sub += 1) {
        const dx = vx * remDt;
        const dy = vy * remDt;
        const wallHit = sweepCircleAgainstMaze(curX, curY, dx, dy, opts.radius, maze);
        if (!wallHit) {
          segments.push({
            x1: curX,
            y1: curY,
            x2: curX + dx,
            y2: curY + dy,
            vx,
            vy,
            startTime: curTime,
            endTime: curTime + remDt,
            radius: opts.radius,
            bounceIndex,
            selfDamageUnlocked: selfUnlocked,
            source: opts.source,
            ownerSlotId: opts.ownerSlotId,
          });
          curX += dx;
          curY += dy;
          curTime += remDt;
          remDt = 0;
        } else {
          const hitDt = remDt * wallHit.t;
          segments.push({
            x1: curX,
            y1: curY,
            x2: wallHit.x,
            y2: wallHit.y,
            vx,
            vy,
            startTime: curTime,
            endTime: curTime + hitDt,
            radius: opts.radius,
            bounceIndex,
            selfDamageUnlocked: selfUnlocked,
            source: opts.source,
            ownerSlotId: opts.ownerSlotId,
          });
          curTime += hitDt;
          remDt *= Math.max(0, 1 - wallHit.t);
          bounceIndex += 1;
          selfUnlocked = true;
          if (bounceIndex > maxBounceAllowed) {
            hitBounceLimit = true;
            break;
          }
          curX = wallHit.x + wallHit.nx * PROJECTILE_WALL_NUDGE;
          curY = wallHit.y + wallHit.ny * PROJECTILE_WALL_NUDGE;
          const dot = vx * wallHit.nx + vy * wallHit.ny;
          if (dot < 0) {
            vx -= 2 * dot * wallHit.nx;
            vy -= 2 * dot * wallHit.ny;
          }
        }
      }

      if (!selfUnlocked && opts.ownerPosAtStart) {
        const d = Math.hypot(curX - opts.ownerPosAtStart.x, curY - opts.ownerPosAtStart.y);
        if (d > TANK_RADIUS + opts.radius + 2) {
          selfUnlocked = true;
        }
      }
      if (hitBounceLimit) {
        return {
          segments,
          bouncesExecuted: bounceIndex - 1,
          terminatedBy: 'wall_limit',
          detonationPos: null,
          detonationTime: null,
        };
      }
    }

    return {
      segments,
      bouncesExecuted: bounceIndex,
      terminatedBy: curTime >= opts.expiresAtBattleTime - 1e-6 ? 'expired' : 'horizon',
      detonationPos: null,
      detonationTime: null,
    };
  }

  // 直线类弹体（normal / rapid_fire / shotgun / frag_parent / frag_shard）
  // 如果当前未解锁自伤且提供了发射者坐标，先切出离开发射者机身的距离段，精确对齐自伤解锁时刻
  const maxAllowedBounces = opts.includePostBounceTail ? opts.maxBounces + 1 : opts.maxBounces;
  let guard = 0;

  while (curTime + 1e-6 < endTimeLimit && guard < 32) {
    guard += 1;
    const remTime = endTimeLimit - curTime;
    const dx = vx * remTime;
    const dy = vy * remTime;
    if (dx * dx + dy * dy < 1e-10) break;

    const wallHit = sweepCircleAgainstMaze(curX, curY, dx, dy, opts.radius, maze);
    const segEndTime = wallHit ? curTime + remTime * wallHit.t : endTimeLimit;
    const segEndX = wallHit ? wallHit.x : curX + dx;
    const segEndY = wallHit ? wallHit.y : curY + dy;

    // 检查是否在本段内因离开机身而解锁自伤
    if (!selfUnlocked && opts.ownerPosAtStart) {
      const unlockDist = TANK_RADIUS + opts.radius + 2;
      const distStart = Math.hypot(curX - opts.ownerPosAtStart.x, curY - opts.ownerPosAtStart.y);
      if (distStart > unlockDist) {
        selfUnlocked = true;
        segments.push({
          x1: curX,
          y1: curY,
          x2: segEndX,
          y2: segEndY,
          vx,
          vy,
          startTime: curTime,
          endTime: segEndTime,
          radius: opts.radius,
          bounceIndex,
          selfDamageUnlocked: true,
          source: opts.source,
          ownerSlotId: opts.ownerSlotId,
        });
      } else {
        const distEnd = Math.hypot(segEndX - opts.ownerPosAtStart.x, segEndY - opts.ownerPosAtStart.y);
        if (distEnd > unlockDist) {
          const totalLen = Math.hypot(segEndX - curX, segEndY - curY);
          const frac = totalLen > 1e-6 ? Math.min(1, Math.max(0, (unlockDist - distStart) / Math.max(1e-6, distEnd - distStart))) : 0;
          const splitX = curX + (segEndX - curX) * frac;
          const splitY = curY + (segEndY - curY) * frac;
          const splitTime = curTime + (segEndTime - curTime) * frac;
          if (frac > 1e-4) {
            segments.push({
              x1: curX,
              y1: curY,
              x2: splitX,
              y2: splitY,
              vx,
              vy,
              startTime: curTime,
              endTime: splitTime,
              radius: opts.radius,
              bounceIndex,
              selfDamageUnlocked: false,
              source: opts.source,
              ownerSlotId: opts.ownerSlotId,
            });
          }
          selfUnlocked = true;
          if (frac < 1 - 1e-4) {
            segments.push({
              x1: splitX,
              y1: splitY,
              x2: segEndX,
              y2: segEndY,
              vx,
              vy,
              startTime: splitTime,
              endTime: segEndTime,
              radius: opts.radius,
              bounceIndex,
              selfDamageUnlocked: true,
              source: opts.source,
              ownerSlotId: opts.ownerSlotId,
            });
          }
        } else {
          segments.push({
            x1: curX,
            y1: curY,
            x2: segEndX,
            y2: segEndY,
            vx,
            vy,
            startTime: curTime,
            endTime: segEndTime,
            radius: opts.radius,
            bounceIndex,
            selfDamageUnlocked: false,
            source: opts.source,
            ownerSlotId: opts.ownerSlotId,
          });
        }
      }
    } else {
      segments.push({
        x1: curX,
        y1: curY,
        x2: segEndX,
        y2: segEndY,
        vx,
        vy,
        startTime: curTime,
        endTime: segEndTime,
        radius: opts.radius,
        bounceIndex,
        selfDamageUnlocked: selfUnlocked,
        source: opts.source,
        ownerSlotId: opts.ownerSlotId,
      });
    }

    curTime = segEndTime;
    if (!wallHit) {
      curX = segEndX;
      curY = segEndY;
      break;
    }

    bounceIndex += 1;
    selfUnlocked = true;
    if (bounceIndex > maxAllowedBounces) {
      return {
        segments,
        bouncesExecuted: bounceIndex - 1,
        terminatedBy: 'wall_limit',
        detonationPos: null,
        detonationTime: null,
      };
    }

    curX = wallHit.x + wallHit.nx * PROJECTILE_WALL_NUDGE;
    curY = wallHit.y + wallHit.ny * PROJECTILE_WALL_NUDGE;
    const dot = vx * wallHit.nx + vy * wallHit.ny;
    if (dot < 0) {
      vx -= 2 * dot * wallHit.nx;
      vy -= 2 * dot * wallHit.ny;
    }
  }

  // 处理破片母弹引爆分裂
  if (
    opts.source === 'frag_parent' &&
    opts.detonateAtBattleTime !== undefined &&
    curTime + 1e-6 >= opts.detonateAtBattleTime
  ) {
    const detonationPos = { x: curX, y: curY };
    const detonationTime = opts.detonateAtBattleTime;
    let childShards: PredictedTrajectory[] | undefined;

    if (opts.expandFragShards) {
      const shardSpeed = rules.normalBulletSpeed * FRAG_SHARD_SPEED_MULT;
      const baseAngle = Math.atan2(vy, vx);
      const count = rules.fragShardCount;
      const shardExpiresAt = detonationTime + rules.fragShardLifetimeSeconds;
      const maxShardBounces = Math.min(opts.maxBounces, 3);
      childShards = [];
      for (let i = 0; i < count; i += 1) {
        const ang = baseAngle + (i * Math.PI * 2) / count;
        childShards.push(
          traceProjectileTrajectory(maze, rules, {
            x: curX,
            y: curY,
            vx: Math.cos(ang) * shardSpeed,
            vy: Math.sin(ang) * shardSpeed,
            radius: FRAG_SHARD_RADIUS,
            speed: shardSpeed,
            source: 'frag_shard',
            ownerSlotId: opts.ownerSlotId,
            selfDamageUnlocked: true,
            startTime: detonationTime,
            expiresAtBattleTime: shardExpiresAt,
            maxBounces: maxShardBounces,
            includePostBounceTail: false,
          })
        );
      }
    }

    return {
      segments,
      bouncesExecuted: bounceIndex,
      terminatedBy: 'detonated',
      detonationPos,
      detonationTime,
      childShards,
    };
  }

  return {
    segments,
    bouncesExecuted: bounceIndex,
    terminatedBy: curTime >= opts.expiresAtBattleTime - 1e-6 ? 'expired' : 'horizon',
    detonationPos: null,
    detonationTime: null,
  };
}

/**
 * 检查一段轨迹是否在给定时间窗内命中静态或线性外推圆目标（用于炮口出膛后自伤/命中精确判断）。
 */
export function findTrajectoryHitOnTank(
  traj: PredictedTrajectory,
  tankPos: Vec2,
  tankVel: Vec2 | null,
  targetSlotId: string,
  ignoreUnunlockedOwner: boolean,
  hitRadiusExtra = 0
): { hitTime: number; bounceIndex: number; hitPoint: Vec2 } | null {
  const vxT = tankVel ? tankVel.x : 0;
  const vyT = tankVel ? tankVel.y : 0;
  const t0 = traj.segments.length > 0 ? traj.segments[0].startTime : 0;
  const hitR = TANK_RADIUS + hitRadiusExtra;

  for (let i = 0; i < traj.segments.length; i += 1) {
    const seg = traj.segments[i];
    if (ignoreUnunlockedOwner && seg.ownerSlotId === targetSlotId && !seg.selfDamageUnlocked) {
      continue;
    }
    const segDt = seg.endTime - seg.startTime;
    if (segDt <= 1e-9) continue;

    // 在线段自身时域内用相对速度做连续碰撞检测（先做 AABB 快速剔除）
    const tankAtSegStartX = tankPos.x + vxT * (seg.startTime - t0);
    const tankAtSegStartY = tankPos.y + vyT * (seg.startTime - t0);
    const pad = hitR + seg.radius + Math.abs(vxT) * segDt + Math.abs(vyT) * segDt + 2;
    const sMinX = (seg.x1 < seg.x2 ? seg.x1 : seg.x2) - pad;
    const sMaxX = (seg.x1 > seg.x2 ? seg.x1 : seg.x2) + pad;
    if (tankAtSegStartX < sMinX || tankAtSegStartX > sMaxX) continue;
    const sMinY = (seg.y1 < seg.y2 ? seg.y1 : seg.y2) - pad;
    const sMaxY = (seg.y1 > seg.y2 ? seg.y1 : seg.y2) + pad;
    if (tankAtSegStartY < sMinY || tankAtSegStartY > sMaxY) continue;

    const t = sweepMovingCircleAgainstMovingCircle(
      seg.x1,
      seg.y1,
      seg.vx,
      seg.vy,
      seg.radius,
      tankAtSegStartX,
      tankAtSegStartY,
      vxT,
      vyT,
      TANK_RADIUS + hitRadiusExtra,
      segDt
    );

    if (t !== null) {
      const hitTime = seg.startTime + segDt * t;
      return {
        hitTime,
        bounceIndex: seg.bounceIndex,
        hitPoint: {
          x: seg.x1 + seg.vx * (segDt * t),
          y: seg.y1 + seg.vy * (segDt * t),
        },
      };
    }
  }

  return null;
}

export interface PredictedTankStepState {
  pose: TankMotionPose;
  nextBattleTime: number;
  ammo: number;
  nextReloadAt: number | null;
  fireReadyAt: number;
  shield: ShieldSlotState | null;
  shieldGraceUntil: number;
  offense: OffensiveSlotState | null;
  /** 本步必然拾取的道具（无竞争者） */
  certainPickup: ItemKind | null;
  /** 本步存在同帧竞争的道具（必须同时审查旧武器与拾取后武器） */
  contestedPickup: ItemKind | null;
}

function applyPredictedPickup(
  kind: ItemKind,
  battleTime: number,
  rules: TankBattleRules,
  curShield: ShieldSlotState | null,
  curOffense: OffensiveSlotState | null
): { shield: ShieldSlotState | null; offense: OffensiveSlotState | null } {
  if (kind === 'shield') {
    return {
      shield: {
        expiresAtBattleTime: battleTime + rules.shieldDurationSeconds,
        durationSeconds: rules.shieldDurationSeconds,
      },
      offense: curOffense,
    };
  }
  if (kind === 'rapid_fire') {
    return {
      shield: curShield,
      offense: {
        kind: 'rapid_fire',
        expiresAtBattleTime: battleTime + rules.rapidFireDurationSeconds,
        durationSeconds: rules.rapidFireDurationSeconds,
        remainingShots: rules.rapidFireMaxShots,
        maxShots: rules.rapidFireMaxShots,
      },
    };
  }
  if (kind === 'shotgun') {
    return {
      shield: curShield,
      offense: {
        kind: 'shotgun',
        expiresAtBattleTime: battleTime + rules.shotgunDurationSeconds,
        durationSeconds: rules.shotgunDurationSeconds,
      },
    };
  }
  return {
    shield: curShield,
    offense: {
      kind,
      expiresAtBattleTime: battleTime + rules.singleUseHoldLimitSeconds,
      durationSeconds: rules.singleUseHoldLimitSeconds,
    },
  };
}

/**
 * 预测执行 1 个固定模拟步（dt = 1/60）后自身坦克的真实位置、朝向、弹药、冷却与道具状态：
 * - 严格按世界单步顺序：到期清理 -> 补弹 -> 运动与坦克阻挡 -> 道具拾取（含同帧竞争标记）
 */
export function predictSelfStepState(
  world: TankWorldState,
  self: TankEntity,
  moveInput: TankMotionInput,
  dt: number = SIM_STEP_SECONDS
): PredictedTankStepState {
  const nextBattleTime = world.battleTime + dt;
  const rules = world.rules;

  // 1. 到期效果
  let shield =
    self.shield && self.shield.expiresAtBattleTime <= nextBattleTime
      ? null
      : self.shield
      ? { ...self.shield }
      : null;
  let offense =
    self.offense && self.offense.expiresAtBattleTime <= nextBattleTime
      ? null
      : self.offense
      ? { ...self.offense }
      : null;

  // 2. 补弹
  let ammo = self.ammo;
  let nextReloadAt = self.nextReloadAt;
  if (ammo >= self.maxAmmo) {
    ammo = self.maxAmmo;
    nextReloadAt = null;
  } else if (nextReloadAt === null) {
    nextReloadAt = nextBattleTime + rules.reloadIntervalSeconds;
  } else {
    while (ammo < self.maxAmmo && nextBattleTime + 1e-9 >= nextReloadAt) {
      ammo += 1;
      if (ammo >= self.maxAmmo) {
        ammo = self.maxAmmo;
        nextReloadAt = null;
        break;
      }
      nextReloadAt += rules.reloadIntervalSeconds;
    }
  }

  // 3. 移动与多车阻挡外推
  let pose = stepTankMotion(
    {
      x: self.x,
      y: self.y,
      angle: self.angle,
      moveHoldTime: self.moveHoldTime,
      treadDistance: self.treadDistance,
    },
    world.maze,
    rules,
    moveInput,
    dt
  );

  // 若附近存在存活坦克，按当前车速方向保守解算一轮坦克间阻挡
  const minDist = TANK_RADIUS * 2;
  const minDistSq = minDist * minDist;
  for (let i = 0; i < world.tanks.length; i += 1) {
    const other = world.tanks[i];
    if (!other.alive || other.slotId === self.slotId) continue;
    const dx = pose.x - other.x;
    const dy = pose.y - other.y;
    const dSq = dx * dx + dy * dy;
    if (dSq < minDistSq + (rules.tankForwardSpeed * dt * 2) * (rules.tankForwardSpeed * dt * 2)) {
      if (dSq < minDistSq) {
        const d = Math.sqrt(dSq);
        const nx = d > 1e-6 ? dx / d : 1;
        const ny = d > 1e-6 ? dy / d : 0;
        const push = (minDist - d) * 0.5 + 0.01;
        const fixed = resolveCircleMazeCollision(
          pose.x + nx * push,
          pose.y + ny * push,
          TANK_RADIUS,
          world.maze
        );
        pose = { ...pose, x: fixed.x, y: fixed.y };
      }
    }
  }

  // 4. 预计移动后是否会拾取道具（注意：未在 step 前过期的掉落才可拾取）
  const pickupDist = TANK_RADIUS + DROP_PICKUP_RADIUS;
  const pickupDistSq = pickupDist * pickupDist;
  let certainPickup: ItemKind | null = null;
  let contestedPickup: ItemKind | null = null;

  for (let i = world.drops.length - 1; i >= 0; i -= 1) {
    const drop = world.drops[i];
    if (drop.expiresAtBattleTime <= nextBattleTime + 1e-9) continue;
    const dSq = (pose.x - drop.x) ** 2 + (pose.y - drop.y) ** 2;
    if (dSq > pickupDistSq) continue;

    // 检查是否有对手在这一步也可能接触到同一道具
    let contested = false;
    const maxEnemyReach = pickupDist + rules.tankForwardSpeed * dt + 2;
    for (let j = 0; j < world.tanks.length; j += 1) {
      const op = world.tanks[j];
      if (!op.alive || op.slotId === self.slotId) continue;
      if (Math.hypot(op.x - drop.x, op.y - drop.y) <= maxEnemyReach) {
        contested = true;
        break;
      }
    }

    if (contested) {
      contestedPickup = drop.kind;
    } else {
      certainPickup = drop.kind;
      const applied = applyPredictedPickup(drop.kind, nextBattleTime, rules, shield, offense);
      shield = applied.shield;
      offense = applied.offense;
    }
  }

  return {
    pose,
    nextBattleTime,
    ammo,
    nextReloadAt,
    fireReadyAt: self.fireReadyAt,
    shield,
    shieldGraceUntil: self.shieldGraceUntil,
    offense,
    certainPickup,
    contestedPickup,
  };
}

export type ShotRejectionReason =
  | 'ok'
  | 'cooldown'
  | 'no_ammo'
  | 'need_rising_edge'
  | 'muzzle_wall_self_hit'
  | 'ricochet_self_hit'
  | 'laser_self_hit'
  | 'shotgun_pellet_self_hit'
  | 'frag_self_hit'
  | 'mine_trap_self'
  | 'contested_pickup_unsafe';

export interface EvaluatedShotResult {
  legal: boolean;
  safe: boolean;
  hitsEnemy: boolean;
  hitSlotIds: string[];
  minEnemyHitTime: number;
  bouncesUsed: number;
  selfRisk: boolean;
  selfHitTime: number | null;
  selfBreaksShieldOnly: boolean;
  rejectionReason: ShotRejectionReason;
  trajectories: PredictedTrajectory[];
  laserPoints: Vec2[] | null;
}

/**
 * 在单一武器配置下，对预计开火时刻 (x, y, angle) 执行完全同源的安全与命中验证：
 * - 校验冷却、弹药与按下边沿（justPressed vs rapid_fire held）
 * - 贴墙反射、5 次反弹及之后飞行段、激光完整 rules.laserMaxBounces 折线、散弹全扇区、破片碎片、地雷撤离路线
 */
export function evaluateWeaponShot(
  world: TankWorldState,
  shooterSlotId: string,
  pose: { x: number; y: number; angle: number },
  nextBattleTime: number,
  ammo: number,
  fireReadyAt: number,
  shield: ShieldSlotState | null,
  shieldGraceUntil: number,
  offense: OffensiveSlotState | null,
  prevFireHeld: boolean,
  maxBounceSearch: number,
  targetPositions?: ReadonlyArray<{ slotId: string; x: number; y: number; alive: boolean; vx?: number; vy?: number }>
): EvaluatedShotResult {
  const rules = world.rules;
  const hasShieldProtection = Boolean(shield) || nextBattleTime < shieldGraceUntil - 1e-9;
  const targets =
    targetPositions ??
    world.tanks.map((t) => ({ slotId: t.slotId, x: t.x, y: t.y, alive: t.alive, vx: 0, vy: 0 }));

  const fail = (reason: ShotRejectionReason): EvaluatedShotResult => ({
    legal: false,
    safe: false,
    hitsEnemy: false,
    hitSlotIds: [],
    minEnemyHitTime: Infinity,
    bouncesUsed: 0,
    selfRisk: false,
    selfHitTime: null,
    selfBreaksShieldOnly: false,
    rejectionReason: reason,
    trajectories: [],
    laserPoints: null,
  });

  if (nextBattleTime + 1e-9 < fireReadyAt) {
    return fail('cooldown');
  }

  const isRapid = offense?.kind === 'rapid_fire';
  if (!isRapid && prevFireHeld) {
    return fail('need_rising_edge');
  }

  // 检查弹药门槛
  if (offense?.kind === 'shotgun') {
    if (ammo < rules.shotgunAmmoCost) return fail('no_ammo');
  } else if (!offense || offense.kind === 'rapid_fire') {
    if (ammo < 1) return fail('no_ammo');
  }

  // 1. 激光：始终按完整 rules.laserMaxBounces 追踪，绝不截断
  if (offense?.kind === 'laser') {
    const simTanks = targets.map((t) =>
      t.slotId === shooterSlotId ? { ...t, x: pose.x, y: pose.y, alive: true } : t
    );
    const trace = traceLaserRay(
      world.maze,
      simTanks,
      shooterSlotId,
      pose.x,
      pose.y,
      pose.angle,
      rules.laserMaxBounces
    );
    const hitSelf = trace.hitTankSlotId === shooterSlotId;
    const hitEnemy = trace.hitTankSlotId !== null && trace.hitTankSlotId !== shooterSlotId;
    const selfBreaksShieldOnly = hitSelf && hasShieldProtection;
    // 即使有护盾也不允许无意义的激光打自己，避免破盾或无敌结束吃亏
    const selfRisk = hitSelf;
    return {
      legal: true,
      safe: !selfRisk,
      hitsEnemy: hitEnemy,
      hitSlotIds: hitEnemy && trace.hitTankSlotId ? [trace.hitTankSlotId] : [],
      minEnemyHitTime: hitEnemy ? 0 : Infinity,
      bouncesUsed: trace.bouncesExecuted,
      selfRisk,
      selfHitTime: hitSelf ? 0 : null,
      selfBreaksShieldOnly,
      rejectionReason: selfRisk ? 'laser_self_hit' : 'ok',
      trajectories: [],
      laserPoints: trace.points,
    };
  }

  // 2. 地雷：在车尾合法位置放置后，检查自身在 mineArmDelaySeconds 内是否有无遮挡逃离路径
  if (offense?.kind === 'mine') {
    const minePos = computeMinePlacement(pose.x, pose.y, pose.angle, world.maze);
    const armTime = Math.max(0.15, rules.mineArmDelaySeconds);
    const safeClearDist = rules.mineBlastRadius + TANK_RADIUS + 8;
    const maxTravel = rules.tankForwardSpeed * armTime * 0.85;
    let canEscape = false;

    // 测试车头前向与 8 方向能否在布防时间内撤到爆炸圈外或墙后
    const probeAngles = [
      pose.angle,
      pose.angle + 0.6,
      pose.angle - 0.6,
      pose.angle + 1.2,
      pose.angle - 1.2,
      0,
      Math.PI / 2,
      Math.PI,
      -Math.PI / 2,
    ];
    for (let i = 0; i < probeAngles.length; i += 1) {
      const a = probeAngles[i];
      const testX = pose.x + Math.cos(a) * maxTravel;
      const testY = pose.y + Math.sin(a) * maxTravel;
      const resolved = resolveCircleMazeCollision(testX, testY, TANK_RADIUS, world.maze);
      const distToMine = Math.hypot(resolved.x - minePos.x, resolved.y - minePos.y);
      const occluded = !hasLineOfSight(world.maze, minePos.x, minePos.y, resolved.x, resolved.y);
      if (distToMine > safeClearDist || occluded) {
        canEscape = true;
        break;
      }
    }

    return {
      legal: true,
      safe: canEscape,
      hitsEnemy: false,
      hitSlotIds: [],
      minEnemyHitTime: Infinity,
      bouncesUsed: 0,
      selfRisk: !canEscape,
      selfHitTime: canEscape ? null : armTime,
      selfBreaksShieldOnly: false,
      rejectionReason: canEscape ? 'ok' : 'mine_trap_self',
      trajectories: [],
      laserPoints: null,
    };
  }

  // 3. 散弹 / 普通弹 / 连发 / 破片 / 追踪
  const shotSpecs: Array<{
    angle: number;
    speed: number;
    radius: number;
    source: ProjectileSourceKind;
    lifetime: number;
    detonateAt?: number;
  }> = [];

  if (offense?.kind === 'shotgun') {
    const pelletAngles = computeShotgunPelletAngles(pose.angle, rules);
    for (let i = 0; i < pelletAngles.length; i += 1) {
      shotSpecs.push({
        angle: pelletAngles[i],
        speed: rules.normalBulletSpeed,
        radius: NORMAL_BULLET_RADIUS,
        source: 'shotgun',
        lifetime: rules.shotgunBulletLifetimeSeconds,
      });
    }
  } else if (offense?.kind === 'frag') {
    shotSpecs.push({
      angle: pose.angle,
      speed: rules.normalBulletSpeed * FRAG_PARENT_SPEED_MULT,
      radius: FRAG_PARENT_RADIUS,
      source: 'frag_parent',
      lifetime: rules.fragDetonateDelaySeconds + rules.fragShardLifetimeSeconds,
      detonateAt: nextBattleTime + rules.fragDetonateDelaySeconds,
    });
  } else if (offense?.kind === 'homing') {
    shotSpecs.push({
      angle: pose.angle,
      speed: rules.homingBulletSpeed,
      radius: SPECIAL_BULLET_RADIUS,
      source: 'homing',
      lifetime: rules.homingLifetimeSeconds,
    });
  } else if (offense?.kind === 'rapid_fire') {
    shotSpecs.push({
      angle: pose.angle,
      speed: rules.normalBulletSpeed * RAPID_FIRE_SPEED_MULT,
      radius: NORMAL_BULLET_RADIUS,
      source: 'rapid_fire',
      lifetime: rules.normalBulletLifetimeSeconds,
    });
  } else {
    shotSpecs.push({
      angle: pose.angle,
      speed: rules.normalBulletSpeed,
      radius: NORMAL_BULLET_RADIUS,
      source: 'normal',
      lifetime: rules.normalBulletLifetimeSeconds,
    });
  }

  const trajectories: PredictedTrajectory[] = [];
  const hitSlotSet = new Set<string>();
  let minEnemyHitTime = Infinity;
  let bestBouncesUsed = maxBounceSearch;
  let selfRisk = false;
  let selfHitTime: number | null = null;
  let rejectionReason: ShotRejectionReason = 'ok';
  const safetyHorizon = Math.min(2.6, Math.max(1.3, rules.normalBulletLifetimeSeconds * 0.45));
  const includeTail = maxBounceSearch >= 5;

  for (let i = 0; i < shotSpecs.length; i += 1) {
    const spec = shotSpecs[i];
    const muzzle = resolveMuzzleSpawn(
      world.maze,
      pose.x,
      pose.y,
      spec.angle,
      spec.speed,
      spec.radius
    );

    const traj = traceProjectileTrajectory(world.maze, rules, {
      x: muzzle.x,
      y: muzzle.y,
      vx: muzzle.vx,
      vy: muzzle.vy,
      radius: spec.radius,
      speed: spec.speed,
      source: spec.source,
      ownerSlotId: shooterSlotId,
      selfDamageUnlocked: muzzle.selfDamageUnlocked,
      startTime: nextBattleTime,
      expiresAtBattleTime: nextBattleTime + spec.lifetime,
      maxBounces: maxBounceSearch,
      includePostBounceTail: includeTail,
      maxHorizonSeconds:
        spec.source === 'frag_parent'
          ? Math.max(safetyHorizon, rules.fragDetonateDelaySeconds + 1.1)
          : Math.max(safetyHorizon, spec.lifetime),
      detonateAtBattleTime: spec.detonateAt,
      expandFragShards: spec.source === 'frag_parent',
      ownerPosAtStart: { x: pose.x, y: pose.y },
      tanksForHoming: spec.source === 'homing' ? targets : undefined,
    });
    trajectories.push(traj);

    // 校验己方自伤（近场内或贴墙立即返杀一律拒绝；远距离高速弹只在其飞回窗口 <= safetyHorizon 且无提前打中敌人时拒绝）
    const checkSelfHit = (tObj: PredictedTrajectory) => {
      const sHit = findTrajectoryHitOnTank(tObj, pose, null, shooterSlotId, true, 3);
      if (!sHit) return;
      const dtToSelf = sHit.hitTime - nextBattleTime;
      // 如果这发子弹先打中了某个敌人（非破片碎片），在真实世界里它会先销毁，不会再回头打自己
      let earliestOtherHit = Infinity;
      for (let ti = 0; ti < targets.length; ti += 1) {
        const op = targets[ti];
        if (!op.alive || op.slotId === shooterSlotId) continue;
        const oHit = findTrajectoryHitOnTank(
          tObj,
          { x: op.x, y: op.y },
          op.vx !== undefined && op.vy !== undefined ? { x: op.vx, y: op.vy } : null,
          op.slotId,
          false,
          0
        );
        if (oHit && oHit.hitTime < earliestOtherHit) {
          earliestOtherHit = oHit.hitTime;
        }
      }
      if (earliestOtherHit < sHit.hitTime - 1e-4) {
        return;
      }

      if (muzzle.bouncedAtMuzzle && dtToSelf < 0.7) {
        selfRisk = true;
        selfHitTime = selfHitTime === null ? dtToSelf : Math.min(selfHitTime, dtToSelf);
        rejectionReason = 'muzzle_wall_self_hit';
      } else if (dtToSelf <= safetyHorizon) {
        // 如果存在破盾保护期且命中在无敌时间内（极罕见如贴身散弹），只以真实是否致死区分；
        // 一般拒绝在近期安全窗口内会打回自己的开火
        if (nextBattleTime + dtToSelf >= shieldGraceUntil - 1e-6) {
          selfRisk = true;
          selfHitTime = selfHitTime === null ? dtToSelf : Math.min(selfHitTime, dtToSelf);
          if (rejectionReason === 'ok') {
            rejectionReason =
              offense?.kind === 'shotgun'
                ? 'shotgun_pellet_self_hit'
                : offense?.kind === 'frag'
                ? 'frag_self_hit'
                : 'ricochet_self_hit';
          }
        }
      }
    };

    checkSelfHit(traj);
    if (traj.childShards) {
      for (let si = 0; si < traj.childShards.length; si += 1) {
        checkSelfHit(traj.childShards[si]);
      }
    }

    // 校验敌人命中（仅统计先于自伤或不被墙遮挡的命中）
    const checkEnemyHit = (tObj: PredictedTrajectory) => {
      for (let ti = 0; ti < targets.length; ti += 1) {
        const op = targets[ti];
        if (!op.alive || op.slotId === shooterSlotId) continue;
        const eHit = findTrajectoryHitOnTank(
          tObj,
          { x: op.x, y: op.y },
          op.vx !== undefined && op.vy !== undefined ? { x: op.vx, y: op.vy } : null,
          op.slotId,
          false,
          1
        );
        if (eHit) {
          hitSlotSet.add(op.slotId);
          const dtToHit = eHit.hitTime - nextBattleTime;
          if (dtToHit < minEnemyHitTime) {
            minEnemyHitTime = dtToHit;
            bestBouncesUsed = eHit.bounceIndex;
          }
        }
      }
    };

    checkEnemyHit(traj);
    if (traj.childShards) {
      for (let si = 0; si < traj.childShards.length; si += 1) {
        checkEnemyHit(traj.childShards[si]);
      }
    }
  }

  return {
    legal: true,
    safe: !selfRisk,
    hitsEnemy: hitSlotSet.size > 0,
    hitSlotIds: Array.from(hitSlotSet),
    minEnemyHitTime,
    bouncesUsed: hitSlotSet.size > 0 ? bestBouncesUsed : 0,
    selfRisk,
    selfHitTime,
    selfBreaksShieldOnly: selfRisk && hasShieldProtection,
    rejectionReason,
    trajectories,
    laserPoints: null,
  };
}

/**
 * 同步审查竞争道具：若本步存在同帧争夺道具，必须在「保留当前武器」与「拾取新道具」两种可能下均安全。
 */
export function evaluateShotWithContestedPickup(
  world: TankWorldState,
  self: TankEntity,
  stepState: PredictedTankStepState,
  prevFireHeld: boolean,
  maxBounceSearch: number,
  targetPositions?: ReadonlyArray<{ slotId: string; x: number; y: number; alive: boolean; vx?: number; vy?: number }>
): EvaluatedShotResult {
  const baseEval = evaluateWeaponShot(
    world,
    self.slotId,
    stepState.pose,
    stepState.nextBattleTime,
    stepState.ammo,
    stepState.fireReadyAt,
    stepState.shield,
    stepState.shieldGraceUntil,
    stepState.offense,
    prevFireHeld,
    maxBounceSearch,
    targetPositions
  );

  if (!stepState.contestedPickup) {
    return baseEval;
  }

  const altApplied = applyPredictedPickup(
    stepState.contestedPickup,
    stepState.nextBattleTime,
    world.rules,
    stepState.shield,
    stepState.offense
  );
  const altEval = evaluateWeaponShot(
    world,
    self.slotId,
    stepState.pose,
    stepState.nextBattleTime,
    stepState.ammo,
    stepState.fireReadyAt,
    altApplied.shield,
    stepState.shieldGraceUntil,
    altApplied.offense,
    prevFireHeld,
    maxBounceSearch,
    targetPositions
  );

  if (!altEval.safe) {
    return {
      ...baseEval,
      safe: false,
      selfRisk: true,
      rejectionReason: 'contested_pickup_unsafe',
    };
  }
  return baseEval;
}

/**
 * 校验用一发普通射击在实战步进顺序下对消来袭普通子弹的可行性：
 * 1. normalBulletCancelEnabled 必须开启，且双方均必须是 source === 'normal'
 * 2. 我方弹夹 >= 1、非道具替代武器、满足冷却且有按下上升沿
 * 3. 在我方或敌方子弹撞墙/击中我方之前，两者相对运动在固定步边界内发生相消
 * 4. 相消前没有第三颗弹体先命中我方或拦截我方子弹
 */
export function evaluateNormalBulletCancellation(
  world: TankWorldState,
  self: TankEntity,
  stepState: PredictedTankStepState,
  incomingProj: ProjectileEntity,
  prevFireHeld: boolean
): { canCancel: boolean; aimAngle: number; cancelTime: number } | null {
  const rules = world.rules;
  if (!rules.normalBulletCancelEnabled) return null;
  if (incomingProj.source !== 'normal') return null;
  if (stepState.offense !== null || stepState.contestedPickup !== null) return null;
  if (stepState.ammo < 1) return null;
  if (prevFireHeld) return null;
  if (stepState.nextBattleTime + 1e-9 < stepState.fireReadyAt) return null;

  // 仅当敌弹大体朝自己飞来时计算截击角
  const aimAngle = Math.atan2(
    incomingProj.y + incomingProj.vy * 0.05 - stepState.pose.y,
    incomingProj.x + incomingProj.vx * 0.05 - stepState.pose.x
  );
  const angleDiff = Math.abs(Math.atan2(Math.sin(aimAngle - stepState.pose.angle), Math.cos(aimAngle - stepState.pose.angle)));
  if (angleDiff > 0.25) return null;

  const muzzle = resolveMuzzleSpawn(
    world.maze,
    stepState.pose.x,
    stepState.pose.y,
    stepState.pose.angle,
    rules.normalBulletSpeed,
    NORMAL_BULLET_RADIUS
  );
  if (muzzle.bouncedAtMuzzle) return null;

  // 逐步推演双方普通弹（遵循 stepProjectilesAndMines 先检测对消、再扫墙与击中的顺序）
  let ax = muzzle.x;
  let ay = muzzle.y;
  const avx = muzzle.vx;
  const avy = muzzle.vy;

  let bx = incomingProj.x;
  let by = incomingProj.y;
  const bvx = incomingProj.vx;
  const bvy = incomingProj.vy;

  const maxSteps = 24;
  for (let s = 0; s < maxSteps; s += 1) {
    const tBase = stepState.nextBattleTime + s * SIM_STEP_SECONDS;
    if (tBase >= incomingProj.expiresAtBattleTime) return null;

    // 1. 步首检查第三颗弹是否先拦截我方子弹或已击中我方
    for (let k = 0; k < world.projectiles.length; k += 1) {
      const other = world.projectiles[k];
      if (other.id === incomingProj.id) continue;
      if (other.source === 'normal') {
        const ox = other.x + other.vx * (s * SIM_STEP_SECONDS);
        const oy = other.y + other.vy * (s * SIM_STEP_SECONDS);
        const intercept = sweepMovingCircleAgainstMovingCircle(
          ax,
          ay,
          avx,
          avy,
          NORMAL_BULLET_RADIUS,
          ox,
          oy,
          other.vx,
          other.vy,
          other.radius,
          SIM_STEP_SECONDS
        );
        if (intercept !== null) return null;
      }
    }

    // 2. 检查我方弹与目标来袭普通弹是否在当前步内相消
    const cancelT = sweepMovingCircleAgainstMovingCircle(
      ax,
      ay,
      avx,
      avy,
      NORMAL_BULLET_RADIUS,
      bx,
      by,
      bvx,
      bvy,
      incomingProj.radius,
      SIM_STEP_SECONDS
    );
    if (cancelT !== null) {
      return {
        canCancel: true,
        aimAngle: stepState.pose.angle,
        cancelTime: s * SIM_STEP_SECONDS + cancelT * SIM_STEP_SECONDS,
      };
    }

    // 3. 若未相消，若任意一弹撞墙或击中我方坦克，则此对消路径无效
    const wallA = sweepCircleAgainstMaze(
      ax,
      ay,
      avx * SIM_STEP_SECONDS,
      avy * SIM_STEP_SECONDS,
      NORMAL_BULLET_RADIUS,
      world.maze
    );
    if (wallA) return null;

    const wallB = sweepCircleAgainstMaze(
      bx,
      by,
      bvx * SIM_STEP_SECONDS,
      bvy * SIM_STEP_SECONDS,
      incomingProj.radius,
      world.maze
    );
    if (wallB) return null;

    const hitSelf = sweepPointAgainstCircle(
      bx,
      by,
      bvx * SIM_STEP_SECONDS,
      bvy * SIM_STEP_SECONDS,
      stepState.pose.x,
      stepState.pose.y,
      TANK_RADIUS + incomingProj.radius
    );
    if (hitSelf !== null) return null;

    ax += avx * SIM_STEP_SECONDS;
    ay += avy * SIM_STEP_SECONDS;
    bx += bvx * SIM_STEP_SECONDS;
    by += bvy * SIM_STEP_SECONDS;
  }

  return null;
}

export function getCellCoordFromWorld(maze: MazeData, x: number, y: number): number {
  return worldToCellIndex(maze, x, y);
}

export function getCellCenter(maze: MazeData, cellIndex: number): Vec2 {
  const c = maze.cells[cellIndex];
  return c ? { x: c.centerX, y: c.centerY } : { x: CELL_SIZE * 0.5, y: CELL_SIZE * 0.5 };
}
