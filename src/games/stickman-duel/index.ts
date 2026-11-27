import type { GameDefinition } from '../../platform/games/contracts';
import { stickmanDuelAiSdk } from './ai/aiSdk';
import { DEFAULT_STICKMAN_BOT_MODEL_ID, STICKMAN_BOT_MODELS } from './ai/botScripts';
import { StickmanDuelRenderer } from './render/drawArena';
import {
  generateFreshStickmanMapCode,
  getDefaultStickmanRules,
  handleStickmanRuleFieldChange,
  migrateStickmanRules,
  parseStickmanMapCode,
  STICKMAN_RULE_FIELDS,
  STICKMAN_RULE_GROUPS,
  STICKMAN_RULES_VERSION,
  validateStickmanRules,
} from './rules';
import { StickmanDuelSession } from './simulation/world';
import type { StickmanDuelRules, StickmanWorld } from './types';

export const stickmanDuelGame: GameDefinition<StickmanDuelRules, StickmanWorld> = {
  id: 'stickman-duel',
  name: '星渊火柴人决斗',
  subtitle: '可破坏 2D 平台格斗 · 拳脚武器切换 · ABXY 虚拟手柄',
  description:
    '在底层基岩、可炸毁堆叠砖块与单向短平台构成的 2D 竞技场中展开硬核火柴人血条格斗。支持二段跳与穿台、左拳/上腿/下跳/右换武器、8 向瞄准、头/身/脚部位伤害判定，以及可斩弹长剑、手枪、后坐力猎枪、火箭筒、碎片手雷与血包掉落。',
  minPlayers: 2,
  maxPlayers: 8,
  defaultPlayerCount: 2,
  rulesVersion: STICKMAN_RULES_VERSION,
  virtualGamepadLayout: 'abxy',
  actions: [
    { id: 'moveLeft', label: '左移 / 左瞄' },
    { id: 'moveRight', label: '右移 / 右瞄' },
    { id: 'aimUp', label: '向上瞄准' },
    { id: 'aimDown', label: '下瞄 / 穿台' },
    { id: 'attack', label: '出拳 / 持武攻' },
    { id: 'kick', label: '飞踢击飞' },
    { id: 'jump', label: '跳跃 / 二段' },
    { id: 'swap', label: '拾取 / 换武器' },
  ],
  defaultBindingsBySlot: {
    p1: {
      moveLeft: 'KeyA',
      moveRight: 'KeyD',
      aimUp: 'KeyW',
      aimDown: 'KeyS',
      attack: 'KeyJ',
      kick: 'KeyK',
      jump: 'Space',
      swap: 'KeyL',
    },
    p2: {
      moveLeft: 'ArrowLeft',
      moveRight: 'ArrowRight',
      aimUp: 'ArrowUp',
      aimDown: 'ArrowDown',
      attack: 'Comma',
      kick: 'Period',
      jump: 'ShiftRight',
      swap: 'Slash',
    },
  },
  ruleGroups: STICKMAN_RULE_GROUPS,
  ruleFields: STICKMAN_RULE_FIELDS,
  getDefaultRules: getDefaultStickmanRules,
  migrateRules: migrateStickmanRules,
  validateRules: validateStickmanRules,
  onRuleFieldChange: handleStickmanRuleFieldChange,
  finalizeMatchRules: (rules, seed) => {
    const parsed = parseStickmanMapCode(rules.mapCode);
    if (parsed) {
      return {
        ...rules,
        mapTemplate: parsed.template,
        mapCode: rules.mapCode.trim().toUpperCase(),
      };
    }
    return {
      ...rules,
      mapCode: generateFreshStickmanMapCode(rules.mapTemplate, seed),
    };
  },
  createSession: (snapshot) => new StickmanDuelSession(snapshot),
  createRenderer: () => new StickmanDuelRenderer(),
  botModels: STICKMAN_BOT_MODELS,
  defaultBotModelId: DEFAULT_STICKMAN_BOT_MODEL_ID,
  aiSdk: stickmanDuelAiSdk,
};
