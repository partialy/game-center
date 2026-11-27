import type {
  RuleFieldSchema,
  RuleGroupSchema,
  ValidationIssue,
} from '../../platform/games/contracts';
import { createRandomSeed } from '../tank-battle/map/rng';
import type { StickmanDuelRules, StickmanMapTemplate } from './types';

export const STICKMAN_RULES_VERSION = 1;

const TEMPLATE_CODES: Record<Exclude<StickmanMapTemplate, 'random'>, string> = {
  twin_towers: 'TT',
  stepped_ruins: 'SR',
  sky_platforms: 'SP',
  fortress_bunkers: 'FB',
};

const CODE_TO_TEMPLATE: Record<string, Exclude<StickmanMapTemplate, 'random'>> = {
  TT: 'twin_towers',
  SR: 'stepped_ruins',
  SP: 'sky_platforms',
  FB: 'fortress_bunkers',
};

export interface ParsedStickmanMapCode {
  template: Exclude<StickmanMapTemplate, 'random'>;
  seed: number;
}

export function encodeStickmanMapCode(
  template: Exclude<StickmanMapTemplate, 'random'>,
  seed: number
): string {
  const code = TEMPLATE_CODES[template] ?? 'TT';
  const hex = (seed >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return `SM1-${code}-${hex}`;
}

export function parseStickmanMapCode(raw: string): ParsedStickmanMapCode | null {
  const trimmed = raw.trim().toUpperCase();
  if (!trimmed) return null;
  const match = /^SM1-(TT|SR|SP|FB)-([0-9A-F]{1,8})$/.exec(trimmed);
  if (!match) return null;
  const template = CODE_TO_TEMPLATE[match[1]];
  const seed = Number.parseInt(match[2], 16) >>> 0;
  if (!template) return null;
  return { template, seed };
}

export function resolveConcreteTemplate(
  template: StickmanMapTemplate,
  seed: number
): Exclude<StickmanMapTemplate, 'random'> {
  if (template !== 'random') return template;
  const list: Array<Exclude<StickmanMapTemplate, 'random'>> = [
    'twin_towers',
    'stepped_ruins',
    'sky_platforms',
    'fortress_bunkers',
  ];
  return list[(seed >>> 0) % list.length];
}

export function generateFreshStickmanMapCode(
  template: StickmanMapTemplate,
  seed?: number
): string {
  const actualSeed = seed ?? createRandomSeed();
  const concrete = resolveConcreteTemplate(template, actualSeed);
  return encodeStickmanMapCode(concrete, actualSeed);
}

export function getDefaultStickmanRules(): StickmanDuelRules {
  return {
    // 赛制
    targetScore: 5,
    countdownSeconds: 2.5,
    roundTimeLimitEnabled: false,
    roundTimeLimitSeconds: 90,

    // 地图
    mapTemplate: 'random',
    mapCode: '',

    // 战斗与血量（combat）
    maxHp: 100,
    punchDamage: 10,
    kickDamage: 14,
    kickKnockback: 490,

    // 高级手感（advanced）
    moveSpeed: 295,
    jumpVelocity: 575,
    gravity: 1420,

    // 掉落节奏（drops）
    firstDropDelaySeconds: 2.5,
    dropIntervalMinSeconds: 5.5,
    dropIntervalMaxSeconds: 9,
    maxDropsOnField: 4,
    enableSword: true,
    enablePistol: true,
    enableRocket: true,
    enableMedkit: true,

    // 武器与道具数值（items）
    swordDurability: 8,
    swordDamage: 18,
    pistolAmmo: 3,
    pistolDamage: 22,
    pistolSpeed: 880,
    rocketAmmo: 1,
    rocketDamage: 45,
    rocketSpeed: 540,
    rocketGravity: 560,
    rocketBlastRadius: 118,
    medkitHealPercent: 25,
  };
}

export const STICKMAN_RULE_GROUPS: RuleGroupSchema[] = [
  { id: 'match', title: '赛制', description: '目标胜局、开战倒数与可选限时' },
  { id: 'map', title: '地形与地图', description: '底层基岩、堆叠砖块布局与地图复玩编号' },
  { id: 'combat', title: '血条与拳脚', description: '生命上限、拳击与踢腿击飞参数' },
  { id: 'advanced', title: '移动与重力手感', description: '跑速、跳跃初速与重力加速度', advanced: true },
  { id: 'drops', title: '空投节奏与开关', description: '武器与血包空投频率及池内启停' },
  { id: 'items', title: '武器与血包数值', description: '长剑耐久、手枪弹道、火箭爆破与血包回复' },
];

export const STICKMAN_RULE_FIELDS: RuleFieldSchema[] = [
  // 赛制
  { key: 'targetScore', group: 'match', label: '获胜目标分', type: 'integer', min: 1, max: 20, unit: '分' },
  { key: 'countdownSeconds', group: 'match', label: '回合开战倒数', type: 'number', min: 0, max: 5, step: 0.5, unit: '秒' },
  { key: 'roundTimeLimitEnabled', group: 'match', label: '启用回合限时', type: 'boolean' },
  {
    key: 'roundTimeLimitSeconds',
    group: 'match',
    label: '回合限时时长',
    type: 'number',
    min: 20,
    max: 300,
    step: 5,
    unit: '秒',
    isHidden: (r) => !r.roundTimeLimitEnabled,
  },

  // 地图
  {
    key: 'mapTemplate',
    group: 'map',
    label: '地形布局模板',
    type: 'select',
    options: [
      { value: 'random', label: '随机轮换地形' },
      { value: 'twin_towers', label: '双塔堡垒' },
      { value: 'stepped_ruins', label: '阶梯废墟' },
      { value: 'sky_platforms', label: '浮空短台阵' },
      { value: 'fortress_bunkers', label: '掩体碉堡群' },
    ],
  },
  {
    key: 'mapCode',
    group: 'map',
    label: '地图复玩编号',
    type: 'string',
    placeholder: '留空自动生成随机地形，如 SM1-TT-3A9F0C12',
  },

  // 血条与拳脚（combat）
  { key: 'maxHp', group: 'combat', label: '最大生命值', type: 'integer', min: 50, max: 300, step: 10, unit: 'HP' },
  { key: 'punchDamage', group: 'combat', label: '出拳伤害', type: 'integer', min: 4, max: 40, step: 1, unit: '伤' },
  { key: 'kickDamage', group: 'combat', label: '踢腿伤害', type: 'integer', min: 6, max: 50, step: 1, unit: '伤' },
  { key: 'kickKnockback', group: 'combat', label: '踢腿击飞力度', type: 'integer', min: 200, max: 850, step: 20, unit: '' },

  // 移动与重力手感（advanced）
  { key: 'moveSpeed', group: 'advanced', label: '角色移动速度', type: 'integer', min: 160, max: 480, step: 10, unit: 'px/s' },
  { key: 'jumpVelocity', group: 'advanced', label: '跳跃起跳初速', type: 'integer', min: 380, max: 820, step: 15, unit: 'px/s' },
  { key: 'gravity', group: 'advanced', label: '重力加速度', type: 'integer', min: 800, max: 2200, step: 40, unit: '' },

  // 空投节奏与开关（drops）
  { key: 'firstDropDelaySeconds', group: 'drops', label: '首次空投时间', type: 'number', min: 0.5, max: 20, step: 0.5, unit: '秒' },
  { key: 'dropIntervalMinSeconds', group: 'drops', label: '最小刷新间隔', type: 'number', min: 1.5, max: 30, step: 0.5, unit: '秒' },
  { key: 'dropIntervalMaxSeconds', group: 'drops', label: '最大刷新间隔', type: 'number', min: 2, max: 45, step: 0.5, unit: '秒' },
  { key: 'maxDropsOnField', group: 'drops', label: '同场掉落上限', type: 'integer', min: 1, max: 10, step: 1, unit: '个' },
  { key: 'enableSword', group: 'drops', label: '启用 长剑', type: 'boolean' },
  { key: 'enablePistol', group: 'drops', label: '启用 手枪', type: 'boolean' },
  { key: 'enableRocket', group: 'drops', label: '启用 火箭筒', type: 'boolean' },
  { key: 'enableMedkit', group: 'drops', label: '启用 血包', type: 'boolean' },

  // 武器与血包数值（items）
  { key: 'swordDurability', group: 'items', label: '长剑耐久点数', type: 'integer', min: 1, max: 20, step: 1, unit: '点' },
  { key: 'swordDamage', group: 'items', label: '长剑挥砍伤害', type: 'integer', min: 6, max: 60, step: 1, unit: '伤' },
  { key: 'pistolAmmo', group: 'items', label: '手枪备弹数', type: 'integer', min: 1, max: 12, step: 1, unit: '发' },
  { key: 'pistolDamage', group: 'items', label: '手枪单发伤害', type: 'integer', min: 8, max: 70, step: 1, unit: '伤' },
  { key: 'pistolSpeed', group: 'items', label: '手枪子弹速度', type: 'integer', min: 400, max: 1400, step: 40, unit: 'px/s' },
  { key: 'rocketAmmo', group: 'items', label: '火箭筒备弹数', type: 'integer', min: 1, max: 5, step: 1, unit: '发' },
  { key: 'rocketDamage', group: 'items', label: '火箭爆炸中心伤害', type: 'integer', min: 15, max: 120, step: 5, unit: '伤' },
  { key: 'rocketBlastRadius', group: 'items', label: '火箭爆炸半径', type: 'integer', min: 60, max: 200, step: 6, unit: 'px' },
  { key: 'rocketSpeed', group: 'items', label: '火箭弹初速度', type: 'integer', min: 300, max: 900, step: 20, unit: 'px/s' },
  { key: 'rocketGravity', group: 'items', label: '火箭弹重力', type: 'integer', min: 150, max: 1200, step: 30, unit: '' },
  { key: 'medkitHealPercent', group: 'items', label: '血包回复比例', type: 'integer', min: 5, max: 100, step: 5, unit: '%' },
];

export function migrateStickmanRules(raw: unknown): {
  rules: StickmanDuelRules;
  migrated: boolean;
  recoveredFromError: boolean;
} {
  const defaults = getDefaultStickmanRules();
  if (typeof raw !== 'object' || raw === null) {
    return {
      rules: defaults,
      migrated: false,
      recoveredFromError: raw !== undefined && raw !== null,
    };
  }
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...defaults };
  let recovered = false;

  for (const [key, defVal] of Object.entries(defaults)) {
    if (!(key in src)) continue;
    const val = src[key];
    if (typeof defVal === 'number') {
      if (typeof val === 'number' && Number.isFinite(val)) {
        out[key] = val;
      } else {
        recovered = true;
      }
    } else if (typeof defVal === 'boolean') {
      if (typeof val === 'boolean') {
        out[key] = val;
      } else {
        recovered = true;
      }
    } else if (typeof defVal === 'string') {
      if (typeof val === 'string') {
        out[key] = val;
      } else {
        recovered = true;
      }
    }
  }

  return {
    rules: out as StickmanDuelRules,
    migrated: false,
    recoveredFromError: recovered,
  };
}

export function validateStickmanRules(rules: StickmanDuelRules): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const field of STICKMAN_RULE_FIELDS) {
    if (field.isHidden?.(rules)) continue;
    const val = rules[field.key];
    if (field.type === 'integer' || field.type === 'number') {
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        issues.push({ field: field.key, severity: 'error', message: `${field.label}必须为有效数字` });
        continue;
      }
      if (field.type === 'integer' && !Number.isInteger(val)) {
        issues.push({ field: field.key, severity: 'error', message: `${field.label}必须为整数` });
      }
      if (field.min !== undefined && val < field.min) {
        issues.push({ field: field.key, severity: 'error', message: `${field.label}不能小于 ${field.min}` });
      }
      if (field.max !== undefined && val > field.max) {
        issues.push({ field: field.key, severity: 'error', message: `${field.label}不能大于 ${field.max}` });
      }
    }
  }

  if (rules.dropIntervalMinSeconds > rules.dropIntervalMaxSeconds) {
    issues.push({
      field: 'dropIntervalMinSeconds',
      severity: 'error',
      message: '最小刷新间隔不能大于最大刷新间隔',
    });
  }

  if (rules.mapCode.trim().length > 0 && !parseStickmanMapCode(rules.mapCode)) {
    issues.push({
      field: 'mapCode',
      severity: 'error',
      message: '地图编号格式无效（示例：SM1-TT-3A9F0C12）',
    });
  }

  if (!rules.enableSword && !rules.enablePistol && !rules.enableRocket && !rules.enableMedkit) {
    issues.push({
      field: 'enableSword',
      severity: 'warning',
      message: '所有武器与血包均已关闭，本场为纯拳脚肉搏',
    });
  }

  return issues;
}

export function handleStickmanRuleFieldChange(
  prev: StickmanDuelRules,
  fieldKey: string,
  nextValue: unknown
): StickmanDuelRules {
  const next = { ...prev, [fieldKey]: nextValue } as StickmanDuelRules;
  if (fieldKey === 'mapCode' && typeof nextValue === 'string') {
    const parsed = parseStickmanMapCode(nextValue);
    if (parsed) {
      next.mapTemplate = parsed.template;
    }
  } else if (fieldKey === 'mapTemplate' && prev.mapCode.trim().length > 0) {
    next.mapCode = generateFreshStickmanMapCode(next.mapTemplate);
  }
  return next;
}
