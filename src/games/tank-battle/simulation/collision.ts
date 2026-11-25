import {
  type MazeData,
  TANK_RADIUS,
  type TankEntity,
  type Vec2,
  WALL_HALF,
  type WallSegment,
} from '../types';

export interface SweptHit {
  t: number; // 0..1 步内归一化接触时刻
  x: number;
  y: number;
  nx: number;
  ny: number;
}

/** 点到线段最近点及平方距离 */
export function closestPointOnSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): { x: number; y: number; distSq: number } {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const lenSq = vx * vx + vy * vy;
  if (lenSq < 1e-9) {
    const dx = px - x1;
    const dy = py - y1;
    return { x: x1, y: y1, distSq: dx * dx + dy * dy };
  }
  let t = ((px - x1) * vx + (py - y1) * vy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = x1 + t * vx;
  const cy = y1 + t * vy;
  const dx = px - cx;
  const dy = py - cy;
  return { x: cx, y: cy, distSq: dx * dx + dy * dy };
}

/** 推离坦克与所有墙体的重叠（迭代求解以平滑处理拐角） */
export function resolveCircleMazeCollision(
  x: number,
  y: number,
  radius: number,
  maze: MazeData
): Vec2 {
  let rx = x;
  let ry = y;
  const minDist = radius + WALL_HALF;
  const minDistSq = minDist * minDist;

  for (let iter = 0; iter < 4; iter += 1) {
    let pushed = false;
    for (let i = 0; i < maze.walls.length; i += 1) {
      const w = maze.walls[i];
      // 快速包围盒过滤
      const minX = Math.min(w.x1, w.x2) - minDist;
      const maxX = Math.max(w.x1, w.x2) + minDist;
      const minY = Math.min(w.y1, w.y2) - minDist;
      const maxY = Math.max(w.y1, w.y2) + minDist;
      if (rx < minX || rx > maxX || ry < minY || ry > maxY) continue;

      const cp = closestPointOnSegment(rx, ry, w.x1, w.y1, w.x2, w.y2);
      if (cp.distSq < minDistSq) {
        const dist = Math.sqrt(cp.distSq);
        let nx = 0;
        let ny = 0;
        if (dist > 1e-6) {
          nx = (rx - cp.x) / dist;
          ny = (ry - cp.y) / dist;
        } else {
          // 圆心正好落在墙中心线上的退化情形
          if (w.orientation === 'h') {
            ny = ry >= w.y1 ? 1 : -1;
          } else {
            nx = rx >= w.x1 ? 1 : -1;
          }
        }
        const overlap = minDist - dist;
        rx += nx * overlap;
        ry += ny * overlap;
        pushed = true;
      }
    }
    // 边界钳位保护
    rx = Math.max(minDist, Math.min(maze.width - minDist, rx));
    ry = Math.max(minDist, Math.min(maze.height - minDist, ry));
    if (!pushed) break;
  }

  return { x: rx, y: ry };
}

/** 坦克之间互相阻挡（无撞击伤害，推开后再次约束在墙内） */
export function resolveTankToTankBlocking(tanks: TankEntity[], maze: MazeData): void {
  const minDist = TANK_RADIUS * 2;
  const minDistSq = minDist * minDist;

  for (let iter = 0; iter < 3; iter += 1) {
    let anyOverlap = false;
    for (let i = 0; i < tanks.length; i += 1) {
      const a = tanks[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < tanks.length; j += 1) {
        const b = tanks[j];
        if (!b.alive) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < minDistSq) {
          const dist = Math.sqrt(distSq);
          const nx = dist > 1e-6 ? dx / dist : 1;
          const ny = dist > 1e-6 ? dy / dist : 0;
          const halfPush = (minDist - dist) * 0.5 + 0.01;
          a.x -= nx * halfPush;
          a.y -= ny * halfPush;
          b.x += nx * halfPush;
          b.y += ny * halfPush;

          const fixedA = resolveCircleMazeCollision(a.x, a.y, TANK_RADIUS, maze);
          a.x = fixedA.x;
          a.y = fixedA.y;
          const fixedB = resolveCircleMazeCollision(b.x, b.y, TANK_RADIUS, maze);
          b.x = fixedB.x;
          b.y = fixedB.y;
          anyOverlap = true;
        }
      }
    }
    if (!anyOverlap) break;
  }
}

/**
 * 射线（线段 p0 -> p1）与圆心 (cx, cy)、半径 r 的最早相交 t ∈ [0, 1]。
 * ignoreIfMovingAway 为 true 时（用于墙端圆角），若起点已在圆内且正在远离圆心则跳过，避免反射粘连；
 * 为 false 时（用于坦克命中判定），起点已在圆内立即视为 t = 0 命中。
 */
export function sweepPointAgainstCircle(
  x0: number,
  y0: number,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  r: number,
  ignoreIfMovingAway = false
): number | null {
  const fx = x0 - cx;
  const fy = y0 - cy;
  const a = dx * dx + dy * dy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) {
    if (!ignoreIfMovingAway) return 0;
    const dot = fx * dx + fy * dy;
    return dot < 0 ? 0 : null;
  }
  if (a < 1e-12) return null;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sqrtD = Math.sqrt(disc);
  const t = (-b - sqrtD) / (2 * a);
  if (t >= 0 && t <= 1) return t;
  return null;
}

/**
 * 运动圆（半径 radius）从 (x0, y0) 沿 (dx, dy) 扫掠，求与单条墙段胶囊体（半厚 WALL_HALF）的最早接触。
 */
function sweepCircleAgainstWall(
  x0: number,
  y0: number,
  dx: number,
  dy: number,
  radius: number,
  wall: WallSegment
): SweptHit | null {
  const r = radius + WALL_HALF;
  let bestT = Infinity;
  let bestNx = 0;
  let bestNy = 0;

  if (wall.orientation === 'h') {
    const wy = wall.y1;
    const minX = Math.min(wall.x1, wall.x2);
    const maxX = Math.max(wall.x1, wall.x2);

    // 1. 检测上下平行边 y = wy ± r
    if (Math.abs(dy) > 1e-9) {
      const targetY = dy > 0 ? wy - r : wy + r;
      const ny = dy > 0 ? -1 : 1;
      const t = (targetY - y0) / dy;
      if (t >= 0 && t <= 1) {
        const hx = x0 + dx * t;
        if (hx >= minX && hx <= maxX && t < bestT) {
          bestT = t;
          bestNx = 0;
          bestNy = ny;
        }
      }
    }
  } else {
    const wx = wall.x1;
    const minY = Math.min(wall.y1, wall.y2);
    const maxY = Math.max(wall.y1, wall.y2);

    // 1. 检测左右平行边 x = wx ± r
    if (Math.abs(dx) > 1e-9) {
      const targetX = dx > 0 ? wx - r : wx + r;
      const nx = dx > 0 ? -1 : 1;
      const t = (targetX - x0) / dx;
      if (t >= 0 && t <= 1) {
        const hy = y0 + dy * t;
        if (hy >= minY && hy <= maxY && t < bestT) {
          bestT = t;
          bestNx = nx;
          bestNy = 0;
        }
      }
    }
  }

  // 2. 检测两端半圆端盖，平滑处理拐角碰撞
  const endpoints: Array<[number, number]> = [
    [wall.x1, wall.y1],
    [wall.x2, wall.y2],
  ];
  for (let i = 0; i < 2; i += 1) {
    const [ex, ey] = endpoints[i];
    const t = sweepPointAgainstCircle(x0, y0, dx, dy, ex, ey, r, true);
    if (t !== null && t < bestT) {
      const hx = x0 + dx * t;
      const hy = y0 + dy * t;
      const nx = hx - ex;
      const ny = hy - ey;
      const len = Math.hypot(nx, ny);
      if (len > 1e-6) {
        // 仅当法线迎向运动方向时有效
        const unx = nx / len;
        const uny = ny / len;
        if (dx * unx + dy * uny < 0) {
          bestT = t;
          bestNx = unx;
          bestNy = uny;
        }
      }
    }
  }

  if (!Number.isFinite(bestT)) return null;
  return {
    t: bestT,
    x: x0 + dx * bestT,
    y: y0 + dy * bestT,
    nx: bestNx,
    ny: bestNy,
  };
}

/**
 * 扫掠圆与整张迷宫墙体的最早碰撞。
 * 关键边界：命中墙角时，多个墙段在同一时刻命中，将法线合并为一次碰撞，
 * 避免反射次数被重复扣减（例如激光精确打中墙角时只计 1 次反射）。
 */
export function sweepCircleAgainstMaze(
  x0: number,
  y0: number,
  dx: number,
  dy: number,
  radius: number,
  maze: MazeData
): SweptHit | null {
  const EPS_T = 1e-4;
  let earliestT = Infinity;
  let sumNx = 0;
  let sumNy = 0;
  let hitCount = 0;

  for (let i = 0; i < maze.walls.length; i += 1) {
    const hit = sweepCircleAgainstWall(x0, y0, dx, dy, radius, maze.walls[i]);
    if (!hit) continue;
    if (hit.t < earliestT - EPS_T) {
      earliestT = hit.t;
      sumNx = hit.nx;
      sumNy = hit.ny;
      hitCount = 1;
    } else if (Math.abs(hit.t - earliestT) <= EPS_T) {
      sumNx += hit.nx;
      sumNy += hit.ny;
      hitCount += 1;
    }
  }

  if (hitCount === 0 || !Number.isFinite(earliestT)) return null;
  let len = Math.hypot(sumNx, sumNy);
  let nx = sumNx;
  let ny = sumNy;
  if (len < 1e-6) {
    // 极端退化法线抵消时直接反向
    const dLen = Math.hypot(dx, dy) || 1;
    nx = -dx / dLen;
    ny = -dy / dLen;
  } else {
    nx /= len;
    ny /= len;
  }

  return {
    t: earliestT,
    x: x0 + dx * earliestT,
    y: y0 + dy * earliestT,
    nx,
    ny,
  };
}

/**
 * 判断两点之间是否存在无墙遮挡的视线（用于出生点检验、地雷隔墙遮挡）。
 */
export function hasLineOfSight(
  maze: MazeData,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx * dx + dy * dy < 1e-6) return true;
  const hit = sweepCircleAgainstMaze(x1, y1, dx, dy, 0.5, maze);
  return hit === null;
}

/**
 * 两个运动圆在当前步内的相对运动碰撞检测（防两颗迎面高速普通弹在两帧间互相穿过）。
 */
export function sweepMovingCircleAgainstMovingCircle(
  ax: number,
  ay: number,
  avx: number,
  avy: number,
  ar: number,
  bx: number,
  by: number,
  bvx: number,
  bvy: number,
  br: number,
  dt: number
): number | null {
  const rSum = ar + br;
  const rx = ax - bx;
  const ry = ay - by;
  const rvx = (avx - bvx) * dt;
  const rvy = (avy - bvy) * dt;
  const c = rx * rx + ry * ry - rSum * rSum;
  if (c <= 0) return 0;
  const a = rvx * rvx + rvy * rvy;
  if (a < 1e-12) return null;
  const b = 2 * (rx * rvx + ry * rvy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t >= 0 && t <= 1) return t;
  return null;
}
