import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  clampFireButtonPosition,
  clampVirtualControlsOpacity,
  loadMobilePreferences,
  saveMobilePreferences,
  type FireButtonPosition,
} from '../settings/preferencesStore';

export interface MobileDetectionInputs {
  userAgent: string;
  hasCoarsePointer: boolean;
  hoverNone: boolean;
  maxTouchPoints: number;
  viewportMinSide: number;
}

export interface LogicalPoint {
  x: number;
  y: number;
}

export interface MobileViewportState {
  /** 是否为手机 / Pad 触控移动设备 */
  isMobileOrTablet: boolean;
  /** 物理视口处于竖屏、当前通过 CSS 自动旋转为横屏显示 */
  isPortraitRotated: boolean;
  /** 逻辑横屏宽高（px） */
  logicalWidth: number;
  logicalHeight: number;
  /** 物理窗口宽高（px） */
  physicalWidth: number;
  physicalHeight: number;
  /** 虚拟摇杆与按钮透明度百分比（10 ~ 80） */
  virtualControlsOpacity: number;
  /** 自定义开火按钮位置；为 null 表示默认右下角 */
  fireButtonPos: FireButtonPosition | null;
  /** 是否处于浏览器全屏 */
  isFullscreen: boolean;
  /** 是否允许发起全屏横屏请求 */
  canRequestFullscreen: boolean;
  setVirtualControlsOpacity: (opacityPercent: number) => void;
  setFireButtonPos: (pos: FireButtonPosition | null) => void;
  /** 将浏览器视口 clientX / clientY 转换为当前逻辑横屏坐标系坐标 */
  requestLandscapeFullscreen: () => Promise<void>;
  exitFullscreen: () => Promise<void>;
  toLogicalPoint: (clientX: number, clientY: number) => LogicalPoint;
}

const DEFAULT_STATE: MobileViewportState = {
  isMobileOrTablet: false,
  isPortraitRotated: false,
  logicalWidth: 1280,
  logicalHeight: 720,
  physicalWidth: 1280,
  physicalHeight: 720,
  virtualControlsOpacity: 55,
  fireButtonPos: null,
  isFullscreen: false,
  canRequestFullscreen: false,
  setVirtualControlsOpacity: () => {},
  setFireButtonPos: () => {},
  requestLandscapeFullscreen: async () => {},
  exitFullscreen: async () => {},
  toLogicalPoint: (clientX, clientY) => ({ x: clientX, y: clientY }),
};

const MobileViewportContext = createContext<MobileViewportState>(DEFAULT_STATE);

/**
 * 纯函数判定当前设备是否为手机或平板（Pad）：
 * 避免普通桌面浏览器缩窄窗口时误触发虚拟按键与旋转逻辑。
 */
export function detectMobileTouchDevice(inputs: MobileDetectionInputs): boolean {
  const { userAgent, hasCoarsePointer, hoverNone, maxTouchPoints, viewportMinSide } = inputs;
  const mobileUa = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet|HarmonyOS/i.test(
    userAgent
  );
  if (mobileUa) return true;
  // iPadOS 13+ Safari UA 常伪装为 Macintosh，但具备多点触控与粗指针
  if (hasCoarsePointer && hoverNone) return true;
  if (hasCoarsePointer && maxTouchPoints > 1 && viewportMinSide <= 1180) return true;
  return false;
}

/**
 * 将浏览器视口坐标转换到逻辑横屏容器坐标：
 * 当竖屏容器以 transform: translate(physicalWidth, 0) rotate(90deg) 旋转时，
 * 正变换为 clientX = physicalWidth - ly, clientY = lx；其逆变换为 lx = clientY, ly = physicalWidth - clientX。
 */
export function clientToLogicalPoint(
  clientX: number,
  clientY: number,
  isPortraitRotated: boolean,
  physicalWidth: number
): LogicalPoint {
  if (!isPortraitRotated) {
    return { x: clientX, y: clientY };
  }
  return {
    x: clientY,
    y: physicalWidth - clientX,
  };
}

function readWindowSnapshot(): {
  isMobileOrTablet: boolean;
  physicalWidth: number;
  physicalHeight: number;
} {
  if (typeof window === 'undefined') {
    return { isMobileOrTablet: false, physicalWidth: 1280, physicalHeight: 720 };
  }
  const vw = Math.max(240, Math.round(window.visualViewport?.width ?? window.innerWidth));
  const vh = Math.max(240, Math.round(window.visualViewport?.height ?? window.innerHeight));
  const hasCoarsePointer = Boolean(window.matchMedia?.('(pointer: coarse)').matches);
  const hoverNone = Boolean(window.matchMedia?.('(hover: none)').matches);
  const isMobileOrTablet = detectMobileTouchDevice({
    userAgent: navigator.userAgent || '',
    hasCoarsePointer,
    hoverNone,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    viewportMinSide: Math.min(vw, vh),
  });
  return { isMobileOrTablet, physicalWidth: vw, physicalHeight: vh };
}

async function tryLockLandscapeOrientation(): Promise<void> {
  try {
    const orientationApi = (
      screen as Screen & {
        orientation?: { lock?: (mode: string) => Promise<void> };
      }
    ).orientation;
    if (orientationApi?.lock) {
      await orientationApi.lock('landscape');
    }
  } catch {
    // Safari / 未授权上下文可能拒绝物理方向锁定，交由 CSS 强制横屏兜底
  }
}

export function MobileViewportProvider({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState(readWindowSnapshot);
  const [isFullscreen, setIsFullscreen] = useState(() =>
    typeof document !== 'undefined' ? Boolean(document.fullscreenElement) : false
  );
  const [initialPrefs] = useState(() => loadMobilePreferences().value);
  const [opacity, setOpacity] = useState<number>(initialPrefs.virtualControlsOpacity);
  const [fireButtonPos, setFireButtonPosState] = useState<FireButtonPosition | null>(
    initialPrefs.fireButtonPos ?? null
  );

  useEffect(() => {
    const sync = () => setSnap(readWindowSnapshot());
    const syncFs = () => setIsFullscreen(Boolean(document.fullscreenElement));

    sync();
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    window.visualViewport?.addEventListener('resize', sync);
    document.addEventListener('fullscreenchange', syncFs);

    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
      window.visualViewport?.removeEventListener('resize', sync);
      document.removeEventListener('fullscreenchange', syncFs);
    };
  }, []);

  // 移动端首次加载或切换横屏时尝试软锁横屏（部分 Android Chrome / PWA 下可直接生效）
  useEffect(() => {
    if (!snap.isMobileOrTablet) return;
    void tryLockLandscapeOrientation();
  }, [snap.isMobileOrTablet]);

  const setVirtualControlsOpacity = useCallback(
    (nextPercent: number) => {
      const clamped = clampVirtualControlsOpacity(nextPercent);
      setOpacity(clamped);
      saveMobilePreferences({ virtualControlsOpacity: clamped, fireButtonPos });
    },
    [fireButtonPos]
  );

  const setFireButtonPos = useCallback(
    (pos: FireButtonPosition | null) => {
      const next = pos ? clampFireButtonPosition(pos) : null;
      setFireButtonPosState(next);
      saveMobilePreferences({ virtualControlsOpacity: opacity, fireButtonPos: next });
    },
    [opacity]
  );

  const canRequestFullscreen =
    typeof document !== 'undefined' &&
    Boolean(document.documentElement.requestFullscreen) &&
    snap.isMobileOrTablet;

  const requestLandscapeFullscreen = useCallback(async () => {
    if (typeof document === 'undefined') return;
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // 忽略系统拦截
    }
    await tryLockLandscapeOrientation();
  }, []);

  const exitFullscreen = useCallback(async () => {
    if (typeof document === 'undefined') return;
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch {
      // ignore
    }
  }, []);

  const isPortraitRotated = snap.isMobileOrTablet && snap.physicalHeight > snap.physicalWidth;
  const logicalWidth = isPortraitRotated ? snap.physicalHeight : snap.physicalWidth;
  const logicalHeight = isPortraitRotated ? snap.physicalWidth : snap.physicalHeight;

  const toLogicalPoint = useCallback(
    (clientX: number, clientY: number) =>
      clientToLogicalPoint(clientX, clientY, isPortraitRotated, snap.physicalWidth),
    [isPortraitRotated, snap.physicalWidth]
  );

  const value = useMemo<MobileViewportState>(
    () => ({
      isMobileOrTablet: snap.isMobileOrTablet,
      isPortraitRotated,
      logicalWidth,
      logicalHeight,
      physicalWidth: snap.physicalWidth,
      physicalHeight: snap.physicalHeight,
      virtualControlsOpacity: opacity,
      fireButtonPos,
      isFullscreen,
      canRequestFullscreen,
      setVirtualControlsOpacity,
      setFireButtonPos,
      requestLandscapeFullscreen,
      exitFullscreen,
      toLogicalPoint,
    }),
    [
      snap.isMobileOrTablet,
      snap.physicalWidth,
      snap.physicalHeight,
      isPortraitRotated,
      logicalWidth,
      logicalHeight,
      opacity,
      fireButtonPos,
      isFullscreen,
      canRequestFullscreen,
      setVirtualControlsOpacity,
      setFireButtonPos,
      requestLandscapeFullscreen,
      exitFullscreen,
      toLogicalPoint,
    ]
  );

  const stageStyle: CSSProperties | undefined = isPortraitRotated
    ? {
        position: 'fixed',
        top: 0,
        left: 0,
        width: `${logicalWidth}px`,
        height: `${logicalHeight}px`,
        transformOrigin: 'top left',
        transform: `translate(${snap.physicalWidth}px, 0px) rotate(90deg)`,
        overflowY: 'auto',
        overflowX: 'hidden',
      }
    : undefined;

  return (
    <MobileViewportContext.Provider value={value}>
      {isPortraitRotated ? (
        <div
          data-testid="mobile-landscape-shell"
          data-rotated="true"
          className="fixed inset-0 overflow-hidden bg-[#040712]"
        >
          <div style={stageStyle}>{children}</div>
        </div>
      ) : (
        <div
          data-testid="mobile-landscape-shell"
          data-rotated="false"
          className="w-full h-full overflow-y-auto overflow-x-hidden"
        >
          {children}
        </div>
      )}
    </MobileViewportContext.Provider>
  );
}

export function useMobileViewport(): MobileViewportState {
  return useContext(MobileViewportContext);
}
