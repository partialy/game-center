import { Button } from '@heroui/react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Code2,
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
import { AppSelect, ModeTabs, ThemeQuickToggle } from './heroUiHelpers';

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
 * 对战备战台（赛前配置页）：
 * - 固定精简顶栏：圆形返回 + 标题 | 圆形主题、AI工坊、药丸模式分段器、开战主按钮
 * - 左侧主战席位区：P1/P2 对抗备战卡 或 2～8 席 AI 乱斗阵容
 * - 右侧精简核心规则区：规则预设 + 赛制/地图/操控三项核心配置 + 前往设置中心入口
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
  const activeControlModeMeta = TANK_CONTROL_MODE_OPTIONS.find(
    (opt) => opt.value === rules.controlMode
  );

  return (
    <div className="min-h-full drafting-surface flex flex-col text-[var(--foreground)]">
      {/* 精简统一顶栏：圆形返回 + 标题 | 圆形主题、AI工坊、药丸分段器、主开战按钮 */}
      <header className="sticky top-0 z-20 min-h-[56px] bg-[var(--surface)]/95 border-b border-[var(--border)] px-3 sm:px-6 py-2 flex items-center">
        <div className="max-w-[1360px] w-full mx-auto flex flex-wrap items-center justify-between gap-2.5 sm:gap-4">
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

      <main className="flex-1 w-full max-w-[1360px] mx-auto px-3 sm:px-6 py-4 sm:py-5 space-y-4">
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
            <span>开战前请先修正：{blockerReasons.join(' / ')}</span>
          </div>
        )}

        {/* 对战备战台双栏布局：左侧席位与阵营（7列），右侧规则预设 + 核心规则 + 设置跳转（5列） */}
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

          <aside className="lg:col-span-5 min-w-0 space-y-4">
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

            {/* 2. 核心规则（操控模式 + 赛制/地图） */}
            <div className="space-y-3">
              {hasControlMode && (
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-2">
                  <AppSelect
                    label="操控模式"
                    ariaLabel="操控模式"
                    testId="prematch-control-mode-select"
                    value={String(rules.controlMode)}
                    options={TANK_CONTROL_MODE_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: opt.label,
                    }))}
                    onChange={(mode) =>
                      onChangeRules({ ...rules, controlMode: mode } as TRules)
                    }
                  />
                  {activeControlModeMeta && (
                    <p className="text-[11px] leading-relaxed text-[var(--muted)]">
                      {activeControlModeMeta.description}
                    </p>
                  )}
                </div>
              )}

              <RulesForm
                game={game}
                rules={rules}
                presets={presets}
                activePresetId={activePresetId}
                issues={ruleIssues}
                filterGroupIds={['match', 'map']}
                hideHeader
                hidePresetBar
                onChangeRules={onChangeRules}
                onSelectPreset={onSelectPreset}
                onSaveNewPreset={onSaveNewPreset}
                onDeletePreset={onDeletePreset}
                onResetAllRules={onResetAllRules}
                onResetGroupRules={onResetGroupRules}
              />
            </div>

            {/* 3. 高级参数跳转入口 */}
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-bold text-[var(--foreground)]">
                  更多高级参数
                </div>
                <p className="text-[11px] text-[var(--muted)] mt-0.5 truncate">
                  道具池、弹道物理、移动手感与画质音效
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                data-testid="prematch-open-settings-btn"
                onPress={onOpenSettings}
                className="h-9 px-3.5 !rounded-full font-semibold shrink-0 whitespace-nowrap"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-[var(--accent)]" aria-hidden="true" />
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

const TANK_CONTROL_MODE_OPTIONS = [
  {
    value: 'intuitive',
    label: '直觉转向（推荐）',
    description: '按方向键直接朝 8 个方向移动，炮口自动平滑跟随并可随时开火。',
  },
  {
    value: 'classic',
    label: '经典坦克',
    description: '按车头朝向前进/倒车，左右键原地或行进间旋转车体。',
  },
];

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
