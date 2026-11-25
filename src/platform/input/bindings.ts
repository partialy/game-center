import type {
  ActionDefinition,
  PlayerColorOption,
  PlayerProfile,
  PlayerSlotId,
} from '../games/contracts';

/** 战术珐琅色板：高对比度、低浑浊度，便于区分坦克与同色弹道 */
export const PLAYER_COLOR_PALETTE: PlayerColorOption[] = [
  { id: 'vermilion', label: '朱砂红', hex: '#D9432B', darkHex: '#9A2B18', lightHex: '#FBE4DF' },
  { id: 'cobalt', label: '钴海蓝', hex: '#2364C7', darkHex: '#15428A', lightHex: '#DFEBFA' },
  { id: 'emerald', label: '松石绿', hex: '#1F8A5B', darkHex: '#135E3D', lightHex: '#DCF4E9' },
  { id: 'ochre', label: '琥珀金', hex: '#C98316', darkHex: '#8E5A0B', lightHex: '#FAF0D9' },
  { id: 'plum', label: '绛紫', hex: '#7B3FA0', darkHex: '#542670', lightHex: '#EFE2F8' },
  { id: 'teal', label: '青钢蓝', hex: '#157D8C', darkHex: '#0C5560', lightHex: '#DAF0F4' },
  { id: 'coral', label: '赤陶橙', hex: '#CF5C20', darkHex: '#8F3C10', lightHex: '#FAE8DC' },
  { id: 'crimson', label: '绯红', hex: '#B82858', darkHex: '#80173A', lightHex: '#F8DFE8' },
];

export const RESERVED_KEY_CODES = new Set<string>(['Escape']);

export function getDefaultPlayerName(slotId: PlayerSlotId): string {
  return slotId.toUpperCase();
}

export function resolveDisplayName(slotId: PlayerSlotId, rawName: string): string {
  const trimmed = rawName.trim();
  return trimmed.length > 0 ? trimmed : getDefaultPlayerName(slotId);
}

/**
 * 名字规则：允许留空（显示 P1/P2），非空时须为 1~10 个英文字母。
 */
export function validatePlayerName(rawName: string): string | null {
  const trimmed = rawName.trim();
  if (trimmed.length === 0) return null;
  if (!/^[A-Za-z]{1,10}$/.test(trimmed)) {
    return '名字须为 1～10 个英文字母，或留空使用默认代号';
  }
  return null;
}

export function getColorOption(hex: string): PlayerColorOption {
  return (
    PLAYER_COLOR_PALETTE.find((c) => c.hex.toLowerCase() === hex.toLowerCase()) ??
    PLAYER_COLOR_PALETTE[0]
  );
}

export function validatePlayerColors(profiles: PlayerProfile[]): Record<PlayerSlotId, string> {
  const errors: Record<PlayerSlotId, string> = {};
  const byHex = new Map<string, PlayerSlotId[]>();
  for (const p of profiles) {
    const key = p.colorHex.toLowerCase();
    const list = byHex.get(key) ?? [];
    list.push(p.slotId);
    byHex.set(key, list);
  }
  for (const [, slots] of byHex) {
    if (slots.length > 1) {
      for (const slotId of slots) {
        errors[slotId] = '玩家颜色不能重复，请选择其他涂装';
      }
    }
  }
  return errors;
}

/** 将 KeyboardEvent.code 映射为清晰易读的中文/符号键名 */
export function formatKeyCode(code: string): string {
  if (!code) return '未绑定';
  if (code.startsWith('Key') && code.length === 4) {
    return code.slice(3);
  }
  if (code.startsWith('Digit') && code.length === 6) {
    return code.slice(5);
  }
  if (code.startsWith('Numpad')) {
    return '小键盘 ' + code.slice(6);
  }
  const map: Record<string, string> = {
    Space: '空格',
    Enter: 'Enter',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Escape: 'Esc',
    ShiftLeft: '左 Shift',
    ShiftRight: '右 Shift',
    ControlLeft: '左 Ctrl',
    ControlRight: '右 Ctrl',
    AltLeft: '左 Alt',
    AltRight: '右 Alt',
    Tab: 'Tab',
    Backspace: '退格',
    BracketLeft: '[',
    BracketRight: ']',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
  };
  return map[code] ?? code;
}

export interface BindingConflict {
  keyCode: string;
  entries: Array<{
    slotId: PlayerSlotId;
    actionId: string;
    actionLabel: string;
  }>;
  reason: 'duplicate' | 'reserved';
}

export interface BindingValidationResult {
  valid: boolean;
  conflicts: BindingConflict[];
  /** key: `${slotId}:${actionId}` -> 冲突描述 */
  fieldErrors: Record<string, string>;
}

/**
 * 校验同一玩家内部及跨玩家之间的物理键位冲突，同时阻止绑定保留键 Esc。
 */
export function validateBindings(
  slotIds: PlayerSlotId[],
  actions: ActionDefinition[],
  bindingsBySlot: Record<PlayerSlotId, Record<string, string>>
): BindingValidationResult {
  const actionLabels = new Map(actions.map((a) => [a.id, a.label]));
  const usages = new Map<
    string,
    Array<{ slotId: PlayerSlotId; actionId: string; actionLabel: string }>
  >();
  const conflicts: BindingConflict[] = [];
  const fieldErrors: Record<string, string> = {};

  for (const slotId of slotIds) {
    const map = bindingsBySlot[slotId] ?? {};
    for (const action of actions) {
      const code = map[action.id] ?? '';
      if (!code) {
        fieldErrors[`${slotId}:${action.id}`] = '尚未设置按键';
        continue;
      }
      if (RESERVED_KEY_CODES.has(code)) {
        conflicts.push({
          keyCode: code,
          reason: 'reserved',
          entries: [{ slotId, actionId: action.id, actionLabel: action.label }],
        });
        fieldErrors[`${slotId}:${action.id}`] = `${formatKeyCode(code)} 为系统暂停保留键`;
        continue;
      }
      const list = usages.get(code) ?? [];
      list.push({
        slotId,
        actionId: action.id,
        actionLabel: actionLabels.get(action.id) ?? action.id,
      });
      usages.set(code, list);
    }
  }

  for (const [keyCode, entries] of usages) {
    if (entries.length > 1) {
      conflicts.push({ keyCode, reason: 'duplicate', entries });
      for (const entry of entries) {
        const others = entries
          .filter((o) => !(o.slotId === entry.slotId && o.actionId === entry.actionId))
          .map((o) => `${o.slotId.toUpperCase()} ${o.actionLabel}`)
          .join('、');
        fieldErrors[`${entry.slotId}:${entry.actionId}`] = `与 ${others} 冲突（${formatKeyCode(keyCode)}）`;
      }
    }
  }

  return {
    valid: conflicts.length === 0 && Object.keys(fieldErrors).length === 0,
    conflicts,
    fieldErrors,
  };
}
