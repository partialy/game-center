import { AlertCircle, ArrowLeft, Bot, Code2, Play, Swords, Users } from 'lucide-react';
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
import { RulesForm } from '../settings/RulesForm';
import { ArenaRosterPanel, validateArenaSeats } from './ArenaRosterPanel';
import { PlayerSetupPanel, resolveSlotController } from './PlayerSetupPanel';

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
 * 赛前配置页：
 * - 顶部支持随时切换「单人游戏 / 多人游戏 / AI 乱斗」，对应独立的规则存档与预设列表
 * - 左侧配置玩家资料或 2～8 席多 AI 乱斗阵容，一键直达 AI 脚本工坊
 * - 右侧配置当前模式独立的规则预设、地图编号及七类规则分组
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
    ? `开始 ${arenaSeats.length} 席 AI 乱斗`
    : gameMode === 'single' && singleMatchup === 'ai_vs_ai'
    ? '开始 AI 观战'
    : '开始比赛';

  return (
    <div className="min-h-screen drafting-surface flex flex-col">
      {/* 顶部操作栏 */}
      <div className="sticky top-0 z-20 bg-[#F4F1EA]/95 border-b border-[#D8D2C5] px-6 py-3.5">
        <div className="max-w-[1360px] mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <button
              type="button"
              onClick={onBackToLobby}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#3A424C] bg-[#EAE5DA] hover:bg-[#DFD9CB] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
              返回大厅
            </button>
            <div className="min-w-0">
              <h1 className="font-display text-xl font-extrabold tracking-tight text-[#1C2127] truncate">
                {game.name} · 赛前配置
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {/* 单人 / 多人 / AI 乱斗模式切换 */}
            <div
              className="flex items-center gap-1 p-1 bg-[#EAE5DA] rounded-lg"
              role="tablist"
              aria-label="切换游戏模式"
            >
              <button
                type="button"
                role="tab"
                aria-selected={gameMode === 'single'}
                data-testid="prematch-mode-single"
                onClick={() => onGameModeChange('single')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  gameMode === 'single'
                    ? 'bg-white text-[#1C2127] shadow-xs'
                    : 'text-[#4F5864] hover:text-[#1C2127]'
                }`}
              >
                <Bot className="w-3.5 h-3.5" aria-hidden="true" />
                单人游戏
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={gameMode === 'multi'}
                data-testid="prematch-mode-multi"
                onClick={() => onGameModeChange('multi')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  gameMode === 'multi'
                    ? 'bg-white text-[#1C2127] shadow-xs'
                    : 'text-[#4F5864] hover:text-[#1C2127]'
                }`}
              >
                <Users className="w-3.5 h-3.5" aria-hidden="true" />
                多人游戏
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={gameMode === 'brawl'}
                data-testid="prematch-mode-brawl"
                onClick={() => onGameModeChange('brawl')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  gameMode === 'brawl'
                    ? 'bg-white text-[#1C2127] shadow-xs'
                    : 'text-[#4F5864] hover:text-[#1C2127]'
                }`}
              >
                <Swords className="w-3.5 h-3.5" aria-hidden="true" />
                AI 乱斗
              </button>
            </div>

            {game.aiSdk && (
              <button
                type="button"
                data-testid="open-ai-studio-btn"
                onClick={() => onOpenAiStudio('prompt')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-[#F5F2EB] bg-[#222830] hover:bg-[#313A46] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Code2 className="w-3.5 h-3.5 text-[#7DD3FC]" aria-hidden="true" />
                AI 脚本工坊
                {customBotScripts.length > 0 && (
                  <span className="font-mono-num text-[#7DD3FC]">
                    ({customBotScripts.length})
                  </span>
                )}
              </button>
            )}

            {!canStart && (
              <span className="hidden md:inline-flex items-center gap-1.5 text-xs font-medium text-[#9B2216]">
                <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
                {blockerReasons.join(' / ')}
              </span>
            )}
            <button
              type="button"
              data-start="true"
              disabled={!canStart}
              onClick={onStartMatch}
              className={`inline-flex items-center gap-2 px-6 py-2.5 text-sm font-bold rounded-lg whitespace-nowrap shrink-0 ${
                canStart
                  ? 'text-white bg-[#D9432B] hover:bg-[#BE3620] transition-colors cursor-pointer'
                  : 'text-[#FAF8F4] bg-[#B8B1A3] cursor-not-allowed'
              }`}
            >
              <Play className="w-4 h-4 fill-current" aria-hidden="true" />
              {startButtonLabel}
            </button>
          </div>
        </div>
      </div>

      <main className="flex-1 w-full max-w-[1360px] mx-auto px-6 py-6 space-y-5">
        {storageNotice && (
          <div
            role="status"
            className="flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-[#8A4B08] bg-[#FCF2DF] border border-[#E7C78C] rounded-lg"
          >
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{storageNotice}</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
          <div className="lg:col-span-5">
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
                controlMode={typeof rules.controlMode === 'string' ? rules.controlMode : undefined}
                controlModeOptions={
                  typeof rules.controlMode === 'string' ? TANK_CONTROL_MODE_OPTIONS : undefined
                }
                onControlModeChange={(mode) =>
                  onChangeRules({ ...rules, controlMode: mode } as TRules)
                }
                onProfileChange={onProfileChange}
                onBindingChange={onBindingChange}
                onResetBindings={onResetBindings}
              />
            )}
          </div>

          <div className="lg:col-span-7 space-y-3">
            <div
              data-testid="prematch-rules-scope-banner"
              className="flex items-center justify-between gap-3 px-3.5 py-2 rounded-lg bg-[#EFECE3] border border-[#D8D2C5] text-xs text-[#4A535E]"
            >
              <span>
                当前编辑并独立保存：
                <strong className="text-[#1C2127] ml-1">
                  {gameMode === 'single'
                    ? '单人模式专属规则与预设'
                    : gameMode === 'brawl'
                    ? 'AI 乱斗模式专属规则与预设'
                    : '多人模式专属规则与预设'}
                </strong>
              </span>
              <span className="text-[11px] text-[#6B7480] whitespace-nowrap">
                三套模式独立存档互不干扰
              </span>
            </div>

            <RulesForm
              game={game}
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
            />
          </div>
        </div>
      </main>
    </div>
  );
}

const TANK_CONTROL_MODE_OPTIONS = [
  {
    value: 'intuitive',
    label: '直觉转向（推荐）',
    description:
      '按屏幕上下左右及 45° 斜向移动，炮口沿最短圆弧平滑转向；轻点方向优先微调角度，转向中任意瞬间开火可打出 360° 弹道。',
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

