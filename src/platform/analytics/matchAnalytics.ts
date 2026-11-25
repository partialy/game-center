import type { MatchResultEvent, PlayerSlotId } from '../games/contracts';
import { createDemoReplayData } from '../replay/replayEngine';

export const ITEM_KIND_DISPLAY: Record<string, { label: string; color: string }> = {
  shield: { label: '护盾', color: '#1F8A5B' },
  rapid_fire: { label: '连发', color: '#C66A15' },
  shotgun: { label: '三连发', color: '#2364C7' },
  laser: { label: '激光', color: '#D9432B' },
  homing: { label: '追踪弹', color: '#7D3C98' },
  frag: { label: '破片弹', color: '#B45309' },
  mine: { label: '地雷', color: '#475569' },
};

export interface PlayerAnalyticsSummary {
  slotId: PlayerSlotId;
  displayName: string;
  colorHex: string;
  score: number;
  kills: number;
  deaths: number;
  selfEliminations: number;
  shotsFired: number;
  hitsLanded: number;
  itemsPicked: number;
  itemsUsed: number;
  /** 击杀率（%）：总击杀 / 总回合数 */
  killRatePct: number;
  /** 回合胜率（%）：得分 / 总回合数 */
  winRatePct: number;
  /** 命中效率（%）：有效命中 / 开火次数 */
  hitRatePct: number;
  /** 回合存活率（%）：(总回合数 - 被淘汰数) / 总回合数 */
  survivalRatePct: number;
  /** 道具使用频率（次 / 分钟） */
  itemFreqPerMin: number;
  /** 场均每回合道具使用数 */
  itemFreqPerRound: number;
  /** 最常使用的道具标签 */
  topItemLabel: string | null;
}

export interface RadarAxisDatum {
  metric: string;
  fullMark: number;
  [slotId: string]: string | number;
}

export interface PieSliceDatum {
  id: string;
  name: string;
  value: number;
  color: string;
  sharePct: number;
  subtitle?: string;
}

export interface MatchAnalyticsModel {
  players: PlayerAnalyticsSummary[];
  radarData: RadarAxisDatum[];
  killSharePie: PieSliceDatum[];
  itemPlayerPie: PieSliceDatum[];
  itemKindPie: PieSliceDatum[];
  totalKills: number;
  totalItemsUsed: number;
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function attachShares(
  rawSlices: Array<{ id: string; name: string; value: number; color: string; subtitle?: string }>
): PieSliceDatum[] {
  const positive = rawSlices.filter((s) => s.value > 0);
  const total = positive.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return [];
  return positive.map((s) => ({
    ...s,
    sharePct: Math.round((s.value / total) * 100),
  }));
}

/**
 * 将比赛结算快照转换为可直接供 Recharts 雷达图与饼图渲染的标准化统计数据。
 */
export function buildMatchAnalytics(result: MatchResultEvent): MatchAnalyticsModel {
  const totalRounds = Math.max(1, result.totalRounds);
  const battleMinutes = Math.max(0, result.totalBattleSeconds) / 60;

  const players: PlayerAnalyticsSummary[] = result.players.map((p) => {
    const s = p.stats;
    const kills = s ? s.kills : p.score;
    const deaths = s ? s.deaths : Math.max(0, totalRounds - p.score);
    const selfEliminations = s ? s.selfEliminations : 0;
    const shotsFired = s ? s.shotsFired : 0;
    const hitsLanded = s ? s.hitsLanded : kills;
    const itemsPicked = s ? s.itemsPicked : 0;
    const itemsUsed = s ? s.itemsUsed : 0;

    let topItemLabel: string | null = null;
    if (s && s.itemUsageByKind) {
      let bestKind: string | null = null;
      let bestCount = 0;
      for (const [kind, count] of Object.entries(s.itemUsageByKind)) {
        if (count > bestCount) {
          bestCount = count;
          bestKind = kind;
        }
      }
      if (bestKind) {
        topItemLabel = ITEM_KIND_DISPLAY[bestKind]?.label ?? bestKind;
      }
    }

    const killRatePct = clampPct((kills / totalRounds) * 100);
    const winRatePct = clampPct((p.score / totalRounds) * 100);
    const hitRatePct =
      shotsFired > 0 ? clampPct((hitsLanded / shotsFired) * 100) : kills > 0 ? 100 : 0;
    const survivalRatePct = clampPct(((totalRounds - deaths) / totalRounds) * 100);
    const itemFreqPerMin =
      battleMinutes > 0.01 ? Number((itemsUsed / battleMinutes).toFixed(1)) : itemsUsed;
    const itemFreqPerRound = Number((itemsUsed / totalRounds).toFixed(2));

    return {
      slotId: p.slotId,
      displayName: p.displayName,
      colorHex: p.colorHex,
      score: p.score,
      kills,
      deaths,
      selfEliminations,
      shotsFired,
      hitsLanded,
      itemsPicked,
      itemsUsed,
      killRatePct,
      winRatePct,
      hitRatePct,
      survivalRatePct,
      itemFreqPerMin,
      itemFreqPerRound,
      topItemLabel,
    };
  });

  // 归一化道具使用频率到 0..100 以便与百分比指标同轴对比
  const maxItemFreq = players.reduce((m, p) => Math.max(m, p.itemFreqPerMin), 0);
  const itemFreqBaseline = Math.max(2, maxItemFreq);

  const makeAxis = (metric: string, selector: (p: PlayerAnalyticsSummary) => number): RadarAxisDatum => {
    const row: RadarAxisDatum = { metric, fullMark: 100 };
    for (const p of players) {
      row[p.slotId] = clampPct(selector(p));
    }
    return row;
  };

  const radarData: RadarAxisDatum[] = [
    makeAxis('击杀率', (p) => p.killRatePct),
    makeAxis('回合胜率', (p) => p.winRatePct),
    makeAxis('道具频率', (p) =>
      maxItemFreq > 0 ? (p.itemFreqPerMin / itemFreqBaseline) * 100 : 0
    ),
    makeAxis('命中效率', (p) => p.hitRatePct),
    makeAxis('存活率', (p) => p.survivalRatePct),
  ];

  // 1. 击杀与回合占比饼图（若双方均无直接击杀则回退为得分占比）
  const totalKills = players.reduce((sum, p) => sum + p.kills, 0);
  const killSlicesRaw = players.map((p) => ({
    id: p.slotId,
    name: `${p.displayName} ${totalKills > 0 ? '击杀' : '得分'}`,
    value: totalKills > 0 ? p.kills : p.score,
    color: p.colorHex,
    subtitle: `击杀率 ${p.killRatePct}%`,
  }));
  if (result.drawRounds > 0) {
    killSlicesRaw.push({
      id: '__draw__',
      name: '平局回合',
      value: result.drawRounds,
      color: '#94A3B8',
      subtitle: `${result.drawRounds} 回合`,
    });
  }
  const killSharePie = attachShares(killSlicesRaw);

  // 2. 各玩家道具使用占比饼图
  const totalItemsUsed = players.reduce((sum, p) => sum + p.itemsUsed, 0);
  const itemPlayerPie = attachShares(
    players.map((p) => ({
      id: p.slotId,
      name: p.displayName,
      value: p.itemsUsed,
      color: p.colorHex,
      subtitle: `${p.itemFreqPerMin} 次/分`,
    }))
  );

  // 3. 全场道具类型分布饼图
  const kindTotals: Record<string, number> = {};
  for (const p of result.players) {
    const map = p.stats?.itemUsageByKind;
    if (!map) continue;
    for (const [kind, count] of Object.entries(map)) {
      if (count > 0) {
        kindTotals[kind] = (kindTotals[kind] ?? 0) + count;
      }
    }
  }
  const itemKindPie = attachShares(
    Object.entries(kindTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([kind, count]) => ({
        id: kind,
        name: ITEM_KIND_DISPLAY[kind]?.label ?? kind,
        value: count,
        color: ITEM_KIND_DISPLAY[kind]?.color ?? '#64748B',
        subtitle: `使用 ${count} 次`,
      }))
  );

  return {
    players,
    radarData,
    killSharePie,
    itemPlayerPie,
    itemKindPie,
    totalKills,
    totalItemsUsed,
  };
}

/** 仅供 ?demoResults=1 验收与预览的确定性对局结算示例 */
export function createDemoMatchResult(): MatchResultEvent {
  return {
    gameId: 'tank-battle',
    winnerSlotIds: ['p1'],
    isTie: false,
    scores: { p1: 5, p2: 3 },
    drawRounds: 1,
    totalRounds: 9,
    totalBattleSeconds: 186,
    mapCode: 'TB1-10x7-08-3A9F0C12',
    players: [
      {
        slotId: 'p1',
        displayName: 'P1',
        colorHex: '#D9432B',
        score: 5,
        stats: {
          kills: 5,
          selfEliminations: 0,
          deaths: 4,
          shotsFired: 22,
          hitsLanded: 9,
          itemsPicked: 7,
          itemsUsed: 6,
          itemUsageByKind: {
            shotgun: 2,
            shield: 2,
            laser: 1,
            frag: 1,
          },
        },
      },
      {
        slotId: 'p2',
        displayName: 'P2',
        colorHex: '#2364C7',
        score: 3,
        stats: {
          kills: 4,
          selfEliminations: 1,
          deaths: 6,
          shotsFired: 26,
          hitsLanded: 7,
          itemsPicked: 5,
          itemsUsed: 4,
          itemUsageByKind: {
            rapid_fire: 2,
            homing: 1,
            mine: 1,
          },
        },
      },
    ],
    replay: createDemoReplayData('TB1-10x7-08-3A9F0C12'),
  };
}
