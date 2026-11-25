import type { DeterministicRng } from '../map/rng';
import {
  CELL_SIZE,
  type ItemKind,
  type TankBattleRules,
  type TankWorldState,
} from '../types';

interface WeightedItem {
  kind: ItemKind;
  weight: number;
}

export function getEnabledWeightedItems(rules: TankBattleRules): WeightedItem[] {
  const entries: Array<[boolean, ItemKind, number]> = [
    [rules.enableShield, 'shield', rules.weightShield],
    [rules.enableRapidFire, 'rapid_fire', rules.weightRapidFire],
    [rules.enableShotgun, 'shotgun', rules.weightShotgun],
    [rules.enableLaser, 'laser', rules.weightLaser],
    [rules.enableHoming, 'homing', rules.weightHoming],
    [rules.enableFrag, 'frag', rules.weightFrag],
    [rules.enableMine, 'mine', rules.weightMine],
  ];
  return entries
    .filter(([enabled, , weight]) => enabled && weight > 0)
    .map(([, kind, weight]) => ({ kind, weight }));
}

export function pickWeightedItemKind(
  weighted: WeightedItem[],
  rng: DeterministicRng
): ItemKind | null {
  if (weighted.length === 0) return null;
  let total = 0;
  for (let i = 0; i < weighted.length; i += 1) {
    total += weighted[i].weight;
  }
  if (total <= 0) return null;
  let roll = rng.next() * total;
  for (let i = 0; i < weighted.length; i += 1) {
    roll -= weighted[i].weight;
    if (roll <= 0) return weighted[i].kind;
  }
  return weighted[weighted.length - 1].kind;
}

/** 步首清理已到达留场上限的待拾取道具 */
export function expireFieldDrops(world: TankWorldState): void {
  for (let i = world.drops.length - 1; i >= 0; i -= 1) {
    if (world.drops[i].expiresAtBattleTime <= world.battleTime + 1e-9) {
      world.drops.splice(i, 1);
    }
  }
}

/**
 * 安排并尝试刷新场上道具：
 * - 全部停用或场上上限为 0 时关闭刷新
 * - 已达场上上限则跳过本次并直接安排下一次，不积压
 * - 只能刷在可达格子中心，避开两辆坦克脚下和已有掉落物格子
 */
export function updateItemDropSpawner(
  world: TankWorldState,
  dropRng: DeterministicRng,
  nextId: () => number
): void {
  const weighted = getEnabledWeightedItems(world.rules);
  if (weighted.length === 0 || world.rules.maxDropsOnField <= 0) {
    world.nextDropAtBattleTime = null;
    return;
  }

  if (world.nextDropAtBattleTime === null) {
    return;
  }

  if (world.battleTime + 1e-9 < world.nextDropAtBattleTime) {
    return;
  }

  // 无论本次是否因满场而跳过，都直接排定下一次尝试时刻（不积压）
  const nextInterval = dropRng.nextFloat(
    world.rules.dropIntervalMinSeconds,
    world.rules.dropIntervalMaxSeconds
  );
  world.nextDropAtBattleTime = world.battleTime + nextInterval;

  if (world.drops.length >= world.rules.maxDropsOnField) {
    return;
  }

  const occupiedCells = new Set<number>();
  for (let i = 0; i < world.drops.length; i += 1) {
    occupiedCells.add(world.drops[i].cellIndex);
  }

  const minTankClearance = CELL_SIZE * 0.9;
  const minTankClearanceSq = minTankClearance * minTankClearance;
  const candidateCells: number[] = [];

  for (let i = 0; i < world.maze.cells.length; i += 1) {
    if (occupiedCells.has(i)) continue;
    const cell = world.maze.cells[i];
    let tooCloseToTank = false;
    for (let t = 0; t < world.tanks.length; t += 1) {
      const tank = world.tanks[t];
      if (!tank.alive) continue;
      const dx = tank.x - cell.centerX;
      const dy = tank.y - cell.centerY;
      if (dx * dx + dy * dy < minTankClearanceSq) {
        tooCloseToTank = true;
        break;
      }
    }
    if (!tooCloseToTank) {
      candidateCells.push(i);
    }
  }

  if (candidateCells.length === 0) return;

  const chosenCellIndex = candidateCells[dropRng.nextInt(0, candidateCells.length - 1)];
  const chosenCell = world.maze.cells[chosenCellIndex];
  const kind = pickWeightedItemKind(weighted, dropRng);
  if (!kind) return;

  world.drops.push({
    id: nextId(),
    kind,
    cellIndex: chosenCellIndex,
    x: chosenCell.centerX,
    y: chosenCell.centerY,
    spawnedAtBattleTime: world.battleTime,
    expiresAtBattleTime: world.battleTime + world.rules.dropLifetimeSeconds,
  });
}
