import type {
  ActionInputState,
  BotActionIntent,
  GameAiSdkAdapter,
  InputFrame,
  PlayerSlotId,
  PromptMarkdownOptions,
} from '../../../platform/games/contracts';
import { TankBattleSession } from '../simulation/world';
import {
  CELL_SIZE,
  DROP_PICKUP_RADIUS,
  FRAG_SHARD_RADIUS,
  MINE_VISUAL_RADIUS,
  NORMAL_BULLET_RADIUS,
  SPECIAL_BULLET_RADIUS,
  TANK_BARREL_LENGTH,
  TANK_RADIUS,
  WALL_THICKNESS,
  type TankBattleRules,
  type TankWorldState,
} from '../types';

export interface TankObservation {
  schemaVersion: string;
  /** 扩展观测版本（向后兼容 tank-battle-ai-v1 全量旧字段） */
  schemaExtensionVersion?: string;
  tick: number;
  roundNumber: number;
  phase: TankWorldState['phase'];
  battleTime: number;
  controlMode: TankBattleRules['controlMode'];
  self: {
    slotId: string;
    x: number;
    y: number;
    angle: number;
    alive: boolean;
    ammo: number;
    maxAmmo: number;
    hasShield: boolean;
    offenseKind: string | null;
    fireReady: boolean;
    /** 以下为 v1.1 扩展公开字段 */
    moveHoldTime?: number;
    fireReadyAt?: number;
    shieldRemainingSeconds?: number;
    shieldGraceRemainingSeconds?: number;
    offenseRemainingSeconds?: number;
    rapidFireRemainingShots?: number | null;
  } | null;
  opponents: Array<{
    slotId: string;
    displayName: string;
    x: number;
    y: number;
    angle: number;
    alive: boolean;
    hasShield: boolean;
    offenseKind: string | null;
    shieldRemainingSeconds?: number;
    offenseRemainingSeconds?: number;
    rapidFireRemainingShots?: number | null;
  }>;
  projectiles: Array<{
    id: number;
    ownerSlotId: string;
    source: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
    selfDamageUnlocked: boolean;
    expiresAtBattleTime?: number;
    remainingLifeSeconds?: number;
    detonateAtBattleTime?: number | null;
  }>;
  drops: Array<{
    id: number;
    kind: string;
    x: number;
    y: number;
    expiresAtBattleTime?: number;
    remainingLifeSeconds?: number;
  }>;
  mines: Array<{
    id: number;
    ownerSlotId: string;
    x: number;
    y: number;
    armed: boolean;
    placedAtBattleTime?: number;
    armedAtBattleTime?: number;
    armRemainingSeconds?: number;
  }>;
  maze: {
    cols: number;
    rows: number;
    cellSize: number;
    width: number;
    height: number;
    horizontalWalls: boolean[][];
    verticalWalls: boolean[][];
    wallThickness?: number;
    walls?: Array<{ x1: number; y1: number; x2: number; y2: number; orientation: 'h' | 'v' }>;
  };
  rules: {
    tankRadius: number;
    barrelLength: number;
    tankForwardSpeed: number;
    tankTurnSpeedDeg: number;
    normalBulletSpeed: number;
    normalBulletLifetimeSeconds: number;
    magazineCapacity: number;
    laserMaxBounces: number;
    /** 以下为 v1.1 扩展动态规则字段 */
    tankReverseSpeed?: number;
    reloadIntervalSeconds?: number;
    normalFireCooldownSeconds?: number;
    normalBulletCancelEnabled?: boolean;
    shotgunPellets?: number;
    shotgunAmmoCost?: number;
    shotgunSpreadAngleDeg?: number;
    shotgunBulletLifetimeSeconds?: number;
    rapidFireCooldownSeconds?: number;
    rapidFireMaxShots?: number;
    fragDetonateDelaySeconds?: number;
    fragShardCount?: number;
    fragShardLifetimeSeconds?: number;
    homingBulletSpeed?: number;
    homingTurnRateDeg?: number;
    homingLifetimeSeconds?: number;
    mineArmDelaySeconds?: number;
    mineTriggerRadius?: number;
    mineBlastRadius?: number;
    shieldBreakGraceSeconds?: number;
    normalBulletRadius?: number;
    specialBulletRadius?: number;
    fragShardRadius?: number;
    dropPickupRadius?: number;
    mineVisualRadius?: number;
  };
}

export const TANK_AI_SDK_SCHEMA_VERSION = 'tank-battle-ai-v1';
export const TANK_AI_SDK_EXTENSION_VERSION = 'tank-battle-ai-v1.1';

/**
 * 可直接运行并用于参考的完整 TypeScript 策略模板：
 * - 兼容直觉转向（intuitive）与经典坦克（classic）双模式
 * - 读取 obs.rules 动态参数（不硬编码弹速、散弹夹角、地雷半径等）
 * - 结合宿主提供的公开实体状态与本地几何近似，完成避弹、绕雷、防贴墙/散弹扇区自伤与多目标/道具估值
 */
export const DEFAULT_TANK_BOT_TEMPLATE_CODE = `// 坦克大战自定义 AI 策略模板（支持 TypeScript / JavaScript）
// 导出 createBot(ctx) 或 decide(obs, state, dt) 均可被独立 Web Worker 沙箱（~30Hz 异步）加载

interface Vec2 {
  x: number;
  y: number;
}

function normalizeAngle(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function hasWallBetweenCells(
  maze: any,
  c1: number,
  r1: number,
  c2: number,
  r2: number
): boolean {
  if (c2 === c1 + 1 && r2 === r1) return Boolean(maze.verticalWalls[r1]?.[c2]);
  if (c2 === c1 - 1 && r2 === r1) return Boolean(maze.verticalWalls[r1]?.[c1]);
  if (r2 === r1 + 1 && c2 === c1) return Boolean(maze.horizontalWalls[r2]?.[c1]);
  if (r2 === r1 - 1 && c2 === c1) return Boolean(maze.horizontalWalls[r1]?.[c1]);
  return true;
}

/** 本地几何近似：迷宫网格 BFS 寻路（返回下一航点及路径步数） */
function findPathToTarget(
  maze: any,
  sx: number,
  sy: number,
  tx: number,
  ty: number
): { waypoint: Vec2; steps: number } {
  const cs = maze.cellSize;
  const sc = Math.max(0, Math.min(maze.cols - 1, Math.floor(sx / cs)));
  const sr = Math.max(0, Math.min(maze.rows - 1, Math.floor(sy / cs)));
  const tc = Math.max(0, Math.min(maze.cols - 1, Math.floor(tx / cs)));
  const tr = Math.max(0, Math.min(maze.rows - 1, Math.floor(ty / cs)));
  if (sc === tc && sr === tr) return { waypoint: { x: tx, y: ty }, steps: 0 };

  const total = maze.cols * maze.rows;
  const start = sr * maze.cols + sc;
  const goal = tr * maze.cols + tc;
  const parent = new Int32Array(total).fill(-1);
  const dist = new Int32Array(total).fill(-1);
  const queue = [start];
  dist[start] = 0;

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    if (cur === goal) break;
    const cc = cur % maze.cols;
    const cr = Math.floor(cur / maze.cols);
    for (const [dc, dr] of dirs) {
      const nc = cc + dc;
      const nr = cr + dr;
      if (nc < 0 || nc >= maze.cols || nr < 0 || nr >= maze.rows) continue;
      const next = nr * maze.cols + nc;
      if (dist[next] !== -1) continue;
      if (hasWallBetweenCells(maze, cc, cr, nc, nr)) continue;
      dist[next] = dist[cur] + 1;
      parent[next] = cur;
      queue.push(next);
    }
  }

  if (dist[goal] === -1) return { waypoint: { x: tx, y: ty }, steps: 99 };
  let step = goal;
  while (parent[step] !== -1 && parent[step] !== start) {
    step = parent[step];
  }
  return {
    waypoint: {
      x: (step % maze.cols + 0.5) * cs,
      y: (Math.floor(step / maze.cols) + 0.5) * cs,
    },
    steps: dist[goal],
  };
}

/** 本地几何近似：带墙半厚的轴对齐线段射线检测，用于判断贴墙自伤与隔墙遮挡 */
function castWallRay(
  maze: any,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
  pad: number
): { dist: number; nx: number; ny: number } | null {
  const walls = maze.walls;
  if (!Array.isArray(walls) || walls.length === 0) {
    return null;
  }
  let best = maxDist;
  let bestNx = 0;
  let bestNy = 0;
  let hit = false;

  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    if (w.orientation === 'h') {
      if (Math.abs(dy) < 1e-6) continue;
      const hitY = dy > 0 ? w.y1 - pad : w.y1 + pad;
      const t = (hitY - oy) / dy;
      if (t <= 0.5 || t > best) continue;
      const hx = ox + dx * t;
      if (hx >= Math.min(w.x1, w.x2) - pad && hx <= Math.max(w.x1, w.x2) + pad) {
        best = t;
        bestNx = 0;
        bestNy = dy > 0 ? -1 : 1;
        hit = true;
      }
    } else {
      if (Math.abs(dx) < 1e-6) continue;
      const hitX = dx > 0 ? w.x1 - pad : w.x1 + pad;
      const t = (hitX - ox) / dx;
      if (t <= 0.5 || t > best) continue;
      const hy = oy + dy * t;
      if (hy >= Math.min(w.y1, w.y2) - pad && hy <= Math.max(w.y1, w.y2) + pad) {
        best = t;
        bestNx = dx > 0 ? -1 : 1;
        bestNy = 0;
        hit = true;
      }
    }
  }
  return hit ? { dist: best, nx: bestNx, ny: bestNy } : null;
}

/** 检查从当前位置沿指定角度开火是否安全（覆盖贴墙反射自伤与散弹全扇区角度） */
function isShotDirectionSafe(obs: any, aimAngle: number): boolean {
  const self = obs.self;
  const rules = obs.rules;
  const wallHalf = (obs.maze.wallThickness ?? 10) * 0.5;
  const bulletPad = wallHalf + (rules.normalBulletRadius ?? 5);
  const muzzleLen = rules.barrelLength ?? 28;
  const isShotgun = self.offenseKind === 'shotgun';
  const pellets = isShotgun ? Math.max(2, rules.shotgunPellets ?? 3) : 1;
  const spreadRad = isShotgun ? ((rules.shotgunSpreadAngleDeg ?? 30) * Math.PI) / 180 : 0;

  for (let i = 0; i < pellets; i++) {
    const frac = pellets === 1 ? 0 : i / (pellets - 1) - 0.5;
    const ang = aimAngle + frac * spreadRad;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    // 炮管长度内撞墙会立即反弹并解锁自伤
    const hit = castWallRay(obs.maze, self.x, self.y, dx, dy, muzzleLen + 14, bulletPad);
    if (hit) return false;
  }
  return true;
}

export function createBot(_ctx: { slotId: string; seed: number; random: () => number }) {
  let prevFireHeld = false;

  return {
    decide(obs: any, _state: Record<string, unknown>, _dt: number) {
      const idle = { forward: false, backward: false, turnLeft: false, turnRight: false, fire: false };
      if (obs.phase !== 'playing' || !obs.self || !obs.self.alive) {
        prevFireHeld = false;
        return idle;
      }

      const self = obs.self;
      const rules = obs.rules;
      const wallHalf = (obs.maze.wallThickness ?? 10) * 0.5;
      const tankPad = wallHalf + (rules.tankRadius ?? 19);

      // 1. 多目标估值：结合迷宫步数、直视视线、对方护盾与距离选出最佳目标
      let target: any = null;
      let bestTargetScore = -Infinity;
      let targetPath = { waypoint: { x: self.x, y: self.y }, steps: 99 };

      for (const op of obs.opponents) {
        if (!op.alive) continue;
        const d = Math.hypot(op.x - self.x, op.y - self.y);
        const p = findPathToTarget(obs.maze, self.x, self.y, op.x, op.y);
        const los = !castWallRay(
          obs.maze,
          self.x,
          self.y,
          (op.x - self.x) / Math.max(1, d),
          (op.y - self.y) / Math.max(1, d),
          d - 4,
          wallHalf + 3
        );
        const score = (los ? 160 : 0) + (op.hasShield ? 0 : 45) - p.steps * 28 - d * 0.25;
        if (score > bestTargetScore) {
          bestTargetScore = score;
          target = op;
          targetPath = p;
        }
      }
      if (!target) {
        prevFireHeld = false;
        return idle;
      }

      // 2. 道具估值（利用宿主提供的剩余寿命，优先抢护盾与高价值武器）
      let goalWaypoint = targetPath.waypoint;
      if (Array.isArray(obs.drops) && obs.drops.length > 0) {
        const dropPriority: Record<string, number> = {
          laser: 98,
          shield: self.hasShield ? 10 : 102,
          shotgun: 90,
          frag: 86,
          homing: 82,
          rapid_fire: 75,
          mine: 50,
        };
        let bestDropScore = 25;
        for (const drop of obs.drops) {
          const p = findPathToTarget(obs.maze, self.x, self.y, drop.x, drop.y);
          const estTime = (p.steps * obs.maze.cellSize) / Math.max(80, rules.tankForwardSpeed);
          if (drop.remainingLifeSeconds !== undefined && estTime + 0.3 > drop.remainingLifeSeconds) {
            continue;
          }
          const score = (dropPriority[drop.kind] ?? 50) - p.steps * 18;
          if (score > bestDropScore) {
            bestDropScore = score;
            goalWaypoint = p.waypoint;
          }
        }
      }

      let moveX = goalWaypoint.x - self.x;
      let moveY = goalWaypoint.y - self.y;

      // 3. 本地避险：躲避已解锁/他人的来袭弹体（仅在无墙遮挡时侧滑，并避开贴墙侧）
      let dodging = false;
      for (const p of obs.projectiles) {
        if (p.ownerSlotId === self.slotId && !p.selfDamageUnlocked) continue;
        const rx = self.x - p.x;
        const ry = self.y - p.y;
        const dist = Math.hypot(rx, ry);
        if (dist > 230) continue;
        const speed = Math.hypot(p.vx, p.vy) || 1;
        const ux = p.vx / speed;
        const uy = p.vy / speed;
        const forwardProj = rx * ux + ry * uy;
        if (forwardProj < -10) continue;
        const perpDist = Math.abs(rx * -uy + ry * ux);
        if (perpDist > (rules.tankRadius ?? 19) + p.radius + 22) continue;
        if (castWallRay(obs.maze, p.x, p.y, rx / Math.max(1, dist), ry / Math.max(1, dist), dist - 4, wallHalf + 2)) {
          continue;
        }
        const sideSign = rx * -uy + ry * ux >= 0 ? 1 : -1;
        let ex = -uy * sideSign;
        let ey = ux * sideSign;
        if (castWallRay(obs.maze, self.x, self.y, ex, ey, 42, tankPad)) {
          ex = -ex;
          ey = -ey;
        }
        moveX = ex;
        moveY = ey;
        dodging = true;
        break;
      }

      // 4. 地雷安全审查（含自己布下的地雷：进入爆炸范围且无墙遮挡时立即避让）
      const mineAvoidR = (rules.mineBlastRadius ?? 76) + (rules.tankRadius ?? 19) + 12;
      for (const m of obs.mines) {
        const dx = self.x - m.x;
        const dy = self.y - m.y;
        const d = Math.hypot(dx, dy);
        if (d < mineAvoidR && d > 1) {
          const occluded = castWallRay(obs.maze, m.x, m.y, dx / d, dy / d, d - 2, wallHalf + 2);
          if (!occluded) {
            moveX = dx / d;
            moveY = dy / d;
            dodging = true;
            break;
          }
        }
      }

      // 5. 开火决策：遵守单发上升沿约束、散弹最低弹药以及全扇区/贴墙安全检查
      const targetDist = Math.hypot(target.x - self.x, target.y - self.y);
      const directAim = Math.atan2(target.y - self.y, target.x - self.x);
      const aimErr = Math.abs(normalizeAngle(directAim - self.angle));
      const isRapid = self.offenseKind === 'rapid_fire';
      const hasEnoughAmmo =
        self.offenseKind === 'laser' ||
        self.offenseKind === 'homing' ||
        self.offenseKind === 'frag' ||
        self.offenseKind === 'mine' ||
        (self.offenseKind === 'shotgun'
          ? self.ammo >= (rules.shotgunAmmoCost ?? 2)
          : self.ammo >= 1);
      const edgeValid = isRapid || !prevFireHeld;
      const losToTarget = !castWallRay(
        obs.maze,
        self.x,
        self.y,
        Math.cos(directAim),
        Math.sin(directAim),
        targetDist - 4,
        wallHalf + 3
      );

      let wantsFire = false;
      if (self.fireReady && hasEnoughAmmo && edgeValid && self.offenseKind !== 'mine') {
        if (losToTarget && aimErr < 0.18 && isShotDirectionSafe(obs, self.angle)) {
          wantsFire = true;
        }
      }

      prevFireHeld = wantsFire;

      // 6. 兼容「经典模式（进退+旋转）」与「直觉模式（屏幕 8 向）」
      if (obs.controlMode === 'classic') {
        const desired = !dodging && losToTarget ? directAim : Math.atan2(moveY, moveX);
        const diff = normalizeAngle(desired - self.angle);
        return {
          forward: Math.abs(diff) < 1.05,
          backward: false,
          turnLeft: diff < -0.09,
          turnRight: diff > 0.09,
          fire: wantsFire,
        };
      }

      // 直觉模式：不急避时若瞄准偏差较大且接近射程，可优先朝开火角度平滑偏转
      let vecX = moveX;
      let vecY = moveY;
      if (!dodging && losToTarget && aimErr > 0.14) {
        vecX = Math.cos(directAim);
        vecY = Math.sin(directAim);
      }
      const len = Math.hypot(vecX, vecY) || 1;
      const ux = vecX / len;
      const uy = vecY / len;
      return {
        forward: uy < -0.38,
        backward: uy > 0.38,
        turnLeft: ux < -0.38,
        turnRight: ux > 0.38,
        fire: wantsFire,
      };
    },
  };
}
`;

export function buildTankObservation(
  world: TankWorldState,
  selfSlotId: PlayerSlotId,
  tick: number
): TankObservation {
  const selfTank = world.tanks.find((t) => t.slotId === selfSlotId) ?? null;

  return {
    schemaVersion: TANK_AI_SDK_SCHEMA_VERSION,
    schemaExtensionVersion: TANK_AI_SDK_EXTENSION_VERSION,
    tick,
    roundNumber: world.roundNumber,
    phase: world.phase,
    battleTime: Number(world.battleTime.toFixed(3)),
    controlMode: world.rules.controlMode,
    self: selfTank
      ? {
          slotId: selfTank.slotId,
          x: Number(selfTank.x.toFixed(2)),
          y: Number(selfTank.y.toFixed(2)),
          angle: Number(selfTank.angle.toFixed(4)),
          alive: selfTank.alive,
          ammo: selfTank.ammo,
          maxAmmo: selfTank.maxAmmo,
          hasShield: Boolean(selfTank.shield),
          offenseKind: selfTank.offense?.kind ?? null,
          fireReady: world.battleTime + 1e-6 >= selfTank.fireReadyAt,
          moveHoldTime: Number(selfTank.moveHoldTime.toFixed(3)),
          fireReadyAt: Number(selfTank.fireReadyAt.toFixed(3)),
          shieldRemainingSeconds: selfTank.shield
            ? Number(Math.max(0, selfTank.shield.expiresAtBattleTime - world.battleTime).toFixed(3))
            : 0,
          shieldGraceRemainingSeconds: Number(
            Math.max(0, selfTank.shieldGraceUntil - world.battleTime).toFixed(3)
          ),
          offenseRemainingSeconds: selfTank.offense
            ? Number(Math.max(0, selfTank.offense.expiresAtBattleTime - world.battleTime).toFixed(3))
            : 0,
          rapidFireRemainingShots:
            selfTank.offense?.kind === 'rapid_fire' ? selfTank.offense.remainingShots : null,
        }
      : null,
    opponents: world.tanks
      .filter((t) => t.slotId !== selfSlotId)
      .map((t) => ({
        slotId: t.slotId,
        displayName: t.displayName,
        x: Number(t.x.toFixed(2)),
        y: Number(t.y.toFixed(2)),
        angle: Number(t.angle.toFixed(4)),
        alive: t.alive,
        hasShield: Boolean(t.shield),
        offenseKind: t.offense?.kind ?? null,
        shieldRemainingSeconds: t.shield
          ? Number(Math.max(0, t.shield.expiresAtBattleTime - world.battleTime).toFixed(3))
          : 0,
        offenseRemainingSeconds: t.offense
          ? Number(Math.max(0, t.offense.expiresAtBattleTime - world.battleTime).toFixed(3))
          : 0,
        rapidFireRemainingShots:
          t.offense?.kind === 'rapid_fire' ? t.offense.remainingShots : null,
      })),
    projectiles: world.projectiles.map((p) => ({
      id: p.id,
      ownerSlotId: p.ownerSlotId,
      source: p.source,
      x: Number(p.x.toFixed(2)),
      y: Number(p.y.toFixed(2)),
      vx: Number(p.vx.toFixed(2)),
      vy: Number(p.vy.toFixed(2)),
      radius: p.radius,
      selfDamageUnlocked: p.selfDamageUnlocked,
      expiresAtBattleTime: Number(p.expiresAtBattleTime.toFixed(3)),
      remainingLifeSeconds: Number(Math.max(0, p.expiresAtBattleTime - world.battleTime).toFixed(3)),
      detonateAtBattleTime:
        p.detonateAtBattleTime !== undefined
          ? Number(p.detonateAtBattleTime.toFixed(3))
          : null,
    })),
    drops: world.drops.map((d) => ({
      id: d.id,
      kind: d.kind,
      x: Number(d.x.toFixed(2)),
      y: Number(d.y.toFixed(2)),
      expiresAtBattleTime: Number(d.expiresAtBattleTime.toFixed(3)),
      remainingLifeSeconds: Number(Math.max(0, d.expiresAtBattleTime - world.battleTime).toFixed(3)),
    })),
    mines: world.mines.map((m) => ({
      id: m.id,
      ownerSlotId: m.ownerSlotId,
      x: Number(m.x.toFixed(2)),
      y: Number(m.y.toFixed(2)),
      armed: world.battleTime >= m.armedAtBattleTime,
      placedAtBattleTime: Number(m.placedAtBattleTime.toFixed(3)),
      armedAtBattleTime: Number(m.armedAtBattleTime.toFixed(3)),
      armRemainingSeconds: Number(Math.max(0, m.armedAtBattleTime - world.battleTime).toFixed(3)),
    })),
    maze: {
      cols: world.maze.cols,
      rows: world.maze.rows,
      cellSize: CELL_SIZE,
      width: world.maze.width,
      height: world.maze.height,
      horizontalWalls: world.maze.horizontalWalls,
      verticalWalls: world.maze.verticalWalls,
      wallThickness: WALL_THICKNESS,
      walls: world.maze.walls,
    },
    rules: {
      tankRadius: TANK_RADIUS,
      barrelLength: TANK_BARREL_LENGTH,
      tankForwardSpeed: world.rules.tankForwardSpeed,
      tankTurnSpeedDeg: world.rules.tankTurnSpeedDeg,
      normalBulletSpeed: world.rules.normalBulletSpeed,
      normalBulletLifetimeSeconds: world.rules.normalBulletLifetimeSeconds,
      magazineCapacity: world.rules.magazineCapacity,
      laserMaxBounces: world.rules.laserMaxBounces,
      tankReverseSpeed: world.rules.tankReverseSpeed,
      reloadIntervalSeconds: world.rules.reloadIntervalSeconds,
      normalFireCooldownSeconds: world.rules.normalFireCooldownSeconds,
      normalBulletCancelEnabled: world.rules.normalBulletCancelEnabled,
      shotgunPellets: world.rules.shotgunPellets,
      shotgunAmmoCost: world.rules.shotgunAmmoCost,
      shotgunSpreadAngleDeg: world.rules.shotgunSpreadAngleDeg,
      shotgunBulletLifetimeSeconds: world.rules.shotgunBulletLifetimeSeconds,
      rapidFireCooldownSeconds: world.rules.rapidFireCooldownSeconds,
      rapidFireMaxShots: world.rules.rapidFireMaxShots,
      fragDetonateDelaySeconds: world.rules.fragDetonateDelaySeconds,
      fragShardCount: world.rules.fragShardCount,
      fragShardLifetimeSeconds: world.rules.fragShardLifetimeSeconds,
      homingBulletSpeed: world.rules.homingBulletSpeed,
      homingTurnRateDeg: world.rules.homingTurnRateDeg,
      homingLifetimeSeconds: world.rules.homingLifetimeSeconds,
      mineArmDelaySeconds: world.rules.mineArmDelaySeconds,
      mineTriggerRadius: world.rules.mineTriggerRadius,
      mineBlastRadius: world.rules.mineBlastRadius,
      shieldBreakGraceSeconds: world.rules.shieldBreakGraceSeconds,
      normalBulletRadius: NORMAL_BULLET_RADIUS,
      specialBulletRadius: SPECIAL_BULLET_RADIUS,
      fragShardRadius: FRAG_SHARD_RADIUS,
      dropPickupRadius: DROP_PICKUP_RADIUS,
      mineVisualRadius: MINE_VISUAL_RADIUS,
    },
  };
}

export function buildTankBattlePromptMarkdown(
  rules: TankBattleRules,
  options: PromptMarkdownOptions
): string {
  const rulesSnapshotSection = options.includeCurrentRules
    ? `
## 当前对局规则参数（已附带）

| 参数项 | 当前数值 | 说明 |
| --- | --- | --- |
| 获胜目标分 | \`${rules.targetScore}\` 分 | 先达到该分数赢得整场比赛 |
| 迷宫网格尺寸 | \`${rules.gridCols} × ${rules.gridRows}\` 格 | 每格 \`${CELL_SIZE}px\`，总尺寸 \`${rules.gridCols * CELL_SIZE} × ${rules.gridRows * CELL_SIZE}\`，墙厚 \`${WALL_THICKNESS}px\` |
| 操控模式 | \`${rules.controlMode}\` | \`intuitive\` 为上下左右 8 向自动转向（0.09s 轻点微调），\`classic\` 为车体进退与左右旋转 |
| 弹夹 / 补弹 / 射击冷却 | \`${rules.magazineCapacity}\` 发 / \`${rules.reloadIntervalSeconds}s\` / \`${rules.normalFireCooldownSeconds}s\` | 消耗弹药后逐发自动回复，单发须按下上升沿 |
| 普通弹速 / 寿命 / 抵消 | \`${rules.normalBulletSpeed} px/s\` / \`${rules.normalBulletLifetimeSeconds}s\` / \`${rules.normalBulletCancelEnabled ? '开启' : '关闭'}\` | 撞墙弹性反射且反弹后可自伤 |
| 坦克前速 / 倒速 / 转速 | \`${rules.tankForwardSpeed}\` / \`${rules.tankReverseSpeed} px/s\` / \`${rules.tankTurnSpeedDeg}°/s\` | 机身半径 \`${TANK_RADIUS}px\`，炮管长 \`${TANK_BARREL_LENGTH}px\` |
| 三连发（散弹枪） | \`${rules.shotgunPellets}\` 颗 / 耗 \`${rules.shotgunAmmoCost}\` 发 / 张角 \`${rules.shotgunSpreadAngleDeg}°\` | 弹丸寿命 \`${rules.shotgunBulletLifetimeSeconds}s\`，余弹不足整次不发 |
| 连发机枪 | 冷却 \`${rules.rapidFireCooldownSeconds}s\` / 上限 \`${rules.rapidFireMaxShots}\` 发 / \`${rules.rapidFireDurationSeconds}s\` | 按住 \`fire\` 连续击发，无需松键 |
| 激光 / 追踪弹 | 激光 \`${rules.laserMaxBounces}\` 次折射 / 追踪 \`${rules.homingBulletSpeed} px/s\` (\`${rules.homingTurnRateDeg}°/s\`) | 激光瞬发全折线可自伤；追踪弹按迷宫通道寻敌 |
| 破片弹 / 地雷 | \`${rules.fragShardCount}\` 枚碎片(\`${rules.fragShardLifetimeSeconds}s\`) / 地雷布防 \`${rules.mineArmDelaySeconds}s\` | 地雷触发 \`${rules.mineTriggerRadius}px\`、爆炸 \`${rules.mineBlastRadius}px\`（隔墙安全） |
`
    : '';

  return `# 《坦克大战》AI 策略脚本编写规范（${TANK_AI_SDK_SCHEMA_VERSION} / ${TANK_AI_SDK_EXTENSION_VERSION}）

请扮演一名顶级游戏 AI 算法工程师，为本地 2D 俯视角迷宫对战游戏《坦克大战》编写一个**单文件、自包含、零外部依赖**的 TypeScript 或 JavaScript 策略脚本，代表你参加 1v1 或 2–8 人大乱斗比赛。

---

## 1. 游戏核心玩法、时钟与物理规则

1. **场地与坐标系**：
   - 全连通网格迷宫，左上角为 \`(0, 0)\`，\`+X\` 向右，\`+Y\` 向下，角度单位为**弧度**（\`0\` 朝右，\`Math.PI / 2\` 朝下）。
   - 每格边长 \`${CELL_SIZE}px\`，墙体厚度 \`${WALL_THICKNESS}px\`（半厚 \`${WALL_THICKNESS / 2}px\`），坦克碰撞半径 \`${TANK_RADIUS}px\`，炮管长度 \`${TANK_BARREL_LENGTH}px\`。
   - 墙体与网格：\`maze.horizontalWalls\`、\`maze.verticalWalls\` 以及已合并连续段 \`maze.walls\` 均由宿主提供，作射线检测时务必加上 \`wallThickness / 2 + 弹丸半径\` 的碰撞裕量。
2. **胜负判定**：
   - 回合制混战（支持 2 至 8 辆坦克）：同帧结算淘汰，**最后唯一存活的坦克得 1 分**；若同刻全灭或超时则平局。
3. **弹道、时间基准与自伤机制（极重要）**：
   - **世界模拟 60Hz 推进，但自定义 Worker 约 30Hz（每 2 步）异步派发观测**，主循环读取最近一次回传的动作意图。因此**单发武器（除连发 \`rapid_fire\` 外）在一次开火后必须在下一次决策将 \`fire\` 置回 \`false\`，才能产生下一个 \`justPressed\` 上升沿**！
   - 战斗时间基准为 \`obs.battleTime\`（秒，仅在 \`phase === 'playing'\` 推进）。
   - **贴墙开火（炮口 \`barrelLength\` 内遇墙）或子弹首次撞墙、离开发射者机身后立即解锁自伤**（\`selfDamageUnlocked = true\`）。
   - **散弹枪**必须审查扇区 \`shotgunSpreadAngleDeg\` 内的**每一颗弹丸**，任意一颗贴墙回弹自伤都应拒火。
   - **普通子弹抵消**：当 \`obs.rules.normalBulletCancelEnabled\` 为 \`true\` 且双方均是 \`source === 'normal'\` 时，迎面碰撞会互相抵消；道具弹与普通弹互不影响。
4. **七种战术道具**（护盾槽 + 单一进攻槽可并存，新进攻道具直接替换旧进攻槽）：
   - \`shield\`：护盾，抵挡 1 次有效伤害并触发 \`shieldBreakGraceSeconds\` 保护期。
   - \`rapid_fire\`：连发机枪（\`fire: true\` 持续按住即可按 \`rapidFireCooldownSeconds\` 连射）。
   - \`shotgun\`：三连发散弹（整次扣 \`shotgunAmmoCost\` 发，不足时不发）。
   - \`laser\`：瞬发多折线激光（最多 \`laserMaxBounces\` 次反射，首段免疫自身，反射后可自伤）。
   - \`homing\`：迷宫通道追踪弹（受 \`homingTurnRateDeg\` 限制，绕回路径时也可能撞上发射者）。
   - \`frag\`：定时分裂破片弹（\`detonateAtBattleTime\` 爆出 \`fragShardCount\` 枚可反弹自伤碎片）。
   - \`mine\`：车尾布防地雷（\`mineArmDelaySeconds\` 后激活，对包括放置者在内的无遮挡坦克生效；隔墙不触发不伤害）。
5. **两种操控模式（必须同时兼容 \`obs.controlMode\`）**：
   - \`intuitive\`：\`forward\`=屏幕向上(-Y)、\`backward\`=向下(+Y)、\`turnLeft\`=向左(-X)、\`turnRight\`=向右(+X)，坦克自动沿最短圆弧转向目标方向；按住初期 \`0.09s\` 轻点可微调炮口且位移极小。
   - \`classic\`：\`forward\`=沿车头前进、\`backward\`=倒车、\`turnLeft\`=逆时针转、\`turnRight\`=顺时针转。
${rulesSnapshotSection}
---

## 2. 编码契约与沙箱安全限制

- **导出入口（任选其一）**：
  - 推荐：\`export function createBot(ctx: { slotId: string; seed: number; random: () => number }) { return { decide(obs, state, dt) { ... } }; }\`
  - 或直接：\`export function decide(obs, state, dt) { ... }\`
- **返回值格式（动作布尔映射）**：
  \`\`\`ts
  interface BotActionIntent {
    forward: boolean;
    backward: boolean;
    turnLeft: boolean;
    turnRight: boolean;
    fire: boolean;
  }
  \`\`\`
- **运行环境与性能预算**：
  - 脚本运行在**隔离的 Web Worker 沙箱**中（无 DOM、无 \`window\`、禁用 \`fetch\` / \`WebSocket\` / \`importScripts\` / 外部 \`import\`）。
  - 单次决策建议控制在 **5ms 以内**（单次超过 **150ms** 将触发熔断强杀并冷却重启 Worker）。
  - 脚本只能读取当前公开场态 \`obs\`（无权读取未来掉落、随机种子流或对手输入），建议自行实现：迷宫路径规划、墙体射线遮挡（防贴墙/散弹/己雷自杀）、来袭弹道侧滑避让、1~2 次墙面反弹狙击与多目标/道具估值。

---

## 3. 输入观测对象 \`obs\` 结构定义

\`\`\`ts
interface TankObservation {
  schemaVersion: string;          // 'tank-battle-ai-v1'
  schemaExtensionVersion?: string;// 'tank-battle-ai-v1.1'
  tick: number;
  roundNumber: number;
  phase: 'countdown' | 'playing' | 'round_over' | 'match_over';
  battleTime: number;
  controlMode: 'intuitive' | 'classic';
  self: {
    slotId: string;
    x: number;
    y: number;
    angle: number;
    alive: boolean;
    ammo: number;
    maxAmmo: number;
    hasShield: boolean;
    offenseKind: string | null;
    fireReady: boolean;
    moveHoldTime?: number;
    fireReadyAt?: number;
    shieldRemainingSeconds?: number;
    shieldGraceRemainingSeconds?: number;
    offenseRemainingSeconds?: number;
    rapidFireRemainingShots?: number | null;
  } | null;
  opponents: Array<{
    slotId: string;
    displayName: string;
    x: number;
    y: number;
    angle: number;
    alive: boolean;
    hasShield: boolean;
    offenseKind: string | null;
    shieldRemainingSeconds?: number;
    offenseRemainingSeconds?: number;
    rapidFireRemainingShots?: number | null;
  }>;
  projectiles: Array<{
    id: number;
    ownerSlotId: string;
    source: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
    selfDamageUnlocked: boolean;
    expiresAtBattleTime?: number;
    remainingLifeSeconds?: number;
    detonateAtBattleTime?: number | null;
  }>;
  drops: Array<{
    id: number;
    kind: string;
    x: number;
    y: number;
    expiresAtBattleTime?: number;
    remainingLifeSeconds?: number;
  }>;
  mines: Array<{
    id: number;
    ownerSlotId: string;
    x: number;
    y: number;
    armed: boolean;
    placedAtBattleTime?: number;
    armedAtBattleTime?: number;
    armRemainingSeconds?: number;
  }>;
  maze: {
    cols: number;
    rows: number;
    cellSize: number;
    width: number;
    height: number;
    horizontalWalls: boolean[][];
    verticalWalls: boolean[][];
    wallThickness?: number;
    walls?: Array<{ x1: number; y1: number; x2: number; y2: number; orientation: 'h' | 'v' }>;
  };
  rules: {
    tankRadius: number;
    barrelLength: number;
    tankForwardSpeed: number;
    tankTurnSpeedDeg: number;
    normalBulletSpeed: number;
    normalBulletLifetimeSeconds: number;
    magazineCapacity: number;
    laserMaxBounces: number;
    tankReverseSpeed?: number;
    reloadIntervalSeconds?: number;
    normalFireCooldownSeconds?: number;
    normalBulletCancelEnabled?: boolean;
    shotgunPellets?: number;
    shotgunAmmoCost?: number;
    shotgunSpreadAngleDeg?: number;
    shotgunBulletLifetimeSeconds?: number;
    rapidFireCooldownSeconds?: number;
    rapidFireMaxShots?: number;
    fragDetonateDelaySeconds?: number;
    fragShardCount?: number;
    fragShardLifetimeSeconds?: number;
    homingBulletSpeed?: number;
    homingTurnRateDeg?: number;
    homingLifetimeSeconds?: number;
    mineArmDelaySeconds?: number;
    mineTriggerRadius?: number;
    mineBlastRadius?: number;
    shieldBreakGraceSeconds?: number;
    normalBulletRadius?: number;
    specialBulletRadius?: number;
    fragShardRadius?: number;
    dropPickupRadius?: number;
    mineVisualRadius?: number;
  };
}
\`\`\`

---

## 4. 完整可运行参考模板

\`\`\`ts
${DEFAULT_TANK_BOT_TEMPLATE_CODE.trim()}
\`\`\`

---

## 5. 输出要求

请直接输出一个**完整的、可直接粘贴运行的 \`\`\`ts 代码块**，不要使用任何外部 \`import\`，并确保同时兼容 \`intuitive\` 与 \`classic\` 操控模式、单发按键上升沿以及 2~8 人的多对手混战场景。
`;
}

const IDLE_STATE: ActionInputState = {
  held: false,
  justPressed: false,
  justReleased: false,
};

export const tankBattleAiSdk: GameAiSdkAdapter<
  TankBattleRules,
  TankWorldState,
  TankObservation
> = {
  schemaVersion: TANK_AI_SDK_SCHEMA_VERSION,
  buildPromptMarkdown: buildTankBattlePromptMarkdown,
  defaultTemplateCode: DEFAULT_TANK_BOT_TEMPLATE_CODE,
  buildObservation: buildTankObservation,
  createDryRunWorld(rules, seed) {
    const dryRules: TankBattleRules = {
      ...rules,
      countdownSeconds: 0,
      targetScore: 5,
    };
    const session = new TankBattleSession({
      gameId: 'tank-battle',
      rulesVersion: 1,
      rules: dryRules,
      sessionSeed: seed,
      players: [
        {
          slotId: 'p1',
          rawName: 'TESTBOT',
          displayName: 'TESTBOT',
          colorHex: '#D9432B',
          bindings: {},
          controller: 'ai',
        },
        {
          slotId: 'p2',
          rawName: 'DUMMY',
          displayName: 'DUMMY',
          colorHex: '#2364C7',
          bindings: {},
          controller: 'ai',
        },
      ],
    });

    let prevHeld: Record<string, boolean> = {};

    return {
      world: session.getWorldState(),
      selfSlotId: 'p1',
      stepWorld(intent: BotActionIntent, dtSeconds: number) {
        const slotStates: Record<string, ActionInputState> = {};
        const nextHeld: Record<string, boolean> = {};
        const keys = new Set<string>([...Object.keys(prevHeld), ...Object.keys(intent)]);
        for (const k of keys) {
          const held = Boolean(intent[k]);
          const wasHeld = Boolean(prevHeld[k]);
          if (held) nextHeld[k] = true;
          slotStates[k] = {
            held,
            justPressed: held && !wasHeld,
            justReleased: !held && wasHeld,
          };
        }
        prevHeld = nextHeld;

        const frame: InputFrame = {
          getAction(slotId, actionId) {
            if (slotId === 'p1') {
              return slotStates[actionId] ?? IDLE_STATE;
            }
            return IDLE_STATE;
          },
        };
        session.step(dtSeconds, frame);
      },
    };
  },
};
