import {
  BOSS_TIER_THEME,
  type BotActionIntent,
  type BotAgentInstance,
  type BotModelDefinition,
  type PlayerSlotId,
} from '../../../platform/games/contracts';
import { DeterministicRng } from '../../tank-battle/map/rng';
import { getTile } from '../map/terrain';
import type { GroundPickup, StickFighter, StickmanWorld, StickWeaponKind } from '../types';

interface StickmanBotProfile {
  /** 反应间隔（秒），越低越灵敏 */
  reactionInterval: number;
  /** 追击道具意愿（0..1） */
  pickupGreed: number;
  /** 远程导弹/子弹闪避意愿（0..1） */
  dodgeSkill: number;
  /** 火箭弹重力抬枪补偿准确度（0..1） */
  rocketLeadSkill: number;
  /** 踢腿击飞与连招把握度（0..1） */
  comboSkill: number;
  /** 持武器时的优先换装意识 */
  smartSwap: boolean;
}

const WEAPON_RANK: Record<StickWeaponKind, number> = {
  rocket: 3.4,
  sword: 2.8,
  pistol: 2.5,
};

function createIdleIntent(): BotActionIntent {
  return {
    moveLeft: false,
    moveRight: false,
    aimUp: false,
    aimDown: false,
    attack: false,
    kick: false,
    jump: false,
    swap: false,
  };
}

class StickmanTacticalBot implements BotAgentInstance<StickmanWorld> {
  private readonly profile: StickmanBotProfile;
  private readonly rng: DeterministicRng;
  private cooldown = 0;
  private cachedMoveX = 0;
  private prevAttack = false;
  private prevKick = false;
  private prevJump = false;
  private prevSwap = false;
  private stuckTimer = 0;
  private lastX = 0;

  constructor(profile: StickmanBotProfile, seed: number) {
    this.profile = profile;
    this.rng = new DeterministicRng(seed);
  }

  decide(world: StickmanWorld, selfSlotId: PlayerSlotId, dtSeconds: number): BotActionIntent {
    const intent = createIdleIntent();
    if (world.phase !== 'playing') {
      this.resetEdges();
      return intent;
    }

    const self = world.fighters.find((f) => f.slotId === selfSlotId);
    if (!self || !self.alive) {
      this.resetEdges();
      return intent;
    }

    const opponents = world.fighters.filter((f) => f.slotId !== selfSlotId && f.alive);
    if (opponents.length === 0) {
      this.resetEdges();
      return intent;
    }

    // 选择最优目标：距离近且血量低者优先
    let target = opponents[0];
    let bestEnemyScore = -Infinity;
    for (const op of opponents) {
      const dist = Math.hypot(op.x - self.x, op.y - self.y);
      const hpBias = (1 - op.hp / Math.max(1, op.maxHp)) * 130;
      const score = hpBias - dist;
      if (score > bestEnemyScore) {
        bestEnemyScore = score;
        target = op;
      }
    }

    // 检测是否卡在墙边，用于起跳翻越砖块
    if (Math.abs(self.x - this.lastX) < 1.5 && Math.abs(this.cachedMoveX) > 0.5) {
      this.stuckTimer += dtSeconds;
    } else {
      this.stuckTimer = 0;
    }
    this.lastX = self.x;

    // 1. 来袭火箭/子弹紧急闪避（高档位 AI 优先跳起或侧闪）
    let dodgeMoveX: number | null = null;
    let dodgeJump = false;
    if (this.profile.dodgeSkill > 0.25) {
      for (const p of world.projectiles) {
        if (p.ownerSlotId === self.slotId) continue;
        const dx = self.x - p.x;
        const dy = self.y - self.height * 0.5 - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist > (p.kind === 'rocket' ? 240 : 190)) continue;
        const closing = dx * p.vx + dy * p.vy > 0;
        if (!closing) continue;
        if (Math.abs(dy) < 58 && this.rng.next() < this.profile.dodgeSkill) {
          dodgeJump = true;
          dodgeMoveX = p.vx > 0 ? 1 : -1;
          break;
        }
      }
    }

    // 2. 评估地面道具与血包
    const desiredPickup = this.pickBestDrop(world, self, target);

    // 3. 决定目标点（道具 vs 敌人走位）
    let goalX = target.x;
    let goalY = target.y;
    const distToEnemy = Math.hypot(target.x - self.x, target.y - self.y);

    if (desiredPickup) {
      goalX = desiredPickup.x;
      goalY = desiredPickup.y;
    } else if (self.weapon && (self.weapon.kind === 'pistol' || self.weapon.kind === 'rocket')) {
      // 远程武器维持中距离拉扯，避免火箭贴脸自伤
      const idealDist = self.weapon.kind === 'rocket' ? 240 : 190;
      if (distToEnemy < idealDist - 40) {
        goalX = self.x + (self.x >= target.x ? 140 : -140);
      } else if (distToEnemy > idealDist + 80) {
        goalX = target.x;
      } else {
        goalX = self.x;
      }
    } else {
      // 近战武器或空手贴近敌人
      const meleeOffset = self.weapon?.kind === 'sword' ? 54 : 36;
      goalX = target.x + (self.x < target.x ? -meleeOffset : meleeOffset);
    }

    // 4. 水平移动决策（带反应节拍避免抖动）
    this.cooldown -= dtSeconds;
    if (this.cooldown <= 0) {
      this.cooldown = this.profile.reactionInterval;
      const dxGoal = goalX - self.x;
      if (Math.abs(dxGoal) > 16) {
        this.cachedMoveX = dxGoal > 0 ? 1 : -1;
      } else {
        this.cachedMoveX = 0;
      }
    }

    const finalMoveX = dodgeMoveX !== null ? dodgeMoveX : this.cachedMoveX;
    if (finalMoveX < 0) intent.moveLeft = true;
    if (finalMoveX > 0) intent.moveRight = true;

    // 5. 地形导航：遇砖墙起跳、高处目标二段跳、下方目标穿短平台
    const ts = world.terrain.tileSize;
    const selfCol = Math.floor(self.x / ts);
    const selfFootRow = Math.floor((self.y - 2) / ts);
    const lookDir = finalMoveX !== 0 ? finalMoveX : self.facing;
    const aheadTile = getTile(world.terrain, selfCol + lookDir, selfFootRow);
    const aheadLower = getTile(world.terrain, selfCol + lookDir, selfFootRow - 1);
    const blockedAhead = aheadTile === 'brick' || aheadTile === 'bedrock';

    let wantsJump = dodgeJump;
    if (blockedAhead || this.stuckTimer > 0.24) {
      wantsJump = true;
    }
    // 目标在更高平台
    if (goalY < self.y - 44 && Math.abs(goalX - self.x) < 220) {
      if (self.onGround || (self.jumpsUsed === 1 && self.vy > -40)) {
        wantsJump = true;
      }
    }
    // 目标在下方且自己站在单向短平台上 -> 下+跳穿台
    if (
      goalY > self.y + 42 &&
      self.onGround &&
      self.onPlatform &&
      !dodgeJump &&
      aheadLower !== 'brick'
    ) {
      intent.aimDown = true;
      wantsJump = true;
    }

    // 6. 拾取 / 换武器决策
    let wantsSwap = false;
    if (self.nearbyDropId !== null) {
      const nearby = world.pickups.find((d) => d.id === self.nearbyDropId);
      if (nearby) {
        if (nearby.kind === 'medkit') {
          wantsSwap = self.hp < self.maxHp;
        } else if (!self.weapon) {
          wantsSwap = true;
        } else if (this.profile.smartSwap) {
          const curScore =
            WEAPON_RANK[self.weapon.kind] * (0.4 + 0.6 * (self.weapon.remaining / self.weapon.max));
          const newScore =
            WEAPON_RANK[nearby.kind] * (0.4 + 0.6 * (nearby.remaining / nearby.max));
          if (newScore > curScore + 0.35) {
            wantsSwap = true;
          }
        }
      }
    }

    // 7. 攻击与 8 向瞄准决策
    let wantsAttack = false;
    let wantsKick = false;

    const toEnemyX = target.x - self.x;
    const toEnemyY = target.y - target.height * 0.5 - (self.y - self.height * 0.5);
    const horizDist = Math.abs(toEnemyX);
    const vertDist = Math.abs(toEnemyY);

    if (self.weapon && (self.weapon.kind === 'pistol' || self.weapon.kind === 'rocket')) {
      // 朝向敌人准备 8 向瞄准
      const aimDirX = toEnemyX >= 0 ? 1 : -1;
      const aimX = aimDirX;
      let aimY = 0;

      if (self.weapon.kind === 'rocket') {
        // 火箭受重力：中远距离抬高 45° 形成抛物线，避免贴脸炸自己
        const safeRocketRange = world.rules.rocketBlastRadius + 24;
        if (distToEnemy < safeRocketRange) {
          // 太近了！先踢飞敌人拉开距离
          if (horizDist < 72 && vertDist < 48) {
            wantsKick = true;
          }
        } else if (distToEnemy < 620) {
          if (toEnemyY < -48 || (horizDist > 210 && this.profile.rocketLeadSkill > 0.45)) {
            aimY = -1;
          } else if (toEnemyY > 80) {
            aimY = 1;
          }
          if (this.hasReasonableLine(world, self, target, true)) {
            wantsAttack = true;
          }
        }
      } else {
        // 手枪直线 8 向精确射击
        if (distToEnemy < 560) {
          const angle = Math.atan2(toEnemyY, toEnemyX);
          const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
          const err = Math.abs(Math.atan2(Math.sin(angle - snapped), Math.cos(angle - snapped)));
          if (err < 0.24 && this.hasReasonableLine(world, self, target, false)) {
            const sx = Math.round(Math.cos(snapped));
            const sy = Math.round(Math.sin(snapped));
            intent.moveLeft = sx < 0;
            intent.moveRight = sx > 0;
            intent.aimUp = sy < 0;
            intent.aimDown = sy > 0;
            wantsAttack = true;
          }
        }
      }

      if (wantsAttack && self.weapon.kind === 'rocket') {
        intent.moveLeft = aimX < 0;
        intent.moveRight = aimX > 0;
        intent.aimUp = aimY < 0;
        intent.aimDown = aimY > 0;
      }
    } else {
      // 近战：长剑或拳脚
      const reach = self.weapon?.kind === 'sword' ? 88 : 56;
      if (horizDist <= reach && vertDist <= 46) {
        // 转向面对敌人
        if (toEnemyX < -4) {
          intent.moveLeft = true;
          intent.moveRight = false;
        } else if (toEnemyX > 4) {
          intent.moveRight = true;
          intent.moveLeft = false;
        }

        // 持剑优先挥剑，空手交替拳击与重踢击飞
        if (self.weapon?.kind === 'sword') {
          if (horizDist < 42 && this.rng.next() < this.profile.comboSkill * 0.28) {
            wantsKick = true;
          } else {
            wantsAttack = true;
          }
        } else if (horizDist <= 64 && this.rng.next() < 0.25 + this.profile.comboSkill * 0.28) {
          wantsKick = true;
        } else {
          wantsAttack = true;
        }
      }
    }

    // 8. 严格遵守上升沿触发（单次动作松开 1 帧再按）
    intent.attack = wantsAttack && !this.prevAttack;
    intent.kick = wantsKick && !this.prevKick;
    intent.jump = wantsJump && !this.prevJump;
    intent.swap = wantsSwap && !this.prevSwap;

    this.prevAttack = intent.attack;
    this.prevKick = intent.kick;
    this.prevJump = intent.jump;
    this.prevSwap = intent.swap;

    return intent;
  }

  private resetEdges(): void {
    this.prevAttack = false;
    this.prevKick = false;
    this.prevJump = false;
    this.prevSwap = false;
  }

  private pickBestDrop(
    world: StickmanWorld,
    self: StickFighter,
    enemy: StickFighter
  ): GroundPickup | null {
    if (world.pickups.length === 0 || this.profile.pickupGreed <= 0.1) return null;

    let best: GroundPickup | null = null;
    let bestScore = 35;

    for (const drop of world.pickups) {
      if (drop.droppedBySlotId === self.slotId && drop.pickupLockTimer > 0) continue;
      const dist = Math.hypot(drop.x - self.x, drop.y - self.y);
      const enemyDist = Math.hypot(enemy.x - self.x, enemy.y - self.y);

      let value = 0;
      if (drop.kind === 'medkit') {
        const missingRatio = 1 - self.hp / Math.max(1, self.maxHp);
        if (missingRatio < 0.12) continue;
        value = 180 + missingRatio * 240;
      } else {
        const base = WEAPON_RANK[drop.kind] * 65;
        if (!self.weapon) {
          value = base * 1.35;
        } else if (this.profile.smartSwap) {
          const curRank = WEAPON_RANK[self.weapon.kind];
          if (WEAPON_RANK[drop.kind] <= curRank && self.weapon.remaining > 1) continue;
          value = base * 0.9;
        } else {
          continue;
        }
      }

      const score = value * this.profile.pickupGreed - dist * 0.55 + (enemyDist > 220 ? 35 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = drop;
      }
    }

    return best;
  }

  private hasReasonableLine(
    world: StickmanWorld,
    self: StickFighter,
    target: StickFighter,
    allowBrickBreak: boolean
  ): boolean {
    const sx = self.x;
    const sy = self.y - self.height * 0.6;
    const tx = target.x;
    const ty = target.y - target.height * 0.55;
    const dist = Math.hypot(tx - sx, ty - sy);
    const steps = Math.max(4, Math.ceil(dist / 24));
    const ts = world.terrain.tileSize;

    for (let i = 1; i < steps; i += 1) {
      const t = i / steps;
      const px = sx + (tx - sx) * t;
      const py = sy + (ty - sy) * t;
      const tile = getTile(world.terrain, Math.floor(px / ts), Math.floor(py / ts));
      if (tile === 'bedrock') return false;
      if (tile === 'brick') {
        // 火箭筒允许贴远距离轰开掩体，但不能贴脸轰自己
        if (allowBrickBreak && dist * t > world.rules.rocketBlastRadius + 28) {
          return true;
        }
        return false;
      }
    }
    return true;
  }
}

export const STICKMAN_BOT_MODELS: BotModelDefinition<StickmanWorld>[] = [
  {
    id: 'stick_rookie',
    name: '街头新兵',
    difficultyLevel: 1,
    difficultyLabel: 'Lv.1 新手',
    accentColor: '#64748B',
    summary: '动作节奏轻松，偶尔捡取武器，适合熟悉拳脚跳跃与二段跳手感。',
    traits: { navigation: 2, dodging: 1, aiming: 2, items: 2 },
    createAgent: (seed) =>
      new StickmanTacticalBot(
        {
          reactionInterval: 0.34,
          pickupGreed: 0.45,
          dodgeSkill: 0.15,
          rocketLeadSkill: 0.2,
          comboSkill: 0.25,
          smartSwap: false,
        },
        seed
      ),
  },
  {
    id: 'stick_brawler',
    name: '敏捷拳手',
    difficultyLevel: 2,
    difficultyLabel: 'Lv.2 进阶',
    accentColor: '#2563EB',
    summary: '善于跳台追击与连拳飞踢，会主动拾取长剑与血包。',
    traits: { navigation: 3, dodging: 2, aiming: 3, items: 3 },
    createAgent: (seed) =>
      new StickmanTacticalBot(
        {
          reactionInterval: 0.22,
          pickupGreed: 0.72,
          dodgeSkill: 0.38,
          rocketLeadSkill: 0.45,
          comboSkill: 0.5,
          smartSwap: false,
        },
        seed
      ),
  },
  {
    id: 'stick_hunter',
    name: '武器猎手',
    difficultyLevel: 3,
    difficultyLabel: 'Lv.3 精英',
    accentColor: '#0D9488',
    summary: '积极控图抢夺手枪与火箭筒，懂得 8 向瞄准与武器升级替换。',
    traits: { navigation: 4, dodging: 3, aiming: 4, items: 4 },
    createAgent: (seed) =>
      new StickmanTacticalBot(
        {
          reactionInterval: 0.14,
          pickupGreed: 0.92,
          dodgeSkill: 0.6,
          rocketLeadSkill: 0.72,
          comboSkill: 0.68,
          smartSwap: true,
        },
        seed
      ),
  },
  {
    id: 'stick_master',
    name: '战术武师',
    difficultyLevel: 4,
    difficultyLabel: 'Lv.4 大师',
    accentColor: '#D97706',
    summary: '会踢飞拉距后再抛射火箭拆掩体，精准控血并高效躲避弹道。',
    traits: { navigation: 5, dodging: 4, aiming: 4, items: 5 },
    createAgent: (seed) =>
      new StickmanTacticalBot(
        {
          reactionInterval: 0.09,
          pickupGreed: 1.0,
          dodgeSkill: 0.82,
          rocketLeadSkill: 0.9,
          comboSkill: 0.86,
          smartSwap: true,
        },
        seed
      ),
  },
  {
    id: 'hellbringer',
    name: '影刃宗师',
    difficultyLevel: 5,
    difficultyLabel: 'Lv.5 终极 Boss',
    accentColor: BOSS_TIER_THEME.accentHex,
    isBoss: true,
    summary: '极限反应、全地形穿台压制与重力抛射预判，空投军械零失误争夺。',
    traits: { navigation: 5, dodging: 5, aiming: 5, items: 5 },
    createAgent: (seed) =>
      new StickmanTacticalBot(
        {
          reactionInterval: 0.04,
          pickupGreed: 1.12,
          dodgeSkill: 0.96,
          rocketLeadSkill: 1.0,
          comboSkill: 0.98,
          smartSwap: true,
        },
        seed
      ),
  },
];

export const DEFAULT_STICKMAN_BOT_MODEL_ID = 'stick_hunter';
