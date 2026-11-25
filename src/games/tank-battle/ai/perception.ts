import type { BotActionIntent } from '../../../platform/games/contracts';
import {
  CELL_SIZE,
  TANK_BARREL_LENGTH,
  TANK_RADIUS,
  WALL_THICKNESS,
  type ControlMode,
  type MazeData,
  type ProjectileEntity,
  type TankEntity,
  type Vec2,
  type WallSegment,
} from '../types';

export function normalizeAngle(delta: number): number {
  let d = delta;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** 将世界坐标安全映射到所属迷宫格索引 */
export function findMazeCellIndex(maze: MazeData, x: number, y: number): number {
  const col = Math.max(0, Math.min(maze.cols - 1, Math.floor(x / CELL_SIZE)));
  const row = Math.max(0, Math.min(maze.rows - 1, Math.floor(y / CELL_SIZE)));
  return row * maze.cols + col;
}

/**
 * 基于迷宫通行邻接表的极速 BFS 最短路求解（10×7 仅 70 格，单次耗时 < 0.03ms）。
 * 返回从 startCell 到 goalCell 的格索引序列（含起点与终点）。
 */
export function computeMazePath(
  maze: MazeData,
  startCell: number,
  goalCell: number
): number[] {
  const count = maze.cells.length;
  if (startCell < 0 || goalCell < 0 || startCell >= count || goalCell >= count) {
    return [];
  }
  if (startCell === goalCell) return [startCell];

  const parent = new Int16Array(count).fill(-1);
  const visited = new Uint8Array(count);
  const queue = new Int16Array(count);
  let head = 0;
  let tail = 0;

  visited[startCell] = 1;
  queue[tail++] = startCell;

  while (head < tail) {
    const cur = queue[head++];
    if (cur === goalCell) break;
    const neighbors = maze.cells[cur].neighbors;
    for (let i = 0; i < neighbors.length; i += 1) {
      const nb = neighbors[i];
      if (!visited[nb]) {
        visited[nb] = 1;
        parent[nb] = cur;
        queue[tail++] = nb;
      }
    }
  }

  if (!visited[goalCell]) return [startCell];

  const path: number[] = [];
  let node = goalCell;
  while (node !== -1) {
    path.push(node);
    node = parent[node];
  }
  path.reverse();
  return path;
}

/** 判断射线与单条扩展厚度的墙体线段是否相交，返回命中距离 t（像素） */
function intersectRayWall(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
  wall: WallSegment,
  pad: number
): { dist: number; normalX: number; normalY: number } | null {
  if (wall.orientation === 'h') {
    if (Math.abs(dy) < 1e-6) return null;
    const wallY = wall.y1;
    const hitY = dy > 0 ? wallY - pad : wallY + pad;
    const t = (hitY - oy) / dy;
    if (t <= 0.5 || t > maxDist) return null;
    const hx = ox + dx * t;
    if (hx >= wall.x1 - pad && hx <= wall.x2 + pad) {
      return { dist: t, normalX: 0, normalY: dy > 0 ? -1 : 1 };
    }
    return null;
  }

  if (Math.abs(dx) < 1e-6) return null;
  const wallX = wall.x1;
  const hitX = dx > 0 ? wallX - pad : wallX + pad;
  const t = (hitX - ox) / dx;
  if (t <= 0.5 || t > maxDist) return null;
  const hy = oy + dy * t;
  if (hy >= wall.y1 - pad && hy <= wall.y2 + pad) {
    return { dist: t, normalX: dx > 0 ? -1 : 1, normalY: 0 };
  }
  return null;
}

/** 求射线沿 (dx, dy) 碰到的最近迷宫墙体 */
export function castMazeWallRay(
  maze: MazeData,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
  pad = WALL_THICKNESS * 0.5 + 4
): { dist: number; hitX: number; hitY: number; normalX: number; normalY: number } | null {
  let bestDist = maxDist;
  let bestNormalX = 0;
  let bestNormalY = 0;
  let hit = false;

  for (let i = 0; i < maze.walls.length; i += 1) {
    const res = intersectRayWall(ox, oy, dx, dy, bestDist, maze.walls[i], pad);
    if (res && res.dist < bestDist) {
      bestDist = res.dist;
      bestNormalX = res.normalX;
      bestNormalY = res.normalY;
      hit = true;
    }
  }

  if (!hit) return null;
  return {
    dist: bestDist,
    hitX: ox + dx * bestDist,
    hitY: oy + dy * bestDist,
    normalX: bestNormalX,
    normalY: bestNormalY,
  };
}

/** 检测两点之间是否无迷宫墙体遮挡 */
export function hasLineOfSight(
  maze: MazeData,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  pad = WALL_THICKNESS * 0.5 + 3
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return true;
  const hit = castMazeWallRay(maze, x1, y1, dx / dist, dy / dist, dist - 2, pad);
  return hit === null;
}

/** 计算射线到目标圆心的首次命中距离（若未命中返回 null） */
function intersectRayCircle(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
  cx: number,
  cy: number,
  radius: number
): number | null {
  const fx = ox - cx;
  const fy = oy - cy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;
  const disc = b * b - 4 * c;
  if (disc < 0) return null;
  const sqrtD = Math.sqrt(disc);
  const t1 = (-b - sqrtD) * 0.5;
  if (t1 >= 0 && t1 <= maxDist) return t1;
  const t2 = (-b + sqrtD) * 0.5;
  if (t2 >= 0 && t2 <= maxDist) return t2;
  return null;
}

export interface BounceShotResult {
  hitsEnemy: boolean;
  bouncesUsed: number;
  totalDist: number;
  selfRisk: boolean;
}

/**
 * 模拟一次包含 0..maxBounces 次墙面反弹的弹道/激光射线：
 * - 检测能否命中目标坦克
 * - 同步检测是否会近距离反弹回自身（防止贴墙开火自毁）
 */
export function simulateBounceShot(
  maze: MazeData,
  self: TankEntity,
  enemy: TankEntity,
  angle: number,
  maxBounces: number,
  maxTotalDist = 920
): BounceShotResult {
  let dx = Math.cos(angle);
  let dy = Math.sin(angle);
  let ox = self.x + dx * (TANK_BARREL_LENGTH + 4);
  let oy = self.y + dy * (TANK_BARREL_LENGTH + 4);

  // 检查枪口出发前是否已经直接撞墙（贴墙自毁高危）
  const muzzleClear = castMazeWallRay(
    maze,
    self.x,
    self.y,
    dx,
    dy,
    TANK_BARREL_LENGTH + 8,
    WALL_THICKNESS * 0.5 + 4
  );
  if (muzzleClear) {
    return { hitsEnemy: false, bouncesUsed: 0, totalDist: muzzleClear.dist, selfRisk: true };
  }

  let remaining = maxTotalDist;
  let traveled = 0;

  for (let bounce = 0; bounce <= maxBounces; bounce += 1) {
    const wallHit = castMazeWallRay(maze, ox, oy, dx, dy, remaining);
    const segLen = wallHit ? wallHit.dist : remaining;

    // 首次反弹后检测是否飞回击中自己
    if (bounce >= 1) {
      const selfHit = intersectRayCircle(
        ox,
        oy,
        dx,
        dy,
        segLen,
        self.x,
        self.y,
        TANK_RADIUS + 8
      );
      if (selfHit !== null && traveled + selfHit < 360) {
        return {
          hitsEnemy: false,
          bouncesUsed: bounce,
          totalDist: traveled + selfHit,
          selfRisk: true,
        };
      }
    }

    // 检测是否命中敌方坦克
    const enemyHit = intersectRayCircle(
      ox,
      oy,
      dx,
      dy,
      segLen,
      enemy.x,
      enemy.y,
      TANK_RADIUS + 4
    );
    if (enemyHit !== null) {
      return {
        hitsEnemy: true,
        bouncesUsed: bounce,
        totalDist: traveled + enemyHit,
        selfRisk: false,
      };
    }

    if (!wallHit) break;
    traveled += wallHit.dist;
    remaining -= wallHit.dist;
    if (remaining <= 20) break;

    // 沿墙体法线反射
    if (wallHit.normalX !== 0) {
      dx = -dx;
    } else {
      dy = -dy;
    }
    ox = wallHit.hitX + wallHit.normalX * 1.5;
    oy = wallHit.hitY + wallHit.normalY * 1.5;
  }

  return { hitsEnemy: false, bouncesUsed: maxBounces, totalDist: traveled, selfRisk: false };
}

/**
 * 噩梦/精英级多角度反弹射线求解器：
 * 优先直视射击；若存在墙体遮挡则按多角度扫描寻找最优的 1 次或 2 次墙面反弹击杀角。
 */
export function findBestRicochetShot(
  maze: MazeData,
  self: TankEntity,
  enemy: TankEntity,
  maxBounces: number,
  sweepSteps = 36
): { angle: number; bouncesUsed: number; totalDist: number } | null {
  const directAngle = Math.atan2(enemy.y - self.y, enemy.x - self.x);
  const directCheck = simulateBounceShot(maze, self, enemy, directAngle, 0, 860);
  if (directCheck.hitsEnemy && !directCheck.selfRisk) {
    return {
      angle: directAngle,
      bouncesUsed: 0,
      totalDist: directCheck.totalDist,
    };
  }

  if (maxBounces <= 0) return null;

  let best: { angle: number; bouncesUsed: number; totalDist: number; score: number } | null = null;
  const stepRad = (Math.PI * 2) / sweepSteps;

  for (let i = 0; i < sweepSteps; i += 1) {
    const candidate = normalizeAngle(directAngle + i * stepRad);
    const res = simulateBounceShot(maze, self, enemy, candidate, maxBounces, 860);
    if (!res.hitsEnemy || res.selfRisk) continue;

    // 优先反弹次数少、弹道更短、且离当前炮口朝向更近的角度
    const turnCost = Math.abs(normalizeAngle(candidate - self.angle)) * 90;
    const score = res.bouncesUsed * 240 + res.totalDist + turnCost;
    if (!best || score < best.score) {
      best = {
        angle: candidate,
        bouncesUsed: res.bouncesUsed,
        totalDist: res.totalDist,
        score,
      };
    }
  }

  return best
    ? { angle: best.angle, bouncesUsed: best.bouncesUsed, totalDist: best.totalDist }
    : null;
}

export interface BulletThreatInfo {
  urgent: boolean;
  evadeX: number;
  evadeY: number;
  minTtc: number;
}

/**
 * 评估场上所有飞行弹体对自身的实时威胁：
 * 计算每颗弹体未来 horizonSeconds 秒内的最近会遇距离，输出最优垂直闪避逃逸向量。
 */
export function assessBulletThreat(
  self: TankEntity,
  projectiles: ProjectileEntity[],
  maze: MazeData,
  horizonSeconds = 0.85,
  dangerRadius = TANK_RADIUS + 24
): BulletThreatInfo {
  let sumEvadeX = 0;
  let sumEvadeY = 0;
  let minTtc = Infinity;
  let threatCount = 0;

  for (let i = 0; i < projectiles.length; i += 1) {
    const p = projectiles[i];
    // 刚出膛且尚未解锁自伤的己方子弹无危险
    if (p.ownerSlotId === self.slotId && !p.selfDamageUnlocked) continue;

    const speedSq = p.vx * p.vx + p.vy * p.vy;
    if (speedSq < 1) continue;

    const rx = self.x - p.x;
    const ry = self.y - p.y;
    const tClosest = (rx * p.vx + ry * p.vy) / speedSq;
    if (tClosest < 0 || tClosest > horizonSeconds) continue;

    const closestX = p.x + p.vx * tClosest;
    const closestY = p.y + p.vy * tClosest;
    const distToLine = Math.hypot(self.x - closestX, self.y - closestY);
    if (distToLine > dangerRadius + p.radius) continue;

    // 若子弹与自身之间隔着实体墙，则不触发无谓闪避
    if (!hasLineOfSight(maze, p.x, p.y, self.x, self.y, WALL_THICKNESS * 0.5 + 2)) {
      continue;
    }

    const speed = Math.sqrt(speedSq);
    const dirX = p.vx / speed;
    const dirY = p.vy / speed;
    // 取垂直于弹道、且指向远离子弹一侧的逃逸方向
    let perpX = -dirY;
    let perpY = dirX;
    const sideDot = (self.x - closestX) * perpX + (self.y - closestY) * perpY;
    if (sideDot < 0) {
      perpX = -perpX;
      perpY = -perpY;
    }

    // 检查所选逃逸侧是否贴墙，若是则尝试反侧闪避
    const sideWall = castMazeWallRay(maze, self.x, self.y, perpX, perpY, TANK_RADIUS + 26);
    if (sideWall) {
      const oppWall = castMazeWallRay(maze, self.x, self.y, -perpX, -perpY, TANK_RADIUS + 26);
      if (!oppWall || oppWall.dist > sideWall.dist) {
        perpX = -perpX;
        perpY = -perpY;
      }
    }

    const weight = 1 / Math.max(0.12, tClosest);
    sumEvadeX += perpX * weight;
    sumEvadeY += perpY * weight;
    if (tClosest < minTtc) minTtc = tClosest;
    threatCount += 1;
  }

  if (threatCount === 0) {
    return { urgent: false, evadeX: 0, evadeY: 0, minTtc: Infinity };
  }

  const mag = Math.hypot(sumEvadeX, sumEvadeY) || 1;
  return {
    urgent: true,
    evadeX: sumEvadeX / mag,
    evadeY: sumEvadeY / mag,
    minTtc,
  };
}

/** 从迷宫最短路径中挑选下一个平滑目标航点（若可见下下格中心则提前切弯） */
export function pickPathWaypoint(
  maze: MazeData,
  self: TankEntity,
  path: number[],
  fallbackTarget: Vec2
): Vec2 {
  if (path.length <= 1) return fallbackTarget;
  // 若与下下格中心无墙体遮挡且距离适中，优先切向更前方的航点，避免走成折线锯齿
  if (path.length >= 3) {
    const c2 = maze.cells[path[2]];
    if (hasLineOfSight(maze, self.x, self.y, c2.centerX, c2.centerY, TANK_RADIUS * 0.85)) {
      return { x: c2.centerX, y: c2.centerY };
    }
  }
  const c1 = maze.cells[path[1]];
  return { x: c1.centerX, y: c1.centerY };
}

/**
 * 统一将高层战术意图（期望移动向量、期望瞄准角度、是否开火）翻译为标准 5 键动作状态，
 * 自动适配「直觉转向（屏幕 8 向）」与「经典坦克（进退+旋转）」两种操控模式。
 */
export function convertIntentToActions(
  self: TankEntity,
  moveDir: Vec2 | null,
  aimAngle: number | null,
  shouldFire: boolean,
  controlMode: ControlMode
): BotActionIntent {
  const actions: BotActionIntent = {
    forward: false,
    backward: false,
    turnLeft: false,
    turnRight: false,
    fire: shouldFire,
  };

  if (controlMode === 'classic') {
    const targetAngle =
      aimAngle !== null
        ? aimAngle
        : moveDir
        ? Math.atan2(moveDir.y, moveDir.x)
        : null;

    if (targetAngle !== null) {
      const diff = normalizeAngle(targetAngle - self.angle);
      if (diff > 0.06) actions.turnRight = true;
      else if (diff < -0.06) actions.turnLeft = true;
    }

    if (moveDir) {
      const moveAngle = Math.atan2(moveDir.y, moveDir.x);
      const moveDiff = normalizeAngle(moveAngle - self.angle);
      const absMoveDiff = Math.abs(moveDiff);
      if (absMoveDiff < 0.72) {
        actions.forward = true;
      } else if (absMoveDiff > Math.PI - 0.62 && aimAngle !== null) {
        // 瞄准的同时允许倒车拉扯
        actions.backward = true;
      } else if (aimAngle === null) {
        // 纯赶路时优先原地转正，接近目标角后再加速前进
        if (moveDiff > 0.06) actions.turnRight = true;
        else if (moveDiff < -0.06) actions.turnLeft = true;
        if (absMoveDiff < 1.05) actions.forward = true;
      }
    }
    return actions;
  }

  // ===== 直觉转向模式（屏幕 8 向：forward=-Y, backward=+Y, turnLeft=-X, turnRight=+X） =====
  // 瞄准优先：若需微调瞄准角且与当前朝向有偏差，通过对应 8 向输入将炮口快速转至目标角
  let desiredVec: Vec2 | null = moveDir;
  if (aimAngle !== null) {
    const aimDiff = Math.abs(normalizeAngle(aimAngle - self.angle));
    if (aimDiff > 0.09 || !desiredVec) {
      desiredVec = { x: Math.cos(aimAngle), y: Math.sin(aimAngle) };
    }
  }

  if (desiredVec) {
    const len = Math.hypot(desiredVec.x, desiredVec.y);
    if (len > 0.05) {
      const nx = desiredVec.x / len;
      const ny = desiredVec.y / len;
      // 8 向角度量化阈值 sin(22.5°) ≈ 0.3827
      if (nx > 0.38) actions.turnRight = true;
      else if (nx < -0.38) actions.turnLeft = true;
      if (ny > 0.38) actions.backward = true;
      else if (ny < -0.38) actions.forward = true;
    }
  }

  return actions;
}
