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
  TANK_BARREL_LENGTH,
  TANK_RADIUS,
  type TankBattleRules,
  type TankWorldState,
} from '../types';

export interface TankObservation {
  schemaVersion: string;
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
  }>;
  drops: Array<{
    id: number;
    kind: string;
    x: number;
    y: number;
  }>;
  mines: Array<{
    id: number;
    ownerSlotId: string;
    x: number;
    y: number;
    armed: boolean;
  }>;
  maze: {
    cols: number;
    rows: number;
    cellSize: number;
    width: number;
    height: number;
    horizontalWalls: boolean[][];
    verticalWalls: boolean[][];
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
  };
}

export const TANK_AI_SDK_SCHEMA_VERSION = 'tank-battle-ai-v1';

/**
 * 可直接运行并用于参考的最小完整 TypeScript 策略模板（支持直觉转向与经典坦克双模式）。
 */
export const DEFAULT_TANK_BOT_TEMPLATE_CODE = `// 坦克大战自定义 AI 策略模板（支持 TypeScript / JavaScript）
// 导出 createBot(ctx) 或 decide(obs, state) 均可直接被独立 Web Worker 沙箱加载

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

function findNextWaypoint(maze: any, sx: number, sy: number, tx: number, ty: number): Vec2 {
  const cs = maze.cellSize;
  const sc = Math.max(0, Math.min(maze.cols - 1, Math.floor(sx / cs)));
  const sr = Math.max(0, Math.min(maze.rows - 1, Math.floor(sy / cs)));
  const tc = Math.max(0, Math.min(maze.cols - 1, Math.floor(tx / cs)));
  const tr = Math.max(0, Math.min(maze.rows - 1, Math.floor(ty / cs)));
  if (sc === tc && sr === tr) return { x: tx, y: ty };

  const total = maze.cols * maze.rows;
  const start = sr * maze.cols + sc;
  const goal = tr * maze.cols + tc;
  const parent = new Int32Array(total).fill(-1);
  const visited = new Uint8Array(total);
  const queue = [start];
  visited[start] = 1;

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
      if (visited[next]) continue;
      if (hasWallBetweenCells(maze, cc, cr, nc, nr)) continue;
      visited[next] = 1;
      parent[next] = cur;
      queue.push(next);
    }
  }

  if (!visited[goal]) return { x: tx, y: ty };
  let step = goal;
  while (parent[step] !== -1 && parent[step] !== start) {
    step = parent[step];
  }
  return {
    x: (step % maze.cols + 0.5) * cs,
    y: (Math.floor(step / maze.cols) + 0.5) * cs,
  };
}

export function createBot(_ctx: { slotId: string; seed: number; random: () => number }) {
  let fireCooldown = 0;

  return {
    decide(obs: any, _state: Record<string, unknown>, dt: number) {
      const idle = { forward: false, backward: false, turnLeft: false, turnRight: false, fire: false };
      if (obs.phase !== 'playing' || !obs.self || !obs.self.alive) return idle;

      fireCooldown = Math.max(0, fireCooldown - dt);
      const self = obs.self;

      // 1. 寻找距离最近的存活对手
      let target = null;
      let bestDist = Infinity;
      for (const op of obs.opponents) {
        if (!op.alive) continue;
        const d = Math.hypot(op.x - self.x, op.y - self.y);
        if (d < bestDist) {
          bestDist = d;
          target = op;
        }
      }
      if (!target) return idle;

      // 2. 沿迷宫 BFS 寻路前往对手或邻近道具
      const wp = findNextWaypoint(obs.maze, self.x, self.y, target.x, target.y);
      let moveX = wp.x - self.x;
      let moveY = wp.y - self.y;

      // 3. 紧急闪避逼近自身的危险子弹
      for (const p of obs.projectiles) {
        if (p.ownerSlotId === self.slotId && !p.selfDamageUnlocked) continue;
        const rx = self.x - p.x;
        const ry = self.y - p.y;
        const dist = Math.hypot(rx, ry);
        if (dist > 180) continue;
        const speed = Math.hypot(p.vx, p.vy) || 1;
        const approaching = (rx * p.vx + ry * p.vy) / speed;
        if (approaching > 0) {
          // 垂直于弹道方向侧滑闪避
          const nx = -p.vy / speed;
          const ny = p.vx / speed;
          const sign = rx * nx + ry * ny >= 0 ? 1 : -1;
          moveX = nx * sign;
          moveY = ny * sign;
          break;
        }
      }

      // 4. 瞄准与开火判定
      const aimAngle = Math.atan2(target.y - self.y, target.x - self.x);
      const aimErr = Math.abs(normalizeAngle(aimAngle - self.angle));
      const shouldFire =
        fireCooldown <= 0 &&
        self.fireReady &&
        self.ammo > 0 &&
        bestDist < 420 &&
        aimErr < 0.22;

      if (shouldFire) {
        fireCooldown = 0.3;
      }

      // 5. 兼容「直觉转向」与「经典坦克」两种操控模式
      if (obs.controlMode === 'classic') {
        const desired = shouldFire ? aimAngle : Math.atan2(moveY, moveX);
        const diff = normalizeAngle(desired - self.angle);
        return {
          forward: Math.abs(diff) < 1.1,
          backward: false,
          turnLeft: diff < -0.1,
          turnRight: diff > 0.1,
          fire: shouldFire,
        };
      }

      const len = Math.hypot(moveX, moveY) || 1;
      const ux = moveX / len;
      const uy = moveY / len;
      return {
        forward: uy < -0.35,
        backward: uy > 0.35,
        turnLeft: ux < -0.35,
        turnRight: ux > 0.35,
        fire: shouldFire,
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
    })),
    drops: world.drops.map((d) => ({
      id: d.id,
      kind: d.kind,
      x: Number(d.x.toFixed(2)),
      y: Number(d.y.toFixed(2)),
    })),
    mines: world.mines.map((m) => ({
      id: m.id,
      ownerSlotId: m.ownerSlotId,
      x: Number(m.x.toFixed(2)),
      y: Number(m.y.toFixed(2)),
      armed: world.battleTime >= m.armedAtBattleTime,
    })),
    maze: {
      cols: world.maze.cols,
      rows: world.maze.rows,
      cellSize: CELL_SIZE,
      width: world.maze.width,
      height: world.maze.height,
      horizontalWalls: world.maze.horizontalWalls,
      verticalWalls: world.maze.verticalWalls,
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
| 迷宫网格尺寸 | \`${rules.gridCols} × ${rules.gridRows}\` 格 | 每格固定 \`${CELL_SIZE}px\`，总尺寸 \`${rules.gridCols * CELL_SIZE} × ${rules.gridRows * CELL_SIZE}\` |
| 操控模式 | \`${rules.controlMode}\` | \`intuitive\` 为上下左右 8 向自动转向，\`classic\` 为车体前后与左右旋转 |
| 弹夹容量 / 补弹间隔 | \`${rules.magazineCapacity}\` 发 / \`${rules.reloadIntervalSeconds}s\` | 消耗弹药后逐发自动回复 |
| 普通子弹速度 / 存活时长 | \`${rules.normalBulletSpeed} px/s\` / \`${rules.normalBulletLifetimeSeconds}s\` | 撞墙会弹性反射且反弹后可自伤 |
| 坦克速度 / 转向角速度 | \`${rules.tankForwardSpeed} px/s\` / \`${rules.tankTurnSpeedDeg}°/s\` | 机身半径 \`${TANK_RADIUS}px\`，炮管长 \`${TANK_BARREL_LENGTH}px\` |
| 激光最大折射次数 | \`${rules.laserMaxBounces}\` 次 | 瞬发射线，撞墙反射后可命中自身 |
| 破片弹碎片数 / 存活 | \`${rules.fragShardCount}\` 枚 / \`${rules.fragShardLifetimeSeconds}s\` | 母弹定时引爆分裂为可反弹碎片 |
`
    : '';

  return `# 《坦克大战》AI 策略脚本编写规范（${TANK_AI_SDK_SCHEMA_VERSION}）

请扮演一名顶级游戏 AI 算法工程师，为本地 2D 俯视角迷宫对战游戏《坦克大战》编写一个**单文件、自包含、零外部依赖**的 TypeScript 或 JavaScript 策略脚本，代表你参加 1v1 或 2–8 人大乱斗比赛。

---

## 1. 游戏核心玩法与物理规则

1. **场地与坐标系**：
   - 全连通网格迷宫，左上角为 \`(0, 0)\`，\`+X\` 向右，\`+Y\` 向下，角度单位为**弧度**（\`0\` 朝右，\`Math.PI / 2\` 朝下）。
   - 每个迷宫格边长 \`${CELL_SIZE}px\`，坦克碰撞半径 \`${TANK_RADIUS}px\`，炮管长度 \`${TANK_BARREL_LENGTH}px\`。
   - 墙体数据结构：
     - \`maze.horizontalWalls[row][col]\`（\`row: 0..rows\`, \`col: 0..cols-1\`）：为 \`true\` 表示格 \`(col, row-1)\` 与 \`(col, row)\` 之间有横墙。
     - \`maze.verticalWalls[row][col]\`（\`row: 0..rows-1\`, \`col: 0..cols\`）：为 \`true\` 表示格 \`(col-1, row)\` 与 \`(col, row)\` 之间有竖墙。
2. **胜负判定**：
   - 回合制混战（支持 2 至 8 辆坦克）：同帧结算淘汰，**最后唯一存活的坦克得 1 分**；若同刻全灭或超时则平局。先达到目标分者获胜。
3. **弹道与自伤机制（极重要）**：
   - 普通弹、散弹、破片碎片撞墙均会**弹性反射**。
   - **贴墙开火或子弹首次撞墙后立即解锁自伤**（\`selfDamageUnlocked = true\`），切勿贴墙死胡同盲目乱射！
   - 两发普通子弹在空中迎面相撞会互相抵消。
4. **七种战术道具**（独立护盾槽 + 单一进攻槽）：
   - \`shield\`：护盾，抵挡 1 次致命伤害并获得短暂破盾无敌。
   - \`rapid_fire\`：连发机枪；\`shotgun\`：多发散弹；\`laser\`：瞬发多折线激光；\`homing\`：迷宫追踪弹；\`frag\`：定时炸裂破片弹；\`mine\`：隐蔽延时触发地雷（可炸伤自己）。
5. **两种操控模式（必须同时兼容 \`obs.controlMode\`）**：
   - \`intuitive\`（默认推荐）：\`forward\`=屏幕向上(-Y)、\`backward\`=向下(+Y)、\`turnLeft\`=向左(-X)、\`turnRight\`=向右(+X)，坦克会自动沿最短圆弧转向移动方向。
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
  - 每次决策建议控制在 **5ms 以内**（单次超过 **150ms** 将触发防死循环熔断并强杀重启 Worker）。
  - 建议在代码中自行实现：迷宫 BFS 寻路、墙体射线遮挡检测（防贴墙自杀）、弹道预测闪避、1~2 次墙面反弹狙击与多对手目标优先级切换。

---

## 3. 输入观测对象 \`obs\` 结构定义

\`\`\`ts
interface TankObservation {
  schemaVersion: string;
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
  }>;
  drops: Array<{ id: number; kind: string; x: number; y: number }>;
  mines: Array<{ id: number; ownerSlotId: string; x: number; y: number; armed: boolean }>;
  maze: {
    cols: number;
    rows: number;
    cellSize: number;
    width: number;
    height: number;
    horizontalWalls: boolean[][];
    verticalWalls: boolean[][];
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
  };
}
\`\`\`

---

## 4. 最小可运行参考模板

\`\`\`ts
${DEFAULT_TANK_BOT_TEMPLATE_CODE.trim()}
\`\`\`

---

## 5. 输出要求

请直接输出一个**完整的、可直接粘贴运行的 \`\`\`ts 代码块**，不要使用任何外部 \`import\`，并确保同时兼容 \`intuitive\` 与 \`classic\` 操控模式以及 2~8 人的多对手混战场景。
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
