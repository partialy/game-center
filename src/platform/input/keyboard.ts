import type { ActionInputState, InputFrame, PlayerConfig, PlayerSlotId } from '../games/contracts';

const DEFAULT_IDLE: ActionInputState = {
  held: false,
  justPressed: false,
  justReleased: false,
};

const SCROLL_PREVENT_CODES = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
]);

/**
 * 键盘输入采集器：
 * - 采用物理键位 KeyboardEvent.code
 * - 区分持续按住（held）与离散按下/松开边沿（justPressed / justReleased）
 * - 自动忽略系统键盘长按重复（event.repeat），避免普通点按误触发连发
 * - 离散边沿在首个模拟步被消费一次后清空
 */
export class KeyboardInputHub {
  private readonly heldCodes = new Set<string>();
  private readonly pressedEdgeCodes = new Set<string>();
  private readonly releasedEdgeCodes = new Set<string>();
  private readonly mappedCodes = new Set<string>();
  private readonly bindingsBySlot = new Map<PlayerSlotId, Record<string, string>>();
  private active = false;
  private onPauseRequested?: () => void;

  constructor(players: PlayerConfig[], onPauseRequested?: () => void) {
    this.onPauseRequested = onPauseRequested;
    for (const player of players) {
      this.bindingsBySlot.set(player.slotId, { ...player.bindings });
      for (const code of Object.values(player.bindings)) {
        if (code) this.mappedCodes.add(code);
      }
    }
  }

  attach(): void {
    if (this.active) return;
    this.active = true;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);
  }

  detach(): void {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);
    this.clearAll();
  }

  /** 暂停或窗口失焦时清除所有按住状态和未消费边沿，防止恢复时卡键 */
  clearAll(): void {
    this.heldCodes.clear();
    this.pressedEdgeCodes.clear();
    this.releasedEdgeCodes.clear();
  }

  /** 为当前固定模拟步采样输入帧，并在返回前消费本步离散边沿 */
  sampleFrame(): InputFrame {
    const heldSnapshot = new Set(this.heldCodes);
    const pressedSnapshot = new Set(this.pressedEdgeCodes);
    const releasedSnapshot = new Set(this.releasedEdgeCodes);

    this.pressedEdgeCodes.clear();
    this.releasedEdgeCodes.clear();

    const bindingsBySlot = this.bindingsBySlot;

    return {
      getAction(slotId: PlayerSlotId, actionId: string): ActionInputState {
        const slotBindings = bindingsBySlot.get(slotId);
        if (!slotBindings) return DEFAULT_IDLE;
        const code = slotBindings[actionId];
        if (!code) return DEFAULT_IDLE;
        return {
          held: heldSnapshot.has(code),
          justPressed: pressedSnapshot.has(code),
          justReleased: releasedSnapshot.has(code),
        };
      },
    };
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (isEditableTarget(event.target)) return;

    if (event.code === 'Escape') {
      if (!event.repeat) {
        event.preventDefault();
        this.onPauseRequested?.();
      }
      return;
    }

    if (this.mappedCodes.has(event.code) || SCROLL_PREVENT_CODES.has(event.code)) {
      event.preventDefault();
    }

    // 关键边界：忽略操作系统自动重复产生的 keydown，确保普通射击只在真实按下瞬间触发一次
    if (event.repeat) return;

    if (!this.heldCodes.has(event.code)) {
      this.heldCodes.add(event.code);
      this.pressedEdgeCodes.add(event.code);
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (this.heldCodes.has(event.code)) {
      this.heldCodes.delete(event.code);
      this.releasedEdgeCodes.add(event.code);
    }
  };

  private readonly handleWindowBlur = (): void => {
    this.clearAll();
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** 测试或无头模拟用：根据按键集合直接构造静态或边沿 InputFrame */
export function createStaticInputFrame(
  actionsBySlot: Record<PlayerSlotId, Record<string, Partial<ActionInputState>>>
): InputFrame {
  return {
    getAction(slotId: PlayerSlotId, actionId: string): ActionInputState {
      const state = actionsBySlot[slotId]?.[actionId];
      if (!state) return DEFAULT_IDLE;
      return {
        held: Boolean(state.held),
        justPressed: Boolean(state.justPressed),
        justReleased: Boolean(state.justReleased),
      };
    },
  };
}
