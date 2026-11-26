import { useEffect, useMemo, useState } from 'react';
import { Tabs } from '@heroui/react';
import { Keyboard } from 'lucide-react';
import type {
  ActionDefinition,
  PlayerProfile,
  PlayerSlotId,
} from '../games/contracts';
import {
  RESERVED_KEY_CODES,
  resolveDisplayName,
} from '../input/bindings';
import {
  VISUAL_KEYBOARD_ROWS,
  buildVisualKeyboardStateMap,
  type KeyCaptureTarget,
} from '../input/keyboardVisualizer';

interface VisualKeyboardProps {
  profiles: PlayerProfile[];
  actions: ActionDefinition[];
  bindingsBySlot: Record<PlayerSlotId, Record<string, string>>;
  selectedSlotId: PlayerSlotId;
  capturingTarget: KeyCaptureTarget | null;
  onSelectSlot: (slotId: PlayerSlotId) => void;
  /** 当处于改键录入状态时，直接点击虚拟键帽也可绑定按键 */
  onAssignKeyFromClick?: (keyCode: string) => void;
}

/**
 * 视觉化键盘组件（支持浅色/深色主题与 HeroUI Tabs 玩家切换）：
 * - 实时高亮当前选中玩家已绑定的键位与正在配置的按键
 * - 同步标记另一位玩家已占用键位与冲突键，避免键位打架
 * - 支持真实键盘按下实时反馈；录入改键时点击虚拟键帽也可直接指定键位
 */
export function VisualKeyboard({
  profiles,
  actions,
  bindingsBySlot,
  selectedSlotId,
  capturingTarget,
  onSelectSlot,
  onAssignKeyFromClick,
}: VisualKeyboardProps) {
  const [livePressedCodes, setLivePressedCodes] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      setLivePressedCodes((prev) => {
        if (prev.has(event.code)) return prev;
        const next = new Set(prev);
        next.add(event.code);
        return next;
      });
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      setLivePressedCodes((prev) => {
        if (!prev.has(event.code)) return prev;
        const next = new Set(prev);
        next.delete(event.code);
        return next;
      });
    };
    const handleBlur = () => {
      setLivePressedCodes(new Set());
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('keyup', handleKeyUp, { capture: true });
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('keyup', handleKeyUp, { capture: true });
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  const selectedProfile =
    profiles.find((p) => p.slotId === selectedSlotId) ?? profiles[0];
  const capturingAction = capturingTarget
    ? actions.find((a) => a.id === capturingTarget.actionId)
    : null;
  const capturingProfile = capturingTarget
    ? profiles.find((p) => p.slotId === capturingTarget.slotId)
    : null;

  const keyStateMap = useMemo(
    () =>
      buildVisualKeyboardStateMap({
        profiles,
        actions,
        bindingsBySlot,
        selectedSlotId,
        capturingTarget,
        livePressedCodes,
      }),
    [profiles, actions, bindingsBySlot, selectedSlotId, capturingTarget, livePressedCodes]
  );

  return (
    <section
      data-testid="visual-keyboard-panel"
      aria-label="视觉化键盘键位预览"
      className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-3.5 shadow-xs"
    >
      {/* 顶部：标题 + 当前查看/高亮玩家切换 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Keyboard className="w-4 h-4 text-[var(--accent)] shrink-0" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-bold text-[var(--foreground)] leading-tight">
              键位分布键盘图
            </h2>
            <p className="text-[11px] text-[var(--muted)] mt-0.5">
              高亮显示选中玩家键位；改键时按实体键或直接点击键帽即可绑定
            </p>
          </div>
        </div>

        <Tabs
          selectedKey={selectedSlotId}
          onSelectionChange={(key) => onSelectSlot(String(key) as PlayerSlotId)}
        >
          <Tabs.ListContainer>
            <Tabs.List
              aria-label="切换高亮玩家"
              className="bg-[var(--surface-secondary)] border border-[var(--border)] p-1 rounded-lg"
            >
              {profiles.map((profile) => {
                const displayName = resolveDisplayName(profile.slotId, profile.name);
                return (
                  <Tabs.Tab
                    key={profile.slotId}
                    id={profile.slotId}
                    data-testid={`keyboard-player-tab-${profile.slotId}`}
                    className="px-2.5 py-1.5 min-h-[34px] text-xs font-semibold whitespace-nowrap flex items-center gap-1.5"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-[3px] shrink-0"
                      style={{ backgroundColor: profile.colorHex }}
                      aria-hidden="true"
                    />
                    <span>{displayName}</span>
                    <Tabs.Indicator />
                  </Tabs.Tab>
                );
              })}
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>
      </div>

      {/* 改键状态提示栏 */}
      <div
        data-testid="visual-keyboard-status"
        className={`px-3 py-2 rounded-lg border text-xs flex items-center justify-between gap-2 ${
          capturingTarget
            ? 'bg-amber-500/12 border-amber-500/40 text-amber-800 dark:text-amber-300 font-semibold'
            : 'bg-[var(--surface-secondary)] border-[var(--border)] text-[var(--muted)]'
        }`}
      >
        {capturingTarget && capturingProfile && capturingAction ? (
          <span>
            正在为{' '}
            <strong className="text-[var(--foreground)]">
              {resolveDisplayName(capturingProfile.slotId, capturingProfile.name)}
            </strong>{' '}
            配置「<strong className="text-[var(--foreground)]">{capturingAction.label}</strong>
            」—— 请按下键盘按键或点击下方键帽（Esc 取消）
          </span>
        ) : (
          <span>
            当前高亮{' '}
            <strong className="text-[var(--foreground)]">
              {selectedProfile
                ? resolveDisplayName(selectedProfile.slotId, selectedProfile.name)
                : selectedSlotId.toUpperCase()}
            </strong>{' '}
            的按键配置，点击下方动作键帽即可进入改键录入
          </span>
        )}
      </div>

      {/* 60 列精密对齐 5 行机械键盘盘面 */}
      <div className="rounded-xl bg-[#1F252E] border border-[#141820] p-2.5 space-y-1.5 shadow-inner overflow-x-auto">
        <div className="min-w-[540px] space-y-1.5">
          {VISUAL_KEYBOARD_ROWS.map((row, rowIdx) => (
            <div
              key={rowIdx}
              className="grid gap-1"
              style={{ gridTemplateColumns: 'repeat(60, minmax(0, 1fr))' }}
            >
              {row.map((keySpec) => {
                if (keySpec.spacer) {
                  return (
                    <div
                      key={keySpec.code}
                      style={{ gridColumn: `span ${keySpec.span} / span ${keySpec.span}` }}
                      aria-hidden="true"
                    />
                  );
                }

                const state = keyStateMap[keySpec.code];
                const kind = state?.kind ?? 'idle';
                const isPressed = state?.isLivePressed ?? livePressedCodes.has(keySpec.code);
                const isReserved = RESERVED_KEY_CODES.has(keySpec.code);
                const canClickAssign = Boolean(capturingTarget && onAssignKeyFromClick && !isReserved);

                let style: React.CSSProperties | undefined;
                let className =
                  'relative h-10 rounded-md border flex flex-col items-center justify-center leading-none select-none transition-transform duration-100 px-0.5 ';

                if (kind === 'capturing') {
                  className +=
                    'bg-[#E69A24] border-[#FFD37D] text-[#1C2127] ring-2 ring-[#FDE68A] shadow-[0_2px_0_#9A600A] ';
                } else if (kind === 'conflict') {
                  className +=
                    'bg-[#C93420] border-[#FCA5A5] text-white ring-1 ring-[#FCA5A5] shadow-[0_2px_0_#7F1D1D] ';
                } else if (kind === 'selected-bound') {
                  style = {
                    backgroundColor: state?.ownerColorHex ?? '#D9432B',
                    borderColor: 'rgba(255,255,255,0.45)',
                  };
                  className += 'text-white shadow-[0_2px_0_rgba(0,0,0,0.45)] ';
                } else if (kind === 'other-bound') {
                  style = {
                    borderColor: state?.ownerColorHex ?? '#64748B',
                    backgroundColor: '#313944',
                  };
                  className += 'text-[#E5E7EB] shadow-[0_2px_0_#14181E] ';
                } else if (kind === 'reserved') {
                  className +=
                    'bg-[#333B46] border-[#4A5564] text-[#9BA5B2] shadow-[0_2px_0_#14181E] ';
                } else {
                  className +=
                    'bg-[#3A434F] border-[#525D6C] text-[#E6E2D8] shadow-[0_2px_0_#181D24] ';
                }

                if (isPressed) {
                  className += 'translate-y-[1.5px] brightness-115 ';
                }

                if (canClickAssign) {
                  className += 'cursor-pointer hover:brightness-115 ';
                } else {
                  className += 'cursor-default ';
                }

                return (
                  <button
                    key={keySpec.code}
                    type="button"
                    tabIndex={-1}
                    data-testid={`vkey-${keySpec.code}`}
                    data-key-state={kind}
                    title={
                      state?.actionLabel
                        ? `${keySpec.label}：${state.actionLabel}`
                        : keySpec.label
                    }
                    onClick={() => {
                      if (canClickAssign) {
                        onAssignKeyFromClick?.(keySpec.code);
                      }
                    }}
                    style={{
                      gridColumn: `span ${keySpec.span} / span ${keySpec.span}`,
                      ...style,
                    }}
                    className={className}
                  >
                    <span className="font-mono-num text-[11px] font-bold tracking-tight">
                      {keySpec.label}
                    </span>
                    {state?.shortTag && (
                      <span
                        className={`text-[9px] font-semibold mt-0.5 leading-none ${
                          kind === 'capturing'
                            ? 'text-[#1C2127]'
                            : kind === 'selected-bound' || kind === 'conflict'
                            ? 'text-white/95'
                            : 'text-[#B5BEC9]'
                        }`}
                      >
                        {state.shortTag}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* 图例说明 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-[var(--muted)]">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="w-2.5 h-2.5 rounded-[3px] shrink-0"
            style={{ backgroundColor: selectedProfile?.colorHex ?? '#D9432B' }}
            aria-hidden="true"
          />
          当前玩家已绑定
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-[3px] bg-[#E69A24] shrink-0" aria-hidden="true" />
          正在配置
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-[3px] bg-[#313944] border border-[#64748B] shrink-0" aria-hidden="true" />
          对手占用
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-[3px] bg-[#C93420] shrink-0" aria-hidden="true" />
          按键冲突
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-[3px] bg-[#333B46] border border-[#4A5564] shrink-0" aria-hidden="true" />
          Esc 暂停保留
        </span>
      </div>
    </section>
  );
}
