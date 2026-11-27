import test from 'node:test';
import assert from 'node:assert/strict';
import { createStaticInputFrame } from '../../../platform/input/keyboard';
import {
  buildStickmanTerrain,
  destroyTerrainInRadius,
  getTile,
  setTile,
  STICKMAN_GRID_ROWS,
  STICKMAN_TILE_SIZE,
} from '../map/terrain';
import { getDefaultStickmanRules } from '../rules';
import {
  applyMedkitHeal,
  resolveEightWayAim,
  swapFighterWeapon,
} from './combat';
import { StickmanDuelSession } from './world';

function createTestSession(overrides?: Partial<ReturnType<typeof getDefaultStickmanRules>>) {
  const rules = {
    ...getDefaultStickmanRules(),
    countdownSeconds: 0,
    ...overrides,
  };
  return new StickmanDuelSession({
    gameId: 'stickman-duel',
    rulesVersion: 1,
    rules,
    players: [
      {
        slotId: 'p1',
        displayName: 'P1',
        rawName: 'P1',
        colorHex: '#E04B32',
        bindings: {},
      },
      {
        slotId: 'p2',
        displayName: 'P2',
        rawName: 'P2',
        colorHex: '#2F74E0',
        bindings: {},
      },
    ],
    sessionSeed: 123456,
  });
}

test('最底部基岩永久不可破坏，火箭筒爆炸可炸毁上方砖块与短平台', () => {
  const terrain = buildStickmanTerrain('twin_towers', 42, 2);
  // 放置确定的砖块与短平台在 (10, 15) 与 (10, 16)
  setTile(terrain, 10, 15, 'platform');
  setTile(terrain, 10, 16, 'brick');
  assert.equal(getTile(terrain, 10, STICKMAN_GRID_ROWS - 1), 'bedrock');

  const cx = 10.5 * STICKMAN_TILE_SIZE;
  const cy = 16.2 * STICKMAN_TILE_SIZE;
  const destroyed = destroyTerrainInRadius(terrain, cx, cy, 110);

  assert.ok(destroyed.some((d) => d.col === 10 && d.row === 16 && d.kind === 'brick'));
  assert.ok(destroyed.some((d) => d.col === 10 && d.row === 15 && d.kind === 'platform'));
  assert.equal(getTile(terrain, 10, 16), 'empty');
  assert.equal(getTile(terrain, 10, 15), 'empty');
  // 底层基岩绝对不可破坏
  for (let c = 0; c < terrain.cols; c += 1) {
    assert.equal(getTile(terrain, c, STICKMAN_GRID_ROWS - 1), 'bedrock');
  }
});

test('8 向瞄准在无方向输入时沿面朝水平发射，推动摇杆时精确吸附 8 方向', () => {
  assert.deepEqual(resolveEightWayAim(0, 0, 1), { x: 1, y: 0 });
  assert.deepEqual(resolveEightWayAim(0, 0, -1), { x: -1, y: 0 });

  const upRight = resolveEightWayAim(0.8, -0.7, 1);
  assert.ok(Math.abs(upRight.x - Math.SQRT1_2) < 1e-3);
  assert.ok(Math.abs(upRight.y + Math.SQRT1_2) < 1e-3);

  const straightUp = resolveEightWayAim(0.05, -0.95, 1);
  assert.equal(straightUp.x, 0);
  assert.equal(straightUp.y, -1);
});

test('长剑初始 8 点耐久：挥空不掉耐久，命中敌人扣 1 点，归 0 碎裂', () => {
  const session = createTestSession();
  const world = session.getWorldState();
  const [p1, p2] = world.fighters;
  p1.weapon = { kind: 'sword', remaining: 8, max: 8 };
  p1.facing = 1;
  // 先远离对手挥空
  p1.x = 120;
  p2.x = 900;

  session.step(1 / 60, createStaticInputFrame({ p1: { attack: { justPressed: true, held: true } } }));
  for (let i = 0; i < 20; i += 1) {
    session.step(1 / 60, createStaticInputFrame({}));
  }
  assert.equal(p1.weapon?.remaining, 8, '挥空不应扣除长剑耐久');

  // 贴近对手挥剑命中 1 次
  p1.x = 400;
  p1.y = 500;
  p2.x = 442;
  p2.y = 500;
  p1.facing = 1;
  p1.attack = null;
  p1.attackCooldown = 0;
  const beforeHp = p2.hp;

  session.step(1 / 60, createStaticInputFrame({ p1: { attack: { justPressed: true, held: true } } }));
  for (let i = 0; i < 15; i += 1) {
    session.step(1 / 60, createStaticInputFrame({}));
  }
  assert.ok(p2.hp < beforeHp, '挥剑应命中并扣除血量');
  assert.equal(p1.weapon?.remaining, 7, '命中敌人应扣除 1 点耐久');

  // 剩余 1 点耐久时再次命中应碎裂消失
  p1.weapon = { kind: 'sword', remaining: 1, max: 8 };
  p1.x = 400;
  p1.y = 500;
  p2.x = 440;
  p2.y = 500;
  p2.hp = 100;
  p2.hitStunTimer = 0;
  p2.invulnTimer = 0;
  p1.attack = null;
  p1.attackCooldown = 0;
  session.step(1 / 60, createStaticInputFrame({ p1: { attack: { justPressed: true, held: true } } }));
  for (let i = 0; i < 15; i += 1) {
    session.step(1 / 60, createStaticInputFrame({}));
  }
  assert.equal(p1.weapon, null, '长剑耐久归 0 应自动碎裂');
});

test('换武器时原武器保留剩余耐久/弹药抛落地面，血包恢复 25% 且不顶掉手持武器', () => {
  const session = createTestSession();
  const world = session.getWorldState();
  const p1 = world.fighters[0];
  p1.weapon = { kind: 'sword', remaining: 5, max: 8 };

  const newGun = {
    id: 99,
    kind: 'pistol' as const,
    remaining: 3,
    max: 3,
    x: p1.x + 12,
    y: p1.y - 15,
    vx: 0,
    vy: 0,
    radius: 15,
    onGround: true,
    age: 0,
    lifetime: 30,
    pickupLockTimer: 0,
    droppedBySlotId: null,
  };

  const droppedOld = swapFighterWeapon(p1, newGun, 100);
  assert.equal(p1.weapon?.kind, 'pistol');
  assert.equal(p1.weapon?.remaining, 3);
  assert.ok(droppedOld !== null);
  assert.equal(droppedOld.kind, 'sword');
  assert.equal(droppedOld.remaining, 5);
  assert.ok(droppedOld.vy < 0, '换下的原武器应向上抛落受重力下落');

  // 血包恢复 25% 血量（100 -> 60 -> 85），不顶掉手枪
  p1.hp = 60;
  const healed = applyMedkitHeal(p1, 25);
  assert.equal(healed, 25);
  assert.equal(p1.hp, 85);
  assert.equal(p1.weapon?.kind, 'pistol');
});

test('手枪 3 发直线飞行无重力，火箭筒 1 发受重力下坠并引爆', () => {
  const session = createTestSession();
  const world = session.getWorldState();
  const [p1, p2] = world.fighters;
  p1.x = 220;
  p1.y = 300;
  p2.x = 950;
  p2.y = 300;
  p1.facing = 1;
  p1.weapon = { kind: 'pistol', remaining: 3, max: 3 };

  session.step(1 / 60, createStaticInputFrame({ p1: { attack: { justPressed: true, held: true } } }));
  for (let i = 0; i < 6; i += 1) {
    session.step(1 / 60, createStaticInputFrame({}));
  }
  const bullet = world.projectiles.find((pr) => pr.kind === 'pistol');
  assert.ok(bullet, '手枪应射出子弹');
  assert.equal(bullet.vy, 0, '手枪子弹水平直线发射且不受重力');
  assert.equal(p1.weapon?.remaining, 2, '手枪发射 1 发后应剩余 2 发');

  // 切换为火箭筒发射
  p1.attack = null;
  p1.attackCooldown = 0;
  p1.weapon = { kind: 'rocket', remaining: 1, max: 1 };
  session.step(1 / 60, createStaticInputFrame({ p1: { attack: { justPressed: true, held: true } } }));
  for (let i = 0; i < 8; i += 1) {
    session.step(1 / 60, createStaticInputFrame({}));
  }
  const rocket = world.projectiles.find((pr) => pr.kind === 'rocket');
  assert.ok(rocket, '火箭筒应发射火箭弹');
  assert.ok(rocket.vy > 0, '火箭弹受重力影响应出现向下速度分量');
  assert.equal(p1.weapon, null, '火箭筒 1 发打完后应自动清空武器槽');
});
