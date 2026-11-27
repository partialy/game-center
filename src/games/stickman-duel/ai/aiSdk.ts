import type {
  ActionInputState,
  BotActionIntent,
  GameAiSdkAdapter,
  InputFrame,
  PlayerSlotId,
  PromptMarkdownOptions,
} from '../../../platform/games/contracts';
import { StickmanDuelSession } from '../simulation/world';
import type { StickmanDuelRules, StickmanWorld, TerrainTileKind } from '../types';

export interface StickmanObservation {
  schemaVersion: string;
  tick: number;
  roundNumber: number;
  phase: StickmanWorld['phase'];
  battleTime: number;
  self: {
    slotId: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    facing: -1 | 1;
    hp: number;
    maxHp: number;
    alive: boolean;
    onGround: boolean;
    onPlatform: boolean;
    jumpsUsed: number;
    maxJumps: number;
    weapon: { kind: 'sword' | 'pistol' | 'shotgun' | 'rocket'; remaining: number; max: number } | null;
    nearbyDropId: number | null;
  } | null;
  opponents: Array<{
    slotId: string;
    displayName: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    facing: -1 | 1;
    hp: number;
    maxHp: number;
    alive: boolean;
    weaponKind: string | null;
  }>;
  pickups: Array<{
    id: number;
    kind: 'sword' | 'pistol' | 'shotgun' | 'rocket' | 'medkit';
    remaining: number;
    max: number;
    x: number;
    y: number;
    onGround: boolean;
  }>;
  projectiles: Array<{
    id: number;
    kind: 'pistol' | 'shotgun' | 'rocket';
    ownerSlotId: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    gravityScale: number;
  }>;
  terrain: {
    cols: number;
    rows: number;
    tileSize: number;
    width: number;
    height: number;
    /** 按行压缩字符图：'.'=空, '#'=基岩(不可破坏), 'B'=砖块(可炸毁), '='=单向短平台(可炸毁) */
    grid: string[];
  };
  rules: {
    maxHp: number;
    moveSpeed: number;
    jumpVelocity: number;
    gravity: number;
    punchDamage: number;
    kickDamage: number;
    swordDamage: number;
    pistolDamage: number;
    pistolSpeed: number;
    shotgunPellets: number;
    shotgunSpreadAngleDeg: number;
    shotgunDamage: number;
    shotgunSpeed: number;
    rocketDamage: number;
    rocketSpeed: number;
    rocketGravity: number;
    rocketBlastRadius: number;
    medkitHealPercent: number;
  };
}

export const STICKMAN_AI_SDK_SCHEMA_VERSION = 'stickman-duel-ai-v1';

const TILE_CHAR: Record<TerrainTileKind, string> = {
  empty: '.',
  bedrock: '#',
  brick: 'B',
  platform: '=',
};

export const DEFAULT_STICKMAN_BOT_TEMPLATE_CODE = `// 星渊火柴人决斗 自定义 AI 策略模板（TypeScript / JavaScript）
// 导出 createBot(ctx) 或 decide(obs, state, dt) 均可由独立 Worker 沙箱加载运行

export function createBot(_ctx: { slotId: string; seed: number; random: () => number }) {
  let prevAttack = false;
  let prevKick = false;
  let prevJump = false;
  let prevSwap = false;

  return {
    decide(obs: any) {
      const out = {
        moveLeft: false,
        moveRight: false,
        aimUp: false,
        aimDown: false,
        attack: false,
        kick: false,
        jump: false,
        swap: false,
      };
      if (obs.phase !== 'playing' || !obs.self || !obs.self.alive) {
        prevAttack = prevKick = prevJump = prevSwap = false;
        return out;
      }

      const self = obs.self;
      const aliveEnemies = (obs.opponents || []).filter((e: any) => e.alive);
      if (aliveEnemies.length === 0) return out;

      // 选择最近敌人
      aliveEnemies.sort(
        (a: any, b: any) =>
          Math.hypot(a.x - self.x, a.y - self.y) - Math.hypot(b.x - self.x, b.y - self.y)
      );
      const target = aliveEnemies[0];

      // 寻找空投武器或血包
      let goalX = target.x;
      let goalY = target.y;
      if (Array.isArray(obs.pickups) && obs.pickups.length > 0) {
        const wantHeal = self.hp < self.maxHp * 0.72;
        const candidate = obs.pickups.find(
          (p: any) => (wantHeal && p.kind === 'medkit') || (!self.weapon && p.kind !== 'medkit')
        );
        if (candidate) {
          goalX = candidate.x;
          goalY = candidate.y;
        }
      }

      if (goalX < self.x - 24) out.moveLeft = true;
      else if (goalX > self.x + 24) out.moveRight = true;

      let wantsJump = goalY < self.y - 48;
      if (goalY > self.y + 48 && self.onPlatform) {
        out.aimDown = true;
        wantsJump = true;
      }

      const dist = Math.hypot(target.x - self.x, target.y - self.y);
      let wantsAttack = false;
      let wantsKick = false;
      let wantsSwap = false;

      if (self.nearbyDropId !== null && !self.weapon) {
        wantsSwap = true;
      }

      if (
        self.weapon &&
        (self.weapon.kind === 'pistol' ||
          self.weapon.kind === 'shotgun' ||
          self.weapon.kind === 'rocket')
      ) {
        const maxRange = self.weapon.kind === 'shotgun' ? 360 : 520;
        if (dist < maxRange) {
          out.moveLeft = target.x < self.x;
          out.moveRight = target.x >= self.x;
          if (self.weapon.kind === 'rocket' && dist > 190) {
            out.aimUp = true;
          }
          wantsAttack = dist > (self.weapon.kind === 'rocket' ? 120 : 20);
        }
      } else if (dist < 76) {
        if (dist < 52 && Math.abs(target.y - self.y) < 36) {
          wantsKick = true;
        } else {
          wantsAttack = true;
        }
      }

      out.attack = wantsAttack && !prevAttack;
      out.kick = wantsKick && !prevKick;
      out.jump = wantsJump && !prevJump;
      out.swap = wantsSwap && !prevSwap;

      prevAttack = out.attack;
      prevKick = out.kick;
      prevJump = out.jump;
      prevSwap = out.swap;
      return out;
    },
  };
}
`;

export function buildStickmanObservation(
  world: StickmanWorld,
  selfSlotId: PlayerSlotId,
  tick: number
): StickmanObservation {
  const self = world.fighters.find((f) => f.slotId === selfSlotId) ?? null;
  const grid: string[] = [];
  for (let r = 0; r < world.terrain.rows; r += 1) {
    let rowStr = '';
    for (let c = 0; c < world.terrain.cols; c += 1) {
      rowStr += TILE_CHAR[world.terrain.tiles[r * world.terrain.cols + c]];
    }
    grid.push(rowStr);
  }

  return {
    schemaVersion: STICKMAN_AI_SDK_SCHEMA_VERSION,
    tick,
    roundNumber: world.roundNumber,
    phase: world.phase,
    battleTime: Number(world.battleElapsedSeconds.toFixed(3)),
    self: self
      ? {
          slotId: self.slotId,
          x: Number(self.x.toFixed(1)),
          y: Number(self.y.toFixed(1)),
          vx: Number(self.vx.toFixed(1)),
          vy: Number(self.vy.toFixed(1)),
          facing: self.facing,
          hp: self.hp,
          maxHp: self.maxHp,
          alive: self.alive,
          onGround: self.onGround,
          onPlatform: self.onPlatform,
          jumpsUsed: self.jumpsUsed,
          maxJumps: self.maxJumps,
          weapon: self.weapon ? { ...self.weapon } : null,
          nearbyDropId: self.nearbyDropId,
        }
      : null,
    opponents: world.fighters
      .filter((f) => f.slotId !== selfSlotId)
      .map((f) => ({
        slotId: f.slotId,
        displayName: f.config.displayName,
        x: Number(f.x.toFixed(1)),
        y: Number(f.y.toFixed(1)),
        vx: Number(f.vx.toFixed(1)),
        vy: Number(f.vy.toFixed(1)),
        facing: f.facing,
        hp: f.hp,
        maxHp: f.maxHp,
        alive: f.alive,
        weaponKind: f.weapon?.kind ?? null,
      })),
    pickups: world.pickups.map((p) => ({
      id: p.id,
      kind: p.kind,
      remaining: p.remaining,
      max: p.max,
      x: Number(p.x.toFixed(1)),
      y: Number(p.y.toFixed(1)),
      onGround: p.onGround,
    })),
    projectiles: world.projectiles.map((p) => ({
      id: p.id,
      kind: p.kind,
      ownerSlotId: p.ownerSlotId,
      x: Number(p.x.toFixed(1)),
      y: Number(p.y.toFixed(1)),
      vx: Number(p.vx.toFixed(1)),
      vy: Number(p.vy.toFixed(1)),
      gravityScale: p.gravityScale,
    })),
    terrain: {
      cols: world.terrain.cols,
      rows: world.terrain.rows,
      tileSize: world.terrain.tileSize,
      width: world.terrain.width,
      height: world.terrain.height,
      grid,
    },
    rules: {
      maxHp: world.rules.maxHp,
      moveSpeed: world.rules.moveSpeed,
      jumpVelocity: world.rules.jumpVelocity,
      gravity: world.rules.gravity,
      punchDamage: world.rules.punchDamage,
      kickDamage: world.rules.kickDamage,
      swordDamage: world.rules.swordDamage,
      pistolDamage: world.rules.pistolDamage,
      pistolSpeed: world.rules.pistolSpeed,
      shotgunPellets: world.rules.shotgunPellets,
      shotgunSpreadAngleDeg: world.rules.shotgunSpreadAngleDeg,
      shotgunDamage: world.rules.shotgunDamage,
      shotgunSpeed: world.rules.shotgunSpeed,
      rocketDamage: world.rules.rocketDamage,
      rocketSpeed: world.rules.rocketSpeed,
      rocketGravity: world.rules.rocketGravity,
      rocketBlastRadius: world.rules.rocketBlastRadius,
      medkitHealPercent: world.rules.medkitHealPercent,
    },
  };
}

export function buildStickmanPromptMarkdown(
  rules: StickmanDuelRules,
  options: PromptMarkdownOptions
): string {
  const rulesBlock = options.includeCurrentRules
    ? `
## 当前对局数值
- 最大生命：\`${rules.maxHp} HP\`，受伤无敌保护 \`${rules.hurtInvulnSeconds}s\`（期间免疫伤害与击退），拳击 \`${rules.punchDamage}\`，踢腿 \`${rules.kickDamage}\`（强击飞）
- 道具刷新：${rules.dropSpawnMode === 'center' ? '固定中间点位上方短距掉落' : '全场随机落点上方短距掉落'}
- 长剑：耐久 \`${rules.swordDurability}\` 点（命中扣 1 点），单斩 \`${rules.swordDamage}\`
- 手枪：\`${rules.pistolAmmo}\` 发直线，单发 \`${rules.pistolDamage}\`，弹速 \`${rules.pistolSpeed} px/s\`
- 猎枪：\`${rules.shotgunAmmo}\` 发，单发在 \`${rules.shotgunSpreadAngleDeg}°\` 扇形内随机散射 \`${rules.shotgunPellets}\` 枚小子弹，单枚 \`${rules.shotgunDamage}\` 伤，弹速 \`${rules.shotgunSpeed} px/s\`
- 火箭筒：\`${rules.rocketAmmo}\` 发受重力抛射，中心伤害 \`${rules.rocketDamage}\`，爆炸半径 \`${rules.rocketBlastRadius}px\`（可炸毁砖块与短平台）
- 血包：回复最大生命 \`${rules.medkitHealPercent}%\`
`
    : '';

  return `# 《星渊火柴人决斗》AI 策略脚本规范（${STICKMAN_AI_SDK_SCHEMA_VERSION}）

请编写一个**单文件、无外部依赖**的 TypeScript 或 JavaScript 策略脚本，在 2D 横版可破坏地形格斗竞技场中战胜对手。

## 1. 核心规则与物理机制
1. **地形层级**：最底层 \`#\` 为不可破坏基岩，上方 \`B\` 为可被火箭筒炸毁的堆叠砖块，\`=\` 为单向短平台（可自下而上跃过、按 \`aimDown + jump\` 向下穿台，同样可被火箭筒炸毁）。
2. **动作键位映射**（返回值布尔映射）：
   - \`moveLeft\` / \`moveRight\` / \`aimUp\` / \`aimDown\`：水平移动与 8 向远程瞄准（静止时水平朝前发射）
   - \`attack\`（左键/X）：空手出拳，手持武器时挥剑或发射手枪/猎枪/火箭筒
   - \`kick\`（上键/Y）：高位飞踢与强力击飞（持武器时同样可用）
   - \`jump\`（下键/A）：跳跃、空中二段跳，配合 \`aimDown\` 向下穿短平台
   - \`swap\`（右键/B）：拾取或替换身边武器（替换后旧武器保留剩余耐久/弹药掉落地面）
3. **单次动作上升沿**：\`attack\`、\`kick\`、\`jump\`、\`swap\` 均在从未按下转为按下的上升沿触发，请在下一次决策将其置回 \`false\`。
${rulesBlock}
## 2. 参考模板
\`\`\`ts
${DEFAULT_STICKMAN_BOT_TEMPLATE_CODE.trim()}
\`\`\`
`;
}

const IDLE_ACTION: ActionInputState = {
  held: false,
  justPressed: false,
  justReleased: false,
};

export const stickmanDuelAiSdk: GameAiSdkAdapter<
  StickmanDuelRules,
  StickmanWorld,
  StickmanObservation
> = {
  schemaVersion: STICKMAN_AI_SDK_SCHEMA_VERSION,
  buildPromptMarkdown: buildStickmanPromptMarkdown,
  defaultTemplateCode: DEFAULT_STICKMAN_BOT_TEMPLATE_CODE,
  buildObservation: buildStickmanObservation,
  createDryRunWorld(rules, seed) {
    const dryRules: StickmanDuelRules = {
      ...rules,
      countdownSeconds: 0,
      targetScore: 5,
    };
    const session = new StickmanDuelSession({
      gameId: 'stickman-duel',
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
              return slotStates[actionId] ?? IDLE_ACTION;
            }
            return IDLE_ACTION;
          },
        };
        session.step(dtSeconds, frame);
      },
    };
  },
};
