import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REEL_ITEM_PITCH_PX,
  buildLobbyCatalog,
  clampReelIndex,
  computeReelTrackOffset,
  computeWheelStep,
  stepReelIndex,
} from './lobbyReel';
import { tankBattleGame } from '../../games/tank-battle';

test('1. buildLobbyCatalog 将真实注册游戏置于首位并附带可切换的预览目录', () => {
  const catalog = buildLobbyCatalog([tankBattleGame]);
  assert.ok(catalog.length >= 4, '录像带目录应包含多个可供滚动切换的游戏项');
  assert.equal(catalog[0].id, 'tank-battle');
  assert.equal(catalog[0].playable, true);
  assert.ok(catalog[0].thumbnailUrl.includes('thumb_tank_battle'));

  const previews = catalog.slice(1);
  assert.ok(previews.every((item) => item.playable === false));
  assert.ok(previews.every((item) => item.thumbnailUrl.startsWith('/src/assets/images/')));
});

test('2. 录像带索引钳制、步进与中央方框位移计算精确对齐', () => {
  assert.equal(clampReelIndex(-3, 4), 0);
  assert.equal(clampReelIndex(9, 4), 3);
  assert.equal(clampReelIndex(2, 4), 2);
  assert.equal(clampReelIndex(1, 0), 0);

  assert.equal(stepReelIndex(0, -1, 4), 0);
  assert.equal(stepReelIndex(0, 1, 4), 1);
  assert.equal(stepReelIndex(3, 1, 4), 3);
  assert.equal(stepReelIndex(2, -1, 4), 1);

  assert.equal(computeReelTrackOffset(0), 0);
  assert.equal(computeReelTrackOffset(2), -2 * REEL_ITEM_PITCH_PX);
});

test('3. computeWheelStep 正确累加微滚动、反向归零并在阈值处触发单步切换', () => {
  // 微小触控板增量未达阈值不触发
  const r1 = computeWheelStep(0, 18, 36);
  assert.deepEqual(r1, { step: 0, nextAccumulated: 18 });

  // 累加跨越阈值触发向下 1 步并清零
  const r2 = computeWheelStep(r1.nextAccumulated, 22, 36);
  assert.deepEqual(r2, { step: 1, nextAccumulated: 0 });

  // 反向滚轮先重置同向累计再判断
  const r3 = computeWheelStep(20, -40, 36);
  assert.deepEqual(r3, { step: -1, nextAccumulated: 0 });

  // 反向微滚动重置之前正累计
  const r4 = computeWheelStep(25, -10, 36);
  assert.deepEqual(r4, { step: 0, nextAccumulated: -10 });
});
