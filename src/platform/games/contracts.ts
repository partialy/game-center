/**
 * 平台与具体游戏之间的接入契约（纯 TypeScript，不依赖 React 或 DOM）。
 */

export type PlayerSlotId = string; // 例如 'p1' | 'p2'，使用稳定标识而非数组下标

export interface PlayerColorOption {
  id: string;
  label: string;
  hex: string;
  darkHex: string;
  lightHex: string;
}

export interface PlayerProfile {
  slotId: PlayerSlotId;
  /** 1-10 位英文字母，空字符串时界面与战场自动回显默认名（如 P1、P2） */
  name: string;
  colorHex: string;
}

export type GameMode = 'single' | 'multi' | 'brawl';
export type SingleMatchup = 'human_vs_ai' | 'ai_vs_ai';
export type PlayerControllerKind = 'human' | 'ai';
export type BotModelSource = 'builtin' | 'custom';

export interface BotTraitRatings {
  /** 迷宫寻路与抢点能力（1-5） */
  navigation: number;
  /** 弹幕闪避与安全意识（1-5） */
  dodging: number;
  /** 精准瞄准与反弹预判（1-5） */
  aiming: number;
  /** 战术道具争夺与释放（1-5） */
  items: number;
}

/** AI 策略脚本单步输出的动作持续状态（actionId -> held） */
export type BotActionIntent = Record<string, boolean>;

export interface BotAgentInstance<TWorld = unknown> {
  decide(world: TWorld, selfSlotId: PlayerSlotId, dtSeconds: number): BotActionIntent;
}

export interface BotModelDefinition<TWorld = unknown> {
  id: string;
  name: string;
  difficultyLevel: 1 | 2 | 3 | 4 | 5;
  difficultyLabel: string;
  accentColor: string;
  /** 是否为终极 Boss 档位（UI 启用专属暗红深紫高亮，不占用玩家坦克涂装色） */
  isBoss?: boolean;
  summary: string;
  traits: BotTraitRatings;
  createAgent(seed: number): BotAgentInstance<TWorld>;
}

/** 集中定义的 Lv.5 Boss 专属视觉标识（深紫底 + 暗红边框与徽章），不占用玩家涂装色 */
export const BOSS_TIER_THEME = {
  bgHex: '#23102B',
  bgSoftHex: '#2E1436',
  borderHex: '#9E1B32',
  accentHex: '#C81E3D',
  textHex: '#FCE7F3',
  mutedTextHex: '#E9B3C8',
} as const;

export interface BotValidationReport {
  status: 'untested' | 'verified' | 'error';
  checkedAt: number;
  ticksSimulated: number;
  avgDecisionMs: number;
  maxDecisionMs: number;
  actionsTriggered: string[];
  errorMessage?: string;
}

/** 用户通过大模型生成并保存到本地脚本库的自定义 AI 选手 */
export interface CustomBotScriptRecord {
  id: string;
  gameId: string;
  name: string;
  defaultColorHex: string;
  tierLabel: string;
  authorModel: string;
  description: string;
  code: string;
  validation: BotValidationReport;
  createdAt: number;
  updatedAt: number;
}

export interface BotRuntimeStatus {
  slotId: PlayerSlotId;
  state: 'ready' | 'running' | 'timeout' | 'error' | 'recovering';
  avgMs: number;
  timeoutCount: number;
  errorCount: number;
  lastMessage?: string;
}

/** 多 AI 乱斗模式下的单个参战席位配置（支持 2~8 席） */
export interface ArenaSeatConfig {
  slotId: PlayerSlotId;
  name: string;
  colorHex: string;
  controller: PlayerControllerKind;
  aiModelId: string;
  aiSource: BotModelSource;
}

export interface PromptMarkdownOptions {
  includeCurrentRules: boolean;
}

/**
 * 跨游戏通用 AI SDK 适配器契约：
 * 任意游戏只需实现此接口，即可零改造复用平台的 Prompt MD 生成、JS/TS Worker 沙箱、试跑校验与多 AI 乱斗能力。
 */
export interface GameAiSdkAdapter<
  TRules = Record<string, unknown>,
  TWorld = unknown,
  TObservation = Record<string, unknown>,
> {
  schemaVersion: string;
  /** 生成给外部大模型阅读的标准规则与编程指南 Markdown */
  buildPromptMarkdown(rules: TRules, options: PromptMarkdownOptions): string;
  /** 可直接运行的最小示例策略脚本（供新建/参考使用） */
  defaultTemplateCode: string;
  /** 将游戏内部 World 转为纯 JSON 可序列化只读观测快照（传给 Worker 沙箱） */
  buildObservation(world: TWorld, selfSlotId: PlayerSlotId, tick: number): TObservation;
  /** 构造一份用于沙箱 120 帧试跑校验的真实初始世界（无需 DOM） */
  createDryRunWorld(rules: TRules, seed: number): {
    world: TWorld;
    selfSlotId: PlayerSlotId;
    stepWorld: (intent: BotActionIntent, dtSeconds: number) => void;
  };
}

export interface PlayerConfig {
  slotId: PlayerSlotId;
  displayName: string;
  rawName: string;
  colorHex: string;
  bindings: Record<string, string>; // actionId -> KeyboardEvent.code
  controller?: PlayerControllerKind;
  aiSource?: BotModelSource;
  aiModelId?: string;
  aiModelName?: string;
  /** 仅当 aiSource === 'custom' 时冻结携带脚本源码，避免对局中编辑污染进行中的比赛 */
  customBotCode?: string;
}

export interface ActionDefinition {
  id: string;
  label: string;
  description?: string;
}

export interface ActionInputState {
  held: boolean;
  justPressed: boolean;
  justReleased: boolean;
}

export interface InputFrame {
  getAction(slotId: PlayerSlotId, actionId: string): ActionInputState;
}

export type RuleFieldType = 'number' | 'integer' | 'boolean' | 'select' | 'string';

export interface RuleSelectOption {
  value: string;
  label: string;
}

export interface RuleFieldSchema {
  key: string;
  group: string;
  label: string;
  type: RuleFieldType;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: RuleSelectOption[];
  placeholder?: string;
  helperText?: string;
  /** 可选的条件显隐/禁用判断，例如随机出生模式下隐藏或禁用“固定出生每回合互换” */
  isHidden?: (rules: Record<string, unknown>) => boolean;
  isDisabled?: (rules: Record<string, unknown>) => boolean;
}

export interface RuleGroupSchema {
  id: string;
  title: string;
  description?: string;
  advanced?: boolean;
}

export interface ValidationIssue {
  field: string;
  severity: 'error' | 'warning';
  message: string;
}

export type SessionPhase = 'countdown' | 'playing' | 'round_over' | 'match_over';

export interface HudStatusItem {
  id: string;
  label: string;
  valueText: string;
  remainingSeconds?: number;
  maxSeconds?: number;
  remainingCharges?: number;
  maxCharges?: number;
  iconKey?: string;
  tone?: 'neutral' | 'shield' | 'offense' | 'warning';
}

export interface PlayerHudEntry {
  slotId: PlayerSlotId;
  displayName: string;
  colorHex: string;
  score: number;
  alive: boolean;
  ammo: number;
  maxAmmo: number;
  /** 0..1 当前一发补弹进度，满弹为 0 */
  reloadProgress: number;
  statusItems: HudStatusItem[];
}

export interface RoundBannerInfo {
  roundNumber: number;
  isDraw: boolean;
  winnerSlotId: PlayerSlotId | null;
  winnerName: string | null;
  winnerColor: string | null;
  reason: string;
  nextRoundInSeconds: number;
}

export interface HudState {
  phase: SessionPhase;
  roundNumber: number;
  targetScore: number;
  countdownSeconds: number;
  battleElapsedSeconds: number;
  roundTimeRemainingSeconds: number | null;
  mapCode: string;
  players: PlayerHudEntry[];
  roundBanner: RoundBannerInfo | null;
}

export interface RoundResultEvent {
  roundNumber: number;
  winnerSlotId: PlayerSlotId | null;
  isDraw: boolean;
  reason: string;
  scores: Record<PlayerSlotId, number>;
}

export interface PlayerMatchStats {
  kills: number;
  selfEliminations: number;
  deaths: number;
  shotsFired: number;
  hitsLanded: number;
  itemsPicked: number;
  itemsUsed: number;
  itemUsageByKind: Record<string, number>;
}

export type ReplayEventKind =
  | 'round_start'
  | 'keyframe'
  | 'pickup'
  | 'fire_special'
  | 'shield_break'
  | 'elimination'
  | 'round_end';

export interface ReplayTankSnap {
  slotId: PlayerSlotId;
  displayName: string;
  colorHex: string;
  x: number;
  y: number;
  angle: number;
  alive: boolean;
  hasShield: boolean;
  offenseKind: string | null;
  /** 精细复盘扩展字段（向后兼容旧快照） */
  ammo?: number;
  maxAmmo?: number;
  shieldRatio?: number;
  offenseRatio?: number;
  recoil?: number;
  treadPhase?: number;
}

export interface ReplayProjectileSnap {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  colorHex: string;
  source: string;
}

export interface ReplayDropSnap {
  id: number;
  kind: string;
  x: number;
  y: number;
}

export interface ReplayMineSnap {
  id: number;
  x: number;
  y: number;
  colorHex: string;
  armed: boolean;
}

export interface ReplayLaserSnap {
  points: Array<{ x: number; y: number }>;
  colorHex: string;
  alpha?: number;
}

export interface ReplayExplosionSnap {
  x: number;
  y: number;
  radius: number;
  colorHex: string;
  progress?: number;
}

export interface ReplayCueSnap {
  kind: 'muzzle' | 'bounce' | 'cancel' | 'pickup' | 'shield_break';
  x: number;
  y: number;
  colorHex: string;
  angle?: number;
  progress?: number;
}

export interface ReplaySnapshotEvent {
  index: number;
  roundNumber: number;
  battleTime: number;
  totalTime: number;
  kind: ReplayEventKind;
  headline?: string;
  actorColorHex?: string;
  scores: Record<PlayerSlotId, number>;
  tanks: ReplayTankSnap[];
  projectiles: ReplayProjectileSnap[];
  drops: ReplayDropSnap[];
  mines: ReplayMineSnap[];
  laserBeams: ReplayLaserSnap[];
  explosions: ReplayExplosionSnap[];
  cues?: ReplayCueSnap[];
}

export interface MatchReplayData {
  arenaWidth: number;
  arenaHeight: number;
  gridCols: number;
  gridRows: number;
  walls: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  events: ReplaySnapshotEvent[];
  sampleRateHz?: number;
}

export interface MatchResultEvent {
  gameId: string;
  winnerSlotIds: PlayerSlotId[];
  isTie: boolean;
  scores: Record<PlayerSlotId, number>;
  drawRounds: number;
  totalRounds: number;
  totalBattleSeconds: number;
  mapCode: string;
  players: Array<{
    slotId: PlayerSlotId;
    displayName: string;
    colorHex: string;
    score: number;
    controller?: PlayerControllerKind;
    aiModelName?: string;
    stats?: PlayerMatchStats;
  }>;
  replay?: MatchReplayData;
}

export type SoundEventKind =
  | 'fire_normal'
  | 'fire_shotgun'
  | 'fire_laser'
  | 'fire_homing'
  | 'fire_frag'
  | 'place_mine'
  | 'bounce'
  | 'cancel_bullet'
  | 'pickup'
  | 'shield_break'
  | 'explosion'
  | 'round_win'
  | 'round_draw'
  | 'countdown_tick'
  | 'countdown_go'
  | 'match_win';

export interface SessionStepResult {
  roundResult?: RoundResultEvent;
  matchResult?: MatchResultEvent;
  sounds: SoundEventKind[];
}

export interface MatchLaunchSnapshot<TRules = Record<string, unknown>> {
  gameId: string;
  rulesVersion: number;
  rules: TRules;
  players: PlayerConfig[];
  /** 用于复现整场比赛（同一地图多回合共享） */
  sessionSeed: number;
  gameMode?: GameMode;
  singleMatchup?: SingleMatchup;
}

export interface GameSession<TWorld = unknown> {
  step(dtSeconds: number, input: InputFrame): SessionStepResult;
  getWorldState(): TWorld;
  getHudState(): HudState;
  getMatchResult(): MatchResultEvent | null;
}

export interface GameRenderer<TWorld = unknown> {
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  render(ctx: CanvasRenderingContext2D, world: TWorld, realDtSeconds: number): void;
  /** 可选：由平台在 F3 开发者调试模式切换时开启/关闭战场战术调试叠加层 */
  setDebugMode?(enabled: boolean): void;
}

export interface RulePreset<TRules = Record<string, unknown>> {
  id: string;
  name: string;
  rulesVersion: number;
  rules: TRules;
  updatedAt: number;
}

export interface GameDefinition<TRules = Record<string, unknown>, TWorld = unknown> {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  defaultPlayerCount: number;
  rulesVersion: number;
  actions: ActionDefinition[];
  defaultBindingsBySlot: Record<PlayerSlotId, Record<string, string>>;
  ruleGroups: RuleGroupSchema[];
  ruleFields: RuleFieldSchema[];
  getDefaultRules(): TRules;
  migrateRules(raw: unknown): { rules: TRules; migrated: boolean; recoveredFromError: boolean };
  validateRules(rules: TRules): ValidationIssue[];
  /** 可选：当某个规则字段变化时联动派生字段（例如坦克地图参数变动时更新地图编号） */
  onRuleFieldChange?: (prevRules: TRules, fieldKey: string, nextValue: unknown) => TRules;
  /** 开局前固化规则快照（例如无地图编号时生成新地图编号） */
  finalizeMatchRules?: (rules: TRules, seed: number) => TRules;
  createSession(snapshot: MatchLaunchSnapshot<TRules>): GameSession<TWorld>;
  createRenderer(): GameRenderer<TWorld>;
  /** 可选：该游戏内置的 TypeScript AI 对手脚本模型列表 */
  botModels?: BotModelDefinition<TWorld>[];
  defaultBotModelId?: string;
  /** 可选：跨游戏 AI SDK 适配器（支持 Prompt MD 生成、Worker 观测协议与 120 帧沙箱试跑） */
  aiSdk?: GameAiSdkAdapter<TRules, TWorld, unknown>;
}
