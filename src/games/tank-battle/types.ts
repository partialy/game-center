import type {
  PlayerMatchStats,
  PlayerSlotId,
  SessionPhase,
} from '../../platform/games/contracts';

export const CELL_SIZE = 100;
export const WALL_THICKNESS = 10;
export const WALL_HALF = WALL_THICKNESS / 2;
export const TANK_RADIUS = 19;
export const TANK_BARREL_LENGTH = 28;
export const NORMAL_BULLET_RADIUS = 5;
export const SPECIAL_BULLET_RADIUS = 6;
export const FRAG_SHARD_RADIUS = 4;
export const DROP_PICKUP_RADIUS = 17;
export const MINE_VISUAL_RADIUS = 11;

export type SpawnMode = 'fixed' | 'random';
export type ControlMode = 'intuitive' | 'classic';

export type ItemKind =
  | 'shield'
  | 'rapid_fire'
  | 'shotgun'
  | 'laser'
  | 'homing'
  | 'frag'
  | 'mine';

export type OffensiveItemKind = Exclude<ItemKind, 'shield'>;

export const ALL_ITEM_KINDS: ItemKind[] = [
  'shield',
  'rapid_fire',
  'shotgun',
  'laser',
  'homing',
  'frag',
  'mine',
];

export const ITEM_LABELS: Record<ItemKind, string> = {
  shield: '护盾',
  rapid_fire: '连发',
  shotgun: '三连发',
  laser: '激光',
  homing: '追踪弹',
  frag: '破片弹',
  mine: '地雷',
};

export interface TankBattleRules {
  // 赛制
  targetScore: number;
  countdownSeconds: number;
  roundTimeLimitEnabled: boolean;
  roundTimeLimitSeconds: number;

  // 地图与出生
  gridCols: number;
  gridRows: number;
  extraPassages: number;
  mapCode: string;
  spawnMode: SpawnMode;
  fixedSpawnSwap: boolean;

  // 坦克与普通弹
  controlMode: ControlMode;
  magazineCapacity: number;
  reloadIntervalSeconds: number;
  normalFireCooldownSeconds: number;
  normalBulletLifetimeSeconds: number;
  normalBulletCancelEnabled: boolean;

  // 掉落
  firstDropDelaySeconds: number;
  dropIntervalMinSeconds: number;
  dropIntervalMaxSeconds: number;
  maxDropsOnField: number;
  dropLifetimeSeconds: number;
  enableShield: boolean;
  weightShield: number;
  enableRapidFire: boolean;
  weightRapidFire: number;
  enableShotgun: boolean;
  weightShotgun: number;
  enableLaser: boolean;
  weightLaser: number;
  enableHoming: boolean;
  weightHoming: number;
  enableFrag: boolean;
  weightFrag: number;
  enableMine: boolean;
  weightMine: number;

  // 道具与效果
  rapidFireCooldownSeconds: number;
  rapidFireMaxShots: number;
  rapidFireDurationSeconds: number;
  shotgunDurationSeconds: number;
  shotgunPellets: number;
  shotgunAmmoCost: number;
  shotgunSpreadAngleDeg: number;
  shotgunBulletLifetimeSeconds: number;
  singleUseHoldLimitSeconds: number;
  shieldDurationSeconds: number;
  shieldBreakGraceSeconds: number;

  // 特殊攻击
  laserMaxBounces: number;
  homingLifetimeSeconds: number;
  fragDetonateDelaySeconds: number;
  fragShardCount: number;
  fragShardLifetimeSeconds: number;
  mineArmDelaySeconds: number;

  // 高级手感参数
  tankForwardSpeed: number;
  tankReverseSpeed: number;
  tankTurnSpeedDeg: number;
  normalBulletSpeed: number;
  homingBulletSpeed: number;
  homingTurnRateDeg: number;
  mineTriggerRadius: number;
  mineBlastRadius: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface WallSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  orientation: 'h' | 'v';
}

export interface MazeCell {
  col: number;
  row: number;
  index: number;
  centerX: number;
  centerY: number;
  neighbors: number[]; // 通路可达的相邻格 index
}

export interface MazeData {
  version: number;
  seed: number;
  cols: number;
  rows: number;
  extraPassages: number;
  mapCode: string;
  width: number;
  height: number;
  cells: MazeCell[];
  walls: WallSegment[];
  /** 每个格子的通行边界标志，供快速查墙与绘制 */
  horizontalWalls: boolean[][]; // [row 0..rows][col 0..cols-1]
  verticalWalls: boolean[][]; // [row 0..rows-1][col 0..cols]
}

export interface SpawnPoint {
  cellIndex: number;
  x: number;
  y: number;
  angle: number;
}

export interface ShieldSlotState {
  expiresAtBattleTime: number;
  durationSeconds: number;
}

export type OffensiveSlotState =
  | {
      kind: 'rapid_fire';
      expiresAtBattleTime: number;
      durationSeconds: number;
      remainingShots: number;
      maxShots: number;
      usedRecorded?: boolean;
    }
  | {
      kind: 'shotgun';
      expiresAtBattleTime: number;
      durationSeconds: number;
      usedRecorded?: boolean;
    }
  | {
      kind: 'laser' | 'homing' | 'frag' | 'mine';
      expiresAtBattleTime: number;
      durationSeconds: number;
    };

export interface TankEntity {
  slotId: PlayerSlotId;
  displayName: string;
  colorHex: string;
  x: number;
  y: number;
  angle: number; // radians, 0 = +X
  alive: boolean;
  /** 淘汰后短暂残留表现（用于爆炸/残骸视觉） */
  eliminatedAtBattleTime: number | null;
  ammo: number;
  maxAmmo: number;
  /** 非满弹时下一次回弹的战斗时间戳；满弹时为 null */
  nextReloadAt: number | null;
  /** 下一次可开火的战斗时间戳 */
  fireReadyAt: number;
  /** 破盾后的短暂无敌截止时间戳 */
  shieldGraceUntil: number;
  shield: ShieldSlotState | null;
  offense: OffensiveSlotState | null;
  /** 视觉反馈（后坐力与受击白闪）与直觉转向轻点微调计时 */
  recoilOffset: number;
  hitFlashTimer: number;
  treadDistance: number;
  moveHoldTime: number;
}

export type ProjectileSourceKind =
  | 'normal'
  | 'rapid_fire'
  | 'shotgun'
  | 'homing'
  | 'frag_parent'
  | 'frag_shard';

export interface ProjectileEntity {
  id: number;
  ownerSlotId: PlayerSlotId;
  colorHex: string;
  source: ProjectileSourceKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  speed: number;
  spawnedAtBattleTime: number;
  expiresAtBattleTime: number;
  /** 新出膛时对发射者免疫，离开机身或首次撞墙后解锁自伤 */
  selfDamageUnlocked: boolean;
  /** 破片母弹引爆时间戳 */
  detonateAtBattleTime?: number;
  /** 追踪弹路径重算计时 */
  repathTimer?: number;
  /** 追踪弹目标点缓存 */
  waypoint?: Vec2 | null;
  /** 视觉尾迹点 */
  trail: Vec2[];
}

export interface MineEntity {
  id: number;
  ownerSlotId: PlayerSlotId;
  colorHex: string;
  x: number;
  y: number;
  placedAtBattleTime: number;
  armedAtBattleTime: number;
}

export interface DroppedItemEntity {
  id: number;
  kind: ItemKind;
  cellIndex: number;
  x: number;
  y: number;
  spawnedAtBattleTime: number;
  expiresAtBattleTime: number;
}

export interface LaserBeamEffect {
  id: number;
  ownerSlotId: PlayerSlotId;
  colorHex: string;
  points: Vec2[];
  remainingVisualSeconds: number;
  maxVisualSeconds: number;
}

export interface ExplosionEffect {
  id: number;
  x: number;
  y: number;
  radius: number;
  colorHex: string;
  remainingVisualSeconds: number;
  maxVisualSeconds: number;
}

export interface VisualCueEvent {
  kind: 'muzzle' | 'bounce' | 'cancel' | 'pickup' | 'shield_break' | 'explosion' | 'frag_split';
  x: number;
  y: number;
  angle?: number;
  colorHex: string;
  radius?: number;
}

export interface TankWorldState {
  rules: TankBattleRules;
  maze: MazeData;
  phase: SessionPhase;
  roundNumber: number;
  drawRounds: number;
  scores: Record<PlayerSlotId, number>;
  playerStats: Record<PlayerSlotId, PlayerMatchStats>;
  countdownRemaining: number;
  battleTime: number;
  totalBattleTime: number;
  roundOverTimer: number;
  roundOverDuration: number;
  roundWinnerSlotId: PlayerSlotId | null;
  roundOverReason: string;
  nextDropAtBattleTime: number | null;
  tanks: TankEntity[];
  projectiles: ProjectileEntity[];
  mines: MineEntity[];
  drops: DroppedItemEntity[];
  laserBeams: LaserBeamEffect[];
  explosions: ExplosionEffect[];
  /** 本帧供渲染器消费的一次性粒子/震动事件队列 */
  visualCues: VisualCueEvent[];
  hitstopTimer: number;
  screenShakeTrauma: number;
}
