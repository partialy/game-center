import type {
  HudState,
  HudStatusItem,
  PlayerHudEntry,
  RoundBannerInfo,
} from '../../../platform/games/contracts';
import { ITEM_LABELS, type TankWorldState } from '../types';

/**
 * 将坦克世界状态映射为平台 HUD 可直接展示的只读数据。
 * 所有剩余时间均从模拟层的 battleTime 单一来源计算，避免 UI 与模拟各自倒计时。
 */
export function buildTankHudState(world: TankWorldState): HudState {
  const { battleTime, rules } = world;

  const players: PlayerHudEntry[] = world.tanks.map((tank) => {
    const statusItems: HudStatusItem[] = [];

    if (tank.shield) {
      const rem = Math.max(0, tank.shield.expiresAtBattleTime - battleTime);
      statusItems.push({
        id: 'shield',
        label: ITEM_LABELS.shield,
        valueText: `${rem.toFixed(1)}s`,
        remainingSeconds: rem,
        maxSeconds: tank.shield.durationSeconds,
        iconKey: 'shield',
        tone: 'shield',
      });
    }

    if (tank.offense) {
      const rem = Math.max(0, tank.offense.expiresAtBattleTime - battleTime);
      if (tank.offense.kind === 'rapid_fire') {
        statusItems.push({
          id: 'offense',
          label: ITEM_LABELS.rapid_fire,
          valueText: `${tank.offense.remainingShots} 发 · ${rem.toFixed(1)}s`,
          remainingSeconds: rem,
          maxSeconds: tank.offense.durationSeconds,
          remainingCharges: tank.offense.remainingShots,
          maxCharges: tank.offense.maxShots,
          iconKey: 'rapid_fire',
          tone: 'offense',
        });
      } else if (tank.offense.kind === 'shotgun') {
        statusItems.push({
          id: 'offense',
          label: ITEM_LABELS.shotgun,
          valueText: `${rem.toFixed(1)}s`,
          remainingSeconds: rem,
          maxSeconds: tank.offense.durationSeconds,
          iconKey: 'shotgun',
          tone: 'offense',
        });
      } else {
        statusItems.push({
          id: 'offense',
          label: ITEM_LABELS[tank.offense.kind],
          valueText: `单次 · ${rem.toFixed(1)}s`,
          remainingSeconds: rem,
          maxSeconds: tank.offense.durationSeconds,
          remainingCharges: 1,
          maxCharges: 1,
          iconKey: tank.offense.kind,
          tone: 'offense',
        });
      }
    }

    let reloadProgress = 0;
    if (tank.ammo < tank.maxAmmo && tank.nextReloadAt !== null) {
      const timeLeft = Math.max(0, tank.nextReloadAt - battleTime);
      reloadProgress = Math.max(
        0,
        Math.min(1, 1 - timeLeft / Math.max(0.001, rules.reloadIntervalSeconds))
      );
    }

    return {
      slotId: tank.slotId,
      displayName: tank.displayName,
      colorHex: tank.colorHex,
      score: world.scores[tank.slotId] ?? 0,
      alive: tank.alive,
      ammo: tank.ammo,
      maxAmmo: tank.maxAmmo,
      reloadProgress,
      statusItems,
    };
  });

  let roundBanner: RoundBannerInfo | null = null;
  if (world.phase === 'round_over') {
    const winner = world.roundWinnerSlotId
      ? world.tanks.find((t) => t.slotId === world.roundWinnerSlotId) ?? null
      : null;
    roundBanner = {
      roundNumber: world.roundNumber,
      isDraw: winner === null,
      winnerSlotId: world.roundWinnerSlotId,
      winnerName: winner?.displayName ?? null,
      winnerColor: winner?.colorHex ?? null,
      reason: world.roundOverReason,
      nextRoundInSeconds: Math.max(0, world.roundOverTimer),
    };
  }

  const roundTimeRemainingSeconds = rules.roundTimeLimitEnabled
    ? Math.max(0, rules.roundTimeLimitSeconds - battleTime)
    : null;

  return {
    phase: world.phase,
    roundNumber: world.roundNumber,
    targetScore: rules.targetScore,
    countdownSeconds: Math.max(0, world.countdownRemaining),
    battleElapsedSeconds: battleTime,
    roundTimeRemainingSeconds,
    mapCode: world.maze.mapCode,
    players,
    roundBanner,
  };
}
