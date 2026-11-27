import { Button } from '@heroui/react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Code2,
  Gamepad2,
  Play,
  SlidersHorizontal,
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
import {
  validateBindings,
  validatePlayerColors,
  validatePlayerName,
} from '../input/bindings';
import { RulePresetsPanel, RulesForm } from '../settings/RulesForm';
import { ArenaRosterPanel, validateArenaSeats } from './ArenaRosterPanel';
import { PlayerSetupPanel, resolveSlotController } from './PlayerSetupPanel';
import { ModeTabs, PillSegmentedControl, ThemeQuickToggle } from './heroUiHelpers';

interface PreMatchViewProps<TRules extends Record<string, unknown>> {
  game: GameDefinition<TRules, unknown>;
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
  onOpenSettings: () => void;
  profiles: PlayerProfile[];
  bindingsBySlot: Record<PlayerSlotId, Record<string, string>>;
  rules: TRules;
  presets: RulePreset<TRules>[];
  activePresetId: string | null;
  ruleIssues: ValidationIssue[];
  storageNotice: string | null;
  onBackToLobby: () => void;
  onProfileChange: (slotId: PlayerSlotId, patch: Partial<PlayerProfile>) => void;
  onBindingChange: (slotId: PlayerSlotId, actionId: string, keyCode: string) => void;
  onResetBindings: () => void;
  onChangeRules: (next: TRules) => void;
  onSelectPreset: (presetId: string | null) => void;
  onSaveNewPreset: (name: string) => void;
  onDeletePreset: (presetId: string) => void;
  onResetAllRules: () => void;
  onResetGroupRules: (groupId: string) => void;
  onStartMatch: () => void;
}

/**
 * 对战备战台（赛前配置页，与设置中心共享游戏化步进器、药丸分段器与双列战备卡）：
 * - 固定精简顶栏：圆形返回 + 标题 | 圆形主题、AI工坊、药丸模式分段器、开战主按钮
 * - 左侧主战席位区：P1/P2 双列战备卡 或 2～8 席乱斗双列编队
 * - 右侧精简核心规则区：规则预设 + 药丸操控切换 + 赛制/地图圆形步进器 + 前往设置中心
 */
export function PreMatchView<TRules extends Record<string, unknown>>({
  game,
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
  onOpenSettings,
  profiles,
  bindingsBySlot,
  rules,
  presets,
  activePresetId,
  ruleIssues,
  storageNotice,
  onBackToLobby,
  onProfileChange,
  onBindingChange,
  onResetBindings,
  onChangeRules,
  onSelectPreset,
  onSaveNewPreset,
  onDeletePreset,
  onResetAllRules,
  onResetGroupRules,
  onStartMatch,
}: PreMatchViewProps<TRules>) {
  const isBrawl = gameMode === 'brawl';
  const arenaValidation = validateArenaSeats(arenaSeats);

  const humanSlotIds = isBrawl
    ? arenaSeats
        .filter((s) => s.controller === 'human')
        .slice(0, 2)
        .map((_, idx) => (idx === 0 ? 'p1' : 'p2'))
    : profiles
        .filter((p) => resolveSlotController(p.slotId, gameMode, singleMatchup) === 'human')
        .map((p) => p.slotId);

  const nameHasError = isBrawl
    ? Object.keys(arenaValidation.nameErrors).length > 0
    : profiles.some((p) => validatePlayerName(p.name) !== null);
  const colorHasError = isBrawl
    ? Object.keys(arenaValidation.colorErrors).length > 0
    : Object.keys(validatePlayerColors(profiles)).length > 0;
  const bindingRes = validateBindings(humanSlotIds, game.actions, bindingsBySlot);
  const ruleHasError = ruleIssues.some((i) => i.severity === 'error');

  const canStart = isBrawl
    ? arenaValidation.valid && bindingRes.valid && !ruleHasError
    : !nameHasError && !colorHasError && bindingRes.valid && !ruleHasError;

  const blockerReasons: string[] = [];
  if (nameHasError) blockerReasons.push('名称无效');
  if (colorHasError) blockerReasons.push('涂装颜色重复');
  if (!bindingRes.valid) blockerReasons.push('存在按键冲突');
  if (ruleHasError) blockerReasons.push('规则参数存在错误');

  const startButtonLabel = isBrawl
    ? `开始 ${arenaSeats.length} 席乱斗`
    : gameMode === 'single' && singleMatchup === 'ai_vs_ai'
    ? '开始 AI 观战'
    : '开始比赛';

  const hasControlMode = typeof rules.controlMode === 'string';

  return (
    <div className="min-h-full drafting-surface flex flex-col text-[var(--foreground)]">
      {/* 精简统一顶栏 */}
      <header className="sticky top-0 z-20 min-h-[56px] bg-[var(--surface)]/95 border-b border-[var(--border)] px-3 sm:px-6 py-2 flex items-center">
        <div className="max-w-[1400px] w-full mx-auto flex flex-wrap items-center justify-between gap-2.5 sm:gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <Button
              variant="secondary"
              size="sm"
              isIconOnly
              onPress={onBackToLobby}
              aria-label="返回大厅"
              className="!w-9 !h-9 !min-w-[36px] !p-0 !rounded-full shrink-0"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            </Button>
            <h1 className="font-display text-base sm:text-lg font-extrabold tracking-tight text-[var(--foreground)] truncate">
              {game.name} · 赛前备战
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <ThemeQuickToggle testId="prematch-theme-quick-toggle" />

            {game.aiSdk && (
              <Button
                variant="secondary"
                size="sm"
                data-testid="open-ai-studio-btn"
                onPress={() => onOpenAiStudio('prompt')}
                className="h-9 px-3.5 !rounded-full whitespace-nowrap shrink-0 font-semibold"
              >
                <Code2 className="w-3.5 h-3.5 text-[var(--accent)]" aria-hidden="true" />
                AI工坊
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
              testIdPrefix="prematch"
            />

            <Button
              variant="primary"
              size="sm"
              data-start="true"
              isDisabled={!canStart}
              onPress={onStartMatch}
              className="h-9 px-4 !rounded-full font-bold whitespace-nowrap shrink-0 accent-solid-btn"
            >
              <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
              {startButtonLabel}
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1400px] mx-auto px-3 sm:px-6 py-4 sm:py-5 space-y-4">
        {storageNotice && (
          <div
            role="status"
            className="flex items-center gap-2.5 px-4 py-2.5 text-xs font-medium rounded-xl bg-amber-500/12 border border-amber-500/35 text-amber-800 dark:text-amber-300"
          >
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{storageNotice}</span>
          </div>
        )}

        {!canStart && (
          <div
            role="alert"
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400"
          >
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>请先修正：{blockerReasons.join(' / ')}</span>
          </div>
        )}

        {/* 对战备战台双栏布局：左侧双列战备卡（7列），右侧预设 + 药丸操控 + 圆形步进核心规则 + 设置入口（5列） */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <section className="lg:col-span-7 min-w-0">
            {isBrawl ? (
              <ArenaRosterPanel
                game={game}
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
                actions={resolveActionsForControlMode(game.actions, rules.controlMode)}
                bindingsBySlot={bindingsBySlot}
                gameMode={gameMode}
                singleMatchup={singleMatchup}
                onSingleMatchupChange={onSingleMatchupChange}
                botModels={game.botModels}
                customBotScripts={customBotScripts}
                aiModelBySlot={aiModelBySlot}
                onAiModelChange={onAiModelChange}
                onOpenAiStudio={game.aiSdk ? onOpenAiStudio : undefined}
                onProfileChange={onProfileChange}
                onBindingChange={onBindingChange}
                onResetBindings={onResetBindings}
              />
            )}
          </section>

          <aside className="lg:col-span-5 min-w-0 space-y-3.5">
            {/* 1. 规则预设 */}
            <RulePresetsPanel
              presets={presets}
              activePresetId={activePresetId}
              issues={ruleIssues}
              onSelectPreset={onSelectPreset}
              onSaveNewPreset={onSaveNewPreset}
              onDeletePreset={onDeletePreset}
              onResetAllRules={onResetAllRules}
            />

            {/* 2. 操控模式药丸切换 */}
            {hasControlMode && (
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-[var(--accent)]/12 text-[var(--accent)] flex items-center justify-center shrink-0">
                    <Gamepad2 className="w-4 h-4" aria-hidden="true" />
                  </span>
                  <span className="text-sm font-bold text-[var(--foreground)]">操控模式</span>
                </div>
                <PillSegmentedControl
                  ariaLabel="操控模式"
                  compact
                  selectedKey={String(rules.controlMode)}
                  onChange={(mode) =>
                    onChangeRules({ ...rules, controlMode: mode } as TRules)
                  }
                  options={[
                    { id: 'intuitive', label: '直觉转向', testId: 'prematch-ctrl-intuitive' },
                    { id: 'classic', label: '经典坦克', testId: 'prematch-ctrl-classic' },
                  ]}
                />
              </div>
            )}

            {/* 3. 核心赛制与地图（圆形步进器 + 药丸分组） */}
            <RulesForm
              game={game}
              rules={rules}
              presets={presets}
              activePresetId={activePresetId}
              issues={ruleIssues}
              filterGroupIds={['match', 'map']}
              columns={2}
              hideHeader
              hidePresetBar
              onChangeRules={onChangeRules}
              onSelectPreset={onSelectPreset}
              onSaveNewPreset={onSaveNewPreset}
              onDeletePreset={onDeletePreset}
              onResetAllRules={onResetAllRules}
              onResetGroupRules={onResetGroupRules}
            />

            {/* 4. 更多高级参数跳转入口 */}
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-7 h-7 rounded-lg bg-[var(--accent)]/12 text-[var(--accent)] flex items-center justify-center shrink-0">
                  <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-[var(--foreground)] truncate">
                    道具池与高级参数
                  </div>
                  <div className="text-[11px] text-[var(--muted)] truncate">
                    道具军械 · 弹道 · 手感
                  </div>
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                data-testid="prematch-open-settings-btn"
                onPress={onOpenSettings}
                className="h-9 px-3.5 !rounded-full font-semibold shrink-0 whitespace-nowrap"
              >
                设置中心
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </Button>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function resolveActionsForControlMode(
  actions: GameDefinition<Record<string, unknown>, unknown>['actions'],
  controlMode: unknown
) {
  if (controlMode !== 'intuitive') return actions;
  return actions.map((a) => {
    if (a.id === 'forward') return { ...a, label: '向上' };
    if (a.id === 'backward') return { ...a, label: '向下' };
    if (a.id === 'turnLeft') return { ...a, label: '向左' };
    if (a.id === 'turnRight') return { ...a, label: '向右' };
    return a;
  });
}
