import type {
  BotActionIntent,
  BotAgentInstance,
  BotModelDefinition,
  PlayerSlotId,
} from '../../../platform/games/contracts';
import { DeterministicRng } from '../map/rng';
import {
  CELL_SIZE,
  TANK_RADIUS,
  type ItemKind,
  type TankEntity,
  type TankWorldState,
  type Vec2,
} from '../types';
import {
  assessBulletThreat,
  castMazeWallRay,
  computeMazePath,
  convertIntentToActions,
  findBestRicochetShot,
  findMazeCellIndex,
  hasLineOfSight,
  normalizeAngle,
  pickPathWaypoint,
  simulateBounceShot,
} from './perception';

interface BotProfileParams {
  thinkIntervalSeconds: number;
  aimToleranceRad: number;
  maxBounceSearch: number;
  bounceSweepSteps: number;
  dodgeHorizonSeconds: number;
  dodgeEnabled: boolean;
  itemSearchRadiusCells: number;
  useLeadPrediction: boolean;
  avoidMines: boolean;
  hesitationChance: number;
  fireCooldownFloorSeconds: number;
}

const ITEM_VALUE_PRIORITY: Record<ItemKind, number> = {
  laser: 95,
  shield: 90,
  shotgun: 84,
  frag: 80,
  homing: 78,
  rapid_fire: 74,
  mine: 52,
};

/**
 * 通用可配置坦克 AI 决策体（由不同难度的 TS 脚本参数驱动，完全遵守物理公平规则）。
 */
class ConfigurableTankBotAgent implements BotAgentInstance<TankWorldState> {
  private readonly params: BotProfileParams;
  private readonly rng: DeterministicRng;

  private lastRound = -1;
  private thinkTimer = 0;
  private cachedMoveDir: Vec2 | null = null;
  private cachedAimAngle: number | null = null;
  private cachedShouldFire = false;
  private lastFireAt = -10;
  private lastPosX = 0;
  private lastPosY = 0;
  private stuckTimer = 0;
  private unstickTimer = 0;
  private unstickDir: Vec2 = { x: 1, y: 0 };
  private prevEnemyX = 0;
  private prevEnemyY = 0;
  private enemyVx = 0;
  private enemyVy = 0;
  private hasEnemySample = false;
  private lastTargetSlotId: PlayerSlotId | null = null;

  constructor(params: BotProfileParams, seed: number) {
    this.params = params;
    this.rng = new DeterministicRng(seed);
  }

  decide(world: TankWorldState, selfSlotId: PlayerSlotId, dtSeconds: number): BotActionIntent {
    const empty: BotActionIntent = {
      forward: false,
      backward: false,
      turnLeft: false,
      turnRight: false,
      fire: false,
    };

    if (world.phase !== 'playing') {
      return empty;
    }

    const self = world.tanks.find((t) => t.slotId === selfSlotId);
    if (!self || !self.alive) {
      return empty;
    }

    // 多人/多 AI 混战中动态选择最近且优先直视可见的存活对手
    let enemy: TankEntity | null = null;
    let bestTargetScore = Infinity;
    for (let i = 0; i < world.tanks.length; i += 1) {
      const cand = world.tanks[i];
      if (!cand.alive || cand.slotId === selfSlotId) continue;
      const dist = Math.hypot(cand.x - self.x, cand.y - self.y);
      const visible = hasLineOfSight(world.maze, self.x, self.y, cand.x, cand.y);
      const score = dist - (visible ? 180 : 0);
      if (score < bestTargetScore) {
        bestTargetScore = score;
        enemy = cand;
      }
    }
    if (!enemy) {
      return empty;
    }

    // 新回合重置内部记忆
    if (this.lastRound !== world.roundNumber) {
      this.lastRound = world.roundNumber;
      this.thinkTimer = 0;
      this.cachedMoveDir = null;
      this.cachedAimAngle = null;
      this.cachedShouldFire = false;
      this.lastFireAt = -10;
      this.lastPosX = self.x;
      this.lastPosY = self.y;
      this.stuckTimer = 0;
      this.unstickTimer = 0;
      this.hasEnemySample = false;
      this.lastTargetSlotId = null;
    }

    // 切换锁定的对手时重置瞬时速度采样，避免速度跳变导致提前量偏航
    if (this.lastTargetSlotId !== enemy.slotId) {
      this.lastTargetSlotId = enemy.slotId;
      this.enemyVx = 0;
      this.enemyVy = 0;
      this.hasEnemySample = false;
    }

    // 追踪敌方瞬时速度用于提前量预判
    if (this.hasEnemySample && dtSeconds > 0.001) {
      const ivx = (enemy.x - this.prevEnemyX) / dtSeconds;
      const ivy = (enemy.y - this.prevEnemyY) / dtSeconds;
      this.enemyVx = this.enemyVx * 0.7 + ivx * 0.3;
      this.enemyVy = this.enemyVy * 0.7 + ivy * 0.3;
    }
    this.prevEnemyX = enemy.x;
    this.prevEnemyY = enemy.y;
    this.hasEnemySample = true;

    // 防卡墙检测
    const movedSinceLast = Math.hypot(self.x - this.lastPosX, self.y - this.lastPosY);
    this.lastPosX = self.x;
    this.lastPosY = self.y;
    if (this.cachedMoveDir && movedSinceLast < 14 * dtSeconds) {
      this.stuckTimer += dtSeconds;
    } else {
      this.stuckTimer = Math.max(0, this.stuckTimer - dtSeconds * 2);
    }

    if (this.unstickTimer > 0) {
      this.unstickTimer = Math.max(0, this.unstickTimer - dtSeconds);
    } else if (this.stuckTimer > 0.45) {
      this.stuckTimer = 0;
      this.unstickTimer = 0.35;
      const escapeAngle = self.angle + (this.rng.next() > 0.5 ? Math.PI * 0.65 : -Math.PI * 0.65);
      this.unstickDir = { x: Math.cos(escapeAngle), y: Math.sin(escapeAngle) };
    }

    // 紧急弹幕闪避高于节拍节流，确保高阶 AI 拥有毫秒级避弹手感
    if (this.params.dodgeEnabled) {
      const threat = assessBulletThreat(
        self,
        world.projectiles,
        world.maze,
        this.params.dodgeHorizonSeconds
      );
      if (threat.urgent) {
        return convertIntentToActions(
          self,
          { x: threat.evadeX, y: threat.evadeY },
          null,
          false,
          world.rules.controlMode
        );
      }
    }

    this.thinkTimer -= dtSeconds;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = this.params.thinkIntervalSeconds;
      this.recomputeTacticalPlan(world, self, enemy);
    }

    // 实时开火门控：确保只在炮口精确对准安全角度且弹药/冷却允许时扣动扳机
    let fireNow = false;
    if (
      this.cachedShouldFire &&
      this.cachedAimAngle !== null &&
      world.battleTime - this.lastFireAt >= this.params.fireCooldownFloorSeconds
    ) {
      const aimErr = Math.abs(normalizeAngle(this.cachedAimAngle - self.angle));
      const canShootAmmo =
        self.offense?.kind === 'laser' ||
        self.offense?.kind === 'homing' ||
        self.offense?.kind === 'frag' ||
        self.offense?.kind === 'mine' ||
        (self.offense?.kind === 'shotgun'
          ? self.ammo >= world.rules.shotgunAmmoCost
          : self.ammo >= 1);

      if (aimErr <= this.params.aimToleranceRad && canShootAmmo) {
        // 开火前二次贴墙自毁安全校验（非地雷）
        const isMine = self.offense?.kind === 'mine';
        if (isMine) {
          fireNow = true;
          this.lastFireAt = world.battleTime;
          this.cachedShouldFire = false;
        } else {
          const muzzleWall = castMazeWallRay(
            world.maze,
            self.x,
            self.y,
            Math.cos(self.angle),
            Math.sin(self.angle),
            TANK_RADIUS + 18
          );
          if (!muzzleWall) {
            fireNow = true;
            this.lastFireAt = world.battleTime;
            // 单发点射后在下一个思考节拍重新确认，避免无脑倾泻空弹夹
            if (self.offense?.kind !== 'rapid_fire') {
              this.cachedShouldFire = false;
            }
          }
        }
      }
    }

    const activeMove = this.unstickTimer > 0 ? this.unstickDir : this.cachedMoveDir;
    // 处于脱困期间暂停瞄准锁死，优先摆脱墙角
    const activeAim = this.unstickTimer > 0 ? null : this.cachedAimAngle;

    return convertIntentToActions(
      self,
      activeMove,
      activeAim,
      fireNow,
      world.rules.controlMode
    );
  }

  private recomputeTacticalPlan(
    world: TankWorldState,
    self: TankEntity,
    enemy: TankEntity
  ): void {
    const maze = world.maze;
    const distToEnemy = Math.hypot(enemy.x - self.x, enemy.y - self.y);

    // 1. 新兵等低阶难度保留轻微“犹豫/发呆”人性化特征
    if (this.params.hesitationChance > 0 && this.rng.next() < this.params.hesitationChance) {
      this.cachedMoveDir = null;
      this.cachedAimAngle = null;
      this.cachedShouldFire = false;
      return;
    }

    // 2. 特殊进攻武器处理：地雷在合适路口或敌方接近路径时自动布放
    if (self.offense?.kind === 'mine') {
      const selfCell = findMazeCellIndex(maze, self.x, self.y);
      const isChokeOrMid = maze.cells[selfCell].neighbors.length <= 2 || distToEnemy < 320;
      if (isChokeOrMid && distToEnemy > 95) {
        this.cachedAimAngle = self.angle;
        this.cachedShouldFire = true;
      }
    }

    // 3. 寻找射击解（直视提前量 / 激光多折线 / 墙面反弹狙击）
    let bestAim: number | null = null;
    let wantsFire = false;

    const hasDirectSight = hasLineOfSight(maze, self.x, self.y, enemy.x, enemy.y);

    // 追踪弹无需严苛直视，中远距离且前方开阔即可释放
    if (self.offense?.kind === 'homing' && distToEnemy > 130) {
      const openFront = !castMazeWallRay(
        maze,
        self.x,
        self.y,
        Math.cos(self.angle),
        Math.sin(self.angle),
        48
      );
      if (openFront) {
        bestAim = self.angle;
        wantsFire = true;
      }
    }

    if (!wantsFire && hasDirectSight) {
      // 提前量预判：按子弹飞行时间修正瞄准点
      let targetX = enemy.x;
      let targetY = enemy.y;
      if (this.params.useLeadPrediction && self.offense?.kind !== 'laser') {
        const bulletSpeed = Math.max(180, world.rules.normalBulletSpeed);
        const flightTime = Math.min(0.45, distToEnemy / bulletSpeed);
        const predX = enemy.x + this.enemyVx * flightTime * 0.55;
        const predY = enemy.y + this.enemyVy * flightTime * 0.55;
        if (hasLineOfSight(maze, self.x, self.y, predX, predY)) {
          targetX = predX;
          targetY = predY;
        }
      }

      const aimRad = Math.atan2(targetY - self.y, targetX - self.x);
      const safeCheck = simulateBounceShot(maze, self, enemy, aimRad, 0, distToEnemy + 60);
      if (!safeCheck.selfRisk) {
        bestAim = aimRad;
        // 散弹枪偏爱中近距离，破片弹避免过近自伤
        if (self.offense?.kind === 'frag' && distToEnemy < 135) {
          wantsFire = false;
        } else {
          wantsFire = true;
        }
      }
    }

    // 若被墙体遮挡且该难度支持反弹求解，搜索 1~2 次墙面反弹击杀角度
    if (!wantsFire && this.params.maxBounceSearch > 0 && distToEnemy < 620) {
      const bounceLimit =
        self.offense?.kind === 'laser'
          ? Math.min(world.rules.laserMaxBounces, this.params.maxBounceSearch + 1)
          : this.params.maxBounceSearch;
      const bounceSol = findBestRicochetShot(
        maze,
        self,
        enemy,
        bounceLimit,
        this.params.bounceSweepSteps
      );
      if (bounceSol) {
        bestAim = bounceSol.angle;
        wantsFire = true;
      }
    }

    // 4. 移动目标选择：评估争夺场上道具 vs 追击/风筝敌方坦克
    const selfCell = findMazeCellIndex(maze, self.x, self.y);
    const enemyCell = findMazeCellIndex(maze, enemy.x, enemy.y);

    let goalCell = enemyCell;
    let goalPoint: Vec2 = { x: enemy.x, y: enemy.y };
    let chasingDrop = false;

    if (this.params.itemSearchRadiusCells > 0 && world.drops.length > 0) {
      let bestDropScore = -Infinity;
      for (const drop of world.drops) {
        // 若已有护盾不再优先抢护盾，已有高价值武器不再抢低价值武器
        if (drop.kind === 'shield' && self.shield) continue;
        if (drop.kind !== 'shield' && self.offense && ITEM_VALUE_PRIORITY[drop.kind] <= ITEM_VALUE_PRIORITY[self.offense.kind]) {
          continue;
        }
        const pathToDrop = computeMazePath(maze, selfCell, drop.cellIndex);
        const steps = Math.max(0, pathToDrop.length - 1);
        if (steps > this.params.itemSearchRadiusCells) continue;
        const score = ITEM_VALUE_PRIORITY[drop.kind] - steps * 14;
        if (score > bestDropScore) {
          bestDropScore = score;
          goalCell = drop.cellIndex;
          goalPoint = { x: drop.x, y: drop.y };
          chasingDrop = true;
        }
      }
    }

    const path = computeMazePath(maze, selfCell, goalCell);
    let moveVec: Vec2 | null = null;

    if (!chasingDrop && hasDirectSight && distToEnemy < 155) {
      // 贴脸直视交火时适当拉开身位或侧向走位，避免互相撞死或贴墙
      const awayAngle = Math.atan2(self.y - enemy.y, self.x - enemy.x);
      const strafeAngle = awayAngle + (this.rng.next() > 0.5 ? 0.65 : -0.65);
      moveVec = { x: Math.cos(strafeAngle), y: Math.sin(strafeAngle) };
    } else if (path.length >= 2) {
      const wp = pickPathWaypoint(maze, self, path, goalPoint);
      const dx = wp.x - self.x;
      const dy = wp.y - self.y;
      const len = Math.hypot(dx, dy);
      if (len > 8) {
        moveVec = { x: dx / len, y: dy / len };
      }
    } else {
      const dx = goalPoint.x - self.x;
      const dy = goalPoint.y - self.y;
      const len = Math.hypot(dx, dy);
      if (len > 26) {
        moveVec = { x: dx / len, y: dy / len };
      }
    }

    // 5. 高阶 AI 主动绕开敌方已就绪的可见地雷（仅在非常近的警戒圈内感知，维持公平感）
    if (this.params.avoidMines && moveVec && world.mines.length > 0) {
      let mvX = moveVec.x;
      let mvY = moveVec.y;
      for (const mine of world.mines) {
        if (mine.ownerSlotId === self.slotId) continue;
        const dMine = Math.hypot(self.x - mine.x, self.y - mine.y);
        if (dMine < CELL_SIZE * 0.95) {
          const pushX = (self.x - mine.x) / Math.max(1, dMine);
          const pushY = (self.y - mine.y) / Math.max(1, dMine);
          const bx = mvX + pushX * 1.4;
          const by = mvY + pushY * 1.4;
          const bl = Math.hypot(bx, by) || 1;
          mvX = bx / bl;
          mvY = by / bl;
        }
      }
      moveVec = { x: mvX, y: mvY };
    }

    this.cachedMoveDir = moveVec;
    this.cachedAimAngle = bestAim;
    this.cachedShouldFire = wantsFire;
  }
}

/**
 * 四档不同智力的 TypeScript AI 对手策略脚本注册表：
 * 1. 新兵巡逻（入门）
 * 2. 战术游击（进阶）
 * 3. 精英猎手（高手）
 * 4. 噩梦反弹（大师）
 */
export const TANK_BOT_MODELS: BotModelDefinition<TankWorldState>[] = [
  {
    id: 'rookie',
    name: '新兵巡逻',
    difficultyLevel: 1,
    difficultyLabel: '入门',
    accentColor: '#1F8A5B',
    summary: '节奏舒缓的巡逻脚本：仅直视开火、不主动躲避弹幕，适合单人上手与练枪热身。',
    traits: {
      navigation: 2,
      dodging: 1,
      aiming: 2,
      items: 1,
    },
    createAgent: (seed) =>
      new ConfigurableTankBotAgent(
        {
          thinkIntervalSeconds: 0.3,
          aimToleranceRad: 0.26,
          maxBounceSearch: 0,
          bounceSweepSteps: 0,
          dodgeHorizonSeconds: 0,
          dodgeEnabled: false,
          itemSearchRadiusCells: 1,
          useLeadPrediction: false,
          avoidMines: false,
          hesitationChance: 0.16,
          fireCooldownFloorSeconds: 0.55,
        },
        seed
      ),
  },
  {
    id: 'tactical',
    name: '战术游击',
    difficultyLevel: 2,
    difficultyLabel: '进阶',
    accentColor: '#2364C7',
    summary: '均衡型迷宫脚本：具备最短路追踪、直视提前量射击、基础躲弹与近点道具拾取。',
    traits: {
      navigation: 3,
      dodging: 3,
      aiming: 3,
      items: 3,
    },
    createAgent: (seed) =>
      new ConfigurableTankBotAgent(
        {
          thinkIntervalSeconds: 0.16,
          aimToleranceRad: 0.17,
          maxBounceSearch: 0,
          bounceSweepSteps: 0,
          dodgeHorizonSeconds: 0.55,
          dodgeEnabled: true,
          itemSearchRadiusCells: 3,
          useLeadPrediction: true,
          avoidMines: false,
          hesitationChance: 0.04,
          fireCooldownFloorSeconds: 0.34,
        },
        seed
      ),
  },
  {
    id: 'elite',
    name: '精英猎手',
    difficultyLevel: 3,
    difficultyLabel: '高手',
    accentColor: '#D97706',
    summary: '进攻型高手脚本：优先争夺高价值道具、主动预判闪避来袭弹道，并善用 1 次墙面反弹偷袭。',
    traits: {
      navigation: 4,
      dodging: 4,
      aiming: 4,
      items: 5,
    },
    createAgent: (seed) =>
      new ConfigurableTankBotAgent(
        {
          thinkIntervalSeconds: 0.09,
          aimToleranceRad: 0.12,
          maxBounceSearch: 1,
          bounceSweepSteps: 28,
          dodgeHorizonSeconds: 0.78,
          dodgeEnabled: true,
          itemSearchRadiusCells: 5,
          useLeadPrediction: true,
          avoidMines: true,
          hesitationChance: 0,
          fireCooldownFloorSeconds: 0.24,
        },
        seed
      ),
  },
  {
    id: 'nightmare',
    name: '噩梦反弹',
    difficultyLevel: 4,
    difficultyLabel: '大师',
    accentColor: '#D9432B',
    summary: '极限战术脚本：毫秒级弹幕躲避 + 1~2 次墙面反弹射线求解，隔墙也能精准几何狙击。',
    traits: {
      navigation: 5,
      dodging: 5,
      aiming: 5,
      items: 5,
    },
    createAgent: (seed) =>
      new ConfigurableTankBotAgent(
        {
          thinkIntervalSeconds: 0.045,
          aimToleranceRad: 0.085,
          maxBounceSearch: 2,
          bounceSweepSteps: 48,
          dodgeHorizonSeconds: 0.92,
          dodgeEnabled: true,
          itemSearchRadiusCells: 7,
          useLeadPrediction: true,
          avoidMines: true,
          hesitationChance: 0,
          fireCooldownFloorSeconds: 0.18,
        },
        seed
      ),
  },
];

export const DEFAULT_TANK_BOT_MODEL_ID = 'tactical';

export function getTankBotModelById(
  modelId: string | undefined
): BotModelDefinition<TankWorldState> {
  return (
    TANK_BOT_MODELS.find((m) => m.id === modelId) ??
    TANK_BOT_MODELS.find((m) => m.id === DEFAULT_TANK_BOT_MODEL_ID) ??
    TANK_BOT_MODELS[0]
  );
}
