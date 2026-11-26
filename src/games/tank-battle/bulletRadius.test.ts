import assert from 'node:assert/strict';
import test from 'node:test';
import type { MatchLaunchSnapshot, PlayerConfig } from '../../platform/games/contracts';
import { createStaticInputFrame } from '../../platform/input/keyboard';
import { applyItemPickup } from './items/effects';
import { getDefaultTankRules } from './rules';
import { TankBattleSession } from './simulation/world';
import {
  FRAG_SHARD_RADIUS,
  NORMAL_BULLET_RADIUS,
  SPECIAL_BULLET_RADIUS,
  type TankBattleRules,
} from './types';

const DT = 1 / 60;
const IDLE_INPUT = createStaticInputFrame({});

function makeSnapshot(ruleOverrides: Partial<TankBattleRules> = {}): MatchLaunchSnapshot<TankBattleRules> {
  const players: PlayerConfig[] = [
    {
      slotId: 'p1',
      displayName: 'Alpha',
      rawName: 'Alpha',
      colorHex: '#D9432B',
      bindings: { forward: 'KeyW', backward: 'KeyS', turnLeft: 'KeyA', turnRight: 'KeyD', fire: 'KeyF' },
    },
    {
      slotId: 'p2',
      displayName: 'Bravo',
      rawName: 'Bravo',
      colorHex: '#2364C7',
      bindings: {
        forward: 'ArrowUp',
        backward: 'ArrowDown',
        turnLeft: 'ArrowLeft',
        turnRight: 'ArrowRight',
        fire: 'Space',
      },
    },
  ];

  return {
    gameId: 'tank-battle',
    rulesVersion: 1,
    rules: {
      ...getDefaultTankRules(),
      countdownSeconds: 0,
      maxDropsOnField: 0,
      ...ruleOverrides,
    },
    players,
    sessionSeed: 0x1a2b3c4d,
  };
}

function stepSeconds(session: TankBattleSession, seconds: number): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) {
    session.step(DT, IDLE_INPUT);
  }
}

test('弹体尺寸规范：普通弹、连发普通弹与散弹减半为 2.5px，特殊弹保持原尺寸', () => {
  assert.equal(NORMAL_BULLET_RADIUS, 2.5);
  assert.equal(SPECIAL_BULLET_RADIUS, 6);
  assert.equal(FRAG_SHARD_RADIUS, 4);

  const session = new TankBattleSession(makeSnapshot());
  const world = session.getWorldState();
  world.maze.walls = world.maze.walls.filter(
    (w) =>
      w.y1 === 0 ||
      w.y1 === world.maze.height ||
      w.x1 === 0 ||
      w.x1 === world.maze.width
  );

  const p1 = world.tanks[0];
  p1.x = 200;
  p1.y = 250;
  p1.angle = 0;
  world.tanks[1].x = 850;
  world.tanks[1].y = 550;

  // 1. 普通弹
  session.step(DT, createStaticInputFrame({ p1: { fire: { justPressed: true } } }));
  assert.equal(world.projectiles[0].source, 'normal');
  assert.equal(world.projectiles[0].radius, 2.5);

  // 2. 连发普通弹
  world.projectiles = [];
  p1.fireReadyAt = 0;
  applyItemPickup(p1, 'rapid_fire', world.battleTime, world.rules);
  session.step(DT, createStaticInputFrame({ p1: { fire: { held: true } } }));
  assert.equal(world.projectiles[0].source, 'rapid_fire');
  assert.equal(world.projectiles[0].radius, 2.5);

  // 3. 散弹（3 颗全为 2.5px）
  world.projectiles = [];
  p1.fireReadyAt = 0;
  p1.ammo = 5;
  applyItemPickup(p1, 'shotgun', world.battleTime, world.rules);
  session.step(DT, createStaticInputFrame({ p1: { fire: { justPressed: true } } }));
  assert.equal(world.projectiles.length, 3);
  assert.ok(world.projectiles.every((pr) => pr.source === 'shotgun' && pr.radius === 2.5));

  // 4. 追踪弹（保持 6px）
  world.projectiles = [];
  p1.fireReadyAt = 0;
  applyItemPickup(p1, 'homing', world.battleTime, world.rules);
  session.step(DT, createStaticInputFrame({ p1: { fire: { justPressed: true } } }));
  assert.equal(world.projectiles[0].source, 'homing');
  assert.equal(world.projectiles[0].radius, 6);

  // 5. 破片母弹（保持原尺寸 7px）与破片碎片（保持原尺寸 4px）
  world.projectiles = [];
  p1.fireReadyAt = 0;
  applyItemPickup(p1, 'frag', world.battleTime, world.rules);
  session.step(DT, createStaticInputFrame({ p1: { fire: { justPressed: true } } }));
  assert.equal(world.projectiles[0].source, 'frag_parent');
  assert.equal(world.projectiles[0].radius, 7);

  stepSeconds(session, 1.15);
  const shards = world.projectiles.filter((pr) => pr.source === 'frag_shard');
  assert.equal(shards.length, 6);
  assert.ok(shards.every((sh) => sh.radius === 4));
});
