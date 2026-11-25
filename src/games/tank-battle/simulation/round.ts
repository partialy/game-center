import type {
  MatchResultEvent,
  PlayerConfig,
  PlayerMatchStats,
  PlayerSlotId,
  RoundResultEvent,
  SoundEventKind,
} from '../../../platform/games/contracts';
import { getEnabledWeightedItems } from '../items/drops';
import { createEmptyPlayerMatchStats } from '../items/effects';
import { DeterministicRng } from '../map/rng';
import { selectSpawnPoints } from '../map/spawnPoints';
import type {
  MazeData,
  SpawnPoint,
  TankBattleRules,
  TankEntity,
  TankWorldState,
} from '../types';

export const ROUND_OVER_BANNER_SECONDS = 2.2;

export function createInitialWorld(
  rules: TankBattleRules,
  maze: MazeData,
  players: PlayerConfig[],
  fixedSpawns: SpawnPoint[],
  spawnRng: DeterministicRng
): TankWorldState {
  const scores: Record<PlayerSlotId, number> = {};
  const playerStats: Record<PlayerSlotId, PlayerMatchStats> = {};
  for (const p of players) {
    scores[p.slotId] = 0;
    playerStats[p.slotId] = createEmptyPlayerMatchStats();
  }

  const world: TankWorldState = {
    rules,
    maze,
    phase: rules.countdownSeconds > 0 ? 'countdown' : 'playing',
    roundNumber: 1,
    drawRounds: 0,
    scores,
    playerStats,
    countdownRemaining: rules.countdownSeconds,
    battleTime: 0,
    totalBattleTime: 0,
    roundOverTimer: 0,
    roundOverDuration: ROUND_OVER_BANNER_SECONDS,
    roundWinnerSlotId: null,
    roundOverReason: '',
    nextDropAtBattleTime: null,
    tanks: [],
    projectiles: [],
    mines: [],
    drops: [],
    laserBeams: [],
    explosions: [],
    visualCues: [],
    hitstopTimer: 0,
    screenShakeTrauma: 0,
  };

  resetRoundEntities(world, players, fixedSpawns, spawnRng);
  return world;
}

/**
 * 每回合重置：
 * - 生成满弹坦克，清空上回合的弹体、地雷、掉落物、光迹与道具状态
 * - 沿用同一张地图，按固定（支持每回合轮换）或随机策略为 2~8 名玩家分配出生点
 */
export function resetRoundEntities(
  world: TankWorldState,
  players: PlayerConfig[],
  fixedSpawns: SpawnPoint[],
  spawnRng: DeterministicRng
): void {
  const { rules, maze } = world;
  let roundSpawns: SpawnPoint[];

  if (rules.spawnMode === 'random') {
    roundSpawns = selectSpawnPoints(maze, players.length, spawnRng);
  } else {
    // 固定出生模式：若开启每回合互换，按回合数循环平移出生点顺序
    const shift =
      rules.fixedSpawnSwap && fixedSpawns.length > 0
        ? (world.roundNumber - 1) % fixedSpawns.length
        : 0;
    roundSpawns = fixedSpawns.map(
      (_, idx) => fixedSpawns[(idx + shift) % fixedSpawns.length]
    );
  }

  world.tanks = players.map((player, index): TankEntity => {
    const sp = roundSpawns[index % roundSpawns.length];
    return {
      slotId: player.slotId,
      displayName: player.displayName,
      colorHex: player.colorHex,
      x: sp.x,
      y: sp.y,
      angle: sp.angle,
      alive: true,
      eliminatedAtBattleTime: null,
      ammo: rules.magazineCapacity,
      maxAmmo: rules.magazineCapacity,
      nextReloadAt: null,
      fireReadyAt: 0,
      shieldGraceUntil: 0,
      shield: null,
      offense: null,
      recoilOffset: 0,
      hitFlashTimer: 0,
      treadDistance: 0,
      moveHoldTime: 0,
    };
  });

  world.projectiles = [];
  world.mines = [];
  world.drops = [];
  world.laserBeams = [];
  world.explosions = [];
  world.visualCues = [];
  world.battleTime = 0;
  world.hitstopTimer = 0;
  world.screenShakeTrauma = 0;
  world.roundWinnerSlotId = null;
  world.roundOverReason = '';
  world.countdownRemaining = rules.countdownSeconds;
  world.phase = rules.countdownSeconds > 0 ? 'countdown' : 'playing';

  const enabledItems = getEnabledWeightedItems(rules);
  world.nextDropAtBattleTime =
    enabledItems.length > 0 && rules.maxDropsOnField > 0
      ? rules.firstDropDelaySeconds
      : null;
}

/**
 * 提交本模拟步的所有淘汰并检查胜负或回合超时。
 * 关键边界：
 * - 先统一提交同一步内全部淘汰，再判定剩余存活人数
 * - 只剩 1 人 -> 该玩家得 1 分（包含对手自伤）
 * - 0 人存活 -> 同一步双淘汰，判平局均不得分
 * - 仍有多人存活且达到回合限时 -> 判平局均不得分
 */
export function settleRoundStep(
  world: TankWorldState,
  players: PlayerConfig[],
  eliminatedSet: Set<string>,
  sounds: SoundEventKind[]
): { roundResult?: RoundResultEvent; matchResult?: MatchResultEvent } {
  if (eliminatedSet.size > 0) {
    for (let i = 0; i < world.tanks.length; i += 1) {
      const tank = world.tanks[i];
      if (eliminatedSet.has(tank.slotId) && tank.alive) {
        tank.alive = false;
        tank.eliminatedAtBattleTime = world.battleTime;
        world.explosions.push({
          id: Math.floor(world.battleTime * 10000) + i + 1,
          x: tank.x,
          y: tank.y,
          radius: 46,
          colorHex: tank.colorHex,
          remainingVisualSeconds: 0.48,
          maxVisualSeconds: 0.48,
        });
        world.visualCues.push({
          kind: 'explosion',
          x: tank.x,
          y: tank.y,
          colorHex: tank.colorHex,
          radius: 46,
        });
      }
    }
    sounds.push('explosion');
    world.hitstopTimer = Math.max(world.hitstopTimer, 0.065);
    world.screenShakeTrauma = Math.min(1, world.screenShakeTrauma + 0.65);
  }

  const survivors = world.tanks.filter((t) => t.alive);

  let roundEnded = false;
  let isDraw = false;
  let winnerSlotId: PlayerSlotId | null = null;
  let reason = '';

  if (survivors.length === 1) {
    roundEnded = true;
    winnerSlotId = survivors[0].slotId;
    world.scores[winnerSlotId] = (world.scores[winnerSlotId] ?? 0) + 1;
    reason = `${survivors[0].displayName} 赢得本回合`;
  } else if (survivors.length === 0) {
    roundEnded = true;
    isDraw = true;
    world.drawRounds += 1;
    reason = '同刻淘汰 · 本回合平局';
  } else if (
    world.rules.roundTimeLimitEnabled &&
    world.battleTime + 1e-9 >= world.rules.roundTimeLimitSeconds
  ) {
    roundEnded = true;
    isDraw = true;
    world.drawRounds += 1;
    reason = '回合时间耗尽 · 平局';
  }

  if (!roundEnded) {
    return {};
  }

  world.totalBattleTime += world.battleTime;
  world.roundWinnerSlotId = winnerSlotId;
  world.roundOverReason = reason;

  const roundResult: RoundResultEvent = {
    roundNumber: world.roundNumber,
    winnerSlotId,
    isDraw,
    reason,
    scores: { ...world.scores },
  };

  // 检查是否达到获胜目标分
  if (winnerSlotId && world.scores[winnerSlotId] >= world.rules.targetScore) {
    world.phase = 'match_over';
    sounds.push('match_win');
    const matchResult = buildMatchResult(world, players);
    return { roundResult, matchResult };
  }

  world.phase = 'round_over';
  world.roundOverTimer = world.roundOverDuration;
  sounds.push(isDraw ? 'round_draw' : 'round_win');
  return { roundResult };
}

export function buildMatchResult(
  world: TankWorldState,
  players: PlayerConfig[]
): MatchResultEvent {
  let maxScore = -1;
  for (const p of players) {
    const s = world.scores[p.slotId] ?? 0;
    if (s > maxScore) maxScore = s;
  }
  const winnerSlotIds = players
    .filter((p) => (world.scores[p.slotId] ?? 0) === maxScore)
    .map((p) => p.slotId);

  return {
    gameId: 'tank-battle',
    winnerSlotIds,
    isTie: winnerSlotIds.length > 1,
    scores: { ...world.scores },
    drawRounds: world.drawRounds,
    totalRounds: world.roundNumber,
    totalBattleSeconds: world.totalBattleTime,
    mapCode: world.maze.mapCode,
    players: players.map((p) => {
      const s = world.playerStats[p.slotId] ?? createEmptyPlayerMatchStats();
      return {
        slotId: p.slotId,
        displayName: p.displayName,
        colorHex: p.colorHex,
        score: world.scores[p.slotId] ?? 0,
        controller: p.controller,
        aiModelName: p.aiModelName,
        stats: {
          ...s,
          itemUsageByKind: { ...s.itemUsageByKind },
        },
      };
    }),
  };
}
