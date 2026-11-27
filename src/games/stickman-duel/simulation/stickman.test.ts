import test from 'node:test';
import assert from 'node:assert/strict';
import { createStaticInputFrame } from '../../../platform/input/keyboard';
import { DeterministicRng } from '../../tank-battle/map/rng';
import {
  buildStickmanTerrain,
  buildStickmanTrainingTerrain,
  CORNER_PLATFORM_SPECS,
  destroySingleNearestTile,
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
  computeGrenadeThrowVelocity,
  isProjectileSlashable,
  resolveEightWayAim,
  resolveProjectileHitZone,
  swapFighterWeapon,
} from './combat';
import {
  evaluateWallClimbJump,
  STICKMAN_BOT_MODELS,
} from '../ai/botScripts';
import {
  computeHeadshotRatePercent,
  pickNextParryShotKind,
} from './training';
import { StickmanDuelSession } from './world';
import {
  blendStickmanPose,
  computeTargetStickmanPose,
  solveTwoBoneIK,
  STICK_FOREARM_LEN,
  STICK_SHIN_LEN,
  STICK_THIGH_LEN,
  STICK_UPPER_ARM_LEN,
} from '../render/stickmanPose';

function createTrainingTestSession(initialDrill?: 'free' | 'headshot' | 'parry' | 'combo') {
  const rules = {
    ...getDefaultStickmanRules(),
    countdownSeconds: 3,
    roundTimeLimitEnabled: true,
  };
  return new StickmanDuelSession({
    gameId: 'stickman-duel',
    rulesVersion: 1,
    rules,
    trainingMode: true,
    trainingInitialDrill: initialDrill,
    players: [
      {
        slotId: 'p1',
        displayName: 'P1',
        rawName: 'P1',
        colorHex: '#E04B32',
        bindings: {},
        controller: 'human',
      },
      {
        slotId: 'p2',
        displayName: '不死假人',
        rawName: 'DUMMY',
        colorHex: '#64748B',
        bindings: {},
        controller: 'human',
      },
    ],
    sessionSeed: 20260708,
  });
}

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
    originX: 400,
    originY: 552,
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
    originX: 460,
    originY: 420,
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

test('猎枪默认 2 发子弹，单发在 30° 扇形内随机射出 3 枚小子弹，且同发贴脸多弹命中与后续无敌保护兼容', () => {
  const defaults = getDefaultStickmanRules();
  assert.equal(defaults.enableShotgun, true);
  assert.equal(defaults.shotgunAmmo, 2);
  assert.equal(defaults.shotgunPellets, 3);
  assert.equal(defaults.shotgunSpreadAngleDeg, 30);

  const session = createTestSession();
  const world = session.getWorldState();
  const [p1, p2] = world.fighters;
  p1.x = 220;
  p1.y = 300;
  p2.x = 950;
  p2.y = 300;
  p1.facing = 1;
  p1.weapon = { kind: 'shotgun', remaining: defaults.shotgunAmmo, max: defaults.shotgunAmmo };

  // 第一发：应射出 3 枚小子弹，消耗 1 发（2 -> 1）
  session.step(1 / 60, createStaticInputFrame({ p1: { attack: { justPressed: true, held: true } } }));
  for (let i = 0; i < 4; i += 1) {
    session.step(1 / 60, createStaticInputFrame({}));
  }

  const firstVolley = world.projectiles.filter((pr) => pr.kind === 'shotgun');
  assert.equal(firstVolley.length, 3, '猎枪单发应发出 3 枚小子弹');
  assert.equal(p1.weapon?.remaining, 1, '猎枪发射第 1 发后应剩余 1 发');

  const anglesDeg: number[] = [];
  for (const pellet of firstVolley) {
    assert.equal(pellet.gravityScale, 0, '猎枪小子弹应为直线飞行');
    assert.ok(pellet.volleyId !== undefined, '同发散弹应携带同一 volleyId');
    const deg = (Math.atan2(pellet.vy, pellet.vx) * 180) / Math.PI;
    assert.ok(
      Math.abs(deg) <= 15 + 1e-6,
      `猎枪弹丸方向应在 30° 扇形内（±15°），实际为 ${deg.toFixed(2)}°`
    );
    anglesDeg.push(deg);
  }
  assert.equal(
    new Set(firstVolley.map((p) => p.volleyId)).size,
    1,
    '同一发猎枪的 3 枚弹丸应共享相同 volleyId'
  );

  // 第二发：再射出 3 枚小子弹并打空武器槽（1 -> null）
  world.projectiles.length = 0;
  p1.attack = null;
  p1.attackCooldown = 0;
  p1.x = 220;
  p1.y = 300;
  p1.facing = 1;

  session.step(1 / 60, createStaticInputFrame({ p1: { attack: { justPressed: true, held: true } } }));
  for (let i = 0; i < 4; i += 1) {
    session.step(1 / 60, createStaticInputFrame({}));
  }

  const secondVolley = world.projectiles.filter((pr) => pr.kind === 'shotgun');
  assert.equal(secondVolley.length, 3, '猎枪第 2 发同样应发出 3 枚小子弹');
  assert.equal(p1.weapon, null, '猎枪 2 发打空后应自动卸下武器');
  const secondAnglesDeg = secondVolley.map((p) => (Math.atan2(p.vy, p.vx) * 180) / Math.PI);
  for (const deg of secondAnglesDeg) {
    assert.ok(Math.abs(deg) <= 15 + 1e-6, `第 2 发弹丸方向应在 ±15° 内，实际 ${deg.toFixed(2)}°`);
  }
  // 两次随机发散不应完全一模一样
  assert.notDeepEqual(
    anglesDeg.map((a) => a.toFixed(3)),
    secondAnglesDeg.map((a) => a.toFixed(3)),
    '猎枪 30° 扇形方向应具随机性'
  );

  // 贴脸齐射测试：同一发 3 枚小弹均命中的情况下应叠加伤害，同时后续其它攻击仍被 0.1s 无敌拦截
  const closeSession = createTestSession({ hurtInvulnSeconds: 0.1 });
  const cw = closeSession.getWorldState();
  const [c1, c2] = cw.fighters;
  c1.x = 380;
  c1.y = 580;
  c1.facing = 1;
  c2.x = 420;
  c2.y = 580;
  c2.facing = -1;
  c1.weapon = { kind: 'shotgun', remaining: 2, max: 2 };

  closeSession.step(1 / 60, createStaticInputFrame({ p1: { attack: { justPressed: true, held: true } } }));
  for (let i = 0; i < 6; i += 1) {
    cw.hitstopTimer = 0;
    closeSession.step(1 / 60, createStaticInputFrame({}));
  }
  assert.ok(
    c2.hp <= 100 - defaults.shotgunDamage * 2,
    `贴脸猎枪齐射应至少命中 2 枚以上弹丸，当前剩余血量 ${c2.hp}`
  );
  assert.ok(c2.invulnTimer > 0, '被猎枪命中后仍应触发受伤无敌期以阻挡后续连击');
});

test('猎枪开火产生明显向后后坐力位移，并记录 3 枚散弹从发射点到散开点的半透明视觉轨迹', () => {
  const session = createTestSession();
  const world = session.getWorldState();
  const [p1, p2] = world.fighters;

  // 在空旷地面测试水平向右开枪
  const floorY = (STICKMAN_GRID_ROWS - 1) * STICKMAN_TILE_SIZE;
  for (let c = 4; c <= 18; c += 1) {
    setTile(world.terrain, c, STICKMAN_GRID_ROWS - 2, 'empty');
    setTile(world.terrain, c, STICKMAN_GRID_ROWS - 3, 'empty');
  }
  p1.x = 360;
  p1.y = floorY;
  p1.vx = 0;
  p1.vy = 0;
  p1.onGround = true;
  p1.facing = 1;
  p1.weapon = { kind: 'shotgun', remaining: 2, max: 2 };

  p2.x = 980;
  p2.y = floorY;

  const startX = p1.x;
  session.step(1 / 60, createStaticInputFrame({ p1: { attack: { justPressed: true, held: true } } }));

  let recoilSawNegativeVx = false;
  let recoilSawTimer = false;
  let pelletsChecked = false;
  const seenTrailKeys = new Set<string>();
  const capturedTrails: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (let i = 0; i < 95; i += 1) {
    session.step(1 / 60, createStaticInputFrame({}));
    if (p1.vx < -60) recoilSawNegativeVx = true;
    if (p1.recoilTimer > 0) recoilSawTimer = true;
    const pellets = world.projectiles.filter((pr) => pr.kind === 'shotgun');
    if (pellets.length === 3 && !pelletsChecked) {
      pelletsChecked = true;
      for (const pel of pellets) {
        assert.ok(Number.isFinite(pel.originX) && Number.isFinite(pel.originY), '散弹应记录枪口 originX/originY');
        assert.ok(pel.x > pel.originX, '向右射击时散弹当前坐标应位于发射点右侧');
      }
    }
    for (const tr of world.projectileTrails) {
      const key = `${tr.x1.toFixed(1)},${tr.y1.toFixed(1)}->${tr.x2.toFixed(1)},${tr.y2.toFixed(1)}`;
      if (!seenTrailKeys.has(key)) {
        seenTrailKeys.add(key);
        capturedTrails.push({ x1: tr.x1, y1: tr.y1, x2: tr.x2, y2: tr.y2 });
      }
    }
  }

  assert.equal(recoilSawNegativeVx, true, '猎枪开火应产生反向后坐力速度');
  assert.equal(recoilSawTimer, true, '猎枪开火应激活 recoilTimer 滑动窗口');
  assert.equal(pelletsChecked, true, '应能观测到 3 枚携带发射点坐标的散弹');
  assert.ok(
    p1.x < startX - 8,
    `猎枪后坐力应让角色产生明显向后位移（期望 < ${startX - 8}，实际 ${p1.x.toFixed(1)}）`
  );
  assert.equal(
    capturedTrails.length,
    3,
    `3 枚散弹落点/消散后应累计记录全部 3 条半透明轨迹残影，实际记录 ${capturedTrails.length} 条`
  );
  for (const tr of capturedTrails) {
    assert.ok(Math.hypot(tr.x2 - tr.x1, tr.y2 - tr.y1) > 10, '轨迹应从发射点连向散开点');
  }
});

test('长剑挥砍可砍碎手枪/猎枪/手雷碎片并触发「叮」音效与扣 1 耐久，但不可砍火箭筒', () => {
  assert.equal(isProjectileSlashable('pistol'), true);
  assert.equal(isProjectileSlashable('shotgun'), true);
  assert.equal(isProjectileSlashable('shrapnel'), true);
  assert.equal(isProjectileSlashable('rocket'), false);
  assert.equal(isProjectileSlashable('grenade'), false);

  const session = createTestSession();
  const world = session.getWorldState();
  const [p1, p2] = world.fighters;
  const floorY = (STICKMAN_GRID_ROWS - 1) * STICKMAN_TILE_SIZE;
  for (let c = 4; c <= 14; c += 1) {
    for (let r = 10; r < STICKMAN_GRID_ROWS - 1; r += 1) {
      setTile(world.terrain, c, r, 'empty');
    }
  }
  p1.x = 300;
  p1.y = floorY;
  p1.facing = 1;
  p1.weapon = { kind: 'sword', remaining: 5, max: 5 };
  p2.x = 920;
  p2.y = floorY;

  // 在 p1 挥剑弧线前方放置手枪子弹与 1 枚火箭弹
  const chestY = p1.y - p1.height * 0.54;
  world.projectiles.push(
    {
      id: 1001,
      kind: 'pistol',
      ownerSlotId: 'p2',
      colorHex: '#2F74E0',
      x: p1.x + 56,
      y: chestY,
      prevX: p1.x + 70,
      prevY: chestY,
      originX: p2.x,
      originY: chestY,
      vx: -180,
      vy: 0,
      radius: 4.5,
      damage: 25,
      knockback: 265,
      gravityScale: 0,
      age: 0.2,
      maxAge: 2,
      blastRadius: 0,
    },
    {
      id: 1002,
      kind: 'rocket',
      ownerSlotId: 'p2',
      colorHex: '#2F74E0',
      x: p1.x + 54,
      y: chestY - 8,
      prevX: p1.x + 68,
      prevY: chestY - 8,
      originX: p2.x,
      originY: chestY - 8,
      vx: -140,
      vy: 0,
      radius: 7,
      damage: 45,
      knockback: 640,
      gravityScale: 0,
      age: 0.2,
      maxAge: 3,
      blastRadius: 110,
    }
  );

  // 触发挥剑，收集音效事件
  const allSounds: string[] = [];
  const firstStep = session.step(
    1 / 60,
    createStaticInputFrame({ p1: { attack: { justPressed: true, held: true } } })
  );
  allSounds.push(...firstStep.sounds);
  for (let i = 0; i < 8; i += 1) {
    world.hitstopTimer = 0;
    const res = session.step(1 / 60, createStaticInputFrame({}));
    allSounds.push(...res.sounds);
  }

  assert.equal(
    world.projectiles.some((pr) => pr.id === 1001),
    false,
    '手枪子弹应在挥剑判定窗内被砍碎'
  );
  assert.ok(
    allSounds.includes('stick_sword_clang'),
    `砍碎子弹应播放金属「叮」(stick_sword_clang) 音效，实际音效：${allSounds.join(',')}`
  );
  assert.equal(p1.weapon?.remaining, 4, '砍碎 1 枚子弹应扣除长剑 1 点耐久（5 -> 4）');
  assert.ok(
    world.floatingTexts.some((ft) => ft.text === '叮!'),
    '砍碎子弹应生成「叮!」飘字反馈'
  );

  // 验证火箭弹绝不会被长剑砍碎
  const rocketSlashSession = createTestSession();
  const rw = rocketSlashSession.getWorldState();
  for (let c = 4; c <= 14; c += 1) {
    for (let r = 10; r < STICKMAN_GRID_ROWS - 1; r += 1) {
      setTile(rw.terrain, c, r, 'empty');
    }
  }
  const [rp1, rp2] = rw.fighters;
  rp1.x = 300;
  rp1.y = floorY;
  rp1.facing = 1;
  rp1.weapon = { kind: 'sword', remaining: 5, max: 5 };
  rp2.x = 920;
  rp2.y = floorY;
  rw.projectiles.push({
    id: 2001,
    kind: 'rocket',
    ownerSlotId: 'p2',
    colorHex: '#2F74E0',
    x: rp1.x + 62,
    y: rp1.y - rp1.height * 0.54,
    prevX: rp1.x + 70,
    prevY: rp1.y - rp1.height * 0.54,
    originX: rp2.x,
    originY: rp1.y - rp1.height * 0.54,
    vx: -40,
    vy: 0,
    radius: 7,
    damage: 45,
    knockback: 640,
    gravityScale: 0,
    age: 0.2,
    maxAge: 3,
    blastRadius: 110,
  });
  const rocketSounds: string[] = [];
  rocketSounds.push(
    ...rocketSlashSession
      .step(1 / 60, createStaticInputFrame({ p1: { attack: { justPressed: true, held: true } } }))
      .sounds
  );
  for (let i = 0; i < 6; i += 1) {
    rocketSounds.push(...rocketSlashSession.step(1 / 60, createStaticInputFrame({})).sounds);
  }
  assert.equal(
    rw.projectiles.some((pr) => pr.id === 2001),
    true,
    '火箭弹不应被长剑砍碎，应继续飞行'
  );
  assert.equal(rocketSounds.includes('stick_sword_clang'), false, '对火箭弹挥剑不应触发砍弹音效');
  assert.equal(rp1.weapon?.remaining, 5, '未砍掉火箭弹不应扣除长剑耐久');

  // 耐久剩 1 时砍掉手雷碎片应碎裂清空武器槽
  rp1.attack = null;
  rp1.attackCooldown = 0;
  rp1.weapon = { kind: 'sword', remaining: 1, max: 5 };
  rw.projectiles.length = 0;
  rw.projectiles.push({
    id: 2002,
    kind: 'shrapnel',
    ownerSlotId: 'p2',
    colorHex: '#84CC16',
    x: rp1.x + 54,
    y: rp1.y - rp1.height * 0.54,
    prevX: rp1.x + 64,
    prevY: rp1.y - rp1.height * 0.54,
    originX: rp1.x + 120,
    originY: rp1.y - rp1.height * 0.54,
    vx: -120,
    vy: 0,
    radius: 3.6,
    damage: 9,
    knockback: 135,
    gravityScale: 0,
    age: 0.1,
    maxAge: 1,
    blastRadius: 0,
  });
  rocketSlashSession.step(
    1 / 60,
    createStaticInputFrame({ p1: { attack: { justPressed: true, held: true } } })
  );
  for (let i = 0; i < 8; i += 1) {
    rw.hitstopTimer = 0;
    rocketSlashSession.step(1 / 60, createStaticInputFrame({}));
  }
  assert.equal(rw.projectiles.some((pr) => pr.id === 2002), false, '手雷碎片应可被长剑砍碎');
  assert.equal(rp1.weapon, null, '长剑剩 1 耐久砍碎弹丸后应自动碎裂清空');
});

test('全部直射弹丸（手枪、猎枪、手雷碎片）按部位判定：头部 1.5x、身体 1.0x、腿脚 0.6x', () => {
  // 纯函数校验
  const feetY = 500;
  const height = 56; // top = 444
  assert.deepEqual(resolveProjectileHitZone(444 + 6, feetY, height), {
    zone: 'head',
    multiplier: 1.5,
  });
  assert.deepEqual(resolveProjectileHitZone(444 + 28, feetY, height), {
    zone: 'body',
    multiplier: 1.0,
  });
  assert.deepEqual(resolveProjectileHitZone(444 + 48, feetY, height), {
    zone: 'legs',
    multiplier: 0.6,
  });

  // 实战验证手枪、猎枪、手雷碎片分别命中头 / 身 / 脚
  const cases: Array<{
    kind: 'pistol' | 'shotgun' | 'shrapnel';
    baseDamage: number;
    relY: number;
    expectedDamage: number;
    label: string;
  }> = [
    { kind: 'pistol', baseDamage: 20, relY: 0.12, expectedDamage: 30, label: '手枪爆头 1.5x' },
    { kind: 'pistol', baseDamage: 20, relY: 0.5, expectedDamage: 20, label: '手枪打身 1.0x' },
    { kind: 'pistol', baseDamage: 20, relY: 0.88, expectedDamage: 12, label: '手枪打脚 0.6x' },
    { kind: 'shotgun', baseDamage: 10, relY: 0.12, expectedDamage: 15, label: '猎枪爆头 1.5x' },
    { kind: 'shotgun', baseDamage: 10, relY: 0.88, expectedDamage: 6, label: '猎枪打脚 0.6x' },
    { kind: 'shrapnel', baseDamage: 10, relY: 0.12, expectedDamage: 15, label: '手雷碎片爆头 1.5x' },
    { kind: 'shrapnel', baseDamage: 10, relY: 0.88, expectedDamage: 6, label: '手雷碎片打脚 0.6x' },
  ];

  for (const tc of cases) {
    const session = createTestSession({ maxHp: 200, hurtInvulnSeconds: 0 });
    const world = session.getWorldState();
    const floorY = (STICKMAN_GRID_ROWS - 1) * STICKMAN_TILE_SIZE;
    // 清空测试区域砖块，防止子弹在命中目标前先撞墙
    for (let c = 3; c <= 18; c += 1) {
      for (let r = 10; r < STICKMAN_GRID_ROWS - 1; r += 1) {
        setTile(world.terrain, c, r, 'empty');
      }
    }
    const [p1, p2] = world.fighters;
    p1.x = 180;
    p1.y = floorY;
    p1.onGround = true;
    p2.x = 500;
    p2.y = floorY;
    p2.vx = 0;
    p2.vy = 0;
    p2.onGround = true;
    p2.hp = 200;
    p2.invulnTimer = 0;

    const hitY = p2.y - p2.height + p2.height * tc.relY;
    world.projectiles.push({
      id: 3000,
      kind: tc.kind,
      ownerSlotId: 'p1',
      colorHex: '#E04B32',
      x: p2.x - 4,
      y: hitY,
      prevX: p2.x - 16,
      prevY: hitY,
      originX: p1.x,
      originY: hitY,
      vx: 600,
      vy: 0,
      radius: 4,
      damage: tc.baseDamage,
      knockback: 180,
      gravityScale: 0,
      age: 0.1,
      maxAge: 2,
      blastRadius: 0,
    });

    session.step(1 / 60, createStaticInputFrame({}));
    assert.equal(
      200 - p2.hp,
      tc.expectedDamage,
      `${tc.label} 期望扣血 ${tc.expectedDamage}，实际扣血 ${200 - p2.hp}`
    );
    if (tc.relY < 0.28) {
      assert.ok(
        world.floatingTexts.some((ft) => ft.text.startsWith('爆头')),
        `${tc.label} 应显示「爆头」暴击飘字`
      );
    }
  }
});

test('碎片手雷默认 2 颗，8 方向抛物线投掷，碰物触发约一格小爆破（仅炸毁命中的单个砖块）并向 6 方向射出 0.3x 直线碎片', () => {
  const defaults = getDefaultStickmanRules();
  assert.equal(defaults.enableGrenade, true);
  assert.equal(defaults.grenadeAmmo, 2);
  assert.equal(defaults.grenadeDamage, 30);
  assert.equal(defaults.grenadeShrapnelMultiplier, 0.3);

  // 验证 8 方向抛物线初速计算
  const horiz = computeGrenadeThrowVelocity(1, 0, 520);
  assert.ok(horiz.vx > 300, '水平投掷应有明显前向速度');
  assert.ok(horiz.vy < -100, '水平投掷应自带轻微上抛弧线');
  const upRight = computeGrenadeThrowVelocity(Math.SQRT1_2, -Math.SQRT1_2, 520);
  assert.ok(upRight.vx > 200 && upRight.vy < -250, '斜上方投掷应呈高抛弧线');

  // 验证单砖爆破工具绝不破坏基岩且至多炸毁 1 个砖块
  const t = buildStickmanTerrain('twin_towers', 123, 2);
  setTile(t, 12, 14, 'brick');
  setTile(t, 13, 14, 'brick');
  setTile(t, 12, 15, 'brick');
  setTile(t, 13, 15, 'brick');
  const hitOne = destroySingleNearestTile(
    t,
    12.4 * STICKMAN_TILE_SIZE,
    14.4 * STICKMAN_TILE_SIZE,
    42
  );
  assert.ok(hitOne !== null, '碎片手雷小爆破应炸毁命中的单个砖块');
  assert.equal(hitOne.col, 12);
  assert.equal(hitOne.row, 14);
  assert.equal(getTile(t, 12, 14), 'empty');
  assert.equal(getTile(t, 13, 14), 'brick', '相邻砖块不应被一并炸毁');
  assert.equal(getTile(t, 12, 15), 'brick', '下方砖块不应被一并炸毁');

  // 基岩不可破坏（清空上方紧邻空域后直接炸基岩）
  setTile(t, 11, STICKMAN_GRID_ROWS - 2, 'empty');
  setTile(t, 12, STICKMAN_GRID_ROWS - 2, 'empty');
  setTile(t, 13, STICKMAN_GRID_ROWS - 2, 'empty');
  const hitBedrock = destroySingleNearestTile(
    t,
    12.5 * STICKMAN_TILE_SIZE,
    (STICKMAN_GRID_ROWS - 0.5) * STICKMAN_TILE_SIZE,
    42
  );
  assert.equal(hitBedrock, null, '碎片手雷不可破坏最底层基岩');
  assert.equal(getTile(t, 12, STICKMAN_GRID_ROWS - 1), 'bedrock');

  // 实战投掷与触碰砖块引爆测试
  const session = createTestSession({ maxHp: 200 });
  const world = session.getWorldState();
  const [p1, p2] = world.fighters;
  const floorY = (STICKMAN_GRID_ROWS - 1) * STICKMAN_TILE_SIZE;

  // 清空中央区域并摆放一个 2×2 砖块簇作为目标墙
  for (let c = 6; c <= 20; c += 1) {
    for (let r = 8; r < STICKMAN_GRID_ROWS - 1; r += 1) {
      setTile(world.terrain, c, r, 'empty');
    }
  }
  setTile(world.terrain, 14, 15, 'brick');
  setTile(world.terrain, 15, 15, 'brick');
  setTile(world.terrain, 14, 16, 'brick');
  setTile(world.terrain, 15, 16, 'brick');

  p1.x = 10 * STICKMAN_TILE_SIZE;
  p1.y = floorY;
  p1.facing = 1;
  p1.weapon = { kind: 'grenade', remaining: 2, max: 2 };

  // 将 p2 摆在远处（距爆点 > 160px），验证小爆破本身不波及远处角色
  p2.x = 20 * STICKMAN_TILE_SIZE;
  p2.y = floorY;
  p2.hp = 200;

  // 投掷第一颗手雷
  session.step(1 / 60, createStaticInputFrame({ p1: { attack: { justPressed: true, held: true } } }));
  let sawGrenadeFalling = false;
  let prevVy = -Infinity;
  let shrapnels: typeof world.projectiles = [];

  for (let i = 0; i < 60; i += 1) {
    world.hitstopTimer = 0;
    session.step(1 / 60, createStaticInputFrame({}));
    const g = world.projectiles.find((pr) => pr.kind === 'grenade');
    if (g) {
      if (g.vy > prevVy) sawGrenadeFalling = true;
      prevVy = g.vy;
    }
    const foundShrapnel = world.projectiles.filter((pr) => pr.kind === 'shrapnel');
    if (foundShrapnel.length > 0) {
      shrapnels = [...foundShrapnel];
      break;
    }
  }

  assert.equal(p1.weapon?.remaining, 1, '投出 1 颗碎片手雷后应剩余 1 颗（2 -> 1）');
  assert.equal(sawGrenadeFalling, true, '碎片手雷飞行过程应受重力呈抛物线运动');
  assert.equal(shrapnels.length, 6, '碎片手雷触碰物体爆破后应向 6 个方向射出 6 枚碎片');

  const expectedShrapnelDmg = Math.max(
    1,
    Math.round(defaults.grenadeDamage * defaults.grenadeShrapnelMultiplier)
  );
  const angles = shrapnels
    .map((s) => {
      assert.equal(s.gravityScale, 0, '碎片应沿直线射出，不受重力影响');
      assert.equal(s.damage, expectedShrapnelDmg, `碎片单枚伤害应为 0.3x (${expectedShrapnelDmg})`);
      return ((Math.atan2(s.vy, s.vx) * 180) / Math.PI + 360) % 360;
    })
    .sort((a, b) => a - b);

  for (let i = 0; i < 6; i += 1) {
    const next = i < 5 ? angles[i + 1] : angles[0] + 360;
    const diff = next - angles[i];
    assert.ok(
      Math.abs(diff - 60) < 1.5,
      `6 枚碎片应均匀分布在 6 个方向（间隔 60°），实际间隔 ${diff.toFixed(2)}°`
    );
  }

  // 核对 2x2 砖块簇中恰好有 1 块被炸毁，其余 3 块完好
  const remainingBricks = [
    getTile(world.terrain, 14, 15),
    getTile(world.terrain, 15, 15),
    getTile(world.terrain, 14, 16),
    getTile(world.terrain, 15, 16),
  ].filter((tile) => tile === 'brick').length;
  assert.equal(remainingBricks, 3, '碎片手雷小爆破应仅炸毁命中的单个砖块（4 -> 3）');
  assert.equal(p2.hp, 200, '碎片手雷一格小爆破不应波及远处角色');
});

test('练习关卡：道场地形、不死假人防淘汰、自动回血与一键重置修复砖墙', () => {
  const dojo = buildStickmanTrainingTerrain(12345);
  assert.equal(getTile(dojo, 28, 15), 'brick', '练习道场右侧应布置可破坏砖墙靶区');
  assert.equal(getTile(dojo, 15, 10), 'platform', '练习道场中空应布置单向短平台');
  assert.equal(getTile(dojo, 0, STICKMAN_GRID_ROWS - 1), 'bedrock', '最底行恒为基岩');

  const session = createTrainingTestSession('free');
  const world = session.getWorldState();
  assert.equal(session.isTrainingMode(), true);
  assert.equal(world.phase, 'playing', '练习关卡应跳过倒计时直入实战');
  assert.equal(world.roundTimeRemainingSeconds, null, '练习关卡不设回合倒计时上限');
  assert.equal(world.mapCode, 'DOJO-TRAIN');

  const [p1, dummy] = world.fighters;
  // 连续重创不死假人至血量归零：应立刻满血恢复，绝不淘汰、绝不结束回合
  dummy.hp = 10;
  p1.x = dummy.x - 40;
  p1.y = dummy.y;
  p1.facing = 1;
  session.dispenseTrainingItem('sword', 'equip');

  const res = session.step(
    1 / 60,
    createStaticInputFrame({ p1: { attack: { justPressed: true, held: true } } })
  );
  assert.equal(res.roundResult, undefined);
  for (let i = 0; i < 8; i += 1) {
    world.hitstopTimer = 0;
    const stepRes = session.step(1 / 60, createStaticInputFrame({}));
    assert.equal(stepRes.roundResult, undefined, '练习关卡绝不应触发回合结束');
    assert.equal(stepRes.matchResult, undefined, '练习关卡绝不应触发比赛结束');
  }
  assert.equal(dummy.alive, true, '不死假人血量清零后必须保持存活');
  assert.equal(dummy.hp, dummy.maxHp, '不死假人血量归零后应立刻回满继续连招');

  // 破坏右侧练习砖墙后调用 resetTrainingArena 应完整修复
  setTile(world.terrain, 28, 15, 'empty');
  assert.equal(getTile(world.terrain, 28, 15), 'empty');
  session.resetTrainingArena(true);
  assert.equal(getTile(world.terrain, 28, 15), 'brick', '一键重置场地应修复被炸毁的练习砖墙');
  assert.equal(session.getTrainingState()?.stats.totalHits, 0, '重置场地应清空专项统计');
});

test('练习关卡：随意发放全部道具（直接装备/空投到场/切空手）与无限弹药开关', () => {
  const session = createTrainingTestSession('free');
  const world = session.getWorldState();
  const [p1] = world.fighters;

  // 1. 直接装备各种武器 + 血包回血 + 切空手
  session.dispenseTrainingItem('shotgun', 'equip');
  assert.equal(p1.weapon?.kind, 'shotgun');
  assert.equal(p1.weapon?.remaining, 2);

  session.dispenseTrainingItem('grenade', 'equip');
  assert.equal(p1.weapon?.kind, 'grenade');
  assert.equal(p1.weapon?.remaining, 2);

  p1.hp = 45;
  session.dispenseTrainingItem('medkit', 'equip');
  assert.equal(p1.hp, p1.maxHp, '直接发放血包应立即恢复满血');

  session.dispenseTrainingItem('unarmed', 'equip');
  assert.equal(p1.weapon, null, '切空手应清空武器槽');

  // 2. 空投到场生成真实物理拾取物，并可一键清空
  session.dispenseTrainingItem('rocket', 'drop');
  session.dispenseTrainingItem('sword', 'drop');
  assert.equal(world.pickups.length, 2, '空投到场应向竞技场生成真实掉落道具');
  session.clearTrainingPickups();
  assert.equal(world.pickups.length, 0, '清空道具应移除场上掉落物');

  // 3. 无限弹药开启时发射手枪不扣弹药
  session.dispenseTrainingItem('pistol', 'equip');
  session.updateTrainingConfig({ infiniteWeapon: true });
  session.step(1 / 60, createStaticInputFrame({ p1: { attack: { justPressed: true, held: true } } }));
  for (let i = 0; i < 6; i += 1) {
    session.step(1 / 60, createStaticInputFrame({}));
  }
  const refreshedP1 = session.getWorldState().fighters[0];
  assert.equal(refreshedP1.weapon?.kind, 'pistol');
  assert.equal(refreshedP1.weapon?.remaining, 3, '开启无限弹药后开火不应扣除手枪子弹');
});

test('练习关卡：爆头专练、砍子弹发球机与连招木桩专项统计准确无误', () => {
  const session = createTrainingTestSession('headshot');
  const world = session.getWorldState();
  const [p1, dummy] = world.fighters;

  // 1. 爆头专练默认装备手枪 + 无限弹药 + 显示部位判定线
  const hsInit = session.getTrainingState()!;
  assert.equal(hsInit.drill, 'headshot');
  assert.equal(hsInit.showHitZones, true);
  assert.equal(hsInit.infiniteWeapon, true);
  assert.equal(p1.weapon?.kind, 'pistol');

  // 向假人头部发射 1 发手枪子弹并验证爆头统计
  world.projectiles.push({
    id: 9001,
    kind: 'pistol',
    ownerSlotId: 'p1',
    colorHex: '#E04B32',
    originX: dummy.x - 100,
    originY: dummy.y - dummy.height + 5,
    x: dummy.x - 30,
    y: dummy.y - dummy.height + 5,
    prevX: dummy.x - 40,
    prevY: dummy.y - dummy.height + 5,
    vx: 700,
    vy: 0,
    radius: 4.5,
    damage: 25,
    knockback: 265,
    gravityScale: 0,
    age: 0.2,
    maxAge: 2,
    blastRadius: 0,
  });
  for (let i = 0; i < 6; i += 1) {
    world.hitstopTimer = 0;
    session.step(1 / 60, createStaticInputFrame({}));
  }
  const hsAfter = session.getTrainingState()!;
  assert.equal(hsAfter.stats.headshots, 1, '击中假人头部应计入爆头次数');
  assert.equal(hsAfter.stats.headshotStreak, 1);
  assert.equal(computeHeadshotRatePercent(hsAfter.stats), 100);

  // 2. 切换至砍子弹专练：自动装备长剑，发球机可手动触发发射，挥剑斩弹记录斩弹连击
  session.setTrainingDrill('parry');
  assert.equal(p1.weapon?.kind, 'sword');
  assert.equal(pickNextParryShotKind('mixed', 4), 'rocket', '混合模式第 5 拍应包含不可砍火箭');

  session.triggerTrainingVolley();
  for (let i = 0; i < 32; i += 1) {
    session.step(1 / 60, createStaticInputFrame({}));
  }
  assert.ok(
    world.projectiles.some((pr) => pr.ownerSlotId === 'p2'),
    '砍子弹发球机预警结束后应朝玩家射出实弹'
  );

  // 在玩家身前放入一枚来袭子弹并挥剑砍碎
  world.projectiles.length = 0;
  p1.facing = 1;
  world.projectiles.push({
    id: 9002,
    kind: 'pistol',
    ownerSlotId: 'p2',
    colorHex: '#64748B',
    originX: dummy.x,
    originY: p1.y - p1.height * 0.55,
    x: p1.x + 48,
    y: p1.y - p1.height * 0.55,
    prevX: p1.x + 60,
    prevY: p1.y - p1.height * 0.55,
    vx: -200,
    vy: 0,
    radius: 4.5,
    damage: 25,
    knockback: 265,
    gravityScale: 0,
    age: 0.2,
    maxAge: 2,
    blastRadius: 0,
  });
  session.step(1 / 60, createStaticInputFrame({ p1: { attack: { justPressed: true, held: true } } }));
  for (let i = 0; i < 8; i += 1) {
    world.hitstopTimer = 0;
    session.step(1 / 60, createStaticInputFrame({}));
  }
  const parryAfter = session.getTrainingState()!;
  assert.equal(parryAfter.stats.parries, 1, '练习模式下斩碎来袭子弹应累加斩弹次数');
  assert.equal(parryAfter.stats.parryStreak, 1);
  assert.equal(p1.weapon?.remaining, 5, '砍子弹专练默认无限耐久，斩弹后剑耐久保持满值');

  // 3. 切换至连招木桩：开启 0s 无敌连招并统计多段连击
  session.setTrainingDrill('combo');
  session.updateTrainingConfig({ zeroHurtInvuln: true });
  p1.x = dummy.x - 32;
  p1.y = dummy.y;
  p1.facing = 1;
  session.step(1 / 60, createStaticInputFrame({ p1: { attack: { justPressed: true, held: true } } }));
  for (let i = 0; i < 16; i += 1) {
    world.hitstopTimer = 0;
    session.step(1 / 60, createStaticInputFrame({}));
  }
  assert.equal(dummy.invulnTimer, 0, '开启 0s 无敌连招后假人受击不应产生无敌帧');
  const comboAfter = session.getTrainingState()!;
  assert.ok(comboAfter.stats.comboHits >= 1, '连招木桩应实时统计连击段数');
  assert.ok(comboAfter.stats.comboDamage > 0, '连招木桩应实时累计本套连招伤害');
});

test('AI 脚本遇到单跳无法越过的 5 格高墙时，在一段跳顶点附近精准衔接二段跳成功翻越', () => {
  const session = createTrainingTestSession('free');
  const world = session.getWorldState();
  const ts = STICKMAN_TILE_SIZE;

  // 清空中场并在 col=14 筑起 5 格高砖墙（160px > 单跳极限 116px，必须靠二段跳才能翻越）
  for (let r = 0; r < world.terrain.rows - 1; r += 1) {
    for (let c = 0; c < world.terrain.cols; c += 1) {
      setTile(world.terrain, c, r, 'empty');
    }
  }
  const groundY = (world.terrain.rows - 1) * ts;
  const wallCol = 14;
  for (let i = 1; i <= 5; i += 1) {
    setTile(world.terrain, wallCol, world.terrain.rows - 1 - i, 'brick');
  }
  const wallTopY = (world.terrain.rows - 6) * ts;

  // 1. 纯逻辑单元测试：刚起跳高速上升期绝不提前挥霍二段跳，接近顶点再触发二段跳
  const earlyMidAir = evaluateWallClimbJump({
    terrain: world.terrain,
    self: {
      x: wallCol * ts - 18,
      y: groundY - 24,
      vy: -430,
      halfWidth: 10,
      height: 50,
      onGround: false,
      coyoteTimer: 0,
      jumpsUsed: 1,
      maxJumps: 2,
    },
    lookDir: 1,
    movingHorizontally: true,
    goalX: (wallCol + 5) * ts,
    goalY: groundY,
    stuckTimer: 0,
    dodgeJump: false,
  });
  assert.equal(earlyMidAir.wantsJump, false, '一段跳刚离地高速上升段绝不可提前挥霍二段跳');

  const nearApex = evaluateWallClimbJump({
    terrain: world.terrain,
    self: {
      x: wallCol * ts - 18,
      y: groundY - 104,
      vy: -70,
      halfWidth: 10,
      height: 50,
      onGround: false,
      coyoteTimer: 0,
      jumpsUsed: 1,
      maxJumps: 2,
    },
    lookDir: 1,
    movingHorizontally: true,
    goalX: (wallCol + 5) * ts,
    goalY: groundY,
    stuckTimer: 0,
    dodgeJump: false,
  });
  assert.equal(nearApex.wantsJump, true, '接近一段跳顶点且仍未越过 5 格高墙时应精准触发二段跳');

  // 2. 真实物理闭环验证：让内置 AI 追击墙另一侧对手，必须真正触发二段跳并成功翻越高墙
  const [aiFighter, target] = world.fighters;
  aiFighter.x = (wallCol - 2.2) * ts;
  aiFighter.y = groundY;
  aiFighter.vx = 0;
  aiFighter.vy = 0;
  aiFighter.onGround = true;
  aiFighter.facing = 1;

  target.x = (wallCol + 4) * ts;
  target.y = groundY;
  target.vx = 0;
  target.vy = 0;
  target.onGround = true;

  const botModel = STICKMAN_BOT_MODELS.find((m) => m.id === 'stick_hunter') ?? STICKMAN_BOT_MODELS[0];
  const agent = botModel.createAgent(2026);

  let usedDoubleJump = false;
  let clearedWallTop = false;
  let crossedWallX = false;
  let prevHeld: Record<string, boolean> = {};

  for (let frame = 0; frame < 180; frame += 1) {
    const intent = agent.decide(world, aiFighter.slotId, 1 / 60);
    const nextHeld: Record<string, boolean> = {};
    const frameActions: Record<string, { held: boolean; justPressed: boolean }> = {};
    for (const key of Object.keys(intent)) {
      const held = Boolean(intent[key]);
      if (held) nextHeld[key] = true;
      frameActions[key] = { held, justPressed: held && !prevHeld[key] };
    }
    prevHeld = nextHeld;

    session.step(1 / 60, createStaticInputFrame({ [aiFighter.slotId]: frameActions }));
    if (aiFighter.jumpsUsed >= 2) usedDoubleJump = true;
    if (aiFighter.y <= wallTopY + 2) clearedWallTop = true;
    if (aiFighter.x > (wallCol + 0.5) * ts) {
      crossedWallX = true;
      break;
    }
  }

  assert.equal(usedDoubleJump, true, 'AI 遇到 5 格高墙时应实际触发空中二段跳');
  assert.equal(clearedWallTop, true, 'AI 借助二段跳应跃升至 5 格高墙顶部以上');
  assert.equal(crossedWallX, true, 'AI 应顺利翻越 5 格高墙抵达墙体另一侧');
});

test('打击感分层：普通攻击/开枪/斩弹优先作用在人物与局部场景震波，避免整屏高频晃动；重爆破克制全屏微震', () => {
  const session = createTrainingTestSession('free');
  const world = session.getWorldState();
  const [p1, dummy] = world.fighters;

  // 1. 普通近战挥拳命中：全屏不晃动，但受击人物产生局部抖动，且命中点产生局部场景震波
  p1.x = dummy.x - 36;
  p1.y = dummy.y;
  p1.facing = 1;
  session.step(1 / 60, createStaticInputFrame({ p1: { attack: { justPressed: true, held: true } } }));
  for (let i = 0; i < 6; i += 1) {
    world.hitstopTimer = 0;
    session.step(1 / 60, createStaticInputFrame({}));
  }
  assert.equal(world.shakeIntensity, 0, '普通近战命中不应抖动整个屏幕');
  assert.ok(dummy.impactShakeTimer > 0 && dummy.impactShakeIntensity >= 3.5, '受击角色应获得局部抖动与挤压反馈');
  assert.ok(
    world.impactWaves.some((w) => w.kind === 'hit' && Math.hypot(w.x - dummy.x, w.y - (dummy.y - 25)) < 40),
    '命中点附近应产生局部场景震波'
  );

  // 2. 猎枪开火：后坐力反馈作用于开枪者本人与枪口局部震波，全屏保持稳定
  world.impactWaves.length = 0;
  session.dispenseTrainingItem('shotgun', 'equip');
  p1.x = 220;
  p1.facing = 1;
  session.step(1 / 60, createStaticInputFrame({ p1: { attack: { justPressed: true, held: true } } }));
  for (let i = 0; i < 6; i += 1) {
    session.step(1 / 60, createStaticInputFrame({}));
  }
  assert.equal(world.shakeIntensity, 0, '猎枪开火不应导致全屏晃动');
  assert.ok(p1.impactShakeTimer > 0, '猎枪开火应触发角色自身后坐力颤动');
  assert.ok(
    world.impactWaves.some((w) => w.kind === 'muzzle'),
    '猎枪枪口应产生局部冲击波'
  );

  // 3. 长剑斩弹：产生天蓝 parry 局部震波与持剑者局部反馈，不震动整屏
  world.impactWaves.length = 0;
  session.dispenseTrainingItem('sword', 'equip');
  world.projectiles.push({
    id: 9901,
    kind: 'pistol',
    ownerSlotId: 'p2',
    colorHex: '#64748B',
    originX: p1.x + 120,
    originY: p1.y - p1.height * 0.55,
    x: p1.x + 42,
    y: p1.y - p1.height * 0.55,
    prevX: p1.x + 52,
    prevY: p1.y - p1.height * 0.55,
    vx: -180,
    vy: 0,
    radius: 4.5,
    damage: 20,
    knockback: 200,
    gravityScale: 0,
    age: 0.1,
    maxAge: 2,
    blastRadius: 0,
  });
  session.step(1 / 60, createStaticInputFrame({ p1: { attack: { justPressed: true, held: true } } }));
  for (let i = 0; i < 5; i += 1) {
    world.hitstopTimer = 0;
    session.step(1 / 60, createStaticInputFrame({}));
  }
  assert.equal(world.shakeIntensity, 0, '斩弹格挡不应抖动整个屏幕');
  assert.ok(
    world.impactWaves.some((w) => w.kind === 'parry'),
    '斩弹点应产生局部格挡震波'
  );

  // 4. 火箭大爆破：全屏仅保留克制的轻微震动（<= 5.2），同时释放大范围局部场景震波
  world.impactWaves.length = 0;
  world.projectiles.push({
    id: 9902,
    kind: 'rocket',
    ownerSlotId: 'p1',
    colorHex: '#E04B32',
    originX: 500,
    originY: dummy.y - 30,
    x: 500,
    y: dummy.y - 4,
    prevX: 500,
    prevY: dummy.y - 16,
    vx: 0,
    vy: 420,
    radius: 7,
    damage: 45,
    knockback: 600,
    gravityScale: 1,
    age: 0.1,
    maxAge: 4,
    blastRadius: 72,
  });
  for (let i = 0; i < 4; i += 1) {
    world.hitstopTimer = 0;
    session.step(1 / 60, createStaticInputFrame({}));
  }
  assert.ok(world.shakeIntensity > 0 && world.shakeIntensity <= 5.2, '火箭大爆破的全屏微震应严格克制在 5.2px 以内');
  assert.ok(
    world.impactWaves.some((w) => w.kind === 'blast' && w.radius >= 150),
    '火箭爆破应在爆心释放大范围局部场景震波'
  );
});

test('火柴人 2-Bone IK 骨骼与多姿态动作库：步行/疾跑/急转刹步/四阶段滞空/落地缓冲与三段连招轮廓清晰且平滑插值', () => {
  // 1. 2-Bone IK 长度恒定性校验
  const legIK = solveTwoBoneIK(
    { x: 0, y: -20 },
    { x: 8, y: -2 },
    STICK_THIGH_LEN,
    STICK_SHIN_LEN,
    -1
  );
  const thighLen = Math.hypot(legIK.joint.x - 0, legIK.joint.y - -20);
  const shinLen = Math.hypot(legIK.end.x - legIK.joint.x, legIK.end.y - legIK.joint.y);
  assert.ok(Math.abs(thighLen - STICK_THIGH_LEN) < 0.25, `大腿骨长应保持恒定，实际 ${thighLen.toFixed(2)}`);
  assert.ok(Math.abs(shinLen - STICK_SHIN_LEN) < 0.25, `小腿骨长应保持恒定，实际 ${shinLen.toFixed(2)}`);

  const armA = solveTwoBoneIK({ x: 0, y: -38 }, { x: 14, y: -30 }, STICK_UPPER_ARM_LEN, STICK_FOREARM_LEN, 1);
  const armB = solveTwoBoneIK({ x: 0, y: -38 }, { x: 14, y: -30 }, STICK_UPPER_ARM_LEN, STICK_FOREARM_LEN, -1);
  assert.ok(Math.hypot(armA.joint.x - armB.joint.x, armA.joint.y - armB.joint.y) > 4, '相反弯曲方向应翻转手肘朝向');

  // 2. 基于真实 Fighter 快照检查全状态姿态差异
  const session = createTrainingTestSession('free');
  const [f] = session.getWorldState().fighters;
  f.facing = 1;
  f.onGround = true;
  f.vx = 0;
  f.vy = 0;
  f.attack = null;
  f.weapon = null;
  f.hitStunTimer = 0;
  f.takeoffTimer = 0;
  f.landingTimer = 0;
  f.landingStrength = 0;
  f.skidTimer = 0;

  const idleA = computeTargetStickmanPose(f, 0.0, 260);
  const idleB = computeTargetStickmanPose(f, 0.35, 260);
  assert.equal(idleA.locomotion, 'idle');
  assert.ok(Math.abs(idleA.hip.y - idleB.hip.y) > 0.2, '待机姿态应有自然的格斗呼吸重心起伏');

  // 跨过步行动画阈值时脚掌仍应连续移动。
  f.runPhase = 0.9;
  f.vx = 20;
  const slowIdlePose = computeTargetStickmanPose(f, 0.5, 260);
  f.vx = 21;
  const startWalkPose = computeTargetStickmanPose(f, 0.5, 260);
  assert.equal(slowIdlePose.locomotion, 'idle');
  assert.equal(startWalkPose.locomotion, 'walk');
  assert.ok(Math.hypot(
    startWalkPose.frontFoot.x - slowIdlePose.frontFoot.x,
    startWalkPose.frontFoot.y - slowIdlePose.frontFoot.y
  ) < 0.1);

  // 慢走 vs 疾跑
  f.vx = 85;
  const walkPose = computeTargetStickmanPose(f, 0.5, 260);
  assert.equal(walkPose.locomotion, 'walk');

  f.vx = 250;
  const sprintPose = computeTargetStickmanPose(f, 0.5, 260);
  assert.equal(sprintPose.locomotion, 'sprint');
  assert.ok(
    sprintPose.shoulder.x - sprintPose.hip.x > walkPose.shoulder.x - walkPose.hip.x + 1.5,
    '疾跑姿态前倾角应明显大于慢走'
  );

  // 急转刹步
  f.vx = 180;
  f.skidTimer = 0.12;
  const skidPose = computeTargetStickmanPose(f, 0.6, 260);
  assert.equal(skidPose.locomotion, 'skid');
  f.skidTimer = 0;

  // 空中四阶段：起跳拉伸 / 滞空顶点 / 急速下坠 / 二段跳抱膝空翻
  f.onGround = false;
  f.vy = -420;
  f.jumpsUsed = 1;
  f.takeoffTimer = 0.11;
  const risePose = computeTargetStickmanPose(f, 0.7, 260);
  assert.equal(risePose.locomotion, 'jump_rise');
  assert.ok(risePose.poseScaleY > 1.03 && risePose.poseScaleX < 0.97, '起跳瞬态应呈现纵向拉伸弹性');

  f.takeoffTimer = 0;
  f.vy = 15;
  const apexPose = computeTargetStickmanPose(f, 0.8, 260);
  assert.equal(apexPose.locomotion, 'air_apex');

  f.vy = 340;
  const fallPose = computeTargetStickmanPose(f, 0.9, 260);
  assert.equal(fallPose.locomotion, 'air_fall');
  assert.ok(fallPose.frontHand.y < fallPose.shoulder.y, '急速下坠时手臂应被风压抬高保持平衡');

  f.jumpsUsed = 2;
  f.airSpinAngle = 1.4;
  f.vy = -220;
  const tuckPose = computeTargetStickmanPose(f, 1.0, 260);
  assert.equal(tuckPose.locomotion, 'double_jump_tuck');
  assert.ok(tuckPose.frontFoot.y < -8, '二段跳抱膝空翻时双脚应紧凑收拢至腰腹附近');

  // 落地缓冲下蹲
  f.onGround = true;
  f.jumpsUsed = 0;
  f.airSpinAngle = 0;
  f.vx = 0;
  f.vy = 0;
  f.landingTimer = 0.14;
  f.landingStrength = 0.9;
  const landPose = computeTargetStickmanPose(f, 1.1, 260);
  assert.equal(landPose.locomotion, 'landing');
  assert.ok(landPose.hip.y > idleA.hip.y + 2, '落地缓冲时重心应明显下蹲');
  assert.ok(landPose.poseScaleX > 1.03 && landPose.poseScaleY < 0.97, '落地缓冲应产生横向微扁的弹性挤压');
  f.landingTimer = 0;

  // 三段连拳姿态分化（刺拳 vs 上勾拳）
  const punchAttack = {
    kind: 'punch' as const,
    elapsed: 0.08,
    startup: 0.045,
    activeEnd: 0.13,
    totalDuration: 0.24,
    aimX: 1,
    aimY: 0,
    comboStep: 0,
    hitSlotIds: [] as string[],
    projectileFired: false,
  };
  f.attack = punchAttack;
  const jabPose = computeTargetStickmanPose(f, 1.2, 260);
  punchAttack.comboStep = 2;
  const uppercutPose = computeTargetStickmanPose(f, 1.2, 260);
  assert.equal(jabPose.locomotion, 'attack');
  assert.ok(uppercutPose.frontHand.y < jabPose.frontHand.y - 4, '第 3 段上勾拳出拳高度应明显高于第 1 段刺拳');

  // 姿态平滑插值：单帧过渡应落在起止姿态之间且无 NaN
  const blended = blendStickmanPose(idleA, landPose, 1 / 60);
  assert.ok(Number.isFinite(blended.hip.y) && Number.isFinite(blended.frontFoot.y));
  assert.ok(
    blended.hip.y > idleA.hip.y && blended.hip.y < landPose.hip.y,
    '姿态平滑插值应消除单帧生硬跳变'
  );
});

test('物理模拟实时驱动起跳拉伸、落地缓冲与急转刹步动画计时器', () => {
  const session = createTrainingTestSession('free');
  const world = session.getWorldState();
  const [p1] = world.fighters;

  // 清空前方一排便于加速跑动与急转
  const floorY = (world.terrain.rows - 1) * STICKMAN_TILE_SIZE;
  for (let c = 4; c <= 20; c += 1) {
    setTile(world.terrain, c, world.terrain.rows - 2, 'empty');
    setTile(world.terrain, c, world.terrain.rows - 3, 'empty');
  }
  p1.x = 240;
  p1.y = floorY;
  p1.vx = 0;
  p1.vy = 0;
  p1.onGround = true;

  // 1. 起跳应立刻触发 takeoffTimer，落地后应触发 landingTimer 与 landingStrength
  session.step(1 / 60, createStaticInputFrame({ p1: { jump: { justPressed: true, held: true } } }));
  assert.ok(p1.takeoffTimer > 0, '按下跳跃离地瞬间应激活起跳拉伸计时器');
  assert.equal(computeTargetStickmanPose(p1, 0).locomotion, 'jump_rise');

  let sawLanding = false;
  const airPoses = new Set<string>();
  for (let i = 0; i < 90; i += 1) {
    session.step(1 / 60, createStaticInputFrame({}));
    airPoses.add(computeTargetStickmanPose(p1, 0).locomotion);
    if (p1.onGround && p1.landingTimer > 0 && p1.landingStrength > 0.2) {
      sawLanding = true;
      break;
    }
  }
  assert.equal(sawLanding, true, '从空中落回地面时应激活落地缓冲计时与冲击强度');
  assert.ok(airPoses.has('air_apex') && airPoses.has('air_fall'));

  // 2. 高速向右疾跑后猛拉向左应触发急转刹步 skidTimer
  for (let i = 0; i < 25; i += 1) {
    session.step(1 / 60, createStaticInputFrame({ p1: { moveRight: { justPressed: false, held: true } } }));
  }
  assert.ok(p1.vx > 180, '持续向右移动应达到疾跑速度');

  session.step(1 / 60, createStaticInputFrame({ p1: { moveLeft: { justPressed: true, held: true } } }));
  assert.ok(p1.vx > 0 && p1.vx < world.rules.moveSpeed, '反向首帧应先减速');
  assert.ok(p1.skidTimer > 0, '高速疾跑突然反拉方向应触发急转刹步姿态计时器');
});

test('按键和摇杆控制平滑加速与松键减速，低速残余最终归零', () => {
  const session = createTrainingTestSession('free');
  const world = session.getWorldState();
  const [fighter] = world.fighters;
  const dt = 1 / 60;
  const idleInput = createStaticInputFrame({});
  const rightInput = createStaticInputFrame({ p1: { moveRight: { held: true } } });

  for (let c = 4; c <= 16; c += 1) {
    setTile(world.terrain, c, world.terrain.rows - 2, 'empty');
    setTile(world.terrain, c, world.terrain.rows - 3, 'empty');
  }
  fighter.x = 240;
  fighter.y = (world.terrain.rows - 1) * STICKMAN_TILE_SIZE;
  fighter.onGround = true;

  session.step(dt, rightInput);
  const firstVx = fighter.vx;
  assert.ok(firstVx > 0 && firstVx < world.rules.moveSpeed);
  session.step(dt, rightInput);
  assert.ok(fighter.vx > firstVx && fighter.vx - firstVx < firstVx);

  const beforeRelease = fighter.vx;
  session.step(dt, idleInput);
  assert.ok(fighter.vx > 0 && fighter.vx < beforeRelease);
  for (let i = 0; i < 30; i += 1) session.step(dt, idleInput);
  assert.equal(fighter.vx, 0);

  const analogInput = {
    ...idleInput,
    getMoveVector: () => ({ x: 1, y: 0, magnitude: 0.35 }),
  };
  for (let i = 0; i < 24; i += 1) session.step(dt, analogInput);
  assert.ok(Math.abs(fighter.vx - world.rules.moveSpeed * 0.35 * 1.15) < 1);
  assert.equal(computeTargetStickmanPose(fighter, 0).locomotion, 'walk');
});




