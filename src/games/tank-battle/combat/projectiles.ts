import type { SoundEventKind } from '../../../platform/games/contracts';
import { applyDamageToTank } from '../items/effects';
import {
  computeBfsDistances,
  findNextPathCell,
  worldToCellIndex,
} from '../map/generateMaze';
import {
  hasLineOfSight,
  sweepCircleAgainstMaze,
  sweepMovingCircleAgainstMovingCircle,
  sweepPointAgainstCircle,
} from '../simulation/collision';
import {
  FRAG_SHARD_RADIUS,
  type MazeData,
  type ProjectileEntity,
  type ProjectileSourceKind,
  TANK_BARREL_LENGTH,
  TANK_RADIUS,
  type TankEntity,
  type TankWorldState,
  type Vec2,
} from '../types';

const DEG_TO_RAD = Math.PI / 180;

/**
 * 在炮口生成弹体；若炮口与墙体距离小于炮管长度（贴墙开火），
 * 立即在墙面反射点出膛并解锁自伤，防止弹体嵌入墙内并支持贴墙自毁。
 */
export function spawnProjectileFromMuzzle(
  world: TankWorldState,
  tank: TankEntity,
  angle: number,
  speed: number,
  radius: number,
  source: ProjectileSourceKind,
  lifetimeSeconds: number,
  nextId: () => number,
  extra?: { detonateAtBattleTime?: number }
): ProjectileEntity {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const muzzleDx = dirX * TANK_BARREL_LENGTH;
  const muzzleDy = dirY * TANK_BARREL_LENGTH;

  let spawnX = tank.x + muzzleDx;
  let spawnY = tank.y + muzzleDy;
  let vx = dirX * speed;
  let vy = dirY * speed;
  let selfDamageUnlocked = false;

  const wallHit = sweepCircleAgainstMaze(tank.x, tank.y, muzzleDx, muzzleDy, radius, world.maze);
  if (wallHit) {
    // 炮口贴墙：在墙前极小安全偏移处生成并立即按法线反射，同时解锁自伤
    spawnX = wallHit.x + wallHit.nx * 0.4;
    spawnY = wallHit.y + wallHit.ny * 0.4;
    const dot = vx * wallHit.nx + vy * wallHit.ny;
    if (dot < 0) {
      vx -= 2 * dot * wallHit.nx;
      vy -= 2 * dot * wallHit.ny;
    }
    selfDamageUnlocked = true;
    world.visualCues.push({
      kind: 'bounce',
      x: wallHit.x,
      y: wallHit.y,
      colorHex: tank.colorHex,
    });
  }

  const proj: ProjectileEntity = {
    id: nextId(),
    ownerSlotId: tank.slotId,
    colorHex: tank.colorHex,
    source,
    x: spawnX,
    y: spawnY,
    vx,
    vy,
    radius,
    speed,
    spawnedAtBattleTime: world.battleTime,
    expiresAtBattleTime: world.battleTime + lifetimeSeconds,
    selfDamageUnlocked,
    detonateAtBattleTime: extra?.detonateAtBattleTime,
    repathTimer: 0,
    waypoint: null,
    trail: [{ x: spawnX, y: spawnY }],
  };
  world.projectiles.push(proj);
  return proj;
}

/**
 * 步首清理超过寿命的弹体。
 */
export function expireProjectiles(world: TankWorldState): void {
  for (let i = world.projectiles.length - 1; i >= 0; i -= 1) {
    if (world.projectiles[i].expiresAtBattleTime <= world.battleTime + 1e-9) {
      world.projectiles.splice(i, 1);
    }
  }
}

/**
 * 瞬发激光射线计算：
 * - 沿炮口方向出发，遇墙最多反射 laserMaxBounces 次（墙角合并法线只计 1 次）
 * - 遇到第一辆存活坦克即停止；首次出膛段忽略发射者，经墙反射后可命中发射者
 * - 击中护盾只破盾，光迹仅作短暂视觉显示
 */
export function fireLaserRay(
  world: TankWorldState,
  shooter: TankEntity,
  eliminatedSet: Set<string>,
  nextId: () => number,
  sounds: SoundEventKind[]
): void {
  const maxBounces = world.rules.laserMaxBounces;
  const maxSegmentDist = Math.hypot(world.maze.width, world.maze.height) * 2;
  let curX = shooter.x;
  let curY = shooter.y;
  let dirX = Math.cos(shooter.angle);
  let dirY = Math.sin(shooter.angle);

  const points: Vec2[] = [
    {
      x: shooter.x + dirX * (TANK_RADIUS * 0.6),
      y: shooter.y + dirY * (TANK_RADIUS * 0.6),
    },
  ];

  // 检查枪口到机身外缘之间是否有墙（贴墙发激光直接立即反射）
  for (let bounce = 0; bounce <= maxBounces; bounce += 1) {
    const dx = dirX * maxSegmentDist;
    const dy = dirY * maxSegmentDist;
    const wallHit = sweepCircleAgainstMaze(curX, curY, dx, dy, 1.5, world.maze);
    const wallT = wallHit ? wallHit.t : 1;

    // 寻找本段射线命中的第一辆坦克（bounce === 0 时忽略发射者自身）
    let earliestTank: TankEntity | null = null;
    let earliestTankT = wallT;

    for (let i = 0; i < world.tanks.length; i += 1) {
      const target = world.tanks[i];
      if (!target.alive) continue;
      if (bounce === 0 && target.slotId === shooter.slotId) continue;
      const t = sweepPointAgainstCircle(curX, curY, dx, dy, target.x, target.y, TANK_RADIUS);
      if (t !== null && t < earliestTankT) {
        earliestTankT = t;
        earliestTank = target;
      }
    }

    if (earliestTank) {
      const hitX = curX + dx * earliestTankT;
      const hitY = curY + dy * earliestTankT;
      points.push({ x: hitX, y: hitY });
      applyDamageToTank(earliestTank, world, eliminatedSet, sounds, shooter.slotId);
      break;
    }

    if (!wallHit) {
      points.push({ x: curX + dx, y: curY + dy });
      break;
    }

    points.push({ x: wallHit.x, y: wallHit.y });
    if (bounce === maxBounces) {
      break;
    }

    // 反射方向，并沿法线微推避免重复命中同一面墙
    const dot = dirX * wallHit.nx + dirY * wallHit.ny;
    dirX -= 2 * dot * wallHit.nx;
    dirY -= 2 * dot * wallHit.ny;
    const len = Math.hypot(dirX, dirY) || 1;
    dirX /= len;
    dirY /= len;
    curX = wallHit.x + wallHit.nx * 0.5;
    curY = wallHit.y + wallHit.ny * 0.5;
  }

  world.laserBeams.push({
    id: nextId(),
    ownerSlotId: shooter.slotId,
    colorHex: shooter.colorHex,
    points,
    remainingVisualSeconds: 0.34,
    maxVisualSeconds: 0.34,
  });
}

/**
 * 追踪弹沿迷宫通路转向最近对手，受限于最大角速度。
 */
function steerHomingProjectile(proj: ProjectileEntity, world: TankWorldState, dt: number): void {
  proj.repathTimer = (proj.repathTimer ?? 0) - dt;
  const projCell = worldToCellIndex(world.maze, proj.x, proj.y);

  // 寻找沿迷宫通道距离最近的存活对手
  let targetTank: TankEntity | null = null;
  let bestPathDist = Infinity;
  let bestEuclid = Infinity;
  const distFromProj = computeBfsDistances(world.maze, projCell);

  for (let i = 0; i < world.tanks.length; i += 1) {
    const t = world.tanks[i];
    if (!t.alive || t.slotId === proj.ownerSlotId) continue;
    const tCell = worldToCellIndex(world.maze, t.x, t.y);
    const pathDist = distFromProj[tCell];
    const euclid = Math.hypot(t.x - proj.x, t.y - proj.y);
    if (
      pathDist >= 0 &&
      (pathDist < bestPathDist || (pathDist === bestPathDist && euclid < bestEuclid))
    ) {
      bestPathDist = pathDist;
      bestEuclid = euclid;
      targetTank = t;
    }
  }

  if (!targetTank) return;

  // 若存在直视视线，直接朝对手转向；否则沿迷宫最短通道下一格中心转向
  let aimX = targetTank.x;
  let aimY = targetTank.y;
  if (!hasLineOfSight(world.maze, proj.x, proj.y, targetTank.x, targetTank.y)) {
    const targetCell = worldToCellIndex(world.maze, targetTank.x, targetTank.y);
    if (proj.repathTimer <= 0 || !proj.waypoint) {
      const nextCellIndex = findNextPathCell(world.maze, projCell, targetCell);
      const nextCell = world.maze.cells[nextCellIndex];
      proj.waypoint = { x: nextCell.centerX, y: nextCell.centerY };
      proj.repathTimer = 0.08;
    }
    aimX = proj.waypoint.x;
    aimY = proj.waypoint.y;
  } else {
    proj.waypoint = { x: targetTank.x, y: targetTank.y };
  }

  const curAngle = Math.atan2(proj.vy, proj.vx);
  const desiredAngle = Math.atan2(aimY - proj.y, aimX - proj.x);
  let delta = desiredAngle - curAngle;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;

  const maxTurn = world.rules.homingTurnRateDeg * DEG_TO_RAD * dt;
  const clampedDelta = Math.max(-maxTurn, Math.min(maxTurn, delta));
  const nextAngle = curAngle + clampedDelta;
  proj.vx = Math.cos(nextAngle) * proj.speed;
  proj.vy = Math.sin(nextAngle) * proj.speed;
}

/**
 * 引爆破片母弹，在当前位置均匀炸出 fragShardCount（默认 6）枚可反弹可自伤的碎片，
 * 每枚碎片自裂开时刻起存活 fragShardLifetimeSeconds（默认 3s）。
 */
function detonateFragParent(
  parent: ProjectileEntity,
  world: TankWorldState,
  nextId: () => number,
  sounds: SoundEventKind[]
): void {
  const count = world.rules.fragShardCount;
  const shardSpeed = world.rules.normalBulletSpeed * 1.12;
  const shardExpiresAt = world.battleTime + world.rules.fragShardLifetimeSeconds;
  const baseAngle = Math.atan2(parent.vy, parent.vx);

  for (let i = 0; i < count; i += 1) {
    const angle = baseAngle + (i * Math.PI * 2) / count;
    world.projectiles.push({
      id: nextId(),
      ownerSlotId: parent.ownerSlotId,
      colorHex: parent.colorHex,
      source: 'frag_shard',
      x: parent.x,
      y: parent.y,
      vx: Math.cos(angle) * shardSpeed,
      vy: Math.sin(angle) * shardSpeed,
      radius: FRAG_SHARD_RADIUS,
      speed: shardSpeed,
      spawnedAtBattleTime: world.battleTime,
      expiresAtBattleTime: shardExpiresAt,
      // 碎片爆出即允许自伤
      selfDamageUnlocked: true,
      trail: [{ x: parent.x, y: parent.y }],
    });
  }

  sounds.push('explosion');
  world.screenShakeTrauma = Math.min(1, world.screenShakeTrauma + 0.25);
  world.visualCues.push({
    kind: 'frag_split',
    x: parent.x,
    y: parent.y,
    colorHex: parent.colorHex,
  });
}

/**
 * 推进所有弹体、普通弹相消、破片引爆、坦克命中以及地雷触发与爆炸。
 */
export function stepProjectilesAndMines(
  world: TankWorldState,
  dt: number,
  eliminatedSet: Set<string>,
  nextId: () => number,
  sounds: SoundEventKind[]
): void {
  // 1. 追踪弹转向修正
  for (let i = 0; i < world.projectiles.length; i += 1) {
    const p = world.projectiles[i];
    if (p.source === 'homing') {
      steerHomingProjectile(p, world, dt);
    }
  }

  // 2. 普通子弹之间相对运动抵消检测（仅双方均来自普通射击且开关开启时触发）
  const removedProjectileIds = new Set<number>();
  if (world.rules.normalBulletCancelEnabled) {
    interface CancelEvent {
      t: number;
      idA: number;
      idB: number;
      x: number;
      y: number;
      colorHex: string;
    }
    const cancelEvents: CancelEvent[] = [];
    for (let i = 0; i < world.projectiles.length; i += 1) {
      const a = world.projectiles[i];
      if (a.source !== 'normal') continue;
      for (let j = i + 1; j < world.projectiles.length; j += 1) {
        const b = world.projectiles[j];
        if (b.source !== 'normal') continue;
        const t = sweepMovingCircleAgainstMovingCircle(
          a.x,
          a.y,
          a.vx,
          a.vy,
          a.radius,
          b.x,
          b.y,
          b.vx,
          b.vy,
          b.radius,
          dt
        );
        if (t !== null) {
          cancelEvents.push({
            t,
            idA: a.id,
            idB: b.id,
            x: (a.x + a.vx * dt * t + b.x + b.vx * dt * t) * 0.5,
            y: (a.y + a.vy * dt * t + b.y + b.vy * dt * t) * 0.5,
            colorHex: a.colorHex,
          });
        }
      }
    }
    cancelEvents.sort((a, b) => a.t - b.t);
    for (let i = 0; i < cancelEvents.length; i += 1) {
      const ev = cancelEvents[i];
      if (removedProjectileIds.has(ev.idA) || removedProjectileIds.has(ev.idB)) continue;
      removedProjectileIds.add(ev.idA);
      removedProjectileIds.add(ev.idB);
      sounds.push('cancel_bullet');
      world.visualCues.push({
        kind: 'cancel',
        x: ev.x,
        y: ev.y,
        colorHex: ev.colorHex,
      });
    }
  }

  // 3. 连续扫掠推进剩余弹体（含墙面反射、自伤解锁、坦克命中与破片引爆）
  const fragParentsToDetonate: ProjectileEntity[] = [];

  for (let i = 0; i < world.projectiles.length; i += 1) {
    const p = world.projectiles[i];
    if (removedProjectileIds.has(p.id)) continue;

    let remainingDt = dt;
    let bouncedThisStep = false;
    let hitTank = false;

    for (let seg = 0; seg < 6 && remainingDt > 1e-6; seg += 1) {
      const dx = p.vx * remainingDt;
      const dy = p.vy * remainingDt;
      if (dx * dx + dy * dy < 1e-10) break;

      const wallHit = sweepCircleAgainstMaze(p.x, p.y, dx, dy, p.radius, world.maze);
      const wallT = wallHit ? wallHit.t : 1;

      // 在 [0, wallT] 内寻找最早命中的坦克
      let hitTarget: TankEntity | null = null;
      let hitTargetT = wallT;

      for (let tIdx = 0; tIdx < world.tanks.length; tIdx += 1) {
        const tank = world.tanks[tIdx];
        if (!tank.alive) continue;
        if (tank.slotId === p.ownerSlotId && !p.selfDamageUnlocked) continue;
        const t = sweepPointAgainstCircle(
          p.x,
          p.y,
          dx,
          dy,
          tank.x,
          tank.y,
          TANK_RADIUS + p.radius
        );
        if (t !== null && t < hitTargetT) {
          hitTargetT = t;
          hitTarget = tank;
        }
      }

      if (hitTarget) {
        p.x += dx * hitTargetT;
        p.y += dy * hitTargetT;
        applyDamageToTank(hitTarget, world, eliminatedSet, sounds, p.ownerSlotId);
        removedProjectileIds.add(p.id);
        hitTank = true;
        break;
      }

      if (wallHit) {
        p.x = wallHit.x + wallHit.nx * 0.35;
        p.y = wallHit.y + wallHit.ny * 0.35;
        const dot = p.vx * wallHit.nx + p.vy * wallHit.ny;
        if (dot < 0) {
          p.vx -= 2 * dot * wallHit.nx;
          p.vy -= 2 * dot * wallHit.ny;
        }
        // 首次撞墙后立即解锁自伤
        p.selfDamageUnlocked = true;
        bouncedThisStep = true;
        world.visualCues.push({
          kind: 'bounce',
          x: wallHit.x,
          y: wallHit.y,
          colorHex: p.colorHex,
        });
        remainingDt *= Math.max(0, 1 - wallHit.t);
      } else {
        p.x += dx;
        p.y += dy;
        remainingDt = 0;
      }
    }

    if (bouncedThisStep) {
      sounds.push('bounce');
    }

    if (hitTank) continue;

    // 若尚未解锁自伤，检查弹体是否已经完全离开发射者机身碰撞体
    if (!p.selfDamageUnlocked) {
      const owner = world.tanks.find((t) => t.slotId === p.ownerSlotId);
      if (!owner || !owner.alive) {
        p.selfDamageUnlocked = true;
      } else {
        const dist = Math.hypot(p.x - owner.x, p.y - owner.y);
        if (dist > TANK_RADIUS + p.radius + 2) {
          p.selfDamageUnlocked = true;
        }
      }
    }

    // 记录简短轨迹点供渲染区分道具弹
    p.trail.push({ x: p.x, y: p.y });
    if (p.trail.length > 8) {
      p.trail.shift();
    }

    // 破片母弹到达引爆时刻（未提前命中坦克）
    if (
      p.source === 'frag_parent' &&
      p.detonateAtBattleTime !== undefined &&
      world.battleTime + 1e-9 >= p.detonateAtBattleTime
    ) {
      removedProjectileIds.add(p.id);
      fragParentsToDetonate.push(p);
    }
  }

  // 移除已销毁弹体
  if (removedProjectileIds.size > 0) {
    world.projectiles = world.projectiles.filter((p) => !removedProjectileIds.has(p.id));
  }

  // 生成破片碎片
  for (let i = 0; i < fragParentsToDetonate.length; i += 1) {
    detonateFragParent(fragParentsToDetonate[i], world, nextId, sounds);
  }

  // 4. 检测已布防地雷触发与隔墙遮挡爆炸
  stepMines(world, eliminatedSet, nextId, sounds);
}

function stepMines(
  world: TankWorldState,
  eliminatedSet: Set<string>,
  nextId: () => number,
  sounds: SoundEventKind[]
): void {
  const triggerDist = world.rules.mineTriggerRadius + TANK_RADIUS;
  const triggerDistSq = triggerDist * triggerDist;
  const blastDist = world.rules.mineBlastRadius + TANK_RADIUS;
  const blastDistSq = blastDist * blastDist;

  for (let mIdx = world.mines.length - 1; mIdx >= 0; mIdx -= 1) {
    const mine = world.mines[mIdx];
    if (world.battleTime + 1e-9 < mine.armedAtBattleTime) {
      continue;
    }

    let triggered = false;
    for (let tIdx = 0; tIdx < world.tanks.length; tIdx += 1) {
      const tank = world.tanks[tIdx];
      if (!tank.alive) continue;
      const dx = tank.x - mine.x;
      const dy = tank.y - mine.y;
      if (dx * dx + dy * dy <= triggerDistSq) {
        // 隔墙不会误触发地雷
        if (hasLineOfSight(world.maze, mine.x, mine.y, tank.x, tank.y)) {
          triggered = true;
          break;
        }
      }
    }

    if (!triggered) continue;

    // 引爆地雷：仅作用范围内且无墙体遮挡的坦克受伤（包含放置者自身）
    for (let tIdx = 0; tIdx < world.tanks.length; tIdx += 1) {
      const tank = world.tanks[tIdx];
      if (!tank.alive) continue;
      const dx = tank.x - mine.x;
      const dy = tank.y - mine.y;
      if (dx * dx + dy * dy <= blastDistSq) {
        if (hasLineOfSight(world.maze, mine.x, mine.y, tank.x, tank.y)) {
          applyDamageToTank(tank, world, eliminatedSet, sounds, mine.ownerSlotId);
        }
      }
    }

    world.explosions.push({
      id: nextId(),
      x: mine.x,
      y: mine.y,
      radius: world.rules.mineBlastRadius,
      colorHex: mine.colorHex,
      remainingVisualSeconds: 0.36,
      maxVisualSeconds: 0.36,
    });
    world.mines.splice(mIdx, 1);
    sounds.push('explosion');
    world.hitstopTimer = Math.max(world.hitstopTimer, 0.045);
    world.screenShakeTrauma = Math.min(1, world.screenShakeTrauma + 0.5);
    world.visualCues.push({
      kind: 'explosion',
      x: mine.x,
      y: mine.y,
      colorHex: mine.colorHex,
      radius: world.rules.mineBlastRadius,
    });
  }
}

export function decayVisualEffects(world: TankWorldState, dt: number): void {
  for (let i = world.laserBeams.length - 1; i >= 0; i -= 1) {
    world.laserBeams[i].remainingVisualSeconds -= dt;
    if (world.laserBeams[i].remainingVisualSeconds <= 0) {
      world.laserBeams.splice(i, 1);
    }
  }
  for (let i = world.explosions.length - 1; i >= 0; i -= 1) {
    world.explosions[i].remainingVisualSeconds -= dt;
    if (world.explosions[i].remainingVisualSeconds <= 0) {
      world.explosions.splice(i, 1);
    }
  }
}

/** 仅供静态几何辅助：确保点位于迷宫合法范围内 */
export function clampToMaze(maze: MazeData, x: number, y: number, margin: number): Vec2 {
  return {
    x: Math.max(margin, Math.min(maze.width - margin, x)),
    y: Math.max(margin, Math.min(maze.height - margin, y)),
  };
}
