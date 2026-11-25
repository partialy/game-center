import type {
  RuleFieldSchema,
  RuleGroupSchema,
  ValidationIssue,
} from '../../platform/games/contracts';
import { createRandomSeed } from './map/rng';
import type { TankBattleRules } from './types';

export const TANK_BATTLE_RULES_VERSION = 2;
export const MAZE_GENERATOR_VERSION = 1;

export interface ParsedMapCode {
  version: number;
  cols: number;
  rows: number;
  extraPassages: number;
  seed: number;
}

/**
 * 编码地图编号：包含生成器版本、网格列数、行数、额外通路数与 32 位十六进制种子。
 * 格式示例：TB1-10x7-08-3A9F0C12
 */
export function encodeMapCode(params: ParsedMapCode): string {
  const ver = Math.max(1, Math.floor(params.version));
  const cols = Math.max(5, Math.min(20, Math.floor(params.cols)));
  const rows = Math.max(5, Math.min(16, Math.floor(params.rows)));
  const extra = Math.max(0, Math.min(99, Math.floor(params.extraPassages)));
  const seedHex = (params.seed >>> 0).toString(16).toUpperCase().padStart(8, '0');
  const extraStr = String(extra).padStart(2, '0');
  return `TB${ver}-${cols}x${rows}-${extraStr}-${seedHex}`;
}

export function parseMapCode(rawCode: string): ParsedMapCode | null {
  const trimmed = rawCode.trim().toUpperCase();
  if (!trimmed) return null;
  const match = /^TB(\d+)-(\d+)X(\d+)-(\d+)-([0-9A-F]{1,8})$/.exec(trimmed);
  if (!match) return null;
  const version = Number(match[1]);
  const cols = Number(match[2]);
  const rows = Number(match[3]);
  const extraPassages = Number(match[4]);
  const seed = Number.parseInt(match[5], 16) >>> 0;
  if (
    version !== MAZE_GENERATOR_VERSION ||
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    !Number.isInteger(extraPassages) ||
    cols < 6 ||
    cols > 16 ||
    rows < 5 ||
    rows > 12 ||
    extraPassages < 0 ||
    extraPassages > 60
  ) {
    return null;
  }
  return { version, cols, rows, extraPassages, seed };
}

export function generateFreshMapCode(
  cols: number,
  rows: number,
  extraPassages: number,
  seed?: number
): string {
  return encodeMapCode({
    version: MAZE_GENERATOR_VERSION,
    cols,
    rows,
    extraPassages,
    seed: seed ?? createRandomSeed(),
  });
}

export function getDefaultTankRules(): TankBattleRules {
  const gridCols = 10;
  const gridRows = 7;
  const extraPassages = 8;
  return {
    // 赛制
    targetScore: 5,
    countdownSeconds: 3,
    roundTimeLimitEnabled: false,
    roundTimeLimitSeconds: 90,

    // 地图与出生
    gridCols,
    gridRows,
    extraPassages,
    mapCode: '',
    spawnMode: 'fixed',
    fixedSpawnSwap: true,

    // 坦克与普通弹
    controlMode: 'intuitive',
    magazineCapacity: 10,
    reloadIntervalSeconds: 1,
    normalFireCooldownSeconds: 0.8,
    normalBulletLifetimeSeconds: 6,
    normalBulletCancelEnabled: true,

    // 掉落
    firstDropDelaySeconds: 8,
    dropIntervalMinSeconds: 10,
    dropIntervalMaxSeconds: 16,
    maxDropsOnField: 2,
    dropLifetimeSeconds: 16,
    enableShield: true,
    weightShield: 1,
    enableRapidFire: true,
    weightRapidFire: 1,
    enableShotgun: true,
    weightShotgun: 1,
    enableLaser: true,
    weightLaser: 1,
    enableHoming: true,
    weightHoming: 1,
    enableFrag: true,
    weightFrag: 1,
    enableMine: true,
    weightMine: 1,

    // 道具与效果
    rapidFireCooldownSeconds: 0.4,
    rapidFireMaxShots: 15,
    rapidFireDurationSeconds: 7,
    shotgunDurationSeconds: 7,
    shotgunPellets: 3,
    shotgunAmmoCost: 2,
    shotgunSpreadAngleDeg: 30,
    shotgunBulletLifetimeSeconds: 4,
    singleUseHoldLimitSeconds: 12,
    shieldDurationSeconds: 30,
    shieldBreakGraceSeconds: 0.25,

    // 特殊攻击
    laserMaxBounces: 6,
    homingLifetimeSeconds: 10,
    fragDetonateDelaySeconds: 1.1,
    fragShardCount: 6,
    fragShardLifetimeSeconds: 3,
    mineArmDelaySeconds: 0.8,

    // 高级手感参数
    tankForwardSpeed: 165,
    tankReverseSpeed: 115,
    tankTurnSpeedDeg: 195,
    normalBulletSpeed: 310,
    homingBulletSpeed: 195,
    homingTurnRateDeg: 230,
    mineTriggerRadius: 30,
    mineBlastRadius: 76,
  };
}

export const TANK_RULE_GROUPS: RuleGroupSchema[] = [
  { id: 'match', title: '赛制', description: '目标胜分、回合倒数与可选时间限制' },
  { id: 'map', title: '地图与出生', description: '迷宫尺寸、环路数量、编号复玩与出生策略' },
  { id: 'combat', title: '坦克与普通弹', description: '弹夹容量、补弹速度、冷却与子弹抵消' },
  { id: 'drops', title: '掉落与权重', description: '场上道具刷新节奏及七类道具独立启停与权重' },
  { id: 'items', title: '道具与效果', description: '连发、三连发、护盾及单次道具待用时限' },
  { id: 'special', title: '特殊攻击', description: '激光反射、追踪弹、破片弹与地雷参数' },
  {
    id: 'advanced',
    title: '高级手感参数',
    description: '车速、转向角速度、弹速及地雷感应与爆炸半径',
    advanced: true,
  },
];

export const TANK_RULE_FIELDS: RuleFieldSchema[] = [
  // 赛制
  { key: 'targetScore', group: 'match', label: '获胜目标分', type: 'integer', min: 1, max: 30, unit: '分' },
  { key: 'countdownSeconds', group: 'match', label: '回合开战倒数', type: 'number', min: 0, max: 10, step: 0.5, unit: '秒' },
  { key: 'roundTimeLimitEnabled', group: 'match', label: '启用回合限时', type: 'boolean' },
  {
    key: 'roundTimeLimitSeconds',
    group: 'match',
    label: '回合限时时长',
    type: 'number',
    min: 10,
    max: 600,
    step: 5,
    unit: '秒',
    isHidden: (r) => !r.roundTimeLimitEnabled,
  },

  // 地图与出生
  { key: 'gridCols', group: 'map', label: '迷宫列数（宽）', type: 'integer', min: 6, max: 16, unit: '格' },
  { key: 'gridRows', group: 'map', label: '迷宫行数（高）', type: 'integer', min: 5, max: 12, unit: '格' },
  { key: 'extraPassages', group: 'map', label: '额外通路数（环路）', type: 'integer', min: 0, max: 60, unit: '条' },
  {
    key: 'mapCode',
    group: 'map',
    label: '地图复玩编号',
    type: 'string',
    placeholder: '留空则每场自动生成新地图，如 TB1-10x7-08-3A9F0C12',
    helperText: '输入编号可复玩同一地形并自动回显尺寸与通路数；改动地形参数将刷新编号',
  },
  {
    key: 'spawnMode',
    group: 'map',
    label: '出生点模式',
    type: 'select',
    options: [
      { value: 'fixed', label: '固定出生点' },
      { value: 'random', label: '每回合随机出生点' },
    ],
  },
  {
    key: 'fixedSpawnSwap',
    group: 'map',
    label: '每回合互换出生点',
    type: 'boolean',
    isHidden: (r) => r.spawnMode === 'random',
    helperText: '固定出生模式下，默认每回合交替互换双方点位',
  },

  // 坦克与普通弹
  {
    key: 'controlMode',
    group: 'combat',
    label: '操控模式',
    type: 'select',
    options: [
      { value: 'intuitive', label: '直觉转向（屏幕方向 + 平滑万向炮口）' },
      { value: 'classic', label: '经典坦克操控（进退 + 原地转向）' },
    ],
    helperText: '直觉模式下按屏幕上下左右及斜向移动，转向过渡中任意瞬间开火均可打出 360° 弹道；轻点方向可原地微调角度',
  },
  { key: 'magazineCapacity', group: 'combat', label: '弹夹容量', type: 'integer', min: 1, max: 30, unit: '发' },
  { key: 'reloadIntervalSeconds', group: 'combat', label: '补弹间隔（回 1 发）', type: 'number', min: 0.1, max: 10, step: 0.1, unit: '秒' },
  { key: 'normalFireCooldownSeconds', group: 'combat', label: '普通射击冷却', type: 'number', min: 0.1, max: 5, step: 0.1, unit: '秒' },
  { key: 'normalBulletLifetimeSeconds', group: 'combat', label: '普通弹寿命', type: 'number', min: 1, max: 30, step: 0.5, unit: '秒' },
  { key: 'normalBulletCancelEnabled', group: 'combat', label: '普通子弹互相抵消', type: 'boolean' },

  // 掉落
  { key: 'firstDropDelaySeconds', group: 'drops', label: '首个道具出现时间', type: 'number', min: 0, max: 60, step: 1, unit: '秒' },
  { key: 'dropIntervalMinSeconds', group: 'drops', label: '后续刷新最小间隔', type: 'number', min: 1, max: 60, step: 1, unit: '秒' },
  { key: 'dropIntervalMaxSeconds', group: 'drops', label: '后续刷新最大间隔', type: 'number', min: 1, max: 120, step: 1, unit: '秒' },
  { key: 'maxDropsOnField', group: 'drops', label: '场上同时待拾取上限', type: 'integer', min: 0, max: 10, unit: '个' },
  { key: 'dropLifetimeSeconds', group: 'drops', label: '待拾取道具留场时长', type: 'number', min: 2, max: 60, step: 1, unit: '秒' },

  { key: 'enableShield', group: 'drops', label: '启用 护盾', type: 'boolean' },
  { key: 'weightShield', group: 'drops', label: '护盾 权重', type: 'number', min: 0, max: 20, step: 0.5, isDisabled: (r) => !r.enableShield },
  { key: 'enableRapidFire', group: 'drops', label: '启用 连发', type: 'boolean' },
  { key: 'weightRapidFire', group: 'drops', label: '连发 权重', type: 'number', min: 0, max: 20, step: 0.5, isDisabled: (r) => !r.enableRapidFire },
  { key: 'enableShotgun', group: 'drops', label: '启用 三连发（散弹）', type: 'boolean' },
  { key: 'weightShotgun', group: 'drops', label: '三连发 权重', type: 'number', min: 0, max: 20, step: 0.5, isDisabled: (r) => !r.enableShotgun },
  { key: 'enableLaser', group: 'drops', label: '启用 激光', type: 'boolean' },
  { key: 'weightLaser', group: 'drops', label: '激光 权重', type: 'number', min: 0, max: 20, step: 0.5, isDisabled: (r) => !r.enableLaser },
  { key: 'enableHoming', group: 'drops', label: '启用 追踪弹', type: 'boolean' },
  { key: 'weightHoming', group: 'drops', label: '追踪弹 权重', type: 'number', min: 0, max: 20, step: 0.5, isDisabled: (r) => !r.enableHoming },
  { key: 'enableFrag', group: 'drops', label: '启用 破片弹', type: 'boolean' },
  { key: 'weightFrag', group: 'drops', label: '破片弹 权重', type: 'number', min: 0, max: 20, step: 0.5, isDisabled: (r) => !r.enableFrag },
  { key: 'enableMine', group: 'drops', label: '启用 地雷', type: 'boolean' },
  { key: 'weightMine', group: 'drops', label: '地雷 权重', type: 'number', min: 0, max: 20, step: 0.5, isDisabled: (r) => !r.enableMine },

  // 道具与效果
  { key: 'rapidFireCooldownSeconds', group: 'items', label: '连发射击间隔', type: 'number', min: 0.1, max: 2, step: 0.05, unit: '秒' },
  { key: 'rapidFireMaxShots', group: 'items', label: '连发最大射出颗数', type: 'integer', min: 1, max: 50, unit: '发' },
  { key: 'rapidFireDurationSeconds', group: 'items', label: '连发持续时长', type: 'number', min: 1, max: 30, step: 0.5, unit: '秒' },
  { key: 'shotgunDurationSeconds', group: 'items', label: '三连发持续时长', type: 'number', min: 1, max: 30, step: 0.5, unit: '秒' },
  { key: 'shotgunPellets', group: 'items', label: '三连发单次弹丸数', type: 'integer', min: 2, max: 7, unit: '颗' },
  { key: 'shotgunAmmoCost', group: 'items', label: '三连发单次耗弹', type: 'integer', min: 1, max: 5, unit: '发' },
  { key: 'shotgunSpreadAngleDeg', group: 'items', label: '散弹总张角', type: 'number', min: 4, max: 90, step: 2, unit: '°' },
  { key: 'shotgunBulletLifetimeSeconds', group: 'items', label: '散弹子弹寿命', type: 'number', min: 1, max: 20, step: 0.5, unit: '秒' },
  { key: 'singleUseHoldLimitSeconds', group: 'items', label: '单次进攻道具待用时限', type: 'number', min: 2, max: 60, step: 1, unit: '秒' },
  { key: 'shieldDurationSeconds', group: 'items', label: '护盾持续时长', type: 'number', min: 2, max: 90, step: 1, unit: '秒' },
  { key: 'shieldBreakGraceSeconds', group: 'items', label: '破盾保护时间', type: 'number', min: 0, max: 2, step: 0.05, unit: '秒' },

  // 特殊攻击
  { key: 'laserMaxBounces', group: 'special', label: '激光最大墙面反射次数', type: 'integer', min: 0, max: 15, unit: '次' },
  { key: 'homingLifetimeSeconds', group: 'special', label: '追踪弹最长飞行时间', type: 'number', min: 2, max: 30, step: 0.5, unit: '秒' },
  { key: 'fragDetonateDelaySeconds', group: 'special', label: '破片弹引爆延迟', type: 'number', min: 0.2, max: 5, step: 0.1, unit: '秒' },
  { key: 'fragShardCount', group: 'special', label: '破片弹分裂碎片数', type: 'integer', min: 2, max: 24, unit: '枚' },
  { key: 'fragShardLifetimeSeconds', group: 'special', label: '碎片持续时间', type: 'number', min: 1, max: 15, step: 0.5, unit: '秒' },
  { key: 'mineArmDelaySeconds', group: 'special', label: '地雷布防延迟', type: 'number', min: 0, max: 5, step: 0.1, unit: '秒' },

  // 高级手感参数
  { key: 'tankForwardSpeed', group: 'advanced', label: '坦克前进速度', type: 'number', min: 60, max: 350, step: 5, unit: '单位/秒' },
  { key: 'tankReverseSpeed', group: 'advanced', label: '坦克倒车速度', type: 'number', min: 40, max: 280, step: 5, unit: '单位/秒' },
  { key: 'tankTurnSpeedDeg', group: 'advanced', label: '车身转向速度', type: 'number', min: 60, max: 420, step: 5, unit: '°/秒' },
  { key: 'normalBulletSpeed', group: 'advanced', label: '普通弹飞行速度', type: 'number', min: 120, max: 650, step: 10, unit: '单位/秒' },
  { key: 'homingBulletSpeed', group: 'advanced', label: '追踪弹飞行速度', type: 'number', min: 80, max: 420, step: 5, unit: '单位/秒' },
  { key: 'homingTurnRateDeg', group: 'advanced', label: '追踪弹转向上限', type: 'number', min: 60, max: 540, step: 10, unit: '°/秒' },
  { key: 'mineTriggerRadius', group: 'advanced', label: '地雷触发半径', type: 'number', min: 14, max: 70, step: 2, unit: '单位' },
  { key: 'mineBlastRadius', group: 'advanced', label: '地雷伤害半径', type: 'number', min: 24, max: 160, step: 4, unit: '单位' },
];

export function migrateTankRules(raw: unknown): {
  rules: TankBattleRules;
  migrated: boolean;
  recoveredFromError: boolean;
} {
  const defaults = getDefaultTankRules();
  if (typeof raw !== 'object' || raw === null) {
    return { rules: defaults, migrated: false, recoveredFromError: raw !== undefined && raw !== null };
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
        if (key === 'spawnMode') {
          out[key] = val === 'random' ? 'random' : 'fixed';
        } else if (key === 'controlMode') {
          out[key] = val === 'classic' ? 'classic' : 'intuitive';
        } else {
          out[key] = val;
        }
      } else {
        recovered = true;
      }
    }
  }

  // 兼容旧版 v1 持久化规则：若未手动改过旧版默认值，自动升级到新版弹药与碎片弹平衡参数
  const isLegacyV1 = 'fragTotalLifetimeSeconds' in src && !('fragShardLifetimeSeconds' in src);
  if (isLegacyV1) {
    if (out.normalBulletLifetimeSeconds === 10) {
      out.normalBulletLifetimeSeconds = defaults.normalBulletLifetimeSeconds;
    }
    if (out.fragShardCount === 12) {
      out.fragShardCount = defaults.fragShardCount;
    }
  }

  return {
    rules: out as unknown as TankBattleRules,
    migrated: true,
    recoveredFromError: recovered,
  };
}

/**
 * 联动处理：
 * - 输入合法地图编号时，回显网格列数、行数和额外通路数
 * - 手动改动网格列数、行数或额外通路数时，自动生成反映新地形参数的新编号
 */
export function handleTankRuleFieldChange(
  prevRules: TankBattleRules,
  fieldKey: string,
  nextValue: unknown
): TankBattleRules {
  const next: TankBattleRules = {
    ...prevRules,
    [fieldKey]: nextValue,
  } as TankBattleRules;

  if (fieldKey === 'mapCode' && typeof nextValue === 'string') {
    const parsed = parseMapCode(nextValue);
    if (parsed) {
      next.gridCols = parsed.cols;
      next.gridRows = parsed.rows;
      next.extraPassages = parsed.extraPassages;
    }
    return next;
  }

  if (
    fieldKey === 'gridCols' ||
    fieldKey === 'gridRows' ||
    fieldKey === 'extraPassages'
  ) {
    if (
      Number.isInteger(next.gridCols) &&
      next.gridCols >= 6 &&
      next.gridCols <= 16 &&
      Number.isInteger(next.gridRows) &&
      next.gridRows >= 5 &&
      next.gridRows <= 12 &&
      Number.isInteger(next.extraPassages) &&
      next.extraPassages >= 0 &&
      next.extraPassages <= 60
    ) {
      next.mapCode = generateFreshMapCode(
        next.gridCols,
        next.gridRows,
        next.extraPassages
      );
    }
  }

  return next;
}

/**
 * 前后端/设置与开局共用同一套完整校验逻辑。
 */
export function validateTankRules(rules: TankBattleRules): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const checkInt = (field: keyof TankBattleRules, min: number, max: number, label: string) => {
    const val = rules[field];
    if (typeof val !== 'number' || !Number.isInteger(val) || val < min || val > max) {
      issues.push({
        field: String(field),
        severity: 'error',
        message: `${label}须为 ${min}～${max} 的整数`,
      });
    }
  };

  const checkPos = (field: keyof TankBattleRules, label: string, min = 0.0001, max = 10000) => {
    const val = rules[field];
    if (typeof val !== 'number' || !Number.isFinite(val) || val < min || val > max) {
      issues.push({
        field: String(field),
        severity: 'error',
        message: `${label}须为大于 0 的有效数值`,
      });
    }
  };

  const checkNonNeg = (field: keyof TankBattleRules, label: string, max = 10000) => {
    const val = rules[field];
    if (typeof val !== 'number' || !Number.isFinite(val) || val < 0 || val > max) {
      issues.push({
        field: String(field),
        severity: 'error',
        message: `${label}须为不小于 0 的有效数值`,
      });
    }
  };

  // 赛制
  checkInt('targetScore', 1, 30, '获胜目标分');
  checkNonNeg('countdownSeconds', '回合开战倒数', 30);
  if (rules.roundTimeLimitEnabled) {
    checkPos('roundTimeLimitSeconds', '回合限时时长', 5, 3600);
  }

  // 地图与出生
  checkInt('gridCols', 6, 16, '迷宫列数');
  checkInt('gridRows', 5, 12, '迷宫行数');
  checkInt('extraPassages', 0, 60, '额外通路数');
  if (rules.mapCode.trim().length > 0) {
    const parsed = parseMapCode(rules.mapCode);
    if (!parsed) {
      issues.push({
        field: 'mapCode',
        severity: 'error',
        message: '地图编号格式无效（示例：TB1-10x7-08-3A9F0C12）',
      });
    }
  }

  // 坦克与普通弹
  checkInt('magazineCapacity', 1, 30, '弹夹容量');
  checkPos('reloadIntervalSeconds', '补弹间隔', 0.05, 60);
  checkPos('normalFireCooldownSeconds', '普通射击冷却', 0.05, 30);
  checkPos('normalBulletLifetimeSeconds', '普通弹寿命', 0.5, 120);

  // 掉落
  checkNonNeg('firstDropDelaySeconds', '首个道具出现时间', 300);
  checkPos('dropIntervalMinSeconds', '刷新最小间隔', 0.5, 300);
  checkPos('dropIntervalMaxSeconds', '刷新最大间隔', 0.5, 600);
  if (
    Number.isFinite(rules.dropIntervalMinSeconds) &&
    Number.isFinite(rules.dropIntervalMaxSeconds) &&
    rules.dropIntervalMinSeconds > rules.dropIntervalMaxSeconds
  ) {
    issues.push({
      field: 'dropIntervalMinSeconds',
      severity: 'error',
      message: '刷新间隔下限不能大于上限',
    });
  }
  checkInt('maxDropsOnField', 0, 10, '场上待拾取上限');
  checkPos('dropLifetimeSeconds', '道具留场时长', 1, 300);

  const itemWeightPairs: Array<[keyof TankBattleRules, keyof TankBattleRules, string]> = [
    ['enableShield', 'weightShield', '护盾'],
    ['enableRapidFire', 'weightRapidFire', '连发'],
    ['enableShotgun', 'weightShotgun', '三连发'],
    ['enableLaser', 'weightLaser', '激光'],
    ['enableHoming', 'weightHoming', '追踪弹'],
    ['enableFrag', 'weightFrag', '破片弹'],
    ['enableMine', 'weightMine', '地雷'],
  ];

  let anyItemEnabled = false;
  let totalEnabledWeight = 0;
  for (const [enKey, wKey, label] of itemWeightPairs) {
    const enabled = Boolean(rules[enKey]);
    const weight = rules[wKey];
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) {
      issues.push({
        field: String(wKey),
        severity: 'error',
        message: `${label}权重不能小于 0`,
      });
    }
    if (enabled) {
      anyItemEnabled = true;
      if (typeof weight === 'number' && Number.isFinite(weight) && weight > 0) {
        totalEnabledWeight += weight;
      }
    }
  }
  if (anyItemEnabled && totalEnabledWeight <= 0) {
    issues.push({
      field: 'weightShield',
      severity: 'error',
      message: '已启用的道具总权重必须大于 0',
    });
  }

  // 道具与效果
  checkPos('rapidFireCooldownSeconds', '连发射击间隔', 0.05, 10);
  checkInt('rapidFireMaxShots', 1, 50, '连发最大射出颗数');
  checkPos('rapidFireDurationSeconds', '连发持续时长', 0.5, 120);
  checkPos('shotgunDurationSeconds', '三连发持续时长', 0.5, 120);
  checkInt('shotgunPellets', 2, 7, '三连发弹丸数');
  checkInt('shotgunAmmoCost', 1, 10, '三连发单次耗弹');
  checkPos('shotgunSpreadAngleDeg', '散弹总张角', 1, 160);
  checkPos('shotgunBulletLifetimeSeconds', '散弹子弹寿命', 0.5, 60);
  checkPos('singleUseHoldLimitSeconds', '单次道具待用时限', 0.5, 180);
  checkPos('shieldDurationSeconds', '护盾持续时长', 0.5, 180);
  checkNonNeg('shieldBreakGraceSeconds', '破盾保护时间', 10);

  if (
    rules.enableShotgun &&
    Number.isInteger(rules.magazineCapacity) &&
    Number.isInteger(rules.shotgunAmmoCost) &&
    rules.magazineCapacity < rules.shotgunAmmoCost
  ) {
    issues.push({
      field: 'magazineCapacity',
      severity: 'warning',
      message: `三连发单次耗弹 ${rules.shotgunAmmoCost} 发，当前弹夹容量（${rules.magazineCapacity} 发）不足，将无法发射三连发`,
    });
  }

  // 特殊攻击
  checkInt('laserMaxBounces', 0, 20, '激光最大反射次数');
  checkPos('homingLifetimeSeconds', '追踪弹飞行时间', 0.5, 60);
  checkPos('fragDetonateDelaySeconds', '破片弹引爆延迟', 0.1, 20);
  checkInt('fragShardCount', 2, 36, '破片弹碎片数');
  checkPos('fragShardLifetimeSeconds', '碎片持续时间', 0.5, 30);
  checkNonNeg('mineArmDelaySeconds', '地雷布防延迟', 15);

  // 高级手感参数
  checkPos('tankForwardSpeed', '前进速度', 20, 600);
  checkPos('tankReverseSpeed', '倒车速度', 20, 600);
  checkPos('tankTurnSpeedDeg', '转向速度', 20, 720);
  checkPos('normalBulletSpeed', '普通弹速度', 40, 1200);
  checkPos('homingBulletSpeed', '追踪弹速度', 30, 800);
  checkPos('homingTurnRateDeg', '追踪弹转向上限', 20, 900);
  checkPos('mineTriggerRadius', '地雷触发半径', 8, 120);
  checkPos('mineBlastRadius', '地雷伤害半径', 12, 240);
  if (
    Number.isFinite(rules.mineTriggerRadius) &&
    Number.isFinite(rules.mineBlastRadius) &&
    rules.mineBlastRadius < rules.mineTriggerRadius
  ) {
    issues.push({
      field: 'mineBlastRadius',
      severity: 'warning',
      message: '地雷伤害半径小于触发半径，可能出现触发后未命中的情况',
    });
  }

  return issues;
}
