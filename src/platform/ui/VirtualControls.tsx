import { useEffect, useRef, useState } from 'react';
import { Check, Crosshair, Move, RotateCcw } from 'lucide-react';
import type { ItemKind } from '../../games/tank-battle/types';
import { ITEM_ACCENT_COLORS, TankItemIcon } from '../../games/tank-battle/ui/itemIcons';
import { useMobileViewport } from '../mobile/MobileViewportContext';
import { clampFireButtonPosition, type FireButtonPosition } from '../settings/preferencesStore';

interface VirtualControlsProps {
  /** 主操控玩家涂装色 */
  playerColorHex?: string;
  /** 当前持有待发射道具类型（用于开火键徽章提示） */
  activeItemKind?: string | null;
  /** 控件整体透明度百分比（10 ~ 80） */
  opacityPercent: number;
  /** 自定义开火按钮归一化坐标；为 null 时停靠默认右下角 */
  fireButtonPos: FireButtonPosition | null;
  /** 是否处于拖动调整开火按钮位置的编辑态 */
  editingLayout?: boolean;
  /** 摇杆输出归一化方向与有效推幅（0..1） */
  onMoveStickChange: (x: number, y: number, magnitude: number) => void;
  /** 开火按键按下/抬起回调 */
  onFireChange: (pressed: boolean) => void;
  /** 拖动更新开火按钮位置 */
  onFireButtonPosChange?: (pos: FireButtonPosition) => void;
  /** 重置开火按钮回默认位置 */
  onResetFireButtonPos?: () => void;
  /** 完成编辑并保存退出 */
  onDoneEditingLayout?: () => void;
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
 * - 左侧大区：浮动底座 360° 摇杆（落指即生中心、内环死区、边缘满速、方向高亮刻度）
 * - 右侧独立发射按钮：支持按住连发，并支持在“编辑布局”模式下单指自由拖拽调位与持久化
 * - 多指 pointerId 严格隔离，左侧走位、右侧开火与界面拖动互不干扰
 */
export function VirtualControls({
  playerColorHex = '#D9432B',
  activeItemKind = null,
  opacityPercent,
  fireButtonPos,
  editingLayout = false,
  onMoveStickChange,
  onFireChange,
  onFireButtonPosChange,
  onResetFireButtonPos,
  onDoneEditingLayout,
}: VirtualControlsProps) {
  const { isPortraitRotated, physicalWidth, logicalHeight, toLogicalPoint } =
    useMobileViewport();

  const isUltraCompact = logicalHeight < 370;
  const outerRadius = isUltraCompact ? 48 : 56;
  const knobRadius = isUltraCompact ? 20 : 23;
  const maxTravel = outerRadius - knobRadius * 0.35;
  const fireSize = isUltraCompact ? 72 : 82;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const zoneRef = useRef<HTMLDivElement | null>(null);
  const stickPointerIdRef = useRef<number | null>(null);
  const stickCenterRef = useRef<{ x: number; y: number }>({ x: 86, y: 120 });
  const firePointerIdRef = useRef<number | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);

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

  useEffect(() => {
    if (editingLayout) {
      stickPointerIdRef.current = null;
      firePointerIdRef.current = null;
      setFireActive(false);
      onMoveRef.current(0, 0, 0);
      onFireRef.current(false);
    } else {
      dragPointerIdRef.current = null;
    }
  }, [editingLayout]);

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
    if (editingLayout || stickPointerIdRef.current !== null) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
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
    if (editingLayout || e.pointerId !== stickPointerIdRef.current) return;
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

  const updateFireDragPosition = (clientX: number, clientY: number) => {
    const pt = toLogicalPoint(clientX, clientY);
    const box = toLogicalElementBox(containerRef.current);
    if (box.width <= 1 || box.height <= 1) return;
    const nextPos = clampFireButtonPosition({
      xFrac: (pt.x - box.left) / box.width,
      yFrac: (pt.y - box.top) / box.height,
    });
    onFireButtonPosChange?.(nextPos);
  };

  const handleFirePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (editingLayout) {
      if (dragPointerIdRef.current !== null) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragPointerIdRef.current = e.pointerId;
      updateFireDragPosition(e.clientX, e.clientY);
      return;
    }

    if (firePointerIdRef.current !== null) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    firePointerIdRef.current = e.pointerId;
    setFireActive(true);
    onFireRef.current(true);
  };

  const handleFirePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!editingLayout || e.pointerId !== dragPointerIdRef.current) return;
    e.preventDefault();
    updateFireDragPosition(e.clientX, e.clientY);
  };

  const handleFirePointerEnd = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (editingLayout) {
      if (e.pointerId !== dragPointerIdRef.current) return;
      e.preventDefault();
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      }
      dragPointerIdRef.current = null;
      return;
    }

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

  const fireStylePosition = fireButtonPos
    ? {
        left: `calc(${(fireButtonPos.xFrac * 100).toFixed(2)}% - ${fireSize / 2}px)`,
        top: `calc(${(fireButtonPos.yFrac * 100).toFixed(2)}% - ${fireSize / 2}px)`,
      }
    : {
        right: isUltraCompact ? 18 : 26,
        bottom: isUltraCompact ? 26 : 30,
      };

  return (
    <div
      ref={containerRef}
      data-testid="mobile-virtual-controls"
      className={`${
        editingLayout ? 'pointer-events-auto bg-[#1C2127]/28' : 'pointer-events-none'
      } absolute inset-0 z-30 touch-game-surface`}
    >
      {/* 自定义键位位置顶部条 */}
      {editingLayout && (
        <div className="pointer-events-auto absolute top-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#FAF8F4] border border-[#1C2127] shadow-xl whitespace-nowrap">
          <Move className="w-3.5 h-3.5 text-[#D9432B]" aria-hidden="true" />
          <span className="text-xs font-bold text-[#1C2127]">拖动开火按钮调整位置</span>
          <button
            type="button"
            onClick={onResetFireButtonPos}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#EAE5DA] hover:bg-[#DFD9CB] text-[11px] font-semibold text-[#1C2127] cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" aria-hidden="true" />
            恢复默认
          </button>
          <button
            type="button"
            onClick={onDoneEditingLayout}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[#D9432B] hover:bg-[#BE3620] text-[11px] font-bold text-white cursor-pointer"
          >
            <Check className="w-3 h-3" aria-hidden="true" />
            完成保存
          </button>
        </div>
      )}

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
        className={`${
          editingLayout ? 'pointer-events-none' : 'pointer-events-auto'
        } absolute left-0 top-0 bottom-0 w-[46%] touch-game-surface`}
      >
        {/* 静态提示底座：未触控时展示轻量落指参考位置（避开左下角回合标记） */}
        {!stickVisual.active && (
          <div
            style={{
              width: outerRadius * 2,
              height: outerRadius * 2,
              left: isUltraCompact ? 18 : 26,
              bottom: isUltraCompact ? 26 : 30,
              opacity: editingLayout ? 0.35 : baseOpacity,
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

        {/* 激活态浮动摇杆 */}
        {stickVisual.active && !editingLayout && (
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
            <div
              style={{
                width: maxTravel * DEADZONE_RATIO * 2,
                height: maxTravel * DEADZONE_RATIO * 2,
              }}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#1C2127]/25"
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
              className="absolute left-0 top-0 rounded-full border-2 border-[#1C2127] shadow-md flex items-center justify-center"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-white/85" />
            </div>
          </div>
        )}
      </div>

      {/* 独立发射按钮（支持自由拖拽调整位置与持久化） */}
      <button
        type="button"
        data-testid="virtual-fire-button"
        aria-label={editingLayout ? '拖动调整开火按钮位置' : '发射炮弹'}
        onPointerDown={handleFirePointerDown}
        onPointerMove={handleFirePointerMove}
        onPointerUp={handleFirePointerEnd}
        onPointerCancel={handleFirePointerEnd}
        onLostPointerCapture={handleFirePointerEnd}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          width: fireSize,
          height: fireSize,
          ...fireStylePosition,
          opacity: editingLayout
            ? 0.96
            : fireActive
            ? Math.min(0.95, baseOpacity + 0.18)
            : baseOpacity,
          backgroundColor: fireActive ? '#B8321A' : playerColorHex,
        }}
        className={`pointer-events-auto absolute rounded-full border-[3px] border-[#1C2127] text-white shadow-lg flex flex-col items-center justify-center gap-0.5 touch-game-surface transition-transform duration-75 ${
          editingLayout
            ? 'ring-4 ring-dashed ring-[#F5C469] cursor-move scale-105'
            : fireActive
            ? 'scale-95'
            : 'scale-100'
        }`}
      >
        {activeItemKind && !editingLayout ? (
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
        {editingLayout ? (
          <>
            <Move className="w-6 h-6" strokeWidth={2.4} aria-hidden="true" />
            <span className="text-[10px] font-extrabold leading-none">拖动定位</span>
          </>
        ) : (
          <>
            <Crosshair className="w-6 h-6" strokeWidth={2.5} aria-hidden="true" />
            <span className="text-[11px] font-extrabold tracking-wide leading-none">开火</span>
          </>
        )}
      </button>
    </div>
  );
}
