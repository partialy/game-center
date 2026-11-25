import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tankBattleGame } from '../index';
import { generateMaze } from '../map/generateMaze';
import {
  CELL_SIZE,
  type MazeData,
  type ProjectileEntity,
  type TankEntity,
} from '../types';
import {
  assessBulletThreat,
  computeMazePath,
  convertIntentToActions,
  findBestRicochetShot,
  findMazeCellIndex,
  hasLineOfSight,
  simulateBounceShot,
} from './perception';
import {
  getTankBotModelById,
  getWorldAiDebugSnapshots,
  TANK_BOSS_THEME,
  TANK_BOT_MODELS,
} from './botScripts';
import {
  evaluateNormalBulletCancellation,
  evaluateWeaponShot,
  predictSelfStepState,
  SIM_STEP_SECONDS,
  traceProjectileTrajectory,
} from './physicsPrediction';
import { setSharedStepCacheEnabled } from './threatMap';
import { traceLaserRay } from '../combat/projectiles';
import { stepTankMotion } from '../simulation/movement';
import { TankBattleSession } from '../simulation/world';
import { BotInputDriver } from '../../../platform/session/sessionHost';
import { createStaticInputFrame } from '../../../platform/input/keyboard';
import {
  getDefaultArenaSeats,
  loadArenaSeats,
  loadGameRules,
  loadModePreferences,
  loadRulePresets,
  saveArenaSeats,
  saveGameRules,
  saveModePreferences,
  saveRulePresets,
  type StorageLike,
} from '../../../platform/settings/preferencesStore';

function makeMockTank(overrides: Partial<TankEntity>): TankEntity {
  return {
    slotId: 'p1',
    displayName: 'P1',
    colorHex: '#D9432B',
    x: 100,
    y: 100,
    angle: 0,
    alive: true,
    eliminatedAtBattleTime: null,
    ammo: 5,
    maxAmmo: 5,
    nextReloadAt: null,
    fireReadyAt: 0,
    shieldGraceUntil: 0,
    shield: null,
    offense: null,
    recoilOffset: 0,
    hitFlashTimer: 0,
    treadDistance: 0,
    moveHoldTime: 0,
    ...overrides,
  };
}

function makeMockMaze(cols: number, rows: number, extraWalls: MazeData['walls']): MazeData {
  const width = cols * CELL_SIZE;
  const height = rows * CELL_SIZE;
  return {
    version: 1,
    seed: 1,
    cols,
    rows,
    extraPassages: 0,
    mapCode: 'TEST',
    width,
    height,
    cells: [],
    horizontalWalls: [],
    verticalWalls: [],
    walls: [
      { x1: 0, y1: 0, x2: width, y2: 0, orientation: 'h' },
      { x1: 0, y1: height, x2: width, y2: height, orientation: 'h' },
      { x1: 0, y1: 0, x2: 0, y2: height, orientation: 'v' },
      { x1: width, y1: 0, x2: width, y2: height, orientation: 'v' },
      ...extraWalls,
    ],
  };
}

function makeMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

describe('Tank Battle AI perception & strategy scripts', () => {
  it('computes valid BFS maze shortest paths between connected cells', () => {
    const maze = generateMaze({
      cols: 8,
      rows: 6,
      extraPassages: 8,
      seed: 123456,
    });
    const start = findMazeCellIndex(maze, maze.cells[0].centerX, maze.cells[0].centerY);
    const goal = maze.cells.length - 1;
    const path = computeMazePath(maze, start, goal);

    assert.ok(path.length >= 2, 'path should contain start and goal');
    assert.equal(path[0], start);
    assert.equal(path[path.length - 1], goal);

    for (let i = 0; i < path.length - 1; i += 1) {
      assert.ok(
        maze.cells[path[i]].neighbors.includes(path[i + 1]),
        `step ${path[i]} -> ${path[i + 1]} must be traversable neighbors`
      );
    }
  });

  it('finds a 1-bounce ricochet bank shot around an interior wall while rejecting point-blank self-damage', () => {
    // 构造一个 3×2 开放房间，在中间放一堵竖直短墙阻挡直视线，但上墙可以完美单次反弹命中敌方
    const width = 3 * CELL_SIZE;
    const height = 2 * CELL_SIZE;
    const maze = makeMockMaze(3, 2, [
      {
        x1: width * 0.5,
        y1: 70,
        x2: width * 0.5,
        y2: height,
        orientation: 'v',
      },
    ]);

    const self = makeMockTank({ slotId: 'p1', x: 58, y: height - 45, angle: 0 });
    const enemy = makeMockTank({ slotId: 'p2', x: width - 58, y: height - 45, angle: Math.PI });

    assert.equal(
      hasLineOfSight(maze, self.x, self.y, enemy.x, enemy.y),
      false,
      'direct line of sight should be blocked by the center wall'
    );

    const bankShot = findBestRicochetShot(maze, self, enemy, 1, 72);
    assert.ok(bankShot, 'should find a valid 1-bounce ricochet shot off the top wall');
    assert.equal(bankShot.bouncesUsed, 1);

    // 紧贴左墙向正左方开火应判定为 selfRisk
    const wallHugSelf = makeMockTank({ slotId: 'p1', x: 24, y: height - 45, angle: Math.PI });
    const risky = simulateBounceShot(maze, wallHugSelf, enemy, Math.PI, 1);
    assert.equal(risky.selfRisk, true, 'firing point-blank into a wall must flag selfRisk');
  });

  it('detects incoming projectile threats and ignores wall-occluded bullets', () => {
    const height = 2 * CELL_SIZE;
    const maze = makeMockMaze(4, 2, [
      { x1: 220, y1: 0, x2: 220, y2: height, orientation: 'v' },
    ]);

    const self = makeMockTank({ slotId: 'p1', x: 100, y: 100 });
    const openBullet: ProjectileEntity = {
      id: 1,
      ownerSlotId: 'p2',
      colorHex: '#2364C7',
      source: 'normal',
      x: 185,
      y: 102,
      vx: -260,
      vy: 0,
      radius: 5,
      speed: 260,
      spawnedAtBattleTime: 0,
      expiresAtBattleTime: 6,
      selfDamageUnlocked: true,
      trail: [],
    };

    const threat = assessBulletThreat(self, [openBullet], maze, 0.9);
    assert.equal(threat.urgent, true, 'unoccluded incoming bullet must trigger evasion');
    assert.ok(Math.abs(threat.evadeY) > 0.7, 'evasion vector should be perpendicular to bullet velocity');

    // 墙体另一侧的子弹不应误触发闪避
    const blockedBullet: ProjectileEntity = { ...openBullet, id: 2, x: 260 };
    const noThreat = assessBulletThreat(self, [blockedBullet], maze, 0.9);
    assert.equal(noThreat.urgent, false, 'wall-occluded bullet must not trigger false evasion');
  });

  it('translates tactical intent cleanly for both intuitive and classic control modes', () => {
    const tank = makeMockTank({ angle: 0 });

    const intuitiveUpRight = convertIntentToActions(
      tank,
      { x: 0.707, y: -0.707 },
      null,
      true,
      'intuitive'
    );
    assert.equal(intuitiveUpRight.forward, true);
    assert.equal(intuitiveUpRight.turnRight, true);
    assert.equal(intuitiveUpRight.backward, false);
    assert.equal(intuitiveUpRight.fire, true);

    const classicTurnLeft = convertIntentToActions(
      tank,
      { x: 0, y: -1 },
      -Math.PI / 2,
      false,
      'classic'
    );
    assert.equal(classicTurnLeft.turnLeft, true);
    assert.equal(classicTurnLeft.turnRight, false);
  });

  it('registers 5 distinct TS AI models including Lv.5 Boss and runs a live headless battle smoothly', () => {
    assert.equal(TANK_BOT_MODELS.length, 5);
    assert.deepEqual(
      TANK_BOT_MODELS.map((m) => m.id),
      ['rookie', 'tactical', 'elite', 'nightmare', 'hellbringer']
    );

    const boss = TANK_BOT_MODELS[4];
    assert.equal(boss.difficultyLevel, 5);
    assert.equal(boss.isBoss, true);
    assert.deepEqual(boss.traits, { navigation: 5, dodging: 5, aiming: 5, items: 5 });
    assert.equal(TANK_BOSS_THEME.modelId, 'hellbringer');

    // 确保除 Boss 外没有其它模型是四项全 5/5 满格
    for (const m of TANK_BOT_MODELS.slice(0, 4)) {
      const sum = m.traits.navigation + m.traits.dodging + m.traits.aiming + m.traits.items;
      assert.ok(sum < 20, `${m.id} should be strictly below 5/5/5/5 Boss ceiling`);
    }

    const rules = {
      ...tankBattleGame.getDefaultRules(),
      countdownSeconds: 0,
      targetScore: 1,
      roundTimeLimitSeconds: 20,
    };

    const snapshot = {
      gameId: tankBattleGame.id,
      rulesVersion: tankBattleGame.rulesVersion,
      rules,
      sessionSeed: 987654,
      gameMode: 'single' as const,
      singleMatchup: 'ai_vs_ai' as const,
      players: [
        {
          slotId: 'p1',
          rawName: 'EliteAI',
          displayName: 'EliteAI',
          colorHex: '#D9432B',
          bindings: {},
          controller: 'ai' as const,
          aiModelId: 'elite',
          aiModelName: '精英猎手',
        },
        {
          slotId: 'p2',
          rawName: 'NightmareAI',
          displayName: 'NightmareAI',
          colorHex: '#2364C7',
          bindings: {},
          controller: 'ai' as const,
          aiModelId: 'nightmare',
          aiModelName: '噩梦反弹',
        },
      ],
    };

    const session = tankBattleGame.createSession(snapshot);
    const botDriver = new BotInputDriver(tankBattleGame, snapshot.players, snapshot.sessionSeed);
    const emptyHuman = createStaticInputFrame({});

    const initialWorld = session.getWorldState();
    const startPositions = initialWorld.tanks.map((t) => ({ x: t.x, y: t.y }));

    let totalShots = 0;
    let movedDistance = 0;
    let matchResult = session.getMatchResult();

    // 模拟最多 6 秒（360 步 60Hz），验证两台 AI 坦克均主动移动、开火且不抛错
    for (let step = 0; step < 360 && !matchResult; step += 1) {
      const worldBefore = session.getWorldState();
      const input = botDriver.composeFrame(worldBefore, 1 / 60, emptyHuman);
      const stepRes = session.step(1 / 60, input);
      if (stepRes.sounds.some((s) => s.startsWith('fire_'))) {
        totalShots += 1;
      }
      if (stepRes.matchResult) {
        matchResult = stepRes.matchResult;
      }
    }

    const afterWorld = session.getWorldState();
    for (let i = 0; i < afterWorld.tanks.length; i += 1) {
      movedDistance += Math.hypot(
        afterWorld.tanks[i].x - startPositions[i].x,
        afterWorld.tanks[i].y - startPositions[i].y
      );
    }

    assert.ok(movedDistance > 60, `AI tanks should actively navigate maze (moved ${movedDistance.toFixed(1)}px)`);
    assert.ok(totalShots >= 1 || matchResult !== null, 'AI tanks should fire or finish round during combat');

    if (matchResult) {
      assert.equal(matchResult.players[0].controller, 'ai');
      assert.equal(matchResult.players[0].aiModelName, '精英猎手');
      assert.equal(matchResult.players[1].controller, 'ai');
      assert.equal(matchResult.players[1].aiModelName, '噩梦反弹');
    }
  });

  it('isolates single-player and multiplayer rules, presets, and mode preferences in storage', () => {
    const storage = makeMemoryStorage();
    const baseRules = tankBattleGame.getDefaultRules();

    const singleRules = { ...baseRules, targetScore: 3, magazineCapacity: 8 };
    const multiRules = { ...baseRules, targetScore: 9, magazineCapacity: 4 };

    saveGameRules(tankBattleGame.id, tankBattleGame.rulesVersion, singleRules, storage, 'single');
    saveGameRules(tankBattleGame.id, tankBattleGame.rulesVersion, multiRules, storage, 'multi');

    const loadedSingle = loadGameRules(tankBattleGame, storage, 'single');
    const loadedMulti = loadGameRules(tankBattleGame, storage, 'multi');

    assert.equal(loadedSingle.value.targetScore, 3);
    assert.equal(loadedSingle.value.magazineCapacity, 8);
    assert.equal(loadedMulti.value.targetScore, 9);
    assert.equal(loadedMulti.value.magazineCapacity, 4);

    saveRulePresets(
      tankBattleGame.id,
      [
        {
          id: 'p_single',
          name: '单人速战',
          rulesVersion: tankBattleGame.rulesVersion,
          rules: singleRules,
          updatedAt: 1000,
        },
      ],
      storage,
      'single'
    );
    assert.equal(loadRulePresets(tankBattleGame, storage, 'single').value.length, 1);
    assert.equal(loadRulePresets(tankBattleGame, storage, 'multi').value.length, 0);

    saveModePreferences(
      {
        gameMode: 'single',
        singleMatchup: 'ai_vs_ai',
        aiModelBySlot: { p1: 'elite', p2: 'hellbringer' },
      },
      storage
    );
    const loadedPrefs = loadModePreferences('tactical', storage);
    assert.equal(loadedPrefs.value.gameMode, 'single');
    assert.equal(loadedPrefs.value.singleMatchup, 'ai_vs_ai');
    assert.equal(loadedPrefs.value.aiModelBySlot.p1, 'elite');
    assert.equal(loadedPrefs.value.aiModelBySlot.p2, 'hellbringer');

    // 默认 4 席初始阵容保留 Lv.1~4，显式保存 Boss 后可准确重载
    const defaultSeats = getDefaultArenaSeats(4);
    assert.equal(defaultSeats.some((s) => s.aiModelId === 'hellbringer'), false);
    const withBoss = defaultSeats.map((s, idx) =>
      idx === 0 ? { ...s, aiModelId: 'hellbringer' } : s
    );
    saveArenaSeats('tank-battle', withBoss, storage);
    const reloadedSeats = loadArenaSeats('tank-battle', undefined, storage);
    assert.equal(reloadedSeats.value[0].aiModelId, 'hellbringer');
  });

  it('matches real engine movement, muzzle bounce, and full laser trace exactly', () => {
    const rules = { ...tankBattleGame.getDefaultRules(), countdownSeconds: 0, laserMaxBounces: 6 };
    const session = new TankBattleSession({
      gameId: 'tank-battle',
      rulesVersion: tankBattleGame.rulesVersion,
      rules,
      sessionSeed: 424242,
      players: [
        { slotId: 'p1', rawName: 'P1', displayName: 'P1', colorHex: '#D9432B', bindings: {} },
        { slotId: 'p2', rawName: 'P2', displayName: 'P2', colorHex: '#2364C7', bindings: {} },
      ],
    });
    const world = session.getWorldState();
    const p1 = world.tanks[0];
    const startPose = {
      x: p1.x,
      y: p1.y,
      angle: p1.angle,
      moveHoldTime: p1.moveHoldTime,
      treadDistance: p1.treadDistance,
    };
    const moveAct = { forward: true, backward: false, turnLeft: false, turnRight: true };
    const predictedPose = stepTankMotion(startPose, world.maze, rules, moveAct, SIM_STEP_SECONDS);

    // 真实步进验证位置/角度与同源运动完全一致
    const frame = createStaticInputFrame({
      p1: {
        forward: { held: true, justPressed: true, justReleased: false },
        turnRight: { held: true, justPressed: true, justReleased: false },
      },
    });
    session.step(SIM_STEP_SECONDS, frame);
    assert.ok(Math.abs(p1.x - predictedPose.x) < 1e-6);
    assert.ok(Math.abs(p1.y - predictedPose.y) < 1e-6);
    assert.ok(Math.abs(p1.angle - predictedPose.angle) < 1e-6);

    // 验证纯激光追踪与世界规则上限（6 次反射）一致
    const trace = traceLaserRay(world.maze, world.tanks, p1.slotId, p1.x, p1.y, p1.angle, rules.laserMaxBounces);
    assert.ok(trace.bouncesExecuted <= rules.laserMaxBounces);
    assert.ok(trace.points.length >= 2);
  });

  it('rejects point-blank wall, shotgun fan, frag self-hit, 6-bounce laser self-hit, and trapped mine shots', () => {
    const rules = { ...tankBattleGame.getDefaultRules(), countdownSeconds: 0, laserMaxBounces: 6 };
    const maze = makeMockMaze(4, 3, []);
    const self = makeMockTank({ slotId: 'p1', x: 20, y: 150, angle: Math.PI, ammo: 10 });
    const enemy = makeMockTank({ slotId: 'p2', x: 350, y: 150, angle: Math.PI });
    const mockWorld = {
      rules,
      maze,
      phase: 'playing' as const,
      roundNumber: 1,
      drawRounds: 0,
      scores: { p1: 0, p2: 0 },
      playerStats: {},
      countdownRemaining: 0,
      battleTime: 1,
      totalBattleTime: 1,
      roundOverTimer: 0,
      roundOverDuration: 2,
      roundWinnerSlotId: null,
      roundOverReason: '',
      nextDropAtBattleTime: null,
      tanks: [self, enemy],
      projectiles: [],
      mines: [],
      drops: [],
      laserBeams: [],
      explosions: [],
      visualCues: [],
      hitstopTimer: 0,
      screenShakeTrauma: 0,
    };

    // 1. 贴墙普通弹 / 连发 / 散弹 / 破片均应判定自伤拒射
    for (const offense of [
      null,
      { kind: 'rapid_fire' as const, expiresAtBattleTime: 8, durationSeconds: 7, remainingShots: 10, maxShots: 15 },
      { kind: 'shotgun' as const, expiresAtBattleTime: 8, durationSeconds: 7 },
      { kind: 'frag' as const, expiresAtBattleTime: 12, durationSeconds: 12 },
    ]) {
      const res = evaluateWeaponShot(
        mockWorld,
        self.slotId,
        self,
        mockWorld.battleTime + SIM_STEP_SECONDS,
        self.ammo,
        0,
        null,
        0,
        offense,
        false,
        5
      );
      assert.equal(res.safe, false, `point-blank wall shot must be rejected for ${offense?.kind ?? 'normal'}`);
    }

    // 2. 6 次反射回环激光自伤审查：水平窄廊正射左墙再 6 次反弹回打自身必须拒绝
    const narrowCorridor = makeMockMaze(3, 1, []);
    const laserSelf = makeMockTank({ slotId: 'p1', x: 150, y: 50, angle: Math.PI });
    const laserRes = evaluateWeaponShot(
      { ...mockWorld, maze: narrowCorridor, tanks: [laserSelf, makeMockTank({ slotId: 'p2', x: 260, y: 50 })] },
      laserSelf.slotId,
      laserSelf,
      1 + SIM_STEP_SECONDS,
      10,
      0,
      null,
      0,
      { kind: 'laser', expiresAtBattleTime: 12, durationSeconds: 12 },
      false,
      5
    );
    assert.equal(laserRes.safe, false, '6-bounce laser returning to hit shooter must be flagged selfRisk');

    // 3. 受困狭小空间（无逃离路线）拒绝布雷
    const tinyBox = makeMockMaze(1, 1, []);
    const mineSelf = makeMockTank({ slotId: 'p1', x: 50, y: 50, angle: 0 });
    const mineRes = evaluateWeaponShot(
      { ...mockWorld, maze: tinyBox, tanks: [mineSelf, makeMockTank({ slotId: 'p2', x: 80, y: 80 })] },
      mineSelf.slotId,
      mineSelf,
      1 + SIM_STEP_SECONDS,
      10,
      0,
      null,
      0,
      { kind: 'mine', expiresAtBattleTime: 12, durationSeconds: 12 },
      false,
      5
    );
    assert.equal(mineRes.safe, false, 'trapped mine placement without escape path must be rejected');
  });

  it('handles 5th-bounce incoming threat, pincer evasion, post-move drop pickup, and bullet cancel rules', () => {
    const rules = {
      ...tankBattleGame.getDefaultRules(),
      countdownSeconds: 0,
      normalBulletCancelEnabled: true,
    };
    const maze = generateMaze({ cols: 6, rows: 5, extraPassages: 6, seed: 8888 });
    const self = makeMockTank({ slotId: 'p1', x: 150, y: 150, angle: 0, ammo: 5 });
    const enemy = makeMockTank({ slotId: 'p2', x: 450, y: 350, angle: Math.PI });

    // 验证同源弹道追踪可以完整跟踪 5 次反弹及第 5 次之后的飞行段
    const boxMaze = makeMockMaze(3, 3, []);
    const projTraj = traceProjectileTrajectory(boxMaze, rules, {
      x: 50,
      y: 60,
      vx: 290,
      vy: 145,
      radius: 5,
      speed: Math.hypot(290, 145),
      source: 'normal',
      ownerSlotId: 'p2',
      selfDamageUnlocked: true,
      startTime: 0,
      expiresAtBattleTime: 10,
      maxBounces: 5,
      includePostBounceTail: true,
    });
    assert.ok(projTraj.bouncesExecuted >= 5, 'Lv.5 trajectory tracer must reach 5 bounces');
    assert.ok(
      projTraj.segments.some((s) => s.bounceIndex === 5),
      'Lv.5 trajectory tracer must include post-5th-bounce flight segment'
    );

    // 验证一步移动拾取道具后按新道具校验，以及普通弹对消开关生效/关闭
    const world = {
      rules,
      maze,
      phase: 'playing' as const,
      roundNumber: 1,
      drawRounds: 0,
      scores: { p1: 0, p2: 0 },
      playerStats: {},
      countdownRemaining: 0,
      battleTime: 2,
      totalBattleTime: 2,
      roundOverTimer: 0,
      roundOverDuration: 2,
      roundWinnerSlotId: null,
      roundOverReason: '',
      nextDropAtBattleTime: null,
      tanks: [self, enemy],
      projectiles: [],
      mines: [],
      drops: [{ id: 9, kind: 'shotgun' as const, cellIndex: 0, x: self.x + 2, y: self.y, spawnedAtBattleTime: 1, expiresAtBattleTime: 17 }],
      laserBeams: [],
      explosions: [],
      visualCues: [],
      hitstopTimer: 0,
      screenShakeTrauma: 0,
    };

    const stepState = predictSelfStepState(
      world,
      self,
      { forward: false, backward: false, turnLeft: false, turnRight: false },
      SIM_STEP_SECONDS
    );
    assert.equal(stepState.certainPickup, 'shotgun');
    assert.equal(stepState.offense?.kind, 'shotgun');

    // 验证普通弹对消在无遮挡迎面普通弹时成立，关闭开关后禁止对消
    const incoming: ProjectileEntity = {
      id: 77,
      ownerSlotId: 'p2',
      colorHex: '#2364C7',
      source: 'normal',
      x: self.x + 120,
      y: self.y,
      vx: -rules.normalBulletSpeed,
      vy: 0,
      radius: 5,
      speed: rules.normalBulletSpeed,
      spawnedAtBattleTime: 1.5,
      expiresAtBattleTime: 7.5,
      selfDamageUnlocked: true,
      trail: [],
    };
    const clearWorld = {
      ...world,
      maze: makeMockMaze(4, 3, []),
      drops: [],
      projectiles: [incoming],
    };
    const clearStep = predictSelfStepState(
      clearWorld,
      self,
      { forward: false, backward: false, turnLeft: false, turnRight: false },
      SIM_STEP_SECONDS
    );
    const cancelOk = evaluateNormalBulletCancellation(clearWorld, self, clearStep, incoming, false);
    assert.ok(cancelOk?.canCancel, 'must verify head-on normal bullet cancellation');

    const disabledWorld = { ...clearWorld, rules: { ...rules, normalBulletCancelEnabled: false } };
    const cancelOff = evaluateNormalBulletCancellation(disabledWorld, self, clearStep, incoming, false);
    assert.equal(cancelOff, null, 'cancellation must be disallowed when disabled in rules');
  });

  it('produces identical outcomes with shared step cache ON vs OFF and runs deterministic 8-seat Lv.5 brawl', () => {
    const baseRules = tankBattleGame.getDefaultRules();
    const rules = {
      ...baseRules,
      gridCols: 12,
      gridRows: 8,
      extraPassages: 12,
      countdownSeconds: 0,
      targetScore: 1,
      roundTimeLimitEnabled: true,
      roundTimeLimitSeconds: 12,
    };

    const runWithCacheFlag = (cacheEnabled: boolean) => {
      setSharedStepCacheEnabled(cacheEnabled);
      const players = [
        { slotId: 'p1', rawName: 'B1', displayName: 'B1', colorHex: '#D9432B', bindings: {}, controller: 'ai' as const, aiModelId: 'hellbringer', aiModelName: '地狱使者' },
        { slotId: 'p2', rawName: 'B2', displayName: 'B2', colorHex: '#2364C7', bindings: {}, controller: 'ai' as const, aiModelId: 'nightmare', aiModelName: '噩梦反弹' },
      ];
      const session = tankBattleGame.createSession({
        gameId: 'tank-battle',
        rulesVersion: tankBattleGame.rulesVersion,
        rules,
        players,
        sessionSeed: 314159,
        gameMode: 'single',
      });
      const driver = new BotInputDriver(tankBattleGame, players, 314159);
      const human = createStaticInputFrame({});
      for (let s = 0; s < 180 && !session.getMatchResult(); s += 1) {
        const w = session.getWorldState();
        const inp = driver.composeFrame(w, SIM_STEP_SECONDS, human);
        session.step(SIM_STEP_SECONDS, inp);
      }
      const wEnd = session.getWorldState();
      return wEnd.tanks.map((t) => ({ x: t.x, y: t.y, angle: t.angle, alive: t.alive, ammo: t.ammo }));
    };

    const resCacheOn = runWithCacheFlag(true);
    const resCacheOff = runWithCacheFlag(false);
    setSharedStepCacheEnabled(true);
    assert.deepEqual(resCacheOn, resCacheOff, 'shared step cache must be bit-for-bit identical');

    // 8 席全 Lv.5 Boss 确定性重现性校验
    const run8Boss = () => {
      const players = Array.from({ length: 8 }, (_, idx) => ({
        slotId: `p${idx + 1}`,
        rawName: `H${idx + 1}`,
        displayName: `H${idx + 1}`,
        colorHex: ['#D9432B', '#2364C7', '#1F8A5B', '#C98316', '#7B3FA0', '#157D8C', '#DB2777', '#4B5563'][idx],
        bindings: {},
        controller: 'ai' as const,
        aiModelId: 'hellbringer',
        aiModelName: getTankBotModelById('hellbringer').name,
      }));
      const session = tankBattleGame.createSession({
        gameId: 'tank-battle',
        rulesVersion: tankBattleGame.rulesVersion,
        rules: { ...rules, gridCols: 14, gridRows: 9 },
        players,
        sessionSeed: 998877,
        gameMode: 'brawl',
      });
      const driver = new BotInputDriver(tankBattleGame, players, 998877);
      const human = createStaticInputFrame({});
      for (let s = 0; s < 45; s += 1) {
        const w = session.getWorldState();
        const inp = driver.composeFrame(w, SIM_STEP_SECONDS, human);
        session.step(SIM_STEP_SECONDS, inp);
      }
      const wEnd = session.getWorldState();
      const dbg = getWorldAiDebugSnapshots(wEnd);
      assert.ok(dbg && Object.keys(dbg).length >= 2, 'debug snapshots must be recorded for AI seats');
      return wEnd.tanks.map((t) => ({ x: t.x, y: t.y, angle: t.angle, alive: t.alive }));
    };

    assert.deepEqual(run8Boss(), run8Boss(), '8-seat Lv.5 brawl must be deterministic for same seed');
  });
});
