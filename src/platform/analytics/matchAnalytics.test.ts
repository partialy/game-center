import assert from 'node:assert/strict';
import test from 'node:test';
import type { MatchResultEvent } from '../games/contracts';
import { buildMatchAnalytics, createDemoMatchResult } from './matchAnalytics';

test('1. buildMatchAnalytics 正确计算击杀率、命中效率、道具使用频率与雷达/饼图数据', () => {
  const demo = createDemoMatchResult();
  const analytics = buildMatchAnalytics(demo);

  assert.equal(analytics.players.length, 2);
  const [p1, p2] = analytics.players;

  // P1: 5 kills / 9 rounds = 56%, 9 hits / 22 shots = 41%, 6 items / 3.1 min ≈ 1.9 次/分
  assert.equal(p1.killRatePct, 56);
  assert.equal(p1.winRatePct, 56);
  assert.equal(p1.hitRatePct, 41);
  assert.equal(p1.survivalRatePct, 56);
  assert.equal(p1.itemFreqPerMin, 1.9);

  // P2: 4 kills / 9 rounds = 44%, 4 items / 3.1 min ≈ 1.3 次/分
  assert.equal(p2.killRatePct, 44);
  assert.equal(p2.itemFreqPerMin, 1.3);

  // 雷达图固定 5 维且数值均在 0..100
  assert.equal(analytics.radarData.length, 5);
  assert.deepEqual(
    analytics.radarData.map((r) => r.metric),
    ['击杀率', '回合胜率', '道具频率', '命中效率', '存活率']
  );
  for (const row of analytics.radarData) {
    assert.ok(typeof row.p1 === 'number' && row.p1 >= 0 && row.p1 <= 100);
    assert.ok(typeof row.p2 === 'number' && row.p2 >= 0 && row.p2 <= 100);
  }

  // 饼图数据总和正确
  assert.equal(analytics.totalKills, 9);
  assert.equal(analytics.totalItemsUsed, 10);
  assert.equal(analytics.killSharePie.length, 3); // P1, P2, 平局回合
  assert.equal(analytics.itemPlayerPie.length, 2);
  assert.ok(analytics.itemKindPie.length >= 4);
});

test('2. buildMatchAnalytics 在无道具使用或缺失 stats 字段时安全降级不出现 NaN', () => {
  const minimalResult: MatchResultEvent = {
    gameId: 'tank-battle',
    winnerSlotIds: ['p1'],
    isTie: false,
    scores: { p1: 3, p2: 1 },
    drawRounds: 0,
    totalRounds: 4,
    totalBattleSeconds: 0,
    mapCode: 'TB1-10x7-08-00000001',
    players: [
      { slotId: 'p1', displayName: 'Alpha', colorHex: '#D9432B', score: 3 },
      { slotId: 'p2', displayName: 'Bravo', colorHex: '#2364C7', score: 1 },
    ],
  };

  const analytics = buildMatchAnalytics(minimalResult);
  assert.equal(analytics.players[0].killRatePct, 75);
  assert.equal(analytics.players[1].killRatePct, 25);
  assert.equal(analytics.totalItemsUsed, 0);
  assert.equal(analytics.itemPlayerPie.length, 0);
  assert.equal(analytics.itemKindPie.length, 0);
  assert.equal(analytics.killSharePie.length, 2);
  for (const row of analytics.radarData) {
    assert.ok(Number.isFinite(row.p1 as number));
    assert.ok(Number.isFinite(row.p2 as number));
  }
});
