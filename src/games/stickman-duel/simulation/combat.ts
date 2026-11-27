import type {
  GroundPickup,
  HeldWeaponState,
  StickFighter,
  StickPickupKind,
  StickProjectile,
  StickWeaponKind,
  StickmanDuelRules,
} from '../types';

export const PICKUP_LABELS: Record<StickPickupKind, string> = {
  sword: '长剑',
  pistol: '手枪',
  shotgun: '猎枪',
  rocket: '火箭筒',
  grenade: '碎片手雷',
  medkit: '血包',
};

export const PICKUP_ACCENTS: Record<StickPickupKind, string> = {
  sword: '#38BDF8',
  pistol: '#F59E0B',
  shotgun: '#EA580C',
  rocket: '#EF4444',
  grenade: '#65A30D',
  medkit: '#10B981',
};

/**
 * 8 向瞄准解算：
 * - 若有摇杆或方向键输入（幅度 > 0.2），自动吸附至最接近的 8 个方向之一（每 45° 一档）
 * - 未推方向时，默认沿角色面朝方向水平发射 (facing, 0)
 */
export function resolveEightWayAim(
  inputX: number,
  inputY: number,
  facing: -1 | 1
): { x: number; y: number } {
  const mag = Math.hypot(inputX, inputY);
  if (mag < 0.22) {
    return { x: facing, y: 0 };
  }
  const angle = Math.atan2(inputY, inputX);
  const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  const ax = Math.cos(snapped);
  const ay = Math.sin(snapped);
  return {
    x: Math.abs(ax) < 1e-4 ? 0 : ax,
    y: Math.abs(ay) < 1e-4 ? 0 : ay,
  };
}

export function getWeaponMaxCharges(kind: StickWeaponKind, rules: StickmanDuelRules): number {
  switch (kind) {
    case 'sword':
      return Math.max(1, Math.round(rules.swordDurability));
    case 'pistol':
      return Math.max(1, Math.round(rules.pistolAmmo));
    case 'shotgun':
      return Math.max(1, Math.round(rules.shotgunAmmo));
    case 'rocket':
      return Math.max(1, Math.round(rules.rocketAmmo));
    case 'grenade':
      return Math.max(1, Math.round(rules.grenadeAmmo));
  }
}

export type ProjectileHitZone = 'head' | 'body' | 'legs';

/**
 * 挥剑可斩断弹体判断：
 * - 手枪子弹、猎枪散弹、手雷 6 向碎片均可被长剑斩碎
 * - 火箭弹与飞行中的整颗手雷不可被剑斩断
 */
export function isProjectileSlashable(kind: StickProjectile['kind']): boolean {
  return kind === 'pistol' || kind === 'shotgun' || kind === 'shrapnel';
}

/**
 * 直射弹丸命中角色部位倍率判定：
 * - 顶部头部区间（< 28%）：1.5× 爆头暴击
 * - 中部躯干区间（28%..72%）：1.0× 常规伤害
 * - 底部腿脚区间（> 72%）：0.6× 腿部减伤
 */
export function resolveProjectileHitZone(
  projectileY: number,
  fighterFeetY: number,
  fighterHeight: number
): { zone: ProjectileHitZone; multiplier: number } {
  const safeHeight = Math.max(1, fighterHeight);
  const topY = fighterFeetY - safeHeight;
  const relY = (projectileY - topY) / safeHeight;
  if (relY < 0.28) {
    return { zone: 'head', multiplier: 1.5 };
  }
  if (relY > 0.72) {
    return { zone: 'legs', multiplier: 0.6 };
  }
  return { zone: 'body', multiplier: 1.0 };
}

/**
 * 碎片手雷 8 方向抛物线投掷初速计算：
 * - 水平投掷时自动补一小段自然上扬抛弧，其余斜上/正上/斜下/正下方向严格沿 8 向抛出
 */
export function computeGrenadeThrowVelocity(
  aimX: number,
  aimY: number,
  speed: number
): { vx: number; vy: number } {
  const len = Math.hypot(aimX, aimY) || 1;
  const nx = aimX / len;
  const ny = aimY / len;
  const flatArcLift = Math.abs(ny) < 0.1 ? -115 : 0;
  return {
    vx: nx * speed,
    vy: ny * speed + flatArcLift,
  };
}

export function formatWeaponBadge(weapon: HeldWeaponState | null): string {
  if (!weapon) return '空手';
  const name = PICKUP_LABELS[weapon.kind];
  if (weapon.kind === 'sword') {
    return `${name} ${weapon.remaining}/${weapon.max}`;
  }
  return `${name} ${weapon.remaining}/${weapon.max}`;
}

/**
 * 拾取/替换武器纯函数：
 * - 若玩家原本手持武器，则把原武器保留剩余耐久/弹药抛落到地面（受重力下落）
 * - 将地面新武器装备到角色手上
 */
export function swapFighterWeapon(
  fighter: StickFighter,
  pickup: GroundPickup,
  nextDropId: number
): GroundPickup | null {
  if (pickup.kind === 'medkit') return null;

  const previous = fighter.weapon;
  fighter.weapon = {
    kind: pickup.kind,
    remaining: pickup.remaining,
    max: pickup.max,
  };

  if (!previous || previous.remaining <= 0) {
    return null;
  }

  return {
    id: nextDropId,
    kind: previous.kind,
    remaining: previous.remaining,
    max: previous.max,
    x: fighter.x,
    y: fighter.y - fighter.height * 0.58,
    vx: -fighter.facing * 135 + fighter.vx * 0.25,
    vy: -255,
    radius: 15,
    onGround: false,
    age: 0,
    lifetime: 28,
    pickupLockTimer: 0.42,
    droppedBySlotId: fighter.slotId,
  };
}

/**
 * 血包回血计算：默认恢复 25% 最大生命值，不超过上限
 */
export function applyMedkitHeal(
  fighter: StickFighter,
  healPercent: number
): number {
  if (!fighter.alive || fighter.hp >= fighter.maxHp) return 0;
  const amount = Math.max(1, Math.round((fighter.maxHp * healPercent) / 100));
  const before = fighter.hp;
  fighter.hp = Math.min(fighter.maxHp, fighter.hp + amount);
  fighter.displayHp = Math.max(fighter.displayHp, fighter.hp);
  return fighter.hp - before;
}

/**
 * 火箭筒爆炸溅射衰减伤害与击飞计算：
 * 距离中心越近伤害越高，边缘保底 40% 中心伤害
 */
export function computeRocketSplash(
  dist: number,
  blastRadius: number,
  maxDamage: number
): { damage: number; knockbackScale: number } | null {
  if (dist > blastRadius) return null;
  const ratio = Math.max(0, 1 - dist / blastRadius);
  const dmgFactor = 0.4 + 0.6 * ratio;
  return {
    damage: Math.max(1, Math.round(maxDamage * dmgFactor)),
    knockbackScale: 0.55 + 0.65 * ratio,
  };
}
