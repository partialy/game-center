import { useEffect, useRef, useState } from 'react';
import { Crosshair } from 'lucide-react';
import type { ItemKind } from '../../games/tank-battle/types';
import { ITEM_ACCENT_COLORS, TankItemIcon } from '../../games/tank-battle/ui/itemIcons';
import { useMobileViewport } from '../mobile/MobileViewportContext';

interface VirtualControlsProps {
  /** 主操控玩家涂装色 */
  playerColorHex?: string;
  /** 当前持有待发射道具类型（用于开火键徽章提示） */
  activeItemKind?: string | null;
  /** 控件整体透明度百分比（10 ~ 80） */
  opacityPercent: number;
  /** 摇杆输出归一化方向与有效推幅（0..1） */
  onMoveStickChange: (x: number, y: number, magnitude: number) => void;
  /** 开火按键按下/抬起回调 */
  onFireChange: (pressed: boolean) => void;
}

interface StickVisualState {
  active: boolean;
  baseX: number;
  baseY: number;
  knobDx: number;
  knobDy: number;
  angleRad: number;
  magnitude: number;
}

const DEADZONE_RATIO = 0.14;

/**
 * 移动端战斗悬浮操控层：
 * - 左侧大区：浮动底座 360° 摇杆（落指即生中心、内环死区、边缘满速、手指拖拽方向引导弧）
 * - 右下角：独立大尺寸开火按钮（支持点按瞬发与按住连发，自动展示当前武器徽章）
 * - 严密隔离多指 pointerId，左手连续走位与右手开火完全互不干扰
 */
export function VirtualControls({
  playerColorHex = '#D9432B',
  activeItemKind = null,
  opacityPercent,
  onMoveStickChange,
  onFireChange,
}: VirtualControlsProps) {
  const { isPortraitRotated, physicalWidth, logicalHeight, toLogicalPoint } =
    useMobileViewport();

  const isUltraCompact = logicalHeight < 370;
  const outerRadius = isUltraCompact ? 48 : 56;
  const knobRadius = isUltraCompact ? 20 : 23;
  const maxTravel = outerRadius - knobRadius * 0.35;
  const fireSize = isUltraCompact ? 74 : 84;

  const zoneRef = useRef<HTMLDivElement | null>(null);
  const stickPointerIdRef = useRef<number | null>(null);
  const stickCenterRef = useRef<{ x: number; y: number }>({ x: 86, y: 120 });
  const firePointerIdRef = useRef<number | null>(null);

  const [stickVisual, setStickVisual] = useState<StickVisualState>({
    active: false,
    baseX: 0,
    baseY: 0,
    knobDx: 0,
    knobDy: 0,
    angleRad: 0,
    magnitude: 0,
  });
  const [fireActive, setFireActive] = useState(false);

  const onMoveRef = useRef(onMoveStickChange);
  onMoveRef.current = onMoveStickChange;
  const onFireRef = useRef(onFireChange);
  onFireRef.current = onFireChange;

  useEffect(() => {
    return () => {
      onMoveRef.current(0, 0, 0);
      onFireRef.current(false);
    };
  }, []);

  const getLogicalZoneBox = (): { left: number; top: number; width: number; height: number } => {
    const el = zoneRef.current;
    if (!el) return { left: 0, top: 0, width: 320, height: 280 };
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
    const nx = dx / dist;
    const ny = dy / dist;
    setStickVisual({
      active: true,
      baseX: cx,
      baseY: cy,
      knobDx,
      knobDy,
      angleRad: Math.atan2(dy, dx),
      magnitude: effectiveMag,
    });
    onMoveRef.current(nx, ny, effectiveMag);
  };

  const handleStickPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (stickPointerIdRef.current !== null) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    stickPointerIdRef.current = e.pointerId;

    const pt = toLogicalPoint(e.clientX, e.clientY);
    const box = getLogicalZoneBox();
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
    const box = getLogicalZoneBox();
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

  const handleFirePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (firePointerIdRef.current !== null) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    firePointerIdRef.current = e.pointerId;
    setFireActive(true);
    onFireRef.current(true);
  };

  const handleFirePointerEnd = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerId !== firePointerIdRef.current) return;
    e.preventDefault();
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
    firePointerIdRef.current = null;
    setFireActive(false);
    onFireRef.current(false);
  };

  const baseOpacity = Math.max(0.1, Math.min(0.8, opacityPercent / 100));
  const itemAccent = activeItemKind
    ? ITEM_ACCENT_COLORS[activeItemKind as ItemKind]
    : undefined;

  return (
    <div
      data-testid="mobile-virtual-controls"
      className="pointer-events-none absolute inset-0 z-30 touch-game-surface"
    >
      {/* 左半区：浮动虚拟摇杆响应热区 */}
      <div
        ref={zoneRef}
        data-testid="virtual-joystick-zone"
        onPointerDown={handleStickPointerDown}
        onPointerMove={handleStickPointerMove}
        onPointerUp={handleStickPointerUp}
        onPointerCancel={handleStickPointerUp}
        onLostPointerCapture={handleStickPointerUp}
        onContextMenu={(e) => e.preventDefault()}
        className="pointer-events-auto absolute left-0 top-0 bottom-0 w-[46%] touch-game-surface"
      >
        {/* 静态提示底座：未触控时展示轻量落指参考位置 */}
        {!stickVisual.active && (
          <div
            style={{
              width: outerRadius * 2,
              height: outerRadius * 2,
              left: isUltraCompact ? 18 : 26,
              bottom: isUltraCompact ? 14 : 22,
              opacity: baseOpacity,
            }}
            className="pointer-events-none absolute rounded-full border-2 border-dashed border-[#1C2127]/70 bg-[#FAF8F4]/55 flex items-center justify-center shadow-sm"
          >
            <div
              style={{ width: knobRadius * 1.65, height: knobRadius * 1.65 }}
              className="rounded-full border-2 border-[#1C2127]/75 bg-white/85 flex items-center justify-center"
            >
              <span className="w-2 h-2 rounded-full bg-[#1C2127]/70" />
            </div>
          </div>
        )}

        {/* 激活态浮动摇杆：中心精准跟随落指，支持 360° 方向高亮环 */}
        {stickVisual.active && (
          <div
            style={{
              width: outerRadius * 2,
              height: outerRadius * 2,
              left: stickVisual.baseX - outerRadius,
              top: stickVisual.baseY - outerRadius,
              opacity: Math.min(0.95, baseOpacity + 0.15),
            }}
            className="pointer-events-none absolute rounded-full border-2 border-[#1C2127]/85 bg-[#FAF8F4]/72 shadow-md"
          >
            {/* 死区参考细环 */}
            <div
              style={{
                width: maxTravel * DEADZONE_RATIO * 2,
                height: maxTravel * DEADZONE_RATIO * 2,
              }}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#1C2127]/25"
            />

            {/* 推杆方向指针刻度 */}
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

            {/* 摇杆拇指帽 */}
            <div
              style={{
                width: knobRadius * 2,
                height: knobRadius * 2,
                transform: `translate(${outerRadius - knobRadius + stickVisual.knobDx}px, ${
                  outerRadius - knobRadius + stickVisual.knobDy
                }px)`,
                backgroundColor: stickVisual.magnitude > 0 ? playerColorHex : '#262D35',
              }}
              className="absolute left-0 top-0 rounded-full border-2 border-[#1C2127] shadow-md flex items-center justify-center"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-white/85" />
            </div>
          </div>
        )}
      </div>

      {/* 右下角：独立大尺寸发射按钮 */}
      <button
        type="button"
        data-testid="virtual-fire-button"
        aria-label="发射炮弹"
        onPointerDown={handleFirePointerDown}
        onPointerUp={handleFirePointerEnd}
        onPointerCancel={handleFirePointerEnd}
        onLostPointerCapture={handleFirePointerEnd}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          width: fireSize,
          height: fireSize,
          right: isUltraCompact ? 18 : 26,
          bottom: isUltraCompact ? 14 : 22,
          opacity: fireActive ? Math.min(0.95, baseOpacity + 0.18) : baseOpacity,
          backgroundColor: fireActive ? '#B8321A' : playerColorHex,
        }}
        className={`pointer-events-auto absolute rounded-full border-[3px] border-[#1C2127] text-white shadow-lg flex flex-col items-center justify-center gap-0.5 touch-game-surface transition-transform duration-75 ${
          fireActive ? 'scale-95' : 'scale-100'
        }`}
      >
        {activeItemKind ? (
          <div
            style={{
              backgroundColor: itemAccent?.bg ?? '#FAF8F4',
              borderColor: itemAccent?.border ?? '#1C2127',
            }}
            className="absolute -top-2.5 -right-1 w-7 h-7 rounded-full border-2 flex items-center justify-center shadow-sm"
          >
            <TankItemIcon kind={activeItemKind} className="w-5 h-5" />
          </div>
        ) : null}
        <Crosshair className="w-6 h-6" strokeWidth={2.5} aria-hidden="true" />
        <span className="text-[11px] font-extrabold tracking-wide leading-none">开火</span>
      </button>
    </div>
  );
}
