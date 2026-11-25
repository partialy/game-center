import type { ActionInputState, AnalogMoveVector } from '../games/contracts';

const HOLD_AUTO_FIRE_DELAY_MS = 220;
const HOLD_AUTO_FIRE_INTERVAL_MS = 90;

/**
 * 移动端触控虚拟输入源（单人主导槽位）：
 * - 维护左摇杆 360° 连续归一化方向向量与幅度
 * - 维护独立发射键的按下边沿（justPressed）、松开边沿（justReleased）及按住连发脉冲
 * - 在固定模拟步被消费后自动清空一次性边沿，不遗漏极短点按
 */
export class VirtualTouchInputSource {
  private moveX = 0;
  private moveY = 0;
  private moveMagnitude = 0;

  private fireHeld = false;
  private pendingJustPressed = false;
  private pendingJustReleased = false;
  private fireDownAtMs = 0;
  private nextHoldPulseAtMs = 0;

  setMoveStick(x: number, y: number, magnitude: number): void {
    const safeMag = Math.max(0, Math.min(1, Number.isFinite(magnitude) ? magnitude : 0));
    if (safeMag <= 0) {
      this.moveX = 0;
      this.moveY = 0;
      this.moveMagnitude = 0;
      return;
    }
    const len = Math.hypot(x, y);
    if (len <= 1e-6) {
      this.moveX = 0;
      this.moveY = 0;
      this.moveMagnitude = 0;
      return;
    }
    this.moveX = x / len;
    this.moveY = y / len;
    this.moveMagnitude = safeMag;
  }

  setFirePressed(pressed: boolean, nowMs = performance.now()): void {
    if (pressed && !this.fireHeld) {
      this.fireHeld = true;
      this.pendingJustPressed = true;
      this.fireDownAtMs = nowMs;
      this.nextHoldPulseAtMs = nowMs + HOLD_AUTO_FIRE_DELAY_MS;
    } else if (!pressed && this.fireHeld) {
      this.fireHeld = false;
      this.pendingJustReleased = true;
      this.fireDownAtMs = 0;
      this.nextHoldPulseAtMs = 0;
    }
  }

  clearAll(): void {
    this.moveX = 0;
    this.moveY = 0;
    this.moveMagnitude = 0;
    this.fireHeld = false;
    this.pendingJustPressed = false;
    this.pendingJustReleased = false;
    this.fireDownAtMs = 0;
    this.nextHoldPulseAtMs = 0;
  }

  hasActiveMoveVector(): boolean {
    return this.moveMagnitude > 0;
  }

  getMoveVector(): AnalogMoveVector | null {
    if (this.moveMagnitude <= 0) {
      return null;
    }
    return {
      x: this.moveX,
      y: this.moveY,
      magnitude: this.moveMagnitude,
    };
  }

  sampleFireAction(nowMs = performance.now()): ActionInputState {
    let justPressed = this.pendingJustPressed;
    const justReleased = this.pendingJustReleased;
    this.pendingJustPressed = false;
    this.pendingJustReleased = false;

    // 手游长按发射键支持持续开火：短点按仅触发 1 次，长按 220ms 后按周期补发脉冲（仍受冷却与弹夹约束）
    if (
      !justPressed &&
      this.fireHeld &&
      this.fireDownAtMs > 0 &&
      nowMs >= this.nextHoldPulseAtMs
    ) {
      justPressed = true;
      this.nextHoldPulseAtMs = nowMs + HOLD_AUTO_FIRE_INTERVAL_MS;
    }

    return {
      held: this.fireHeld,
      justPressed,
      justReleased,
    };
  }
}
