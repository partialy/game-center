import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Code2,
  Eye,
  Maximize2,
  Minimize2,
  Play,
  SlidersHorizontal,
  Swords,
  Users,
  Zap,
  RotateCcw,
} from 'lucide-react';
import arcadeIconUrl from '../../assets/ai-game-certer-icon_round.ico?url';
import {
  BOSS_TIER_THEME,
  type ArenaSeatConfig,
  type BotModelDefinition,
  type CustomBotScriptRecord,
  type GameDefinition,
  type GameMode,
  type PlayerSlotId,
  type SingleMatchup,
} from '../games/contracts';
import { useMobileViewport } from '../mobile/MobileViewportContext';
import { resolveSlotAiSelection } from './PlayerSetupPanel';
import { CosmicBackdrop } from './CosmicBackdrop';
import { LobbyShowcaseCanvas } from './LobbyShowcaseCanvas';
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
}

const WHEEL_COOLDOWN_MS = 200;

/**
 * 暗色星河宇宙风格本地对战大厅：
 * - 左侧竖屏录像带式缩略图轮播，中央精准方框框选当前游戏，支持滚轮、上下键、上下按钮及直接点击缩略图平滑切换
 * - 中右侧展示当前选中游戏的信息、单人/多人/AI 乱斗模式切换、AI 难度快选与开始游戏/快速开战/设置入口
 * - 右侧大屏实时渲染当前选中游戏的实机或概念游玩示例动画
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
}: LobbyViewProps) {
  const catalog = useMemo(() => buildLobbyCatalog(games), [games]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

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

  // 键盘交互：↑/↓ 或 W/S 上下切换录像带；Enter/Space 快捷启动当前可玩游戏
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
        !(target instanceof HTMLElement && target.tagName === 'BUTTON')
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

  // 左侧录像带鼠标滚轮上下滚动切换（使用非 passive 原生监听，避免浏览器 passive preventDefault 报错）
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
    <main className="relative h-full w-full overflow-hidden bg-[#040712] text-[#F1F5F9] flex flex-col select-none">
      {/* 动态星河宇宙背景 */}
      <CosmicBackdrop />

      {/* 顶部极简导航栏 */}
      <header
        className={`relative z-10 shrink-0 border-b border-white/[0.08] bg-[#050918]/72 ${
          isCompactLandscape ? 'px-3.5 py-1.5' : 'px-6 lg:px-10 py-3.5'
        }`}
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
              className={`font-display font-extrabold tracking-tight text-white whitespace-nowrap shrink-0 ${
                isCompactLandscape ? 'text-base' : 'text-lg'
              }`}
            >
              本地双人对战厅
            </span>
          </div>

          {primaryPlayableGame && (
            <div className="flex items-center gap-2 shrink-0">
              {canRequestFullscreen && (
                <button
                  type="button"
                  onClick={() =>
                    void (isFullscreen ? exitFullscreen() : requestLandscapeFullscreen())
                  }
                  aria-label={isFullscreen ? '退出全屏' : '全屏横屏'}
                  className={`inline-flex items-center gap-1 text-xs font-semibold text-[#E2E8F0] bg-white/[0.07] hover:bg-white/[0.14] border border-white/12 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isCompactLandscape ? 'px-2.5 py-1.5' : 'px-3 py-2'
                  }`}
                >
                  {isFullscreen ? (
                    <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" />
                  ) : (
                    <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span className="hidden sm:inline">{isFullscreen ? '退出全屏' : '全屏'}</span>
                </button>
              )}
              {primaryPlayableGame.aiSdk && (
                <button
                  type="button"
                  data-testid="lobby-open-studio-btn"
                  onClick={() => onOpenAiStudio(primaryPlayableGame.id, 'prompt')}
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold text-[#E0F2FE] bg-[#132544] hover:bg-[#1B335C] border border-[#7DD3FC]/35 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#7DD3FC] focus-visible:outline-offset-2 ${
                    isCompactLandscape ? 'px-2.5 py-1.5' : 'px-3.5 py-2'
                  }`}
                >
                  <Code2 className="w-3.5 h-3.5 text-[#7DD3FC]" aria-hidden="true" />
                  AI 脚本工坊
                  {customBotScripts.length > 0 && (
                    <span className="font-mono-num text-[11px] text-[#7DD3FC]">
                      ({customBotScripts.length})
                    </span>
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={() => onEnterSettings(primaryPlayableGame.id)}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold text-[#E2E8F0] bg-white/[0.07] hover:bg-white/[0.14] border border-white/12 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#7DD3FC] focus-visible:outline-offset-2 ${
                  isCompactLandscape ? 'px-2.5 py-1.5' : 'px-3.5 py-2'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                {isCompactLandscape
                  ? '规则设置'
                  : gameMode === 'single'
                  ? '单人规则与 AI 设置'
                  : gameMode === 'brawl'
                  ? 'AI 乱斗规则与阵容'
                  : '多人规则与按键设置'}
              </button>
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
          <button
            type="button"
            aria-label="上一个游戏"
            disabled={!canGoUp}
            onClick={() => stepSelection(-1)}
            className="w-full h-9 rounded-lg border border-white/12 bg-[#0B1226]/85 hover:bg-[#142042] hover:border-[#7DD3FC]/40 disabled:opacity-30 disabled:hover:bg-[#0B1226]/85 disabled:hover:border-white/12 disabled:cursor-not-allowed flex items-center justify-center text-[#CBD5E1] hover:text-white transition-colors cursor-pointer shrink-0 focus-visible:outline-2 focus-visible:outline-[#7DD3FC]"
          >
            <ChevronUp className="w-4 h-4" aria-hidden="true" />
          </button>

          {/* 录像带胶片视口 */}
          <div
            ref={reelViewportRef}
            data-testid="lobby-game-reel"
            role="listbox"
            aria-label="选择游戏"
            className="relative flex-1 min-h-0 w-full my-2.5 rounded-xl border border-white/[0.1] bg-[#070C1C]/82 overflow-hidden"
          >
            {/* 左侧与右侧胶片齿孔轨道（录像带质感） */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-2 left-1.5 w-2 opacity-40"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(to bottom, rgba(148,163,184,0.65) 0px, rgba(148,163,184,0.65) 6px, transparent 6px, transparent 15px)',
              }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-2 right-1.5 w-2 opacity-40"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(to bottom, rgba(148,163,184,0.65) 0px, rgba(148,163,184,0.65) 6px, transparent 6px, transparent 15px)',
              }}
            />

            {/* 固定在垂直正中央的星光选框（方框框选当前游戏） */}
            <div
              data-testid="reel-selection-frame"
              aria-hidden="true"
              className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 ${
                isCompactLandscape ? 'w-[126px]' : 'w-[166px] xl:w-[178px]'
              } h-[112px] rounded-lg border border-[#7DD3FC]/80 shadow-[0_0_26px_rgba(125,211,252,0.24)]`}
            >
              {/* 四角星标取景角括弧 */}
              <span className="absolute -top-[2px] -left-[2px] w-3.5 h-3.5 border-t-2 border-l-2 border-[#F5C469] rounded-tl-sm" />
              <span className="absolute -top-[2px] -right-[2px] w-3.5 h-3.5 border-t-2 border-r-2 border-[#F5C469] rounded-tr-sm" />
              <span className="absolute -bottom-[2px] -left-[2px] w-3.5 h-3.5 border-b-2 border-l-2 border-[#F5C469] rounded-bl-sm" />
              <span className="absolute -bottom-[2px] -right-[2px] w-3.5 h-3.5 border-b-2 border-r-2 border-[#F5C469] rounded-br-sm" />
            </div>

            {/* 竖向平滑滚动胶片轨道（锚定容器正中，令 activeIndex 精准对齐中央方框） */}
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
                {/* 磁带片头微弱星轨引带（平衡第一项居中的视觉留白） */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -top-[92px] w-[152px] xl:w-[164px] h-[72px] rounded-md border border-dashed border-white/[0.08] flex flex-col items-center justify-center gap-1 text-[10px] text-[#64748B]"
                >
                  <span className="font-mono-num tracking-widest">REEL START</span>
                  <span className="w-8 h-px bg-white/10" />
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
                      } rounded-md overflow-hidden border bg-[#0C1429] text-left cursor-pointer shrink-0 transition-[transform,opacity,border-color] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:outline-2 focus-visible:outline-[#F5C469] ${
                        isSelected
                          ? 'scale-100 opacity-100 border-white/25'
                          : 'scale-[0.9] opacity-55 hover:opacity-88 hover:scale-[0.94] border-white/12'
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

                      {/* 底部柔黑遮罩，保证片名与序号高对比度清晰可读 */}
                      <div className="absolute inset-0 bg-gradient-to-t from-[#040712]/92 via-[#040712]/25 to-transparent" />

                      <div className="absolute inset-x-0 bottom-0 px-2.5 py-2 flex items-end justify-between gap-1.5">
                        <span className="text-xs font-bold text-white leading-tight truncate">
                          {item.title}
                        </span>
                        <span className="font-mono-num text-[10px] font-semibold text-[#94A3B8] shrink-0">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                      </div>
                    </button>
                  );
                })}

                {/* 磁带片尾微弱星轨标记 */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none w-[152px] xl:w-[164px] h-[72px] rounded-md border border-dashed border-white/[0.08] flex flex-col items-center justify-center gap-1 text-[10px] text-[#64748B]"
                >
                  <span className="w-8 h-px bg-white/10" />
                  <span className="font-mono-num tracking-widest">MORE SOON</span>
                </div>
              </div>
            </div>

            {/* 顶部与底部深空渐隐遮罩 */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-[#070C1C] via-[#070C1C]/70 to-transparent z-10"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-[#070C1C] via-[#070C1C]/70 to-transparent z-10"
            />
          </div>

          <button
            type="button"
            aria-label="下一个游戏"
            disabled={!canGoDown}
            onClick={() => stepSelection(1)}
            className="w-full h-9 rounded-lg border border-white/12 bg-[#0B1226]/85 hover:bg-[#142042] hover:border-[#7DD3FC]/40 disabled:opacity-30 disabled:hover:bg-[#0B1226]/85 disabled:hover:border-white/12 disabled:cursor-not-allowed flex items-center justify-center text-[#CBD5E1] hover:text-white transition-colors cursor-pointer shrink-0 focus-visible:outline-2 focus-visible:outline-[#7DD3FC]"
          >
            <ChevronDown className="w-4 h-4" aria-hidden="true" />
          </button>

          <div className="mt-2 flex items-center gap-2 text-[11px] text-[#94A3B8]">
            <span data-testid="reel-index-indicator" className="font-mono-num font-semibold text-[#E2E8F0]">
              {String(safeIndex + 1).padStart(2, '0')} / {String(catalog.length).padStart(2, '0')}
            </span>
            <span aria-hidden="true">·</span>
            <span>滚轮 / ↑↓ 切换</span>
          </div>
        </aside>

        {/* 中右侧：当前选中游戏的详细信息、单人/多人模式切换、AI 难度快选与启动入口 */}
        <section
          aria-label="当前选中游戏详情"
          className={`${
            isCompactLandscape
              ? 'w-[270px] overflow-y-auto pr-1 justify-start'
              : 'w-[324px] xl:w-[372px] justify-center'
          } shrink-0 flex flex-col min-w-0`}
        >
          {activeEntry && (
            <div
              key={activeEntry.id}
              className={`animate-cosmic-enter ${isCompactLandscape ? 'space-y-2.5 py-0.5' : 'space-y-4'}`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <span
                    className={
                      activeEntry.playable ? 'text-[#7DD3FC]' : 'text-[#F5C469]'
                    }
                  >
                    {activeEntry.statusText}
                  </span>
                  <span aria-hidden="true" className="text-[#475569]">
                    ·
                  </span>
                  <span className="font-mono-num text-[#94A3B8]">
                    NO.{String(safeIndex + 1).padStart(2, '0')}
                  </span>
                </div>

                <h1
                  data-testid="active-game-title"
                  className={`font-display font-extrabold tracking-tight text-white leading-[1.12] text-balance ${
                    isCompactLandscape ? 'text-2xl' : 'text-3xl xl:text-[36px]'
                  }`}
                >
                  {activeEntry.title}
                </h1>

                {!isCompactLandscape && (
                  <p className="text-xs font-medium tracking-wide text-[#94A3B8]">
                    {activeEntry.englishSubtitle}
                  </p>
                )}

                {/* 纯文本分隔元数据 */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5 text-xs text-[#CBD5E1]">
                  {activeEntry.metaItems.map((meta, mIdx) => {
                    const displayMeta =
                      activeEntry.playable && mIdx === 0
                        ? gameMode === 'brawl'
                          ? '2–8 席 AI 乱斗'
                          : gameMode === 'single'
                          ? '单人人机 / AI 观战'
                          : meta
                        : meta;
                    return (
                      <span key={`${mIdx}-${displayMeta}`} className="inline-flex items-center gap-2">
                        {mIdx > 0 && (
                          <span aria-hidden="true" className="text-[#475569]">
                            ·
                          </span>
                        )}
                        <span>{displayMeta}</span>
                      </span>
                    );
                  })}
                </div>
              </div>

              <p className="text-[13px] leading-relaxed text-[#CBD5E1]">
                {activeEntry.description}
              </p>

              {/* 单人游戏 / 多人游戏 / AI 乱斗 三段模式切换 */}
              {activeEntry.playable && (
                <div className="space-y-2.5 pt-1">
                  <div
                    role="tablist"
                    aria-label="选择游戏模式"
                    className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#0B1226]/92 border border-white/12"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={gameMode === 'single'}
                      data-testid="lobby-mode-single"
                      onClick={() => onGameModeChange('single')}
                      className={`flex items-center justify-center gap-1 px-2 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                        gameMode === 'single'
                          ? 'bg-[#17264A] text-white border border-[#7DD3FC]/55 shadow-[0_0_16px_rgba(125,211,252,0.16)]'
                          : 'text-[#94A3B8] hover:text-white border border-transparent'
                      }`}
                    >
                      <Bot className="w-3.5 h-3.5 text-[#7DD3FC] shrink-0" aria-hidden="true" />
                      单人游戏
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={gameMode === 'multi'}
                      data-testid="lobby-mode-multi"
                      onClick={() => onGameModeChange('multi')}
                      className={`flex items-center justify-center gap-1 px-2 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                        gameMode === 'multi'
                          ? 'bg-[#17264A] text-white border border-[#F5C469]/55 shadow-[0_0_16px_rgba(245,196,105,0.14)]'
                          : 'text-[#94A3B8] hover:text-white border border-transparent'
                      }`}
                    >
                      <Users className="w-3.5 h-3.5 text-[#F5C469] shrink-0" aria-hidden="true" />
                      多人游戏
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={gameMode === 'brawl'}
                      data-testid="lobby-mode-brawl"
                      onClick={() => onGameModeChange('brawl')}
                      className={`flex items-center justify-center gap-1 px-2 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                        gameMode === 'brawl'
                          ? 'bg-[#29193A] text-white border border-[#C084FC]/55 shadow-[0_0_16px_rgba(192,132,252,0.18)]'
                          : 'text-[#94A3B8] hover:text-white border border-transparent'
                      }`}
                    >
                      <Swords className="w-3.5 h-3.5 text-[#C084FC] shrink-0" aria-hidden="true" />
                      AI 乱斗
                    </button>
                  </div>

                  {/* 单人模式：AI 脚本模型快选（内置 + 自定义脚本库） */}
                  {gameMode === 'single' && botModels.length > 0 && (
                    <div
                      data-testid="lobby-ai-quick-picker"
                      className="rounded-xl border border-white/10 bg-[#080F22]/86 p-2.5 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-semibold text-[#CBD5E1]">
                          AI 对手脚本
                        </span>
                        <div className="flex items-center gap-2.5">
                          <button
                            type="button"
                            data-testid="lobby-matchup-toggle"
                            onClick={() =>
                              onSingleMatchupChange(
                                singleMatchup === 'human_vs_ai' ? 'ai_vs_ai' : 'human_vs_ai'
                              )
                            }
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#7DD3FC] hover:text-[#BAE6FD] transition-colors cursor-pointer"
                          >
                            <Eye className="w-3 h-3" aria-hidden="true" />
                            {singleMatchup === 'ai_vs_ai' ? 'AI 观战' : '切换观战'}
                          </button>
                          {activePlayableGame?.aiSdk && (
                            <button
                              type="button"
                              onClick={() => onOpenAiStudio(activePlayableGame.id, 'editor')}
                              className="text-[11px] font-semibold text-[#F5C469] hover:text-[#FDE68A] transition-colors cursor-pointer"
                            >
                              + 工坊
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 max-h-[116px] overflow-y-auto pr-0.5">
                        {botModels.map((model) => {
                          const selected =
                            selectedOpponent?.source === 'builtin' &&
                            model.id === selectedOpponent.modelId;
                          const isBoss = Boolean(model.isBoss || model.difficultyLevel === 5);
                          return (
                            <button
                              key={model.id}
                              type="button"
                              data-testid={`lobby-ai-model-${model.id}`}
                              aria-pressed={selected}
                              onClick={() => onAiModelChange('p2', model.id)}
                              style={
                                isBoss
                                  ? {
                                      backgroundColor: selected
                                        ? BOSS_TIER_THEME.bgSoftHex
                                        : BOSS_TIER_THEME.bgHex,
                                      borderColor: selected
                                        ? '#F43F5E'
                                        : BOSS_TIER_THEME.borderHex,
                                      color: BOSS_TIER_THEME.textHex,
                                    }
                                  : undefined
                              }
                              className={`flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg border text-left transition-colors cursor-pointer ${
                                isBoss
                                  ? 'shadow-xs'
                                  : selected
                                  ? 'bg-white/[0.11] border-white/35 text-white'
                                  : 'bg-white/[0.03] border-white/[0.08] text-[#94A3B8] hover:bg-white/[0.07] hover:text-[#E2E8F0]'
                              }`}
                            >
                              <span className="flex items-center gap-1.5 min-w-0">
                                <span
                                  className="w-2 h-2 rounded-xs shrink-0"
                                  style={{ backgroundColor: model.accentColor }}
                                  aria-hidden="true"
                                />
                                <span className="text-[11px] font-bold truncate">
                                  {model.name}
                                </span>
                              </span>
                              <span
                                className="font-mono-num text-[10px] font-semibold shrink-0"
                                style={isBoss ? { color: '#FB7185' } : undefined}
                              >
                                {isBoss ? `BOSS Lv.${model.difficultyLevel}` : `Lv.${model.difficultyLevel}`}
                              </span>
                            </button>
                          );
                        })}
                        {customBotScripts.map((script) => {
                          const selected =
                            selectedOpponent?.source === 'custom' &&
                            script.id === selectedOpponent.modelId;
                          return (
                            <button
                              key={script.id}
                              type="button"
                              data-testid={`lobby-ai-custom-${script.id}`}
                              aria-pressed={selected}
                              onClick={() => onAiModelChange('p2', `custom:${script.id}`)}
                              className={`flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg border text-left transition-colors cursor-pointer ${
                                selected
                                  ? 'bg-[#1A2D4F] border-[#7DD3FC]/65 text-white'
                                  : 'bg-white/[0.04] border-[#7DD3FC]/20 text-[#CBD5E1] hover:bg-white/[0.08] hover:text-white'
                              }`}
                            >
                              <span className="flex items-center gap-1.5 min-w-0">
                                <span
                                  className="w-2 h-2 rounded-xs shrink-0"
                                  style={{ backgroundColor: script.defaultColorHex }}
                                  aria-hidden="true"
                                />
                                <span className="text-[11px] font-bold truncate">
                                  {script.name}
                                </span>
                              </span>
                              <span className="text-[10px] font-semibold text-[#7DD3FC] shrink-0">
                                自定义
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      {selectedOpponent && (
                        <p className="text-[11px] leading-snug text-[#94A3B8] line-clamp-1">
                          {selectedOpponent.summary}
                        </p>
                      )}
                    </div>
                  )}

                  {/* AI 乱斗模式：2～8 席规模快选 + 当前参赛选手预览 */}
                  {gameMode === 'brawl' && (
                    <div
                      data-testid="lobby-brawl-summary"
                      className="rounded-xl border border-[#C084FC]/25 bg-[#0D1025]/90 p-2.5 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-semibold text-[#E9D5FF]">
                          多 AI 混战席位（<span className="font-mono-num">{arenaSeats.length}</span> 席）
                        </span>
                        <div className="flex items-center gap-1">
                          {[2, 4, 6, 8].map((n) => (
                            <button
                              key={n}
                              type="button"
                              data-testid={`lobby-brawl-count-${n}`}
                              onClick={() => onQuickSetArenaSeatCount(n)}
                              className={`px-1.5 py-0.5 rounded font-mono-num text-[10px] font-bold transition-colors cursor-pointer ${
                                arenaSeats.length === n
                                  ? 'bg-[#C084FC] text-[#0B0F1E]'
                                  : 'bg-white/[0.07] text-[#CBD5E1] hover:bg-white/[0.15]'
                              }`}
                            >
                              {n}席
                            </button>
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
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/[0.06] border border-white/10 text-[11px] text-[#E2E8F0] max-w-[106px]"
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

                      <p className="text-[11px] text-[#94A3B8] leading-snug">
                        在独立 Worker 沙箱内让多个大模型脚本与内置 AI 同台竞技，点击「配置阵容」可逐席选色与选模型。
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* 核心玩法要点（桌面展示，紧凑手机横屏隐藏以优先保证操作按钮可及） */}
              {!isCompactLandscape && (
                <dl className="pt-3 border-t border-white/10 space-y-2 text-xs">
                  {(activeEntry.playable && gameMode !== 'multi'
                    ? activeEntry.highlights.slice(0, 2)
                    : activeEntry.highlights
                  ).map((hl) => (
                    <div key={hl.label} className="grid grid-cols-12 gap-2 items-baseline">
                      <dt className="col-span-3 font-semibold text-[#94A3B8] whitespace-nowrap">
                        {hl.label}
                      </dt>
                      <dd className="col-span-9 text-[#E2E8F0] leading-relaxed">
                        {hl.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              {/* 操作按钮区 */}
              {activeEntry.playable ? (
                <div className="pt-1 flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    data-start="true"
                    onClick={() => onEnterPreMatch(activeEntry.id)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-[#E85D3F] hover:bg-[#F26E52] rounded-lg shadow-[0_8px_24px_rgba(232,93,63,0.34)] transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#F5C469] focus-visible:outline-offset-2"
                  >
                    <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                    {gameMode === 'brawl' ? '配置乱斗阵容' : '开始游戏'}
                  </button>
                  <button
                    type="button"
                    data-testid="lobby-quick-start-btn"
                    onClick={() => onQuickStart(activeEntry.id)}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-[#F8FAFC] bg-white/[0.09] hover:bg-white/[0.16] border border-white/15 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#7DD3FC]"
                  >
                    <Zap className="w-3.5 h-3.5 text-[#F5C469]" aria-hidden="true" />
                    {gameMode === 'brawl'
                      ? `立即 ${arenaSeats.length} 席乱斗`
                      : gameMode === 'single' && singleMatchup === 'ai_vs_ai'
                      ? '开始观战'
                      : '立即开战'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onEnterSettings(activeEntry.id)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-semibold text-[#CBD5E1] hover:text-white hover:bg-white/[0.08] border border-white/12 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#7DD3FC]"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                    设置
                  </button>
                </div>
              ) : (
                <div className="pt-2 space-y-3">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => selectIndex(0)}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-[#F8FAFC] bg-white/[0.1] hover:bg-white/[0.18] border border-white/15 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#7DD3FC]"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-[#7DD3FC]" aria-hidden="true" />
                      返回可玩游戏（坦克大战）
                    </button>
                  </div>
                  <p className="text-xs text-[#94A3B8]">
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
            <div className="relative w-full h-full max-h-[580px] rounded-2xl overflow-hidden border border-white/12 bg-[#080E1E] shadow-[0_28px_72px_rgba(0,0,0,0.65)] flex flex-col">
              {/* 顶部极简演示信息条（不遮挡画布） */}
              <div className="shrink-0 px-4 py-2.5 border-b border-white/[0.08] bg-[#0B1226]/92 flex items-center justify-between gap-4 text-xs">
                <span className="font-semibold text-[#F1F5F9] whitespace-nowrap">
                  {activeEntry.playable ? '实机游玩示例' : '玩法预览动画'} ·{' '}
                  {activeEntry.title}
                </span>
                <span className="text-[#94A3B8] truncate">
                  {activeEntry.playable && gameMode === 'brawl'
                    ? `AI 乱斗模式 · ${arenaSeats.length} 席模型同台混战`
                    : activeEntry.playable && gameMode === 'single'
                    ? singleMatchup === 'ai_vs_ai'
                      ? '单人观战 · 双 AI 策略脚本实机对抗'
                      : `单人模式 · 挑战 AI「${selectedOpponent?.displayName ?? '战术游击'}」`
                    : activeEntry.controlsSummary}
                </span>
              </div>

              {/* 完整大屏实时 Canvas 演示容器 */}
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

      {/* 底部单行键位与交互引导（矮屏手机横屏自动隐藏以释放更多画布高度） */}
      {!isCompactLandscape && (
        <footer className="relative z-10 shrink-0 px-6 lg:px-10 py-3 border-t border-white/[0.08] bg-[#050918]/72">
          <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-[#94A3B8]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {isMobileOrTablet ? (
                <span>
                  <strong className="text-[#E2E8F0]">触屏操控</strong> 左半屏浮动摇杆指哪打哪 · 右下大按钮独立开火
                </span>
              ) : (
                <>
                  <span>
                    <strong className="text-[#E2E8F0]">↑ ↓ / 滚轮</strong> 切换游戏
                  </span>
                  <span aria-hidden="true" className="text-[#475569]">
                    ·
                  </span>
                  {gameMode === 'brawl' ? (
                    <span>
                      <strong className="text-[#C084FC]">AI 乱斗</strong> 支持 2～8 席大模型脚本与内置 AI 沙箱混战
                    </span>
                  ) : gameMode === 'single' ? (
                    singleMatchup === 'ai_vs_ai' ? (
                      <span>
                        <strong className="text-[#7DD3FC]">AI 观战</strong> 双策略脚本自动对战
                      </span>
                    ) : (
                      <>
                        <span>
                          <strong className="text-[#E2E8F0]">P1</strong> WASD 移动 + 空格 开火
                        </span>
                        <span aria-hidden="true" className="text-[#475569]">
                          ·
                        </span>
                        <span>
                          <strong className="text-[#7DD3FC]">AI 对手</strong>{' '}
                          {selectedOpponent?.displayName ?? '战术游击'}（
                          {selectedOpponent?.tierText ?? 'Lv.2'}）
                        </span>
                      </>
                    )
                  ) : (
                    <>
                      <span>
                        <strong className="text-[#E2E8F0]">P1</strong> WASD 移动 + 空格 开火
                      </span>
                      <span aria-hidden="true" className="text-[#475569]">
                        ·
                      </span>
                      <span>
                        <strong className="text-[#E2E8F0]">P2</strong> 方向键 移动 + Enter 开火
                      </span>
                    </>
                  )}
                  <span aria-hidden="true" className="text-[#475569]">
                    ·
                  </span>
                  <span>
                    <strong className="text-[#E2E8F0]">Esc</strong> 暂停 / 继续
                  </span>
                </>
              )}
            </div>
            <span className="text-[#64748B]">
              单人 / 多人 / AI 乱斗规则独立保存 · 支持粘贴大模型 JS/TS 脚本沙箱对战
            </span>
          </div>
        </footer>
      )}
    </main>
  );
}
