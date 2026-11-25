import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  Check,
  Copy,
  Eye,
  Home,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  SlidersHorizontal,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  BOSS_TIER_THEME,
  type BotRuntimeStatus,
  type GameDefinition,
  type HudState,
  type MatchLaunchSnapshot,
  type MatchResultEvent,
  type PlayerConfig,
  type PlayerHudEntry,
  type PlayerSlotId,
} from '../games/contracts';
import { buildCompactMatchKeyHint } from '../input/keyboardVisualizer';
import { soundEngine } from '../session/audio';
import { SessionHost } from '../session/sessionHost';
import { PerfMetricsCollector, type PerfSnapshot } from '../debug/perfMonitor';
import { useMobileViewport } from '../mobile/MobileViewportContext';
import { DevPerfOverlay } from './DevPerfOverlay';
import { VirtualControls } from './VirtualControls';
import { ITEM_ACCENT_COLORS, TankItemIcon } from '../../games/tank-battle/ui/itemIcons';
import type { ItemKind } from '../../games/tank-battle/types';

interface GameViewportProps<TRules = Record<string, unknown>, TWorld = unknown> {
  game: GameDefinition<TRules, TWorld>;
  snapshot: MatchLaunchSnapshot<TRules>;
  /** 打开设置层时保持宿主暂停与挂载，返回时仍为暂停状态 */
  settingsOverlayOpen: boolean;
  /** 开发者调试模式：仅开启时渲染实时 FPS 与内存监控面板 */
  debugMode?: boolean;
  onToggleDebugMode?: () => void;
  onOpenSettingsFromPause: () => void;
  onExitToSetup: () => void;
  onExitToLobby: () => void;
  onMatchFinished: (result: MatchResultEvent) => void;
  onPausedStateChange?: (paused: boolean) => void;
}

/**
 * 实时对战视口：
 * - 顶部统一外围状态栏呈现双方比分、弹夹与补弹进度、护盾与进攻道具、回合时钟及实用按钮，绝不遮挡迷宫
 * - 下方独立 Canvas 容器由 SessionHost 单次挂载驱动，React HUD 更新不会重建画布或打断模拟
 * - 零 backdrop-blur 叠加，保证 Canvas 渲染顺滑流畅
 */
export function GameViewport<TRules = Record<string, unknown>, TWorld = unknown>({
  game,
  snapshot,
  settingsOverlayOpen,
  debugMode = false,
  onToggleDebugMode,
  onOpenSettingsFromPause,
  onExitToSetup,
  onExitToLobby,
  onMatchFinished,
  onPausedStateChange,
}: GameViewportProps<TRules, TWorld>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<SessionHost<TRules, TWorld> | null>(null);
  const perfCollectorRef = useRef<PerfMetricsCollector>(new PerfMetricsCollector());
  const {
    isMobileOrTablet,
    logicalHeight,
    virtualControlsOpacity,
    setVirtualControlsOpacity,
    isFullscreen,
    canRequestFullscreen,
    requestLandscapeFullscreen,
    exitFullscreen,
  } = useMobileViewport();

  const onMatchFinishedRef = useRef(onMatchFinished);
  onMatchFinishedRef.current = onMatchFinished;
  const onPausedStateChangeRef = useRef(onPausedStateChange);
  onPausedStateChangeRef.current = onPausedStateChange;
  const debugModeRef = useRef(debugMode);
  debugModeRef.current = debugMode;
  const onToggleDebugModeRef = useRef(onToggleDebugMode);
  onToggleDebugModeRef.current = onToggleDebugMode;

  const [hud, setHud] = useState<HudState | null>(null);
  const [botStatuses, setBotStatuses] = useState<Record<PlayerSlotId, BotRuntimeStatus>>({});
  const [paused, setPaused] = useState(false);
  const [pauseReason, setPauseReason] = useState<string>('user');
  const [muted, setMuted] = useState(() => soundEngine.isMuted());
  const [copiedCode, setCopiedCode] = useState(false);
  const [perfSnapshot, setPerfSnapshot] = useState<PerfSnapshot>(() =>
    perfCollectorRef.current.getSnapshot(false)
  );

  // 每场 snapshot 仅挂载一次 SessionHost；卸载时严格释放循环与事件监听（兼容 StrictMode）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const collector = perfCollectorRef.current;
    collector.clear();
    setBotStatuses({});

    const host = new SessionHost(game, snapshot, canvas, {
      onHudUpdate: (nextHud) => setHud(nextHud),
      onBotStatusUpdate: (statuses) => setBotStatuses(statuses),
      onPausedChange: (isPaused, reason) => {
        setPaused(isPaused);
        if (reason) setPauseReason(reason);
        collector.resetTiming();
        if (debugModeRef.current) {
          setPerfSnapshot(collector.getSnapshot(isPaused));
        }
        onPausedStateChangeRef.current?.(isPaused);
      },
      onMatchFinished: (result) => {
        onMatchFinishedRef.current(result);
      },
      onFrame: (timestampMs, simSteps, aiComputeMs) => {
        if (!debugModeRef.current) return;
        if (collector.recordFrame(timestampMs, simSteps, aiComputeMs)) {
          setPerfSnapshot(collector.getSnapshot(false));
        }
      },
    });

    hostRef.current = host;
    host.setDebugMode(debugModeRef.current);
    setPaused(false);
    if (debugModeRef.current) {
      setPerfSnapshot(collector.getSnapshot(false));
    }
    host.start();

    return () => {
      host.destroy();
      hostRef.current = null;
    };
  }, [game, snapshot]);

  // 开发者调试模式切换或暂停期间刷新内存快照（不额外启动 RAF，打开设置层时暂停轮询）
  useEffect(() => {
    hostRef.current?.setDebugMode(debugMode);
    const collector = perfCollectorRef.current;
    collector.resetTiming();
    if (!debugMode || settingsOverlayOpen) return;

    setPerfSnapshot(collector.getSnapshot(paused));
    if (!paused) return;

    const timerId = window.setInterval(() => {
      setPerfSnapshot(collector.getSnapshot(true));
    }, 1000);
    return () => window.clearInterval(timerId);
  }, [debugMode, paused, settingsOverlayOpen]);

  // 支持 F3 或 Ctrl/Cmd + Shift + D 快捷切换开发者性能监控（不影响玩家操作键）
  useEffect(() => {
    if (settingsOverlayOpen) return;
    const handleDebugShortcut = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      const isF3 = event.code === 'F3';
      const isCtrlShiftD =
        (event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'KeyD';
      if (isF3 || isCtrlShiftD) {
        event.preventDefault();
        onToggleDebugModeRef.current?.();
      }
    };
    window.addEventListener('keydown', handleDebugShortcut);
    return () => window.removeEventListener('keydown', handleDebugShortcut);
  }, [settingsOverlayOpen]);

  const handleResume = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    hostRef.current?.resume();
  };

  const handleTogglePause = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    hostRef.current?.togglePause('user');
  };

  const handleToggleMute = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const nextMuted = soundEngine.toggleMute();
    setMuted(nextMuted);
  };

  const handleCopyMapCode = () => {
    if (!hud?.mapCode) return;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(hud.mapCode).catch(() => {});
    }
    setCopiedCode(true);
    window.setTimeout(() => setCopiedCode(false), 1600);
  };

  const isMultiSeatArena = snapshot.players.length >= 3;
  const p1 = hud?.players[0];
  const p2 = hud?.players[1];
  const p1Config = snapshot.players[0];
  const p2Config = snapshot.players[1];
  const humanArenaConfigs = snapshot.players.filter((p) => p.controller !== 'ai');
  const isAiSpectate =
    snapshot.players.length > 0 &&
    snapshot.players.every((p) => p.controller === 'ai');
  const controlMode =
    snapshot.rules && typeof snapshot.rules === 'object'
      ? (snapshot.rules as Record<string, unknown>).controlMode
      : undefined;

  const isCompactMobile = isMobileOrTablet && logicalHeight <= 540;
  const primaryHumanConfig = humanArenaConfigs[0];
  const primaryHumanHud = primaryHumanConfig
    ? hud?.players.find((p) => p.slotId === primaryHumanConfig.slotId)
    : undefined;
  const primaryActiveItemKind =
    primaryHumanHud?.statusItems.find((item) => item.tone !== 'shield')?.iconKey ?? null;
  const showVirtualControls = isMobileOrTablet && Boolean(primaryHumanConfig) && !paused && !settingsOverlayOpen;

  const handleToggleFullscreen = () => {
    if (isFullscreen) {
      void exitFullscreen();
    } else {
      void requestLandscapeFullscreen();
    }
  };

  return (
    <div
      className={`h-full w-full overflow-hidden flex flex-col bg-[#E8E3D7] select-none ${
        settingsOverlayOpen ? 'hidden' : ''
      }`}
    >
      {/* 顶部外围状态栏：2 人模式保持经典双栏，3～8 席切换紧凑竞技场计分矩阵（绝不遮挡迷宫） */}
      <div
        className={`shrink-0 bg-[#FAF8F4] border-b border-[#CFC8B9] ${
          isCompactMobile ? 'px-2.5 py-1' : 'px-4 py-2'
        }`}
      >
        {isMultiSeatArena ? (
          <div
            data-testid="arena-scoreboard-matrix"
            className="max-w-[1440px] mx-auto space-y-2"
          >
            {/* 紧凑赛况控制条 */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 text-xs">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#222830] text-[#E9D5FF] text-[11px] font-bold whitespace-nowrap">
                  <Eye className="w-3 h-3 text-[#C084FC]" aria-hidden="true" />
                  AI 乱斗 · <span className="font-mono-num">{snapshot.players.length}</span> 席
                </span>
                <span className="font-bold text-[#1C2127] whitespace-nowrap">
                  第 <span className="font-mono-num">{hud?.roundNumber ?? 1}</span> 回合
                </span>
                <span className="text-[#6B7480] whitespace-nowrap">
                  先得 <span className="font-mono-num">{hud?.targetScore ?? 5}</span> 分
                </span>
                <span
                  className={`font-mono-num font-bold text-sm ${
                    hud?.roundTimeRemainingSeconds !== null &&
                    hud?.roundTimeRemainingSeconds !== undefined &&
                    hud.roundTimeRemainingSeconds <= 10
                      ? 'text-[#C93420]'
                      : 'text-[#262D35]'
                  }`}
                >
                  {hud?.roundTimeRemainingSeconds !== null &&
                  hud?.roundTimeRemainingSeconds !== undefined
                    ? formatClock(hud.roundTimeRemainingSeconds)
                    : formatClock(hud?.battleElapsedSeconds ?? 0)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {hud?.mapCode && (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={handleCopyMapCode}
                    title="点击复制本场地图编号"
                    className="inline-flex items-center gap-1 text-[11px] font-mono-num text-[#68717D] hover:text-[#1C2127] cursor-pointer"
                  >
                    <span className="truncate max-w-[150px]">{hud.mapCode}</span>
                    {copiedCode ? (
                      <Check className="w-3 h-3 text-[#1F8A5B] shrink-0" aria-hidden="true" />
                    ) : (
                      <Copy className="w-3 h-3 shrink-0" aria-hidden="true" />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={handleToggleMute}
                  aria-label={muted ? '开启音效' : '静音'}
                  title={muted ? '开启音效' : '静音'}
                  className="w-7 h-7 rounded-md border border-[#D4CEC0] bg-[#F3EFE6] hover:bg-[#E7E1D4] flex items-center justify-center text-[#2C333B] cursor-pointer"
                >
                  {muted ? (
                    <VolumeX className="w-3.5 h-3.5" aria-hidden="true" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                </button>
                {canRequestFullscreen && (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={handleToggleFullscreen}
                    aria-label={isFullscreen ? '退出全屏' : '全屏横屏'}
                    title={isFullscreen ? '退出全屏' : '全屏横屏'}
                    className="w-7 h-7 rounded-md border border-[#D4CEC0] bg-[#F3EFE6] hover:bg-[#E7E1D4] flex items-center justify-center text-[#2C333B] cursor-pointer"
                  >
                    {isFullscreen ? (
                      <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" />
                    ) : (
                      <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={handleTogglePause}
                  aria-label={paused ? '继续对战' : '暂停对战'}
                  title="暂停 / 继续（Esc）"
                  className="w-7 h-7 rounded-md border border-[#D4CEC0] bg-[#F3EFE6] hover:bg-[#E7E1D4] flex items-center justify-center text-[#2C333B] cursor-pointer"
                >
                  {paused ? (
                    <Play className="w-3.5 h-3.5" aria-hidden="true" />
                  ) : (
                    <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            {/* 3～8 席紧凑选手矩阵 */}
            <div
              className={`grid gap-2 ${
                snapshot.players.length <= 4
                  ? 'grid-cols-2 md:grid-cols-4'
                  : snapshot.players.length <= 6
                  ? 'grid-cols-3 md:grid-cols-6'
                  : 'grid-cols-4 md:grid-cols-8'
              }`}
            >
              {(hud?.players ?? []).map((entry) => {
                const cfg = snapshot.players.find((c) => c.slotId === entry.slotId);
                const runtime = botStatuses[entry.slotId];
                const isBoss =
                  cfg?.controller === 'ai' &&
                  cfg?.aiSource !== 'custom' &&
                  cfg?.aiModelId === 'hellbringer';
                const ammoPct = Math.round(
                  (entry.ammo / Math.max(1, entry.maxAmmo)) * 100
                );
                return (
                  <div
                    key={entry.slotId}
                    data-testid={`arena-hud-tile-${entry.slotId}`}
                    style={
                      isBoss && entry.alive
                        ? {
                            backgroundColor: BOSS_TIER_THEME.bgHex,
                            borderColor: BOSS_TIER_THEME.borderHex,
                          }
                        : undefined
                    }
                    className={`rounded-md border px-2 py-1.5 flex flex-col gap-1 min-w-0 transition-opacity ${
                      isBoss && entry.alive
                        ? 'text-[#FCE7F3]'
                        : entry.alive
                        ? 'bg-white border-[#D6D0C2]'
                        : 'bg-[#F0ECE2] border-[#DDD7C9] opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-[3px] shrink-0"
                          style={{
                            backgroundColor: entry.alive ? entry.colorHex : '#7D8590',
                          }}
                        />
                        <span
                          className={`text-[11px] font-bold truncate ${
                            isBoss && entry.alive ? 'text-[#FCE7F3]' : 'text-[#1C2127]'
                          }`}
                        >
                          {entry.displayName}
                        </span>
                      </div>
                      <span
                        className={`font-mono-num text-sm font-extrabold leading-none shrink-0 ${
                          isBoss && entry.alive ? 'text-[#FCE7F3]' : 'text-[#1C2127]'
                        }`}
                      >
                        {entry.score}
                      </span>
                    </div>

                    <div
                      className={`flex items-center justify-between gap-1 text-[10px] ${
                        isBoss && entry.alive ? 'text-[#E9B3C8]' : 'text-[#5D6672]'
                      }`}
                    >
                      <span className="truncate">
                        {cfg?.controller === 'human'
                          ? '玩家'
                          : cfg?.aiSource === 'custom'
                          ? `自定义 · ${cfg.aiModelName ?? 'Worker'}`
                          : isBoss
                          ? `Lv.5 · ${cfg?.aiModelName ?? '地狱使者'}`
                          : cfg?.aiModelName ?? 'AI'}
                      </span>
                      {!entry.alive ? (
                        <span className="text-[#9B2216] font-semibold shrink-0">淘汰</span>
                      ) : runtime && (runtime.state === 'timeout' || runtime.state === 'error') ? (
                        <span className="text-[#B3261E] font-semibold shrink-0">
                          {runtime.state === 'timeout' ? '超时隔离' : '脚本异常'}
                        </span>
                      ) : entry.statusItems[0] ? (
                        <span className="text-[#1F4E78] font-semibold shrink-0">
                          {entry.statusItems[0].label}
                        </span>
                      ) : (
                        <span className="font-mono-num shrink-0">
                          {entry.ammo}/{entry.maxAmmo}
                        </span>
                      )}
                    </div>

                    <div className="h-1 w-full rounded-full bg-[#E5DFD2] overflow-hidden">
                      <div
                        className="h-full"
                        style={{
                          width: `${ammoPct}%`,
                          backgroundColor: entry.alive ? entry.colorHex : '#98A0AA',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className={`max-w-[1440px] mx-auto grid grid-cols-12 items-center ${isCompactMobile ? 'gap-1.5' : 'gap-3'}`}>
            {/* P1 状态栏 */}
            <div className="col-span-5 min-w-0">
              {p1 && (
                <PlayerHudStrip
                  player={p1}
                  config={p1Config}
                  align="left"
                  compact={isCompactMobile}
                />
              )}
            </div>

          {/* 中央回合、时钟、地图编号与快捷工具 */}
          <div className="col-span-2 flex flex-col items-center justify-center text-center min-w-0">
            <div className="flex items-center gap-1.5">
              {isAiSpectate && (
                <span
                  data-testid="ai-spectate-badge"
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#222830] text-[#7DD3FC] text-[10px] font-bold whitespace-nowrap"
                >
                  <Eye className="w-2.5 h-2.5" aria-hidden="true" />
                  AI 观战
                </span>
              )}
              <span className="text-xs font-bold text-[#1C2127] whitespace-nowrap">
                第 {hud?.roundNumber ?? 1} 回合
              </span>
              <span className="text-[11px] text-[#6B7480] whitespace-nowrap">
                先得 {hud?.targetScore ?? 5} 分
              </span>
            </div>

            <div className="flex items-center gap-2 mt-0.5">
              <span
                className={`text-sm font-mono-num font-bold ${
                  hud?.roundTimeRemainingSeconds !== null &&
                  hud?.roundTimeRemainingSeconds !== undefined &&
                  hud.roundTimeRemainingSeconds <= 10
                    ? 'text-[#C93420]'
                    : 'text-[#262D35]'
                }`}
              >
                {hud?.roundTimeRemainingSeconds !== null &&
                hud?.roundTimeRemainingSeconds !== undefined
                  ? formatClock(hud.roundTimeRemainingSeconds)
                  : formatClock(hud?.battleElapsedSeconds ?? 0)}
              </span>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={handleToggleMute}
                  aria-label={muted ? '开启音效' : '静音'}
                  title={muted ? '开启音效' : '静音'}
                  className="w-7 h-7 rounded-md border border-[#D4CEC0] bg-[#F3EFE6] hover:bg-[#E7E1D4] flex items-center justify-center text-[#2C333B] cursor-pointer"
                >
                  {muted ? (
                    <VolumeX className="w-3.5 h-3.5" aria-hidden="true" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                </button>
                {canRequestFullscreen && (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={handleToggleFullscreen}
                    aria-label={isFullscreen ? '退出全屏' : '全屏横屏'}
                    title={isFullscreen ? '退出全屏' : '全屏横屏'}
                    className="w-7 h-7 rounded-md border border-[#D4CEC0] bg-[#F3EFE6] hover:bg-[#E7E1D4] flex items-center justify-center text-[#2C333B] cursor-pointer"
                  >
                    {isFullscreen ? (
                      <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" />
                    ) : (
                      <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={handleTogglePause}
                  aria-label={paused ? '继续对战' : '暂停对战'}
                  title="暂停 / 继续（Esc）"
                  className="w-7 h-7 rounded-md border border-[#D4CEC0] bg-[#F3EFE6] hover:bg-[#E7E1D4] flex items-center justify-center text-[#2C333B] cursor-pointer"
                >
                  {paused ? (
                    <Play className="w-3.5 h-3.5" aria-hidden="true" />
                  ) : (
                    <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            {hud?.mapCode && (
              <button
                type="button"
                tabIndex={-1}
                onClick={handleCopyMapCode}
                title="点击复制本场地图编号"
                className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-mono-num text-[#68717D] hover:text-[#1C2127] cursor-pointer"
              >
                <span className="truncate max-w-[140px]">{hud.mapCode}</span>
                {copiedCode ? (
                  <Check className="w-3 h-3 text-[#1F8A5B] shrink-0" aria-hidden="true" />
                ) : (
                  <Copy className="w-3 h-3 shrink-0" aria-hidden="true" />
                )}
              </button>
            )}
          </div>

          {/* P2 状态栏 */}
          <div className="col-span-5 min-w-0">
            {p2 && (
              <PlayerHudStrip
                player={p2}
                config={p2Config}
                align="right"
                compact={isCompactMobile}
              />
            )}
          </div>
        </div>
        )}
      </div>

      {/* 中央完整迷宫画布容器 */}
      <div className="relative flex-1 min-h-0 w-full">
        <canvas
          ref={canvasRef}
          data-testid="battle-canvas"
          className="absolute inset-0 block w-full h-full touch-game-surface"
        />

        {/* 左侧边栏：桌面端展示 P1 按键/AI 信息，移动端隐藏键盘提示避免遮挡摇杆 */}
        {(!isMobileOrTablet || debugMode) && (
          <div className="pointer-events-none absolute top-2.5 left-2 z-20 flex flex-col gap-2 w-[146px]">
            {!isMobileOrTablet && (
              !isMultiSeatArena && p1Config ? (
                p1Config.controller === 'ai' ? (
                  <MatchAiInfoCard
                    player={p1Config}
                    runtimeStatus={botStatuses[p1Config.slotId]}
                    testId="p1-ai-badge"
                  />
                ) : (
                  <MatchKeyHintCard
                    player={p1Config}
                    controlMode={controlMode}
                    testId="p1-key-hints"
                  />
                )
              ) : isMultiSeatArena && humanArenaConfigs[0] ? (
                <MatchKeyHintCard
                  player={humanArenaConfigs[0]}
                  controlMode={controlMode}
                  testId="p1-key-hints"
                />
              ) : null
            )}
            {debugMode && (
              <DevPerfOverlay
                embedded
                snapshot={perfSnapshot}
                onClose={() => onToggleDebugMode?.()}
              />
            )}
          </div>
        )}

        {/* 右侧边栏：桌面端展示 P2 按键/AI 信息，移动端隐藏以免干扰视口 */}
        {!isMobileOrTablet && (
          !isMultiSeatArena && p2Config ? (
            <div className="pointer-events-none absolute top-2.5 right-2 z-20 w-[146px]">
              {p2Config.controller === 'ai' ? (
                <MatchAiInfoCard
                  player={p2Config}
                  runtimeStatus={botStatuses[p2Config.slotId]}
                  testId="p2-ai-badge"
                />
              ) : (
                <MatchKeyHintCard
                  player={p2Config}
                  controlMode={controlMode}
                  testId="p2-key-hints"
                />
              )}
            </div>
          ) : isMultiSeatArena && humanArenaConfigs[1] ? (
            <div className="pointer-events-none absolute top-2.5 right-2 z-20 w-[146px]">
              <MatchKeyHintCard
                player={humanArenaConfigs[1]}
                controlMode={controlMode}
                testId="p2-key-hints"
              />
            </div>
          ) : null
        )}

        {/* 移动端单人虚拟摇杆与发射大按钮 */}
        {showVirtualControls && (
          <VirtualControls
            playerColorHex={primaryHumanConfig?.colorHex}
            activeItemKind={primaryActiveItemKind}
            opacityPercent={virtualControlsOpacity}
            onMoveStickChange={(x, y, mag) => hostRef.current?.setVirtualMoveStick(x, y, mag)}
            onFireChange={(pressed) => hostRef.current?.setVirtualFirePressed(pressed)}
          />
        )}

        {/* 回合开战 3-2-1 倒数层（不拦截输入，无 backdrop-blur） */}
        {!paused && hud?.phase === 'countdown' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="px-10 py-6 rounded-xl bg-[#222830]/92 border border-white/15 text-center shadow-xl">
              <div className="text-xs font-semibold text-[#B4BCC6] tracking-wide">
                第 {hud.roundNumber} 回合 · 准备开战
              </div>
              <div className="font-display text-6xl font-extrabold font-mono-num text-[#F7F4ED] mt-1 leading-none">
                {Math.max(1, Math.ceil(hud.countdownSeconds))}
              </div>
            </div>
          </div>
        )}

        {/* 回合结束结算横幅 */}
        {!paused && hud?.roundBanner && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="px-9 py-6 rounded-xl bg-[#FAF8F4]/95 border-2 border-[#222830] text-center shadow-xl min-w-[300px]">
              <div className="text-xs font-semibold text-[#646E7A]">
                第 {hud.roundBanner.roundNumber} 回合结束
              </div>
              <div
                className="font-display text-2xl font-extrabold mt-1"
                style={{
                  color: hud.roundBanner.winnerColor ?? '#1C2127',
                }}
              >
                {hud.roundBanner.reason}
              </div>
              <div className="text-xs font-mono-num text-[#5A6470] mt-2">
                {Math.max(1, Math.ceil(hud.roundBanner.nextRoundInSeconds))} 秒后进入下一回合
              </div>
            </div>
          </div>
        )}

        {/* 暂停模态框（无 backdrop-blur，支持移动端横屏滚动与虚拟按键透明度微调） */}
        {paused && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="对战已暂停"
            className="absolute inset-0 z-40 bg-[#1C2127]/60 flex items-center justify-center p-3 sm:p-6"
          >
            <div className="w-full max-w-sm max-h-[94%] overflow-y-auto bg-[#FAF8F4] border border-[#CFC8B9] rounded-xl shadow-2xl p-4 sm:p-6 space-y-4">
              <div>
                <p className="text-xs font-semibold text-[#646E7A]">
                  {pauseReason === 'background'
                    ? '页面切入后台已自动暂停'
                    : '计时与弹药补给均已冻结'}
                </p>
                <h2 className="font-display text-xl sm:text-2xl font-extrabold text-[#1C2127] mt-0.5">
                  对战已暂停
                </h2>
              </div>

              {hud && (
                <div className="grid grid-cols-2 gap-2.5 py-2.5 border-y border-[#E3DDD0]">
                  {hud.players.map((p) => (
                    <div key={p.slotId} className="flex items-center justify-between px-3 py-1.5 bg-[#F2EFE8] rounded-md">
                      <span className="flex items-center gap-1.5 text-xs font-bold text-[#1C2127] truncate">
                        <span
                          className="w-2.5 h-2.5 rounded-xs shrink-0"
                          style={{ backgroundColor: p.colorHex }}
                        />
                        {p.displayName}
                      </span>
                      <span className="font-mono-num text-base font-extrabold text-[#1C2127]">
                        {p.score}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {isMobileOrTablet && !isAiSpectate && (
                <div className="px-3 py-2.5 bg-[#F2EFE8] border border-[#DED8CA] rounded-lg space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-semibold text-[#2B323A]">
                    <span>虚拟按键透明度</span>
                    <span className="font-mono-num text-[#D9432B]">{virtualControlsOpacity}%</span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={80}
                    step={5}
                    value={virtualControlsOpacity}
                    onChange={(e) => setVirtualControlsOpacity(Number(e.target.value))}
                    aria-label="虚拟按键透明度"
                    className="w-full accent-[#D9432B] cursor-pointer"
                  />
                </div>
              )}

              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={handleResume}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold text-white bg-[#D9432B] hover:bg-[#BE3620] rounded-lg transition-colors cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                  继续对战（Esc）
                </button>
                <button
                  type="button"
                  onClick={onOpenSettingsFromPause}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-[#1C2127] bg-[#EAE5DA] hover:bg-[#DFD9CB] rounded-lg transition-colors cursor-pointer"
                >
                  <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
                  规则与按键设置（下场生效）
                </button>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={onExitToSetup}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#3B444F] bg-white hover:bg-[#F3EFE6] border border-[#D4CEC0] rounded-lg transition-colors cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                    返回赛前配置
                  </button>
                  <button
                    type="button"
                    onClick={onExitToLobby}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#3B444F] bg-white hover:bg-[#F3EFE6] border border-[#D4CEC0] rounded-lg transition-colors cursor-pointer"
                  >
                    <Home className="w-3.5 h-3.5" aria-hidden="true" />
                    返回大厅
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PlayerHudStrip({
  player,
  config,
  align,
  compact = false,
}: {
  player: PlayerHudEntry;
  config?: PlayerConfig;
  align: 'left' | 'right';
  compact?: boolean;
}) {
  const isRight = align === 'right';
  const showPips = player.maxAmmo <= 14;
  const isAi = config?.controller === 'ai';
  const isBoss =
    isAi && config?.aiSource !== 'custom' && config?.aiModelId === 'hellbringer';

  return (
    <div
      className={`flex items-center ${compact ? 'gap-2' : 'gap-3.5'} ${
        isRight ? 'flex-row-reverse text-right' : 'flex-row text-left'
      }`}
    >
      {/* 玩家颜色与得分大数字 */}
      <div
        className={`${
          compact ? 'w-9 h-9' : 'w-12 h-12'
        } rounded-lg flex flex-col items-center justify-center shrink-0 text-white shadow-xs`}
        style={{
          backgroundColor: player.alive ? player.colorHex : '#7D8590',
        }}
      >
        <span
          className={`${
            compact ? 'text-lg' : 'text-2xl'
          } font-display font-extrabold font-mono-num leading-none`}
        >
          {player.score}
        </span>
      </div>

      {/* 名称、弹药条与当前道具槽 */}
      <div className={`flex-1 min-w-0 ${compact ? 'space-y-0.5' : 'space-y-1.5'}`}>
        <div
          className={`flex items-center gap-2 ${
            isRight ? 'flex-row-reverse' : 'flex-row'
          }`}
        >
          <span className="text-sm font-bold text-[#1C2127] truncate">
            {player.displayName}
          </span>
          {isAi && (
            <span
              data-testid={isBoss ? `hud-boss-badge-${player.slotId}` : undefined}
              style={
                isBoss
                  ? {
                      backgroundColor: BOSS_TIER_THEME.bgHex,
                      borderColor: BOSS_TIER_THEME.borderHex,
                      color: BOSS_TIER_THEME.textHex,
                    }
                  : undefined
              }
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap shrink-0 border ${
                isBoss ? '' : 'bg-[#222830] border-transparent text-[#F5F2EB]'
              }`}
            >
              <Bot
                className="w-2.5 h-2.5"
                style={{ color: isBoss ? '#FB7185' : '#7DD3FC' }}
                aria-hidden="true"
              />
              {isBoss ? `Lv.5 · ${config?.aiModelName ?? '地狱使者'}` : config?.aiModelName ?? 'AI'}
            </span>
          )}
          <span className="text-xs font-mono-num font-semibold text-[#55606C] whitespace-nowrap">
            弹药 {player.ammo}/{player.maxAmmo}
          </span>
          {!player.alive && (
            <span className="text-xs font-semibold text-[#9B2216] whitespace-nowrap">
              已淘汰
            </span>
          )}
        </div>

        {/* 弹夹格子 + 补弹进度 */}
        <div
          className={`flex items-center gap-1 ${
            isRight ? 'justify-end' : 'justify-start'
          }`}
        >
          {showPips ? (
            Array.from({ length: player.maxAmmo }).map((_, idx) => {
              const filled = idx < player.ammo;
              const isReloadingPip = idx === player.ammo && player.reloadProgress > 0;
              return (
                <div
                  key={idx}
                  className="relative w-3.5 h-2 rounded-[2px] bg-[#E2DDD1] overflow-hidden border border-[#CFC8B9]"
                >
                  {filled && (
                    <div
                      className="absolute inset-0"
                      style={{ backgroundColor: player.colorHex }}
                    />
                  )}
                  {isReloadingPip && (
                    <div
                      className="absolute inset-y-0 left-0 opacity-60"
                      style={{
                        width: `${Math.round(player.reloadProgress * 100)}%`,
                        backgroundColor: player.colorHex,
                      }}
                    />
                  )}
                </div>
              );
            })
          ) : (
            <div className="w-36 h-2 rounded-sm bg-[#E2DDD1] overflow-hidden border border-[#CFC8B9]">
              <div
                className="h-full"
                style={{
                  width: `${Math.round((player.ammo / Math.max(1, player.maxAmmo)) * 100)}%`,
                  backgroundColor: player.colorHex,
                }}
              />
            </div>
          )}
        </div>

        {/* 护盾与当前持有道具状态（无圆胶囊堆叠，简洁战术指示条） */}
        <div
          className={`flex flex-wrap items-center gap-2 min-h-[20px] ${
            isRight ? 'justify-end' : 'justify-start'
          }`}
        >
          {player.statusItems.length === 0 ? (
            <span className="text-[11px] text-[#8E96A0]">无激活道具</span>
          ) : (
            player.statusItems.map((item) => {
              const accent =
                ITEM_ACCENT_COLORS[(item.iconKey as ItemKind) ?? 'shield'] ??
                ITEM_ACCENT_COLORS.shield;
              return (
                <div
                  key={item.id}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-semibold whitespace-nowrap"
                  style={{
                    backgroundColor: accent.bg,
                    borderColor: accent.border,
                    color: accent.fg,
                  }}
                >
                  {item.iconKey && (
                    <TankItemIcon kind={item.iconKey} className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span>{item.label}</span>
                  <span className="font-mono-num">{item.valueText}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function MatchAiInfoCard({
  player,
  runtimeStatus,
  testId,
}: {
  player: PlayerConfig;
  runtimeStatus?: BotRuntimeStatus;
  testId: string;
}) {
  const isCustom = player.aiSource === 'custom';
  const isBoss = !isCustom && player.aiModelId === 'hellbringer';
  const hasFault =
    runtimeStatus && (runtimeStatus.state === 'timeout' || runtimeStatus.state === 'error');

  return (
    <aside
      data-testid={testId}
      aria-label={`${player.displayName} AI 策略信息`}
      style={
        isBoss
          ? {
              backgroundColor: BOSS_TIER_THEME.bgHex,
              borderColor: BOSS_TIER_THEME.borderHex,
              color: BOSS_TIER_THEME.textHex,
            }
          : undefined
      }
      className={`w-full rounded-lg border px-2.5 py-2 shadow-xs space-y-1.5 ${
        isBoss ? '' : 'border-[#CFC8B9] bg-[#FAF8F4]/92 text-[#1C2127]'
      }`}
    >
      <div
        className={`flex items-center justify-between gap-1 pb-1 border-b ${
          isBoss ? 'border-[#5C1D3E]' : 'border-[#E5DFD3]'
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="w-2 h-2 rounded-[2px] shrink-0"
            style={{ backgroundColor: player.colorHex }}
            aria-hidden="true"
          />
          <span className="text-[11px] font-bold truncate">{player.displayName}</span>
        </div>
        <span
          className="text-[9px] font-bold whitespace-nowrap shrink-0"
          style={{ color: isBoss ? '#FB7185' : '#1F4E78' }}
        >
          {isCustom ? 'Worker AI' : isBoss ? 'BOSS Lv.5' : 'TS AI'}
        </span>
      </div>

      <div className="flex items-center gap-1.5 text-[11px] font-bold">
        <Bot
          className="w-3.5 h-3.5 shrink-0"
          style={{ color: isBoss ? '#FB7185' : '#222830' }}
          aria-hidden="true"
        />
        <span className="truncate">{player.aiModelName ?? '战术游击'}</span>
      </div>

      <div
        className={`text-[10px] leading-tight ${
          hasFault
            ? 'text-[#B3261E] font-semibold'
            : isBoss
            ? 'text-[#E9B3C8]'
            : 'text-[#68717D]'
        }`}
      >
        {hasFault
          ? runtimeStatus.state === 'timeout'
            ? `超时强杀(${runtimeStatus.timeoutCount}) · 冷却重启`
            : '脚本报错 · 已隔离'
          : isCustom && runtimeStatus && runtimeStatus.avgMs > 0
          ? `沙箱运行 · ${runtimeStatus.avgMs.toFixed(1)}ms`
          : isBoss
          ? '5次弹道攻防 · 全段激光'
          : '自主寻路 · 弹道预判'}
      </div>
    </aside>
  );
}

function MatchKeyHintCard({
  player,
  controlMode,
  testId,
}: {
  player: PlayerConfig;
  controlMode?: unknown;
  testId: string;
}) {
  const hint = buildCompactMatchKeyHint(player, controlMode);

  return (
    <aside
      data-testid={testId}
      aria-label={`${player.displayName} 按键提示`}
      className="w-full rounded-lg border border-[#CFC8B9] bg-[#FAF8F4]/92 px-2.5 py-2 shadow-xs text-[#1C2127]"
    >
      {/* 标题行：色块 + 玩家名 + 操控说明 */}
      <div className="flex items-center justify-between gap-1 pb-1.5 border-b border-[#E5DFD3]">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="w-2 h-2 rounded-[2px] shrink-0"
            style={{ backgroundColor: player.colorHex }}
            aria-hidden="true"
          />
          <span className="text-[11px] font-bold truncate">{player.displayName}</span>
        </div>
        <span className="text-[9px] font-semibold text-[#68717D] whitespace-nowrap shrink-0">
          {hint.moveModeLabel}
        </span>
      </div>

      {/* 迷你倒 T 方向键区 */}
      <div className="mt-1.5 flex flex-col items-center gap-1">
        <KeyHintCap label={hint.upKey} accentHex={player.colorHex} />
        <div className="grid grid-cols-3 gap-1 w-full">
          <KeyHintCap label={hint.leftKey} accentHex={player.colorHex} fullWidth />
          <KeyHintCap label={hint.downKey} accentHex={player.colorHex} fullWidth />
          <KeyHintCap label={hint.rightKey} accentHex={player.colorHex} fullWidth />
        </div>
      </div>

      {/* 开火键行 */}
      <div className="mt-1.5 pt-1.5 border-t border-[#E5DFD3] flex items-center justify-between gap-1.5">
        <span className="text-[10px] font-semibold text-[#55606C] shrink-0">开火</span>
        <span
          className="inline-flex items-center justify-center min-w-[44px] max-w-[82px] px-1.5 py-0.5 rounded border text-[10px] font-mono-num font-bold truncate shadow-[0_1px_0_rgba(0,0,0,0.18)] text-white"
          style={{
            backgroundColor: player.colorHex,
            borderColor: 'rgba(28,33,39,0.22)',
          }}
        >
          {hint.fireKey}
        </span>
      </div>
    </aside>
  );
}

function KeyHintCap({
  label,
  accentHex,
  fullWidth = false,
}: {
  label: string;
  accentHex: string;
  fullWidth?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center justify-center h-[21px] px-1 rounded border border-[#CBC3B3] bg-white text-[10px] font-mono-num font-bold text-[#1C2127] shadow-[0_1px_0_#C4BCA9] truncate ${
        fullWidth ? 'w-full' : 'min-w-[38px]'
      }`}
      style={{ borderBottomColor: accentHex }}
    >
      {label}
    </span>
  );
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}
