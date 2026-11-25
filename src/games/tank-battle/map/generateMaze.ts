import {
  CELL_SIZE,
  type MazeCell,
  type MazeData,
  TANK_BARREL_LENGTH,
  TANK_RADIUS,
  WALL_THICKNESS,
  type WallSegment,
} from '../types';
import {
  encodeMapCode,
  MAZE_GENERATOR_VERSION,
  parseMapCode,
} from '../rules';
import { DeterministicRng } from './rng';

/**
 * 由地图编号或参数生成确定性迷宫：
 * 1. 使用随机化 DFS 生成全连通生成树（保证任意两格可达）
 * 2. 随机打通可配置数量的额外内部墙面形成环路
 * 3. 构建同一份墙段列表与邻接图供物理碰撞、追踪寻路、出生点筛选与 Canvas 绘制复用
 * 4. 校验通道净宽允许坦克原地 360° 转向
 */
export function generateMaze(params: {
  cols: number;
  rows: number;
  extraPassages: number;
  seed: number;
}): MazeData {
  const cols = Math.max(6, Math.min(16, Math.floor(params.cols)));
  const rows = Math.max(5, Math.min(12, Math.floor(params.rows)));
  const extraPassages = Math.max(0, Math.min(60, Math.floor(params.extraPassages)));
  const seed = params.seed >>> 0;

  // 验证几何净宽满足坦克原地旋转（炮口旋转半径）与完整通行
  const clearCorridorWidth = CELL_SIZE - WALL_THICKNESS;
  const requiredTurnDiameter = Math.max(TANK_RADIUS * 2, TANK_BARREL_LENGTH * 2);
  if (clearCorridorWidth < requiredTurnDiameter) {
    throw new Error('迷宫走廊宽度不足以容纳坦克原地转向');
  }

  const rng = new DeterministicRng(seed);

  // horizontalWalls[r][c]：第 r 行格子的上边界（r = 0..rows）
  const horizontalWalls: boolean[][] = Array.from({ length: rows + 1 }, () =>
    Array.from({ length: cols }, () => true)
  );
  // verticalWalls[r][c]：第 c 列格子的左边界（c = 0..cols）
  const verticalWalls: boolean[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols + 1 }, () => true)
  );

  // 1. 生成全连通生成树（迭代随机 DFS）
  const visited = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false));
  const startCol = rng.nextInt(0, cols - 1);
  const startRow = rng.nextInt(0, rows - 1);
  visited[startRow][startCol] = true;
  const stack: Array<{ col: number; row: number }> = [{ col: startCol, row: startRow }];

  const dirs = [
    { dc: 0, dr: -1 },
    { dc: 1, dr: 0 },
    { dc: 0, dr: 1 },
    { dc: -1, dr: 0 },
  ];

  while (stack.length > 0) {
    const cur = stack[stack.length - 1];
    const unvisitedDirs = dirs.filter((d) => {
      const nc = cur.col + d.dc;
      const nr = cur.row + d.dr;
      return nc >= 0 && nc < cols && nr >= 0 && nr < rows && !visited[nr][nc];
    });

    if (unvisitedDirs.length === 0) {
      stack.pop();
      continue;
    }

    const pick = unvisitedDirs[rng.nextInt(0, unvisitedDirs.length - 1)];
    const nc = cur.col + pick.dc;
    const nr = cur.row + pick.dr;
    removeWallBetween(horizontalWalls, verticalWalls, cur.col, cur.row, nc, nr);
    visited[nr][nc] = true;
    stack.push({ col: nc, row: nr });
  }

  // 2. 收集所有尚未打通的内部墙，打通最多 extraPassages 条形成战术环路
  interface InternalWall {
    kind: 'h' | 'v';
    r: number;
    c: number;
  }
  const internalWalls: InternalWall[] = [];
  for (let r = 1; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (horizontalWalls[r][c]) {
        internalWalls.push({ kind: 'h', r, c });
      }
    }
  }
  for (let r = 0; r < rows; r += 1) {
    for (let c = 1; c < cols; c += 1) {
      if (verticalWalls[r][c]) {
        internalWalls.push({ kind: 'v', r, c });
      }
    }
  }
  rng.shuffle(internalWalls);
  const toOpen = Math.min(extraPassages, internalWalls.length);
  for (let i = 0; i < toOpen; i += 1) {
    const w = internalWalls[i];
    if (w.kind === 'h') {
      horizontalWalls[w.r][w.c] = false;
    } else {
      verticalWalls[w.r][w.c] = false;
    }
  }

  return buildMazeData(cols, rows, extraPassages, seed, horizontalWalls, verticalWalls);
}

/**
 * 根据地图编号直接复现迷宫；若编号无效则用给定参数与后备种子生成。
 */
export function generateMazeFromCodeOrParams(params: {
  mapCode: string;
  cols: number;
  rows: number;
  extraPassages: number;
  fallbackSeed: number;
}): MazeData {
  const parsed = parseMapCode(params.mapCode);
  if (parsed) {
    return generateMaze({
      cols: parsed.cols,
      rows: parsed.rows,
      extraPassages: parsed.extraPassages,
      seed: parsed.seed,
    });
  }
  return generateMaze({
    cols: params.cols,
    rows: params.rows,
    extraPassages: params.extraPassages,
    seed: params.fallbackSeed,
  });
}

function removeWallBetween(
  hWalls: boolean[][],
  vWalls: boolean[][],
  c1: number,
  r1: number,
  c2: number,
  r2: number
): void {
  if (c1 === c2) {
    hWalls[Math.max(r1, r2)][c1] = false;
  } else if (r1 === r2) {
    vWalls[r1][Math.max(c1, c2)] = false;
  }
}

function buildMazeData(
  cols: number,
  rows: number,
  extraPassages: number,
  seed: number,
  horizontalWalls: boolean[][],
  verticalWalls: boolean[][]
): MazeData {
  const cells: MazeCell[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const index = r * cols + c;
      const neighbors: number[] = [];
      if (r > 0 && !horizontalWalls[r][c]) neighbors.push((r - 1) * cols + c);
      if (r < rows - 1 && !horizontalWalls[r + 1][c]) neighbors.push((r + 1) * cols + c);
      if (c > 0 && !verticalWalls[r][c]) neighbors.push(r * cols + (c - 1));
      if (c < cols - 1 && !verticalWalls[r][c + 1]) neighbors.push(r * cols + (c + 1));

      cells.push({
        col: c,
        row: r,
        index,
        centerX: c * CELL_SIZE + CELL_SIZE / 2,
        centerY: r * CELL_SIZE + CELL_SIZE / 2,
        neighbors,
      });
    }
  }

  // 合并共线连续墙段，减少碰撞检测次数并消除墙段接缝瑕疵
  const walls: WallSegment[] = [];
  for (let r = 0; r <= rows; r += 1) {
    let c = 0;
    while (c < cols) {
      if (!horizontalWalls[r][c]) {
        c += 1;
        continue;
      }
      const startC = c;
      while (c < cols && horizontalWalls[r][c]) {
        c += 1;
      }
      walls.push({
        x1: startC * CELL_SIZE,
        y1: r * CELL_SIZE,
        x2: c * CELL_SIZE,
        y2: r * CELL_SIZE,
        orientation: 'h',
      });
    }
  }

  for (let c = 0; c <= cols; c += 1) {
    let r = 0;
    while (r < rows) {
      if (!verticalWalls[r][c]) {
        r += 1;
        continue;
      }
      const startR = r;
      while (r < rows && verticalWalls[r][c]) {
        r += 1;
      }
      walls.push({
        x1: c * CELL_SIZE,
        y1: startR * CELL_SIZE,
        x2: c * CELL_SIZE,
        y2: r * CELL_SIZE,
        orientation: 'v',
      });
    }
  }

  const mapCode = encodeMapCode({
    version: MAZE_GENERATOR_VERSION,
    cols,
    rows,
    extraPassages,
    seed,
  });

  return {
    version: MAZE_GENERATOR_VERSION,
    seed,
    cols,
    rows,
    extraPassages,
    mapCode,
    width: cols * CELL_SIZE,
    height: rows * CELL_SIZE,
    cells,
    walls,
    horizontalWalls,
    verticalWalls,
  };
}

/** 构造保底布局（极端容错时使用，满足全连通与双人无直视对角出生） */
export function createFallbackMaze(cols: number, rows: number, seed: number): MazeData {
  const safeCols = Math.max(6, Math.min(16, Math.floor(cols)));
  const safeRows = Math.max(5, Math.min(12, Math.floor(rows)));
  const hWalls: boolean[][] = Array.from({ length: safeRows + 1 }, (_, r) =>
    Array.from({ length: safeCols }, () => r === 0 || r === safeRows)
  );
  const vWalls: boolean[][] = Array.from({ length: safeRows }, () =>
    Array.from({ length: safeCols + 1 }, (_, c) => c === 0 || c === safeCols)
  );
  // 在中间放置一道带缺口的战术隔墙，确保对角无直视且双向可达
  const midC = Math.floor(safeCols / 2);
  for (let r = 1; r < safeRows - 1; r += 1) {
    vWalls[r][midC] = true;
  }
  return buildMazeData(safeCols, safeRows, 0, seed, hWalls, vWalls);
}

/** 计算从起始格到全图所有格子的 BFS 通道步距 */
export function computeBfsDistances(maze: MazeData, startCellIndex: number): Int32Array {
  const dist = new Int32Array(maze.cells.length).fill(-1);
  if (startCellIndex < 0 || startCellIndex >= maze.cells.length) return dist;
  const queue = new Int32Array(maze.cells.length);
  let head = 0;
  let tail = 0;
  dist[startCellIndex] = 0;
  queue[tail++] = startCellIndex;

  while (head < tail) {
    const cur = queue[head++];
    const nextDist = dist[cur] + 1;
    const neighbors = maze.cells[cur].neighbors;
    for (let i = 0; i < neighbors.length; i += 1) {
      const nb = neighbors[i];
      if (dist[nb] === -1) {
        dist[nb] = nextDist;
        queue[tail++] = nb;
      }
    }
  }
  return dist;
}

/** 计算从起点格到目标格的下一跳格子索引（供追踪弹沿迷宫寻路） */
export function findNextPathCell(
  maze: MazeData,
  fromCellIndex: number,
  targetCellIndex: number
): number {
  if (fromCellIndex === targetCellIndex) return targetCellIndex;
  const distFromTarget = computeBfsDistances(maze, targetCellIndex);
  const currentDist = distFromTarget[fromCellIndex];
  if (currentDist <= 0) return targetCellIndex;

  const neighbors = maze.cells[fromCellIndex].neighbors;
  let bestCell = fromCellIndex;
  let bestDist = currentDist;
  for (let i = 0; i < neighbors.length; i += 1) {
    const nb = neighbors[i];
    const d = distFromTarget[nb];
    if (d >= 0 && d < bestDist) {
      bestDist = d;
      bestCell = nb;
    }
  }
  return bestCell;
}

/** 将世界坐标映射到所属迷宫格索引 */
export function worldToCellIndex(maze: MazeData, x: number, y: number): number {
  const col = Math.max(0, Math.min(maze.cols - 1, Math.floor(x / CELL_SIZE)));
  const row = Math.max(0, Math.min(maze.rows - 1, Math.floor(y / CELL_SIZE)));
  return row * maze.cols + col;
}
