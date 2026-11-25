import { CELL_SIZE, type MazeData, type SpawnPoint } from '../types';
import { hasLineOfSight } from '../simulation/collision';
import { computeBfsDistances } from './generateMaze';
import { DeterministicRng } from './rng';

/**
 * 为 2~8 名参战坦克分配合法且尽量分散的出生点：
 * - 2 人对局走经典严格对角无直视双点搜索（保持既有确定性与手感）
 * - 3~8 人大乱斗采用迷宫最远点贪心采样（Farthest-Point Sampling），优先避开直线互视并最大化最小通行步距
 * - 每辆坦克车头均朝向当前格的一条开放通道，绝不开局面壁
 */
export function selectSpawnPoints(
  maze: MazeData,
  count: number,
  rng: DeterministicRng
): SpawnPoint[] {
  const safeCount = Math.max(2, Math.min(count, maze.cells.length));
  if (safeCount === 2) {
    return selectSpawnPair(maze, rng);
  }

  const totalCells = maze.cells.length;
  // 先通过经典双点搜索选定前 2 个拉开距离的锚点
  const initialPair = selectSpawnPair(maze, rng);
  const chosenIndices: number[] = [initialPair[0].cellIndex, initialPair[1].cellIndex];
  const chosenSet = new Set<number>(chosenIndices);

  // 缓存已选各点的 BFS 距离图，高效贪心挑选后续第 3..N 个最远无直视点
  const distMaps: Int32Array[] = chosenIndices.map((idx) => computeBfsDistances(maze, idx));

  const candidateOrder = Array.from({ length: totalCells }, (_, i) => i);
  rng.shuffle(candidateOrder);

  while (chosenIndices.length < safeCount) {
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < candidateOrder.length; i += 1) {
      const cand = candidateOrder[i];
      if (chosenSet.has(cand)) continue;
      const candCell = maze.cells[cand];

      let minPathSteps = Infinity;
      let minEuclid = Infinity;
      let clearSightCount = 0;

      for (let j = 0; j < chosenIndices.length; j += 1) {
        const otherIdx = chosenIndices[j];
        const otherCell = maze.cells[otherIdx];
        const pathDist = distMaps[j][cand];
        if (pathDist >= 0 && pathDist < minPathSteps) {
          minPathSteps = pathDist;
        }
        const euclid = Math.hypot(
          candCell.centerX - otherCell.centerX,
          candCell.centerY - otherCell.centerY
        );
        if (euclid < minEuclid) {
          minEuclid = euclid;
        }
        if (
          hasLineOfSight(
            maze,
            candCell.centerX,
            candCell.centerY,
            otherCell.centerX,
            otherCell.centerY
          )
        ) {
          clearSightCount += 1;
        }
      }

      const safeMinSteps = Number.isFinite(minPathSteps) ? minPathSteps : 0;
      const safeMinEuclid = Number.isFinite(minEuclid) ? minEuclid : 0;
      const score =
        (clearSightCount === 0 ? 5000 : -clearSightCount * 1500) +
        safeMinSteps * 110 +
        safeMinEuclid * 0.8;

      if (score > bestScore) {
        bestScore = score;
        bestIdx = cand;
      }
    }

    if (bestIdx < 0) break;
    chosenIndices.push(bestIdx);
    chosenSet.add(bestIdx);
    distMaps.push(computeBfsDistances(maze, bestIdx));
  }

  return chosenIndices.map((cellIndex, idx) =>
    idx < 2 ? initialPair[idx] : buildSpawnPoint(maze, cellIndex, rng)
  );
}

/**
 * 为双方挑选合法出生点：
 * - 双方距离足够远（欧氏距离与迷宫通道步距双约束）
 * - 出生点之间无直线无遮挡射界
 * - 车头朝向一条开放通道，而非面对死墙
 * 使用有界搜索，若严格条件在极小地图上无法满足则按优先级确定性放宽。
 */
export function selectSpawnPair(maze: MazeData, rng: DeterministicRng): [SpawnPoint, SpawnPoint] {
  const totalCells = maze.cells.length;
  const minEuclidean = Math.max(CELL_SIZE * 2.5, Math.min(maze.width, maze.height) * 0.45);
  const minPathSteps = Math.max(4, Math.floor((maze.cols + maze.rows) * 0.45));

  const indices = Array.from({ length: totalCells }, (_, i) => i);
  rng.shuffle(indices);

  // 严格搜索（有界最多检验 240 对候选，兼顾性能与质量）
  let bestFallback: { a: number; b: number; score: number } | null = null;
  let attempts = 0;

  for (let i = 0; i < indices.length && attempts < 240; i += 1) {
    const idxA = indices[i];
    const cellA = maze.cells[idxA];
    const distMap = computeBfsDistances(maze, idxA);

    for (let j = i + 1; j < indices.length && attempts < 240; j += 1) {
      attempts += 1;
      const idxB = indices[j];
      const cellB = maze.cells[idxB];
      const pathDist = distMap[idxB];
      if (pathDist < 0) continue;

      const euclid = Math.hypot(cellA.centerX - cellB.centerX, cellA.centerY - cellB.centerY);
      const blockedSight = !hasLineOfSight(
        maze,
        cellA.centerX,
        cellA.centerY,
        cellB.centerX,
        cellB.centerY
      );

      if (euclid >= minEuclidean && pathDist >= minPathSteps && blockedSight) {
        return [
          buildSpawnPoint(maze, idxA, rng),
          buildSpawnPoint(maze, idxB, rng),
        ];
      }

      const candidateScore =
        (blockedSight ? 10000 : 0) + pathDist * 60 + euclid;
      if (!bestFallback || candidateScore > bestFallback.score) {
        bestFallback = { a: idxA, b: idxB, score: candidateScore };
      }
    }
  }

  // 保底使用评分最高的远距无直视对角点
  const a = bestFallback?.a ?? 0;
  const b = bestFallback?.b ?? Math.max(0, totalCells - 1);
  return [buildSpawnPoint(maze, a, rng), buildSpawnPoint(maze, b, rng)];
}

/** 车头面向当前格某条开放通道方向，避免一开局就面壁 */
function buildSpawnPoint(maze: MazeData, cellIndex: number, rng: DeterministicRng): SpawnPoint {
  const cell = maze.cells[cellIndex];
  let angle = 0;
  if (cell.neighbors.length > 0) {
    const nbIndex = cell.neighbors[rng.nextInt(0, cell.neighbors.length - 1)];
    const nb = maze.cells[nbIndex];
    angle = Math.atan2(nb.centerY - cell.centerY, nb.centerX - cell.centerX);
  }
  return {
    cellIndex,
    x: cell.centerX,
    y: cell.centerY,
    angle,
  };
}
