import { useMemo, useRef, useState } from 'react';
import { Button, Input, Modal, Tabs } from '@heroui/react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Code2,
  Cpu,
  Crosshair,
  Database,
  Eye,
  Gamepad2,
  Map as MapIcon,
  Maximize2,
  Minimize2,
  Monitor,
  Moon,
  Package,
  Palette,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  ArenaSeatConfig,
  CustomBotScriptRecord,
  GameDefinition,
  GameMode,
  PlayerProfile,
  PlayerSlotId,
  RulePreset,
  SingleMatchup,
  ValidationIssue,
} from '../games/contracts';
import { RulePresetsPanel, RulesForm } from '../settings/RulesForm';
import type { KeyCaptureTarget } from '../input/keyboardVisualizer';
import { useMobileViewport } from '../mobile/MobileViewportContext';
import { soundEngine } from '../session/audio';
import { useTheme } from '../theme/ThemeContext';
import {
  ACCENT_PRESETS,
  normalizeHexColor,
  type ThemeMode,
} from '../theme/themeStore';
import { ArenaRosterPanel } from './ArenaRosterPanel';
import {
  PlayerSetupPanel,
  resolveSlotAiSelection,
  resolveSlotController,
} from './PlayerSetupPanel';
import { VisualKeyboard } from './VisualKeyboard';
import {
  AppSelect,
  AppSlider,
  AppSwitch,
  ModeTabs,
  ThemeQuickToggle,
} from './heroUiHelpers';

type SettingsCategoryId =
  | 'basic'
  | 'map'
  | 'controls'
  | 'appearance'
  | 'items'
  | 'gameplay'
  | 'data';

interface SettingsCategoryMeta {
  id: SettingsCategoryId;
  label: string;
  shortDesc: string;
  longDesc: string;
  ruleGroups?: string[];
  icon: typeof SlidersHorizontal;
}

const SETTINGS_CATEGORIES: SettingsCategoryMeta[] = [
  {
    id: 'basic',
    label: '基础',
    shortDesc: '赛制 · 玩家与阵容',
    longDesc: '配置当前模式的胜负目标、回合倒数、玩家涂装与 AI 策略模型（含 Lv.5 终极 Boss）',
    ruleGroups: ['match'],
    icon: SlidersHorizontal,
  },
  {
    id: 'map',
    label: '地图',
    shortDesc: '迷宫 · 编号与出生',
    longDesc: '调整迷宫列数/行数、额外环路通路、复玩地图编号与回合出生策略',
    ruleGroups: ['map'],
    icon: MapIcon,
  },
  {
    id: 'controls',
    label: '操控',
    shortDesc: '转向 · 键位与触控',
    longDesc: '切换直觉转向或经典坦克操控，可视化自定义桌面键位并调节手机虚拟按键参数',
    icon: Gamepad2,
  },
  {
    id: 'appearance',
    label: '画面',
    shortDesc: '主题 · 强调色与调试',
    longDesc: '切换全站浅色/深色/跟随系统主题，自由调节强调色并管理音效与性能监控',
    icon: Palette,
  },
  {
    id: 'items',
    label: '道具',
    shortDesc: '掉落 · 效果与特武',
    longDesc: '自定义七类战术道具的刷新频率、掉落权重、持续时长与激光/追踪弹/破片/地雷参数',
    ruleGroups: ['drops', 'items', 'special'],
    icon: Package,
  },
  {
    id: 'gameplay',
    label: '游戏',
    shortDesc: '弹夹 · 弹道与手感',
    longDesc: '调节弹夹容量、补弹节奏、射击冷却及车速/转向/弹速等核心对战手感参数',
    ruleGroups: ['combat', 'advanced'],
    icon: Crosshair,
  },
  {
    id: 'data',
    label: '数据',
    shortDesc: '预设 · 脚本与战绩',
    longDesc: '管理当前模式的命名规则预设、本地自定义 AI 脚本库与历史对局数据',
    icon: Database,
  },
];

interface SettingsViewProps<TRules extends Record<string, unknown>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  games: GameDefinition<any, any>[];
  selectedGame: GameDefinition<TRules, unknown>;
  onSelectGame: (gameId: string) => void;
  gameMode: GameMode;
  onGameModeChange: (mode: GameMode) => void;
  singleMatchup: SingleMatchup;
  onSingleMatchupChange: (matchup: SingleMatchup) => void;
  aiModelBySlot: Record<PlayerSlotId, string>;
  onAiModelChange: (slotId: PlayerSlotId, modelId: string) => void;
  customBotScripts: CustomBotScriptRecord[];
  arenaSeats: ArenaSeatConfig[];
  onArenaSeatsChange: (next: ArenaSeatConfig[]) => void;
  onOpenAiStudio: (tab?: 'prompt' | 'editor') => void;
  profiles: PlayerProfile[];
  bindingsBySlot: Record<PlayerSlotId, Record<string, string>>;
  rules: TRules;
  presets: RulePreset<TRules>[];
  activePresetId: string | null;
  ruleIssues: ValidationIssue[];
  storageNotice: string | null;
  /** 若是从对战暂停层进入，返回时回到暂停状态且不中断对局 */
  inPausedMatch?: boolean;
  onBack: () => void;
  onProfileChange: (slotId: PlayerSlotId, patch: Partial<PlayerProfile>) => void;
  onBindingChange: (slotId: PlayerSlotId, actionId: string, keyCode: string) => void;
  onResetBindings: () => void;
  onChangeRules: (next: TRules) => void;
  onSelectPreset: (presetId: string | null) => void;
  onSaveNewPreset: (name: string) => void;
  onDeletePreset: (presetId: string) => void;
  onResetAllRules: () => void;
  onResetGroupRules: (groupId: string) => void;
  devDebugMode?: boolean;
  onToggleDevDebugMode?: () => void;
  matchHistoryCount?: number;
  onClearMatchHistory?: () => void;
}

/**
 * HeroUI v3 模块化设置中心：
 * - 左侧固定分类导航 + 返回按钮（手机横屏自动折叠为紧凑顶部滑动分类条，保证 >= 44px 触控热区）
 * - 顶部 Header 负责切换模式（单人游戏 / 多人游戏 / AI 乱斗）、游戏选择、外观快切与工坊入口
 * - 右下侧独立滚动工作区，按「基础 / 地图 / 操控 / 画面 / 道具 / 游戏 / 数据」7 大模块清晰归类
 */
export function SettingsView<TRules extends Record<string, unknown>>({
  games,
  selectedGame,
  onSelectGame,
  gameMode,
  onGameModeChange,
  singleMatchup,
  onSingleMatchupChange,
  aiModelBySlot,
  onAiModelChange,
  customBotScripts,
  arenaSeats,
  onArenaSeatsChange,
  onOpenAiStudio,
  profiles,
  bindingsBySlot,
  rules,
  presets,
  activePresetId,
  ruleIssues,
  storageNotice,
  inPausedMatch = false,
  onBack,
  onProfileChange,
  onBindingChange,
  onResetBindings,
  onChangeRules,
  onSelectPreset,
  onSaveNewPreset,
  onDeletePreset,
  onResetAllRules,
  onResetGroupRules,
  devDebugMode = false,
  onToggleDevDebugMode,
  matchHistoryCount = 0,
  onClearMatchHistory,
}: SettingsViewProps<TRules>) {
  const [activeCategory, setActiveCategory] = useState<SettingsCategoryId>('basic');
  const [navDirection, setNavDirection] = useState<1 | -1>(1);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<PlayerSlotId>(
    () => profiles[0]?.slotId ?? 'p1'
  );
  const [capturingTarget, setCapturingTarget] = useState<KeyCaptureTarget | null>(null);
  const [muted, setMuted] = useState(() => soundEngine.isMuted());
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const [dataFeedback, setDataFeedback] = useState<string | null>(null);

  const {
    mode: themeMode,
    resolvedMode,
    accentHex,
    setMode: setThemeMode,
    setAccentHex,
    resetTheme,
  } = useTheme();

  const {
    isMobileOrTablet,
    logicalWidth,
    logicalHeight,
    virtualControlsOpacity,
    setVirtualControlsOpacity,
    fireButtonPos,
    setFireButtonPos,
    isFullscreen,
    canRequestFullscreen,
    requestLandscapeFullscreen,
    exitFullscreen,
  } = useMobileViewport();

  const isCompactNav = isMobileOrTablet || logicalWidth < 960 || logicalHeight <= 540;
  const isCompactViewport = isCompactNav && logicalHeight <= 540;

  const mappedActions =
    rules.controlMode === 'intuitive'
      ? selectedGame.actions.map((a) => {
          if (a.id === 'forward') return { ...a, label: '向上' };
          if (a.id === 'backward') return { ...a, label: '向下' };
          if (a.id === 'turnLeft') return { ...a, label: '向左' };
          if (a.id === 'turnRight') return { ...a, label: '向右' };
          return a;
        })
      : selectedGame.actions;

  const isBrawl = gameMode === 'brawl';
  const brawlHumanProfiles: PlayerProfile[] = arenaSeats
    .filter((s) => s.controller === 'human')
    .slice(0, 2)
    .map((seat, idx) => ({
      slotId: idx === 0 ? 'p1' : 'p2',
      name: seat.name || seat.slotId.toUpperCase(),
      colorHex: seat.colorHex,
    }));

  const humanProfiles = isBrawl
    ? brawlHumanProfiles
    : profiles.filter(
        (p) => resolveSlotController(p.slotId, gameMode, singleMatchup) === 'human'
      );
  const effectiveSelectedSlotId = humanProfiles.some((p) => p.slotId === selectedSlotId)
    ? selectedSlotId
    : humanProfiles[0]?.slotId ?? 'p1';

  const botModels = selectedGame.botModels ?? [];

  // 统计每个设置分类下的规则校验错误数，显示在左侧导航徽标中
  const errorCountByCategory = useMemo(() => {
    const fieldToGroup = new Map(selectedGame.ruleFields.map((f) => [f.key, f.group]));
    const counts = new Map<SettingsCategoryId, number>();
    for (const issue of ruleIssues) {
      if (issue.severity !== 'error') continue;
      const g = fieldToGroup.get(issue.field);
      if (!g) continue;
      const cat = SETTINGS_CATEGORIES.find((c) => c.ruleGroups?.includes(g));
      if (cat) {
        counts.set(cat.id, (counts.get(cat.id) ?? 0) + 1);
      }
    }
    return counts;
  }, [ruleIssues, selectedGame.ruleFields]);

  const currentCategoryMeta =
    SETTINGS_CATEGORIES.find((c) => c.id === activeCategory) ?? SETTINGS_CATEGORIES[0];

  const shortModeLabel =
    gameMode === 'single'
      ? '单人模式'
      : gameMode === 'brawl'
      ? 'AI 乱斗'
      : '多人模式';

  const modeScopeLabel =
    gameMode === 'single'
      ? '单人游戏模式（独立存档）'
      : gameMode === 'brawl'
      ? 'AI 乱斗模式（独立存档）'
      : '多人游戏模式（独立存档）';

  const handleSelectCategory = (id: SettingsCategoryId) => {
    if (id === activeCategory) return;
    const prevIdx = SETTINGS_CATEGORIES.findIndex((c) => c.id === activeCategory);
    const nextIdx = SETTINGS_CATEGORIES.findIndex((c) => c.id === id);
    setNavDirection(nextIdx >= prevIdx ? 1 : -1);
    setCapturingTarget(null);
    setActiveCategory(id);
    if (workspaceRef.current) {
      workspaceRef.current.scrollTop = 0;
    }
  };

  const handleApplyCustomHex = (raw: string) => {
    setHexDraft(raw);
    const normalized = normalizeHexColor(raw);
    if (normalized) {
      setAccentHex(normalized);
    }
  };

  const handleConfirmClearHistory = () => {
    onClearMatchHistory?.();
    setClearModalOpen(false);
    setDataFeedback('已清空本地历史对局记录。');
    window.setTimeout(() => setDataFeedback(null), 2600);
  };

  return (
    <MotionConfig reducedMotion="user">
    <div
      data-testid="settings-shell"
      className={`h-full w-full overflow-hidden drafting-surface flex text-[var(--foreground)] ${
        isCompactNav ? 'flex-col' : 'flex-row'
      }`}
    >
      {/* 桌面端左侧固定导航栏（手机横屏 / 窄屏隐藏，交由顶部滑动标签栏） */}
      {!isCompactNav && (
        <aside
          aria-label="设置分类导航"
          className="flex w-[236px] lg:w-[252px] shrink-0 flex-col bg-[var(--surface)] border-r border-[var(--border)] h-full"
        >
        <div className="shrink-0 h-[56px] px-4 border-b border-[var(--separator)] flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            isIconOnly
            data-testid="settings-back-btn"
            aria-label={inPausedMatch ? '返回暂停界面' : '返回'}
            onPress={onBack}
            className="!w-9 !h-9 !min-w-[36px] !p-0 !rounded-full shrink-0"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          </Button>
          <h1 className="font-display text-base font-extrabold tracking-tight text-[var(--foreground)] truncate">
            设置中心
          </h1>
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-1">
          {SETTINGS_CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const active = cat.id === activeCategory;
            const errCount = errorCountByCategory.get(cat.id) ?? 0;
            return (
              <button
                key={cat.id}
                type="button"
                data-testid={`settings-cat-${cat.id}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => handleSelectCategory(cat.id)}
                className={`w-full min-h-[48px] px-3 py-2 rounded-xl flex items-center gap-3 text-left transition-colors cursor-pointer ${
                  active
                    ? 'bg-[var(--accent)] text-[var(--accent-foreground)] shadow-xs'
                    : 'text-[var(--foreground)] hover:bg-[var(--surface-secondary)]'
                }`}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    active ? 'opacity-100' : 'text-[var(--muted)]'
                  }`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold leading-tight">{cat.label}</span>
                    {errCount > 0 && (
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono-num font-bold leading-none ${
                          active
                            ? 'bg-white/20 text-[var(--accent-foreground)]'
                            : 'bg-red-500/15 text-red-600 dark:text-red-400'
                        }`}
                      >
                        {errCount}
                      </span>
                    )}
                  </div>
                  <div
                    className={`text-[10px] truncate mt-0.5 ${
                      active ? 'opacity-85' : 'text-[var(--muted)]'
                    }`}
                  >
                    {cat.shortDesc}
                  </div>
                </div>
              </button>
            );
          })}
        </nav>
      </aside>
      )}

      {/* 右侧主列：紧凑顶部 Header（左标题+模式，右：圆形主题 → AI工坊 → 药丸分段器） + 移动端分类条 + 右下独立滚动区 */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col h-full">
        {/* 顶部 Header */}
        <header
          className={`shrink-0 bg-[var(--surface)] border-b border-[var(--border)] ${
            isCompactNav ? 'px-3 py-2' : 'px-5 sm:px-6 h-[56px] flex items-center'
          }`}
        >
          <div className="w-full flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              {/* 移动端/窄屏圆形单图标返回按钮 */}
              {isCompactNav && (
                <Button
                  variant="secondary"
                  size="sm"
                  isIconOnly
                  data-testid="settings-mobile-back-btn"
                  aria-label={inPausedMatch ? '返回暂停界面' : '返回'}
                  onPress={onBack}
                  className="!w-9 !h-9 !min-w-[36px] !p-0 !rounded-full shrink-0"
                >
                  <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                </Button>
              )}
              <div className="min-w-0 flex items-center">
                <motion.h2
                  key={`header-${activeCategory}-${shortModeLabel}`}
                  initial={{ opacity: 0, y: navDirection * 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                  className="font-display text-base font-extrabold tracking-tight text-[var(--foreground)] truncate leading-none"
                >
                  {currentCategoryMeta.label}设置（{shortModeLabel}）
                </motion.h2>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {games.length > 1 && (
                <div className="w-32">
                  <AppSelect
                    ariaLabel="选择要配置的游戏"
                    value={selectedGame.id}
                    options={games.map((g) => ({ value: g.id, label: g.name }))}
                    onChange={onSelectGame}
                  />
                </div>
              )}

              {/* 右侧顺序：圆形主题按钮 → AI工坊 → 药丸分段器（统一 h-9 高度） */}
              <ThemeQuickToggle testId="settings-theme-quick-toggle" />

              {selectedGame.aiSdk && (
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="settings-open-studio-btn"
                  onPress={() => onOpenAiStudio('prompt')}
                  className="h-9 px-3.5 !rounded-full whitespace-nowrap shrink-0 font-semibold text-xs"
                >
                  <Code2 className="w-3.5 h-3.5 text-[var(--accent)]" aria-hidden="true" />
                  <span>AI工坊</span>
                </Button>
              )}

              <ModeTabs
                gameMode={gameMode}
                onChange={(nextMode) => {
                  setCapturingTarget(null);
                  onGameModeChange(nextMode);
                }}
                testIdPrefix="settings"
                compact={isCompactViewport}
              />
            </div>
          </div>

          {/* 手机横屏 / 窄屏分类滑动标签栏（44px 触控热区） */}
          {isCompactNav && (
            <nav
              aria-label="移动端设置分类"
              className="mt-2 -mx-1 px-1 flex items-center gap-1.5 overflow-x-auto pb-0.5"
            >
              {SETTINGS_CATEGORIES.map((cat) => {
                const Icon = cat.icon;
                const active = cat.id === activeCategory;
                const errCount = errorCountByCategory.get(cat.id) ?? 0;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    data-testid={`settings-mobile-cat-${cat.id}`}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => handleSelectCategory(cat.id)}
                    className={`min-h-[44px] px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 border transition-colors cursor-pointer ${
                      active
                        ? 'bg-[var(--accent)] text-[var(--accent-foreground)] border-transparent'
                        : 'bg-[var(--surface-secondary)] text-[var(--foreground)] border-[var(--border)]'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>{cat.label}</span>
                    {errCount > 0 && (
                      <span className="font-mono-num text-[10px]">({errCount})</span>
                    )}
                  </button>
                );
              })}
            </nav>
          )}
        </header>

        {/* 右下侧独立滚动设置内容区 */}
        <main
          ref={workspaceRef}
          data-testid="settings-workspace"
          className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 py-4 sm:py-6"
        >
          <div className="max-w-[980px] mx-auto space-y-5">
            {inPausedMatch && (
              <div
                role="status"
                className="flex items-center gap-2.5 px-4 py-3 text-xs font-medium rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-800 dark:text-sky-200"
              >
                <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>
                  当前对局已冻结保持暂停；此处修改的规则、预设、AI 选项与按键会自动保存，并从下一场比赛生效，不会影响正在进行的比赛快照。
                </span>
              </div>
            )}

            {storageNotice && (
              <div
                role="status"
                className="flex items-center gap-2.5 px-4 py-3 text-xs font-medium rounded-xl bg-amber-500/12 border border-amber-500/35 text-amber-800 dark:text-amber-300"
              >
                <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{storageNotice}</span>
              </div>
            )}

            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeCategory}
                data-testid={`settings-panel-${activeCategory}`}
                initial={{ opacity: 0, y: navDirection * 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -navDirection * 8 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
            {/* 1. 基础：赛制规则 + 玩家资料/AI 选阶/乱斗阵容 */}
            {activeCategory === 'basic' && (
              <div className="space-y-6">
                <div
                  data-testid="settings-rules-scope-banner"
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--muted)]"
                >
                  <span>
                    当前配置作用域：
                    <strong className="text-[var(--foreground)] ml-1">
                      {modeScopeLabel}
                    </strong>
                  </span>
                  <span className="text-[11px]">
                    单人、多人与 AI 乱斗各自保存独立规则，互不覆盖
                  </span>
                </div>

                <RulesForm
                  game={selectedGame}
                  rules={rules}
                  presets={presets}
                  activePresetId={activePresetId}
                  issues={ruleIssues}
                  onChangeRules={onChangeRules}
                  onSelectPreset={onSelectPreset}
                  onSaveNewPreset={onSaveNewPreset}
                  onDeletePreset={onDeletePreset}
                  onResetAllRules={onResetAllRules}
                  onResetGroupRules={onResetGroupRules}
                  filterGroupIds={['match']}
                  hideHeader
                  hidePresetBar
                />

                {isBrawl ? (
                  <ArenaRosterPanel
                    game={selectedGame}
                    seats={arenaSeats}
                    customBotScripts={customBotScripts}
                    rules={rules}
                    onSeatsChange={onArenaSeatsChange}
                    onApplyRecommendedMapSize={(cols, rows) =>
                      onChangeRules({
                        ...rules,
                        gridCols: cols,
                        gridRows: rows,
                        mapCode: '',
                      } as TRules)
                    }
                    onOpenAiStudio={onOpenAiStudio}
                  />
                ) : (
                  <PlayerSetupPanel
                    profiles={profiles}
                    actions={mappedActions}
                    bindingsBySlot={bindingsBySlot}
                    gameMode={gameMode}
                    singleMatchup={singleMatchup}
                    onSingleMatchupChange={onSingleMatchupChange}
                    botModels={selectedGame.botModels}
                    customBotScripts={customBotScripts}
                    aiModelBySlot={aiModelBySlot}
                    onAiModelChange={onAiModelChange}
                    onOpenAiStudio={selectedGame.aiSdk ? onOpenAiStudio : undefined}
                    onProfileChange={onProfileChange}
                    onBindingChange={onBindingChange}
                    onResetBindings={onResetBindings}
                    selectedSlotId={effectiveSelectedSlotId}
                    onSelectSlot={setSelectedSlotId}
                    capturingTarget={capturingTarget}
                    onCapturingTargetChange={setCapturingTarget}
                    hideKeybindings
                  />
                )}
              </div>
            )}

            {/* 2. 地图：迷宫尺寸、通路、地图编号与出生策略 */}
            {activeCategory === 'map' && (
              <RulesForm
                game={selectedGame}
                rules={rules}
                presets={presets}
                activePresetId={activePresetId}
                issues={ruleIssues}
                onChangeRules={onChangeRules}
                onSelectPreset={onSelectPreset}
                onSaveNewPreset={onSaveNewPreset}
                onDeletePreset={onDeletePreset}
                onResetAllRules={onResetAllRules}
                onResetGroupRules={onResetGroupRules}
                filterGroupIds={['map']}
                hideHeader
                hidePresetBar
              />
            )}

            {/* 3. 操控：操控模式 + 触控虚拟摇杆透明度与布局 + 桌面可视化键盘改键 */}
            {activeCategory === 'controls' && (
              <div className="space-y-5">
                {/* 操控模式 */}
                {typeof rules.controlMode === 'string' && (
                  <section className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-bold text-[var(--foreground)]">
                          方向操控逻辑
                        </h3>
                        <p className="text-xs text-[var(--muted)] mt-0.5">
                          选择桌面键盘与摇杆驱动坦克的移动方式
                        </p>
                      </div>
                      <Tabs
                        selectedKey={rules.controlMode}
                        onSelectionChange={(key) =>
                          onChangeRules({ ...rules, controlMode: String(key) } as TRules)
                        }
                      >
                        <Tabs.ListContainer>
                          <Tabs.List
                            aria-label="操控模式"
                            className="bg-[var(--surface-secondary)] border border-[var(--border)] p-1 rounded-xl"
                          >
                            <Tabs.Tab
                              id="intuitive"
                              className="px-3 py-1.5 min-h-[38px] text-xs font-bold whitespace-nowrap"
                            >
                              直觉转向（推荐）
                              <Tabs.Indicator />
                            </Tabs.Tab>
                            <Tabs.Tab
                              id="classic"
                              className="px-3 py-1.5 min-h-[38px] text-xs font-bold whitespace-nowrap"
                            >
                              经典坦克
                              <Tabs.Indicator />
                            </Tabs.Tab>
                          </Tabs.List>
                        </Tabs.ListContainer>
                      </Tabs>
                    </div>
                    <p className="text-xs text-[var(--muted)] leading-relaxed bg-[var(--surface-secondary)]/60 rounded-lg px-3 py-2 border border-[var(--border)]">
                      {rules.controlMode === 'intuitive'
                        ? '直觉转向：按屏幕上下左右及 45° 斜向移动，炮口沿最短圆弧平滑转向；轻点方向优先微调角度，转向中任意瞬间开火可打出 360° 弹道。'
                        : '经典坦克：按车头朝向前进/倒车，左右键原地或行进间旋转车体。'}
                    </p>
                  </section>
                )}

                {/* 触控 / 移动端虚拟按键设置 */}
                <section className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-[var(--foreground)]">
                        手机 / 平板触控虚拟按键
                      </h3>
                      <p className="text-xs text-[var(--muted)] mt-0.5">
                        支持左半屏 360° 浮动摇杆、右侧独立开火按键位置自定义与透明度调节
                      </p>
                    </div>
                    {canRequestFullscreen && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onPress={() =>
                          void (isFullscreen ? exitFullscreen() : requestLandscapeFullscreen())
                        }
                        className="min-h-[40px] max-sm:min-h-[44px]"
                      >
                        {isFullscreen ? (
                          <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" />
                        ) : (
                          <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                        {isFullscreen ? '退出全屏' : '全屏横屏'}
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                    <AppSlider
                      label="虚拟摇杆与开火按键透明度"
                      value={virtualControlsOpacity}
                      min={10}
                      max={80}
                      step={5}
                      unit="%"
                      testId="settings-virtual-opacity-slider"
                      onChange={setVirtualControlsOpacity}
                    />
                    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg bg-[var(--surface-secondary)]/65 border border-[var(--border)]">
                      <div className="text-xs">
                        <div className="font-semibold text-[var(--foreground)]">
                          开火按键位置
                        </div>
                        <div className="text-[11px] text-[var(--muted)]">
                          {fireButtonPos
                            ? `已自定义（X ${Math.round(fireButtonPos.xFrac * 100)}% / Y ${Math.round(fireButtonPos.yFrac * 100)}%）`
                            : '默认右下角（对战暂停时可拖拽微调）'}
                        </div>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        isDisabled={!fireButtonPos}
                        onPress={() => setFireButtonPos(null)}
                        className="min-h-[38px] max-sm:min-h-[44px] whitespace-nowrap shrink-0"
                      >
                        恢复默认
                      </Button>
                    </div>
                  </div>
                </section>

                {/* 桌面端键位绑定与视觉键盘 */}
                {humanProfiles.length > 0 ? (
                  <div className="space-y-4">
                    <VisualKeyboard
                      profiles={humanProfiles}
                      actions={mappedActions}
                      bindingsBySlot={bindingsBySlot}
                      selectedSlotId={effectiveSelectedSlotId}
                      capturingTarget={capturingTarget}
                      onSelectSlot={setSelectedSlotId}
                      onAssignKeyFromClick={(keyCode) => {
                        if (!capturingTarget) return;
                        onBindingChange(
                          capturingTarget.slotId,
                          capturingTarget.actionId,
                          keyCode
                        );
                        setCapturingTarget(null);
                      }}
                    />

                    <PlayerSetupPanel
                      profiles={humanProfiles}
                      actions={mappedActions}
                      bindingsBySlot={bindingsBySlot}
                      gameMode="multi"
                      singleMatchup="human_vs_ai"
                      onProfileChange={onProfileChange}
                      onBindingChange={onBindingChange}
                      onResetBindings={onResetBindings}
                      selectedSlotId={effectiveSelectedSlotId}
                      onSelectSlot={setSelectedSlotId}
                      capturingTarget={capturingTarget}
                      onCapturingTargetChange={setCapturingTarget}
                      keybindingsOnly
                    />
                  </div>
                ) : (
                  <section
                    data-testid="ai-spectate-keyboard-placeholder"
                    aria-label="全 AI 观战模式说明"
                    className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[var(--accent)]/15 text-[var(--accent)] flex items-center justify-center shrink-0">
                        <Eye className="w-5 h-5" aria-hidden="true" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-[var(--foreground)]">
                          {isBrawl
                            ? `全 AI 多模型乱斗（${arenaSeats.length} 席观战）`
                            : 'AI vs AI 观战模式（无需配置键盘按键）'}
                        </h3>
                        <p className="text-xs text-[var(--muted)] mt-0.5">
                          当前模式所有席位均由 AI 策略脚本自动决策，对战中仅需按 Esc 暂停或继续观战。
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {(isBrawl
                        ? arenaSeats.map((seat) => ({
                            slotId: seat.slotId,
                            label: seat.name || seat.slotId.toUpperCase(),
                            colorHex: seat.colorHex,
                            selection: resolveSlotAiSelection(
                              seat.aiSource === 'custom'
                                ? `custom:${seat.aiModelId}`
                                : seat.aiModelId,
                              botModels,
                              customBotScripts
                            ),
                          }))
                        : profiles.map((p) => ({
                            slotId: p.slotId,
                            label: `${p.slotId.toUpperCase()} AI 模型`,
                            colorHex: p.colorHex,
                            selection: resolveSlotAiSelection(
                              aiModelBySlot[p.slotId],
                              botModels,
                              customBotScripts
                            ),
                          }))
                      ).map((entry) => (
                        <div
                          key={entry.slotId}
                          className="rounded-xl bg-[var(--surface-secondary)]/65 border border-[var(--border)] p-3.5 space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--foreground)] truncate">
                              <span
                                className="w-2.5 h-2.5 rounded-[3px] shrink-0"
                                style={{ backgroundColor: entry.colorHex }}
                              />
                              {entry.label}
                            </span>
                            {entry.selection && (
                              <span
                                className="text-[11px] font-mono-num font-bold shrink-0"
                                style={{ color: entry.selection.accentColor }}
                              >
                                {entry.selection.tierText}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--foreground)]">
                            <Cpu className="w-3.5 h-3.5 text-[var(--muted)]" aria-hidden="true" />
                            <span className="truncate">
                              {entry.selection?.displayName ?? '战术游击'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}

            {/* 4. 画面：全局浅色/深色/跟随系统 + 6 组强调色预设 + 自由取色 + 音效与调试 */}
            {activeCategory === 'appearance' && (
              <div className="space-y-5">
                {/* 主题明暗模式 */}
                <section className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-[var(--foreground)]">
                        界面外观主题
                      </h3>
                      <p className="text-xs text-[var(--muted)] mt-0.5">
                        全站统一生效，自动匹配 HeroUI 语义表面、边框与高对比度文本
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid="theme-reset-btn"
                      onPress={() => {
                        resetTheme();
                        setHexDraft(null);
                      }}
                      className="min-h-[36px] max-sm:min-h-[42px]"
                    >
                      <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                      重置默认外观
                    </Button>
                  </div>

                  <Tabs
                    selectedKey={themeMode}
                    onSelectionChange={(key) => setThemeMode(String(key) as ThemeMode)}
                  >
                    <Tabs.ListContainer>
                      <Tabs.List
                        aria-label="外观模式"
                        className="bg-[var(--surface-secondary)] border border-[var(--border)] p-1 rounded-xl grid grid-cols-3 w-full sm:w-auto sm:inline-grid"
                      >
                        <Tabs.Tab
                          id="light"
                          data-testid="theme-mode-light"
                          className="px-4 py-2 min-h-[42px] text-xs font-bold flex items-center justify-center gap-1.5"
                        >
                          <Sun className="w-3.5 h-3.5" aria-hidden="true" />
                          浅色（白）
                          <Tabs.Indicator />
                        </Tabs.Tab>
                        <Tabs.Tab
                          id="dark"
                          data-testid="theme-mode-dark"
                          className="px-4 py-2 min-h-[42px] text-xs font-bold flex items-center justify-center gap-1.5"
                        >
                          <Moon className="w-3.5 h-3.5" aria-hidden="true" />
                          深色（暗黑）
                          <Tabs.Indicator />
                        </Tabs.Tab>
                        <Tabs.Tab
                          id="system"
                          data-testid="theme-mode-system"
                          className="px-4 py-2 min-h-[42px] text-xs font-bold flex items-center justify-center gap-1.5"
                        >
                          <Monitor className="w-3.5 h-3.5" aria-hidden="true" />
                          跟随系统
                          <Tabs.Indicator />
                        </Tabs.Tab>
                      </Tabs.List>
                    </Tabs.ListContainer>
                  </Tabs>
                </section>

                {/* 强调色预设 + 自由取色 */}
                <section className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-[var(--foreground)]">
                      全局强调色（Accent Color）
                    </h3>
                    <p className="text-xs text-[var(--muted)] mt-0.5">
                      应用于主按钮、选中导航、滑块与开关，并自动计算 WCAG 文本前景色确保可读性
                    </p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {ACCENT_PRESETS.map((preset) => {
                      const active =
                        accentHex.toUpperCase() === preset.hex.toUpperCase();
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          data-testid={`accent-preset-${preset.id}`}
                          aria-pressed={active}
                          onClick={() => {
                            setAccentHex(preset.hex);
                            setHexDraft(null);
                          }}
                          className={`min-h-[48px] px-3 py-2 rounded-xl border flex items-center justify-between gap-2.5 transition-all cursor-pointer ${
                            active
                              ? 'border-[var(--accent)] bg-[var(--accent)]/12 ring-2 ring-[var(--accent)]/30'
                              : 'border-[var(--border)] bg-[var(--surface-secondary)]/55 hover:border-[var(--accent)]/50'
                          }`}
                        >
                          <span className="flex items-center gap-2.5 min-w-0">
                            <span
                              className="w-6 h-6 rounded-md shrink-0 flex items-center justify-center shadow-xs"
                              style={{ backgroundColor: preset.hex }}
                            >
                              {active && (
                                <Check
                                  className="w-3.5 h-3.5 text-white drop-shadow"
                                  aria-hidden="true"
                                />
                              )}
                            </span>
                            <span className="text-xs font-bold text-[var(--foreground)] truncate">
                              {preset.label}
                            </span>
                          </span>
                          <span className="text-[10px] font-mono-num text-[var(--muted)] shrink-0">
                            {preset.hex}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* 自由取色 + Hex 输入 */}
                  <div className="pt-3 border-t border-[var(--separator)] flex flex-wrap items-center gap-3">
                    <label
                      htmlFor="custom-accent-color-picker"
                      className="inline-flex items-center gap-2.5 text-xs font-semibold text-[var(--foreground)] cursor-pointer"
                    >
                      <span>自由取色</span>
                      <input
                        id="custom-accent-color-picker"
                        data-testid="accent-color-picker"
                        type="color"
                        value={accentHex}
                        onChange={(e) => {
                          setAccentHex(e.target.value);
                          setHexDraft(null);
                        }}
                        className="w-10 h-10 rounded-lg border border-[var(--border)] bg-transparent cursor-pointer p-0.5"
                      />
                    </label>
                    <Input
                      aria-label="自定义强调色 HEX 值"
                      data-testid="accent-hex-input"
                      type="text"
                      maxLength={7}
                      value={hexDraft ?? accentHex}
                      onChange={(e) => handleApplyCustomHex(e.target.value)}
                      onBlur={() => setHexDraft(null)}
                      placeholder="#D9432B"
                      className="w-32 min-h-[40px] max-sm:min-h-[44px] px-3 font-mono-num text-xs bg-[var(--field-background)] text-[var(--field-foreground)] border border-[var(--field-border)] rounded-lg"
                    />
                    <div className="flex-1 min-w-[200px] flex items-center justify-end gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        className="accent-solid-btn pointer-events-none"
                      >
                        <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                        主按钮预览
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="pointer-events-none"
                      >
                        次按钮预览
                      </Button>
                    </div>
                  </div>
                </section>

                {/* 音效与开发者监控 */}
                <section className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-3.5">
                  <h3 className="text-sm font-bold text-[var(--foreground)]">
                    音效与调试显示
                  </h3>

                  <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-[var(--surface-secondary)]/60 border border-[var(--border)]">
                    <div className="flex items-center gap-2.5">
                      {muted ? (
                        <VolumeX className="w-4 h-4 text-[var(--muted)]" aria-hidden="true" />
                      ) : (
                        <Volume2 className="w-4 h-4 text-[var(--accent)]" aria-hidden="true" />
                      )}
                      <div>
                        <div className="text-xs font-bold text-[var(--foreground)]">
                          战场合成音效
                        </div>
                        <div className="text-[11px] text-[var(--muted)]">
                          开火、反弹、道具拾取与爆破音效
                        </div>
                      </div>
                    </div>
                    <AppSwitch
                      ariaLabel="开启战场合成音效"
                      isSelected={!muted}
                      onChange={() => setMuted(soundEngine.toggleMute())}
                      label={muted ? '已静音' : '已开启'}
                    />
                  </div>

                  {onToggleDevDebugMode && (
                    <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-[var(--surface-secondary)]/60 border border-[var(--border)]">
                      <div className="space-y-0.5 max-w-xl">
                        <div className="text-xs font-bold text-[var(--foreground)]">
                          开发者调试模式（FPS / 内存 / AI 战术叠加层）
                        </div>
                        <p className="text-[11px] text-[var(--muted)]">
                          开启后将在对战中显示帧率曲线、单步 AI 耗时与弹道预测可视化；也可按{' '}
                          <span className="font-mono-num font-semibold text-[var(--foreground)]">
                            F3
                          </span>{' '}
                          或{' '}
                          <span className="font-mono-num font-semibold text-[var(--foreground)]">
                            Ctrl+Shift+D
                          </span>{' '}
                          快速切换。
                        </p>
                      </div>
                      <AppSwitch
                        ariaLabel="开启开发者调试模式"
                        testId="settings-dev-debug-switch"
                        isSelected={devDebugMode}
                        onChange={() => onToggleDevDebugMode()}
                        label={devDebugMode ? '已开启' : '已关闭'}
                      />
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* 5. 道具：掉落与权重 / 道具与效果 / 特殊攻击 */}
            {activeCategory === 'items' && (
              <RulesForm
                game={selectedGame}
                rules={rules}
                presets={presets}
                activePresetId={activePresetId}
                issues={ruleIssues}
                onChangeRules={onChangeRules}
                onSelectPreset={onSelectPreset}
                onSaveNewPreset={onSaveNewPreset}
                onDeletePreset={onDeletePreset}
                onResetAllRules={onResetAllRules}
                onResetGroupRules={onResetGroupRules}
                filterGroupIds={['drops', 'items', 'special']}
                hideHeader
                hidePresetBar
              />
            )}

            {/* 6. 游戏：坦克与普通弹（排除操控模式）+ 高级手感参数 */}
            {activeCategory === 'gameplay' && (
              <div className="space-y-4">
                <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--muted)]">
                  <Crosshair
                    className="w-4 h-4 text-[var(--accent)] shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>
                    <strong className="text-[var(--foreground)]">弹径规格说明：</strong>
                    普通子弹（含连发）与散弹已缩小一半至{' '}
                    <span className="font-mono-num font-bold text-[var(--foreground)]">2.5px</span>{' '}
                    精巧弹径（视觉绘制、物理碰撞与 AI 预判全链路同步）；追踪弹、破片弹、激光与地雷保持原尺寸。
                  </span>
                </div>

                <RulesForm
                  game={selectedGame}
                  rules={rules}
                  presets={presets}
                  activePresetId={activePresetId}
                  issues={ruleIssues}
                  onChangeRules={onChangeRules}
                  onSelectPreset={onSelectPreset}
                  onSaveNewPreset={onSaveNewPreset}
                  onDeletePreset={onDeletePreset}
                  onResetAllRules={onResetAllRules}
                  onResetGroupRules={onResetGroupRules}
                  filterGroupIds={['combat', 'advanced']}
                  excludeFieldKeys={['controlMode']}
                  hideHeader
                  hidePresetBar
                />
              </div>
            )}

            {/* 7. 数据：规则预设管理 + AI 脚本库摘要 + 战绩清除确认 */}
            {activeCategory === 'data' && (
              <div className="space-y-5">
                <div className="space-y-2">
                  <h3 className="text-sm font-bold text-[var(--foreground)]">
                    命名规则预设（{modeScopeLabel}）
                  </h3>
                  <RulePresetsPanel
                    presets={presets}
                    activePresetId={activePresetId}
                    issues={ruleIssues}
                    onSelectPreset={onSelectPreset}
                    onSaveNewPreset={onSaveNewPreset}
                    onDeletePreset={onDeletePreset}
                    onResetAllRules={onResetAllRules}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* AI 脚本库 */}
                  <section className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-5 flex flex-col justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-bold text-[var(--foreground)]">
                          本地 AI 脚本库
                        </h3>
                        <span className="font-mono-num text-xs font-bold text-[var(--accent)]">
                          {customBotScripts.length} 份脚本
                        </span>
                      </div>
                      <p className="text-xs text-[var(--muted)] leading-relaxed">
                        支持导入/导出 JSON 脚本包，以及在独立 Web Worker 沙箱内试跑校验大模型生成的策略代码。
                      </p>
                    </div>
                    {selectedGame.aiSdk && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onPress={() => onOpenAiStudio('editor')}
                        className="min-h-[40px] max-sm:min-h-[44px] w-full sm:w-auto self-start"
                      >
                        <Code2 className="w-4 h-4 text-[var(--accent)]" aria-hidden="true" />
                        打开 AI 脚本工坊管理
                      </Button>
                    )}
                  </section>

                  {/* 历史对局战绩 */}
                  <section className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-5 flex flex-col justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-bold text-[var(--foreground)]">
                          本地对局历史与录像
                        </h3>
                        <span className="font-mono-num text-xs font-bold text-[var(--foreground)]">
                          {matchHistoryCount} 场记录
                        </span>
                      </div>
                      <p className="text-xs text-[var(--muted)] leading-relaxed">
                        保存最近对局的比分、战力雷达数据与压缩录像帧；清空后不可恢复。
                      </p>
                    </div>
                    <Button
                      variant="danger-soft"
                      size="sm"
                      data-testid="settings-clear-history-btn"
                      isDisabled={!onClearMatchHistory || matchHistoryCount === 0}
                      onPress={() => setClearModalOpen(true)}
                      className="min-h-[40px] max-sm:min-h-[44px] w-full sm:w-auto self-start"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                      清空历史战绩
                    </Button>
                  </section>
                </div>

                {dataFeedback && (
                  <p
                    role="status"
                    className="text-xs font-semibold text-emerald-600 dark:text-emerald-400"
                  >
                    {dataFeedback}
                  </p>
                )}
              </div>
            )}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* HeroUI Modal 二次确认清空历史战绩 */}
      <Modal.Backdrop
        isOpen={clearModalOpen}
        onOpenChange={setClearModalOpen}
        variant="opaque"
      >
        <Modal.Container placement="center" size="sm">
          <Modal.Dialog className="bg-[var(--overlay)] text-[var(--overlay-foreground)] border border-[var(--border)] rounded-2xl p-5 shadow-2xl space-y-4">
            <Modal.Header className="space-y-1">
              <Modal.Heading className="text-base font-extrabold text-[var(--foreground)]">
                确认清空历史战绩？
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body className="text-xs text-[var(--muted)] leading-relaxed">
              将永久删除本地保存的 {matchHistoryCount} 场对局战绩统计与录像数据。玩家配置、按键映射、规则预设与自定义 AI 脚本库不受影响。
            </Modal.Body>
            <Modal.Footer className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                size="sm"
                onPress={() => setClearModalOpen(false)}
                className="min-h-[40px]"
              >
                取消
              </Button>
              <Button
                variant="danger"
                size="sm"
                data-testid="confirm-clear-history-btn"
                onPress={handleConfirmClearHistory}
                className="min-h-[40px]"
              >
                确认清空
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
    </MotionConfig>
  );
}
