import type { InputFrame } from '../../../platform/games/contracts';
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
  const baseTurnSpeedRad = rules.tankTurnSpeedDeg * DEG_TO_RAD;
  const intuitiveTurnSpeedRad = baseTurnSpeedRad * 1.45;

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

    const left = input.getAction(tank.slotId, 'turnLeft').held;
    const right = input.getAction(tank.slotId, 'turnRight').held;
    const forward = input.getAction(tank.slotId, 'forward').held;
    const backward = input.getAction(tank.slotId, 'backward').held;

    if (rules.controlMode === 'classic') {
      tank.moveHoldTime = 0;
      let turnDir = 0;
      if (left) turnDir -= 1;
      if (right) turnDir += 1;
      tank.angle += turnDir * baseTurnSpeedRad * dt;

      let moveSpeed = 0;
      if (forward && !backward) {
        moveSpeed = rules.tankForwardSpeed;
      } else if (backward && !forward) {
        moveSpeed = -rules.tankReverseSpeed;
      }

      if (moveSpeed !== 0) {
        const prevX = tank.x;
        const prevY = tank.y;
        const nextX = tank.x + Math.cos(tank.angle) * moveSpeed * dt;
        const nextY = tank.y + Math.sin(tank.angle) * moveSpeed * dt;
        const resolved = resolveCircleMazeCollision(nextX, nextY, TANK_RADIUS, maze);
        tank.x = resolved.x;
        tank.y = resolved.y;
        const moved = Math.hypot(tank.x - prevX, tank.y - prevY);
        tank.treadDistance += moved * (moveSpeed >= 0 ? 1 : -1);
      }
      continue;
    }

    // ===== 直觉转向模式（屏幕 8 向 + 最短圆弧平滑转向 + 轻点微调） =====
    const inputX = (right ? 1 : 0) - (left ? 1 : 0);
    const inputY = (backward ? 1 : 0) - (forward ? 1 : 0);

    if (inputX === 0 && inputY === 0) {
      tank.moveHoldTime = 0;
      continue;
    }

    tank.moveHoldTime += dt;

    const targetAngle = Math.atan2(inputY, inputX);
    const angleDiff = normalizeAngleDelta(targetAngle - tank.angle);
    const absDiff = Math.abs(angleDiff);
    const maxStep = intuitiveTurnSpeedRad * dt;

    if (absDiff <= maxStep) {
      tank.angle = targetAngle;
    } else {
      tank.angle += Math.sign(angleDiff) * maxStep;
    }

    // 轻点方向键且当前与目标方向有夹角时，优先旋转炮口微调角度（极小位移）；
    // 对齐或持续按住后沿屏幕目标方向顺滑加速前进
    const isMicroTapAiming =
      tank.moveHoldTime < MICRO_TAP_AIM_WINDOW_SECONDS &&
      absDiff > MICRO_TAP_ANGLE_THRESHOLD_RAD;

    const speedFactor = isMicroTapAiming
      ? 0.14
      : Math.max(0.45, Math.cos(absDiff * 0.5));

    const dirLen = Math.hypot(inputX, inputY) || 1;
    const dirX = inputX / dirLen;
    const dirY = inputY / dirLen;
    const stepDist = rules.tankForwardSpeed * speedFactor * dt;

    const prevX = tank.x;
    const prevY = tank.y;
    const nextX = tank.x + dirX * stepDist;
    const nextY = tank.y + dirY * stepDist;
    const resolved = resolveCircleMazeCollision(nextX, nextY, TANK_RADIUS, maze);
    tank.x = resolved.x;
    tank.y = resolved.y;
    const moved = Math.hypot(tank.x - prevX, tank.y - prevY);
    tank.treadDistance += moved;
  }

  resolveTankToTankBlocking(tanks, maze);
}
