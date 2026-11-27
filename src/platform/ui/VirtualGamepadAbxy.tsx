import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Crosshair, Footprints, Hand, Repeat, Rocket, Sword } from 'lucide-react';
import { useMobileViewport } from '../mobile/MobileViewportContext';

interface VirtualGamepadAbxyProps {
  /** 主操控玩家涂装色 */
  playerColorHex?: string;
  /** 当前手持武器类型（sword / pistol / rocket / null） */
  weaponKind?: string | null;
  /** 当前手持武器简短标签（例如 长剑 / 手枪 / 火箭筒） */
  weaponLabel?: string;
  /** 当前武器剩余耐久或弹药 */
  weaponCount?: number;
  /** 附近可拾取/替换武器提示文案（非空时高亮 B 换武器键） */
  nearbyPickupLabel?: string | null;
  /** 控件整体透明度百分比（10 ~ 80） */
  opacityPercent: number;
  /** 左侧 360° 摇杆回调 */
  onMoveStickChange: (x: number, y: number, magnitude: number) => void;
  /** 右侧 ABXY 动作按下/抬起回调 */
  onActionChange: (actionId: 'attack' | 'kick' | 'jump' | 'swap', pressed: boolean) => void;
}

interface StickVisual {
  active: boolean;
  baseX: number;
  baseY: number;
  knobDx: number;
  knobDy: number;
  angleRad: number;
  magnitude: number;
}

const DEADZONE_RATIO = 0.16;

type AbxyActionId = 'attack' | 'kick' | 'jump' | 'swap';

/**
 * 火柴人决斗专属手柄虚拟按键层（左 360° 浮动摇杆 + 右 ABXY 菱形四键）：
 * - 左 X（attack）：空手出拳 / 持武器挥砍或射击
 * - 上 Y（kick）：高位飞踢击飞
 * - 下 A（jump）：跳跃 / 二段跳（摇杆向下 + A 可穿短平台）
 * - 右 B（swap）：拾取 / 换武器（靠近新武器时脉冲高亮）
 * - 同时支持触屏多指与桌面鼠标点击体验
 */
export function VirtualGamepadAbxy({
  playerColorHex = '#D9432B',
  weaponKind = null,
  weaponLabel,
  weaponCount,
  nearbyPickupLabel = null,
  opacityPercent,
  onMoveStickChange,
  onActionChange,
}: VirtualGamepadAbxyProps) {
  const { isPortraitRotated, physicalWidth, logicalHeight, toLogicalPoint } =
    useMobileViewport();

  const isCompact = logicalHeight < 420;
  const outerRadius = isCompact ? 46 : 56;
  const knobRadius = isCompact ? 19 : 23;
  const maxTravel = outerRadius - knobRadius * 0.35;
  const btnSize = isCompact ? 54 : 62;
  const diamondRadius = isCompact ? 50 : 58;
  const padSize = diamondRadius * 2 + btnSize + 12;

  const zoneRef = useRef<HTMLDivElement | null>(null);
  const stickPointerIdRef = useRef<number | null>(null);
  const stickCenterRef = useRef<{ x: number; y: number }>({ x: 86, y: 120 });
  const btnPointersRef = useRef<Record<AbxyActionId, number | null>>({
    attack: null,
    kick: null,
    jump: null,
    swap: null,
  });

  const [stickVisual, setStickVisual] = useState<StickVisual>({
    active: false,
    baseX: 0,
    baseY: 0,
    knobDx: 0,
    knobDy: 0,
    angleRad: 0,
    magnitude: 0,
  });
  const [pressedMap, setPressedMap] = useState<Record<AbxyActionId, boolean>>({
    attack: false,
    kick: false,
    jump: false,
    swap: false,
  });

  const onMoveRef = useRef(onMoveStickChange);
  onMoveRef.current = onMoveStickChange;
  const onActionRef = useRef(onActionChange);
  onActionRef.current = onActionChange;

  useEffect(() => {
    return () => {
      onMoveRef.current(0, 0, 0);
      onActionRef.current('attack', false);
      onActionRef.current('kick', false);
      onActionRef.current('jump', false);
      onActionRef.current('swap', false);
    };
  }, []);

  const toLogicalElementBox = (
    el: HTMLDivElement | null
  ): { left: number; top: number; width: number; height: number } => {
    if (!el) return { left: 0, top: 0, width: 640, height: 360 };
    const rect = el.getBoundingClientRect();
    if (!isPortraitRotated) {
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }
    return {
      left: rect.top,
      top: physicalWidth - rect.right,
      width: rect.height,
      height: rect.width,
    };
  };

  const resetStick = () => {
    stickPointerIdRef.current = null;
    setStickVisual((prev) => ({
      ...prev,
      active: false,
      knobDx: 0,
      knobDy: 0,
      magnitude: 0,
    }));
    onMoveRef.current(0, 0, 0);
  };

  const updateStickFromPoint = (localX: number, localY: number) => {
    const cx = stickCenterRef.current.x;
    const cy = stickCenterRef.current.y;
    const dx = localX - cx;
    const dy = localY - cy;
    const dist = Math.hypot(dx, dy);

    const clampedDist = Math.min(dist, maxTravel);
    const scale = dist > 1e-6 ? clampedDist / dist : 0;
    const knobDx = dx * scale;
    const knobDy = dy * scale;

    const rawRatio = Math.min(1, dist / maxTravel);
    if (rawRatio <= DEADZONE_RATIO || dist <= 1e-6) {
      setStickVisual({
        active: true,
        baseX: cx,
        baseY: cy,
        knobDx,
        knobDy,
        angleRad: 0,
        magnitude: 0,
      });
      onMoveRef.current(0, 0, 0);
      return;
    }

    const effectiveMag = (rawRatio - DEADZONE_RATIO) / (1 - DEADZONE_RATIO);
    setStickVisual({
      active: true,
      baseX: cx,
      baseY: cy,
      knobDx,
      knobDy,
      angleRad: Math.atan2(dy, dx),
      magnitude: effectiveMag,
    });
    onMoveRef.current(dx / dist, dy / dist, effectiveMag);
  };

  const handleStickPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (stickPointerIdRef.current !== null) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore synthetic pointer events
    }
    stickPointerIdRef.current = e.pointerId;

    const pt = toLogicalPoint(e.clientX, e.clientY);
    const box = toLogicalElementBox(zoneRef.current);
    const pad = outerRadius + 8;
    const cx = Math.max(pad, Math.min(box.width - pad, pt.x - box.left));
    const cy = Math.max(pad, Math.min(box.height - pad, pt.y - box.top));
    stickCenterRef.current = { x: cx, y: cy };
    setStickVisual({
      active: true,
      baseX: cx,
      baseY: cy,
      knobDx: 0,
      knobDy: 0,
      angleRad: 0,
      magnitude: 0,
    });
    onMoveRef.current(0, 0, 0);
  };

  const handleStickPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== stickPointerIdRef.current) return;
    e.preventDefault();
    const pt = toLogicalPoint(e.clientX, e.clientY);
    const box = toLogicalElementBox(zoneRef.current);
    updateStickFromPoint(pt.x - box.left, pt.y - box.top);
  };

  const handleStickPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== stickPointerIdRef.current) return;
    e.preventDefault();
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
    resetStick();
  };

  const bindActionButton = (actionId: AbxyActionId) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (btnPointersRef.current[actionId] !== null) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore synthetic pointer events
      }
      btnPointersRef.current[actionId] = e.pointerId;
      setPressedMap((prev) => ({ ...prev, [actionId]: true }));
      onActionRef.current(actionId, true);
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.pointerId !== btnPointersRef.current[actionId]) return;
      e.preventDefault();
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      }
      btnPointersRef.current[actionId] = null;
      setPressedMap((prev) => ({ ...prev, [actionId]: false }));
      onActionRef.current(actionId, false);
    },
    onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.pointerId !== btnPointersRef.current[actionId]) return;
      e.preventDefault();
      btnPointersRef.current[actionId] = null;
      setPressedMap((prev) => ({ ...prev, [actionId]: false }));
      onActionRef.current(actionId, false);
    },
    onLostPointerCapture: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.pointerId !== btnPointersRef.current[actionId]) return;
      btnPointersRef.current[actionId] = null;
      setPressedMap((prev) => ({ ...prev, [actionId]: false }));
      onActionRef.current(actionId, false);
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  const baseOpacity = Math.max(0.2, Math.min(0.92, opacityPercent / 100));
  const center = padSize / 2;

  const attackLabel =
    weaponKind === 'sword'
      ? '挥剑'
      : weaponKind === 'pistol'
      ? '开枪'
      : weaponKind === 'shotgun'
      ? '散射'
      : weaponKind === 'rocket'
      ? '发射'
      : '拳';

  const AttackIcon =
    weaponKind === 'sword'
      ? Sword
      : weaponKind === 'pistol' || weaponKind === 'shotgun'
      ? Crosshair
      : weaponKind === 'rocket'
      ? Rocket
      : Hand;

  const buttons: Array<{
    actionId: AbxyActionId;
    letter: string;
    label: string;
    cx: number;
    cy: number;
    color: string;
    icon: React.ReactNode;
    badge?: string;
    pulse?: boolean;
  }> = [
    {
      actionId: 'attack',
      letter: 'X',
      label: attackLabel,
      cx: center - diamondRadius,
      cy: center,
      color: playerColorHex,
      icon: <AttackIcon className="w-4 h-4" strokeWidth={2.4} aria-hidden="true" />,
      badge:
        weaponKind && weaponCount !== undefined
          ? `${weaponCount}`
          : undefined,
    },
    {
      actionId: 'kick',
      letter: 'Y',
      label: '腿',
      cx: center,
      cy: center - diamondRadius,
      color: '#D97706',
      icon: <Footprints className="w-4 h-4" strokeWidth={2.4} aria-hidden="true" />,
    },
    {
      actionId: 'jump',
      letter: 'A',
      label: '跳',
      cx: center,
      cy: center + diamondRadius,
      color: '#0284C7',
      icon: <ArrowUp className="w-4 h-4" strokeWidth={2.6} aria-hidden="true" />,
    },
    {
      actionId: 'swap',
      letter: 'B',
      label: nearbyPickupLabel ? '拾换' : '换武',
      cx: center + diamondRadius,
      cy: center,
      color: nearbyPickupLabel ? '#10B981' : '#475569',
      icon: <Repeat className="w-4 h-4" strokeWidth={2.4} aria-hidden="true" />,
      pulse: Boolean(nearbyPickupLabel),
    },
  ];

  return (
    <div
      data-testid="virtual-gamepad-abxy"
      className="pointer-events-none absolute inset-0 z-30 touch-game-surface select-none"
    >
      {/* 左半区：360° 摇杆热区（移动 + 8 向瞄准） */}
      <div
        ref={zoneRef}
        data-testid="abxy-joystick-zone"
        onPointerDown={handleStickPointerDown}
        onPointerMove={handleStickPointerMove}
        onPointerUp={handleStickPointerUp}
        onPointerCancel={handleStickPointerUp}
        onLostPointerCapture={handleStickPointerUp}
        onContextMenu={(e) => e.preventDefault()}
        className="pointer-events-auto absolute left-0 top-12 bottom-0 w-[44%] touch-game-surface"
      >
        {/* 静止参考底座 */}
        {!stickVisual.active && (
          <div
            style={{
              width: outerRadius * 2,
              height: outerRadius * 2,
              left: isCompact ? 18 : 28,
              bottom: isCompact ? 24 : 30,
              opacity: baseOpacity,
            }}
            className="pointer-events-none absolute rounded-full border-2 border-dashed border-[#1C2127]/70 dark:border-white/55 bg-[#FAF8F4]/65 dark:bg-[#0F172A]/65 flex items-center justify-center shadow-md"
          >
            {/* 8 向刻度点 */}
            <div className="absolute inset-2 rounded-full border border-[#1C2127]/15 dark:border-white/15" />
            <div
              style={{ width: knobRadius * 1.7, height: knobRadius * 1.7 }}
              className="rounded-full border-2 border-[#1C2127]/80 dark:border-white/75 bg-white/90 dark:bg-slate-800/90 flex items-center justify-center"
            >
              <span className="text-[9px] font-bold text-[#1C2127] dark:text-white/90">
                摇杆
              </span>
            </div>
          </div>
        )}

        {/* 激活态浮动摇杆 */}
        {stickVisual.active && (
          <div
            style={{
              width: outerRadius * 2,
              height: outerRadius * 2,
              left: stickVisual.baseX - outerRadius,
              top: stickVisual.baseY - outerRadius,
              opacity: Math.min(0.96, baseOpacity + 0.16),
            }}
            className="pointer-events-none absolute rounded-full border-2 border-[#1C2127]/85 dark:border-white/75 bg-[#FAF8F4]/78 dark:bg-[#0F172A]/75 shadow-lg"
          >
            <div
              style={{
                width: maxTravel * DEADZONE_RATIO * 2,
                height: maxTravel * DEADZONE_RATIO * 2,
              }}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#1C2127]/25 dark:border-white/25"
            />
            {stickVisual.magnitude > 0 && (
              <div
                style={{
                  transform: `translate(-50%, -50%) rotate(${stickVisual.angleRad}rad)`,
                }}
                className="absolute left-1/2 top-1/2 w-full h-full pointer-events-none"
              >
                <div
                  style={{ backgroundColor: playerColorHex }}
                  className="absolute right-[-3px] top-1/2 -translate-y-1/2 w-2.5 h-2.5 rotate-45 rounded-[2px] border border-[#1C2127]"
                />
              </div>
            )}
            <div
              style={{
                width: knobRadius * 2,
                height: knobRadius * 2,
                transform: `translate(${outerRadius - knobRadius + stickVisual.knobDx}px, ${
                  outerRadius - knobRadius + stickVisual.knobDy
                }px)`,
                backgroundColor: stickVisual.magnitude > 0 ? playerColorHex : '#262D35',
              }}
              className="absolute left-0 top-0 rounded-full border-2 border-[#1C2127] dark:border-white/85 shadow-md flex items-center justify-center"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-white/85" />
            </div>
          </div>
        )}
      </div>

      {/* 右下区：ABXY 菱形四键（左拳 / 上腿 / 下跳 / 右换武器） */}
      <div
        style={{
          width: padSize,
          height: padSize,
          right: isCompact ? 12 : 24,
          bottom: isCompact ? 16 : 24,
        }}
        className="pointer-events-none absolute"
      >
        {/* 附近可拾取武器悬浮提示 */}
        {nearbyPickupLabel && (
          <div className="pointer-events-none absolute -top-7 right-0 px-2.5 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-bold shadow-md whitespace-nowrap">
            按 B 换：{nearbyPickupLabel}
          </div>
        )}

        {/* 中心极淡十字连接参考 */}
        <div
          style={{ opacity: baseOpacity * 0.45 }}
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full border border-dashed border-[#1C2127]/40 dark:border-white/35"
        />

        {buttons.map((btn) => {
          const active = pressedMap[btn.actionId];
          return (
            <button
              key={btn.actionId}
              type="button"
              data-testid={`abxy-btn-${btn.actionId}`}
              aria-label={`${btn.letter} ${btn.label}${
                btn.actionId === 'attack' && weaponLabel ? `（${weaponLabel}）` : ''
              }`}
              {...bindActionButton(btn.actionId)}
              style={{
                width: btnSize,
                height: btnSize,
                left: btn.cx - btnSize / 2,
                top: btn.cy - btnSize / 2,
                backgroundColor: btn.color,
                opacity: active ? Math.min(0.98, baseOpacity + 0.24) : baseOpacity,
              }}
              className={`pointer-events-auto absolute rounded-full border-[2.5px] border-[#1C2127] dark:border-white/80 text-white shadow-lg flex flex-col items-center justify-center gap-0.5 touch-game-surface transition-transform duration-75 cursor-pointer ${
                active ? 'scale-92 brightness-110' : 'scale-100'
              } ${btn.pulse ? 'ring-3 ring-emerald-300/90 animate-pulse' : ''}`}
            >
              {/* 左上角手柄字母标（X/Y/A/B） */}
              <span className="absolute -top-1.5 -left-1 w-5 h-5 rounded-full bg-[#181E26] border border-white/80 text-[10px] font-mono-num font-extrabold text-white flex items-center justify-center shadow-xs">
                {btn.letter}
              </span>

              {/* 武器剩余次数角标 */}
              {btn.badge && (
                <span className="absolute -top-1.5 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-amber-400 border border-[#181E26] text-[10px] font-mono-num font-extrabold text-[#181E26] flex items-center justify-center shadow-xs">
                  {btn.badge}
                </span>
              )}

              {btn.icon}
              <span className="text-[10px] font-extrabold leading-none tracking-tight">
                {btn.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
