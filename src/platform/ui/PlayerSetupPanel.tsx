import { useEffect, useState } from 'react';
import { Button, Input } from '@heroui/react';
import {
  AlertCircle,
  Bot,
  Code2,
  Cpu,
  Crown,
  Eye,
  Keyboard,
  Lock,
  Plus,
  RotateCcw,
  Swords,
  User,
  Users,
} from 'lucide-react';
import {
  BOSS_TIER_THEME,
  type ActionDefinition,
  type BotModelDefinition,
  type BotModelSource,
  type CustomBotScriptRecord,
  type GameMode,
  type PlayerControllerKind,
  type PlayerProfile,
  type PlayerSlotId,
  type SingleMatchup,
} from '../games/contracts';
import {
  formatKeyCode,
  PLAYER_COLOR_PALETTE,
  RESERVED_KEY_CODES,
  resolveDisplayName,
  validateBindings,
  validatePlayerColors,
  validatePlayerName,
} from '../input/bindings';
import type { KeyCaptureTarget } from '../input/keyboardVisualizer';
import { PillSegmentedControl } from './heroUiHelpers';

export interface ControlModeSwitchOption {
  value: string;
  label: string;
  description: string;
}

/** 统一解析槽位控制方（单人模式下 P2 为 AI，AI 观战模式下 P1/P2 均为 AI） */
export function resolveSlotController(
  slotId: PlayerSlotId,
  gameMode: GameMode,
  singleMatchup: SingleMatchup
): PlayerControllerKind {
  if (gameMode === 'multi') return 'human';
  if (singleMatchup === 'ai_vs_ai') return 'ai';
  return slotId === 'p1' ? 'human' : 'ai';
}

export interface ResolvedSlotAiSelection {
  source: BotModelSource;
  modelId: string;
  displayName: string;
  tierText: string;
  accentColor: string;
  summary: string;
  builtinModel: BotModelDefinition<unknown> | null;
  customScript: CustomBotScriptRecord | null;
}

/** 统一解析槽位的 AI 模型选择（兼容内置 ID、'custom:<id>' 前缀以及直接匹配的自定义脚本 ID） */
export function resolveSlotAiSelection(
  rawModelId: string | undefined,
  builtinModels: BotModelDefinition<unknown>[],
  customBotScripts: CustomBotScriptRecord[] = []
): ResolvedSlotAiSelection | null {
  if (rawModelId) {
    const cleanCustomId = rawModelId.startsWith('custom:')
      ? rawModelId.slice('custom:'.length)
      : rawModelId;
    const customMatch = customBotScripts.find((s) => s.id === cleanCustomId);
    if (customMatch) {
      return {
        source: 'custom',
        modelId: customMatch.id,
        displayName: customMatch.name,
        tierText: customMatch.tierLabel || '自定义',
        accentColor: customMatch.defaultColorHex,
        summary:
          customMatch.description ||
          `${customMatch.authorModel ? `${customMatch.authorModel} 生成 · ` : ''}Worker 沙箱`,
        builtinModel: null,
        customScript: customMatch,
      };
    }
    const builtinMatch = builtinModels.find((m) => m.id === rawModelId);
    if (builtinMatch) {
      return {
        source: 'builtin',
        modelId: builtinMatch.id,
        displayName: builtinMatch.name,
        tierText: `Lv.${builtinMatch.difficultyLevel} · ${builtinMatch.difficultyLabel}`,
        accentColor: builtinMatch.accentColor,
        summary: builtinMatch.summary,
        builtinModel: builtinMatch,
        customScript: null,
      };
    }
  }

  const fallback = builtinModels[1] ?? builtinModels[0] ?? null;
  if (!fallback) return null;
  return {
    source: 'builtin',
    modelId: fallback.id,
    displayName: fallback.name,
    tierText: `Lv.${fallback.difficultyLevel} · ${fallback.difficultyLabel}`,
    accentColor: fallback.accentColor,
    summary: fallback.summary,
    builtinModel: fallback,
    customScript: null,
  };
}

interface PlayerSetupPanelProps {
  profiles: PlayerProfile[];
  actions: ActionDefinition[];
  bindingsBySlot: Record<PlayerSlotId, Record<string, string>>;
  gameMode?: GameMode;
  singleMatchup?: SingleMatchup;
  onSingleMatchupChange?: (matchup: SingleMatchup) => void;
  botModels?: BotModelDefinition<unknown>[];
  customBotScripts?: CustomBotScriptRecord[];
  aiModelBySlot?: Record<PlayerSlotId, string>;
  onAiModelChange?: (slotId: PlayerSlotId, modelId: string) => void;
  onOpenAiStudio?: (tab?: 'prompt' | 'editor') => void;
  controlMode?: string;
  controlModeOptions?: ControlModeSwitchOption[];
  onControlModeChange?: (mode: string) => void;
  onProfileChange: (slotId: PlayerSlotId, patch: Partial<PlayerProfile>) => void;
  onBindingChange: (slotId: PlayerSlotId, actionId: string, keyCode: string) => void;
  onResetBindings: () => void;
  selectedSlotId?: PlayerSlotId;
  onSelectSlot?: (slotId: PlayerSlotId) => void;
  capturingTarget?: KeyCaptureTarget | null;
  onCapturingTargetChange?: (target: KeyCaptureTarget | null) => void;
  hideKeybindings?: boolean;
  keybindingsOnly?: boolean;
}

/**
 * 游戏 App 风格双列玩家与 AI 战备面板（设置中心与赛前备战台共用）：
 * - 桌面双列并排战备卡：坦克涂装头像 + 紧凑同行代号输入 + 8 色圆形涂装点
 * - AI 槽位内置 Lv.1～Lv.4 2×2 + Lv.5 终极 Boss 跨列徽章卡 + 四维战力条
 * - 全部对阵/操控切换采用药丸分段器，去除冗余描述文字
 */
export function PlayerSetupPanel({
  profiles,
  actions,
  bindingsBySlot,
  gameMode = 'multi',
  singleMatchup = 'human_vs_ai',
  onSingleMatchupChange,
  botModels = [],
  customBotScripts = [],
  aiModelBySlot = {},
  onAiModelChange,
  onOpenAiStudio,
  controlMode,
  controlModeOptions,
  onControlModeChange,
  onProfileChange,
  onBindingChange,
  onResetBindings,
  selectedSlotId,
  onSelectSlot,
  capturingTarget,
  onCapturingTargetChange,
  hideKeybindings = false,
  keybindingsOnly = false,
}: PlayerSetupPanelProps) {
  const [internalCapturing, setInternalCapturing] = useState<KeyCaptureTarget | null>(null);
  const [captureNotice, setCaptureNotice] = useState<string | null>(null);

  const isControlledCapture = capturingTarget !== undefined;
  const capturing = isControlledCapture ? capturingTarget : internalCapturing;
  const updateCapturing = (next: KeyCaptureTarget | null) => {
    if (!isControlledCapture) {
      setInternalCapturing(next);
    }
    onCapturingTargetChange?.(next);
  };

  const humanSlotIds = profiles
    .filter((p) => resolveSlotController(p.slotId, gameMode, singleMatchup) === 'human')
    .map((p) => p.slotId);
  const colorErrors = validatePlayerColors(profiles);
  const bindingValidation = validateBindings(humanSlotIds, actions, bindingsBySlot);

  useEffect(() => {
    if (!capturing) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;

      if (RESERVED_KEY_CODES.has(event.code)) {
        if (!isControlledCapture) {
          setInternalCapturing(null);
        }
        onCapturingTargetChange?.(null);
        setCaptureNotice('Esc 保留用于暂停/继续，已取消录入。');
        return;
      }

      onBindingChange(capturing.slotId, capturing.actionId, event.code);
      if (!isControlledCapture) {
        setInternalCapturing(null);
      }
      onCapturingTargetChange?.(null);
      setCaptureNotice(null);
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [capturing, isControlledCapture, onBindingChange, onCapturingTargetChange]);

  const panelTitle = keybindingsOnly
    ? '键盘按键绑定'
    : gameMode === 'single'
    ? '对战阵容'
    : '双人战备';
  const PanelIcon = keybindingsOnly ? Keyboard : gameMode === 'single' ? Swords : Users;

  return (
    <section aria-label={panelTitle} className="space-y-3.5">
      {/* 顶栏：图标标题 + 单人对阵药丸分段器 / 恢复默认按键 */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-[var(--accent)]/12 text-[var(--accent)] flex items-center justify-center shrink-0">
            <PanelIcon className="w-4 h-4" aria-hidden="true" />
          </span>
          <h2 className="text-sm font-bold tracking-tight text-[var(--foreground)] truncate">
            {panelTitle}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {!keybindingsOnly && gameMode === 'single' && onSingleMatchupChange && (
            <PillSegmentedControl
              ariaLabel="单人对阵方式"
              compact
              selectedKey={singleMatchup}
              onChange={(key) => {
                updateCapturing(null);
                onSingleMatchupChange(key as SingleMatchup);
              }}
              options={[
                {
                  id: 'human_vs_ai',
                  label: '玩家 vs AI',
                  icon: <User className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
                  testId: 'matchup-human-vs-ai',
                },
                {
                  id: 'ai_vs_ai',
                  label: 'AI 观战',
                  icon: <Eye className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
                  testId: 'matchup-ai-vs-ai',
                },
              ]}
            />
          )}

          {!keybindingsOnly &&
            controlModeOptions &&
            controlModeOptions.length > 0 &&
            onControlModeChange && (
              <PillSegmentedControl
                ariaLabel="操控模式切换"
                compact
                selectedKey={controlMode ?? controlModeOptions[0].value}
                onChange={onControlModeChange}
                options={controlModeOptions.map((opt) => ({
                  id: opt.value,
                  label: opt.label,
                }))}
              />
            )}

          {humanSlotIds.length > 0 && !hideKeybindings && (
            <Button
              variant="secondary"
              size="sm"
              onPress={() => {
                updateCapturing(null);
                setCaptureNotice(null);
                onResetBindings();
              }}
              className="h-9 px-3.5 !rounded-full whitespace-nowrap shrink-0 font-semibold"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              恢复按键
            </Button>
          )}
        </div>
      </div>

      {captureNotice && (
        <div
          role="status"
          className="flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-xl bg-amber-500/12 border border-amber-500/35 text-amber-800 dark:text-amber-300"
        >
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{captureNotice}</span>
        </div>
      )}

      {!bindingValidation.valid && humanSlotIds.length > 0 && !hideKeybindings && (
        <div
          role="alert"
          className="flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-xl bg-red-500/10 border border-red-500/35 text-red-700 dark:text-red-300"
        >
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>存在重复或非法按键绑定，请修正标红项。</span>
        </div>
      )}

      {/* 桌面左右双列战备卡（md+ 双列并排，窄屏自动单列，顶对齐避免空白拉伸） */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        {profiles.map((profile) => {
          const controller = resolveSlotController(profile.slotId, gameMode, singleMatchup);
          const isAiSlot = controller === 'ai';
          const nameError = validatePlayerName(profile.name);
          const colorError = colorErrors[profile.slotId];
          const displayName = resolveDisplayName(profile.slotId, profile.name);
          const takenByOthers = new Set(
            profiles
              .filter((other) => other.slotId !== profile.slotId)
              .map((other) => other.colorHex.toLowerCase())
          );

          const isSelectedCard = !isAiSlot && selectedSlotId === profile.slotId;
          const activeSelection = resolveSlotAiSelection(
            aiModelBySlot[profile.slotId],
            botModels,
            customBotScripts
          );
          const activeModel = activeSelection?.builtinModel ?? null;

          return (
            <div
              key={profile.slotId}
              data-testid={`player-setup-card-${profile.slotId}`}
              data-controller={controller}
              onClick={() => {
                if (!isAiSlot) onSelectSlot?.(profile.slotId);
              }}
              className={`bg-[var(--surface)] border rounded-2xl p-4 flex flex-col gap-3.5 transition-colors ${
                isSelectedCard
                  ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]/25'
                  : 'border-[var(--border)]'
              }`}
            >
              {keybindingsOnly ? (
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-[var(--separator)]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: profile.colorHex }}
                    />
                    <span className="text-sm font-bold text-[var(--foreground)] truncate">
                      {displayName}
                    </span>
                    <span className="text-xs font-mono-num text-[var(--muted)]">
                      {profile.slotId.toUpperCase()}
                    </span>
                  </div>
                  <span className="text-[11px] font-medium text-[var(--muted)]">点击键帽录入</span>
                </div>
              ) : (
                /* 紧凑战备头部：左侧坦克涂装徽标 + 右侧同行名称输入与 8 色圆点 */
                <div className="flex items-start gap-3">
                  <div
                    className="w-14 h-14 rounded-2xl border flex items-center justify-center shrink-0 shadow-xs"
                    style={{
                      backgroundColor: `${profile.colorHex}1A`,
                      borderColor: `${profile.colorHex}66`,
                    }}
                    aria-hidden="true"
                  >
                    <MiniTankPreview colorHex={profile.colorHex} />
                  </div>

                  <div className="flex-1 min-w-0 space-y-2">
                    {/* 槽位标示 + 同行紧凑名称输入框 */}
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="inline-flex items-center gap-1 text-xs font-extrabold whitespace-nowrap shrink-0"
                        style={{ color: profile.colorHex }}
                      >
                        {isAiSlot ? (
                          <Bot className="w-3.5 h-3.5" aria-hidden="true" />
                        ) : (
                          <User className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                        {profile.slotId.toUpperCase()}
                      </span>

                      <Input
                        id={`player-name-${profile.slotId}`}
                        aria-label={`${profile.slotId.toUpperCase()} 玩家代号`}
                        type="text"
                        maxLength={10}
                        value={profile.name}
                        placeholder={profile.slotId.toUpperCase()}
                        onChange={(e) =>
                          onProfileChange(profile.slotId, { name: e.target.value })
                        }
                        className={`flex-1 min-w-0 h-8 max-sm:h-10 px-2.5 text-xs font-bold bg-[var(--field-background)] text-[var(--field-foreground)] border rounded-full ${
                          nameError ? 'border-red-500' : 'border-[var(--field-border)]'
                        }`}
                      />

                      <span className="text-[11px] font-semibold text-[var(--muted)] whitespace-nowrap shrink-0">
                        {isAiSlot ? 'AI' : '玩家'}
                      </span>
                    </div>

                    {/* 8 色圆形涂装点直接贴在名称行下方 */}
                    <div
                      className="flex flex-wrap items-center gap-1.5"
                      role="radiogroup"
                      aria-label={`${profile.slotId.toUpperCase()} 颜色选择`}
                    >
                      {PLAYER_COLOR_PALETTE.map((option) => {
                        const isSelected =
                          profile.colorHex.toLowerCase() === option.hex.toLowerCase();
                        const isTaken = takenByOthers.has(option.hex.toLowerCase());
                        return (
                          <button
                            key={option.id}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            aria-label={`${profile.slotId.toUpperCase()} 选择 ${option.label}${isTaken ? '（已被对手选择）' : ''}`}
                            disabled={isTaken}
                            onClick={() =>
                              onProfileChange(profile.slotId, { colorHex: option.hex })
                            }
                            title={isTaken ? `${option.label}（已占用）` : option.label}
                            className={`relative w-6 h-6 max-sm:w-7 max-sm:h-7 rounded-full flex items-center justify-center transition-transform ${
                              isSelected
                                ? 'ring-2 ring-offset-2 ring-[var(--foreground)] ring-offset-[var(--surface)] scale-110'
                                : isTaken
                                ? 'opacity-25 cursor-not-allowed'
                                : 'hover:scale-110 cursor-pointer'
                            }`}
                            style={{ backgroundColor: option.hex }}
                          >
                            {isTaken && (
                              <Lock className="w-3 h-3 text-white drop-shadow" aria-hidden="true" />
                            )}
                            {isSelected && !isTaken && (
                              <span className="w-2 h-2 rounded-full bg-white" />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {(nameError || colorError) && (
                      <p className="text-[11px] font-medium text-red-600 dark:text-red-400">
                        {nameError ?? colorError}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* AI 槽位：紧凑选阶卡阵（Lv.1-4 2×2 + Lv.5 终极 Boss 跨列）+ 四维属性条 */}
              {isAiSlot ? (
                !keybindingsOnly && (
                  <div
                    data-testid={`ai-model-selector-${profile.slotId}`}
                    className="pt-3 border-t border-[var(--separator)] flex-1 flex flex-col justify-between gap-3"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--foreground)]">
                          <Cpu className="w-3.5 h-3.5 text-[var(--accent)]" aria-hidden="true" />
                          <span>AI 策略</span>
                          {activeSelection && (
                            <span
                              className="text-[11px] font-mono-num font-bold ml-1"
                              style={{ color: activeSelection.accentColor }}
                            >
                              {activeSelection.tierText}
                            </span>
                          )}
                        </div>
                        {onOpenAiStudio && (
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`open-studio-from-slot-${profile.slotId}`}
                            onPress={() => onOpenAiStudio('editor')}
                            className="h-7 px-2.5 !rounded-full text-[11px] font-bold text-[var(--accent)]"
                          >
                            <Plus className="w-3 h-3" aria-hidden="true" />
                            AI工坊
                          </Button>
                        )}
                      </div>

                      <div
                        className="grid grid-cols-2 gap-2"
                        role="radiogroup"
                        aria-label={`${profile.slotId.toUpperCase()} 内置 AI 模型`}
                      >
                        {botModels.map((model) => {
                          const selected =
                            activeSelection?.source === 'builtin' &&
                            model.id === activeSelection.modelId;
                          const isBoss = Boolean(model.isBoss || model.difficultyLevel === 5);
                          return (
                            <button
                              key={model.id}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              data-testid={`ai-model-card-${profile.slotId}-${model.id}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                onAiModelChange?.(profile.slotId, model.id);
                              }}
                              style={
                                isBoss
                                  ? {
                                      backgroundColor: selected
                                        ? BOSS_TIER_THEME.bgSoftHex
                                        : BOSS_TIER_THEME.bgHex,
                                      borderColor: selected
                                        ? '#F43F5E'
                                        : BOSS_TIER_THEME.borderHex,
                                    }
                                  : undefined
                              }
                              className={`relative text-left rounded-xl border px-3 py-2 transition-all cursor-pointer ${
                                isBoss ? 'col-span-2' : ''
                              } ${
                                isBoss
                                  ? selected
                                    ? 'ring-2 ring-[#C81E3D]/60 shadow-sm'
                                    : 'hover:brightness-110'
                                  : selected
                                  ? 'bg-[var(--accent)]/12 border-[var(--accent)] shadow-xs'
                                  : 'bg-[var(--surface-secondary)]/60 border-[var(--border)] hover:border-[var(--accent)]/50'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1.5">
                                <span
                                  className={`inline-flex items-center gap-1.5 text-xs font-bold truncate ${
                                    isBoss ? '' : 'text-[var(--foreground)]'
                                  }`}
                                  style={isBoss ? { color: BOSS_TIER_THEME.textHex } : undefined}
                                >
                                  {isBoss ? (
                                    <Crown className="w-3.5 h-3.5 text-[#FB7185] shrink-0" aria-hidden="true" />
                                  ) : (
                                    <span
                                      className="w-2 h-2 rounded-full shrink-0"
                                      style={{ backgroundColor: model.accentColor }}
                                      aria-hidden="true"
                                    />
                                  )}
                                  {model.name}
                                  {isBoss && (
                                    <span
                                      className="text-[10px] font-semibold opacity-85"
                                      style={{ color: BOSS_TIER_THEME.mutedTextHex }}
                                    >
                                      · {model.difficultyLabel}
                                    </span>
                                  )}
                                </span>
                                <span
                                  className="text-[10px] font-mono-num font-bold shrink-0"
                                  style={{ color: isBoss ? '#FB7185' : model.accentColor }}
                                >
                                  Lv.{model.difficultyLevel}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {/* 自定义大模型脚本（仅在已有脚本时展示紧凑卡片行） */}
                      {customBotScripts.length > 0 && (
                        <div className="pt-2 border-t border-dashed border-[var(--border)] space-y-1.5">
                          <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--muted)]">
                            <Code2 className="w-3 h-3 text-[var(--accent)]" aria-hidden="true" />
                            <span>自定义脚本（{customBotScripts.length}）</span>
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            {customBotScripts.map((script) => {
                              const selected =
                                activeSelection?.source === 'custom' &&
                                activeSelection.modelId === script.id;
                              return (
                                <button
                                  key={script.id}
                                  type="button"
                                  role="radio"
                                  aria-checked={selected}
                                  data-testid={`ai-custom-card-${profile.slotId}-${script.id}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onAiModelChange?.(profile.slotId, `custom:${script.id}`);
                                  }}
                                  className={`text-left rounded-xl border px-2.5 py-1.5 transition-colors cursor-pointer ${
                                    selected
                                      ? 'bg-[var(--accent)]/12 border-[var(--accent)]'
                                      : 'bg-[var(--surface-secondary)]/60 border-[var(--border)] hover:border-[var(--accent)]/50'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--foreground)] truncate">
                                      <span
                                        className="w-2 h-2 rounded-full shrink-0"
                                        style={{ backgroundColor: script.defaultColorHex }}
                                        aria-hidden="true"
                                      />
                                      {script.name}
                                    </span>
                                    <span className="text-[10px] font-semibold text-[var(--accent)] shrink-0">
                                      {script.tierLabel}
                                    </span>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 四维战力指示条（精简直观，无大段文字） */}
                    {activeModel && (
                      <div className="rounded-xl bg-[var(--surface-secondary)]/60 border border-[var(--border)] px-3 py-2 grid grid-cols-4 gap-2">
                        <TraitRatingBar
                          label="寻路"
                          value={activeModel.traits.navigation}
                          accentColor={activeModel.accentColor}
                        />
                        <TraitRatingBar
                          label="闪避"
                          value={activeModel.traits.dodging}
                          accentColor={activeModel.accentColor}
                        />
                        <TraitRatingBar
                          label="瞄准"
                          value={activeModel.traits.aiming}
                          accentColor={activeModel.accentColor}
                        />
                        <TraitRatingBar
                          label="道具"
                          value={activeModel.traits.items}
                          accentColor={activeModel.accentColor}
                        />
                      </div>
                    )}
                  </div>
                )
              ) : hideKeybindings ? (
                !keybindingsOnly && actions.length > 0 && (
                  <div className="pt-3 border-t border-[var(--separator)] flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--muted)]">
                      <Keyboard className="w-3.5 h-3.5 text-[var(--accent)]" aria-hidden="true" />
                      <span>当前按键</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {actions.map((action) => {
                        const code = bindingsBySlot[profile.slotId]?.[action.id] ?? '';
                        return (
                          <span
                            key={action.id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[var(--surface-secondary)] border border-[var(--border)] text-[11px]"
                          >
                            <span className="text-[var(--muted)]">{action.label.split(' ')[0]}</span>
                            <kbd className="font-mono-num font-bold text-[var(--foreground)]">
                              {formatKeyCode(code)}
                            </kbd>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )
              ) : (
                <div
                  data-testid={`keybind-section-${profile.slotId}`}
                  className={keybindingsOnly ? '' : 'pt-3 border-t border-[var(--separator)]'}
                >
                    {!keybindingsOnly && (
                      <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--foreground)] mb-2">
                        <Keyboard className="w-3.5 h-3.5 text-[var(--accent)]" aria-hidden="true" />
                        <span>按键绑定</span>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      {actions.map((action) => {
                        const currentCode = bindingsBySlot[profile.slotId]?.[action.id] ?? '';
                        const fieldKey = `${profile.slotId}:${action.id}`;
                        const errorText = bindingValidation.fieldErrors[fieldKey];
                        const isCapturing =
                          capturing?.slotId === profile.slotId &&
                          capturing?.actionId === action.id;

                        return (
                          <div key={action.id} className="space-y-1">
                            <div
                              className={`flex items-center justify-between gap-2 px-2.5 py-1.5 min-h-[40px] rounded-xl border ${
                                errorText
                                  ? 'bg-red-500/10 border-red-500/50'
                                  : isCapturing
                                  ? 'bg-amber-500/12 border-amber-500/50'
                                  : 'bg-[var(--surface-secondary)]/55 border-[var(--border)]'
                              }`}
                            >
                              <span className="text-xs font-semibold text-[var(--foreground)] truncate">
                                {action.label}
                              </span>
                              <Button
                                size="sm"
                                variant={
                                  isCapturing
                                    ? 'primary'
                                    : errorText
                                    ? 'danger'
                                    : 'secondary'
                                }
                                data-testid={`bind-btn-${profile.slotId}-${action.id}`}
                                aria-label={`修改 ${profile.slotId.toUpperCase()} ${action.label} 按键，当前 ${formatKeyCode(currentCode)}`}
                                onPress={() => {
                                  onSelectSlot?.(profile.slotId);
                                  setCaptureNotice(null);
                                  updateCapturing(
                                    isCapturing
                                      ? null
                                      : { slotId: profile.slotId, actionId: action.id }
                                  );
                                }}
                                className="h-7 px-2.5 !rounded-full text-xs font-mono-num font-bold whitespace-nowrap shrink-0"
                              >
                                {isCapturing ? '按键…' : formatKeyCode(currentCode)}
                              </Button>
                            </div>
                            {errorText && (
                              <p className="text-[11px] font-medium text-red-600 dark:text-red-400 px-1">
                                {errorText}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TraitRatingBar({
  label,
  value,
  accentColor,
}: {
  label: string;
  value: number;
  accentColor: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="font-semibold text-[var(--muted)]">{label}</span>
        <span className="font-mono-num font-bold text-[var(--foreground)]">{value}</span>
      </div>
      <div className="grid grid-cols-5 gap-0.5">
        {Array.from({ length: 5 }).map((_, idx) => (
          <span
            key={idx}
            className="h-1.5 rounded-full"
            style={{
              backgroundColor: idx < value ? accentColor : 'var(--border)',
            }}
          />
        ))}
      </div>
    </div>
  );
}

function MiniTankPreview({ colorHex }: { colorHex: string }) {
  return (
    <svg viewBox="0 0 48 48" className="w-10 h-10" aria-hidden="true">
      <rect x="8" y="8" width="32" height="7" rx="2" fill="#2B3139" />
      <rect x="8" y="33" width="32" height="7" rx="2" fill="#2B3139" />
      <rect
        x="10"
        y="13"
        width="28"
        height="22"
        rx="3.5"
        fill={colorHex}
        stroke="#1C2127"
        strokeWidth="2"
      />
      <rect
        x="24"
        y="21"
        width="20"
        height="6"
        rx="1.5"
        fill="#262D35"
        stroke="#14181C"
        strokeWidth="1.2"
      />
      <circle cx="22" cy="24" r="7.5" fill={colorHex} stroke="#1C2127" strokeWidth="2" />
      <circle cx="20.5" cy="22.5" r="2.6" fill="rgba(255,255,255,0.35)" />
    </svg>
  );
}
