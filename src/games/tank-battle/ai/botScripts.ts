import {
  BOSS_TIER_THEME,
  type BotActionIntent,
  type BotAgentInstance,
  type BotModelDefinition,
  type PlayerSlotId,
} from '../../../platform/games/contracts';
import { DeterministicRng } from '../map/rng';
import type { TankMotionInput } from '../simulation/movement';
import {
  type TankEntity,
  type TankWorldState,
  type Vec2,
} from '../types';
import {
  ManeuverMemory,
  planSafeManeuver,
  type ManeuverPlanConfig,
} from './maneuverPlanner';
import {
  predictSelfStepState,
  SIM_STEP_SECONDS,
  type ShotRejectionReason,
} from './physicsPrediction';
import { planTacticalRoute, type RouteGoalKind } from './routePlanner';
import {
  decideFinalFireAction,
  findBestAimSolution,
  type AimSolution,
  type ShotSearchConfig,
} from './shotPlanner';
import {
  getSharedStepContext,
  OpponentMotionTracker,
} from './threatMap';

/**
 * 集中定义的 Lv.5 Boss「地狱使者」专属 UI 主题（深紫底 + 暗红标识），
 * 不占用 8 色玩家坦克涂装色板。
 */
export const TANK_BOSS_THEME = {
  modelId: 'hellbringer',
  badgeLabel: 'Lv.5 · 地狱使者',
  shortBadge: 'BOSS · Lv.5',
  ...BOSS_TIER_THEME,
} as const;

export interface AiSeatDebugSnapshot {
  slotId: PlayerSlotId;
  modelId: string;
  targetSlotId: PlayerSlotId | null;
  goalKind: RouteGoalKind;
  plannedPathCells: number[];
  fireRejectedReason: ShotRejectionReason;
  firedThisStep: boolean;
  isCancelShot: boolean;
  mostDangerousProjId: number | null;
  mostDangerousPoint: Vec2 | null;
  minThreatTtc: number;
  expectedBounces: number;
  expectedHitTime: number;
  candidateCount: number;
  maxBounceDepth: number;
  decisionMs: number;
}

const worldAiDebugMap = new WeakMap<TankWorldState, Record<PlayerSlotId, AiSeatDebugSnapshot>>();

export function getWorldAiDebugSnapshots(
  world: TankWorldState
): Record<PlayerSlotId, AiSeatDebugSnapshot> | null {
  return worldAiDebugMap.get(world) ?? null;
}

function recordSeatDebugSnapshot(
  world: TankWorldState,
  snap: AiSeatDebugSnapshot
): void {
  let bag = worldAiDebugMap.get(world);
  if (!bag) {
    bag = {};
    worldAiDebugMap.set(world, bag);
  }
  bag[snap.slotId] = snap;
}

interface TankTierProfile {
  modelId: string;
  thinkIntervalSeconds: number;
  hesitationChance: number;
  fireCooldownFloorSeconds: number;
  routeRiskWeight: number;
  itemSearchMaxSteps: number;
  coverReloadEnabled: boolean;
  multiTargetScoring: boolean;
  shot: ShotSearchConfig;
  maneuver: ManeuverPlanConfig;
}

const EMPTY_INTENT: BotActionIntent = {
  forward: false,
  backward: false,
  turnLeft: false,
  turnRight: false,
  fire: false,
};

/**
 * 统一五档坦克内置 AI 决策体：
 * - 完全基于当前公开场态与同源物理预测规划动作
 * - 仅提交标准 5 键按下状态，由物理引擎在同一步结算
 */
class TacticalTankBotAgent implements BotAgentInstance<TankWorldState> {
  private readonly profile: TankTierProfile;
  private readonly rng: DeterministicRng;
  private readonly opponentTracker = new OpponentMotionTracker();
  private readonly maneuverMemory = new ManeuverMemory();

  private lastRound = -1;
  private routeTimer = 0;
  private cachedRoute: ReturnType<typeof planTacticalRoute> | null = null;
  private cachedAim: AimSolution | null = null;
  private cachedMoveInput: TankMotionInput | null = null;
  private cachedManeuverSafety: ReturnType<typeof planSafeManeuver>['safety'] | null = null;
  private cachedAllLethal = false;
  private cachedCandidateCount = 0;
  private prevFireHeld = false;
  private lastFireAt = -10;
  private hesitationCooldown = 0;

  constructor(profile: TankTierProfile, seed: number) {
    this.profile = profile;
    this.rng = new DeterministicRng(seed);
  }

  decide(world: TankWorldState, selfSlotId: PlayerSlotId, dtSeconds: number): BotActionIntent {
    if (world.phase !== 'playing') {
      this.prevFireHeld = false;
      return { ...EMPTY_INTENT };
    }

    const self = world.tanks.find((t) => t.slotId === selfSlotId);
    if (!self || !self.alive) {
      this.prevFireHeld = false;
      return { ...EMPTY_INTENT };
    }

    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();

    if (this.lastRound !== world.roundNumber) {
      this.lastRound = world.roundNumber;
      this.routeTimer = 0;
      this.cachedRoute = null;
      this.cachedAim = null;
      this.cachedMoveInput = null;
      this.cachedManeuverSafety = null;
      this.cachedAllLethal = false;
      this.cachedCandidateCount = 0;
      this.prevFireHeld = false;
      this.lastFireAt = -10;
      this.hesitationCooldown = 0;
      this.opponentTracker.reset();
      this.maneuverMemory.reset();
    }

    const stepDt = dtSeconds > 0 ? dtSeconds : SIM_STEP_SECONDS;
    const shared = getSharedStepContext(world);
    const opponents = this.opponentTracker.update(world);
    const livingEnemies = opponents.filter((o) => o.alive && o.slotId !== selfSlotId);

    if (livingEnemies.length === 0) {
      this.prevFireHeld = false;
      return { ...EMPTY_INTENT };
    }

    // 1. 低阶（Lv.1/Lv.2）保留有限犹豫；Lv.3～5 绝对零犹豫
    if (this.hesitationCooldown > 0) {
      this.hesitationCooldown = Math.max(0, this.hesitationCooldown - stepDt);
      this.prevFireHeld = false;
      return { ...EMPTY_INTENT };
    }
    if (
      this.profile.hesitationChance > 0 &&
      this.routeTimer <= 0 &&
      this.rng.next() < this.profile.hesitationChance
    ) {
      this.hesitationCooldown = 0.14;
      this.routeTimer = this.profile.thinkIntervalSeconds;
      this.prevFireHeld = false;
      return { ...EMPTY_INTENT };
    }

    // 2. 路径、瞄准与反应节奏节拍（Lv.5 thinkIntervalSeconds=0 保持 60Hz 全帧重算；低档按对应反应节奏刷新）
    this.routeTimer -= stepDt;
    const shouldThinkNow = !this.cachedRoute || !this.cachedAim || !this.cachedMoveInput || this.routeTimer <= 0;
    if (shouldThinkNow) {
      this.routeTimer = this.profile.thinkIntervalSeconds;
      this.cachedRoute = planTacticalRoute(world, shared, self, opponents, {
        riskWeight: this.profile.routeRiskWeight,
        maxBounceThreat: this.profile.maneuver.maxBounceThreat,
        itemSearchMaxSteps: this.profile.itemSearchMaxSteps,
        coverReloadEnabled: this.profile.coverReloadEnabled,
        multiTargetScoring: this.profile.multiTargetScoring,
      });
      this.cachedAim = findBestAimSolution(world, shared, self, opponents, this.profile.shot);

      const maneuver = planSafeManeuver(
        world,
        shared,
        self,
        opponents,
        this.cachedRoute,
        this.cachedAim,
        this.maneuverMemory,
        this.profile.maneuver,
        stepDt
      );
      this.cachedMoveInput = maneuver.moveInput;
      this.cachedManeuverSafety = maneuver.safety;
      this.cachedAllLethal = maneuver.allCandidatesLethal;
      this.cachedCandidateCount = maneuver.candidateCount;
    }

    const routePlan = this.cachedRoute!;
    const aimSolution = this.cachedAim!;
    const moveInput: TankMotionInput = this.cachedMoveInput!;
    const maneuverSafety = this.cachedManeuverSafety!;

    // 5. 基于预计本步移动及拾取后的真实状态，执行最终开火安全门控
    const postMoveState = predictSelfStepState(world, self, moveInput, stepDt);
    const floorBlocked =
      this.profile.fireCooldownFloorSeconds > 0 &&
      world.battleTime - this.lastFireAt < this.profile.fireCooldownFloorSeconds;

    let shouldFire = false;
    let rejectionReason: ShotRejectionReason = floorBlocked ? 'cooldown' : 'ok';
    let isCancelShot = false;

    if (!floorBlocked) {
      const fireDecision = decideFinalFireAction(
        world,
        self,
        postMoveState,
        aimSolution,
        opponents,
        this.prevFireHeld,
        this.profile.shot,
        this.cachedAllLethal
      );
      shouldFire = fireDecision.shouldFire;
      rejectionReason = fireDecision.rejectionReason;
      isCancelShot = fireDecision.isCancelShot;
    }

    if (shouldFire) {
      this.lastFireAt = world.battleTime;
    }
    this.prevFireHeld = shouldFire;

    const decisionMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;

    recordSeatDebugSnapshot(world, {
      slotId: selfSlotId,
      modelId: this.profile.modelId,
      targetSlotId: aimSolution.targetSlotId ?? routePlan.targetSlotId,
      goalKind: routePlan.goalKind,
      plannedPathCells: routePlan.cellPath,
      fireRejectedReason: rejectionReason,
      firedThisStep: shouldFire,
      isCancelShot,
      mostDangerousProjId: maneuverSafety.mostDangerousProjId,
      mostDangerousPoint: maneuverSafety.mostDangerousPoint,
      minThreatTtc: maneuverSafety.minTtc,
      expectedBounces: aimSolution.expectedBounces,
      expectedHitTime: aimSolution.expectedHitTime,
      candidateCount: this.cachedCandidateCount,
      maxBounceDepth: this.profile.shot.maxBounceSearch,
      decisionMs,
    });

    return {
      forward: moveInput.forward,
      backward: moveInput.backward,
      turnLeft: moveInput.turnLeft,
      turnRight: moveInput.turnRight,
      fire: shouldFire,
    };
  }
}

/**
 * 五档内置 TypeScript AI 策略模型注册表：
 * Lv.1 新兵巡逻 -> Lv.2 战术游击（默认）-> Lv.3 精英猎手 -> Lv.4 噩梦反弹 -> Lv.5 地狱使者（Boss）
 */
export const TANK_BOT_MODELS: BotModelDefinition<TankWorldState>[] = [
  {
    id: 'rookie',
    name: '新兵巡逻',
    difficultyLevel: 1,
    difficultyLabel: '入门',
    accentColor: '#1F8A5B',
    summary: '节奏平缓的巡逻 AI：直射为主、保留轻微犹豫，具备基础防贴墙自伤、避让己雷与简单撤离能力。',
    traits: {
      navigation: 1,
      dodging: 1,
      aiming: 1,
      items: 1,
    },
    createAgent: (seed) =>
      new TacticalTankBotAgent(
        {
          modelId: 'rookie',
          thinkIntervalSeconds: 0.24,
          hesitationChance: 0.14,
          fireCooldownFloorSeconds: 0.45,
          routeRiskWeight: 0.15,
          itemSearchMaxSteps: 1,
          coverReloadEnabled: false,
          multiTargetScoring: false,
          shot: {
            maxBounceSearch: 0,
            sweepAngles: 0,
            useLeadPrediction: false,
            useMirrorReflections: false,
            useCancelDefense: false,
            aimToleranceRad: 0.24,
            maxShotDist: 520,
            sealExitsEnabled: false,
          },
          maneuver: {
            lookaheadSteps: 10,
            twoStageBranching: false,
            maxBounceThreat: 0,
            includePost5thTail: false,
            checkGunlines: false,
            aimWhileMovingWeight: 0.25,
            enableImmediateHitCapture: false,
          },
        },
        seed
      ),
  },
  {
    id: 'tactical',
    name: '战术游击',
    difficultyLevel: 2,
    difficultyLabel: '进阶',
    accentColor: '#2364C7',
    summary: '均衡型迷宫 AI：风险加权 Dijkstra 寻路、直飞弹幕多方向避让、近点道具争夺与回掩体补弹。',
    traits: {
      navigation: 2,
      dodging: 3,
      aiming: 2,
      items: 2,
    },
    createAgent: (seed) =>
      new TacticalTankBotAgent(
        {
          modelId: 'tactical',
          thinkIntervalSeconds: 0.2,
          hesitationChance: 0.05,
          fireCooldownFloorSeconds: 0.32,
          routeRiskWeight: 0.65,
          itemSearchMaxSteps: 3,
          coverReloadEnabled: true,
          multiTargetScoring: false,
          shot: {
            maxBounceSearch: 0,
            sweepAngles: 0,
            useLeadPrediction: true,
            useMirrorReflections: false,
            useCancelDefense: false,
            aimToleranceRad: 0.17,
            maxShotDist: 620,
            sealExitsEnabled: false,
          },
          maneuver: {
            lookaheadSteps: 12,
            twoStageBranching: false,
            maxBounceThreat: 0,
            includePost5thTail: false,
            checkGunlines: false,
            aimWhileMovingWeight: 0.35,
            enableImmediateHitCapture: false,
          },
        },
        seed
      ),
  },
  {
    id: 'elite',
    name: '精英猎手',
    difficultyLevel: 3,
    difficultyLabel: '高手',
    accentColor: '#D97706',
    summary: '进攻型高手 AI：预判 1 次墙面反弹弹幕、掩体探头反打、1 次反弹狙击并主动执行道具专项走位。',
    traits: {
      navigation: 3,
      dodging: 3,
      aiming: 3,
      items: 4,
    },
    createAgent: (seed) =>
      new TacticalTankBotAgent(
        {
          modelId: 'elite',
          thinkIntervalSeconds: 0.14,
          hesitationChance: 0,
          fireCooldownFloorSeconds: 0.24,
          routeRiskWeight: 0.85,
          itemSearchMaxSteps: 5,
          coverReloadEnabled: true,
          multiTargetScoring: true,
          shot: {
            maxBounceSearch: 1,
            sweepAngles: 24,
            useLeadPrediction: true,
            useMirrorReflections: true,
            useCancelDefense: false,
            aimToleranceRad: 0.15,
            maxShotDist: 620,
            maxNormalHitTimeSeconds: 0.95,
            sealExitsEnabled: false,
          },
          maneuver: {
            lookaheadSteps: 14,
            twoStageBranching: false,
            maxBounceThreat: 1,
            includePost5thTail: false,
            checkGunlines: false,
            aimWhileMovingWeight: 0.4,
            enableImmediateHitCapture: false,
          },
        },
        seed
      ),
  },
  {
    id: 'nightmare',
    name: '噩梦反弹',
    difficultyLevel: 4,
    difficultyLabel: '大师',
    accentColor: '#D9432B',
    summary: '大师级几何 AI：预判 2 次反弹与多目标枪线、直觉过窗抓射、1~2 次墙面反弹狙击与普通弹对消防御。',
    traits: {
      navigation: 4,
      dodging: 4,
      aiming: 4,
      items: 4,
    },
    createAgent: (seed) =>
      new TacticalTankBotAgent(
        {
          modelId: 'nightmare',
          thinkIntervalSeconds: 0.08,
          hesitationChance: 0,
          fireCooldownFloorSeconds: 0.14,
          routeRiskWeight: 0.95,
          itemSearchMaxSteps: 6,
          coverReloadEnabled: true,
          multiTargetScoring: true,
          shot: {
            maxBounceSearch: 2,
            sweepAngles: 40,
            useLeadPrediction: true,
            useMirrorReflections: true,
            useCancelDefense: true,
            aimToleranceRad: 0.13,
            maxShotDist: 720,
            maxNormalHitTimeSeconds: 0.9,
            sealExitsEnabled: false,
          },
          maneuver: {
            lookaheadSteps: 18,
            twoStageBranching: false,
            maxBounceThreat: 2,
            includePost5thTail: false,
            checkGunlines: false,
            aimWhileMovingWeight: 0.55,
            enableImmediateHitCapture: false,
          },
        },
        seed
      ),
  },
  {
    id: 'hellbringer',
    name: '地狱使者',
    difficultyLevel: 5,
    difficultyLabel: '终极 Boss',
    accentColor: TANK_BOSS_THEME.accentHex,
    isBoss: true,
    summary: '绝对终极 Boss：五次弹道攻防与全段激光审查，零犹豫全局多目标预测、封锁退路与完整道具连携。',
    traits: {
      navigation: 5,
      dodging: 5,
      aiming: 5,
      items: 5,
    },
    createAgent: (seed) =>
      new TacticalTankBotAgent(
        {
          modelId: 'hellbringer',
          thinkIntervalSeconds: 0,
          hesitationChance: 0,
          fireCooldownFloorSeconds: 0,
          routeRiskWeight: 1.25,
          itemSearchMaxSteps: 14,
          coverReloadEnabled: true,
          multiTargetScoring: true,
          shot: {
            maxBounceSearch: 5,
            sweepAngles: 72,
            useLeadPrediction: true,
            useMirrorReflections: true,
            useCancelDefense: true,
            aimToleranceRad: 0.08,
            maxShotDist: 1400,
            maxNormalHitTimeSeconds: 0.78,
            sealExitsEnabled: true,
          },
          maneuver: {
            lookaheadSteps: 28,
            twoStageBranching: true,
            maxBounceThreat: 5,
            includePost5thTail: true,
            checkGunlines: true,
            aimWhileMovingWeight: 0.9,
            enableImmediateHitCapture: true,
          },
        },
        seed
      ),
  },
];

export const DEFAULT_TANK_BOT_MODEL_ID = 'tactical';

export function getTankBotModelById(
  modelId: string | undefined
): BotModelDefinition<TankWorldState> {
  return (
    TANK_BOT_MODELS.find((m) => m.id === modelId) ??
    TANK_BOT_MODELS.find((m) => m.id === DEFAULT_TANK_BOT_MODEL_ID) ??
    TANK_BOT_MODELS[0]
  );
}
