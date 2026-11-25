import type { InputFrame, SoundEventKind } from '../../../platform/games/contracts';
import { ensurePlayerStats, recordItemUsed } from '../items/effects';
import { resolveCircleMazeCollision } from '../simulation/collision';
import {
  MINE_VISUAL_RADIUS,
  NORMAL_BULLET_RADIUS,
  SPECIAL_BULLET_RADIUS,
  TANK_BARREL_LENGTH,
  TANK_RADIUS,
  type TankBattleRules,
  type TankEntity,
  type TankWorldState,
} from '../types';
import { fireLaserRay, spawnProjectileFromMuzzle } from './projectiles';

const DEG_TO_RAD = Math.PI / 180;

/**
 * 步首执行到时的弹药补充：
 * 首次从满弹扣弹后按 reloadIntervalSeconds 持续回 1 发，再次开火不重置进度，补满后停止。
 */
export function updateTankAmmoReload(
  tanks: TankEntity[],
  battleTime: number,
  rules: TankBattleRules
): void {
  for (let i = 0; i < tanks.length; i += 1) {
    const tank = tanks[i];
    if (!tank.alive) continue;
    if (tank.ammo >= tank.maxAmmo) {
      tank.ammo = tank.maxAmmo;
      tank.nextReloadAt = null;
      continue;
    }
    if (tank.nextReloadAt === null) {
      tank.nextReloadAt = battleTime + rules.reloadIntervalSeconds;
      continue;
    }
    while (tank.ammo < tank.maxAmmo && battleTime + 1e-9 >= tank.nextReloadAt) {
      tank.ammo += 1;
      if (tank.ammo >= tank.maxAmmo) {
        tank.ammo = tank.maxAmmo;
        tank.nextReloadAt = null;
        break;
      }
      tank.nextReloadAt += rules.reloadIntervalSeconds;
    }
  }
}

/** 从弹夹扣弹并在必要时启动补弹周期（不会重置已有补弹进度） */
function consumeAmmo(tank: TankEntity, cost: number, battleTime: number, rules: TankBattleRules): void {
  const wasFull = tank.ammo >= tank.maxAmmo;
  tank.ammo = Math.max(0, tank.ammo - cost);
  if (wasFull && tank.ammo < tank.maxAmmo && tank.nextReloadAt === null) {
    tank.nextReloadAt = battleTime + rules.reloadIntervalSeconds;
  }
}

/**
 * 步 3：处理所有存活坦克的开火与地雷布放。
 * - 先校验触发方式（连发读按住 held，其余读按下瞬间 justPressed）、冷却、弹药或道具次数
 * - 一次成功的操作统一完成扣费、生成攻击与设置冷却；失败不扣费、不消耗次数
 */
export function processWeaponActions(
  world: TankWorldState,
  input: InputFrame,
  eliminatedSet: Set<string>,
  nextId: () => number,
  sounds: SoundEventKind[]
): void {
  const { rules, battleTime } = world;

  for (let i = 0; i < world.tanks.length; i += 1) {
    const tank = world.tanks[i];
    if (!tank.alive) continue;

    const fireInput = input.getAction(tank.slotId, 'fire');
    const offense = tank.offense;

    // 1. 单次进攻道具（激光 / 追踪弹 / 破片弹 / 地雷）：独立于弹夹，零弹药亦可使用，点按触发
    if (
      offense &&
      (offense.kind === 'laser' ||
        offense.kind === 'homing' ||
        offense.kind === 'frag' ||
        offense.kind === 'mine')
    ) {
      if (!fireInput.justPressed) continue;
      if (battleTime + 1e-9 < tank.fireReadyAt) continue;

      if (offense.kind === 'laser') {
        tank.offense = null;
        tank.fireReadyAt = battleTime + rules.normalFireCooldownSeconds;
        tank.recoilOffset = 5;
        ensurePlayerStats(world, tank.slotId).shotsFired += 1;
        recordItemUsed(world, tank.slotId, 'laser');
        fireLaserRay(world, tank, eliminatedSet, nextId, sounds);
        sounds.push('fire_laser');
        world.screenShakeTrauma = Math.min(1, world.screenShakeTrauma + 0.22);
      } else if (offense.kind === 'homing') {
        tank.offense = null;
        tank.fireReadyAt = battleTime + rules.normalFireCooldownSeconds;
        tank.recoilOffset = 4.5;
        ensurePlayerStats(world, tank.slotId).shotsFired += 1;
        recordItemUsed(world, tank.slotId, 'homing');
        spawnProjectileFromMuzzle(
          world,
          tank,
          tank.angle,
          rules.homingBulletSpeed,
          SPECIAL_BULLET_RADIUS,
          'homing',
          rules.homingLifetimeSeconds,
          nextId
        );
        sounds.push('fire_homing');
        pushMuzzleCue(world, tank);
      } else if (offense.kind === 'frag') {
        tank.offense = null;
        tank.fireReadyAt = battleTime + rules.normalFireCooldownSeconds;
        tank.recoilOffset = 5;
        ensurePlayerStats(world, tank.slotId).shotsFired += 1;
        recordItemUsed(world, tank.slotId, 'frag');
        spawnProjectileFromMuzzle(
          world,
          tank,
          tank.angle,
          rules.normalBulletSpeed * 0.92,
          SPECIAL_BULLET_RADIUS + 1,
          'frag_parent',
          rules.fragDetonateDelaySeconds + rules.fragShardLifetimeSeconds,
          nextId,
          { detonateAtBattleTime: battleTime + rules.fragDetonateDelaySeconds }
        );
        sounds.push('fire_frag');
        pushMuzzleCue(world, tank);
      } else if (offense.kind === 'mine') {
        tank.offense = null;
        tank.fireReadyAt = battleTime + rules.normalFireCooldownSeconds;
        recordItemUsed(world, tank.slotId, 'mine');
        const rearDist = TANK_RADIUS + MINE_VISUAL_RADIUS + 2;
        const rawX = tank.x - Math.cos(tank.angle) * rearDist;
        const rawY = tank.y - Math.sin(tank.angle) * rearDist;
        const safePos = resolveCircleMazeCollision(rawX, rawY, MINE_VISUAL_RADIUS, world.maze);
        world.mines.push({
          id: nextId(),
          ownerSlotId: tank.slotId,
          colorHex: tank.colorHex,
          x: safePos.x,
          y: safePos.y,
          placedAtBattleTime: battleTime,
          armedAtBattleTime: battleTime + rules.mineArmDelaySeconds,
        });
        sounds.push('place_mine');
      }
      continue;
    }

    // 2. 连发道具：按住开火键即可按 rapidFireCooldownSeconds 连射，每颗扣 1 发，不抵消普通弹
    if (offense && offense.kind === 'rapid_fire') {
      if (!fireInput.held && !fireInput.justPressed) continue;
      if (battleTime + 1e-9 < tank.fireReadyAt) continue;
      if (tank.ammo < 1) continue; // 无弹药时不发射也不消耗次数

      consumeAmmo(tank, 1, battleTime, rules);
      tank.fireReadyAt = battleTime + rules.rapidFireCooldownSeconds;
      tank.recoilOffset = 3.5;
      ensurePlayerStats(world, tank.slotId).shotsFired += 1;
      if (!offense.usedRecorded) {
        offense.usedRecorded = true;
        recordItemUsed(world, tank.slotId, 'rapid_fire');
      }

      spawnProjectileFromMuzzle(
        world,
        tank,
        tank.angle,
        rules.normalBulletSpeed * 1.04,
        NORMAL_BULLET_RADIUS,
        'rapid_fire',
        rules.normalBulletLifetimeSeconds,
        nextId
      );
      sounds.push('fire_normal');
      pushMuzzleCue(world, tank);

      offense.remainingShots -= 1;
      if (offense.remainingShots <= 0) {
        tank.offense = null;
      }
      continue;
    }

    // 3. 三连发（散弹枪）：点按开火，整次扣 shotgunAmmoCost（默认 2 发），不足时不发不扣弹，弹丸存活 4s
    if (offense && offense.kind === 'shotgun') {
      if (!fireInput.justPressed) continue;
      if (battleTime + 1e-9 < tank.fireReadyAt) continue;
      if (tank.ammo < rules.shotgunAmmoCost) continue;

      consumeAmmo(tank, rules.shotgunAmmoCost, battleTime, rules);
      tank.fireReadyAt = battleTime + rules.normalFireCooldownSeconds;
      tank.recoilOffset = 6;
      ensurePlayerStats(world, tank.slotId).shotsFired += 1;
      if (!offense.usedRecorded) {
        offense.usedRecorded = true;
        recordItemUsed(world, tank.slotId, 'shotgun');
      }

      const pellets = Math.max(2, rules.shotgunPellets);
      const totalSpreadRad = rules.shotgunSpreadAngleDeg * DEG_TO_RAD;
      for (let pIdx = 0; pIdx < pellets; pIdx += 1) {
        const frac = pellets === 1 ? 0 : pIdx / (pellets - 1) - 0.5;
        const pelletAngle = tank.angle + frac * totalSpreadRad;
        spawnProjectileFromMuzzle(
          world,
          tank,
          pelletAngle,
          rules.normalBulletSpeed,
          NORMAL_BULLET_RADIUS,
          'shotgun',
          rules.shotgunBulletLifetimeSeconds,
          nextId
        );
      }
      sounds.push('fire_shotgun');
      pushMuzzleCue(world, tank);
      continue;
    }

    // 4. 普通射击：点按发射 1 颗，扣 1 发，冷却 0.8s，存活 6s，参与普通子弹抵消
    if (!fireInput.justPressed) continue;
    if (battleTime + 1e-9 < tank.fireReadyAt) continue;
    if (tank.ammo < 1) continue;

    consumeAmmo(tank, 1, battleTime, rules);
    tank.fireReadyAt = battleTime + rules.normalFireCooldownSeconds;
    tank.recoilOffset = 4;
    ensurePlayerStats(world, tank.slotId).shotsFired += 1;

    spawnProjectileFromMuzzle(
      world,
      tank,
      tank.angle,
      rules.normalBulletSpeed,
      NORMAL_BULLET_RADIUS,
      'normal',
      rules.normalBulletLifetimeSeconds,
      nextId
    );
    sounds.push('fire_normal');
    pushMuzzleCue(world, tank);
  }
}

function pushMuzzleCue(world: TankWorldState, tank: TankEntity): void {
  world.visualCues.push({
    kind: 'muzzle',
    x: tank.x + Math.cos(tank.angle) * TANK_BARREL_LENGTH,
    y: tank.y + Math.sin(tank.angle) * TANK_BARREL_LENGTH,
    angle: tank.angle,
    colorHex: tank.colorHex,
  });
}
