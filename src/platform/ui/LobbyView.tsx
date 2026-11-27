import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import {
  ChevronDown,
  ChevronUp,
  Code2,
  Eye,
  Maximize2,
  Minimize2,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Target,
  Zap,
} from 'lucide-react';
import arcadeIconUrl from '../../assets/ai-game-certer-icon_round.ico?url';
import {
  type ArenaSeatConfig,
  type BotModelDefinition,
  type CustomBotScriptRecord,
  type GameDefinition,
  type GameMode,
  type PlayerSlotId,
  type SingleMatchup,
} from '../games/contracts';
import { useMobileViewport } from '../mobile/MobileViewportContext';
import { useTheme } from '../theme/ThemeContext';
import { resolveSlotAiSelection } from './PlayerSetupPanel';
import { CosmicBackdrop } from './CosmicBackdrop';
import { LobbyShowcaseCanvas } from './LobbyShowcaseCanvas';
import { AppSelect, ModeTabs, ThemeQuickToggle, type SelectOptionGroup } from './heroUiHelpers';
import {
  REEL_ITEM_GAP_PX,
  REEL_ITEM_HEIGHT_PX,
  REEL_ITEM_PITCH_PX,
  buildLobbyCatalog,
  clampReelIndex,
  computeReelTrackOffset,
  computeWheelStep,
  stepReelIndex,
  type LobbyCatalogEntry,
} from './lobbyReel';

interface LobbyViewProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  games: GameDefinition<any, any>[];
  gameMode: GameMode;
  onGameModeChange: (mode: GameMode) => void;
  singleMatchup: SingleMatchup;
  onSingleMatchupChange: (matchup: SingleMatchup) => void;
  aiModelBySlot: Record<PlayerSlotId, string>;
  onAiModelChange: (slotId: PlayerSlotId, modelId: string) => void;
  customBotScripts: CustomBotScriptRecord[];
  arenaSeats: ArenaSeatConfig[];
  onQuickSetArenaSeatCount: (count: number) => void;
  onOpenAiStudio: (gameId: string, tab?: 'prompt' | 'editor') => void;
  onEnterPreMatch: (gameId: string) => void;
  onEnterSettings: (gameId: string) => void;
  onQuickStart: (gameId: string) => void;
  onStartTraining?: (gameId: string) => void;
}

const WHEEL_COOLDOWN_MS = 200;

/**
 * HeroUI v3 本地对战大厅（全站浅色 / 深色 / 自定义强调色双模适配）：
 * - 深色模式保留星河宇宙视觉；浅色模式切换为干净制图工坊浅色风格，确保双模式均高对比度清晰可读
 * - 左侧录像带竖屏缩略图轮播，中央精准选框，支持滚轮/方向键/点击切换
 * - 中栏使用 HeroUI ModeTabs 与 Button 呈现模式切换、AI 模型快选与启动操作
 * - 右侧大屏实时渲染实机游玩示例动画
 */
export function LobbyView({
  games,
  gameMode,
  onGameModeChange,
  singleMatchup,
  onSingleMatchupChange,
  aiModelBySlot,
  onAiModelChange,
  customBotScripts,
  arenaSeats,
  onQuickSetArenaSeatCount,
  onOpenAiStudio,
  onEnterPreMatch,
  onEnterSettings,
  onQuickStart,
  onStartTraining,
}: LobbyViewProps) {
  const catalog = useMemo(() => buildLobbyCatalog(games), [games]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const { resolvedMode } = useTheme();
  const isDark = resolvedMode === 'dark';

  const reelViewportRef = useRef<HTMLDivElement | null>(null);
  const wheelAccumRef = useRef(0);
  const lastWheelStepAtRef = useRef(0);

  const safeIndex = clampReelIndex(activeIndex, catalog.length);
  const activeEntry: LobbyCatalogEntry | undefined = catalog[safeIndex] ?? catalog[0];
  const primaryPlayableGame = games[0];
  const activePlayableGame = useMemo(
    () =>
      activeEntry?.playable
        ? games.find((g) => g.id === activeEntry.id) ?? primaryPlayableGame
        : primaryPlayableGame,
    [activeEntry, games, primaryPlayableGame]
  );

  const botModels: BotModelDefinition<unknown>[] = useMemo(
    () => (activePlayableGame?.botModels ?? []) as BotModelDefinition<unknown>[],
    [activePlayableGame]
  );
  const selectedOpponentModelId =
    aiModelBySlot.p2 ?? activePlayableGame?.defaultBotModelId ?? botModels[0]?.id ?? 'tactical';
  const selectedOpponent = resolveSlotAiSelection(
    selectedOpponentModelId,
    botModels,
    customBotScripts
  );

  const selectIndex = useCallback(
    (nextIdx: number) => {
      setActiveIndex(clampReelIndex(nextIdx, catalog.length));
    },
    [catalog.length]
  );

  const stepSelection = useCallback(
    (delta: number) => {
      setActiveIndex((prev) => stepReelIndex(prev, delta, catalog.length));
    },
    [catalog.length]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
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

      if (event.code === 'ArrowUp' || event.code === 'KeyW') {
        event.preventDefault();
        stepSelection(-1);
        return;
      }
      if (event.code === 'ArrowDown' || event.code === 'KeyS') {
        event.preventDefault();
        stepSelection(1);
        return;
      }

      if (
        (event.code === 'Enter' || event.code === 'Space') &&
        !event.repeat &&
        !(target instanceof HTMLElement && (target.tagName === 'BUTTON' || target.getAttribute('role') === 'tab'))
      ) {
        if (activeEntry?.playable) {
          event.preventDefault();
          onEnterPreMatch(activeEntry.id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeEntry, onEnterPreMatch, stepSelection]);

  useEffect(() => {
    const el = reelViewportRef.current;
    if (!el) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const now = performance.now();
      if (now - lastWheelStepAtRef.current < WHEEL_COOLDOWN_MS) {
        return;
      }
      const { step, nextAccumulated } = computeWheelStep(
        wheelAccumRef.current,
        event.deltaY,
        32
      );
      wheelAccumRef.current = nextAccumulated;
      if (step !== 0) {
        lastWheelStepAtRef.current = now;
        stepSelection(step);
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [stepSelection]);

  const trackOffsetY = computeReelTrackOffset(safeIndex, REEL_ITEM_PITCH_PX);
  const canGoUp = safeIndex > 0;
  const canGoDown = safeIndex < catalog.length - 1;
  const {
    isMobileOrTablet,
    logicalHeight,
    isFullscreen,
    canRequestFullscreen,
    requestLandscapeFullscreen,
    exitFullscreen,
  } = useMobileViewport();
  const isCompactLandscape = isMobileOrTablet && logicalHeight <= 540;

  return (
    <main
      className={`relative h-full w-full overflow-hidden flex flex-col select-none transition-colors ${
        isDark
          ? 'bg-[#040712] text-[#F1F5F9]'
          : 'drafting-surface text-[var(--foreground)]'
      }`}
    >
      {/* 深色模式呈现星河宇宙背景；浅色模式使用纯净制图网格底纹 */}
      {isDark && <CosmicBackdrop />}

      {/* 顶部极简导航栏 */}
      <header
        className={`relative z-10 shrink-0 border-b ${
          isDark
            ? 'border-white/[0.08] bg-[#050918]/78'
            : 'border-[var(--border)] bg-[var(--surface)]/92'
        } ${isCompactLandscape ? 'px-3.5 py-1.5' : 'px-6 lg:px-10 py-3'}`}
      >
        <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src={arcadeIconUrl}
              alt=""
              width={36}
              height={36}
              className={isCompactLandscape ? 'h-7 w-7 shrink-0' : 'h-9 w-9 shrink-0'}
            />
            <span
              className={`font-display font-extrabold tracking-tight whitespace-nowrap shrink-0 ${
                isCompactLandscape ? 'text-base' : 'text-lg'
              } ${isDark ? 'text-white' : 'text-[var(--foreground)]'}`}
            >
              本地双人对战厅
            </span>
          </div>

          {primaryPlayableGame && (
            <div className="flex items-center gap-2 shrink-0">
              <ThemeQuickToggle testId="lobby-theme-quick-toggle" />

              {canRequestFullscreen && (
                <Button
                  variant="secondary"
                  size="sm"
                  onPress={() =>
                    void (isFullscreen ? exitFullscreen() : requestLandscapeFullscreen())
                  }
                  aria-label={isFullscreen ? '退出全屏' : '全屏横屏'}
                  className="min-h-[36px] max-sm:min-h-[42px] whitespace-nowrap shrink-0"
                >
                  {isFullscreen ? (
                    <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" />
                  ) : (
                    <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span className="hidden sm:inline">{isFullscreen ? '退出全屏' : '全屏'}</span>
                </Button>
              )}

              {primaryPlayableGame.aiSdk && (
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="lobby-open-studio-btn"
                  onPress={() => onOpenAiStudio(primaryPlayableGame.id, 'prompt')}
                  className="h-9 px-3.5 !rounded-full whitespace-nowrap shrink-0 font-semibold text-xs"
                >
                  <Code2 className="w-3.5 h-3.5 text-[var(--accent)]" aria-hidden="true" />
                  <span>AI工坊</span>
                  {customBotScripts.length > 0 && (
                    <span className="font-mono-num text-[11px] text-[var(--accent)]">
                      ({customBotScripts.length})
                    </span>
                  )}
                </Button>
              )}

              <Button
                variant="secondary"
                size="sm"
                data-testid="lobby-enter-settings-btn"
                onPress={() => onEnterSettings(primaryPlayableGame.id)}
                className="h-9 px-3.5 !rounded-full whitespace-nowrap shrink-0 font-semibold text-xs"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {isCompactLandscape
                    ? '设置'
                    : gameMode === 'single'
                    ? '单人设置'
                    : gameMode === 'brawl'
                    ? '乱斗设置'
                    : '设置中心'}
                </span>
              </Button>
            </div>
          )}
        </div>
      </header>

      {/* 主舞台：左 录像带竖屏缩略图 + 中 游戏信息、模式切换与操作 + 右 大屏游玩示例动画 */}
      <div
        className={`relative z-10 flex-1 min-h-0 max-w-[1440px] w-full mx-auto flex items-stretch ${
          isCompactLandscape
            ? 'px-3.5 py-2 gap-3.5'
            : 'px-6 lg:px-10 py-5 gap-6 xl:gap-8'
        }`}
      >
        {/* 左侧：录像带竖屏缩略图 + 中央方框框选 */}
        <aside
          aria-label="游戏录像带目录"
          className={`${
            isCompactLandscape ? 'w-[148px]' : 'w-[206px] xl:w-[224px]'
          } shrink-0 flex flex-col items-center`}
        >
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            aria-label="上一个游戏"
            isDisabled={!canGoUp}
            onPress={() => stepSelection(-1)}
            className="h-9 shrink-0"
          >
            <ChevronUp className="w-4 h-4" aria-hidden="true" />
          </Button>

          {/* 录像带胶片视口 */}
          <div
            ref={reelViewportRef}
            data-testid="lobby-game-reel"
            role="listbox"
            aria-label="选择游戏"
            className={`relative flex-1 min-h-0 w-full my-2.5 rounded-xl border overflow-hidden ${
              isDark
                ? 'border-white/[0.1] bg-[#070C1C]/82'
                : 'border-[var(--border)] bg-[var(--surface)]/92 shadow-inner'
            }`}
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-2 left-1.5 w-2 opacity-35"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(to bottom, rgba(148,163,184,0.65) 0px, rgba(148,163,184,0.65) 6px, transparent 6px, transparent 15px)',
              }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-2 right-1.5 w-2 opacity-35"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(to bottom, rgba(148,163,184,0.65) 0px, rgba(148,163,184,0.65) 6px, transparent 6px, transparent 15px)',
              }}
            />

            {/* 固定在垂直正中央的选框 */}
            <div
              data-testid="reel-selection-frame"
              aria-hidden="true"
              className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 ${
                isCompactLandscape ? 'w-[126px]' : 'w-[166px] xl:w-[178px]'
              } h-[112px] rounded-lg border-2 border-[var(--accent)]`}
            >
              <span className="absolute -top-[2px] -left-[2px] w-3.5 h-3.5 border-t-2 border-l-2 border-[var(--accent)] rounded-tl-sm" />
              <span className="absolute -top-[2px] -right-[2px] w-3.5 h-3.5 border-t-2 border-r-2 border-[var(--accent)] rounded-tr-sm" />
              <span className="absolute -bottom-[2px] -left-[2px] w-3.5 h-3.5 border-b-2 border-l-2 border-[var(--accent)] rounded-bl-sm" />
              <span className="absolute -bottom-[2px] -right-[2px] w-3.5 h-3.5 border-b-2 border-r-2 border-[var(--accent)] rounded-br-sm" />
            </div>

            <div
              className="absolute inset-x-0 top-1/2"
              style={{ marginTop: -REEL_ITEM_HEIGHT_PX / 2 }}
            >
              <div
                className="relative flex flex-col items-center will-change-transform transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{
                  gap: REEL_ITEM_GAP_PX,
                  transform: `translate3d(0, ${trackOffsetY}px, 0)`,
                }}
              >
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -top-[92px] w-[152px] xl:w-[164px] h-[72px] rounded-md border border-dashed border-[var(--border)] flex flex-col items-center justify-center gap-1 text-[10px] text-[var(--muted)]"
                >
                  <span className="font-mono-num tracking-widest">REEL START</span>
                  <span className="w-8 h-px bg-[var(--border)]" />
                </div>

                {catalog.map((item, idx) => {
                  const isSelected = idx === safeIndex;
                  const imgFailed = Boolean(failedImages[item.id]);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      data-testid={`reel-item-${item.id}`}
                      data-reel-index={idx}
                      onClick={() => selectIndex(idx)}
                      style={{ height: REEL_ITEM_HEIGHT_PX }}
                      className={`relative ${
                        isCompactLandscape ? 'w-[118px]' : 'w-[156px] xl:w-[168px]'
                      } rounded-md overflow-hidden border bg-[#0C1429] text-left cursor-pointer shrink-0 transition-[transform,opacity,border-color] duration-200 ${
                        isSelected
                          ? 'scale-100 opacity-100 border-white/30'
                          : 'scale-[0.9] opacity-60 hover:opacity-90 hover:scale-[0.94] border-white/15'
                      }`}
                    >
                      {!imgFailed ? (
                        <img
                          src={item.thumbnailUrl}
                          alt={item.title}
                          referrerPolicy="no-referrer"
                          onError={() =>
                            setFailedImages((prev) => ({ ...prev, [item.id]: true }))
                          }
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      ) : (
                        <div
                          className="absolute inset-0"
                          style={{ background: item.fallbackGradient }}
                        />
                      )}

                      <div className="absolute inset-0 bg-gradient-to-t from-[#040712]/92 via-[#040712]/25 to-transparent" />

                      <div className="absolute inset-x-0 bottom-0 px-2.5 py-2 flex items-end justify-between gap-1.5">
                        <span className="text-xs font-bold text-white leading-tight truncate">
                          {item.title}
                        </span>
                        <span className="font-mono-num text-[10px] font-semibold text-[#CBD5E1] shrink-0">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                      </div>
                    </button>
                  );
                })}

                <div
                  aria-hidden="true"
                  className="pointer-events-none w-[152px] xl:w-[164px] h-[72px] rounded-md border border-dashed border-[var(--border)] flex flex-col items-center justify-center gap-1 text-[10px] text-[var(--muted)]"
                >
                  <span className="w-8 h-px bg-[var(--border)]" />
                  <span className="font-mono-num tracking-widest">MORE SOON</span>
                </div>
              </div>
            </div>

            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-x-0 top-0 h-14 z-10 bg-gradient-to-b ${
                isDark
                  ? 'from-[#070C1C] via-[#070C1C]/70 to-transparent'
                  : 'from-[var(--surface)] via-[var(--surface)]/75 to-transparent'
              }`}
            />
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-x-0 bottom-0 h-14 z-10 bg-gradient-to-t ${
                isDark
                  ? 'from-[#070C1C] via-[#070C1C]/70 to-transparent'
                  : 'from-[var(--surface)] via-[var(--surface)]/75 to-transparent'
              }`}
            />
          </div>

          <Button
            variant="secondary"
            size="sm"
            fullWidth
            aria-label="下一个游戏"
            isDisabled={!canGoDown}
            onPress={() => stepSelection(1)}
            className="h-9 shrink-0"
          >
            <ChevronDown className="w-4 h-4" aria-hidden="true" />
          </Button>

          <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--muted)]">
            <span
              data-testid="reel-index-indicator"
              className="font-mono-num font-semibold text-[var(--foreground)]"
            >
              {String(safeIndex + 1).padStart(2, '0')} / {String(catalog.length).padStart(2, '0')}
            </span>
            <span aria-hidden="true">·</span>
            <span>滚轮 / ↑↓ 切换</span>
          </div>
        </aside>

        {/* 中栏：当前选中游戏详情、模式切换与启动入口（顶部与左侧录像带胶片区齐平，不含上滚动按钮） */}
        <section
          aria-label="当前选中游戏详情"
          className={`${
            isCompactLandscape
              ? 'w-[280px] pr-1'
              : 'w-[340px] xl:w-[388px] pr-1'
          } shrink-0 flex flex-col justify-start pt-[46px] overflow-y-auto min-w-0`}
        >
          {activeEntry && (
            <div
              key={activeEntry.id}
              className={`animate-cosmic-enter ${
                isCompactLandscape ? 'space-y-2.5 pb-1' : 'space-y-4 pb-2'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <span className="text-[var(--accent)]">{activeEntry.statusText}</span>
                  <span aria-hidden="true" className="text-[var(--muted)]">
                    ·
                  </span>
                  <span className="font-mono-num text-[var(--muted)]">
                    NO.{String(safeIndex + 1).padStart(2, '0')}
                  </span>
                </div>

                <h1
                  data-testid="active-game-title"
                  className={`font-display font-extrabold tracking-tight leading-[1.12] text-balance ${
                    isCompactLandscape ? 'text-2xl' : 'text-3xl xl:text-[36px]'
                  } ${isDark ? 'text-white' : 'text-[var(--foreground)]'}`}
                >
                  {activeEntry.title}
                </h1>

                {!isCompactLandscape && (
                  <p className="text-xs font-medium tracking-wide text-[var(--muted)]">
                    {activeEntry.englishSubtitle}
                  </p>
                )}
              </div>

              <p className="text-[13px] leading-relaxed text-[var(--foreground)]/85">
                {activeEntry.description}
              </p>

              {/* HeroUI 三段药丸模式切换 */}
              {activeEntry.playable && (
                <div className="space-y-3 pt-1">
                  <ModeTabs
                    gameMode={gameMode}
                    onChange={onGameModeChange}
                    testIdPrefix="lobby"
                    compact
                    className="w-full"
                  />

                  {/* 单人模式：AI 对手 Select + 放大观战与工坊按钮 */}
                  {gameMode === 'single' && botModels.length > 0 && (() => {
                    const aiGroups: SelectOptionGroup[] = [];
                    if (customBotScripts.length > 0) {
                      aiGroups.push({
                        title: '自定义 AI 脚本',
                        options: customBotScripts.map((s) => ({
                          value: `custom:${s.id}`,
                          label: `[自定义] ${s.name}`,
                        })),
                      });
                    }
                    aiGroups.push({
                      title: '内置 AI 模型',
                      options: botModels.map((m) => ({
                        value: m.id,
                        label:
                          m.isBoss || m.difficultyLevel === 5
                            ? `[BOSS Lv.${m.difficultyLevel}] ${m.name}`
                            : `[Lv.${m.difficultyLevel}] ${m.name} · ${m.difficultyLabel}`,
                      })),
                    });
                    const currentAiValue =
                      selectedOpponent?.source === 'custom'
                        ? `custom:${selectedOpponent.modelId}`
                        : selectedOpponent?.modelId ?? botModels[1]?.id ?? botModels[0].id;

                    return (
                      <div
                        data-testid="lobby-ai-quick-picker"
                        className="rounded-xl border border-[var(--border)] bg-[var(--surface)]/92 p-3 space-y-2.5"
                      >
                        <AppSelect
                          ariaLabel="选择单人 AI 对手"
                          label="AI 对手"
                          testId="lobby-ai-opponent-select"
                          value={currentAiValue}
                          groups={aiGroups}
                          onChange={(val) => onAiModelChange('p2', val)}
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            variant={singleMatchup === 'ai_vs_ai' ? 'primary' : 'secondary'}
                            size="sm"
                            data-testid="lobby-matchup-toggle"
                            onPress={() =>
                              onSingleMatchupChange(
                                singleMatchup === 'human_vs_ai' ? 'ai_vs_ai' : 'human_vs_ai'
                              )
                            }
                            className={`flex-1 h-9 px-3.5 text-xs font-semibold whitespace-nowrap ${
                              singleMatchup === 'ai_vs_ai' ? 'accent-solid-btn' : ''
                            }`}
                          >
                            <Eye className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            {singleMatchup === 'ai_vs_ai' ? 'AI 观战中' : '切换观战'}
                          </Button>
                          {activePlayableGame?.aiSdk && (
                            <Button
                              variant="secondary"
                              size="sm"
                              data-testid="lobby-ai-card-studio-btn"
                              onPress={() => onOpenAiStudio(activePlayableGame.id, 'editor')}
                              className="flex-1 h-9 px-3.5 text-xs font-semibold whitespace-nowrap"
                            >
                              <Code2 className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" aria-hidden="true" />
                              AI工坊
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* AI 乱斗模式：2～8 席规模快选 */}
                  {gameMode === 'brawl' && (
                    <div
                      data-testid="lobby-brawl-summary"
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface)]/92 p-2.5 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-bold text-[var(--foreground)]">
                          多 AI 混战席位（<span className="font-mono-num">{arenaSeats.length}</span> 席）
                        </span>
                        <div className="flex items-center gap-1">
                          {[2, 4, 6, 8].map((n) => (
                            <Button
                              key={n}
                              size="sm"
                              variant={arenaSeats.length === n ? 'primary' : 'secondary'}
                              data-testid={`lobby-brawl-count-${n}`}
                              onPress={() => onQuickSetArenaSeatCount(n)}
                              className={`h-6 min-w-0 px-2 font-mono-num text-[10px] font-bold ${
                                arenaSeats.length === n ? 'accent-solid-btn' : ''
                              }`}
                            >
                              {n}席
                            </Button>
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {arenaSeats.map((seat) => {
                          const label =
                            seat.name.trim() ||
                            (seat.controller === 'human'
                              ? seat.slotId.toUpperCase()
                              : seat.aiSource === 'custom'
                              ? customBotScripts.find((c) => c.id === seat.aiModelId)?.name ??
                                '自定义AI'
                              : botModels.find((m) => m.id === seat.aiModelId)?.name ??
                                seat.slotId.toUpperCase());
                          return (
                            <span
                              key={seat.slotId}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--surface-secondary)] border border-[var(--border)] text-[11px] text-[var(--foreground)] max-w-[106px]"
                            >
                              <span
                                className="w-2 h-2 rounded-xs shrink-0"
                                style={{ backgroundColor: seat.colorHex }}
                              />
                              <span className="truncate">{label}</span>
                            </span>
                          );
                        })}
                      </div>

                      <p className="text-[11px] text-[var(--muted)] leading-snug">
                        在独立 Worker 沙箱内让多个大模型脚本与内置 AI 同台竞技，点击「配置乱斗阵容」可逐席选色与选模型。
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* 核心玩法要点（已去除操控模式行） */}
              {!isCompactLandscape && (
                <dl className="pt-3 border-t border-[var(--separator)] space-y-2 text-xs">
                  {activeEntry.highlights
                    .filter((hl) => hl.label !== '操控模式')
                    .map((hl) => (
                      <div key={hl.label} className="grid grid-cols-12 gap-2 items-baseline">
                        <dt className="col-span-3 font-semibold text-[var(--muted)] whitespace-nowrap">
                          {hl.label}
                        </dt>
                        <dd className="col-span-9 text-[var(--foreground)]/90 leading-relaxed">
                          {hl.value}
                        </dd>
                      </div>
                    ))}
                </dl>
              )}

              {/* HeroUI 操作按钮区 */}
              {activeEntry.playable ? (
                <div className="pt-1 flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    size="md"
                    data-start="true"
                    onPress={() => onEnterPreMatch(activeEntry.id)}
                    className="min-h-[42px] px-5 font-bold whitespace-nowrap shrink-0 accent-solid-btn"
                  >
                    <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                    {gameMode === 'brawl' ? '配置乱斗阵容' : '开始游戏'}
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    data-testid="lobby-quick-start-btn"
                    onPress={() => onQuickStart(activeEntry.id)}
                    className="min-h-[42px] px-4 font-semibold whitespace-nowrap shrink-0"
                  >
                    <Zap className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
                    {gameMode === 'brawl'
                      ? `快速 ${arenaSeats.length} 席乱斗`
                      : gameMode === 'single' && singleMatchup === 'ai_vs_ai'
                      ? '开始观战'
                      : '快速对局'}
                  </Button>
                  {activePlayableGame?.supportsTraining && onStartTraining && (
                    <Button
                      variant="secondary"
                      size="md"
                      data-testid="lobby-training-btn"
                      onPress={() => onStartTraining(activeEntry.id)}
                      className="min-h-[42px] px-4 font-semibold whitespace-nowrap shrink-0"
                    >
                      <Target className="w-3.5 h-3.5 text-[var(--accent)]" aria-hidden="true" />
                      练习关卡
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="md"
                    onPress={() => onEnterSettings(activeEntry.id)}
                    className="min-h-[42px] px-3.5 font-semibold whitespace-nowrap shrink-0"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                    设置
                  </Button>
                </div>
              ) : (
                <div className="pt-2 space-y-3">
                  <Button
                    variant="secondary"
                    size="md"
                    onPress={() => selectIndex(0)}
                    className="min-h-[42px] font-semibold"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-[var(--accent)]" aria-hidden="true" />
                    返回可玩游戏（坦克大战）
                  </Button>
                  <p className="text-xs text-[var(--muted)]">
                    该作品处于实景动画预览阶段，当前可先体验《坦克大战》。
                  </p>
                </div>
              )}
            </div>
          )}
        </section>

        {/* 右侧：大屏实时游玩示例动画舞台 */}
        <section
          aria-label="游戏游玩示例大屏"
          className="flex-1 min-w-0 flex flex-col justify-center"
        >
          {activeEntry && (
            <div className="relative w-full h-full max-h-[580px] rounded-2xl overflow-hidden border border-[var(--border)] bg-[#080E1E] shadow-xl flex flex-col">
              <div
                className={`shrink-0 px-4 py-2.5 border-b flex items-center justify-between gap-4 text-xs ${
                  isDark
                    ? 'border-white/[0.08] bg-[#0B1226]/92 text-[#F1F5F9]'
                    : 'border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]'
                }`}
              >
                <span className="font-semibold whitespace-nowrap">
                  {activeEntry.playable ? '实机游玩示例' : '玩法预览动画'} · {activeEntry.title}
                </span>
                <span className="text-[var(--muted)] truncate">
                  {activeEntry.playable && gameMode === 'brawl'
                    ? `AI 乱斗模式 · ${arenaSeats.length} 席模型同台混战`
                    : activeEntry.playable && gameMode === 'single'
                    ? singleMatchup === 'ai_vs_ai'
                      ? '单人观战 · 双 AI 策略脚本实机对抗'
                      : `单人模式 · 挑战 AI「${selectedOpponent?.displayName ?? '战术游击'}」`
                    : activeEntry.controlsSummary}
                </span>
              </div>

              <div className="relative flex-1 min-h-0 w-full bg-[#060B18]">
                <LobbyShowcaseCanvas
                  key={activeEntry.id}
                  kind={activeEntry.previewKind}
                  title={activeEntry.title}
                />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/[0.06]"
                />
              </div>
            </div>
          )}
        </section>
      </div>

      {/* 底部精简提示条：仅保留切换游戏与暂停说明 */}
      {!isCompactLandscape && (
        <footer
          className={`relative z-10 shrink-0 px-6 lg:px-10 py-2.5 border-t ${
            isDark
              ? 'border-white/[0.08] bg-[#050918]/78'
              : 'border-[var(--border)] bg-[var(--surface)]/92'
          }`}
        >
          <div className="max-w-[1440px] mx-auto flex items-center gap-4 text-xs text-[var(--muted)]">
            {isMobileOrTablet ? (
              <span>
                <strong className="text-[var(--foreground)]">触屏操控</strong> 左半屏浮动摇杆 · 右下独立开火
              </span>
            ) : (
              <>
                <span>
                  <strong className="text-[var(--foreground)]">↑ ↓ / 滚轮</strong> 切换游戏
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  <strong className="text-[var(--foreground)]">Esc</strong> 暂停 / 继续
                </span>
              </>
            )}
          </div>
        </footer>
      )}
    </main>
  );
}
