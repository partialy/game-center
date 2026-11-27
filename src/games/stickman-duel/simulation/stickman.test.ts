import test from 'node:test';
import assert from 'node:assert/strict';
import { createStaticInputFrame } from '../../../platform/input/keyboard';
import { DeterministicRng } from '../../tank-battle/map/rng';
import {
  buildStickmanTerrain,
  CORNER_PLATFORM_SPECS,
  destroyTerrainInRadius,
  findValidDropSurface,
  getTile,
  setTile,
  STICKMAN_GRID_ROWS,
  STICKMAN_TILE_SIZE,
} from '../map/terrain';
import { getDefaultStickmanRules, migrateStickmanRules } from '../rules';
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
  for (let c = 0; c < terrain.cols; c += 1) {
    assert.equal(getTile(terrain, c, STICKMAN_GRID_ROWS - 1), 'bedrock');
  }
});

test('四套地图模板均在四个角落铺设短平台并留足头顶净空，前 4 个出生点直接落在四角短平台上', () => {
  const templates = ['twin_towers', 'stepped_ruins', 'sky_platforms', 'fortress_bunkers'] as const;
  for (const tpl of templates) {
    const terrain = buildStickmanTerrain(tpl, 9001, 4);
    assert.ok(terrain.spawnPoints.length >= 4);
    for (let i = 0; i < CORNER_PLATFORM_SPECS.length; i += 1) {
      const spec = CORNER_PLATFORM_SPECS[i];
      for (let c = spec.startCol; c < spec.startCol + spec.width; c += 1) {
        assert.equal(
          getTile(terrain, c, spec.row),
          'platform',
          `${tpl} 的 ${spec.id} 应铺设短平台`
        );
        assert.equal(getTile(terrain, c, spec.row - 1), 'empty', `${tpl} 的 ${spec.id} 上方 1 格应清空`);
        assert.equal(getTile(terrain, c, spec.row - 2), 'empty', `${tpl} 的 ${spec.id} 上方 2 格应清空`);
      }
      const sp = terrain.spawnPoints[i];
      assert.equal(sp.x, (spec.spawnCol + 0.5) * STICKMAN_TILE_SIZE);
      assert.equal(sp.y, spec.row * STICKMAN_TILE_SIZE);
    }
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

test('长剑默认 5 点耐久：挥空不掉耐久，命中敌人扣 1 点，归 0 碎裂', () => {
  const defaults = getDefaultStickmanRules();
  assert.equal(defaults.swordDurability, 5, '长剑默认耐久应为 5');

  const session = createTestSession();
  const world = session.getWorldState();
  const [p1, p2] = world.fighters;
  p1.weapon = { kind: 'sword', remaining: defaults.swordDurability, max: defaults.swordDurability };
  p1.facing = 1;
  // 先远离对手挥空
  p1.x = 120;
  p2.x = 900;

  session.step(1 / 60, createStaticInputFrame({ p1: { attack: { justPressed: true, held: true } } }));
  for (let i = 0; i < 20; i += 1) {
    session.step(1 / 60, createStaticInputFrame({}));
  }
  assert.equal(p1.weapon?.remaining, 5, '挥空不应扣除长剑耐久');

  // 贴近对手挥剑命中 1 次
  p1.x = 400;
  p1.y = 500;
  p2.x = 442;
  p2.y = 500;
  p1.facing = 1;
  p1.attack = null;
  p1.attackCooldown = 0;
  p2.invulnTimer = 0;
  const beforeHp = p2.hp;

  session.step(1 / 60, createStaticInputFrame({ p1: { attack: { justPressed: true, held: true } } }));
  for (let i = 0; i < 15; i += 1) {
    session.step(1 / 60, createStaticInputFrame({}));
  }
  assert.ok(p2.hp < beforeHp, '挥剑应命中并扣除血量');
  assert.equal(p1.weapon?.remaining, 4, '命中敌人应扣除 1 点耐久（5 -> 4）');

  // 剩余 1 点耐久时再次命中应碎裂消失
  p1.weapon = { kind: 'sword', remaining: 1, max: 5 };
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

test('道具刷新支持随机（默认）与固定中间模式，并从有效点位正上方短距落下而非天顶坠落', () => {
  const defaults = getDefaultStickmanRules();
  assert.equal(defaults.dropSpawnMode, 'random');

  const terrain = buildStickmanTerrain('sky_platforms', 777, 2);
  const midX = terrain.width * 0.5;

  // 中间模式：多次采样均落在中轴附近
  const rngCenter = new DeterministicRng(101);
  for (let i = 0; i < 12; i += 1) {
    const spot = findValidDropSurface(terrain, 'center', rngCenter);
    assert.ok(
      Math.abs(spot.x - midX) <= STICKMAN_TILE_SIZE * 3.5,
      `固定中间模式刷新点应在地图中轴附近，实际 x=${spot.x}`
    );
  }

  // 随机模式：多次采样应覆盖地图多处不同列，不局限于中间
  const rngRand = new DeterministicRng(202);
  const xs = new Set<number>();
  for (let i = 0; i < 20; i += 1) {
    xs.add(findValidDropSurface(terrain, 'random', rngRand).col);
  }
  assert.ok(xs.size >= 5, '随机位置模式应分布到多个不同列');

  // 实战验证：初始刷新道具应在其正下方承重面约 46px 处出现，绝非 y=36 天顶
  const session = createTestSession({ dropSpawnMode: 'center', mapTemplate: 'fortress_bunkers' });
  const world = session.getWorldState();
  assert.equal(world.pickups.length, 1);
  const initialDrop = world.pickups[0];
  assert.ok(
    Math.abs(initialDrop.x - world.terrain.width * 0.5) <= STICKMAN_TILE_SIZE * 3.5,
    '固定中间模式下开局初始道具也应刷新在中间'
  );
  assert.ok(initialDrop.y > 120, `道具应从刷新点位上方短距出现而非天顶，实际 y=${initialDrop.y}`);

  // 短距下落不到 0.45 秒即可稳稳落到承重面
  for (let i = 0; i < 30; i += 1) {
    session.step(1 / 60, createStaticInputFrame({}));
  }
  assert.equal(initialDrop.onGround, true, '短距掉落道具应迅速落稳');
});

test('受伤无敌时长（默认 0.1s 可改）：期间免疫近战、手枪与火箭爆炸的全部伤害与击退，过期后恢复受击', () => {
  const defaults = getDefaultStickmanRules();
  assert.equal(defaults.hurtInvulnSeconds, 0.1);

  const session = createTestSession({ hurtInvulnSeconds: 0.1 });
  const world = session.getWorldState();
  const [p1, p2] = world.fighters;

  // 将两人摆在空旷平地
  p1.x = 360;
  p1.y = 580;
  p2.x = 398;
  p2.y = 580;
  p1.facing = 1;
  p2.facing = -1;
  p2.vx = 0;
  p2.vy = 0;

  // 第一下出拳命中（startup=0.045s，约 3 帧生效），触发 0.1s 无敌
  session.step(1 / 60, createStaticInputFrame({ p1: { attack: { justPressed: true, held: true } } }));
  for (let i = 0; i < 5; i += 1) {
    session.step(1 / 60, createStaticInputFrame({}));
  }
  const hpAfterFirstHit = p2.hp;
  assert.ok(hpAfterFirstHit < 100, '首次攻击应正常扣血');
  assert.ok(p2.invulnTimer > 0, '受击后应激活受伤无敌计时器');

  // 强制保持无敌期，测试手枪与火箭爆炸均完全免疫伤害与击退
  p2.invulnTimer = 0.1;
  p2.vx = 0;
  p2.vy = 0;
  p2.x = 460;
  p2.y = 580;
  world.projectiles.push({
    id: 901,
    kind: 'pistol',
    ownerSlotId: 'p1',
    colorHex: '#E04B32',
    x: 454,
    y: 552,
    prevX: 440,
    prevY: 552,
    vx: 880,
    vy: 0,
    radius: 4.5,
    damage: 25,
    knockback: 265,
    gravityScale: 0,
    age: 0.2,
    maxAge: 2,
    blastRadius: 0,
  });
  // 紧贴目标引爆的火箭弹（撞到地面基岩立刻引爆）
  world.projectiles.push({
    id: 902,
    kind: 'rocket',
    ownerSlotId: 'p1',
    colorHex: '#E04B32',
    x: 460,
    y: (STICKMAN_GRID_ROWS - 1) * STICKMAN_TILE_SIZE - 2,
    prevX: 460,
    prevY: (STICKMAN_GRID_ROWS - 1) * STICKMAN_TILE_SIZE - 8,
    vx: 0,
    vy: 400,
    radius: 7,
    damage: 45,
    knockback: 640,
    gravityScale: 1,
    age: 0.2,
    maxAge: 4,
    blastRadius: 120,
  });

  world.hitstopTimer = 0;
  session.step(1 / 60, createStaticInputFrame({}));
  assert.equal(p2.hp, hpAfterFirstHit, '受伤无敌期间应免疫手枪与火箭爆炸的全部伤害');
  assert.equal(p2.vx, 0, '受伤无敌期间应免疫击退水平速度');

  // 等待无敌时间 0.1s 自然结束，再次受击应正常掉血
  for (let i = 0; i < 10; i += 1) {
    session.step(1 / 60, createStaticInputFrame({}));
  }
  assert.equal(p2.invulnTimer, 0, '超过 0.1s 后无敌状态应结束');

  p1.x = 420;
  p1.y = p2.y;
  p1.facing = 1;
  p1.attack = null;
  p1.attackCooldown = 0;
  p2.x = 455;
  session.step(1 / 60, createStaticInputFrame({ p1: { attack: { justPressed: true, held: true } } }));
  for (let i = 0; i < 12; i += 1) {
    session.step(1 / 60, createStaticInputFrame({}));
  }
  assert.ok(p2.hp < hpAfterFirstHit, '无敌期结束后应恢复正常受击');

  // 验证将 hurtInvulnSeconds 设为 0 时不再赋予无敌
  const noInvulnSession = createTestSession({ hurtInvulnSeconds: 0 });
  const nw = noInvulnSession.getWorldState();
  nw.fighters[0].x = 400;
  nw.fighters[0].y = 580;
  nw.fighters[0].facing = 1;
  nw.fighters[1].x = 435;
  nw.fighters[1].y = 580;
  noInvulnSession.step(1 / 60, createStaticInputFrame({ p1: { attack: { justPressed: true, held: true } } }));
  for (let i = 0; i < 10; i += 1) {
    noInvulnSession.step(1 / 60, createStaticInputFrame({}));
  }
  assert.equal(nw.fighters[1].invulnTimer, 0, 'hurtInvulnSeconds=0 时不应产生无敌帧');
});

test('换武器时原武器保留剩余耐久/弹药抛落地面，血包恢复 25% 且不顶掉手持武器，HUD 武器名不重复拼接余量', () => {
  const session = createTestSession();
  const world = session.getWorldState();
  const p1 = world.fighters[0];
  p1.weapon = { kind: 'sword', remaining: 3, max: 5 };

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
  assert.equal(droppedOld.remaining, 3);
  assert.ok(droppedOld.vy < 0, '换下的原武器应向上抛落受重力下落');

  const hud = session.getHudState();
  const p1Hud = hud.players.find((p) => p.slotId === 'p1');
  assert.equal(p1Hud?.weaponLabel, '手枪', 'weaponLabel 仅应返回纯武器名，避免底栏重复拼接 3/3');
  assert.equal(p1Hud?.weaponCount, 3);
  assert.equal(p1Hud?.weaponMaxCount, 3);

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

test('旧规则平滑迁移：补齐随机刷新与 0.1s 受伤无敌，并将旧默认剑耐久 8 更新为 5', () => {
  const legacy = {
    maxHp: 100,
    swordDurability: 8,
  };
  const res = migrateStickmanRules(legacy);
  assert.equal(res.migrated, true);
  assert.equal(res.rules.dropSpawnMode, 'random');
  assert.equal(res.rules.hurtInvulnSeconds, 0.1);
  assert.equal(res.rules.swordDurability, 5);

  // 用户主动改过的剑耐久（如 12）应保留
  const customLegacy = {
    maxHp: 100,
    swordDurability: 12,
  };
  const resCustom = migrateStickmanRules(customLegacy);
  assert.equal(resCustom.rules.swordDurability, 12);
});
