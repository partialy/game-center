import type {
  PlayerMatchStats,
  PlayerSlotId,
  SoundEventKind,
} from '../../../platform/games/contracts';
import type { DeterministicRng } from '../map/rng';
import {
  DROP_PICKUP_RADIUS,
  type ItemKind,
  type TankBattleRules,
  TANK_RADIUS,
  type TankEntity,
  type TankWorldState,
} from '../types';

export function createEmptyPlayerMatchStats(): PlayerMatchStats {
  return {
    kills: 0,
    selfEliminations: 0,
    deaths: 0,
    shotsFired: 0,
    hitsLanded: 0,
    itemsPicked: 0,
    itemsUsed: 0,
    itemUsageByKind: {},
  };
}

export function ensurePlayerStats(
  world: TankWorldState,
  slotId: PlayerSlotId
): PlayerMatchStats {
  let entry = world.playerStats[slotId];
  if (!entry) {
    entry = createEmptyPlayerMatchStats();
    world.playerStats[slotId] = entry;
  }
  return entry;
}

export function recordItemUsed(
  world: TankWorldState,
  slotId: PlayerSlotId,
  kind: ItemKind
): void {
  const stats = ensurePlayerStats(world, slotId);
  stats.itemsUsed += 1;
  stats.itemUsageByKind[kind] = (stats.itemUsageByKind[kind] ?? 0) + 1;
}

/**
 * 步首处理到期道具效果：
 * 以当前战斗时刻为有效期上界（expiresAtBattleTime <= battleTime 即刻失效，
 * 因此过期道具无法在同一模拟步再开火）。
 */
export function expireTankEffects(tanks: TankEntity[], battleTime: number): void {
  for (let i = 0; i < tanks.length; i += 1) {
    const tank = tanks[i];
    if (tank.shield && tank.shield.expiresAtBattleTime <= battleTime) {
      tank.shield = null;
    }
    if (tank.offense && tank.offense.expiresAtBattleTime <= battleTime) {
      tank.offense = null;
    }
  }
}

/**
 * 将指定道具应用到坦克（护盾与进攻槽独立并存；同槽进攻道具直接替换旧道具）。
 */
export function applyItemPickup(
  tank: TankEntity,
  kind: ItemKind,
  battleTime: number,
  rules: TankBattleRules
): void {
  if (kind === 'shield') {
    tank.shield = {
      expiresAtBattleTime: battleTime + rules.shieldDurationSeconds,
      durationSeconds: rules.shieldDurationSeconds,
    };
    return;
  }

  if (kind === 'rapid_fire') {
    tank.offense = {
      kind: 'rapid_fire',
      expiresAtBattleTime: battleTime + rules.rapidFireDurationSeconds,
      durationSeconds: rules.rapidFireDurationSeconds,
      remainingShots: rules.rapidFireMaxShots,
      maxShots: rules.rapidFireMaxShots,
    };
    return;
  }

  if (kind === 'shotgun') {
    tank.offense = {
      kind: 'shotgun',
      expiresAtBattleTime: battleTime + rules.shotgunDurationSeconds,
      durationSeconds: rules.shotgunDurationSeconds,
    };
    return;
  }

  // 单次进攻道具：激光、追踪弹、破片弹、地雷
  tank.offense = {
    kind,
    expiresAtBattleTime: battleTime + rules.singleUseHoldLimitSeconds,
    durationSeconds: rules.singleUseHoldLimitSeconds,
  };
}

/**
 * 处理坦克与地上待拾取道具的接触。
 * 多名玩家同时接触同一道具时，以更近（更早接触）者获胜，完全相同时用回合确定性随机裁决。
 */
export function processItemPickups(
  world: TankWorldState,
  roundRng: DeterministicRng,
  sounds: SoundEventKind[]
): void {
  const pickupDist = TANK_RADIUS + DROP_PICKUP_RADIUS;
  const pickupDistSq = pickupDist * pickupDist;

  for (let dIdx = world.drops.length - 1; dIdx >= 0; dIdx -= 1) {
    const drop = world.drops[dIdx];
    const candidates: Array<{ tank: TankEntity; distSq: number }> = [];

    for (let tIdx = 0; tIdx < world.tanks.length; tIdx += 1) {
      const tank = world.tanks[tIdx];
      if (!tank.alive) continue;
      const dx = tank.x - drop.x;
      const dy = tank.y - drop.y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= pickupDistSq) {
        candidates.push({ tank, distSq });
      }
    }

    if (candidates.length === 0) continue;

    let winner = candidates[0];
    for (let i = 1; i < candidates.length; i += 1) {
      const c = candidates[i];
      if (c.distSq < winner.distSq - 1e-4) {
        winner = c;
      } else if (Math.abs(c.distSq - winner.distSq) <= 1e-4) {
        if (roundRng.next() < 0.5) {
          winner = c;
        }
      }
    }

    applyItemPickup(winner.tank, drop.kind, world.battleTime, world.rules);
    const pickerStats = ensurePlayerStats(world, winner.tank.slotId);
    pickerStats.itemsPicked += 1;
    if (drop.kind === 'shield') {
      // 护盾拾取即刻生效，计入道具使用次数
      recordItemUsed(world, winner.tank.slotId, 'shield');
    }
    world.drops.splice(dIdx, 1);
    sounds.push('pickup');
    world.visualCues.push({
      kind: 'pickup',
      x: drop.x,
      y: drop.y,
      colorHex: winner.tank.colorHex,
    });
  }
}

/**
 * 结算一次针对目标坦克的有效命中：
 * - 处于破盾保护期（battleTime < shieldGraceUntil）内不受伤害
 * - 持有护盾时仅破盾、触发破盾保护时间（允许配置为 0）
 * - 否则标记为被淘汰（本步统一收集所有淘汰后再计分）
 */
export function applyDamageToTank(
  tank: TankEntity,
  world: TankWorldState,
  eliminatedSet: Set<string>,
  sounds: SoundEventKind[],
  attackerSlotId?: PlayerSlotId
): 'ignored' | 'shield_broken' | 'eliminated' {
  if (!tank.alive || eliminatedSet.has(tank.slotId)) {
    return 'ignored';
  }

  // 破盾保护期内免伤
  if (world.battleTime < tank.shieldGraceUntil - 1e-9) {
    return 'ignored';
  }

  if (tank.shield) {
    tank.shield = null;
    tank.hitFlashTimer = 0.08;
    if (world.rules.shieldBreakGraceSeconds > 0) {
      tank.shieldGraceUntil = world.battleTime + world.rules.shieldBreakGraceSeconds;
    }
    if (attackerSlotId && attackerSlotId !== tank.slotId) {
      ensurePlayerStats(world, attackerSlotId).hitsLanded += 1;
    }
    sounds.push('shield_break');
    world.hitstopTimer = Math.max(world.hitstopTimer, 0.04);
    world.screenShakeTrauma = Math.min(1, world.screenShakeTrauma + 0.32);
    world.visualCues.push({
      kind: 'shield_break',
      x: tank.x,
      y: tank.y,
      colorHex: tank.colorHex,
    });
    return 'shield_broken';
  }

  eliminatedSet.add(tank.slotId);
  tank.hitFlashTimer = 0.08;
  const victimStats = ensurePlayerStats(world, tank.slotId);
  victimStats.deaths += 1;
  if (attackerSlotId && attackerSlotId !== tank.slotId) {
    const attackerStats = ensurePlayerStats(world, attackerSlotId);
    attackerStats.kills += 1;
    attackerStats.hitsLanded += 1;
  } else if (attackerSlotId === tank.slotId) {
    victimStats.selfEliminations += 1;
  }
  return 'eliminated';
}
