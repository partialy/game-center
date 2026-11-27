import type { ActionInputState, AnalogMoveVector } from '../games/contracts';

const HOLD_AUTO_FIRE_DELAY_MS = 220;
const HOLD_AUTO_FIRE_INTERVAL_MS = 90;

interface VirtualButtonState {
  held: boolean;
  pendingJustPressed: boolean;
  pendingJustReleased: boolean;
  downAtMs: number;
  nextHoldPulseAtMs: number;
  autoRepeat: boolean;
}

/**
 * 触控与虚拟手柄统一输入源（单人主导槽位）：
 * - 维护左摇杆 360° 连续归一化方向向量与幅度
 * - 支持任意具名虚拟动作键（如坦克 fire、火柴人 attack/kick/jump/swap）的精确边沿状态
 * - 对开启 autoRepeat 的发射键支持长按连发脉冲；对跳跃/换武器等单发动作保持精准单次触发
 */
export class VirtualTouchInputSource {
  private moveX = 0;
  private moveY = 0;
  private moveMagnitude = 0;

  private readonly buttons = new Map<string, VirtualButtonState>();

  private getOrCreateButton(actionId: string, autoRepeat: boolean): VirtualButtonState {
    let state = this.buttons.get(actionId);
    if (!state) {
      state = {
        held: false,
        pendingJustPressed: false,
        pendingJustReleased: false,
        downAtMs: 0,
        nextHoldPulseAtMs: 0,
        autoRepeat,
      };
      this.buttons.set(actionId, state);
    } else {
      state.autoRepeat = autoRepeat;
    }
    return state;
  }

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

  setActionPressed(
    actionId: string,
    pressed: boolean,
    autoRepeat = false,
    nowMs = performance.now()
  ): void {
    const btn = this.getOrCreateButton(actionId, autoRepeat);
    if (pressed && !btn.held) {
      btn.held = true;
      btn.pendingJustPressed = true;
      btn.downAtMs = nowMs;
      btn.nextHoldPulseAtMs = autoRepeat ? nowMs + HOLD_AUTO_FIRE_DELAY_MS : 0;
    } else if (!pressed && btn.held) {
      btn.held = false;
      btn.pendingJustReleased = true;
      btn.downAtMs = 0;
      btn.nextHoldPulseAtMs = 0;
    }
  }

  setFirePressed(pressed: boolean, nowMs = performance.now()): void {
    this.setActionPressed('fire', pressed, true, nowMs);
  }

  clearAll(): void {
    this.moveX = 0;
    this.moveY = 0;
    this.moveMagnitude = 0;
    for (const btn of this.buttons.values()) {
      btn.held = false;
      btn.pendingJustPressed = false;
      btn.pendingJustReleased = false;
      btn.downAtMs = 0;
      btn.nextHoldPulseAtMs = 0;
    }
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
    return this.sampleAction('fire', nowMs);
  }

  sampleAction(actionId: string, nowMs = performance.now()): ActionInputState {
    const btn = this.buttons.get(actionId);
    if (!btn) {
      return { held: false, justPressed: false, justReleased: false };
    }
    let justPressed = btn.pendingJustPressed;
    const justReleased = btn.pendingJustReleased;
    btn.pendingJustPressed = false;
    btn.pendingJustReleased = false;

    if (
      btn.autoRepeat &&
      !justPressed &&
      btn.held &&
      btn.downAtMs > 0 &&
      btn.nextHoldPulseAtMs > 0 &&
      nowMs >= btn.nextHoldPulseAtMs
    ) {
      justPressed = true;
      btn.nextHoldPulseAtMs = nowMs + HOLD_AUTO_FIRE_INTERVAL_MS;
    }

    return {
      held: btn.held,
      justPressed,
      justReleased,
    };
  }

  sampleAllActions(nowMs = performance.now()): Record<string, ActionInputState> {
    const out: Record<string, ActionInputState> = {};
    for (const actionId of this.buttons.keys()) {
      const sampled = this.sampleAction(actionId, nowMs);
      if (sampled.held || sampled.justPressed || sampled.justReleased) {
        out[actionId] = sampled;
      }
    }
    return out;
  }
}
