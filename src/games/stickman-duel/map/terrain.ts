import { DeterministicRng } from '../../tank-battle/map/rng';
import type {
  StickmanMapTemplate,
  StickmanTerrain,
  TerrainTileKind,
} from '../types';
import { resolveConcreteTemplate } from '../rules';

export const STICKMAN_GRID_COLS = 32;
export const STICKMAN_GRID_ROWS = 18;
export const STICKMAN_TILE_SIZE = 36;
export const STICKMAN_WORLD_WIDTH = STICKMAN_GRID_COLS * STICKMAN_TILE_SIZE; // 1152
export const STICKMAN_WORLD_HEIGHT = STICKMAN_GRID_ROWS * STICKMAN_TILE_SIZE; // 648

export function tileIndex(cols: number, col: number, row: number): number {
  return row * cols + col;
}

export function getTile(terrain: StickmanTerrain, col: number, row: number): TerrainTileKind {
  if (col < 0 || col >= terrain.cols || row < 0) return 'empty';
  if (row >= terrain.rows) return 'bedrock';
  return terrain.tiles[row * terrain.cols + col];
}

export function setTile(
  terrain: StickmanTerrain,
  col: number,
  row: number,
  kind: TerrainTileKind
): void {
  if (col < 0 || col >= terrain.cols || row < 0 || row >= terrain.rows) return;
  // 最底部一行永久不可破坏，恒保持基岩
  if (row === terrain.rows - 1) {
    terrain.tiles[row * terrain.cols + col] = 'bedrock';
    return;
  }
  terrain.tiles[row * terrain.cols + col] = kind;
}

function fillRect(
  terrain: StickmanTerrain,
  c0: number,
  r0: number,
  w: number,
  h: number,
  kind: TerrainTileKind
): void {
  for (let r = r0; r < r0 + h; r += 1) {
    for (let c = c0; c < c0 + w; c += 1) {
      setTile(terrain, c, r, kind);
    }
  }
}

function mirrorHorizontal(terrain: StickmanTerrain): void {
  const half = Math.floor(terrain.cols / 2);
  for (let r = 0; r < terrain.rows - 1; r += 1) {
    for (let c = 0; c < half; c += 1) {
      const k = getTile(terrain, c, r);
      setTile(terrain, terrain.cols - 1 - c, r, k);
    }
  }
}

/**
 * 构建自底向上堆叠的 2D 可破坏战场：
 * - Row 17（最底部）：永久不可破坏基岩层（bedrock）
 * - 上方堆叠：可被火箭筒炸毁的砖块掩体/阶梯/塔楼（brick）与悬空单向短平台（platform）
 */
export function buildStickmanTerrain(
  requestedTemplate: StickmanMapTemplate,
  seed: number,
  playerCount = 2
): StickmanTerrain {
  const rng = new DeterministicRng(seed);
  const template = resolveConcreteTemplate(requestedTemplate, seed);
  const cols = STICKMAN_GRID_COLS;
  const rows = STICKMAN_GRID_ROWS;
  const tiles: TerrainTileKind[] = new Array(cols * rows).fill('empty');
  const variants = new Uint8Array(cols * rows);
  for (let i = 0; i < variants.length; i += 1) {
    variants[i] = Math.floor(rng.next() * 256);
  }

  const terrain: StickmanTerrain = {
    cols,
    rows,
    tileSize: STICKMAN_TILE_SIZE,
    width: cols * STICKMAN_TILE_SIZE,
    height: rows * STICKMAN_TILE_SIZE,
    template,
    tiles,
    variants,
    spawnPoints: [],
  };

  // 最底行永久不可破坏基岩
  for (let c = 0; c < cols; c += 1) {
    terrain.tiles[tileIndex(cols, c, rows - 1)] = 'bedrock';
  }

  // 底层上方先铺设若干堆叠砖层 + 短平台，确保四种原型各具鲜明战术纵深
  if (template === 'twin_towers') {
    // 底部轻度堆叠基座
    fillRect(terrain, 0, 16, 10, 1, 'brick');
    fillRect(terrain, 12, 16, 4, 1, 'brick');
    // 左右双塔（可被火箭轰塌）
    fillRect(terrain, 4, 13, 4, 3, 'brick');
    fillRect(terrain, 2, 14, 2, 2, 'brick');
    fillRect(terrain, 13, 14, 3, 2, 'brick');
    // 悬空短平台（三层高低落差）
    fillRect(terrain, 9, 13, 3, 1, 'platform');
    fillRect(terrain, 5, 10, 4, 1, 'platform');
    fillRect(terrain, 12, 10, 4, 1, 'platform');
    fillRect(terrain, 9, 7, 4, 1, 'platform');
    mirrorHorizontal(terrain);
  } else if (template === 'stepped_ruins') {
    // 自底向上阶梯式堆叠废墟
    fillRect(terrain, 1, 16, 15, 1, 'brick');
    fillRect(terrain, 3, 15, 10, 1, 'brick');
    fillRect(terrain, 6, 14, 5, 1, 'brick');
    fillRect(terrain, 13, 14, 3, 2, 'brick');
    fillRect(terrain, 14, 12, 2, 2, 'brick');
    // 悬空短平台串联高空路线
    fillRect(terrain, 2, 11, 4, 1, 'platform');
    fillRect(terrain, 8, 10, 4, 1, 'platform');
    fillRect(terrain, 5, 7, 4, 1, 'platform');
    fillRect(terrain, 13, 7, 3, 1, 'platform');
    mirrorHorizontal(terrain);
  } else if (template === 'sky_platforms') {
    // 轻薄底层堆块 + 多层错落短平台（主打空中连跳与穿台追击）
    fillRect(terrain, 2, 16, 5, 1, 'brick');
    fillRect(terrain, 10, 16, 6, 1, 'brick');
    fillRect(terrain, 12, 15, 4, 1, 'brick');
    fillRect(terrain, 3, 13, 4, 1, 'platform');
    fillRect(terrain, 9, 12, 4, 1, 'platform');
    fillRect(terrain, 14, 10, 2, 1, 'platform');
    fillRect(terrain, 4, 9, 4, 1, 'platform');
    fillRect(terrain, 10, 7, 4, 1, 'platform');
    mirrorHorizontal(terrain);
  } else {
    // fortress_bunkers：重型掩体碉堡群 + 顶层短平台狙击位
    fillRect(terrain, 0, 16, 16, 1, 'brick');
    fillRect(terrain, 2, 14, 3, 2, 'brick');
    fillRect(terrain, 8, 13, 3, 3, 'brick');
    fillRect(terrain, 14, 14, 2, 2, 'brick');
    fillRect(terrain, 5, 12, 3, 1, 'platform');
    fillRect(terrain, 11, 11, 4, 1, 'platform');
    fillRect(terrain, 3, 9, 4, 1, 'platform');
    fillRect(terrain, 9, 8, 4, 1, 'platform');
    mirrorHorizontal(terrain);
  }

  // 根据种子做对称小幅随机掩体装饰（保持公平同时每局都有新鲜变化）
  const decorCount = 2 + Math.floor(rng.next() * 2);
  for (let i = 0; i < decorCount; i += 1) {
    const col = 2 + Math.floor(rng.next() * 12);
    // 找到该列自下而上的第一个可堆叠空位
    for (let r = rows - 2; r >= 11; r -= 1) {
      if (getTile(terrain, col, r) === 'empty' && getTile(terrain, col, r + 1) !== 'empty') {
        if (getTile(terrain, col, r + 1) !== 'platform') {
          setTile(terrain, col, r, 'brick');
          setTile(terrain, cols - 1 - col, r, 'brick');
        }
        break;
      }
    }
  }

  // 为 2~8 位火柴人计算安全落脚出生点（确保头顶至少 2 格净空）
  terrain.spawnPoints = computeSafeSpawnPoints(terrain, Math.max(2, playerCount));
  return terrain;
}

function findLandingYForColumn(terrain: StickmanTerrain, col: number, preferHigh: boolean): number {
  const ts = terrain.tileSize;
  const candidates: number[] = [];
  for (let r = 3; r < terrain.rows; r += 1) {
    const tile = getTile(terrain, col, r);
    if (tile === 'empty') continue;
    const above1 = getTile(terrain, col, r - 1);
    const above2 = getTile(terrain, col, r - 2);
    if (above1 === 'empty' && above2 === 'empty') {
      candidates.push(r * ts);
    }
  }
  if (candidates.length === 0) {
    return (terrain.rows - 1) * ts;
  }
  return preferHigh ? candidates[0] : candidates[candidates.length - 1];
}

function computeSafeSpawnPoints(
  terrain: StickmanTerrain,
  count: number
): Array<{ x: number; y: number }> {
  const ts = terrain.tileSize;
  const preferredCols2P = [5, terrain.cols - 6];
  const preferredColsMulti = [3, terrain.cols - 4, 9, terrain.cols - 10, 14, terrain.cols - 15, 6, terrain.cols - 7];
  const colsList = count <= 2 ? preferredCols2P : preferredColsMulti;

  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i += 1) {
    const col = colsList[i % colsList.length];
    const y = findLandingYForColumn(terrain, col, i >= 2);
    out.push({
      x: (col + 0.5) * ts,
      y,
    });
  }
  return out;
}

export interface DestroyedTileInfo {
  col: number;
  row: number;
  x: number;
  y: number;
  kind: 'brick' | 'platform';
}

/**
 * 火箭筒范围爆破破坏地形：
 * - 炸毁爆炸半径内所有可破坏砖块（brick）与悬空短平台（platform）
 * - 永远不会破坏最底层基岩（bedrock）
 */
export function destroyTerrainInRadius(
  terrain: StickmanTerrain,
  cx: number,
  cy: number,
  radius: number
): DestroyedTileInfo[] {
  const ts = terrain.tileSize;
  const minCol = Math.max(0, Math.floor((cx - radius) / ts));
  const maxCol = Math.min(terrain.cols - 1, Math.floor((cx + radius) / ts));
  const minRow = Math.max(0, Math.floor((cy - radius) / ts));
  const maxRow = Math.min(terrain.rows - 2, Math.floor((cy + radius) / ts)); // rows - 1 基岩受保护

  const destroyed: DestroyedTileInfo[] = [];
  const rSq = radius * radius;

  for (let r = minRow; r <= maxRow; r += 1) {
    for (let c = minCol; c <= maxCol; c += 1) {
      const tile = getTile(terrain, c, r);
      if (tile !== 'brick' && tile !== 'platform') continue;
      const tx = (c + 0.5) * ts;
      const ty = (r + 0.5) * ts;
      const dx = tx - cx;
      const dy = ty - cy;
      if (dx * dx + dy * dy <= rSq) {
        setTile(terrain, c, r, 'empty');
        destroyed.push({ col: c, row: r, x: tx, y: ty, kind: tile });
      }
    }
  }
  return destroyed;
}

export interface BodyPhysicsState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  halfWidth: number;
  height: number;
  onGround: boolean;
  onPlatform: boolean;
}

/**
 * 轴分离连续物理碰撞：
 * - 实体方块（bedrock / brick）四向阻挡
 * - 短平台（platform）仅向下落地时承托，从下往上可直接跃过，dropThrough=true 时主动穿透下落
 */
export function moveBodyWithTerrain(
  terrain: StickmanTerrain,
  body: BodyPhysicsState,
  dt: number,
  dropThrough: boolean,
  restitution = 0
): { hitWall: boolean; landed: boolean; hitCeiling: boolean } {
  const ts = terrain.tileSize;
  const eps = 0.001;
  let hitWall = false;
  let landed = false;
  let hitCeiling = false;

  // 1. 水平移动 + 实体墙阻挡
  body.x += body.vx * dt;
  if (body.x - body.halfWidth < 0) {
    body.x = body.halfWidth;
    body.vx = restitution > 0 ? Math.abs(body.vx) * restitution : 0;
    hitWall = true;
  } else if (body.x + body.halfWidth > terrain.width) {
    body.x = terrain.width - body.halfWidth;
    body.vx = restitution > 0 ? -Math.abs(body.vx) * restitution : 0;
    hitWall = true;
  }

  const topY = body.y - body.height + eps;
  const bottomY = body.y - eps;
  const minRowX = Math.max(0, Math.floor(topY / ts));
  const maxRowX = Math.min(terrain.rows - 1, Math.floor(bottomY / ts));

  if (body.vx > 0) {
    const rightCol = Math.floor((body.x + body.halfWidth - eps) / ts);
    for (let r = minRowX; r <= maxRowX; r += 1) {
      const t = getTile(terrain, rightCol, r);
      if (t === 'bedrock' || t === 'brick') {
        body.x = rightCol * ts - body.halfWidth;
        body.vx = restitution > 0 ? -Math.abs(body.vx) * restitution : 0;
        hitWall = true;
        break;
      }
    }
  } else if (body.vx < 0) {
    const leftCol = Math.floor((body.x - body.halfWidth + eps) / ts);
    for (let r = minRowX; r <= maxRowX; r += 1) {
      const t = getTile(terrain, leftCol, r);
      if (t === 'bedrock' || t === 'brick') {
        body.x = (leftCol + 1) * ts + body.halfWidth;
        body.vx = restitution > 0 ? Math.abs(body.vx) * restitution : 0;
        hitWall = true;
        break;
      }
    }
  }

  // 2. 垂直移动 + 实心/短平台单向碰撞
  const prevY = body.y;
  body.y += body.vy * dt;
  body.onGround = false;
  body.onPlatform = false;

  const minColY = Math.max(0, Math.floor((body.x - body.halfWidth + eps) / ts));
  const maxColY = Math.min(terrain.cols - 1, Math.floor((body.x + body.halfWidth - eps) / ts));

  if (body.vy >= 0) {
    const startRow = Math.max(0, Math.floor((prevY - eps) / ts));
    const endRow = Math.min(terrain.rows - 1, Math.floor(body.y / ts));
    for (let r = startRow; r <= endRow; r += 1) {
      const tileTop = r * ts;
      let hitSolid = false;
      let hitPlat = false;
      for (let c = minColY; c <= maxColY; c += 1) {
        const t = getTile(terrain, c, r);
        if (t === 'bedrock' || t === 'brick') {
          hitSolid = true;
        } else if (t === 'platform' && !dropThrough && prevY <= tileTop + 6) {
          hitPlat = true;
        }
      }
      if (hitSolid || hitPlat) {
        body.y = tileTop;
        if (restitution > 0 && Math.abs(body.vy) > 95) {
          body.vy = -Math.abs(body.vy) * restitution;
        } else {
          body.vy = 0;
          body.onGround = true;
          body.onPlatform = !hitSolid && hitPlat;
        }
        landed = true;
        break;
      }
    }
  } else {
    // 向上跃起时只检测实心砖块/基岩天花板，短平台直接穿透
    const headY = body.y - body.height;
    if (headY < 0) {
      body.y = body.height;
      body.vy = 0;
      hitCeiling = true;
    } else {
      const topRow = Math.floor(headY / ts);
      for (let c = minColY; c <= maxColY; c += 1) {
        const t = getTile(terrain, c, topRow);
        if (t === 'bedrock' || t === 'brick') {
          body.y = (topRow + 1) * ts + body.height;
          body.vy = 0;
          hitCeiling = true;
          break;
        }
      }
    }
  }

  // 安全底线兜底（防止高速穿出最底基岩）
  const bedrockTop = (terrain.rows - 1) * ts;
  if (body.y > bedrockTop) {
    body.y = bedrockTop;
    body.vy = 0;
    body.onGround = true;
    body.onPlatform = false;
    landed = true;
  }

  return { hitWall, landed, hitCeiling };
}

/** 检测某点是否命中实心或短平台（用于手枪/火箭弹碰撞） */
export function sampleProjectileTerrainHit(
  terrain: StickmanTerrain,
  x: number,
  y: number
): TerrainTileKind {
  const ts = terrain.tileSize;
  if (x < 0 || x >= terrain.width || y < 0) return 'bedrock';
  const c = Math.floor(x / ts);
  const r = Math.floor(y / ts);
  const tile = getTile(terrain, c, r);
  if (tile === 'bedrock' || tile === 'brick') return tile;
  if (tile === 'platform') {
    // 短平台仅上半部厚 12px 具备实体碰撞，避免弹道穿过平台下方空气误炸
    const localY = y - r * ts;
    if (localY <= 13) return 'platform';
  }
  return 'empty';
}
