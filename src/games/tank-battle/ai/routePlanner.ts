import { worldToCellIndex } from '../map/generateMaze';
import { hasLineOfSight } from '../simulation/collision';
import {
  CELL_SIZE,
  TANK_RADIUS,
  type ItemKind,
  type MazeData,
  type TankEntity,
  type TankWorldState,
  type Vec2,
} from '../types';
import {
  evaluateCellThreatAtTime,
  type OpponentEstimate,
  type SharedStepContext,
} from './threatMap';

const BASE_ITEM_VALUE: Record<ItemKind, number> = {
  laser: 100,
  shield: 95,
  shotgun: 88,
  frag: 84,
  homing: 80,
  rapid_fire: 74,
  mine: 56,
};

export type RouteGoalKind = 'attack' | 'flank' | 'drop' | 'cover' | 'kite';

export interface RoutePlanResult {
  goalKind: RouteGoalKind;
  targetSlotId: string | null;
  goalCell: number;
  goalPoint: Vec2;
  cellPath: number[];
  waypoint: Vec2;
  totalRiskCost: number;
}

/** 可复用的 Dijkstra 缓冲池，避免 60Hz 多席运行产生临时数组 GC */
class DijkstraScratchPool {
  private capacity = 0;
  dist = new Float64Array(0);
  parent = new Int16Array(0);
  visited = new Uint8Array(0);
  steps = new Int16Array(0);

  ensure(size: number): void {
    if (size <= this.capacity) return;
    this.capacity = size;
    this.dist = new Float64Array(size);
    this.parent = new Int16Array(size);
    this.visited = new Uint8Array(size);
    this.steps = new Int16Array(size);
  }
}

const scratchPool = new DijkstraScratchPool();

/**
 * 基于风险加权的迷宫 Dijkstra 最优路径表（单源到全图所有格的最小风险代价）。
 */
function runWeightedDijkstra(
  maze: MazeData,
  shared: SharedStepContext,
  self: TankEntity,
  startCell: number,
  maxBounceThreat: number,
  opponents: ReadonlyArray<OpponentEstimate>,
  riskWeight: number
): { dist: Float64Array; parent: Int16Array; steps: Int16Array } {
  const n = maze.cells.length;
  scratchPool.ensure(n);
  const { dist, parent, visited, steps } = scratchPool;

  dist.fill(Infinity, 0, n);
  parent.fill(-1, 0, n);
  visited.fill(0, 0, n);
  steps.fill(-1, 0, n);

  dist[startCell] = 0;
  steps[startCell] = 0;
  const speed = Math.max(80, self.alive ? 165 : 165);
  const degrees = shared.mazeCache.cellDegrees;

  // 迷宫网格最大 16×12=192 格，线性选最小节点无堆分配且极快
  for (let iter = 0; iter < n; iter += 1) {
    let u = -1;
    let bestD = Infinity;
    for (let i = 0; i < n; i += 1) {
      if (!visited[i] && dist[i] < bestD) {
        bestD = dist[i];
        u = i;
      }
    }
    if (u === -1 || !Number.isFinite(bestD)) break;
    visited[u] = 1;

    const uCell = maze.cells[u];
    const nextStep = steps[u] + 1;
    const tArrival = (nextStep * CELL_SIZE) / speed;

    for (let j = 0; j < uCell.neighbors.length; j += 1) {
      const v = uCell.neighbors[j];
      if (visited[v]) continue;

      const vCell = maze.cells[v];
      let edgeCost = CELL_SIZE;

      if (riskWeight > 0) {
        const threat = evaluateCellThreatAtTime(
          maze,
          shared,
          self,
          { x: vCell.centerX, y: vCell.centerY },
          tArrival,
          maxBounceThreat,
          opponents
        );
        edgeCost += threat * riskWeight;

        // 死胡同在存在活对手时增加风险惩罚，避免无意义钻进死角
        if (degrees[v] <= 1 && opponents.length > 1) {
          edgeCost += 48 * riskWeight;
        }
      }

      const alt = bestD + edgeCost;
      if (alt < dist[v]) {
        dist[v] = alt;
        parent[v] = u;
        steps[v] = nextStep;
      }
    }
  }

  return { dist, parent, steps };
}

function reconstructPath(parent: Int16Array, startCell: number, goalCell: number): number[] {
  const path: number[] = [];
  let cur = goalCell;
  let guard = 0;
  while (cur !== -1 && guard < 512) {
    guard += 1;
    path.push(cur);
    if (cur === startCell) break;
    cur = parent[cur];
  }
  path.reverse();
  if (path.length === 0 || path[0] !== startCell) {
    return [startCell];
  }
  return path;
}

/** 从路径中提取平滑航点（如果可直视下下格中心且通道足够宽裕则提前切弯） */
export function pickSmoothWaypoint(
  maze: MazeData,
  self: TankEntity,
  path: ReadonlyArray<number>,
  fallback: Vec2
): Vec2 {
  if (path.length <= 1) return fallback;
  if (path.length >= 3) {
    const c2 = maze.cells[path[2]];
    if (
      c2 &&
      hasLineOfSight(maze, self.x, self.y, c2.centerX, c2.centerY) &&
      // 确保切弯圆心不会贴近转角
      Math.hypot(c2.centerX - self.x, c2.centerY - self.y) > CELL_SIZE * 0.7
    ) {
      return { x: c2.centerX, y: c2.centerY };
    }
  }
  const c1 = maze.cells[path[1]];
  return c1 ? { x: c1.centerX, y: c1.centerY } : fallback;
}

/**
 * 评估目标优先级、道具争夺与安全掩体，输出本步风险加权最佳路线。
 */
export function planTacticalRoute(
  world: TankWorldState,
  shared: SharedStepContext,
  self: TankEntity,
  opponents: ReadonlyArray<OpponentEstimate>,
  options: {
    riskWeight: number;
    maxBounceThreat: number;
    itemSearchMaxSteps: number;
    coverReloadEnabled: boolean;
    multiTargetScoring: boolean;
  }
): RoutePlanResult {
  const maze = world.maze;
  const selfCell = worldToCellIndex(maze, self.x, self.y);
  const speed = Math.max(80, world.rules.tankForwardSpeed);
  // 持有护盾时适度降低路径畏惧权重，果断压近换位与抢点
  const effectiveRiskWeight = self.shield ? options.riskWeight * 0.45 : options.riskWeight;
  const { dist, parent, steps } = runWeightedDijkstra(
    maze,
    shared,
    self,
    selfCell,
    options.maxBounceThreat,
    opponents,
    effectiveRiskWeight
  );

  // 1. 从全场存活对手中选择最优主攻对象
  const enemies = opponents.filter((o) => o.alive && o.slotId !== self.slotId);
  if (enemies.length === 0) {
    return {
      goalKind: 'cover',
      targetSlotId: null,
      goalCell: selfCell,
      goalPoint: { x: self.x, y: self.y },
      cellPath: [selfCell],
      waypoint: { x: self.x, y: self.y },
      totalRiskCost: 0,
    };
  }

  let primaryEnemy = enemies[0];
  let bestEnemyScore = -Infinity;
  const distMatrix = shared.mazeCache.distMatrix;
  const cellCount = shared.mazeCache.cellCount;

  for (let i = 0; i < enemies.length; i += 1) {
    const op = enemies[i];
    const opCell = worldToCellIndex(maze, op.x, op.y);
    const cellDist = distMatrix[selfCell * cellCount + opCell];
    const euclid = Math.hypot(op.x - self.x, op.y - self.y);
    const hasLos = hasLineOfSight(maze, self.x, self.y, op.x, op.y);

    let score = -euclid * 0.45 - Math.max(0, cellDist) * 35;
    if (hasLos) score += 140;
    if (options.multiTargetScoring) {
      // 优先打击没盾、低弹药或正在暴露给自己的对手；避开拿着激光/散弹正对自己的满血目标硬碰
      if (!op.hasShield) score += 55;
      if (op.ammo <= 1 && !op.offenseKind) score += 60;
      if (op.offenseKind === 'laser' && hasLos) score -= 45;
      // 多人混战时惩罚路径风险过高的目标（避免穿越交叉火力）
      const riskRatio = (dist[opCell] - Math.max(0, cellDist) * CELL_SIZE) * 0.22;
      score -= Math.max(0, riskRatio);
    }

    if (score > bestEnemyScore) {
      bestEnemyScore = score;
      primaryEnemy = op;
    }
  }

  const primaryEnemyCell = worldToCellIndex(maze, primaryEnemy.x, primaryEnemy.y);
  let bestGoalKind: RouteGoalKind = 'attack';
  let bestGoalCell = primaryEnemyCell;
  let bestGoalPoint: Vec2 = { x: primaryEnemy.x, y: primaryEnemy.y };
  let bestUtility = 70 - Math.max(0, steps[primaryEnemyCell]) * 6;

  // 若高阶持单次强道具（散弹/激光），积极压近合适射程
  if (self.offense?.kind === 'shotgun' || self.offense?.kind === 'laser') {
    bestUtility += 28;
  }

  // 2. 评估场上全部可拾取道具（综合武器协同、过期时间、路径风险与对手争抢）
  if (options.itemSearchMaxSteps > 0 && world.drops.length > 0) {
    for (let i = 0; i < world.drops.length; i += 1) {
      const drop = world.drops[i];
      const stepDist = steps[drop.cellIndex];
      if (stepDist < 0 || stepDist > options.itemSearchMaxSteps) continue;

      const travelSec = (stepDist * CELL_SIZE) / speed;
      const remainingLife = drop.expiresAtBattleTime - world.battleTime;
      if (travelSec + 0.15 > remainingLife) continue;

      // 计算自身对道具的净价值
      let value = BASE_ITEM_VALUE[drop.kind];
      if (drop.kind === 'shield') {
        value = self.shield ? 22 : 108;
      } else if (self.offense) {
        const curVal = BASE_ITEM_VALUE[self.offense.kind];
        const remTime = self.offense.expiresAtBattleTime - world.battleTime;
        if (curVal >= value && remTime > 2.2) {
          continue; // 已有更强且尚余充足时限的进攻道具，不盲目覆盖
        }
        value = Math.max(15, value - curVal * 0.45);
      }

      // 空弹/低弹时，单次道具与护盾价值大幅上升
      if (self.ammo <= 1 && drop.kind !== 'rapid_fire' && drop.kind !== 'shotgun') {
        value += 36;
      }

      // 评估是否有对手比我更快抢到该道具
      let enemyBestTravel = Infinity;
      for (let ei = 0; ei < enemies.length; ei += 1) {
        const opCell = worldToCellIndex(maze, enemies[ei].x, enemies[ei].y);
        const eSteps = distMatrix[opCell * cellCount + drop.cellIndex];
        if (eSteps >= 0) {
          const eTravel = (eSteps * CELL_SIZE) / speed;
          if (eTravel < enemyBestTravel) enemyBestTravel = eTravel;
        }
      }
      if (enemyBestTravel + 0.35 < travelSec && !self.shield) {
        value -= 48; // 对手先到太多时避免白跑送头
      }

      const riskPenalty = Math.max(0, dist[drop.cellIndex] - stepDist * CELL_SIZE) * 0.15;
      const utility = value - stepDist * 11 - riskPenalty;
      if (utility > bestUtility) {
        bestUtility = utility;
        bestGoalKind = 'drop';
        bestGoalCell = drop.cellIndex;
        bestGoalPoint = { x: drop.x, y: drop.y };
      }
    }
  }

  // 3. 低弹补给掩体 / 冷却拉扯掩体评估（冷却期在敌人直视近程内主动退掩体，不白送身位）
  const distToPrimary = Math.hypot(primaryEnemy.x - self.x, primaryEnemy.y - self.y);
  const onCooldownUnderFire =
    options.coverReloadEnabled &&
    self.fireReadyAt > world.battleTime + 0.16 &&
    primaryEnemy.fireReady &&
    distToPrimary < 260 &&
    hasLineOfSight(maze, self.x, self.y, primaryEnemy.x, primaryEnemy.y);
  const lowAmmoNeedsCover =
    options.coverReloadEnabled &&
    (onCooldownUnderFire ||
      (self.ammo <= 1 &&
        (!self.offense || self.offense.kind === 'rapid_fire' || self.offense.kind === 'shotgun')));

  if (lowAmmoNeedsCover) {
    let bestCoverCell = -1;
    let bestCoverScore = -Infinity;
    const degrees = shared.mazeCache.cellDegrees;

    for (let c = 0; c < maze.cells.length; c += 1) {
      const s = steps[c];
      if (s < 0 || s > 4) continue;
      if (degrees[c] < 2) continue; // 掩体至少有两个出口，防止进死胡同被堵杀
      const cell = maze.cells[c];
      const exposed = enemies.some((op) =>
        hasLineOfSight(maze, op.x, op.y, cell.centerX, cell.centerY)
      );
      if (exposed) continue;

      const safetyBias = (degrees[c] >= 3 ? 25 : 10) - s * 14 - Math.max(0, dist[c] - s * CELL_SIZE) * 0.2;
      const coverScore = 92 + safetyBias;
      if (coverScore > bestCoverScore) {
        bestCoverScore = coverScore;
        bestCoverCell = c;
      }
    }

    if (bestCoverCell !== -1 && bestCoverScore > bestUtility) {
      bestUtility = bestCoverScore;
      bestGoalKind = 'cover';
      bestGoalCell = bestCoverCell;
      bestGoalPoint = {
        x: maze.cells[bestCoverCell].centerX,
        y: maze.cells[bestCoverCell].centerY,
      };
    }
  } else if (
    bestGoalKind === 'attack' &&
    hasLineOfSight(maze, self.x, self.y, primaryEnemy.x, primaryEnemy.y) &&
    distToPrimary < (self.offense?.kind === 'shotgun' ? 95 : 145) &&
    self.offense?.kind !== 'shotgun'
  ) {
    // 贴脸交战且不持散弹枪时，优先向相邻多出口安全格侧翼风筝，防止卡死或近距同归
    const selfNeighbors = maze.cells[selfCell].neighbors;
    let bestKiteCell = selfCell;
    let bestKiteScore = -Infinity;
    for (let i = 0; i < selfNeighbors.length; i += 1) {
      const nb = selfNeighbors[i];
      const nc = maze.cells[nb];
      const dAfter = Math.hypot(nc.centerX - primaryEnemy.x, nc.centerY - primaryEnemy.y);
      const deg = shared.mazeCache.cellDegrees[nb];
      const threat = evaluateCellThreatAtTime(
        maze,
        shared,
        self,
        { x: nc.centerX, y: nc.centerY },
        CELL_SIZE / speed,
        options.maxBounceThreat,
        opponents
      );
      const kiteScore = dAfter * 0.45 + deg * 18 - threat * 0.8;
      if (kiteScore > bestKiteScore) {
        bestKiteScore = kiteScore;
        bestKiteCell = nb;
      }
    }
    if (bestKiteCell !== selfCell) {
      bestGoalKind = 'kite';
      bestGoalCell = bestKiteCell;
      bestGoalPoint = {
        x: maze.cells[bestKiteCell].centerX,
        y: maze.cells[bestKiteCell].centerY,
      };
    }
  }

  const cellPath = reconstructPath(parent, selfCell, bestGoalCell);
  const waypoint = pickSmoothWaypoint(maze, self, cellPath, bestGoalPoint);

  // 若目标就在当前邻近直视范围内且无需绕墙，直接指向平滑航点
  if (
    cellPath.length <= 2 &&
    hasLineOfSight(maze, self.x, self.y, bestGoalPoint.x, bestGoalPoint.y) &&
    Math.hypot(bestGoalPoint.x - self.x, bestGoalPoint.y - self.y) > TANK_RADIUS * 1.4
  ) {
    return {
      goalKind: bestGoalKind,
      targetSlotId: primaryEnemy.slotId,
      goalCell: bestGoalCell,
      goalPoint: bestGoalPoint,
      cellPath,
      waypoint: bestGoalPoint,
      totalRiskCost: dist[bestGoalCell],
    };
  }

  return {
    goalKind: bestGoalKind,
    targetSlotId: primaryEnemy.slotId,
    goalCell: bestGoalCell,
    goalPoint: bestGoalPoint,
    cellPath,
    waypoint,
    totalRiskCost: dist[bestGoalCell],
  };
}
