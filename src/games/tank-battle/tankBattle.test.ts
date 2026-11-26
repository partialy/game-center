import assert from 'node:assert/strict';
import test from 'node:test';
import type { MatchLaunchSnapshot, PlayerConfig } from '../../platform/games/contracts';
import {
  validateBindings,
  validatePlayerColors,
  validatePlayerName,
} from '../../platform/input/bindings';
import { createStaticInputFrame } from '../../platform/input/keyboard';
import {
  loadGameRules,
  loadPlayerProfiles,
  saveGameRules,
  type StorageLike,
} from '../../platform/settings/preferencesStore';
import { tankBattleGame } from './index';
import { applyItemPickup } from './items/effects';
import { generateMaze, generateMazeFromCodeOrParams } from './map/generateMaze';
import { DeterministicRng } from './map/rng';
import { selectSpawnPair } from './map/spawnPoints';
import {
  encodeMapCode,
  getDefaultTankRules,
  handleTankRuleFieldChange,
  migrateTankRules,
  parseMapCode,
  validateTankRules,
} from './rules';
import { hasLineOfSight } from './simulation/collision';
import { TankBattleSession } from './simulation/world';
import {
  CELL_SIZE,
  FRAG_SHARD_RADIUS,
  NORMAL_BULLET_RADIUS,
  SPECIAL_BULLET_RADIUS,
  TANK_BARREL_LENGTH,
  TANK_RADIUS,
  WALL_THICKNESS,
  type TankBattleRules,
} from './types';

const DT = 1 / 60;

function makePlayers(): PlayerConfig[] {
  return [
    {
      slotId: 'p1',
      displayName: 'Alpha',
      rawName: 'Alpha',
      colorHex: '#D9432B',
      bindings: { ...tankBattleGame.defaultBindingsBySlot.p1 },
    },
    {
      slotId: 'p2',
      displayName: 'Bravo',
      rawName: 'Bravo',
      colorHex: '#2364C7',
      bindings: { ...tankBattleGame.defaultBindingsBySlot.p2 },
    },
  ];
}

function makeSnapshot(
  ruleOverrides: Partial<TankBattleRules> = {},
  seed = 0x1a2b3c4d
): MatchLaunchSnapshot<TankBattleRules> {
  const rules: TankBattleRules = {
    ...getDefaultTankRules(),
    countdownSeconds: 0,
    ...ruleOverrides,
  };
  return {
    gameId: 'tank-battle',
    rulesVersion: tankBattleGame.rulesVersion,
    rules,
    players: makePlayers(),
    sessionSeed: seed,
  };
}

const IDLE_INPUT = createStaticInputFrame({});

function stepSeconds(session: TankBattleSession, seconds: number, input = IDLE_INPUT): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) {
    session.step(DT, input);
  }
}

test('地图编号编码、解析与地形复现，且出生模式不改变墙体布局', () => {
  const code = encodeMapCode({
    version: 1,
    cols: 10,
    rows: 7,
    extraPassages: 8,
    seed: 0x0badf00d,
  });
  const parsed = parseMapCode(code);
  assert.ok(parsed);
  assert.equal(parsed.cols, 10);
  assert.equal(parsed.rows, 7);
  assert.equal(parsed.extraPassages, 8);
  assert.equal(parsed.seed, 0x0badf00d);

  // 改动地形参数会自动生成新地图编号
  const baseRules = { ...getDefaultTankRules(), mapCode: code };
  const changed = handleTankRuleFieldChange(baseRules, 'gridCols', 12);
  assert.notEqual(changed.mapCode, code);
  const parsedChanged = parseMapCode(changed.mapCode);
  assert.equal(parsedChanged?.cols, 12);

  // 固定出生两回合互换 + 同编号切随机出生，三次比对墙体完全一致
  const fixedSession = new TankBattleSession(
    makeSnapshot({ mapCode: code, spawnMode: 'fixed', fixedSpawnSwap: true })
  );
  const w1 = fixedSession.getWorldState();
  const r1P1 = { x: w1.tanks[0].x, y: w1.tanks[0].y };
  const r1P2 = { x: w1.tanks[1].x, y: w1.tanks[1].y };
  assert.equal(hasLineOfSight(w1.maze, r1P1.x, r1P1.y, r1P2.x, r1P2.y), false);

  // 走廊净宽必须允许原地旋转一圈
  assert.ok(CELL_SIZE - WALL_THICKNESS > TANK_BARREL_LENGTH * 2);

  // 强制结束第一回合进入第二回合，检验出生点互换
  w1.tanks[1].alive = false;
  fixedSession.step(DT, IDLE_INPUT);
  assert.equal(w1.phase, 'round_over');
  stepSeconds(fixedSession, 2.3);
  assert.equal(w1.roundNumber, 2);
  assert.equal(w1.tanks[0].x, r1P2.x);
  assert.equal(w1.tanks[0].y, r1P2.y);
  assert.equal(w1.tanks[1].x, r1P1.x);
  assert.equal(w1.tanks[1].y, r1P1.y);

  // 同一编号切换随机出生模式，墙体完全相同
  const randomSession = new TankBattleSession(
    makeSnapshot({ mapCode: code, spawnMode: 'random' })
  );
  assert.deepEqual(randomSession.getWorldState().maze.walls, w1.maze.walls);

  // 多次同编号复现墙体一致
  const m1 = generateMazeFromCodeOrParams({
    mapCode: code,
    cols: 10,
    rows: 7,
    extraPassages: 8,
    fallbackSeed: 1,
  });
  const m2 = generateMaze({ cols: 10, rows: 7, extraPassages: 8, seed: 0x0badf00d });
  assert.deepEqual(m1.walls, m2.walls);
  const pair = selectSpawnPair(m1, new DeterministicRng(42));
  assert.notEqual(pair[0].cellIndex, pair[1].cellIndex);
});

test('普通射击补弹节奏与贴墙自毁判定', () => {
  const session = new TankBattleSession(makeSnapshot());
  const world = session.getWorldState();
  // 保留四周外墙以确保 1 秒内弹丸不提前反弹自毁
  world.maze.walls = world.maze.walls.filter(
    (w) =>
      w.y1 === 0 ||
      w.y1 === world.maze.height ||
      w.x1 === 0 ||
      w.x1 === world.maze.width
  );
  const p1 = world.tanks[0];
  p1.x = 150;
  p1.y = 150;
  p1.angle = 0;
  world.tanks[1].x = 850;
  world.tanks[1].y = 550;

  // 点按开火 1 次 -> 弹夹 9，冷却 0.8s，1s 后补回 1 发
  session.step(DT, createStaticInputFrame({ p1: { fire: { justPressed: true, held: true } } }));
  assert.equal(p1.ammo, 9);
  assert.equal(world.projectiles.length, 1);

  // 0.5s 时仍在冷却内，再次点按不扣弹不生成新弹
  stepSeconds(session, 0.5);
  session.step(DT, createStaticInputFrame({ p1: { fire: { justPressed: true } } }));
  assert.equal(p1.ammo, 9);
  assert.equal(world.projectiles.length, 1);

  // 0.85s 再次开火 -> 弹夹变 8，但补弹进度不重置（t=1.0s 时应回弹至 9）
  stepSeconds(session, 0.35);
  session.step(DT, createStaticInputFrame({ p1: { fire: { justPressed: true } } }));
  assert.equal(p1.ammo, 8);
  stepSeconds(session, 0.2); // 累计 ~1.05s
  assert.equal(p1.ammo, 9);

  // 贴左外墙开火应立即反射并解锁自伤，进而命中自己
  const selfSession = new TankBattleSession(makeSnapshot());
  const sw = selfSession.getWorldState();
  const shooter = sw.tanks[0];
  shooter.x = WALL_THICKNESS / 2 + TANK_RADIUS + 0.5;
  shooter.y = 150;
  shooter.angle = Math.PI; // 直指左外墙
  selfSession.step(DT, createStaticInputFrame({ p1: { fire: { justPressed: true } } }));
  stepSeconds(selfSession, 0.15);
  assert.equal(shooter.alive, false);
});

test('三连发（散弹枪）：2 发弹夹射 3 弹扣 2 发，1 发时不发不扣弹，补至 2 发后可射', () => {
  const session = new TankBattleSession(makeSnapshot());
  const world = session.getWorldState();
  const p1 = world.tanks[0];
  p1.x = 250;
  p1.y = 250;
  p1.angle = 0;

  applyItemPickup(p1, 'shotgun', world.battleTime, world.rules);
  p1.ammo = 2;
  p1.nextReloadAt = world.battleTime + 1;

  // 恰好 2 发时点按：同一步射出左、中、右 3 颗弹丸，弹夹归 0
  session.step(DT, createStaticInputFrame({ p1: { fire: { justPressed: true } } }));
  assert.equal(p1.ammo, 0);
  assert.equal(world.projectiles.length, 3);
  assert.ok(world.projectiles.every((pr) => pr.source === 'shotgun'));

  // 1 发时点按：不发不扣弹
  world.projectiles = [];
  stepSeconds(session, 1.0); // 回弹至 1 发，同时冷却早已完成
  assert.equal(p1.ammo, 1);
  session.step(DT, createStaticInputFrame({ p1: { fire: { justPressed: true } } }));
  assert.equal(p1.ammo, 1);
  assert.equal(world.projectiles.length, 0);

  // 自然补弹至 2 发后再次点按即可射击
  stepSeconds(session, 1.0);
  assert.equal(p1.ammo, 2);
  session.step(DT, createStaticInputFrame({ p1: { fire: { justPressed: true } } }));
  assert.equal(p1.ammo, 0);
  assert.equal(world.projectiles.length, 3);
});

test('子弹抵消：普通弹相撞抵消，散弹侧弹与普通弹互穿，关闭抵消后普通弹互穿', () => {
  const session = new TankBattleSession(makeSnapshot({ normalBulletCancelEnabled: true }));
  const world = session.getWorldState();
  // 把坦克挪到角落避免干扰
  world.tanks[0].x = 50;
  world.tanks[0].y = 50;
  world.tanks[1].x = 950;
  world.tanks[1].y = 650;

  // 同色两颗普通弹迎面相撞 -> 同时抵消
  world.projectiles.push(
    {
      id: 101,
      ownerSlotId: 'p1',
      colorHex: '#D9432B',
      source: 'normal',
      x: 220,
      y: 250,
      vx: 300,
      vy: 0,
      radius: NORMAL_BULLET_RADIUS,
      speed: 300,
      spawnedAtBattleTime: 0,
      expiresAtBattleTime: 10,
      selfDamageUnlocked: true,
      trail: [],
    },
    {
      id: 102,
      ownerSlotId: 'p1',
      colorHex: '#D9432B',
      source: 'normal',
      x: 240,
      y: 250,
      vx: -300,
      vy: 0,
      radius: NORMAL_BULLET_RADIUS,
      speed: 300,
      spawnedAtBattleTime: 0,
      expiresAtBattleTime: 10,
      selfDamageUnlocked: true,
      trail: [],
    },
    // 散弹与普通弹迎面相遇 -> 互不影响继续飞行
    {
      id: 103,
      ownerSlotId: 'p1',
      colorHex: '#D9432B',
      source: 'shotgun',
      x: 420,
      y: 350,
      vx: 300,
      vy: 0,
      radius: NORMAL_BULLET_RADIUS,
      speed: 300,
      spawnedAtBattleTime: 0,
      expiresAtBattleTime: 10,
      selfDamageUnlocked: true,
      trail: [],
    },
    {
      id: 104,
      ownerSlotId: 'p2',
      colorHex: '#2364C7',
      source: 'normal',
      x: 440,
      y: 350,
      vx: -300,
      vy: 0,
      radius: NORMAL_BULLET_RADIUS,
      speed: 300,
      spawnedAtBattleTime: 0,
      expiresAtBattleTime: 10,
      selfDamageUnlocked: true,
      trail: [],
    }
  );

  stepSeconds(session, 0.08);
  const remainingIds = world.projectiles.map((p) => p.id);
  assert.equal(remainingIds.includes(101), false);
  assert.equal(remainingIds.includes(102), false);
  assert.equal(remainingIds.includes(103), true);
  assert.equal(remainingIds.includes(104), true);

  // 关闭抵消开关后，两颗普通弹相互穿过
  const noCancelSession = new TankBattleSession(makeSnapshot({ normalBulletCancelEnabled: false }));
  const nw = noCancelSession.getWorldState();
  nw.tanks[0].x = 50;
  nw.tanks[0].y = 50;
  nw.tanks[1].x = 950;
  nw.tanks[1].y = 650;
  nw.projectiles.push(
    {
      id: 201,
      ownerSlotId: 'p1',
      colorHex: '#D9432B',
      source: 'normal',
      x: 220,
      y: 250,
      vx: 300,
      vy: 0,
      radius: NORMAL_BULLET_RADIUS,
      speed: 300,
      spawnedAtBattleTime: 0,
      expiresAtBattleTime: 10,
      selfDamageUnlocked: true,
      trail: [],
    },
    {
      id: 202,
      ownerSlotId: 'p2',
      colorHex: '#2364C7',
      source: 'normal',
      x: 240,
      y: 250,
      vx: -300,
      vy: 0,
      radius: NORMAL_BULLET_RADIUS,
      speed: 300,
      spawnedAtBattleTime: 0,
      expiresAtBattleTime: 10,
      selfDamageUnlocked: true,
      trail: [],
    }
  );
  stepSeconds(noCancelSession, 0.08);
  assert.equal(nw.projectiles.length, 2);
});

test('连发两种结束条件：满弹 5.6s 射满 15 发结束；空弹按补弹节奏只计实射并于 7s 结束', () => {
  // 场景 A：满弹立即按住开火
  const sFull = new TankBattleSession(makeSnapshot({ maxDropsOnField: 0 }));
  const wFull = sFull.getWorldState();
  const p1Full = wFull.tanks[0];
  const holdFire = createStaticInputFrame({ p1: { fire: { held: true } } });
  applyItemPickup(p1Full, 'rapid_fire', wFull.battleTime, wFull.rules);

  let shotsFiredFull = 0;
  let endedAtFull = -1;
  for (let i = 0; i < 60 * 7; i += 1) {
    const before = wFull.projectiles.length;
    sFull.step(DT, holdFire);
    // 清理弹体防止打死自己/对手中断测试
    if (wFull.projectiles.length > before) {
      shotsFiredFull += wFull.projectiles.length - before;
      wFull.projectiles = [];
    }
    if (p1Full.offense === null && endedAtFull < 0) {
      endedAtFull = wFull.battleTime;
      break;
    }
  }
  assert.equal(shotsFiredFull, 15);
  assert.ok(endedAtFull >= 5.55 && endedAtFull <= 5.75, `expected ~5.6s, got ${endedAtFull}`);

  // 场景 B：空弹夹拾取连发并按住开火
  const sEmpty = new TankBattleSession(makeSnapshot({ maxDropsOnField: 0 }));
  const wEmpty = sEmpty.getWorldState();
  const p1Empty = wEmpty.tanks[0];
  p1Empty.ammo = 0;
  p1Empty.nextReloadAt = wEmpty.battleTime + 1.0;
  applyItemPickup(p1Empty, 'rapid_fire', wEmpty.battleTime, wEmpty.rules);

  let shotsFiredEmpty = 0;
  let endedAtEmpty = -1;
  for (let i = 0; i < 60 * 8; i += 1) {
    const before = wEmpty.projectiles.length;
    sEmpty.step(DT, holdFire);
    if (wEmpty.projectiles.length > before) {
      shotsFiredEmpty += wEmpty.projectiles.length - before;
      wEmpty.projectiles = [];
    }
    if (p1Empty.offense === null && endedAtEmpty < 0) {
      endedAtEmpty = wEmpty.battleTime;
      break;
    }
  }
  assert.ok(shotsFiredEmpty >= 6 && shotsFiredEmpty <= 7);
  assert.ok(endedAtEmpty >= 6.95 && endedAtEmpty <= 7.1, `expected ~7.0s, got ${endedAtEmpty}`);
});

test('护盾破盾保护期、激光、破片弹、地雷（含隔墙遮挡）与同刻双淘汰平局', () => {
  // 1. 护盾 + 激光（零弹药可用）
  const sLaser = new TankBattleSession(makeSnapshot({ maxDropsOnField: 0 }));
  const wLaser = sLaser.getWorldState();
  // 清空内部墙做直线验证
  wLaser.maze.walls = wLaser.maze.walls.filter(
    (w) =>
      w.y1 === 0 ||
      w.y1 === wLaser.maze.height ||
      w.x1 === 0 ||
      w.x1 === wLaser.maze.width
  );
  const t1 = wLaser.tanks[0];
  const t2 = wLaser.tanks[1];
  t1.x = 150;
  t1.y = 250;
  t1.angle = 0;
  t1.ammo = 0; // 零弹药仍可发射单次激光
  t2.x = 450;
  t2.y = 250;
  applyItemPickup(t1, 'laser', wLaser.battleTime, wLaser.rules);
  applyItemPickup(t2, 'shield', wLaser.battleTime, wLaser.rules);

  sLaser.step(DT, createStaticInputFrame({ p1: { fire: { justPressed: true } } }));
  assert.equal(t1.offense, null);
  assert.equal(wLaser.laserBeams.length, 1);
  assert.equal(t2.shield, null); // 护盾被击破
  assert.equal(t2.alive, true); // 击中护盾只破盾不淘汰

  // 2. 破片弹 1.1s 炸出 6 枚碎片，每枚碎片持续 3s 后消失
  const sFrag = new TankBattleSession(makeSnapshot({ maxDropsOnField: 0 }));
  const wFrag = sFrag.getWorldState();
  wFrag.maze.walls = wFrag.maze.walls.filter(
    (w) =>
      w.y1 === 0 ||
      w.y1 === wFrag.maze.height ||
      w.x1 === 0 ||
      w.x1 === wFrag.maze.width
  );
  const fp1 = wFrag.tanks[0];
  fp1.x = 150;
  fp1.y = 150;
  fp1.angle = 0;
  wFrag.tanks[1].x = 850;
  wFrag.tanks[1].y = 550;
  applyItemPickup(fp1, 'frag', wFrag.battleTime, wFrag.rules);
  sFrag.step(DT, createStaticInputFrame({ p1: { fire: { justPressed: true } } }));
  assert.equal(wFrag.projectiles.length, 1);
  assert.equal(wFrag.projectiles[0].source, 'frag_parent');

  stepSeconds(sFrag, 1.15);
  const shards = wFrag.projectiles.filter((p) => p.source === 'frag_shard');
  assert.equal(shards.length, 6);
  // 碎片应自裂开时刻起存活 3s
  assert.ok(
    shards.every((sh) => Math.abs(sh.expiresAtBattleTime - sh.spawnedAtBattleTime - 3) < 1e-6)
  );
  // 将两辆坦克移到安全角落，避免碎片提前击杀导致回合进入 round_over 冻结 battleTime
  fp1.x = 60;
  fp1.y = 640;
  wFrag.tanks[1].x = 940;
  wFrag.tanks[1].y = 60;
  // 2.75s 后碎片仍在场，再过 0.4s（满 3s）全部到期清理
  stepSeconds(sFrag, 2.75);
  assert.ok(wFrag.projectiles.some((p) => p.source === 'frag_shard'));
  stepSeconds(sFrag, 0.4);
  assert.equal(wFrag.projectiles.filter((p) => p.source === 'frag_shard').length, 0);

  // 3. 地雷：0.8s 布防，触发可炸放置者，隔墙安全
  const sMine = new TankBattleSession(makeSnapshot({ maxDropsOnField: 0 }));
  const wMine = sMine.getWorldState();
  // 在 x=300 处放一道竖墙隔开两侧
  wMine.maze.walls = [
    { x1: 0, y1: 0, x2: wMine.maze.width, y2: 0, orientation: 'h' },
    { x1: 0, y1: wMine.maze.height, x2: wMine.maze.width, y2: wMine.maze.height, orientation: 'h' },
    { x1: 0, y1: 0, x2: 0, y2: wMine.maze.height, orientation: 'v' },
    { x1: wMine.maze.width, y1: 0, x2: wMine.maze.width, y2: wMine.maze.height, orientation: 'v' },
    { x1: 300, y1: 0, x2: 300, y2: wMine.maze.height, orientation: 'v' },
  ];
  const m1 = wMine.tanks[0];
  const m2 = wMine.tanks[1];
  m1.x = 270;
  m1.y = 250;
  m1.angle = Math.PI; // 车尾在 x ≈ 302？改为车头朝右，车尾在 x ≈ 238
  m1.angle = 0;
  m2.x = 325; // 隔墙距离仅 55 单位（在爆炸半径 76 内），但被 x=300 墙阻挡
  m2.y = 250;

  applyItemPickup(m1, 'mine', wMine.battleTime, wMine.rules);
  sMine.step(DT, createStaticInputFrame({ p1: { fire: { justPressed: true } } }));
  assert.equal(wMine.mines.length, 1);

  // 未布防期间不会引爆
  stepSeconds(sMine, 0.5);
  assert.equal(wMine.mines.length, 1);
  assert.equal(m1.alive, true);

  // 满 0.8s 布防后，放置者仍在触发半径内 -> 引爆淘汰自己，但隔墙对手安全！
  stepSeconds(sMine, 0.35);
  assert.equal(wMine.mines.length, 0);
  assert.equal(m1.alive, false);
  assert.equal(m2.alive, true);

  // 4. 两人同一步分别中弹 -> 平局无得分，下回合满弹重置
  const sDraw = new TankBattleSession(makeSnapshot({ maxDropsOnField: 0 }));
  const wDraw = sDraw.getWorldState();
  wDraw.tanks[0].x = 200;
  wDraw.tanks[0].y = 200;
  wDraw.tanks[1].x = 500;
  wDraw.tanks[1].y = 200;
  wDraw.tanks[0].ammo = 3;
  // 放置两颗即将同帧命中两车的弹体
  wDraw.projectiles.push(
    {
      id: 901,
      ownerSlotId: 'p2',
      colorHex: '#2364C7',
      source: 'shotgun',
      x: 200,
      y: 200,
      vx: -300,
      vy: 0,
      radius: 5,
      speed: 300,
      spawnedAtBattleTime: 0,
      expiresAtBattleTime: 10,
      selfDamageUnlocked: true,
      trail: [],
    },
    {
      id: 902,
      ownerSlotId: 'p1',
      colorHex: '#D9432B',
      source: 'shotgun',
      x: 500,
      y: 200,
      vx: 300,
      vy: 0,
      radius: 5,
      speed: 300,
      spawnedAtBattleTime: 0,
      expiresAtBattleTime: 10,
      selfDamageUnlocked: true,
      trail: [],
    }
  );
  const res = sDraw.step(DT, IDLE_INPUT);
  assert.equal(res.roundResult?.isDraw, true);
  assert.equal(wDraw.scores.p1, 0);
  assert.equal(wDraw.scores.p2, 0);
  assert.equal(wDraw.drawRounds, 1);

  stepSeconds(sDraw, 2.3);
  assert.equal(wDraw.roundNumber, 2);
  assert.equal(wDraw.tanks[0].ammo, wDraw.rules.magazineCapacity);
  assert.equal(wDraw.mines.length, 0);
});

test('道具刷新与留场时限：战斗时间至 7s 暂停继续后约 1s 刷出，16s 后消失', () => {
  const session = new TankBattleSession(makeSnapshot());
  const world = session.getWorldState();

  stepSeconds(session, 7.0);
  assert.equal(world.drops.length, 0);
  // 模拟暂停期间不调用 step，继续推进 1.05s 出现首个道具
  stepSeconds(session, 1.05);
  assert.equal(world.drops.length, 1);
  const spawnTime = world.drops[0].spawnedAtBattleTime;

  // 15.5s 后仍在场上
  stepSeconds(session, 15.5);
  assert.ok(world.drops.some((d) => d.spawnedAtBattleTime === spawnTime));

  // 再过 0.6s（满 16s）首个道具消失
  stepSeconds(session, 0.6);
  assert.equal(world.drops.some((d) => d.spawnedAtBattleTime === spawnTime), false);
});

test('平台输入校验（名字、颜色、冲突按键）、规则校验与损坏存储回退', () => {
  assert.equal(validatePlayerName(''), null);
  assert.equal(validatePlayerName('AceOne'), null);
  assert.notEqual(validatePlayerName('TooLongNameHere'), null);
  assert.notEqual(validatePlayerName('Player1'), null);

  const colorErrors = validatePlayerColors([
    { slotId: 'p1', name: '', colorHex: '#D9432B' },
    { slotId: 'p2', name: '', colorHex: '#D9432B' },
  ]);
  assert.ok(colorErrors.p1 && colorErrors.p2);

  // 跨玩家键位冲突与保留键 Esc 检测
  const conflictRes = validateBindings(['p1', 'p2'], tankBattleGame.actions, {
    p1: { ...tankBattleGame.defaultBindingsBySlot.p1, fire: 'KeyW' },
    p2: { ...tankBattleGame.defaultBindingsBySlot.p2, fire: 'Escape' },
  });
  assert.equal(conflictRes.valid, false);
  assert.ok(conflictRes.fieldErrors['p1:forward']);
  assert.ok(conflictRes.fieldErrors['p1:fire']);
  assert.ok(conflictRes.fieldErrors['p2:fire']);

  // 规则校验：刷新下限 > 上限报错，弹夹 < 2 且启用散弹给出警告
  const badRules: TankBattleRules = {
    ...getDefaultTankRules(),
    dropIntervalMinSeconds: 20,
    dropIntervalMaxSeconds: 10,
    magazineCapacity: 1,
    enableShotgun: true,
  };
  const issues = validateTankRules(badRules);
  assert.ok(issues.some((i) => i.field === 'dropIntervalMinSeconds' && i.severity === 'error'));
  assert.ok(issues.some((i) => i.field === 'magazineCapacity' && i.severity === 'warning'));

  // 损坏本地存储回退
  const fakeMap = new Map<string, string>();
  const fakeStorage: StorageLike = {
    getItem: (k) => fakeMap.get(k) ?? null,
    setItem: (k, v) => {
      fakeMap.set(k, v);
    },
    removeItem: (k) => {
      fakeMap.delete(k);
    },
  };
  fakeStorage.setItem('local_arena_profiles_v1', '{broken-json');
  const loadedProfiles = loadPlayerProfiles(2, fakeStorage);
  assert.equal(loadedProfiles.value.length, 2);
  assert.ok(loadedProfiles.notice);

  saveGameRules('tank-battle', 1, { ...getDefaultTankRules(), targetScore: 7 }, fakeStorage);
  const loadedRules = loadGameRules(tankBattleGame, fakeStorage);
  assert.equal(loadedRules.value.targetScore, 7);
});

test('操控模式切换：直觉转向支持屏幕八向移动、轻点微调与过渡中任意 360° 开火，经典模式保持进退转向', () => {
  // 1. 直觉转向模式（默认）
  const sIntuitive = new TankBattleSession(makeSnapshot({ controlMode: 'intuitive', maxDropsOnField: 0 }));
  const wI = sIntuitive.getWorldState();
  wI.maze.walls = wI.maze.walls.filter(
    (w) => w.y1 === 0 || w.y1 === wI.maze.height || w.x1 === 0 || w.x1 === wI.maze.width
  );
  const p1 = wI.tanks[0];
  p1.x = 300;
  p1.y = 300;
  p1.angle = 0; // 初始朝右
  wI.tanks[1].x = 850;
  wI.tanks[1].y = 550;

  // 轻点向下（0.06s < 0.09s 微调窗口）：炮口平滑转向非 45°/90° 的任意中间角度，同时位移很小
  stepSeconds(sIntuitive, 0.06, createStaticInputFrame({ p1: { backward: { held: true } } }));
  const tapAngleDeg = (p1.angle * 180) / Math.PI;
  assert.ok(tapAngleDeg > 10 && tapAngleDeg < 40, `expected intermediate angle 10°~40°, got ${tapAngleDeg}`);
  assert.ok(p1.y - 300 < 5, `expected minimal drift during micro-tap, got ${p1.y - 300}`);

  // 在中间角度立即开火：子弹沿该任意角度飞出（验证万向射击）
  sIntuitive.step(DT, createStaticInputFrame({ p1: { fire: { justPressed: true } } }));
  assert.equal(wI.projectiles.length, 1);
  const bulletAngleDeg = (Math.atan2(wI.projectiles[0].vy, wI.projectiles[0].vx) * 180) / Math.PI;
  assert.ok(Math.abs(bulletAngleDeg - tapAngleDeg) < 1, `bullet angle ${bulletAngleDeg} should match ${tapAngleDeg}`);

  // 持续按住 下+左（45° 斜向屏幕移动）0.4s：应朝左下移动并平滑对齐 135°
  const startX = p1.x;
  const startY = p1.y;
  stepSeconds(
    sIntuitive,
    0.5,
    createStaticInputFrame({ p1: { backward: { held: true }, turnLeft: { held: true } } })
  );
  assert.ok(p1.x < startX - 20 && p1.y > startY + 20);
  const diagDeg = (p1.angle * 180) / Math.PI;
  assert.ok(Math.abs(diagDeg - 135) < 5, `expected ~135°, got ${diagDeg}`);

  // 2. 经典坦克模式：按左转应原地逆时针旋转，不发生位移
  const sClassic = new TankBattleSession(makeSnapshot({ controlMode: 'classic', maxDropsOnField: 0 }));
  const wC = sClassic.getWorldState();
  const cp1 = wC.tanks[0];
  cp1.x = 300;
  cp1.y = 300;
  cp1.angle = 0;
  stepSeconds(sClassic, 0.2, createStaticInputFrame({ p1: { turnLeft: { held: true } } }));
  assert.equal(cp1.x, 300);
  assert.equal(cp1.y, 300);
  assert.ok(cp1.angle < -0.5);
});

test('弹药平衡与对局统计：普通弹 6s、散弹 4s、碎片弹 6 枚/3s，且结算准确输出击杀与道具统计', () => {
  const defaults = getDefaultTankRules();
  assert.equal(defaults.normalBulletLifetimeSeconds, 6);
  assert.equal(defaults.shotgunBulletLifetimeSeconds, 4);
  assert.equal(defaults.fragShardCount, 6);
  assert.equal(defaults.fragShardLifetimeSeconds, 3);

  // 旧版 v1 默认规则平滑迁移到新版平衡值
  const migrated = migrateTankRules({
    normalBulletLifetimeSeconds: 10,
    fragShardCount: 12,
    fragTotalLifetimeSeconds: 10,
    targetScore: 7,
  });
  assert.equal(migrated.rules.normalBulletLifetimeSeconds, 6);
  assert.equal(migrated.rules.shotgunBulletLifetimeSeconds, 4);
  assert.equal(migrated.rules.fragShardCount, 6);
  assert.equal(migrated.rules.fragShardLifetimeSeconds, 3);
  assert.equal(migrated.rules.targetScore, 7);

  // 验证普通弹 6s 过期 & 散弹 4s 过期
  const sLife = new TankBattleSession(makeSnapshot({ maxDropsOnField: 0 }));
  const wLife = sLife.getWorldState();
  wLife.maze.walls = wLife.maze.walls.filter(
    (w) =>
      w.y1 === 0 ||
      w.y1 === wLife.maze.height ||
      w.x1 === 0 ||
      w.x1 === wLife.maze.width
  );
  // 将两车放在角落避免被自己反弹子弹命中
  wLife.tanks[0].x = 120;
  wLife.tanks[0].y = 120;
  wLife.tanks[0].angle = 0.35;
  wLife.tanks[1].x = 880;
  wLife.tanks[1].y = 580;
  wLife.tanks[1].angle = Math.PI + 0.35;

  applyItemPickup(wLife.tanks[1], 'shotgun', wLife.battleTime, wLife.rules);
  sLife.step(
    DT,
    createStaticInputFrame({
      p1: { fire: { justPressed: true } },
      p2: { fire: { justPressed: true } },
    })
  );
  const normalProj = wLife.projectiles.find((p) => p.source === 'normal');
  const shotgunProjs = wLife.projectiles.filter((p) => p.source === 'shotgun');
  assert.ok(normalProj);
  assert.equal(shotgunProjs.length, 3);
  assert.ok(Math.abs(normalProj.expiresAtBattleTime - normalProj.spawnedAtBattleTime - 6) < 1e-6);
  assert.ok(
    shotgunProjs.every((p) => Math.abs(p.expiresAtBattleTime - p.spawnedAtBattleTime - 4) < 1e-6)
  );

  // 验证对局结算统计（激光击杀 + 道具拾取与使用）
  const sStats = new TankBattleSession(makeSnapshot({ targetScore: 1, maxDropsOnField: 0 }));
  const wStats = sStats.getWorldState();
  wStats.maze.walls = wStats.maze.walls.filter(
    (w) =>
      w.y1 === 0 ||
      w.y1 === wStats.maze.height ||
      w.x1 === 0 ||
      w.x1 === wStats.maze.width
  );
  wStats.tanks[0].x = 200;
  wStats.tanks[0].y = 250;
  wStats.tanks[0].angle = 0;
  wStats.tanks[1].x = 500;
  wStats.tanks[1].y = 250;
  // 在 P1 脚下放置一个激光道具让其真实拾取并使用
  wStats.drops.push({
    id: 999,
    kind: 'laser',
    cellIndex: 0,
    x: 200,
    y: 250,
    spawnedAtBattleTime: 0,
    expiresAtBattleTime: 20,
  });
  const stepRes = sStats.step(DT, createStaticInputFrame({ p1: { fire: { justPressed: true } } }));
  assert.ok(stepRes.matchResult);
  const p1Stats = stepRes.matchResult.players.find((p) => p.slotId === 'p1')?.stats;
  const p2Stats = stepRes.matchResult.players.find((p) => p.slotId === 'p2')?.stats;
  assert.equal(p1Stats?.kills, 1);
  assert.equal(p1Stats?.hitsLanded, 1);
  assert.equal(p1Stats?.shotsFired, 1);
  assert.equal(p1Stats?.itemsPicked, 1);
  assert.equal(p1Stats?.itemsUsed, 1);
  assert.equal(p1Stats?.itemUsageByKind.laser, 1);
  assert.equal(p2Stats?.deaths, 1);

  // 验证对局录像 Snapshot Events 序列正确记录
  assert.ok(stepRes.matchResult.replay);
  assert.ok(stepRes.matchResult.replay.events.length >= 2);
  assert.equal(stepRes.matchResult.replay.events[0].kind, 'round_start');
  assert.equal(
    stepRes.matchResult.replay.events[stepRes.matchResult.replay.events.length - 1].kind,
    'round_end'
  );
});

test('弹体尺寸规范：普通弹、连发普通弹与散弹减半为 2.5px，特殊弹（追踪/破片母弹 6px、破片碎片 4px）保持原尺寸', () => {
  assert.equal(NORMAL_BULLET_RADIUS, 2.5);
  assert.equal(SPECIAL_BULLET_RADIUS, 6);
  assert.equal(FRAG_SHARD_RADIUS, 4);

  const session = new TankBattleSession(makeSnapshot({ maxDropsOnField: 0 }));
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



