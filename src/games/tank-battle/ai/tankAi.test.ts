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
import { TANK_BOT_MODELS } from './botScripts';
import { BotInputDriver } from '../../../platform/session/sessionHost';
import { createStaticInputFrame } from '../../../platform/input/keyboard';
import {
  loadGameRules,
  loadModePreferences,
  loadRulePresets,
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

  it('registers 4 distinct TS AI models and runs a live headless AI vs AI battle smoothly', () => {
    assert.equal(TANK_BOT_MODELS.length, 4);
    assert.deepEqual(
      TANK_BOT_MODELS.map((m) => m.id),
      ['rookie', 'tactical', 'elite', 'nightmare']
    );

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
        aiModelBySlot: { p1: 'elite', p2: 'nightmare' },
      },
      storage
    );
    const loadedPrefs = loadModePreferences('tactical', storage);
    assert.equal(loadedPrefs.value.gameMode, 'single');
    assert.equal(loadedPrefs.value.singleMatchup, 'ai_vs_ai');
    assert.equal(loadedPrefs.value.aiModelBySlot.p1, 'elite');
    assert.equal(loadedPrefs.value.aiModelBySlot.p2, 'nightmare');
  });
});
