import type {
  StickmanTerrain,
  StickmanTrainingDrill,
  StickmanTrainingState,
  StickmanTrainingStats,
  TrainingDummyMotion,
  TrainingParryAmmo,
  TrainingParryCadence,
  TrainingParryShotKind,
} from '../types';

export interface TrainingDrillMeta {
  id: StickmanTrainingDrill;
  label: string;
  shortHint: string;
  defaultWeapon: 'sword' | 'pistol' | null;
  defaultInfiniteWeapon: boolean;
  defaultShowHitZones: boolean;
  defaultDummyMotion: TrainingDummyMotion;
}

export const TRAINING_DRILL_LIST: ReadonlyArray<TrainingDrillMeta> = [
  {
    id: 'free',
    label: '自由沙盒',
    shortHint: '不死假人 · 随意发道具与拆墙',
    defaultWeapon: null,
    defaultInfiniteWeapon: false,
    defaultShowHitZones: false,
    defaultDummyMotion: 'stand',
  },
  {
    id: 'headshot',
    label: '爆头专练',
    shortHint: '瞄准红区 1.5× 爆头 · 躯干 1.0× · 腿脚 0.6×',
    defaultWeapon: 'pistol',
    defaultInfiniteWeapon: true,
    defaultShowHitZones: true,
    defaultDummyMotion: 'stand',
  },
  {
    id: 'parry',
    label: '砍子弹',
    shortHint: '持剑挥斩来袭子弹/散弹/碎片（红线火箭不可砍）',
    defaultWeapon: 'sword',
    defaultInfiniteWeapon: true,
    defaultShowHitZones: false,
    defaultDummyMotion: 'stand',
  },
  {
    id: 'combo',
    label: '连招木桩',
    shortHint: '不死假人实时统计连击段数与单套伤害',
    defaultWeapon: null,
    defaultInfiniteWeapon: false,
    defaultShowHitZones: false,
    defaultDummyMotion: 'stand',
  },
];

export const TRAINING_PARRY_TELEGRAPH_SECONDS = 0.4;

const MIXED_PARRY_CYCLE: ReadonlyArray<TrainingParryShotKind> = [
  'pistol',
  'shotgun',
  'pistol',
  'grenade',
  'rocket',
];

export function isValidTrainingDrill(value: unknown): value is StickmanTrainingDrill {
  return value === 'free' || value === 'headshot' || value === 'parry' || value === 'combo';
}

export function getTrainingDrillMeta(drill: StickmanTrainingDrill): TrainingDrillMeta {
  return TRAINING_DRILL_LIST.find((item) => item.id === drill) ?? TRAINING_DRILL_LIST[0];
}

export function createEmptyTrainingStats(): StickmanTrainingStats {
  return {
    comboHits: 0,
    comboDamage: 0,
    bestComboHits: 0,
    bestComboDamage: 0,
    comboResetTimer: 0,
    totalHits: 0,
    headshots: 0,
    bodyHits: 0,
    legHits: 0,
    headshotStreak: 0,
    bestHeadshotStreak: 0,
    parries: 0,
    parryStreak: 0,
    bestParryStreak: 0,
    playerHitsTaken: 0,
  };
}

export function getParryIntervalSeconds(cadence: TrainingParryCadence): number {
  if (cadence === 'slow') return 1.95;
  if (cadence === 'fast') return 0.82;
  return 1.28;
}

export function pickNextParryShotKind(
  ammo: TrainingParryAmmo,
  sequenceIndex: number
): TrainingParryShotKind {
  if (ammo === 'pistol') return 'pistol';
  if (ammo === 'shotgun') return 'shotgun';
  if (ammo === 'grenade') return 'grenade';
  const idx = ((sequenceIndex % MIXED_PARRY_CYCLE.length) + MIXED_PARRY_CYCLE.length) % MIXED_PARRY_CYCLE.length;
  return MIXED_PARRY_CYCLE[idx];
}

export function computeHeadshotRatePercent(stats: StickmanTrainingStats): number {
  const rangedTotal = stats.headshots + stats.bodyHits + stats.legHits;
  if (rangedTotal <= 0) return 0;
  return Math.round((stats.headshots / rangedTotal) * 100);
}

export function computeDummyDesiredVx(
  dummyX: number,
  homeX: number,
  elapsedSeconds: number,
  motion: TrainingDummyMotion,
  moveSpeed: number
): number {
  if (motion === 'stand') {
    const dx = homeX - dummyX;
    if (Math.abs(dx) <= 6) return 0;
    return Math.sign(dx) * Math.min(Math.abs(dx) * 3.5, moveSpeed * 0.65);
  }
  const amplitude = motion === 'strafe' ? 128 : 92;
  const freq = motion === 'strafe' ? 1.85 : 1.35;
  const targetX = homeX + Math.sin(elapsedSeconds * freq) * amplitude;
  const diff = targetX - dummyX;
  if (Math.abs(diff) <= 4) return 0;
  return Math.sign(diff) * Math.min(Math.abs(diff) * 5.2, moveSpeed * 0.78);
}

export function createInitialTrainingState(
  drill: StickmanTrainingDrill,
  terrain: StickmanTerrain
): StickmanTrainingState {
  const meta = getTrainingDrillMeta(drill);
  const dummySpawn = terrain.spawnPoints[1] ?? {
    x: terrain.width * 0.72,
    y: (terrain.rows - 1) * terrain.tileSize,
  };
  const cadence: TrainingParryCadence = 'normal';
  const ammo: TrainingParryAmmo = 'pistol';

  return {
    enabled: true,
    drill,
    dummyMotion: meta.defaultDummyMotion,
    infiniteWeapon: meta.defaultInfiniteWeapon,
    showHitZones: meta.defaultShowHitZones,
    zeroHurtInvuln: false,
    parryAmmo: ammo,
    parryCadence: cadence,
    parryFireTimer: 0.9,
    parryTelegraphTimer: 0,
    parryNextKind: pickNextParryShotKind(ammo, 0),
    parryShotIndex: 0,
    dummyIdleHealTimer: 0,
    dummyJumpCooldown: 1.2,
    dummyHomeX: dummySpawn.x,
    dummyHomeY: dummySpawn.y,
    stats: createEmptyTrainingStats(),
    revision: 1,
  };
}
