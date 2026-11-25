import { tankBattleAiSdk } from './ai/aiSdk';
import { DEFAULT_TANK_BOT_MODEL_ID, TANK_BOT_MODELS } from './ai/botScripts';
import type { GameDefinition } from '../../platform/games/contracts';
import { TankBattleRenderer } from './render/drawArena';
import {
  generateFreshMapCode,
  getDefaultTankRules,
  handleTankRuleFieldChange,
  migrateTankRules,
  parseMapCode,
  TANK_BATTLE_RULES_VERSION,
  TANK_RULE_FIELDS,
  TANK_RULE_GROUPS,
  validateTankRules,
} from './rules';
import { TankBattleSession } from './simulation/world';
import type { TankBattleRules, TankWorldState } from './types';

export const tankBattleGame: GameDefinition<TankBattleRules, TankWorldState> = {
  id: 'tank-battle',
  name: '坦克大战',
  subtitle: '单人挑战 / 双人同屏 / 2–8 席多 AI 迷宫大乱斗',
  description:
    '支持单人挑战内置或自定义大模型 AI 脚本、双人同屏键位对抗，以及最多 8 席同台混战；在全连通随机迷宫中驾驭装甲坦克展开回合制对决，涵盖弹道反弹、子弹抵消与七种战术道具。',
  minPlayers: 2,
  maxPlayers: 8,
  defaultPlayerCount: 2,
  rulesVersion: TANK_BATTLE_RULES_VERSION,
  actions: [
    { id: 'forward', label: '前进' },
    { id: 'backward', label: '倒车' },
    { id: 'turnLeft', label: '左转' },
    { id: 'turnRight', label: '右转' },
    { id: 'fire', label: '开火 / 使用道具' },
  ],
  defaultBindingsBySlot: {
    p1: {
      forward: 'KeyW',
      backward: 'KeyS',
      turnLeft: 'KeyA',
      turnRight: 'KeyD',
      fire: 'Space',
    },
    p2: {
      forward: 'ArrowUp',
      backward: 'ArrowDown',
      turnLeft: 'ArrowLeft',
      turnRight: 'ArrowRight',
      fire: 'Enter',
    },
  },
  ruleGroups: TANK_RULE_GROUPS,
  ruleFields: TANK_RULE_FIELDS,
  getDefaultRules: getDefaultTankRules,
  migrateRules: migrateTankRules,
  validateRules: validateTankRules,
  onRuleFieldChange: handleTankRuleFieldChange,
  finalizeMatchRules: (rules, seed) => {
    const parsed = parseMapCode(rules.mapCode);
    if (parsed) {
      return {
        ...rules,
        gridCols: parsed.cols,
        gridRows: parsed.rows,
        extraPassages: parsed.extraPassages,
        mapCode: rules.mapCode.trim().toUpperCase(),
      };
    }
    return {
      ...rules,
      mapCode: generateFreshMapCode(rules.gridCols, rules.gridRows, rules.extraPassages, seed),
    };
  },
  createSession: (snapshot) => new TankBattleSession(snapshot),
  createRenderer: () => new TankBattleRenderer(),
  botModels: TANK_BOT_MODELS,
  defaultBotModelId: DEFAULT_TANK_BOT_MODEL_ID,
  aiSdk: tankBattleAiSdk,
};
