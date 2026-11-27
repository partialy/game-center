import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import {
  ArrowLeft,
  Bot,
  Check,
  Copy,
  Eye,
  Gamepad2,
  LogOut,
  Maximize2,
  Minimize2,
  Move,
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
import { MobileArenaHud } from './MobileArenaHud';
import { VirtualControls } from './VirtualControls';
import { VirtualGamepadAbxy } from './VirtualGamepadAbxy';
import { AppSlider } from './heroUiHelpers';
import { ITEM_ACCENT_COLORS, TankItemIcon } from '../../games/tank-battle/ui/itemIcons';
import type { ItemKind } from '../../games/tank-battle/types';
import type { StickmanDuelSession } from '../../games/stickman-duel/simulation/world';
import type { StickmanTrainingState } from '../../games/stickman-duel/types';
import { StickmanTrainingConsole } from '../../games/stickman-duel/ui/StickmanTrainingConsole';

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
 * - 上方为全宽迷宫画布，桌面端零悬浮按键卡片遮挡，仅在调试模式显示性能叠加层
 * - 桌面端底部为单行紧凑状态底栏，将双方比分、弹夹、道具、按键/AI 信息与回合工具融为一体
 * - 移动端/平板沿用 MobileArenaHud 边缘悬浮 HUD 与 VirtualControls 虚拟摇杆
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
    virtualControlsOpacity,
    setVirtualControlsOpacity,
    fireButtonPos,
    setFireButtonPos,
    isFullscreen,
    canRequestFullscreen,
    requestLandscapeFullscreen,
    exitFullscreen,
  } = useMobileViewport();
  const [editingFireLayout, setEditingFireLayout] = useState(false);
  const [desktopGamepadEnabled, setDesktopGamepadEnabled] = useState(false);

  const onMatchFinishedRef = useRef(onMatchFinished);
  onMatchFinishedRef.current = onMatchFinished;
  const onPausedStateChangeRef = useRef(onPausedStateChange);
  onPausedStateChangeRef.current = onPausedStateChange;
  const debugModeRef = useRef(debugMode);
  debugModeRef.current = debugMode;
  const onToggleDebugModeRef = useRef(onToggleDebugMode);
  onToggleDebugModeRef.current = onToggleDebugMode;

  const [hud, setHud] = useState<HudState | null>(null);
  const [trainingState, setTrainingState] = useState<StickmanTrainingState | null>(null);
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
      onHudUpdate: (nextHud) => {
        setHud(nextHud);
        if (snapshot.trainingMode && game.id === 'stickman-duel') {
          const stickSession = host.getSession() as unknown as StickmanDuelSession;
          setTrainingState(stickSession.getTrainingState());
        }
      },
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
    if (snapshot.trainingMode && game.id === 'stickman-duel') {
      const stickSession = host.getSession() as unknown as StickmanDuelSession;
      setTrainingState(stickSession.getTrainingState());
    } else {
      setTrainingState(null);
    }
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

  const primaryHumanConfig = humanArenaConfigs[0];
  const primaryHumanHud = primaryHumanConfig
    ? hud?.players.find((p) => p.slotId === primaryHumanConfig.slotId)
    : undefined;
  const primaryActiveItemKind =
    primaryHumanHud?.statusItems.find((item) => item.tone !== 'shield')?.iconKey ?? null;
  const isAbxyGamepadGame = game.virtualGamepadLayout === 'abxy';
  const showTankVirtualControls =
    !isAbxyGamepadGame &&
    isMobileOrTablet &&
    Boolean(primaryHumanConfig) &&
    !settingsOverlayOpen &&
    (!paused || editingFireLayout);
  const showAbxyGamepad =
    isAbxyGamepadGame &&
    (isMobileOrTablet || desktopGamepadEnabled) &&
    Boolean(primaryHumanConfig) &&
    !settingsOverlayOpen &&
    !paused;

  useEffect(() => {
    if (!paused || settingsOverlayOpen) {
      setEditingFireLayout(false);
    }
  }, [paused, settingsOverlayOpen]);

  const handleToggleFullscreen = () => {
    if (isFullscreen) {
      void exitFullscreen();
    } else {
      void requestLandscapeFullscreen();
    }
  };

  const clockWarning =
    hud?.roundTimeRemainingSeconds !== null &&
    hud?.roundTimeRemainingSeconds !== undefined &&
    hud.roundTimeRemainingSeconds <= 10;
  const clockText =
    hud?.roundTimeRemainingSeconds !== null &&
    hud?.roundTimeRemainingSeconds !== undefined
      ? formatClock(hud.roundTimeRemainingSeconds)
      : formatClock(hud?.battleElapsedSeconds ?? 0);

  const isTrainingMode = Boolean(snapshot.trainingMode && game.id === 'stickman-duel');
  const runTrainingAction = (action: (session: StickmanDuelSession) => void) => {
    const host = hostRef.current;
    if (!host || !isTrainingMode) return;
    const stickSession = host.getSession() as unknown as StickmanDuelSession;
    action(stickSession);
    setTrainingState(stickSession.getTrainingState());
    host.syncHudNow();
  };

  return (
    <div
      className={`h-full w-full overflow-hidden flex flex-col bg-[var(--background)] text-[var(--foreground)] select-none ${
        settingsOverlayOpen ? 'hidden' : ''
      }`}
    >
      {/* 火柴人专项练习顶栏控制台（锚定于画布上方，绝不遮挡战斗视野） */}
      {isTrainingMode && trainingState && (
        <StickmanTrainingConsole
          state={trainingState}
          paused={paused}
          compactDefault={isMobileOrTablet}
          onSelectDrill={(drill) => runTrainingAction((s) => s.setTrainingDrill(drill))}
          onUpdateConfig={(patch) => runTrainingAction((s) => s.updateTrainingConfig(patch))}
          onDispenseItem={(kind, mode) =>
            runTrainingAction((s) => s.dispenseTrainingItem(kind, mode))
          }
          onClearPickups={() => runTrainingAction((s) => s.clearTrainingPickups())}
          onTriggerVolley={() => runTrainingAction((s) => s.triggerTrainingVolley())}
          onResetArena={() => runTrainingAction((s) => s.resetTrainingArena(true))}
        />
      )}

      {/* 主战迷宫画布区域（桌面端无顶部栏和侧边悬浮卡片遮挡） */}
      <div className="relative flex-1 min-h-0 w-full">
        <canvas
          ref={canvasRef}
          data-testid="battle-canvas"
          className="absolute inset-0 block w-full h-full touch-game-surface"
        />

        {/* 仅开发者调试模式显示性能监控浮层 */}
        {debugMode && (
          <div className="pointer-events-none absolute top-2.5 left-2.5 z-20 w-[156px]">
            <DevPerfOverlay
              embedded
              snapshot={perfSnapshot}
              onClose={() => onToggleDebugMode?.()}
            />
          </div>
        )}

        {/* 移动端边缘悬浮 HUD（顶部居中时间/工具+比分，最边缘弹药道具，左下回合，右下地图ID） */}
        {isMobileOrTablet && (
          <MobileArenaHud
            hud={hud}
            snapshot={snapshot as MatchLaunchSnapshot<unknown>}
            botStatuses={botStatuses}
            isMultiSeatArena={isMultiSeatArena}
            isAiSpectate={isAiSpectate}
            paused={paused}
            muted={muted}
            copiedCode={copiedCode}
            isFullscreen={isFullscreen}
            canRequestFullscreen={canRequestFullscreen}
            editingLayout={editingFireLayout}
            onToggleMute={handleToggleMute}
            onToggleFullscreen={handleToggleFullscreen}
            onTogglePause={handleTogglePause}
            onCopyMapCode={handleCopyMapCode}
          />
        )}

        {/* 移动端单人虚拟摇杆与可调位置开火大按钮（坦克大战） */}
        {showTankVirtualControls && (
          <VirtualControls
            playerColorHex={primaryHumanConfig?.colorHex}
            activeItemKind={primaryActiveItemKind}
            opacityPercent={virtualControlsOpacity}
            fireButtonPos={fireButtonPos}
            editingLayout={editingFireLayout}
            onMoveStickChange={(x, y, mag) => hostRef.current?.setVirtualMoveStick(x, y, mag)}
            onFireChange={(pressed) => hostRef.current?.setVirtualFirePressed(pressed)}
            onFireButtonPosChange={setFireButtonPos}
            onResetFireButtonPos={() => setFireButtonPos(null)}
            onDoneEditingLayout={() => setEditingFireLayout(false)}
          />
        )}

        {/* 火柴人决斗专属：左摇杆 + 右 ABXY 手柄虚拟按键层（移动端默认开启，桌面端可随时切换） */}
        {showAbxyGamepad && (
          <VirtualGamepadAbxy
            playerColorHex={primaryHumanConfig?.colorHex}
            weaponKind={primaryHumanHud?.weaponKind ?? null}
            weaponLabel={primaryHumanHud?.weaponLabel}
            weaponCount={primaryHumanHud?.weaponCount}
            nearbyPickupLabel={primaryHumanHud?.nearbyPickupLabel ?? null}
            opacityPercent={isMobileOrTablet ? virtualControlsOpacity : Math.max(55, virtualControlsOpacity)}
            onMoveStickChange={(x, y, mag) => hostRef.current?.setVirtualMoveStick(x, y, mag)}
            onActionChange={(actionId, pressed) =>
              hostRef.current?.setVirtualActionPressed(actionId, pressed, false)
            }
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
            <div className="px-9 py-6 rounded-2xl bg-[var(--overlay)]/95 border-2 border-[var(--border)] text-center shadow-xl min-w-[300px]">
              <div className="text-xs font-semibold text-[var(--muted)]">
                第 {hud.roundBanner.roundNumber} 回合结束
              </div>
              <div
                className="font-display text-2xl font-extrabold mt-1"
                style={{
                  color: hud.roundBanner.winnerColor ?? 'var(--foreground)',
                }}
              >
                {hud.roundBanner.reason}
              </div>
              <div className="text-xs font-mono-num text-[var(--muted)] mt-2">
                {Math.max(1, Math.ceil(hud.roundBanner.nextRoundInSeconds))} 秒后进入下一回合
              </div>
            </div>
          </div>
        )}

        {/* 暂停模态框（居中标题 + 得分 + 主继续按钮 + 一行三图标按钮：返回/设置/退出） */}
        {paused && !editingFireLayout && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="已暂停"
            className="absolute inset-0 z-40 bg-black/60 flex items-center justify-center p-3 sm:p-6"
          >
            <div className="w-full max-w-sm max-h-[94%] overflow-y-auto bg-[var(--overlay)] border border-[var(--border)] text-[var(--foreground)] rounded-2xl shadow-2xl p-5 sm:p-6 space-y-4">
              <div className="text-center space-y-1">
                <h2 className="font-display text-2xl font-extrabold text-[var(--foreground)]">
                  {isTrainingMode ? '练习已暂停' : '已暂停'}
                </h2>
                <p className="text-xs text-[var(--muted)]">
                  {pauseReason === 'background'
                    ? '页面切入后台已自动暂停'
                    : isTrainingMode
                    ? '道场模拟与发球机已冻结'
                    : '计时与弹药补给均已冻结'}
                </p>
              </div>

              {hud && (
                <div className="grid grid-cols-2 gap-2 py-2.5 border-y border-[var(--separator)]">
                  {hud.players.map((p) => (
                    <div
                      key={p.slotId}
                      className="flex items-center justify-between px-3 py-1.5 bg-[var(--surface-secondary)] rounded-lg"
                    >
                      <span className="flex items-center gap-1.5 text-xs font-bold text-[var(--foreground)] truncate">
                        <span
                          className="w-2.5 h-2.5 rounded-xs shrink-0"
                          style={{ backgroundColor: p.colorHex }}
                        />
                        {p.displayName}
                      </span>
                      <span className="font-mono-num text-base font-extrabold text-[var(--foreground)]">
                        {p.score}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {(isMobileOrTablet || isAbxyGamepadGame) && !isAiSpectate && (
                <div className="px-3.5 py-3 bg-[var(--surface-secondary)] border border-[var(--border)] rounded-xl space-y-3">
                  {isAbxyGamepadGame && !isMobileOrTablet && (
                    <Button
                      variant={desktopGamepadEnabled ? 'primary' : 'secondary'}
                      size="sm"
                      fullWidth
                      onPress={() => setDesktopGamepadEnabled((v) => !v)}
                      className={`min-h-[40px] font-semibold !rounded-full ${
                        desktopGamepadEnabled ? 'accent-solid-btn' : ''
                      }`}
                    >
                      <Gamepad2 className="w-4 h-4" aria-hidden="true" />
                      {desktopGamepadEnabled ? '关闭虚拟手柄（ABXY）' : '开启虚拟手柄模式（ABXY）'}
                    </Button>
                  )}
                  <AppSlider
                    label="虚拟按键透明度"
                    value={virtualControlsOpacity}
                    min={10}
                    max={80}
                    step={5}
                    unit="%"
                    onChange={setVirtualControlsOpacity}
                  />
                  {!isAbxyGamepadGame && isMobileOrTablet && (
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth
                      onPress={() => setEditingFireLayout(true)}
                      className="min-h-[42px] font-semibold !rounded-full"
                    >
                      <Move className="w-3.5 h-3.5 text-[var(--accent)]" aria-hidden="true" />
                      拖动调整开火按钮位置
                    </Button>
                  )}
                </div>
              )}

              <div className="space-y-2.5">
                <Button
                  variant="primary"
                  size="md"
                  fullWidth
                  onPress={handleResume}
                  className="min-h-[44px] font-bold !rounded-full accent-solid-btn"
                >
                  <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                  继续对战（Esc）
                </Button>

                <div className="grid grid-cols-3 gap-2 pt-0.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth
                    data-testid="pause-return-setup-btn"
                    onPress={onExitToSetup}
                    className="min-h-[40px] !rounded-full font-semibold"
                  >
                    <ArrowLeft className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    返回
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth
                    data-testid="pause-settings-btn"
                    onPress={onOpenSettingsFromPause}
                    className="min-h-[40px] !rounded-full font-semibold"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    设置
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth
                    data-testid="pause-exit-lobby-btn"
                    onPress={onExitToLobby}
                    className="min-h-[40px] !rounded-full font-semibold"
                  >
                    <LogOut className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    退出
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 桌面端单行紧凑底部 HUD（吞并按键提示、AI 状态、比分弹药道具与回合工具） */}
      {!isMobileOrTablet && (
        <footer
          data-testid="desktop-bottom-hud"
          className="shrink-0 bg-[var(--surface)] border-t border-[var(--border)] px-3 py-1.5"
        >
          {isMultiSeatArena ? (
            <div
              data-testid="arena-scoreboard-matrix"
              className="max-w-[1440px] mx-auto flex items-center gap-2.5 min-h-[46px]"
            >
              {/* 左侧横排 3～8 席迷你条 */}
              <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto">
                {(hud?.players ?? []).map((entry) => {
                  const cfg = snapshot.players.find((c) => c.slotId === entry.slotId);
                  const runtime = botStatuses[entry.slotId];
                  const isBoss =
                    cfg?.controller === 'ai' &&
                    cfg?.aiSource !== 'custom' &&
                    cfg?.aiModelId === 'hellbringer';
                  const isHpGame = entry.maxHp !== undefined;
                  const barPct = isHpGame
                    ? Math.round(((entry.hp ?? 0) / Math.max(1, entry.maxHp ?? 100)) * 100)
                    : Math.round((entry.ammo / Math.max(1, entry.maxAmmo)) * 100);
                  const hpBarColor =
                    barPct > 55 ? '#22C55E' : barPct > 28 ? '#F59E0B' : '#EF4444';
                  const humanKeyHint =
                    cfg?.controller === 'human'
                      ? buildCompactMatchKeyHint(cfg, controlMode)
                      : null;

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
                      className={`flex-1 min-w-[110px] max-w-[190px] rounded-lg border px-2 py-1 flex flex-col gap-0.5 transition-opacity ${
                        isBoss && entry.alive
                          ? 'text-[#FCE7F3]'
                          : entry.alive
                          ? 'bg-[var(--surface-secondary)]/70 border-[var(--border)]'
                          : 'bg-[var(--surface-secondary)]/35 border-[var(--border)] opacity-55'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1 min-w-0">
                          <span
                            className="w-2 h-2 rounded-[2px] shrink-0"
                            style={{
                              backgroundColor: entry.alive ? entry.colorHex : '#7D8590',
                            }}
                          />
                          <span
                            className={`text-[11px] font-bold truncate ${
                              isBoss && entry.alive ? 'text-[#FCE7F3]' : 'text-[var(--foreground)]'
                            }`}
                          >
                            {entry.displayName}
                          </span>
                        </div>
                        <span
                          className={`font-mono-num text-xs font-extrabold leading-none shrink-0 ${
                            isBoss && entry.alive ? 'text-[#FCE7F3]' : 'text-[var(--foreground)]'
                          }`}
                        >
                          {entry.score}
                        </span>
                      </div>

                      <div
                        className={`flex items-center justify-between gap-1 text-[10px] leading-tight ${
                          isBoss && entry.alive ? 'text-[#E9B3C8]' : 'text-[var(--muted)]'
                        }`}
                      >
                        <span className="truncate font-mono-num">
                          {humanKeyHint
                            ? humanKeyHint.isFighter
                              ? `${humanKeyHint.leftKey}${humanKeyHint.rightKey}·${humanKeyHint.fireKey}/${humanKeyHint.kickKey}/${humanKeyHint.jumpKey}`
                              : `${humanKeyHint.upKey}${humanKeyHint.leftKey}${humanKeyHint.downKey}${humanKeyHint.rightKey}·${humanKeyHint.fireKey}`
                            : cfg?.aiSource === 'custom'
                            ? cfg.aiModelName ?? 'Worker'
                            : isBoss
                            ? 'Lv.5 Boss'
                            : cfg?.aiModelName ?? 'AI'}
                        </span>
                        {!entry.alive ? (
                          <span className="text-red-500 font-semibold shrink-0">淘汰</span>
                        ) : runtime && (runtime.state === 'timeout' || runtime.state === 'error') ? (
                          <span className="text-red-500 font-semibold shrink-0">异常</span>
                        ) : isHpGame ? (
                          <span className="font-mono-num shrink-0 font-semibold">
                            {entry.weaponLabel && entry.weaponKind
                              ? `${entry.weaponLabel}${entry.weaponCount ?? ''} · `
                              : ''}
                            {entry.hp ?? 0}HP
                          </span>
                        ) : entry.statusItems[0] ? (
                          <span className="text-[var(--accent)] font-semibold shrink-0 truncate max-w-[54px]">
                            {entry.statusItems[0].label}
                          </span>
                        ) : (
                          <span className="font-mono-num shrink-0">
                            {entry.ammo}/{entry.maxAmmo}
                          </span>
                        )}
                      </div>

                      <div className="h-1 w-full rounded-full bg-[var(--border)] overflow-hidden">
                        <div
                          className="h-full"
                          style={{
                            width: `${barPct}%`,
                            backgroundColor: !entry.alive
                              ? '#98A0AA'
                              : isHpGame
                              ? hpBarColor
                              : entry.colorHex,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 右侧锚定时间、回合、地图编号与工具按钮 */}
              <div className="shrink-0 flex items-center gap-2 pl-2.5 border-l border-[var(--separator)]">
                <div className="flex flex-col items-end leading-tight">
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="inline-flex items-center gap-1 text-[var(--accent)] font-bold whitespace-nowrap">
                      <Eye className="w-3 h-3" aria-hidden="true" />
                      {snapshot.players.length}席
                    </span>
                    <span className="font-bold text-[var(--foreground)] whitespace-nowrap">
                      R{hud?.roundNumber ?? 1}
                    </span>
                    <span className="text-[var(--muted)] whitespace-nowrap">
                      /{hud?.targetScore ?? 5}分
                    </span>
                    <span
                      className={`font-mono-num font-bold text-xs ${
                        clockWarning ? 'text-red-600 dark:text-red-400' : 'text-[var(--foreground)]'
                      }`}
                    >
                      {clockText}
                    </span>
                  </div>
                  {hud?.mapCode && (
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={handleCopyMapCode}
                      title="点击复制本场地图编号"
                      className="inline-flex items-center gap-1 text-[10px] font-mono-num text-[var(--muted)] hover:text-[var(--foreground)] cursor-pointer mt-0.5"
                    >
                      <span className="truncate max-w-[116px]">{hud.mapCode}</span>
                      {copiedCode ? (
                        <Check className="w-2.5 h-2.5 text-emerald-500 shrink-0" aria-hidden="true" />
                      ) : (
                        <Copy className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                      )}
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  {isAbxyGamepadGame && Boolean(primaryHumanConfig) && (
                    <Button
                      variant={desktopGamepadEnabled ? 'primary' : 'secondary'}
                      size="sm"
                      isIconOnly
                      data-testid="toggle-virtual-gamepad-btn"
                      onPress={() => setDesktopGamepadEnabled((v) => !v)}
                      aria-label={desktopGamepadEnabled ? '关闭虚拟手柄' : '开启虚拟手柄'}
                      className={`!w-8 !h-8 !min-w-[32px] !p-0 !rounded-full ${
                        desktopGamepadEnabled ? 'accent-solid-btn' : ''
                      }`}
                    >
                      <Gamepad2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    isIconOnly
                    onPress={handleToggleMute}
                    aria-label={muted ? '开启音效' : '静音'}
                    className="!w-8 !h-8 !min-w-[32px] !p-0 !rounded-full"
                  >
                    {muted ? (
                      <VolumeX className="w-3.5 h-3.5" aria-hidden="true" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                  </Button>
                  {canRequestFullscreen && (
                    <Button
                      variant="secondary"
                      size="sm"
                      isIconOnly
                      onPress={handleToggleFullscreen}
                      aria-label={isFullscreen ? '退出全屏' : '全屏横屏'}
                      className="!w-8 !h-8 !min-w-[32px] !p-0 !rounded-full"
                    >
                      {isFullscreen ? (
                        <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" />
                      ) : (
                        <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    isIconOnly
                    onPress={handleTogglePause}
                    aria-label={paused ? '继续对战' : '暂停对战'}
                    className="!w-8 !h-8 !min-w-[32px] !p-0 !rounded-full"
                  >
                    {paused ? (
                      <Play className="w-3.5 h-3.5" aria-hidden="true" />
                    ) : (
                      <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-[1440px] mx-auto grid grid-cols-12 items-center gap-2 min-h-[46px]">
              {/* 左侧 P1 紧凑信息（得分 + 名称 + 按键/AI + 弹药 + 激活道具） */}
              <div className="col-span-5 min-w-0">
                {p1 && (
                  <BottomPlayerHudStrip
                    player={p1}
                    config={p1Config}
                    runtimeStatus={p1Config ? botStatuses[p1Config.slotId] : undefined}
                    controlMode={controlMode}
                    align="left"
                    slotPrefix="p1"
                    isTrainingMode={isTrainingMode}
                    trainingDrill={trainingState?.drill}
                  />
                )}
              </div>

              {/* 中央紧凑回合、时钟、地图码与工具图标 */}
              <div className="col-span-2 flex flex-col items-center justify-center text-center min-w-0 gap-0.5">
                <div className="flex items-center justify-center gap-1.5 leading-none">
                  {isAiSpectate && (
                    <span
                      data-testid="ai-spectate-badge"
                      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-[#222830] text-[#7DD3FC] text-[10px] font-bold whitespace-nowrap"
                    >
                      <Eye className="w-2.5 h-2.5" aria-hidden="true" />
                      观战
                    </span>
                  )}
                  <span className="text-[11px] font-bold text-[var(--foreground)] whitespace-nowrap">
                    {isTrainingMode ? '练习道场' : `第 ${hud?.roundNumber ?? 1} 回合`}
                  </span>
                  {!isTrainingMode && (
                    <span className="text-[10px] text-[var(--muted)] whitespace-nowrap">
                      /{hud?.targetScore ?? 5}分
                    </span>
                  )}
                  <span
                    className={`text-xs font-mono-num font-extrabold ${
                      clockWarning ? 'text-red-600 dark:text-red-400' : 'text-[var(--foreground)]'
                    }`}
                  >
                    {clockText}
                  </span>
                </div>

                <div className="flex items-center justify-center gap-1.5">
                  {hud?.mapCode && (
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={handleCopyMapCode}
                      title="点击复制本场地图编号"
                      className="inline-flex items-center gap-1 text-[10px] font-mono-num text-[var(--muted)] hover:text-[var(--foreground)] cursor-pointer"
                    >
                      <span className="truncate max-w-[92px]">{hud.mapCode}</span>
                      {copiedCode ? (
                        <Check className="w-2.5 h-2.5 text-emerald-500 shrink-0" aria-hidden="true" />
                      ) : (
                        <Copy className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                      )}
                    </button>
                  )}
                  <div className="flex items-center gap-1">
                    {isAbxyGamepadGame && Boolean(primaryHumanConfig) && (
                      <Button
                        variant={desktopGamepadEnabled ? 'primary' : 'secondary'}
                        size="sm"
                        isIconOnly
                        data-testid="toggle-virtual-gamepad-btn"
                        onPress={() => setDesktopGamepadEnabled((v) => !v)}
                        aria-label={desktopGamepadEnabled ? '关闭虚拟手柄' : '开启虚拟手柄'}
                        className={`!w-7 !h-7 !min-w-[28px] !p-0 !rounded-full ${
                          desktopGamepadEnabled ? 'accent-solid-btn' : ''
                        }`}
                      >
                        <Gamepad2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      isIconOnly
                      onPress={handleToggleMute}
                      aria-label={muted ? '开启音效' : '静音'}
                      className="!w-7 !h-7 !min-w-[28px] !p-0 !rounded-full"
                    >
                      {muted ? (
                        <VolumeX className="w-3 h-3" aria-hidden="true" />
                      ) : (
                        <Volume2 className="w-3 h-3" aria-hidden="true" />
                      )}
                    </Button>
                    {canRequestFullscreen && (
                      <Button
                        variant="secondary"
                        size="sm"
                        isIconOnly
                        onPress={handleToggleFullscreen}
                        aria-label={isFullscreen ? '退出全屏' : '全屏横屏'}
                        className="!w-7 !h-7 !min-w-[28px] !p-0 !rounded-full"
                      >
                        {isFullscreen ? (
                          <Minimize2 className="w-3 h-3" aria-hidden="true" />
                        ) : (
                          <Maximize2 className="w-3 h-3" aria-hidden="true" />
                        )}
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      isIconOnly
                      onPress={handleTogglePause}
                      aria-label={paused ? '继续对战' : '暂停对战'}
                      className="!w-7 !h-7 !min-w-[28px] !p-0 !rounded-full"
                    >
                      {paused ? (
                        <Play className="w-3 h-3" aria-hidden="true" />
                      ) : (
                        <Pause className="w-3 h-3" aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* 右侧 P2 紧凑信息（镜像） */}
              <div className="col-span-5 min-w-0">
                {p2 && (
                  <BottomPlayerHudStrip
                    player={p2}
                    config={p2Config}
                    runtimeStatus={p2Config ? botStatuses[p2Config.slotId] : undefined}
                    controlMode={controlMode}
                    align="right"
                    slotPrefix="p2"
                    isTrainingMode={isTrainingMode}
                    trainingDrill={trainingState?.drill}
                  />
                )}
              </div>
            </div>
          )}
        </footer>
      )}
    </div>
  );
}

function BottomPlayerHudStrip({
  player,
  config,
  runtimeStatus,
  controlMode,
  align,
  slotPrefix,
  isTrainingMode = false,
  trainingDrill,
}: {
  player: PlayerHudEntry;
  config?: PlayerConfig;
  runtimeStatus?: BotRuntimeStatus;
  controlMode?: unknown;
  align: 'left' | 'right';
  slotPrefix: 'p1' | 'p2';
  isTrainingMode?: boolean;
  trainingDrill?: string;
}) {
  const isRight = align === 'right';
  const showPips = player.maxAmmo <= 12;
  const isTrainingDummy = Boolean(isTrainingMode && slotPrefix === 'p2');
  const isAi = config?.controller === 'ai';
  const isCustom = isAi && config?.aiSource === 'custom';
  const isBoss = isAi && !isCustom && config?.aiModelId === 'hellbringer';
  const hasFault =
    runtimeStatus && (runtimeStatus.state === 'timeout' || runtimeStatus.state === 'error');
  const keyHint =
    !isAi && !isTrainingDummy && config ? buildCompactMatchKeyHint(config, controlMode) : null;

  return (
    <div
      className={`flex items-center gap-2.5 min-w-0 ${
        isRight ? 'flex-row-reverse text-right' : 'flex-row text-left'
      }`}
    >
      {/* 紧凑得分方块（练习模式下展示道场/不死标识） */}
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-white shadow-xs"
        style={{
          backgroundColor: player.alive ? player.colorHex : '#7D8590',
        }}
      >
        <span className="text-lg font-display font-extrabold font-mono-num leading-none">
          {isTrainingDummy ? '∞' : isTrainingMode ? '练' : player.score}
        </span>
      </div>

      {/* 名称 + 内联键位/AI 信息 + 弹药条 + 激活道具 */}
      <div className="flex-1 min-w-0 space-y-1">
        {/* 第一行：玩家名 + 内联操作键位 / AI 标签 + 淘汰状态 */}
        <div
          className={`flex items-center gap-1.5 min-w-0 ${
            isRight ? 'flex-row-reverse' : 'flex-row'
          }`}
        >
          <span className="text-xs font-bold text-[var(--foreground)] truncate max-w-[112px]">
            {player.displayName}
          </span>

          {isAi ? (
            <span
              data-testid={`${slotPrefix}-ai-badge`}
              style={
                isBoss
                  ? {
                      backgroundColor: BOSS_TIER_THEME.bgHex,
                      borderColor: BOSS_TIER_THEME.borderHex,
                      color: BOSS_TIER_THEME.textHex,
                    }
                  : undefined
              }
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap shrink-0 border ${
                isBoss
                  ? ''
                  : 'bg-[var(--surface-secondary)] border-[var(--border)] text-[var(--foreground)]'
              }`}
            >
              <Bot
                className="w-2.5 h-2.5 shrink-0"
                style={{ color: isBoss ? '#FB7185' : 'var(--accent)' }}
                aria-hidden="true"
              />
              <span>
                {isBoss
                  ? `Lv.5 · ${config?.aiModelName ?? '地狱使者'}`
                  : isCustom
                  ? `Worker · ${config?.aiModelName ?? '自定义'}`
                  : config?.aiModelName ?? 'AI'}
              </span>
              {hasFault && (
                <span className="text-red-400">
                  · {runtimeStatus.state === 'timeout' ? '超时' : '异常'}
                </span>
              )}
            </span>
          ) : isTrainingDummy ? (
            <span
              data-testid="training-dummy-hud-badge"
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[var(--surface-secondary)] border border-[var(--border)] text-[10px] font-semibold text-[var(--muted)] whitespace-nowrap shrink-0"
            >
              {trainingDrill === 'parry' ? '发球机 · 斩弹演练' : '不死假人 · 自动回血'}
            </span>
          ) : keyHint ? (
            <span
              data-testid={`${slotPrefix}-key-hints`}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[var(--surface-secondary)] border border-[var(--border)] text-[10px] font-mono-num text-[var(--muted)] whitespace-nowrap shrink-0"
              title={
                keyHint.isFighter
                  ? `移动/瞄准：${keyHint.upKey}${keyHint.leftKey}${keyHint.downKey}${keyHint.rightKey}，拳/武：${keyHint.fireKey}，腿：${keyHint.kickKey}，跳：${keyHint.jumpKey}，换：${keyHint.swapKey}`
                  : `移动：${keyHint.upKey}/${keyHint.leftKey}/${keyHint.downKey}/${keyHint.rightKey}，开火：${keyHint.fireKey}`
              }
            >
              <span className="text-[var(--foreground)] font-semibold">
                {keyHint.upKey}
                {keyHint.leftKey}
                {keyHint.downKey}
                {keyHint.rightKey}
              </span>
              <span className="opacity-45">·</span>
              {keyHint.isFighter ? (
                <span className="font-bold text-[var(--foreground)]">
                  <span style={{ color: player.colorHex }}>{keyHint.fireKey}拳</span>{' '}
                  {keyHint.kickKey}腿 {keyHint.jumpKey}跳 {keyHint.swapKey}换
                </span>
              ) : (
                <span className="font-bold" style={{ color: player.colorHex }}>
                  {keyHint.fireKey}
                </span>
              )}
            </span>
          ) : null}

          {!player.alive && (
            <span className="text-[10px] font-bold text-red-600 dark:text-red-400 whitespace-nowrap shrink-0">
              已淘汰
            </span>
          )}
        </div>

        {/* 第二行：血条制游戏显示 HP 进度条 + 武器胶囊；坦克大战保留原弹夹格子与道具 */}
        {player.maxHp !== undefined ? (
          <div
            className={`flex items-center gap-2 min-w-0 ${
              isRight ? 'flex-row-reverse' : 'flex-row'
            }`}
          >
            {(() => {
              const hp = Math.max(0, player.hp ?? 0);
              const maxHp = Math.max(1, player.maxHp);
              const pct = Math.round((hp / maxHp) * 100);
              const barColor = pct > 55 ? '#22C55E' : pct > 28 ? '#F59E0B' : '#EF4444';
              return (
                <>
                  <div className="w-28 sm:w-36 h-2 rounded-full bg-[var(--surface-secondary)] overflow-hidden border border-[var(--border)] shrink-0">
                    <div
                      className="h-full transition-[width] duration-100"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: player.alive ? barColor : '#98A0AA',
                      }}
                    />
                  </div>
                  <span className="text-[10px] font-mono-num font-bold text-[var(--foreground)] whitespace-nowrap shrink-0">
                    {hp}/{maxHp}
                  </span>
                </>
              );
            })()}

            {player.weaponKind && player.weaponLabel ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--surface-secondary)] border border-[var(--border)] text-[10px] font-bold text-[var(--foreground)] whitespace-nowrap shrink-0 leading-none">
                <span>{player.weaponLabel}</span>
                {player.weaponCount !== undefined && (
                  <span className="font-mono-num text-[var(--accent)]">
                    {player.weaponCount}
                    {player.weaponMaxCount ? `/${player.weaponMaxCount}` : ''}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-[10px] font-medium text-[var(--muted)] whitespace-nowrap shrink-0">
                空手
              </span>
            )}

            {player.nearbyPickupLabel && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold whitespace-nowrap truncate">
                可换：{player.nearbyPickupLabel}
              </span>
            )}
          </div>
        ) : (
          <div
            className={`flex items-center gap-2 min-w-0 ${
              isRight ? 'flex-row-reverse' : 'flex-row'
            }`}
          >
            <div
              className={`flex items-center gap-0.5 shrink-0 ${
                isRight ? 'flex-row-reverse' : 'flex-row'
              }`}
            >
              {showPips ? (
                Array.from({ length: player.maxAmmo }).map((_, idx) => {
                  const filled = idx < player.ammo;
                  const isReloadingPip = idx === player.ammo && player.reloadProgress > 0;
                  return (
                    <div
                      key={idx}
                      className="relative w-2.5 h-1.5 rounded-[2px] bg-[var(--surface-secondary)] overflow-hidden border border-[var(--border)]"
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
                <div className="w-24 h-1.5 rounded-full bg-[var(--surface-secondary)] overflow-hidden border border-[var(--border)]">
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

            <span className="text-[10px] font-mono-num font-semibold text-[var(--muted)] whitespace-nowrap shrink-0">
              {player.ammo}/{player.maxAmmo}
            </span>

            {player.statusItems.length > 0 && (
              <div
                className={`flex items-center gap-1 min-w-0 overflow-hidden ${
                  isRight ? 'flex-row-reverse' : 'flex-row'
                }`}
              >
                {player.statusItems.map((item) => {
                  const accent =
                    ITEM_ACCENT_COLORS[(item.iconKey as ItemKind) ?? 'shield'] ??
                    ITEM_ACCENT_COLORS.shield;
                  return (
                    <div
                      key={item.id}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-semibold whitespace-nowrap shrink-0 leading-none"
                      style={{
                        backgroundColor: accent.bg,
                        borderColor: accent.border,
                        color: accent.fg,
                      }}
                    >
                      {item.iconKey && (
                        <TankItemIcon kind={item.iconKey} className="w-3 h-3 shrink-0" />
                      )}
                      <span>{item.label}</span>
                      <span className="font-mono-num">{item.valueText}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}
