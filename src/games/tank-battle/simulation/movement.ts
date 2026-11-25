import type { AnalogMoveVector, InputFrame } from '../../../platform/games/contracts';
import {
  type MazeData,
  type TankBattleRules,
  TANK_RADIUS,
  type TankEntity,
} from '../types';
import { resolveCircleMazeCollision, resolveTankToTankBlocking } from './collision';

const DEG_TO_RAD = Math.PI / 180;
/** 直觉模式下轻点方向键的微调窗口（秒）：窗口内大角度转向时优先旋转炮口、极少位移 */
const MICRO_TAP_AIM_WINDOW_SECONDS = 0.09;
const MICRO_TAP_ANGLE_THRESHOLD_RAD = 0.08; // ~4.5°

function normalizeAngleDelta(delta: number): number {
  let d = delta;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export interface TankMotionInput {
  forward: boolean;
  backward: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  /** 可选：360° 连续摇杆向量（优先于离散按键，提供指哪打哪手感） */
  analogMove?: AnalogMoveVector | null;
}

export interface TankMotionPose {
  x: number;
  y: number;
  angle: number;
  moveHoldTime: number;
  treadDistance: number;
}

/**
 * 纯几何单车运动步进：给定当前姿态、4 向动作与步长 dt，计算撞墙解算后的下一姿态。
 * 同时供真实模拟循环与 AI 物理预测复用，确保速度、转向限速与轻点窗口完全一致。
 */
export function stepTankMotion(
  pose: TankMotionPose,
  maze: MazeData,
  rules: TankBattleRules,
  actions: TankMotionInput,
  dt: number
): TankMotionPose {
  const baseTurnSpeedRad = rules.tankTurnSpeedDeg * DEG_TO_RAD;
  const intuitiveTurnSpeedRad = baseTurnSpeedRad * 1.45;
  const analogTurnSpeedRad = baseTurnSpeedRad * 2.15;
  const { forward, backward, turnLeft: left, turnRight: right, analogMove } = actions;

  // ===== 移动端 360° 连续摇杆模式：指哪转向、轻推微调瞄准、大推全速前进 =====
  if (analogMove && analogMove.magnitude > 0) {
    const mag = Math.min(1, Math.max(0, analogMove.magnitude));
    const nextHoldTime = pose.moveHoldTime + dt;
    const targetAngle = Math.atan2(analogMove.y, analogMove.x);
    const angleDiff = normalizeAngleDelta(targetAngle - pose.angle);
    const absDiff = Math.abs(angleDiff);
    const maxStep = analogTurnSpeedRad * dt;

    const nextAngle =
      absDiff <= maxStep ? targetAngle : pose.angle + Math.sign(angleDiff) * maxStep;

    // 轻推摇杆时压低位移以便精准微调炮口；推过 30% 后平滑加速并在 >72% 进入满速
    let throttle = 0;
    if (mag < 0.28) {
      throttle = absDiff > MICRO_TAP_ANGLE_THRESHOLD_RAD ? 0.08 : 0.18 + (mag / 0.28) * 0.18;
    } else if (nextHoldTime < 0.075 && absDiff > 0.14) {
      throttle = 0.12;
    } else {
      const ramp = Math.min(1, (mag - 0.28) / 0.44);
      const easeThrottle = 0.36 + 0.64 * (ramp * (2 - ramp));
      const turnMod = Math.max(0.45, Math.cos(absDiff * 0.45));
      throttle = easeThrottle * turnMod;
    }

    const dirLen = Math.hypot(analogMove.x, analogMove.y) || 1;
    const dirX = analogMove.x / dirLen;
    const dirY = analogMove.y / dirLen;
    const stepDist = rules.tankForwardSpeed * throttle * dt;

    const nextX = pose.x + dirX * stepDist;
    const nextY = pose.y + dirY * stepDist;
    const resolved = resolveCircleMazeCollision(nextX, nextY, TANK_RADIUS, maze);
    const moved = Math.hypot(resolved.x - pose.x, resolved.y - pose.y);

    return {
      x: resolved.x,
      y: resolved.y,
      angle: nextAngle,
      moveHoldTime: nextHoldTime,
      treadDistance: pose.treadDistance + moved,
    };
  }

  if (rules.controlMode === 'classic') {
    let turnDir = 0;
    if (left) turnDir -= 1;
    if (right) turnDir += 1;
    const nextAngle = pose.angle + turnDir * baseTurnSpeedRad * dt;

    let moveSpeed = 0;
    if (forward && !backward) {
      moveSpeed = rules.tankForwardSpeed;
    } else if (backward && !forward) {
      moveSpeed = -rules.tankReverseSpeed;
    }

    if (moveSpeed !== 0) {
      const nextX = pose.x + Math.cos(nextAngle) * moveSpeed * dt;
      const nextY = pose.y + Math.sin(nextAngle) * moveSpeed * dt;
      const resolved = resolveCircleMazeCollision(nextX, nextY, TANK_RADIUS, maze);
      const moved = Math.hypot(resolved.x - pose.x, resolved.y - pose.y);
      return {
        x: resolved.x,
        y: resolved.y,
        angle: nextAngle,
        moveHoldTime: 0,
        treadDistance: pose.treadDistance + moved * (moveSpeed >= 0 ? 1 : -1),
      };
    }

    return {
      x: pose.x,
      y: pose.y,
      angle: nextAngle,
      moveHoldTime: 0,
      treadDistance: pose.treadDistance,
    };
  }

  // ===== 直觉转向模式（屏幕 8 向 + 最短圆弧平滑转向 + 轻点微调） =====
  const inputX = (right ? 1 : 0) - (left ? 1 : 0);
  const inputY = (backward ? 1 : 0) - (forward ? 1 : 0);

  if (inputX === 0 && inputY === 0) {
    return {
      x: pose.x,
      y: pose.y,
      angle: pose.angle,
      moveHoldTime: 0,
      treadDistance: pose.treadDistance,
    };
  }

  const nextHoldTime = pose.moveHoldTime + dt;
  const targetAngle = Math.atan2(inputY, inputX);
  const angleDiff = normalizeAngleDelta(targetAngle - pose.angle);
  const absDiff = Math.abs(angleDiff);
  const maxStep = intuitiveTurnSpeedRad * dt;

  const nextAngle =
    absDiff <= maxStep ? targetAngle : pose.angle + Math.sign(angleDiff) * maxStep;

  const isMicroTapAiming =
    nextHoldTime < MICRO_TAP_AIM_WINDOW_SECONDS &&
    absDiff > MICRO_TAP_ANGLE_THRESHOLD_RAD;

  const speedFactor = isMicroTapAiming
    ? 0.14
    : Math.max(0.45, Math.cos(absDiff * 0.5));

  const dirLen = Math.hypot(inputX, inputY) || 1;
  const dirX = inputX / dirLen;
  const dirY = inputY / dirLen;
  const stepDist = rules.tankForwardSpeed * speedFactor * dt;

  const nextX = pose.x + dirX * stepDist;
  const nextY = pose.y + dirY * stepDist;
  const resolved = resolveCircleMazeCollision(nextX, nextY, TANK_RADIUS, maze);
  const moved = Math.hypot(resolved.x - pose.x, resolved.y - pose.y);

  return {
    x: resolved.x,
    y: resolved.y,
    angle: nextAngle,
    moveHoldTime: nextHoldTime,
    treadDistance: pose.treadDistance + moved,
  };
}

/**
 * 更新所有存活坦克的转向与位移，并解决墙体与坦克间阻挡。
 * 支持两种可切换操控模式：
 * 1. intuitive（直觉转向）：按键对应屏幕上下左右及 45° 斜向；车头/炮口沿最短圆弧平滑转过去，
 *    轻点方向键可原地微调炮口角度，转向过渡中任意瞬间开火均可打出 360° 连续角度弹道。
 * 2. classic（经典坦克）：W/S 沿车头前进/倒车，A/D 原地或行进间左/右转。
 */
export function updateTankMovement(
  tanks: TankEntity[],
  maze: MazeData,
  rules: TankBattleRules,
  input: InputFrame,
  dt: number
): void {
  for (let i = 0; i < tanks.length; i += 1) {
    const tank = tanks[i];
    if (!tank.alive) continue;

    // 衰减视觉后坐力与受击闪白
    if (tank.recoilOffset > 0) {
      tank.recoilOffset = Math.max(0, tank.recoilOffset - dt * 28);
    }
    if (tank.hitFlashTimer > 0) {
      tank.hitFlashTimer = Math.max(0, tank.hitFlashTimer - dt);
    }

    const nextPose = stepTankMotion(
      tank,
      maze,
      rules,
      {
        turnLeft: input.getAction(tank.slotId, 'turnLeft').held,
        turnRight: input.getAction(tank.slotId, 'turnRight').held,
        forward: input.getAction(tank.slotId, 'forward').held,
        backward: input.getAction(tank.slotId, 'backward').held,
        analogMove: input.getMoveVector?.(tank.slotId) ?? null,
      },
      dt
    );

    tank.x = nextPose.x;
    tank.y = nextPose.y;
    tank.angle = nextPose.angle;
    tank.moveHoldTime = nextPose.moveHoldTime;
    tank.treadDistance = nextPose.treadDistance;
  }

  resolveTankToTankBlocking(tanks, maze);
}
