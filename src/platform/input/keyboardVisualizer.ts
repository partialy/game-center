import type {
  ActionDefinition,
  PlayerConfig,
  PlayerProfile,
  PlayerSlotId,
} from '../games/contracts';
import {
  RESERVED_KEY_CODES,
  formatKeyCode,
  validateBindings,
} from './bindings';

export interface VisualKeySpec {
  code: string;
  label: string;
  /** 占 60 等分网格中的列宽（1u = 4 列，确保每行精确相加为 60） */
  span: number;
  /** 占位空白（非真实按键） */
  spacer?: boolean;
}

export const KEYBOARD_GRID_COLS = 60;

/**
 * 紧凑型 5 行 65%+方向键视觉化键盘布局（每行精确 60 列 = 15u）：
 * 完整覆盖 WASD、方向键、空格、Enter、Esc、数字、字母、Shift/Ctrl/Alt 等双人同屏高频键位。
 */
export const VISUAL_KEYBOARD_ROWS: VisualKeySpec[][] = [
  // Row 1: 4 + 40 + 4 + 4 + 8 = 60
  [
    { code: 'Escape', label: 'Esc', span: 4 },
    { code: 'Digit1', label: '1', span: 4 },
    { code: 'Digit2', label: '2', span: 4 },
    { code: 'Digit3', label: '3', span: 4 },
    { code: 'Digit4', label: '4', span: 4 },
    { code: 'Digit5', label: '5', span: 4 },
    { code: 'Digit6', label: '6', span: 4 },
    { code: 'Digit7', label: '7', span: 4 },
    { code: 'Digit8', label: '8', span: 4 },
    { code: 'Digit9', label: '9', span: 4 },
    { code: 'Digit0', label: '0', span: 4 },
    { code: 'Minus', label: '-', span: 4 },
    { code: 'Equal', label: '=', span: 4 },
    { code: 'Backspace', label: '退格', span: 8 },
  ],
  // Row 2: 6 + 40 + 4 + 4 + 6 = 60
  [
    { code: 'Tab', label: 'Tab', span: 6 },
    { code: 'KeyQ', label: 'Q', span: 4 },
    { code: 'KeyW', label: 'W', span: 4 },
    { code: 'KeyE', label: 'E', span: 4 },
    { code: 'KeyR', label: 'R', span: 4 },
    { code: 'KeyT', label: 'T', span: 4 },
    { code: 'KeyY', label: 'Y', span: 4 },
    { code: 'KeyU', label: 'U', span: 4 },
    { code: 'KeyI', label: 'I', span: 4 },
    { code: 'KeyO', label: 'O', span: 4 },
    { code: 'KeyP', label: 'P', span: 4 },
    { code: 'BracketLeft', label: '[', span: 4 },
    { code: 'BracketRight', label: ']', span: 4 },
    { code: 'Backslash', label: '\\', span: 6 },
  ],
  // Row 3: 7 + 36 + 4 + 4 + 9 = 60
  [
    { code: 'CapsLock', label: 'Caps', span: 7 },
    { code: 'KeyA', label: 'A', span: 4 },
    { code: 'KeyS', label: 'S', span: 4 },
    { code: 'KeyD', label: 'D', span: 4 },
    { code: 'KeyF', label: 'F', span: 4 },
    { code: 'KeyG', label: 'G', span: 4 },
    { code: 'KeyH', label: 'H', span: 4 },
    { code: 'KeyJ', label: 'J', span: 4 },
    { code: 'KeyK', label: 'K', span: 4 },
    { code: 'KeyL', label: 'L', span: 4 },
    { code: 'Semicolon', label: ';', span: 4 },
    { code: 'Quote', label: "'", span: 4 },
    { code: 'Enter', label: 'Enter', span: 9 },
  ],
  // Row 4: 8 + 28 + 12 + 4 + 4 + 4 = 60（↑ 位于第 14u，与下方 ↓ 严格垂直对齐）
  [
    { code: 'ShiftLeft', label: 'Shift', span: 8 },
    { code: 'KeyZ', label: 'Z', span: 4 },
    { code: 'KeyX', label: 'X', span: 4 },
    { code: 'KeyC', label: 'C', span: 4 },
    { code: 'KeyV', label: 'V', span: 4 },
    { code: 'KeyB', label: 'B', span: 4 },
    { code: 'KeyN', label: 'N', span: 4 },
    { code: 'KeyM', label: 'M', span: 4 },
    { code: 'Comma', label: ',', span: 4 },
    { code: 'Period', label: '.', span: 4 },
    { code: 'Slash', label: '/', span: 4 },
    { code: 'ShiftRight', label: 'RSh', span: 4 },
    { code: 'ArrowUp', label: '↑', span: 4 },
    { code: '__spacer_r4__', label: '', span: 4, spacer: true },
  ],
  // Row 5: 5 + 5 + 26 + 6 + 6 + 4 + 4 + 4 = 60
  [
    { code: 'ControlLeft', label: 'Ctrl', span: 5 },
    { code: 'AltLeft', label: 'Alt', span: 5 },
    { code: 'Space', label: '空格', span: 26 },
    { code: 'AltRight', label: 'RAlt', span: 6 },
    { code: 'ControlRight', label: 'RCtrl', span: 6 },
    { code: 'ArrowLeft', label: '←', span: 4 },
    { code: 'ArrowDown', label: '↓', span: 4 },
    { code: 'ArrowRight', label: '→', span: 4 },
  ],
];

export type VisualKeyHighlightKind =
  | 'capturing'
  | 'conflict'
  | 'selected-bound'
  | 'other-bound'
  | 'reserved'
  | 'idle';

export interface VisualKeyState {
  kind: VisualKeyHighlightKind;
  ownerSlotId?: PlayerSlotId;
  ownerColorHex?: string;
  actionLabel?: string;
  shortTag?: string;
  isLivePressed: boolean;
}

export interface KeyCaptureTarget {
  slotId: PlayerSlotId;
  actionId: string;
}

export function abbreviateActionLabel(actionId: string, label: string): string {
  if (actionId === 'fire') return '开火';
  if (label === '向上') return '上';
  if (label === '向下') return '下';
  if (label === '向左') return '左';
  if (label === '向右') return '右';
  if (label === '前进') return '进';
  if (label === '倒车') return '退';
  if (label === '左转') return '左';
  if (label === '右转') return '右';
  return label.slice(0, 2);
}

/**
 * 为视觉化键盘上的每个物理键位计算高亮状态：
 * 优先级：正在录制的按键 > 冲突键 > 当前选中玩家已绑定键 > 其他玩家已绑定键 > 系统保留键 Esc > 空闲键
 */
export function buildVisualKeyboardStateMap(params: {
  profiles: PlayerProfile[];
  actions: ActionDefinition[];
  bindingsBySlot: Record<PlayerSlotId, Record<string, string>>;
  selectedSlotId: PlayerSlotId;
  capturingTarget: KeyCaptureTarget | null;
  livePressedCodes?: ReadonlySet<string>;
}): Record<string, VisualKeyState> {
  const {
    profiles,
    actions,
    bindingsBySlot,
    selectedSlotId,
    capturingTarget,
    livePressedCodes,
  } = params;

  const slotIds = profiles.map((p) => p.slotId);
  const colorBySlot = new Map(profiles.map((p) => [p.slotId, p.colorHex]));
  const actionById = new Map(actions.map((a) => [a.id, a]));
  const validation = validateBindings(slotIds, actions, bindingsBySlot);
  const conflictCodes = new Set(validation.conflicts.map((c) => c.keyCode));

  const result: Record<string, VisualKeyState> = {};

  const isPressed = (code: string) => Boolean(livePressedCodes?.has(code));

  // 1. 保留键
  for (const reserved of RESERVED_KEY_CODES) {
    result[reserved] = {
      kind: 'reserved',
      actionLabel: '暂停 / 继续',
      shortTag: '暂停',
      isLivePressed: isPressed(reserved),
    };
  }

  // 2. 先标记其他玩家绑定的键
  for (const profile of profiles) {
    if (profile.slotId === selectedSlotId) continue;
    const map = bindingsBySlot[profile.slotId] ?? {};
    for (const action of actions) {
      const code = map[action.id];
      if (!code || RESERVED_KEY_CODES.has(code)) continue;
      result[code] = {
        kind: conflictCodes.has(code) ? 'conflict' : 'other-bound',
        ownerSlotId: profile.slotId,
        ownerColorHex: profile.colorHex,
        actionLabel: `${profile.slotId.toUpperCase()} ${action.label}`,
        shortTag: profile.slotId.toUpperCase(),
        isLivePressed: isPressed(code),
      };
    }
  }

  // 3. 标记当前选中玩家绑定的键
  const selectedColor = colorBySlot.get(selectedSlotId) ?? '#D9432B';
  const selectedMap = bindingsBySlot[selectedSlotId] ?? {};
  for (const action of actions) {
    const code = selectedMap[action.id];
    if (!code || RESERVED_KEY_CODES.has(code)) continue;
    result[code] = {
      kind: conflictCodes.has(code) ? 'conflict' : 'selected-bound',
      ownerSlotId: selectedSlotId,
      ownerColorHex: selectedColor,
      actionLabel: action.label,
      shortTag: abbreviateActionLabel(action.id, action.label),
      isLivePressed: isPressed(code),
    };
  }

  // 4. 最高优先级：当前正在改键的动作对应键位
  if (capturingTarget) {
    const capCode = bindingsBySlot[capturingTarget.slotId]?.[capturingTarget.actionId];
    const capAction = actionById.get(capturingTarget.actionId);
    if (capCode && !RESERVED_KEY_CODES.has(capCode)) {
      result[capCode] = {
        kind: 'capturing',
        ownerSlotId: capturingTarget.slotId,
        ownerColorHex: colorBySlot.get(capturingTarget.slotId) ?? selectedColor,
        actionLabel: capAction?.label ?? capturingTarget.actionId,
        shortTag: '改键中',
        isLivePressed: isPressed(capCode),
      };
    }
  }

  return result;
}

export interface CompactMatchKeyHint {
  upKey: string;
  downKey: string;
  leftKey: string;
  rightKey: string;
  fireKey: string;
  moveModeLabel: string;
}

/** 将对局快照中的玩家绑定格式化为对局内紧凑键帽提示 */
export function buildCompactMatchKeyHint(
  player: PlayerConfig,
  controlMode?: unknown
): CompactMatchKeyHint {
  const b = player.bindings ?? {};
  return {
    upKey: formatKeyCode(b.forward ?? ''),
    downKey: formatKeyCode(b.backward ?? ''),
    leftKey: formatKeyCode(b.turnLeft ?? ''),
    rightKey: formatKeyCode(b.turnRight ?? ''),
    fireKey: formatKeyCode(b.fire ?? ''),
    moveModeLabel: controlMode === 'classic' ? '进退转向' : '方向移动',
  };
}
