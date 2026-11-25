import { useState } from 'react';
import { AlertCircle, ArrowLeft, Bot, Code2, Cpu, Eye, Swords, Users } from 'lucide-react';
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
import { RulesForm } from '../settings/RulesForm';
import type { KeyCaptureTarget } from '../input/keyboardVisualizer';
import { ArenaRosterPanel } from './ArenaRosterPanel';
import { PlayerSetupPanel, resolveSlotAiSelection, resolveSlotController } from './PlayerSetupPanel';
import { VisualKeyboard } from './VisualKeyboard';

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
}

/**
 * 独立设置页（也可从暂停层打开）：
 * - 顶部支持独立切换「单人模式 / 多人模式 / AI 乱斗」，各自持久化独立规则与预设
 * - 玩家与阵容页支持四档内置 AI、自定义大模型脚本及 2～8 席多 AI 乱斗阵容配置
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
}: SettingsViewProps<TRules>) {
  const [section, setSection] = useState<'rules' | 'players'>('rules');
  const [selectedSlotId, setSelectedSlotId] = useState<PlayerSlotId>(
    () => profiles[0]?.slotId ?? 'p1'
  );
  const [capturingTarget, setCapturingTarget] = useState<KeyCaptureTarget | null>(null);

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

  return (
    <div className="min-h-screen drafting-surface flex flex-col">
      <div className="sticky top-0 z-20 bg-[#F4F1EA]/95 border-b border-[#D8D2C5] px-6 py-3.5">
        <div className="max-w-[1200px] mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#3A424C] bg-[#EAE5DA] hover:bg-[#DFD9CB] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
              {inPausedMatch ? '返回暂停界面' : '返回大厅'}
            </button>
            <h1 className="font-display text-xl font-extrabold tracking-tight text-[#1C2127]">
              设置中心
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {games.length > 1 && (
              <select
                aria-label="选择要配置的游戏"
                value={selectedGame.id}
                onChange={(e) => onSelectGame(e.target.value)}
                className="px-3 py-1.5 text-xs font-semibold bg-white border border-[#CFC8BA] rounded-md text-[#1C2127]"
              >
                {games.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}

            {/* 单人 / 多人 / AI 乱斗独立配置切换 */}
            <div
              className="flex items-center gap-1 p-1 bg-[#EAE5DA] rounded-lg"
              role="tablist"
              aria-label="切换配置模式"
            >
              <button
                type="button"
                role="tab"
                aria-selected={gameMode === 'single'}
                data-testid="settings-mode-single"
                onClick={() => {
                  setCapturingTarget(null);
                  onGameModeChange('single');
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  gameMode === 'single'
                    ? 'bg-white text-[#1C2127] shadow-xs'
                    : 'text-[#4F5864] hover:text-[#1C2127]'
                }`}
              >
                <Bot className="w-3.5 h-3.5" aria-hidden="true" />
                单人模式
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={gameMode === 'multi'}
                data-testid="settings-mode-multi"
                onClick={() => {
                  setCapturingTarget(null);
                  onGameModeChange('multi');
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  gameMode === 'multi'
                    ? 'bg-white text-[#1C2127] shadow-xs'
                    : 'text-[#4F5864] hover:text-[#1C2127]'
                }`}
              >
                <Users className="w-3.5 h-3.5" aria-hidden="true" />
                多人模式
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={gameMode === 'brawl'}
                data-testid="settings-mode-brawl"
                onClick={() => {
                  setCapturingTarget(null);
                  onGameModeChange('brawl');
                }}
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

            {selectedGame.aiSdk && (
              <button
                type="button"
                data-testid="settings-open-studio-btn"
                onClick={() => onOpenAiStudio('prompt')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-[#F5F2EB] bg-[#222830] hover:bg-[#313A46] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Code2 className="w-3.5 h-3.5 text-[#7DD3FC]" aria-hidden="true" />
                AI 脚本工坊
              </button>
            )}

            <div className="flex items-center gap-1 p-1 bg-[#EAE5DA] rounded-lg" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={section === 'rules'}
                data-testid="settings-tab-rules"
                onClick={() => {
                  setCapturingTarget(null);
                  setSection('rules');
                }}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  section === 'rules'
                    ? 'bg-white text-[#1C2127] shadow-xs'
                    : 'text-[#4F5864] hover:text-[#1C2127]'
                }`}
              >
                规则与预设
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={section === 'players'}
                data-testid="settings-tab-players"
                onClick={() => setSection('players')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  section === 'players'
                    ? 'bg-white text-[#1C2127] shadow-xs'
                    : 'text-[#4F5864] hover:text-[#1C2127]'
                }`}
              >
                {gameMode === 'brawl'
                  ? '乱斗阵容'
                  : gameMode === 'single'
                  ? '阵容与 AI / 改键'
                  : '玩家与改键'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <main className="flex-1 w-full max-w-[1200px] mx-auto px-6 py-6 space-y-5">
        {inPausedMatch && (
          <div
            role="status"
            className="flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-[#1F4E78] bg-[#E5F0FA] border border-[#B4D1EC] rounded-lg"
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
            className="flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-[#8A4B08] bg-[#FCF2DF] border border-[#E7C78C] rounded-lg"
          >
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{storageNotice}</span>
          </div>
        )}

        {section === 'rules' ? (
          <div className="space-y-3">
            <div
              data-testid="settings-rules-scope-banner"
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 rounded-lg bg-[#EFECE3] border border-[#D8D2C5] text-xs text-[#4A535E]"
            >
              <span>
                当前规则存档作用域：
                <strong className="text-[#1C2127] ml-1">
                  {gameMode === 'single'
                    ? '单人游戏模式（独立保存）'
                    : gameMode === 'brawl'
                    ? 'AI 乱斗模式（独立保存）'
                    : '多人游戏模式（独立保存）'}
                </strong>
              </span>
              <span className="text-[11px] text-[#68717D]">
                单人、多人与 AI 乱斗的规则及预设互不覆盖，可在顶部随时切换编辑
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
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-5">
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
                  controlMode={typeof rules.controlMode === 'string' ? rules.controlMode : undefined}
                  controlModeOptions={
                    typeof rules.controlMode === 'string'
                      ? [
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
                        ]
                      : undefined
                  }
                  onControlModeChange={(mode) =>
                    onChangeRules({ ...rules, controlMode: mode } as TRules)
                  }
                  onProfileChange={onProfileChange}
                  onBindingChange={onBindingChange}
                  onResetBindings={onResetBindings}
                  selectedSlotId={effectiveSelectedSlotId}
                  onSelectSlot={setSelectedSlotId}
                  capturingTarget={capturingTarget}
                  onCapturingTargetChange={setCapturingTarget}
                />
              )}
            </div>

            <div className="lg:col-span-7 lg:sticky lg:top-20">
              {humanProfiles.length > 0 ? (
                <VisualKeyboard
                  profiles={humanProfiles}
                  actions={mappedActions}
                  bindingsBySlot={bindingsBySlot}
                  selectedSlotId={effectiveSelectedSlotId}
                  capturingTarget={capturingTarget}
                  onSelectSlot={(slotId) => {
                    setSelectedSlotId(slotId);
                  }}
                  onAssignKeyFromClick={(keyCode) => {
                    if (!capturingTarget) return;
                    onBindingChange(capturingTarget.slotId, capturingTarget.actionId, keyCode);
                    setCapturingTarget(null);
                  }}
                />
              ) : (
                <section
                  data-testid="ai-spectate-keyboard-placeholder"
                  aria-label="全 AI 观战模式说明"
                  className="bg-[#FAF8F4] border border-[#D8D2C5] rounded-xl p-6 space-y-4 shadow-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-lg bg-[#222830] text-[#7DD3FC] flex items-center justify-center shrink-0">
                      <Eye className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-[#1C2127]">
                        {isBrawl
                          ? `全 AI 多模型乱斗（${arenaSeats.length} 席观战）`
                          : 'AI vs AI 观战模式（无需配置玩家键位）'}
                      </h2>
                      <p className="text-xs text-[#59626D] mt-0.5">
                        所有席位均由策略脚本自动决策，对战中仅需按 Esc 暂停或继续观战。
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    {(isBrawl
                      ? arenaSeats.map((seat) => {
                          const sel = resolveSlotAiSelection(
                            seat.aiSource === 'custom' ? `custom:${seat.aiModelId}` : seat.aiModelId,
                            botModels,
                            customBotScripts
                          );
                          return {
                            slotId: seat.slotId,
                            label: seat.name || seat.slotId.toUpperCase(),
                            colorHex: seat.colorHex,
                            selection: sel,
                          };
                        })
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
                        className="rounded-lg bg-white border border-[#DCD6C8] p-3.5 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#1C2127] truncate">
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
                        <div className="flex items-center gap-1.5 text-sm font-bold text-[#1C2127]">
                          <Cpu className="w-3.5 h-3.5 text-[#55606C]" aria-hidden="true" />
                          <span className="truncate">
                            {entry.selection?.displayName ?? '战术游击'}
                          </span>
                        </div>
                        {entry.selection && (
                          <p className="text-[11px] leading-relaxed text-[#5D6672] line-clamp-2">
                            {entry.selection.summary}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        )}

        {onToggleDevDebugMode && (
          <section
            aria-label="开发者调试选项"
            className="pt-4 border-t border-[#DED8CB]"
          >
            <div className="bg-[#FAF8F4] border border-[#D8D2C5] rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="text-xs font-bold text-[#1C2127]">
                  开发者调试模式（实时 FPS 与内存监控）
                </div>
                <p className="text-[11px] text-[#5D6672]">
                  开启后将在对战视口左侧按键提示下方显示帧率曲线、单帧耗时与 JS 堆内存占用；对战中也可按{' '}
                  <span className="font-mono-num font-semibold text-[#2C333B]">F3</span> 或{' '}
                  <span className="font-mono-num font-semibold text-[#2C333B]">Ctrl+Shift+D</span>{' '}
                  随时切换，或使用网址参数 <span className="font-mono-num">?debug=1</span>。
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#1C2127] cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={devDebugMode}
                  onChange={onToggleDevDebugMode}
                  aria-label="开启开发者调试模式"
                  className="w-4 h-4 accent-[#1C2127] rounded cursor-pointer"
                />
                <span>{devDebugMode ? '已开启' : '已关闭'}</span>
              </label>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
