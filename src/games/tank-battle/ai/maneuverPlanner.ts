import { worldToCellIndex } from '../map/generateMaze';
import {
  stepTankMotion,
  type TankMotionInput,
  type TankMotionPose,
} from '../simulation/movement';
import {
  CELL_SIZE,
  TANK_RADIUS,
  type ControlMode,
  type TankEntity,
  type TankWorldState,
} from '../types';
import {
  evaluateWeaponShot,
  SIM_STEP_SECONDS,
} from './physicsPrediction';
import type { RoutePlanResult } from './routePlanner';
import { normalizeAngle, type AimSolution } from './shotPlanner';
import {
  evaluatePoseSequenceSafety,
  type OpponentEstimate,
  type PathSafetyReport,
  type PoseSample,
  type SharedStepContext,
} from './threatMap';

export interface ManeuverPlanConfig {
  lookaheadSteps: number;
  twoStageBranching: boolean;
  maxBounceThreat: number;
  includePost5thTail: boolean;
  checkGunlines: boolean;
  aimWhileMovingWeight: number;
  /** Lv.5 零停顿、多候选精确搜索；低阶可略简化分支 */
  enableImmediateHitCapture: boolean;
}

export interface ManeuverDecision {
  moveInput: TankMotionInput;
  safety: PathSafetyReport;
  allCandidatesLethal: boolean;
  candidateCount: number;
  stuckActive: boolean;
}

const INTUITIVE_INPUTS: ReadonlyArray<TankMotionInput> = [
  { forward: false, backward: false, turnLeft: false, turnRight: false }, // idle
  { forward: true, backward: false, turnLeft: false, turnRight: false }, // N
  { forward: true, backward: false, turnLeft: false, turnRight: true }, // NE
  { forward: false, backward: false, turnLeft: false, turnRight: true }, // E
  { forward: false, backward: true, turnLeft: false, turnRight: true }, // SE
  { forward: false, backward: true, turnLeft: false, turnRight: false }, // S
  { forward: false, backward: true, turnLeft: true, turnRight: false }, // SW
  { forward: false, backward: false, turnLeft: true, turnRight: false }, // W
  { forward: true, backward: false, turnLeft: true, turnRight: false }, // NW
];

const CLASSIC_INPUTS: ReadonlyArray<TankMotionInput> = [
  { forward: false, backward: false, turnLeft: false, turnRight: false },
  { forward: true, backward: false, turnLeft: false, turnRight: false },
  { forward: true, backward: false, turnLeft: true, turnRight: false },
  { forward: true, backward: false, turnLeft: false, turnRight: true },
  { forward: false, backward: true, turnLeft: false, turnRight: false },
  { forward: false, backward: true, turnLeft: true, turnRight: false },
  { forward: false, backward: true, turnLeft: false, turnRight: true },
  { forward: false, backward: false, turnLeft: true, turnRight: false },
  { forward: false, backward: false, turnLeft: false, turnRight: true },
];

function sameMotionInput(a: TankMotionInput | null, b: TankMotionInput): boolean {
  if (!a) return false;
  return (
    a.forward === b.forward &&
    a.backward === b.backward &&
    a.turnLeft === b.turnLeft &&
    a.turnRight === b.turnRight
  );
}

/**
 * 在当前世界下维持每席位的反卡墙与防抖动记忆（仅限公开位置变化，每回合重置）。
 */
export class ManeuverMemory {
  private lastRound = -1;
  private lastX = 0;
  private lastY = 0;
  private stuckTimer = 0;
  private recoverTimer = 0;
  private stalledCell = -1;
  prevInput: TankMotionInput | null = null;

  update(world: TankWorldState, self: TankEntity, dt: number): boolean {
    if (this.lastRound !== world.roundNumber) {
      this.lastRound = world.roundNumber;
      this.lastX = self.x;
      this.lastY = self.y;
      this.stuckTimer = 0;
      this.recoverTimer = 0;
      this.stalledCell = -1;
      this.prevInput = null;
      return false;
    }

    const moved = Math.hypot(self.x - this.lastX, self.y - this.lastY);
    this.lastX = self.x;
    this.lastY = self.y;

    const tryingToMove =
      this.prevInput !== null &&
      (this.prevInput.forward ||
        this.prevInput.backward ||
        this.prevInput.turnLeft ||
        this.prevInput.turnRight);

    if (tryingToMove && moved < 14 * dt) {
      this.stuckTimer += dt;
    } else {
      this.stuckTimer = Math.max(0, this.stuckTimer - dt * 2.5);
    }

    if (this.recoverTimer > 0) {
      this.recoverTimer = Math.max(0, this.recoverTimer - dt);
    } else if (this.stuckTimer > 0.36) {
      this.stuckTimer = 0;
      this.recoverTimer = 0.45;
      this.stalledCell = worldToCellIndex(world.maze, self.x, self.y);
    }

    return this.recoverTimer > 0;
  }

  getStalledCell(): number {
    return this.stalledCell;
  }

  reset(): void {
    this.lastRound = -1;
    this.stuckTimer = 0;
    this.recoverTimer = 0;
    this.stalledCell = -1;
    this.prevInput = null;
  }
}

interface CandidateEval {
  firstInput: TankMotionInput;
  poses: PoseSample[];
  endPose: TankMotionPose;
  firstPose: TankMotionPose;
  safety: PathSafetyReport;
  goalProgress: number;
  wallClearanceScore: number;
  exitFreedom: number;
  aimBonus: number;
  hysteresisBonus: number;
  displacement: number;
}

function buildRollout(
  world: TankWorldState,
  startPose: TankMotionPose,
  firstInput: TankMotionInput,
  secondInput: TankMotionInput | null,
  switchTick: number,
  totalTicks: number
): { poses: PoseSample[]; firstPose: TankMotionPose; endPose: TankMotionPose } {
  const poses: PoseSample[] = [{ x: startPose.x, y: startPose.y, t: world.battleTime }];
  let cur = startPose;
  let firstPose = startPose;

  // 前 12 步逐 1/60s 精确步进，后续远场前瞻采用 2/60s 积分以降低推演开销
  let tick = 1;
  while (tick <= totalTicks) {
    const stepTicks = tick <= 12 || tick + 1 > totalTicks ? 1 : 2;
    const inp = secondInput && tick > switchTick ? secondInput : firstInput;
    cur = stepTankMotion(cur, world.maze, world.rules, inp, SIM_STEP_SECONDS * stepTicks);
    if (tick === 1) {
      firstPose = cur;
    }
    poses.push({ x: cur.x, y: cur.y, t: world.battleTime + (tick + stepTicks - 1) * SIM_STEP_SECONDS });
    tick += stepTicks;
  }

  return { poses, firstPose, endPose: cur };
}

function estimateCornerClearance(world: TankWorldState, x: number, y: number): number {
  const maze = world.maze;
  const minWallEdge = TANK_RADIUS + 8;
  const nearBorder = Math.min(
    x - minWallEdge,
    maze.width - minWallEdge - x,
    y - minWallEdge,
    maze.height - minWallEdge - y
  );
  const cell = worldToCellIndex(maze, x, y);
  const deg = maze.cells[cell]?.neighbors.length ?? 1;
  return Math.max(-20, Math.min(20, nearBorder * 0.4)) + deg * 10;
}

/**
 * 合法动作前瞻搜索与分层抉择：
 * 1. 先剔除预测致死候选（仅当存在至少一条安全出路时）
 * 2. 比较最小会遇时间、护盾留存、出口自由度、贴墙角风险与枪线暴露
 * 3. 再比较路线推进、炮口过窗抓射与动作保持迟滞
 */
export function planSafeManeuver(
  world: TankWorldState,
  shared: SharedStepContext,
  self: TankEntity,
  opponents: ReadonlyArray<OpponentEstimate>,
  routePlan: RoutePlanResult,
  aimSolution: AimSolution,
  memory: ManeuverMemory,
  config: ManeuverPlanConfig,
  dt: number
): ManeuverDecision {
  const controlMode: ControlMode = world.rules.controlMode;
  const baseInputs = controlMode === 'classic' ? CLASSIC_INPUTS : INTUITIVE_INPUTS;
  const stuckActive = memory.update(world, self, dt);

  const startPose: TankMotionPose = {
    x: self.x,
    y: self.y,
    angle: self.angle,
    moveHoldTime: self.moveHoldTime,
    treadDistance: self.treadDistance,
  };

  const startDistToGoal = Math.hypot(
    routePlan.waypoint.x - self.x,
    routePlan.waypoint.y - self.y
  );

  // 生成候选序列：所有基础单段动作 + 高阶两段转出/停驻分支
  const rollouts: Array<{
    firstInput: TankMotionInput;
    poses: PoseSample[];
    firstPose: TankMotionPose;
    endPose: TankMotionPose;
  }> = [];

  for (let i = 0; i < baseInputs.length; i += 1) {
    const inp = baseInputs[i];
    const r = buildRollout(world, startPose, inp, null, 0, config.lookaheadSteps);
    rollouts.push({ firstInput: inp, ...r });
  }

  // 两段前瞻（例如：先向某方向急避 8 步，随后松开停驻或折回通路出口）
  if (config.twoStageBranching && config.lookaheadSteps >= 20) {
    const switchTick = Math.floor(config.lookaheadSteps * 0.35);
    const idleInput = baseInputs[0];
    // 选出朝向通路/航点与垂直侧移的 4 个方向做二段停驻/变向分支
    const branchIndices = controlMode === 'classic' ? [1, 4, 7, 8] : [1, 3, 5, 7];
    for (let bi = 0; bi < branchIndices.length; bi += 1) {
      const firstInp = baseInputs[branchIndices[bi]];
      const rIdle = buildRollout(world, startPose, firstInp, idleInput, switchTick, config.lookaheadSteps);
      rollouts.push({ firstInput: firstInp, ...rIdle });

      // 对角/转向折出分支，覆盖绕过弹道后立刻进掩体或进路口
      const oppIdx = ((branchIndices[bi] + 1) % (baseInputs.length - 1)) + 1;
      const rTurn = buildRollout(
        world,
        startPose,
        firstInp,
        baseInputs[oppIdx],
        switchTick,
        config.lookaheadSteps
      );
      rollouts.push({ firstInput: firstInp, ...rTurn });
    }
  }

  const evals: CandidateEval[] = [];
  let hasSafeOption = false;
  const enemies = opponents.filter((o) => o.alive && o.slotId !== self.slotId);
  const enemyTargets = enemies.map((e) => ({
    slotId: e.slotId,
    x: e.x,
    y: e.y,
    alive: true,
    vx: e.vx * 0.5,
    vy: e.vy * 0.5,
  }));

  for (let i = 0; i < rollouts.length; i += 1) {
    const r = rollouts[i];
    const safety = evaluatePoseSequenceSafety(
      world,
      shared,
      self,
      r.poses,
      config.maxBounceThreat,
      config.includePost5thTail,
      opponents,
      config.checkGunlines
    );

    if (!safety.lethal) {
      hasSafeOption = true;
    }

    const endDistToGoal = Math.hypot(
      routePlan.waypoint.x - r.endPose.x,
      routePlan.waypoint.y - r.endPose.y
    );
    const goalProgress = startDistToGoal - endDistToGoal;
    const displacement = Math.hypot(r.endPose.x - self.x, r.endPose.y - self.y);
    const endCell = worldToCellIndex(world.maze, r.endPose.x, r.endPose.y);
    const exitFreedom = shared.mazeCache.cellDegrees[endCell] ?? 1;
    const wallClearanceScore = estimateCornerClearance(world, r.endPose.x, r.endPose.y);

    // 瞄准抓窗加分：仅在枪口即将就绪（<= 0.14s）时参与转向抓窗，冷却期间专心走位躲避不原地抖动
    let aimBonus = 0;
    const gunSoonReady = world.battleTime + 0.14 >= self.fireReadyAt;
    if (aimSolution.desiredAimAngle !== null && config.aimWhileMovingWeight > 0 && gunSoonReady) {
      const errBefore = Math.abs(normalizeAngle(aimSolution.desiredAimAngle - self.angle));
      const errAfter = Math.abs(normalizeAngle(aimSolution.desiredAimAngle - r.firstPose.angle));
      aimBonus += (errBefore - errAfter) * 140 * config.aimWhileMovingWeight;
      if (errAfter <= 0.08) {
        aimBonus += 24 * config.aimWhileMovingWeight;
      }

      // 高阶在安全前提下，仅当炮口正向转入理想开火窗口附近时校验是否即刻命中
      if (
        config.enableImmediateHitCapture &&
        !safety.lethal &&
        errAfter <= 0.16 &&
        world.battleTime + SIM_STEP_SECONDS >= self.fireReadyAt - 1e-9
      ) {
        const quickShot = evaluateWeaponShot(
          world,
          self.slotId,
          r.firstPose,
          world.battleTime + SIM_STEP_SECONDS,
          self.ammo,
          self.fireReadyAt,
          self.shield,
          self.shieldGraceUntil,
          self.offense,
          false,
          Math.min(2, config.maxBounceThreat),
          enemyTargets
        );
        if (quickShot.safe && quickShot.hitsEnemy) {
          aimBonus += 68 * config.aimWhileMovingWeight;
        }
      }
    }

    // 危险低时保留适度动作连续性，防止在 0.09s 轻点窗口反复切换方向造成减速抖动
    const lowDanger = !safety.lethal && safety.minTtc > 0.65 && safety.dangerScore < 28;
    const hysteresisBonus =
      lowDanger && sameMotionInput(memory.prevInput, r.firstInput) ? 24 : 0;

    evals.push({
      firstInput: r.firstInput,
      poses: r.poses,
      endPose: r.endPose,
      firstPose: r.firstPose,
      safety,
      goalProgress,
      wallClearanceScore,
      exitFreedom,
      aimBonus,
      hysteresisBonus,
      displacement,
    });
  }

  // 分层比较挑选最优动作
  let best = evals[0];
  let bestScore = -Infinity;

  for (let i = 0; i < evals.length; i += 1) {
    const c = evals[i];
    if (hasSafeOption && c.safety.lethal) {
      continue; // 只要存在生路，绝对剔除预测致死动作
    }

    let score = 0;

    if (!hasSafeOption) {
      // 全军覆没局面：优先最晚受击、尽量保盾、增加自由度
      score += Math.min(3.0, c.safety.minTtc) * 500;
      if (!c.safety.shieldBroken) score += 120;
      score += c.safety.minClearance * 4;
      score += c.exitFreedom * 15;
    } else {
      // 第一层：护盾与险境避让
      if (c.safety.shieldBroken) score -= 240;
      score -= c.safety.dangerScore * 2.2;
      score -= c.safety.mineHazard * 1.8;
      score += Math.min(35, Math.max(-10, c.safety.minClearance)) * 1.6;
      score += c.exitFreedom * 14 + c.wallClearanceScore * 0.7;

      // 第二层：战略目标与走位
      if (stuckActive) {
        // 卡墙脱困：优先能产生最大有效位移、并逃离卡死格的路线，禁止盲目撞墙
        score += c.displacement * 2.6;
        const endCell = worldToCellIndex(world.maze, c.endPose.x, c.endPose.y);
        if (endCell !== memory.getStalledCell()) score += 45;
        score += c.goalProgress * 0.55;
      } else {
        score += c.goalProgress * 1.45;
      }

      // 第三层：开火过窗抓射与稳态防抖
      score += c.aimBonus + c.hysteresisBonus;
    }

    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  memory.prevInput = best.firstInput;

  return {
    moveInput: best.firstInput,
    safety: best.safety,
    allCandidatesLethal: !hasSafeOption,
    candidateCount: evals.length,
    stuckActive,
  };
}
