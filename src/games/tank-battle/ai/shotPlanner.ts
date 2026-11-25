import { traceLaserRay } from '../combat/projectiles';
import { worldToCellIndex } from '../map/generateMaze';
import { hasLineOfSight } from '../simulation/collision';
import {
  CELL_SIZE,
  TANK_RADIUS,
  type MazeData,
  type TankEntity,
  type TankWorldState,
  type Vec2,
} from '../types';
import {
  evaluateNormalBulletCancellation,
  evaluateShotWithContestedPickup,
  evaluateWeaponShot,
  type EvaluatedShotResult,
  type PredictedTankStepState,
  type ShotRejectionReason,
} from './physicsPrediction';
import type { OpponentEstimate, SharedStepContext } from './threatMap';

export function normalizeAngle(delta: number): number {
  let d = delta;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export interface ShotSearchConfig {
  maxBounceSearch: number;
  sweepAngles: number;
  useLeadPrediction: boolean;
  useMirrorReflections: boolean;
  useCancelDefense: boolean;
  aimToleranceRad: number;
  maxShotDist: number;
  /** 最大可接受普通弹飞行耗时（避免远距离浪费 0.8s 冷却）；未设置时不限 */
  maxNormalHitTimeSeconds?: number;
  /** Lv.5 零犹豫、主动封出口；低档允许相对保守 */
  sealExitsEnabled: boolean;
}

export interface AimSolution {
  desiredAimAngle: number | null;
  targetSlotId: string | null;
  expectedBounces: number;
  expectedHitTime: number;
  score: number;
  isLaser: boolean;
  isCancelShot: boolean;
  cancelProjId: number | null;
}

export interface FinalFireDecision {
  shouldFire: boolean;
  rejectionReason: ShotRejectionReason;
  evaluated: EvaluatedShotResult | null;
  isCancelShot: boolean;
}

/**
 * 构造基于墙面镜像反射、墙端切角与均匀角度扫描的高命中候选角集合。
 */
function buildCandidateAimAngles(
  maze: MazeData,
  selfPos: Vec2,
  selfAngle: number,
  enemies: ReadonlyArray<OpponentEstimate>,
  bulletSpeed: number,
  config: ShotSearchConfig
): number[] {
  const candidates: number[] = [];
  const seenBuckets = new Set<number>();

  const addAngle = (rad: number, fineBucket = false) => {
    const a = normalizeAngle(rad);
    const scale = fineBucket ? 120 : 48; // ~0.5° 精准解，~1.2° 扫掠去重
    const bucket = Math.round((a + Math.PI) * scale) + (fineBucket ? 100000 : 0);
    if (seenBuckets.has(bucket)) return;
    seenBuckets.add(bucket);
    candidates.push(a);
  };

  // 首先加入当前炮口朝向（用于检查即刻是否正好过窗）
  addAngle(selfAngle, true);

  // 对前 3 个最近/最危险对手构造直射、提前量与墙面镜像角
  const sortedEnemies = enemies
    .slice()
    .sort(
      (a, b) =>
        Math.hypot(a.x - selfPos.x, a.y - selfPos.y) -
        Math.hypot(b.x - selfPos.x, b.y - selfPos.y)
    );
  const topCount = Math.min(3, sortedEnemies.length);

  for (let ei = 0; ei < topCount; ei += 1) {
    const op = sortedEnemies[ei];
    const dx = op.x - selfPos.x;
    const dy = op.y - selfPos.y;
    const dist = Math.hypot(dx, dy);
    const direct = Math.atan2(dy, dx);
    addAngle(direct, true);

    if (config.useLeadPrediction && op.speed > 5) {
      const flightT = Math.min(0.9, dist / Math.max(120, bulletSpeed));
      for (const scale of [0.5, 0.95]) {
        const px = op.x + op.vx * flightT * scale;
        const py = op.y + op.vy * flightT * scale;
        addAngle(Math.atan2(py - selfPos.y, px - selfPos.x), true);
      }
    }

    if (config.useMirrorReflections && config.maxBounceSearch >= 1 && dist < config.maxShotDist) {
      // 按水平线 y / 竖直线 x 去重提取附近真实墙面线
      const hLines = new Set<number>();
      const vLines = new Set<number>();
      for (let wi = 0; wi < maze.walls.length; wi += 1) {
        const w = maze.walls[wi];
        if (w.orientation === 'h') {
          if (Math.abs(w.y1 - selfPos.y) <= CELL_SIZE * 2.8) hLines.add(w.y1);
        } else {
          if (Math.abs(w.x1 - selfPos.x) <= CELL_SIZE * 2.8) vLines.add(w.x1);
        }
      }

      const nearMirrorPts: Vec2[] = [];
      for (const wy of hLines) {
        const my = 2 * wy - op.y;
        nearMirrorPts.push({ x: op.x, y: my });
        addAngle(Math.atan2(my - selfPos.y, op.x - selfPos.x), true);
      }
      for (const wx of vLines) {
        const mx = 2 * wx - op.x;
        nearMirrorPts.push({ x: mx, y: op.y });
        addAngle(Math.atan2(op.y - selfPos.y, mx - selfPos.x), true);
      }

      // 2 次镜像靶点（L 形走廊拐角狙击）
      if (config.maxBounceSearch >= 2 && ei === 0) {
        for (let mi = 0; mi < nearMirrorPts.length; mi += 1) {
          const mp = nearMirrorPts[mi];
          for (const wy of hLines) {
            addAngle(Math.atan2(2 * wy - mp.y - selfPos.y, mp.x - selfPos.x));
          }
          for (const wx of vLines) {
            addAngle(Math.atan2(mp.y - selfPos.y, 2 * wx - mp.x - selfPos.x));
          }
        }
      }
    }
  }

  // 均匀多角度粗扫覆盖高阶 3~5 次反弹与复杂拐角路径
  if (config.maxBounceSearch >= 1 && config.sweepAngles > 0) {
    const step = (Math.PI * 2) / config.sweepAngles;
    for (let i = 0; i < config.sweepAngles; i += 1) {
      addAngle(-Math.PI + i * step);
    }
  }

  return candidates;
}

/**
 * 为当前步搜索全局最佳瞄准解（同时评估直视、多段反弹、激光全折线、散弹扇区、破片炸点与追踪释放）。
 */
export function findBestAimSolution(
  world: TankWorldState,
  shared: SharedStepContext,
  self: TankEntity,
  opponents: ReadonlyArray<OpponentEstimate>,
  config: ShotSearchConfig
): AimSolution {
  const enemies = opponents.filter((o) => o.alive && o.slotId !== self.slotId);
  if (enemies.length === 0) {
    return {
      desiredAimAngle: null,
      targetSlotId: null,
      expectedBounces: 0,
      expectedHitTime: Infinity,
      score: -Infinity,
      isLaser: false,
      isCancelShot: false,
      cancelProjId: null,
    };
  }

  const offenseKind = self.offense?.kind ?? null;
  const isLaser = offenseKind === 'laser';
  const simTargets = enemies.map((e) => ({
    slotId: e.slotId,
    x: e.x,
    y: e.y,
    alive: true,
    vx: config.useLeadPrediction ? e.vx * 0.65 : 0,
    vy: config.useLeadPrediction ? e.vy * 0.65 : 0,
  }));
  // 把自身也放入激光检查，确保激光全折线不打自己
  const laserSimTanks = [
    { slotId: self.slotId, x: self.x, y: self.y, alive: true },
    ...enemies.map((e) => ({ slotId: e.slotId, x: e.x, y: e.y, alive: true })),
  ];

  // 1. 地雷：不依赖炮口瞄准角，朝当前航线即可
  if (offenseKind === 'mine') {
    return {
      desiredAimAngle: self.angle,
      targetSlotId: enemies[0].slotId,
      expectedBounces: 0,
      expectedHitTime: Infinity,
      score: 10,
      isLaser: false,
      isCancelShot: false,
      cancelProjId: null,
    };
  }

  // 2. 追踪弹：评估朝前方开阔通道方向，避免贴墙或立刻拐回自己
  if (offenseKind === 'homing') {
    const candidateAngles = [
      self.angle,
      self.angle + 0.45,
      self.angle - 0.45,
      Math.atan2(enemies[0].y - self.y, enemies[0].x - self.x),
    ];
    let bestHomingAngle: number | null = null;
    let bestHomingScore = -Infinity;
    for (const ang of candidateAngles) {
      const ev = evaluateWeaponShot(
        world,
        self.slotId,
        { x: self.x, y: self.y, angle: ang },
        world.battleTime + 1 / 60,
        self.ammo,
        0,
        self.shield,
        self.shieldGraceUntil,
        self.offense,
        false,
        Math.min(2, config.maxBounceSearch),
        simTargets
      );
      if (!ev.safe) continue;
      const turnCost = Math.abs(normalizeAngle(ang - self.angle)) * 18;
      const hitBonus = ev.hitsEnemy ? 200 - ev.minEnemyHitTime * 35 : 40;
      const sc = hitBonus - turnCost;
      if (sc > bestHomingScore) {
        bestHomingScore = sc;
        bestHomingAngle = ang;
      }
    }
    return {
      desiredAimAngle: bestHomingAngle,
      targetSlotId: enemies[0].slotId,
      expectedBounces: 0,
      expectedHitTime: Infinity,
      score: bestHomingScore,
      isLaser: false,
      isCancelShot: false,
      cancelProjId: null,
    };
  }

  // 3. 构建全部候选角并评分
  const bulletSpeed =
    offenseKind === 'rapid_fire'
      ? world.rules.normalBulletSpeed * 1.04
      : world.rules.normalBulletSpeed;
  const candidateAngles = buildCandidateAimAngles(
    world.maze,
    { x: self.x, y: self.y },
    self.angle,
    enemies,
    bulletSpeed,
    config
  );

  let bestSolution: AimSolution = {
    desiredAimAngle: null,
    targetSlotId: null,
    expectedBounces: 0,
    expectedHitTime: Infinity,
    score: -Infinity,
    isLaser,
    isCancelShot: false,
    cancelProjId: null,
  };

  const evaluateAngle = (ang: number) => {
    if (isLaser) {
      const trace = traceLaserRay(
        world.maze,
        laserSimTanks,
        self.slotId,
        self.x,
        self.y,
        ang,
        world.rules.laserMaxBounces
      );
      // 完整激光折线（含第 6 次及以上反射）只要命中自己一律否决
      if (trace.hitTankSlotId === self.slotId) return;
      if (!trace.hitTankSlotId) return;
      // 非 Lv.5 低档搜索范围限制主要解的反弹数（但安全审查依然跑满完整折线）
      if (trace.bouncesExecuted > Math.max(config.maxBounceSearch, 1) && config.maxBounceSearch < 5) {
        return;
      }
      const turnErr = Math.abs(normalizeAngle(ang - self.angle));
      const targetOp = enemies.find((e) => e.slotId === trace.hitTankSlotId);
      const shieldPenalty = targetOp?.hasShield ? 35 : 0;
      const score = 450 - trace.bouncesExecuted * 38 - turnErr * 45 - shieldPenalty;
      if (score > bestSolution.score) {
        bestSolution = {
          desiredAimAngle: ang,
          targetSlotId: trace.hitTankSlotId,
          expectedBounces: trace.bouncesExecuted,
          expectedHitTime: 0,
          score,
          isLaser: true,
          isCancelShot: false,
          cancelProjId: null,
        };
      }
      return;
    }

    // 常规 / 连发 / 散弹 / 破片弹同源评估（绕开冷却与按键边沿限制仅测几何命中与自伤）
    const ev = evaluateWeaponShot(
      world,
      self.slotId,
      { x: self.x, y: self.y, angle: ang },
      world.battleTime + 1 / 60,
      Math.max(self.ammo, world.rules.shotgunAmmoCost),
      0,
      self.shield,
      self.shieldGraceUntil,
      self.offense,
      false,
      config.maxBounceSearch,
      simTargets
    );

    if (!ev.safe) return;

    // 破片弹额外计算爆点在敌方格附近/封多条退路的价值
    if (offenseKind === 'frag' && ev.trajectories[0]?.detonationPos) {
      const detPos = ev.trajectories[0].detonationPos;
      const detCell = worldToCellIndex(world.maze, detPos.x, detPos.y);
      let fragScore = ev.hitsEnemy ? 360 : 0;
      for (let i = 0; i < enemies.length; i += 1) {
        const op = enemies[i];
        const dDet = Math.hypot(op.x - detPos.x, op.y - detPos.y);
        if (dDet < 190 && hasLineOfSight(world.maze, detPos.x, detPos.y, op.x, op.y)) {
          const exitCount = shared.mazeCache.cellDegrees[detCell];
          fragScore += (190 - dDet) * 1.4 + exitCount * 15;
        }
      }
      if (fragScore > 120) {
        const turnErr = Math.abs(normalizeAngle(ang - self.angle));
        const sc = fragScore - turnErr * 35;
        if (sc > bestSolution.score) {
          bestSolution = {
            desiredAimAngle: ang,
            targetSlotId: enemies[0].slotId,
            expectedBounces: ev.bouncesUsed,
            expectedHitTime: ev.minEnemyHitTime,
            score: sc,
            isLaser: false,
            isCancelShot: false,
            cancelProjId: null,
          };
        }
        return;
      }
    }

    if (!ev.hitsEnemy) return;

    // 3~5 次远距离高反弹赌博射：仅当弹药充足（>= 6 发）或对手处于低自由度窄道时才出手，避免空窗冷却被反打
    if (
      config.sealExitsEnabled &&
      ev.bouncesUsed >= 2 &&
      self.offense === null &&
      self.ammo < 6 &&
      ev.minEnemyHitTime > 0.72
    ) {
      return;
    }

    // 普通弹飞行时间过长时极易被高阶 AI 轻松躲开并反打 0.8s 冷却空窗；
    // 仅当对手位于窄道/拐角封锁区或为贴身短程命中时才允许放远程反弹弹幕
    if (
      config.maxNormalHitTimeSeconds !== undefined &&
      self.offense === null &&
      ev.minEnemyHitTime > config.maxNormalHitTimeSeconds
    ) {
      const hitEnemy = ev.hitSlotIds[0]
        ? enemies.find((e) => e.slotId === ev.hitSlotIds[0])
        : undefined;
      const enemyDeg = hitEnemy
        ? shared.mazeCache.cellDegrees[worldToCellIndex(world.maze, hitEnemy.x, hitEnemy.y)] ?? 4
        : 4;
      const allowCornerTrap =
        config.sealExitsEnabled &&
        self.ammo >= 7 &&
        enemyDeg <= 2 &&
        ev.minEnemyHitTime <= 1.35;
      if (!allowCornerTrap) {
        return;
      }
    }

    const turnErr = Math.abs(normalizeAngle(ang - self.angle));
    const hitCountBonus = (ev.hitSlotIds.length - 1) * 90;
    // 优先短时间、少反弹的稳健路线
    let score =
      360 +
      hitCountBonus -
      ev.bouncesUsed * 44 -
      ev.minEnemyHitTime * 85 -
      turnErr * 42;

    // Lv.5 评估目标逃逸出口封锁：如果敌人退无可退，给予额外高分
    if (config.sealExitsEnabled && ev.hitSlotIds.length > 0) {
      const hitEnemy = enemies.find((e) => e.slotId === ev.hitSlotIds[0]);
      if (hitEnemy) {
        const opCell = worldToCellIndex(world.maze, hitEnemy.x, hitEnemy.y);
        const deg = shared.mazeCache.cellDegrees[opCell];
        if (deg <= 2) score += 38;
        if (ev.bouncesUsed === 0 && ev.minEnemyHitTime < 0.55) score += 45;
        if (offenseKind === 'shotgun') {
          const d = Math.hypot(hitEnemy.x - self.x, hitEnemy.y - self.y);
          if (d < 220) score += 65; // 散弹近身多弹道封杀极强
        }
      }
    }

    if (score > bestSolution.score) {
      bestSolution = {
        desiredAimAngle: ang,
        targetSlotId: ev.hitSlotIds[0] ?? enemies[0].slotId,
        expectedBounces: ev.bouncesUsed,
        expectedHitTime: ev.minEnemyHitTime,
        score,
        isLaser: false,
        isCancelShot: false,
        cancelProjId: null,
      };
    }
  };

  for (let i = 0; i < candidateAngles.length; i += 1) {
    evaluateAngle(candidateAngles[i]);
  }

  // 对最优反弹解做局部 ±3° 精细二分，消除离散扫描误差
  if (bestSolution.desiredAimAngle !== null && config.maxBounceSearch >= 1) {
    const center = bestSolution.desiredAimAngle;
    for (const offset of [-0.045, -0.022, 0.022, 0.045]) {
      evaluateAngle(normalizeAngle(center + offset));
    }
  }

  return bestSolution;
}

/**
 * 最终开火门控：基于「预计本步移动并拾取道具后」的真实炮口姿态、冷却、弹药与按下边沿决定是否扣动扳机。
 */
export function decideFinalFireAction(
  world: TankWorldState,
  self: TankEntity,
  postMoveState: PredictedTankStepState,
  aimSolution: AimSolution,
  opponents: ReadonlyArray<OpponentEstimate>,
  prevFireHeld: boolean,
  config: ShotSearchConfig,
  mustCancelUrgent: boolean
): FinalFireDecision {
  const enemies = opponents.filter((o) => o.alive && o.slotId !== self.slotId);
  const simTargets = enemies.map((e) => ({
    slotId: e.slotId,
    x: e.x,
    y: e.y,
    alive: true,
    vx: config.useLeadPrediction ? e.vx * 0.65 : 0,
    vy: config.useLeadPrediction ? e.vy * 0.65 : 0,
  }));

  // 先用真实 postMoveState 校验本步实际炮口角度的合法性与安全性
  const actualEval = evaluateShotWithContestedPickup(
    world,
    self,
    postMoveState,
    prevFireHeld,
    config.maxBounceSearch,
    simTargets
  );

  if (!actualEval.legal) {
    return {
      shouldFire: false,
      rejectionReason: actualEval.rejectionReason,
      evaluated: actualEval,
      isCancelShot: false,
    };
  }

  if (!actualEval.safe) {
    return {
      shouldFire: false,
      rejectionReason: actualEval.rejectionReason,
      evaluated: actualEval,
      isCancelShot: false,
    };
  }

  // 1. 若无安全躲避路径且规则允许普通弹对消，检查来袭普通弹是否可验证对消
  if (mustCancelUrgent && config.useCancelDefense) {
    for (let i = 0; i < world.projectiles.length; i += 1) {
      const p = world.projectiles[i];
      if (p.ownerSlotId === self.slotId && !p.selfDamageUnlocked) continue;
      if (p.source !== 'normal') continue;
      const cancelRes = evaluateNormalBulletCancellation(
        world,
        self,
        postMoveState,
        p,
        prevFireHeld
      );
      if (cancelRes && cancelRes.canCancel) {
        return {
          shouldFire: true,
          rejectionReason: 'ok',
          evaluated: actualEval,
          isCancelShot: true,
        };
      }
    }
  }

  // 2. 地雷战术释放时机：敌人在必经路径接近且己方校验可安全撤离
  if (postMoveState.offense?.kind === 'mine') {
    const nearestEnemyDist = enemies.reduce(
      (best, op) => Math.min(best, Math.hypot(op.x - postMoveState.pose.x, op.y - postMoveState.pose.y)),
      Infinity
    );
    const selfCell = worldToCellIndex(world.maze, postMoveState.pose.x, postMoveState.pose.y);
    const isChoke = world.maze.cells[selfCell].neighbors.length <= 2;
    if ((isChoke && nearestEnemyDist < 340 && nearestEnemyDist > 90) || nearestEnemyDist < 220) {
      return {
        shouldFire: true,
        rejectionReason: 'ok',
        evaluated: actualEval,
        isCancelShot: false,
      };
    }
    return {
      shouldFire: false,
      rejectionReason: 'ok',
      evaluated: actualEval,
      isCancelShot: false,
    };
  }

  // 3. 如果当前实际炮口角度本身就能安全命中敌方（直觉模式旋转过窗抓射的核心），直接开火！
  if (actualEval.hitsEnemy) {
    // 破片弹避免极近距离放炮波及自身
    if (
      postMoveState.offense?.kind === 'frag' &&
      actualEval.minEnemyHitTime < 0.25 &&
      !postMoveState.shield
    ) {
      return {
        shouldFire: false,
        rejectionReason: 'frag_self_hit',
        evaluated: actualEval,
        isCancelShot: false,
      };
    }
    // 弹药纪律：剩余弹药较少或长距离非必中窗口时，保留冷却与弹药等待必杀机会
    if (
      config.maxNormalHitTimeSeconds !== undefined &&
      postMoveState.offense === null &&
      actualEval.minEnemyHitTime > config.maxNormalHitTimeSeconds &&
      !(config.sealExitsEnabled && postMoveState.ammo >= 7 && actualEval.minEnemyHitTime <= 1.25)
    ) {
      return {
        shouldFire: false,
        rejectionReason: 'ok',
        evaluated: actualEval,
        isCancelShot: false,
      };
    }
    if (
      config.sealExitsEnabled &&
      postMoveState.offense === null &&
      postMoveState.ammo <= 4 &&
      actualEval.bouncesUsed >= 2 &&
      actualEval.minEnemyHitTime > 0.7
    ) {
      return {
        shouldFire: false,
        rejectionReason: 'ok',
        evaluated: actualEval,
        isCancelShot: false,
      };
    }
    return {
      shouldFire: true,
      rejectionReason: 'ok',
      evaluated: actualEval,
      isCancelShot: false,
    };
  }

  // 4. 若当前实际角对齐所选目标角在允许容差内，再次确认是否值得开火（例如封锁破片区/追踪弹）
  if (aimSolution.desiredAimAngle !== null) {
    const err = Math.abs(normalizeAngle(aimSolution.desiredAimAngle - postMoveState.pose.angle));
    if (err <= config.aimToleranceRad) {
      if (
        postMoveState.offense?.kind === 'homing' ||
        postMoveState.offense?.kind === 'frag'
      ) {
        return {
          shouldFire: true,
          rejectionReason: 'ok',
          evaluated: actualEval,
          isCancelShot: false,
        };
      }
      // 常规武器未在真实几何扫掠命中，仅当非常接近时（防极细微速度偏移）才不浪费弹药
      if (
        postMoveState.offense === null &&
        postMoveState.ammo >= 3 &&
        err <= Math.min(0.06, config.aimToleranceRad) &&
        aimSolution.expectedBounces === 0
      ) {
        return {
          shouldFire: true,
          rejectionReason: 'ok',
          evaluated: actualEval,
          isCancelShot: false,
        };
      }
    }
  }

  return {
    shouldFire: false,
    rejectionReason: 'ok',
    evaluated: actualEval,
    isCancelShot: false,
  };
}
