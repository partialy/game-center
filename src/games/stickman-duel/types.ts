import type {
  PlayerConfig,
  PlayerMatchStats,
  PlayerSlotId,
  RoundBannerInfo,
  SessionPhase,
} from '../../platform/games/contracts';

export type TerrainTileKind = 'empty' | 'bedrock' | 'brick' | 'platform';

export type StickmanMapTemplate =
  | 'random'
  | 'twin_towers'
  | 'stepped_ruins'
  | 'sky_platforms'
  | 'fortress_bunkers';

export type StickWeaponKind = 'sword' | 'pistol' | 'shotgun' | 'rocket';
export type StickPickupKind = StickWeaponKind | 'medkit';
export type StickmanDropSpawnMode = 'random' | 'center';

export interface HeldWeaponState {
  kind: StickWeaponKind;
  /** 剑=剩余耐久(默认5，命中敌人-1)；枪=剩余子弹(初始3)；猎枪=剩余子弹(初始2)；火箭筒=剩余火箭(初始1) */
  remaining: number;
  max: number;
}

export type FighterAttackKind = 'punch' | 'kick' | 'sword' | 'pistol' | 'shotgun' | 'rocket';

export interface FighterAttackState {
  kind: FighterAttackKind;
  /** 0..totalDuration 已经过时间 */
  elapsed: number;
  totalDuration: number;
  startup: number;
  activeEnd: number;
  aimX: number;
  aimY: number;
  /** 防止单次挥拳/踢腿/挥剑对同一目标重复结算多次 */
  hitSlotIds: PlayerSlotId[];
  /** 连击段位（拳 0/1/2） */
  comboStep: number;
  /** 远程开火是否在 startup 到达时已发射 */
  projectileFired: boolean;
}

export interface ScarfNode {
  x: number;
  y: number;
}

export interface StickFighter {
  slotId: PlayerSlotId;
  config: PlayerConfig;
  /** 碰撞盒中心 X，底部脚底 Y */
  x: number;
  y: number;
  vx: number;
  vy: number;
  halfWidth: number;
  height: number;
  facing: -1 | 1;
  aimX: number;
  aimY: number;
  hp: number;
  maxHp: number;
  /** 延迟白条显示血量（用于打击感扣血缓冲） */
  displayHp: number;
  alive: boolean;
  onGround: boolean;
  onPlatform: boolean;
  coyoteTimer: number;
  jumpBufferTimer: number;
  jumpsUsed: number;
  maxJumps: number;
  dropThroughTimer: number;
  /** 动画/状态机计时 */
  runPhase: number;
  airSpinAngle: number;
  hitStunTimer: number;
  hitFlashTimer: number;
  invulnTimer: number;
  /** 同一次散弹齐射 ID（允许同一发猎枪的 3 枚小弹同时命中，不与受伤无敌期冲突） */
  lastHitVolleyId: number | null;
  swapCooldown: number;
  attackCooldown: number;
  comboStep: number;
  comboResetTimer: number;
  attack: FighterAttackState | null;
  weapon: HeldWeaponState | null;
  /** 头巾动态节点（用于飘动视觉与辨识） */
  scarf: ScarfNode[];
  /** 最近可拾取武器 ID（用于脚下/物体上方提示与虚拟手柄 B 键脉冲） */
  nearbyDropId: number | null;
  nearbyDropLabel: string | null;
  /** KO 后翻滚角度 */
  koSpin: number;
  koTimer: number;
}

export interface GroundPickup {
  id: number;
  kind: StickPickupKind;
  /** 剩余耐久或弹药；血包固定为 1 */
  remaining: number;
  max: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  onGround: boolean;
  age: number;
  lifetime: number;
  /** 刚被抛出后短时间内不可被同一玩家立刻捡回 */
  pickupLockTimer: number;
  droppedBySlotId: PlayerSlotId | null;
}

export interface StickProjectile {
  id: number;
  kind: 'pistol' | 'shotgun' | 'rocket';
  /** 猎枪单发齐射编号，用于同一发多枚弹丸的伤害结算 */
  volleyId?: number;
  ownerSlotId: PlayerSlotId;
  colorHex: string;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  knockback: number;
  gravityScale: number;
  age: number;
  maxAge: number;
  blastRadius: number;
}

export interface CombatParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  age: number;
  maxAge: number;
  gravity: number;
  kind: 'spark' | 'smoke' | 'debris' | 'shell' | 'heal' | 'dust';
  rotation: number;
  vRot: number;
}

export interface SlashEffect {
  x: number;
  y: number;
  angle: number;
  radius: number;
  arcSpan: number;
  color: string;
  age: number;
  maxAge: number;
  kind: 'sword' | 'punch' | 'kick';
}

export interface ExplosionEffect {
  x: number;
  y: number;
  radius: number;
  age: number;
  maxAge: number;
  color: string;
}

export interface FloatingCombatText {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  scale: number;
  age: number;
  maxAge: number;
}

export interface StickmanTerrain {
  cols: number;
  rows: number;
  tileSize: number;
  width: number;
  height: number;
  template: Exclude<StickmanMapTemplate, 'random'>;
  /** 长度 cols * rows，索引 r * cols + c；最底行 rows - 1 恒为 bedrock */
  tiles: TerrainTileKind[];
  /** 每个格子的随机外观种子（0..255），用于稳定绘制裂纹与砖缝 */
  variants: Uint8Array;
  spawnPoints: Array<{ x: number; y: number }>;
}

export interface StickmanDuelRules extends Record<string, unknown> {
  // 赛制
  targetScore: number;
  countdownSeconds: number;
  roundTimeLimitEnabled: boolean;
  roundTimeLimitSeconds: number;

  // 地图
  mapTemplate: StickmanMapTemplate;
  mapCode: string;

  // 角色与血量手感（combat / advanced）
  maxHp: number;
  hurtInvulnSeconds: number;
  moveSpeed: number;
  jumpVelocity: number;
  gravity: number;
  punchDamage: number;
  kickDamage: number;
  kickKnockback: number;

  // 武器与道具（drops / items）
  dropSpawnMode: StickmanDropSpawnMode;
  firstDropDelaySeconds: number;
  dropIntervalMinSeconds: number;
  dropIntervalMaxSeconds: number;
  maxDropsOnField: number;
  swordDurability: number;
  swordDamage: number;
  pistolAmmo: number;
  pistolDamage: number;
  pistolSpeed: number;
  shotgunAmmo: number;
  shotgunPellets: number;
  shotgunSpreadAngleDeg: number;
  shotgunDamage: number;
  shotgunSpeed: number;
  rocketAmmo: number;
  rocketDamage: number;
  rocketSpeed: number;
  rocketGravity: number;
  rocketBlastRadius: number;
  medkitHealPercent: number;
  enableSword: boolean;
  enablePistol: boolean;
  enableShotgun: boolean;
  enableRocket: boolean;
  enableMedkit: boolean;
}

export interface StickmanWorld {
  phase: SessionPhase;
  roundNumber: number;
  targetScore: number;
  countdownSeconds: number;
  battleElapsedSeconds: number;
  roundTimeRemainingSeconds: number | null;
  totalBattleSeconds: number;
  mapCode: string;
  terrain: StickmanTerrain;
  fighters: StickFighter[];
  pickups: GroundPickup[];
  projectiles: StickProjectile[];
  particles: CombatParticle[];
  slashes: SlashEffect[];
  explosions: ExplosionEffect[];
  floatingTexts: FloatingCombatText[];
  scores: Record<PlayerSlotId, number>;
  stats: Record<PlayerSlotId, PlayerMatchStats>;
  drawRounds: number;
  roundBanner: RoundBannerInfo | null;
  /** 打击感：顿帧与方向性震屏 */
  hitstopTimer: number;
  shakeIntensity: number;
  shakeDirX: number;
  shakeDirY: number;
  rules: StickmanDuelRules;
}
