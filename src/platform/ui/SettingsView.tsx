import { useMemo, useRef, useState } from 'react';
import { Button, Input, Modal } from '@heroui/react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Check,
  Code2,
  Cpu,
  Crosshair,
  Database,
  Eye,
  Gamepad2,
  History,
  Map as MapIcon,
  Maximize2,
  Minimize2,
  Monitor,
  Moon,
  Package,
  Palette,
  RotateCcw,
  SlidersHorizontal,
  Smartphone,
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
import { TankItemsArmoryPanel } from '../../games/tank-battle/ui/TankItemsArmoryPanel';
import type { TankBattleRules } from '../../games/tank-battle/types';
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
  PillSegmentedControl,
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
  ruleGroups?: string[];
  icon: typeof SlidersHorizontal;
}

const SETTINGS_CATEGORIES: SettingsCategoryMeta[] = [
  {
    id: 'basic',
    label: '基础',
    shortDesc: '赛制 · 阵容',
    ruleGroups: ['match'],
    icon: SlidersHorizontal,
  },
  {
    id: 'map',
    label: '地图',
    shortDesc: '迷宫 · 出生',
    ruleGroups: ['map'],
    icon: MapIcon,
  },
  {
    id: 'controls',
    label: '操控',
    shortDesc: '转向 · 键位',
    icon: Gamepad2,
  },
  {
    id: 'appearance',
    label: '画面',
    shortDesc: '主题 · 音效',
    icon: Palette,
  },
  {
    id: 'items',
    label: '道具',
    shortDesc: '军械 · 刷新',
    ruleGroups: ['drops', 'items', 'special'],
    icon: Package,
  },
  {
    id: 'gameplay',
    label: '游戏',
    shortDesc: '弹夹 · 手感',
    ruleGroups: ['combat', 'advanced'],
    icon: Crosshair,
  },
  {
    id: 'data',
    label: '数据',
    shortDesc: '预设 · 战绩',
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
 * 游戏 App 风格模块化设置中心：
 * - 左侧固定分类导航 + 圆形单图标返回；顶部紧凑 56px Header（主题圆钮 / AI工坊 / 药丸分段器）
 * - 右下独立滚动工作区：全面去冗余描述，统一药丸分段器、圆形 +- 步进器、双列战备卡与道具军械库卡片网格
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
  const brawlHumanCount = arenaSeats.filter((s) => s.controller === 'human').length;
  const humanProfiles = isBrawl
    ? profiles.slice(0, Math.min(2, brawlHumanCount))
    : profiles.filter(
        (p) => resolveSlotController(p.slotId, gameMode, singleMatchup) === 'human'
      );

  const effectiveSelectedSlotId = humanProfiles.some((p) => p.slotId === selectedSlotId)
    ? selectedSlotId
    : humanProfiles[0]?.slotId ?? profiles[0]?.slotId ?? 'p1';

  const errorCountByCategory = useMemo(() => {
    const fieldToGroup = new Map(selectedGame.ruleFields.map((f) => [f.key, f.group]));
    const counts = new Map<SettingsCategoryId, number>();
    for (const issue of ruleIssues) {
      if (issue.severity !== 'error') continue;
      const g = fieldToGroup.get(issue.field);
      if (!g) continue;
      const cat = SETTINGS_CATEGORIES.find((c) => c.ruleGroups?.includes(g));
      if (cat) counts.set(cat.id, (counts.get(cat.id) ?? 0) + 1);
    }
    return counts;
  }, [ruleIssues, selectedGame.ruleFields]);

  const currentCategoryMeta =
    SETTINGS_CATEGORIES.find((c) => c.id === activeCategory) ?? SETTINGS_CATEGORIES[0];

  const handleSelectCategory = (nextId: SettingsCategoryId) => {
    if (nextId === activeCategory) return;
    const prevIdx = SETTINGS_CATEGORIES.findIndex((c) => c.id === activeCategory);
    const nextIdx = SETTINGS_CATEGORIES.findIndex((c) => c.id === nextId);
    setNavDirection(nextIdx >= prevIdx ? 1 : -1);
    setActiveCategory(nextId);
    workspaceRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  };

  const shortModeLabel =
    gameMode === 'single' ? '单人模式' : gameMode === 'brawl' ? 'AI乱斗' : '多人模式';

  const botModels = selectedGame.botModels ?? [];

  const handleApplyCustomHex = (raw: string) => {
    setHexDraft(raw);
    const trimmed = raw.trim();
    if (/^#?[0-9a-fA-F]{6}$/.test(trimmed) || /^#?[0-9a-fA-F]{3}$/.test(trimmed)) {
      setAccentHex(normalizeHexColor(trimmed));
    }
  };

  const handleConfirmClearHistory = () => {
    onClearMatchHistory?.();
    setClearModalOpen(false);
    setDataFeedback('已清空全部历史战绩与录像记录。');
    window.setTimeout(() => setDataFeedback(null), 2600);
  };

  return (
    <MotionConfig reducedMotion="user">
    <div
      data-testid="settings-shell"
      className="h-full w-full overflow-hidden flex bg-[var(--background)] text-[var(--foreground)]"
    >
      {/* 桌面端左侧固定导航栏 */}
      {!isCompactNav && (
        <aside
          aria-label="设置分类导航"
          className="flex w-[228px] lg:w-[244px] shrink-0 flex-col bg-[var(--surface)] border-r border-[var(--border)] h-full"
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
                  className={`w-full min-h-[46px] px-3 py-2 rounded-xl flex items-center gap-3 text-left transition-colors cursor-pointer ${
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
                          className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono-num font-bold leading-none ${
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

      {/* 右侧主列 */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col h-full">
        {/* 顶部 Header */}
        <header
          className={`shrink-0 bg-[var(--surface)] border-b border-[var(--border)] ${
            isCompactNav ? 'px-3 py-2' : 'px-5 sm:px-6 h-[56px] flex items-center'
          }`}
        >
          <div className="w-full flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
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
                  {customBotScripts.length > 0 && (
                    <span className="font-mono-num text-[var(--accent)]">
                      ({customBotScripts.length})
                    </span>
                  )}
                </Button>
              )}

              <ModeTabs
                gameMode={gameMode}
                onChange={onGameModeChange}
                testIdPrefix="settings"
                compact={isCompactViewport}
              />
            </div>
          </div>

          {/* 手机横屏 / 窄屏分类滑动药丸条 */}
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
                    className={`min-h-[40px] px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 border transition-colors cursor-pointer ${
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

        {/* 右下侧独立滚动设置内容区（宽幅 1120px 游戏化网格布局） */}
        <main
          ref={workspaceRef}
          data-testid="settings-workspace"
          className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 py-4 sm:py-5 drafting-surface"
        >
          <div className="max-w-[1120px] mx-auto space-y-4">
            {inPausedMatch && (
              <div
                role="status"
                className="flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-800 dark:text-sky-200"
              >
                <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>对局已暂停，修改将在下场生效。</span>
              </div>
            )}

            {storageNotice && (
              <div
                role="status"
                className="flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium rounded-xl bg-amber-500/12 border border-amber-500/35 text-amber-800 dark:text-amber-300"
              >
                <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{storageNotice}</span>
              </div>
            )}

            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeCategory}
                data-testid={`settings-panel-${activeCategory}`}
                initial={{ opacity: 0, y: navDirection * 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -navDirection * 6 }}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              >
                {/* 1. 基础：3列紧凑赛制步进卡 + 双列玩家/AI战备卡或乱斗编队 */}
                {activeCategory === 'basic' && (
                  <div className="space-y-5">
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
                      columns={3}
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

                {/* 2. 地图：3列步进器（宽/高/环路）+ 地图码 + 药丸出生切换 */}
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
                    columns={3}
                    hideHeader
                    hidePresetBar
                  />
                )}

                {/* 3. 操控：药丸转向切换 + 紧凑触控参数 + 视觉键盘 */}
                {activeCategory === 'controls' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {typeof rules.controlMode === 'string' && (
                        <section className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col justify-between gap-3">
                          <div className="flex flex-wrap items-center justify-between gap-2.5">
                            <div className="flex items-center gap-2">
                              <span className="w-7 h-7 rounded-lg bg-[var(--accent)]/12 text-[var(--accent)] flex items-center justify-center shrink-0">
                                <Gamepad2 className="w-4 h-4" aria-hidden="true" />
                              </span>
                              <h3 className="text-sm font-bold text-[var(--foreground)]">
                                方向操控
                              </h3>
                            </div>
                            <PillSegmentedControl
                              ariaLabel="操控模式"
                              compact
                              selectedKey={rules.controlMode}
                              onChange={(key) =>
                                onChangeRules({ ...rules, controlMode: key } as TRules)
                              }
                              options={[
                                { id: 'intuitive', label: '直觉转向' },
                                { id: 'classic', label: '经典坦克' },
                              ]}
                            />
                          </div>
                          <p className="text-xs text-[var(--muted)]">
                            {rules.controlMode === 'intuitive'
                              ? '按屏幕方向直接移动，炮口平滑跟随。'
                              : '车头方向进退，左右键旋转车体。'}
                          </p>
                        </section>
                      )}

                      {/* 移动端触控虚拟按键 */}
                      <section className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="w-7 h-7 rounded-lg bg-[var(--accent)]/12 text-[var(--accent)] flex items-center justify-center shrink-0">
                              <Smartphone className="w-4 h-4" aria-hidden="true" />
                            </span>
                            <h3 className="text-sm font-bold text-[var(--foreground)]">
                              触控按键
                            </h3>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {canRequestFullscreen && (
                              <Button
                                variant="secondary"
                                size="sm"
                                onPress={() =>
                                  void (isFullscreen
                                    ? exitFullscreen()
                                    : requestLandscapeFullscreen())
                                }
                                className="h-8 px-3 !rounded-full text-xs font-semibold"
                              >
                                {isFullscreen ? (
                                  <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" />
                                ) : (
                                  <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
                                )}
                                {isFullscreen ? '退出全屏' : '全屏'}
                              </Button>
                            )}
                            <Button
                              variant="secondary"
                              size="sm"
                              isDisabled={!fireButtonPos}
                              onPress={() => setFireButtonPos(null)}
                              className="h-8 px-3 !rounded-full text-xs font-semibold whitespace-nowrap"
                            >
                              重置开火位
                            </Button>
                          </div>
                        </div>

                        <AppSlider
                          label="虚拟按键透明度"
                          value={virtualControlsOpacity}
                          min={10}
                          max={80}
                          step={5}
                          unit="%"
                          testId="settings-virtual-opacity-slider"
                          onChange={setVirtualControlsOpacity}
                        />
                      </section>
                    </div>

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
                        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 space-y-3"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="w-8 h-8 rounded-xl bg-[var(--accent)]/12 text-[var(--accent)] flex items-center justify-center shrink-0">
                            <Eye className="w-4 h-4" aria-hidden="true" />
                          </span>
                          <h3 className="text-sm font-bold text-[var(--foreground)]">
                            {isBrawl
                              ? `全 AI 乱斗观战（${arenaSeats.length} 席）`
                              : 'AI vs AI 观战（无需键盘映射）'}
                          </h3>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
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
                                label: p.slotId.toUpperCase(),
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
                              className="rounded-xl bg-[var(--surface-secondary)]/60 border border-[var(--border)] px-3 py-2.5 space-y-1"
                            >
                              <div className="flex items-center justify-between gap-1.5">
                                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--foreground)] truncate">
                                  <span
                                    className="w-2.5 h-2.5 rounded-full shrink-0"
                                    style={{ backgroundColor: entry.colorHex }}
                                  />
                                  {entry.label}
                                </span>
                                {entry.selection && (
                                  <span
                                    className="text-[10px] font-mono-num font-bold shrink-0"
                                    style={{ color: entry.selection.accentColor }}
                                  >
                                    {entry.selection.tierText.split(' · ')[0]}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 text-xs font-semibold text-[var(--muted)] truncate">
                                <Cpu className="w-3 h-3 shrink-0" aria-hidden="true" />
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

                {/* 4. 画面：药丸主题切换 + 紧凑强调色卡 + 双列音效/调试 */}
                {activeCategory === 'appearance' && (
                  <div className="space-y-4">
                    {/* 主题与强调色统一视觉卡 */}
                    <section className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--separator)]">
                        <div className="flex items-center gap-2">
                          <span className="w-7 h-7 rounded-lg bg-[var(--accent)]/12 text-[var(--accent)] flex items-center justify-center shrink-0">
                            <Palette className="w-4 h-4" aria-hidden="true" />
                          </span>
                          <h3 className="text-sm font-bold text-[var(--foreground)]">
                            主题与配色
                          </h3>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <PillSegmentedControl
                            ariaLabel="外观模式"
                            compact
                            selectedKey={themeMode}
                            onChange={(key) => setThemeMode(key as ThemeMode)}
                            options={[
                              {
                                id: 'light',
                                label: '浅色',
                                icon: <Sun className="w-3.5 h-3.5" aria-hidden="true" />,
                                testId: 'theme-mode-light',
                              },
                              {
                                id: 'dark',
                                label: '深色',
                                icon: <Moon className="w-3.5 h-3.5" aria-hidden="true" />,
                                testId: 'theme-mode-dark',
                              },
                              {
                                id: 'system',
                                label: '跟随系统',
                                icon: <Monitor className="w-3.5 h-3.5" aria-hidden="true" />,
                                testId: 'theme-mode-system',
                              },
                            ]}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid="theme-reset-btn"
                            onPress={() => {
                              resetTheme();
                              setHexDraft(null);
                            }}
                            className="h-9 px-3 !rounded-full text-xs font-semibold"
                          >
                            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                            重置
                          </Button>
                        </div>
                      </div>

                      {/* 强调色 6 组预设 */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
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
                              className={`min-h-[46px] px-3 py-2 rounded-xl border flex items-center gap-2.5 transition-all cursor-pointer ${
                                active
                                  ? 'border-[var(--accent)] bg-[var(--accent)]/12 ring-2 ring-[var(--accent)]/25'
                                  : 'border-[var(--border)] bg-[var(--surface-secondary)]/55 hover:border-[var(--accent)]/50'
                              }`}
                            >
                              <span
                                className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center shadow-xs"
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
                            </button>
                          );
                        })}
                      </div>

                      {/* 自定义取色行 */}
                      <div className="pt-2.5 border-t border-[var(--separator)] flex flex-wrap items-center gap-3">
                        <label
                          htmlFor="custom-accent-color-picker"
                          className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--foreground)] cursor-pointer"
                        >
                          <span>自定义色</span>
                          <input
                            id="custom-accent-color-picker"
                            data-testid="accent-color-picker"
                            type="color"
                            value={accentHex}
                            onChange={(e) => {
                              setAccentHex(e.target.value);
                              setHexDraft(null);
                            }}
                            className="w-8 h-8 rounded-full border border-[var(--border)] bg-transparent cursor-pointer p-0.5"
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
                          placeholder="#E85D3F"
                          className="w-28 h-9 px-3 font-mono-num text-xs bg-[var(--field-background)] text-[var(--field-foreground)] border border-[var(--field-border)] rounded-full"
                        />
                      </div>
                    </section>

                    {/* 音效与调试双列紧凑开关卡 */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <section className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-4 py-3.5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-9 h-9 rounded-xl bg-[var(--accent)]/12 text-[var(--accent)] flex items-center justify-center shrink-0">
                            {muted ? (
                              <VolumeX className="w-4 h-4 text-[var(--muted)]" aria-hidden="true" />
                            ) : (
                              <Volume2 className="w-4 h-4" aria-hidden="true" />
                            )}
                          </span>
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-[var(--foreground)] truncate">
                              战场音效
                            </div>
                            <div className="text-[11px] text-[var(--muted)] truncate">
                              开火 · 反弹 · 爆破
                            </div>
                          </div>
                        </div>
                        <AppSwitch
                          ariaLabel="开启战场合成音效"
                          isSelected={!muted}
                          onChange={() => setMuted(soundEngine.toggleMute())}
                        />
                      </section>

                      {onToggleDevDebugMode && (
                        <section className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-4 py-3.5 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="w-9 h-9 rounded-xl bg-[var(--accent)]/12 text-[var(--accent)] flex items-center justify-center shrink-0">
                              <Activity className="w-4 h-4" aria-hidden="true" />
                            </span>
                            <div className="min-w-0">
                              <div className="text-sm font-bold text-[var(--foreground)] truncate">
                                调试叠加层
                              </div>
                              <div className="text-[11px] font-mono-num text-[var(--muted)] truncate">
                                FPS / AI 预测 · F3
                              </div>
                            </div>
                          </div>
                          <AppSwitch
                            ariaLabel="开启开发者调试模式"
                            testId="settings-dev-debug-switch"
                            isSelected={devDebugMode}
                            onChange={() => onToggleDevDebugMode()}
                          />
                        </section>
                      )}
                    </div>
                  </div>
                )}

                {/* 5. 道具：游戏化军械库卡片网格（7大道具复用高清战场图标 + 点击弹窗调校） */}
                {activeCategory === 'items' &&
                  (selectedGame.id === 'tank-battle' ? (
                    <TankItemsArmoryPanel
                      rules={rules as unknown as TankBattleRules}
                      issues={ruleIssues}
                      onChangeRules={(next) =>
                        onChangeRules(next as unknown as TRules)
                      }
                    />
                  ) : (
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
                      columns={3}
                      hideHeader
                      hidePresetBar
                    />
                  ))}

                {/* 6. 游戏：3列圆形步进器（常规火力 / 高级手感，药丸切换，无文字墙） */}
                {activeCategory === 'gameplay' && (
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
                    columns={3}
                    hideHeader
                    hidePresetBar
                  />
                )}

                {/* 7. 数据：预设管理 + 游戏风数字统计双卡 */}
                {activeCategory === 'data' && (
                  <div className="space-y-4">
                    <RulePresetsPanel
                      presets={presets}
                      activePresetId={activePresetId}
                      issues={ruleIssues}
                      onSelectPreset={onSelectPreset}
                      onSaveNewPreset={onSaveNewPreset}
                      onDeletePreset={onDeletePreset}
                      onResetAllRules={onResetAllRules}
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <section className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-11 h-11 rounded-2xl bg-[var(--accent)]/12 text-[var(--accent)] flex items-center justify-center shrink-0">
                            <Code2 className="w-5 h-5" aria-hidden="true" />
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-[var(--muted)]">
                              本地 AI 脚本库
                            </div>
                            <div className="font-display text-2xl font-extrabold font-mono-num text-[var(--foreground)] leading-tight">
                              {customBotScripts.length}
                              <span className="text-xs font-sans font-semibold text-[var(--muted)] ml-1">
                                份
                              </span>
                            </div>
                          </div>
                        </div>
                        {selectedGame.aiSdk && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onPress={() => onOpenAiStudio('editor')}
                            className="h-9 px-3.5 !rounded-full font-semibold shrink-0"
                          >
                            管理脚本
                          </Button>
                        )}
                      </section>

                      <section className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-11 h-11 rounded-2xl bg-[var(--surface-secondary)] text-[var(--foreground)] border border-[var(--border)] flex items-center justify-center shrink-0">
                            <History className="w-5 h-5" aria-hidden="true" />
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-[var(--muted)]">
                              对局历史记录
                            </div>
                            <div className="font-display text-2xl font-extrabold font-mono-num text-[var(--foreground)] leading-tight">
                              {matchHistoryCount}
                              <span className="text-xs font-sans font-semibold text-[var(--muted)] ml-1">
                                场
                              </span>
                            </div>
                          </div>
                        </div>
                        <Button
                          variant="danger-soft"
                          size="sm"
                          data-testid="settings-clear-history-btn"
                          isDisabled={!onClearMatchHistory || matchHistoryCount === 0}
                          onPress={() => setClearModalOpen(true)}
                          className="h-9 px-3.5 !rounded-full font-semibold shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          清空
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
              将永久删除 {matchHistoryCount} 场对局战绩与录像数据，规则预设与 AI 脚本库不受影响。
            </Modal.Body>
            <Modal.Footer className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                size="sm"
                onPress={() => setClearModalOpen(false)}
                className="h-9 px-4 !rounded-full"
              >
                取消
              </Button>
              <Button
                variant="danger"
                size="sm"
                data-testid="confirm-clear-history-btn"
                onPress={handleConfirmClearHistory}
                className="h-9 px-4 !rounded-full font-bold"
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
