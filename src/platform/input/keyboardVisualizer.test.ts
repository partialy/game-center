import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KEYBOARD_GRID_COLS,
  VISUAL_KEYBOARD_ROWS,
  buildCompactMatchKeyHint,
  buildVisualKeyboardStateMap,
} from './keyboardVisualizer';
import { tankBattleGame } from '../../games/tank-battle';
import { getDefaultProfiles } from '../settings/preferencesStore';

test('1. 视觉化键盘每行总列宽严格等于 60（15u 对齐，方向键上下居中）', () => {
  assert.equal(VISUAL_KEYBOARD_ROWS.length, 5);
  for (let i = 0; i < VISUAL_KEYBOARD_ROWS.length; i += 1) {
    const sum = VISUAL_KEYBOARD_ROWS[i].reduce((acc, k) => acc + k.span, 0);
    assert.equal(sum, KEYBOARD_GRID_COLS, `第 ${i + 1} 行总列宽应为 ${KEYBOARD_GRID_COLS}`);
  }

  // 验证 ArrowUp 与 ArrowDown 的起始列完全一致
  const findStart = (rowIdx: number, code: string) => {
    let col = 0;
    for (const k of VISUAL_KEYBOARD_ROWS[rowIdx]) {
      if (k.code === code) return col;
      col += k.span;
    }
    return -1;
  };
  assert.equal(findStart(3, 'ArrowUp'), findStart(4, 'ArrowDown'));
});

test('2. buildVisualKeyboardStateMap 正确区分正在配置键、选中玩家键、对手键、冲突键与保留键', () => {
  const profiles = getDefaultProfiles(2);
  const actions = tankBattleGame.actions;
  const bindings = {
    p1: { ...tankBattleGame.defaultBindingsBySlot.p1 },
    p2: { ...tankBattleGame.defaultBindingsBySlot.p2 },
  };

  const stateMap = buildVisualKeyboardStateMap({
    profiles,
    actions,
    bindingsBySlot: bindings,
    selectedSlotId: 'p1',
    capturingTarget: { slotId: 'p1', actionId: 'forward' },
    livePressedCodes: new Set(['KeyD']),
  });

  assert.equal(stateMap.Escape?.kind, 'reserved');
  assert.equal(stateMap.KeyW?.kind, 'capturing');
  assert.equal(stateMap.KeyD?.kind, 'selected-bound');
  assert.equal(stateMap.KeyD?.isLivePressed, true);
  assert.equal(stateMap.Space?.kind, 'selected-bound');
  assert.equal(stateMap.ArrowUp?.kind, 'other-bound');
  assert.equal(stateMap.ArrowUp?.ownerSlotId, 'p2');

  // 制造冲突键：把 P2 的开火也改为 Space
  const conflictBindings = {
    p1: { ...bindings.p1 },
    p2: { ...bindings.p2, fire: 'Space' },
  };
  const conflictMap = buildVisualKeyboardStateMap({
    profiles,
    actions,
    bindingsBySlot: conflictBindings,
    selectedSlotId: 'p1',
    capturingTarget: null,
  });
  assert.equal(conflictMap.Space?.kind, 'conflict');
});

test('3. buildCompactMatchKeyHint 从玩家实际绑定生成对局内键帽提示', () => {
  const hintIntuitive = buildCompactMatchKeyHint(
    {
      slotId: 'p1',
      rawName: '',
      displayName: 'P1',
      colorHex: '#D9432B',
      bindings: {
        forward: 'KeyI',
        backward: 'KeyK',
        turnLeft: 'KeyJ',
        turnRight: 'KeyL',
        fire: 'Space',
      },
    },
    'intuitive'
  );
  assert.equal(hintIntuitive.upKey, 'I');
  assert.equal(hintIntuitive.leftKey, 'J');
  assert.equal(hintIntuitive.downKey, 'K');
  assert.equal(hintIntuitive.rightKey, 'L');
  assert.equal(hintIntuitive.fireKey, '空格');
  assert.equal(hintIntuitive.moveModeLabel, '方向移动');

  const hintClassic = buildCompactMatchKeyHint(
    {
      slotId: 'p2',
      rawName: '',
      displayName: 'P2',
      colorHex: '#2364C7',
      bindings: tankBattleGame.defaultBindingsBySlot.p2,
    },
    'classic'
  );
  assert.equal(hintClassic.upKey, '↑');
  assert.equal(hintClassic.fireKey, 'Enter');
  assert.equal(hintClassic.moveModeLabel, '进退转向');
});
