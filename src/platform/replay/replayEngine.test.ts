import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compactReplayForStorage,
  createDemoReplayData,
  extractTankTrails,
  findAdjacentHighlightIndex,
  formatReplayTimestamp,
  getHighlightEvents,
  interpolateReplayFrame,
  lerpAngleShortest,
  stepReplayIndex,
} from './replayEngine';

test('1. replayEngine 步进钳制、精彩事件跳转与时间戳格式化正确', () => {
  const demo = createDemoReplayData();
  assert.ok(demo.events.length >= 14);
  assert.equal(demo.sampleRateHz, 10);
  assert.ok(demo.walls.length > 0);

  const highlights = getHighlightEvents(demo.events);
  assert.ok(highlights.length >= 8);
  assert.ok(highlights.every((ev) => ev.kind !== 'keyframe'));

  assert.equal(stepReplayIndex(0, -1, demo.events.length), 0);
  assert.equal(stepReplayIndex(demo.events.length - 1, 5, demo.events.length), demo.events.length - 1);
  assert.equal(stepReplayIndex(2, 1, demo.events.length), 3);

  // 从第 0 帧跳到下一个精彩事件应跳过普通 keyframe
  const nextHl = findAdjacentHighlightIndex(demo.events, 0, 1);
  assert.equal(demo.events[nextHl].kind, 'pickup');
  const prevHl = findAdjacentHighlightIndex(demo.events, nextHl, -1);
  assert.equal(prevHl, 0);

  assert.equal(formatReplayTimestamp(65.4), '1:05.4');
});

test('2. interpolateReplayFrame 同回合平滑插值坐标、角度与特效，跨回合不插值', () => {
  // 最短圆弧角度跨越 +-PI 边界
  const mid = lerpAngleShortest(Math.PI - 0.2, -Math.PI + 0.2, 0.5);
  assert.ok(Math.abs(Math.abs(mid) - Math.PI) < 0.01);

  const demo = createDemoReplayData();
  const f0 = demo.events[0]; // round 1
  const f1 = demo.events[1]; // round 1
  const interp = interpolateReplayFrame(f0, f1, 0.5);
  assert.equal(interp.tanks[0].x, (f0.tanks[0].x + f1.tanks[0].x) * 0.5);

  // 激光与爆炸在插值期间应平滑衰减/推进
  const shieldBreakIdx = demo.events.findIndex((e) => e.kind === 'shield_break');
  assert.ok(shieldBreakIdx >= 0);
  const fxInterp = interpolateReplayFrame(
    demo.events[shieldBreakIdx],
    demo.events[shieldBreakIdx + 1],
    0.5
  );
  assert.ok((fxInterp.laserBeams[0]?.alpha ?? 1) < (demo.events[shieldBreakIdx].laserBeams[0]?.alpha ?? 1));
  assert.ok((fxInterp.explosions[0]?.progress ?? 0) > (demo.events[shieldBreakIdx].explosions[0]?.progress ?? 0));

  // 跨回合边界（第 1 回合末帧 -> 第 2 回合首帧）应直接返回 prev 不飞跃插值
  const round1End = demo.events.find((e) => e.roundNumber === 1 && e.kind === 'elimination')!;
  const round2Start = demo.events.find((e) => e.roundNumber === 2 && e.kind === 'round_start')!;
  const cross = interpolateReplayFrame(round1End, round2Start, 0.5);
  assert.equal(cross.tanks[0].x, round1End.tanks[0].x);
  assert.equal(cross.roundNumber, 1);
});

test('3. extractTankTrails 仅提取同回合轨迹，compactReplayForStorage 完整保留全部精彩事件', () => {
  const demo = createDemoReplayData();
  const shieldBreakIdx = demo.events.findIndex((e) => e.kind === 'shield_break');
  const trails = extractTankTrails(demo.events, shieldBreakIdx, demo.events[shieldBreakIdx], 15);
  assert.equal(trails.length, 2);
  assert.ok(trails[0].points.length >= 3);

  // 刚进入第 2 回合首帧时不应混入第 1 回合的轨迹点
  const round2Idx = demo.events.findIndex((e) => e.roundNumber === 2);
  const r2Trails = extractTankTrails(demo.events, round2Idx, demo.events[round2Idx], 15);
  assert.equal(r2Trails.length, 0);

  // 构造超长录像检验持久化压缩：完整保留精彩事件，控制总帧数
  const expandedEvents = Array.from({ length: 300 }, (_, i) => ({
    ...demo.events[0],
    index: i,
    kind: i % 50 === 0 ? ('elimination' as const) : ('keyframe' as const),
    headline: i % 50 === 0 ? `精彩 #${i}` : undefined,
  }));
  const compacted = compactReplayForStorage({ ...demo, events: expandedEvents }, 80);
  assert.ok(compacted.events.length <= 80);
  const keptHighlights = compacted.events.filter((e) => e.kind === 'elimination');
  assert.equal(keptHighlights.length, 6);
});
