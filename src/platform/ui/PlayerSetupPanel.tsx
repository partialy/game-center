import { useEffect, useState } from 'react';
import { Button, Input, Tabs } from '@heroui/react';
import {
  AlertCircle,
  Bot,
  Code2,
  Cpu,
  Eye,
  Keyboard,
  Lock,
  Plus,
  RotateCcw,
  User,
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
          `${customMatch.authorModel ? `${customMatch.authorModel} 生成 · ` : ''}独立 Worker 沙箱运行`,
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
  /** 设置页「基础」分类仅展示玩家资料与 AI 选择，不重复展示改键 */
  hideKeybindings?: boolean;
  /** 设置页「操控」分类仅展示按键绑定编辑区 */
  keybindingsOnly?: boolean;
}

/**
 * HeroUI v3 玩家资料、AI 脚本模型与改键配置面板（赛前页与设置页共用）。
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
        setCaptureNotice('Esc 保留用于暂停/继续，已取消本次改键录入。');
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
    ? '桌面键盘按键绑定'
    : gameMode === 'single'
    ? '单人阵容与 AI 模型'
    : '玩家资料与涂装';
  const panelSubtitle = keybindingsOnly
    ? '点击动作键帽后按下键盘实体键，或直接点击上方视觉键盘键帽完成改键（Esc 保留暂停）'
    : gameMode === 'single'
    ? singleMatchup === 'ai_vs_ai'
      ? '双 AI 策略脚本自动对抗 · Esc 可随时暂停观战'
      : 'P1 键盘操控 · P2 由 TS AI 策略脚本接管'
    : '共用键盘操作 · Esc 保留用于暂停与继续';

  return (
    <section aria-label={panelTitle} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold tracking-tight text-[var(--foreground)]">
            {panelTitle}
          </h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">{panelSubtitle}</p>
        </div>
        {humanSlotIds.length > 0 && !hideKeybindings && (
          <Button
            variant="secondary"
            size="sm"
            onPress={() => {
              updateCapturing(null);
              setCaptureNotice(null);
              onResetBindings();
            }}
            className="min-h-[38px] max-sm:min-h-[44px] whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            恢复默认按键
          </Button>
        )}
      </div>

      {/* 单人模式对阵方式切换：玩家 vs AI / AI vs AI 观战测试 */}
      {!keybindingsOnly && gameMode === 'single' && onSingleMatchupChange && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3.5 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-[var(--foreground)]">单人对阵方式</span>
            <Tabs
              selectedKey={singleMatchup}
              onSelectionChange={(key) => {
                updateCapturing(null);
                onSingleMatchupChange(String(key) as SingleMatchup);
              }}
            >
              <Tabs.ListContainer>
                <Tabs.List
                  aria-label="单人对阵方式"
                  className="bg-[var(--surface-secondary)] border border-[var(--border)] p-1 rounded-xl"
                >
                  <Tabs.Tab
                    id="human_vs_ai"
                    data-testid="matchup-human-vs-ai"
                    className="px-3 py-1.5 min-h-[36px] text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <User className="w-3.5 h-3.5" aria-hidden="true" />
                    玩家 vs AI
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab
                    id="ai_vs_ai"
                    data-testid="matchup-ai-vs-ai"
                    className="px-3 py-1.5 min-h-[36px] text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                    AI vs AI 观战
                    <Tabs.Indicator />
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>
            </Tabs>
          </div>
          <p className="text-[11px] leading-relaxed text-[var(--muted)]">
            {singleMatchup === 'ai_vs_ai'
              ? '双方均由独立 TypeScript 策略脚本操控，可自由组合不同难度模型进行实机互博评测。'
              : '你控制 P1 坦克，P2 由下方所选 AI 策略脚本自动决策并实时作战。'}
          </p>
        </div>
      )}

      {/* 操控模式切换（仅在赛前页传入时展示） */}
      {!keybindingsOnly &&
        controlModeOptions &&
        controlModeOptions.length > 0 &&
        onControlModeChange && (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3.5 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-[var(--foreground)]">操控模式</span>
              <Tabs
                selectedKey={controlMode ?? controlModeOptions[0].value}
                onSelectionChange={(key) => onControlModeChange(String(key))}
              >
                <Tabs.ListContainer>
                  <Tabs.List
                    aria-label="操控模式切换"
                    className="bg-[var(--surface-secondary)] border border-[var(--border)] p-1 rounded-xl"
                  >
                    {controlModeOptions.map((opt) => (
                      <Tabs.Tab
                        key={opt.value}
                        id={opt.value}
                        className="px-3 py-1.5 min-h-[36px] text-xs font-semibold whitespace-nowrap"
                      >
                        {opt.label}
                        <Tabs.Indicator />
                      </Tabs.Tab>
                    ))}
                  </Tabs.List>
                </Tabs.ListContainer>
              </Tabs>
            </div>
            {controlModeOptions.find((o) => o.value === controlMode)?.description && (
              <p className="text-[11px] leading-relaxed text-[var(--muted)]">
                {controlModeOptions.find((o) => o.value === controlMode)?.description}
              </p>
            )}
          </div>
        )}

      {captureNotice && (
        <div
          role="status"
          className="flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium rounded-xl bg-amber-500/12 border border-amber-500/35 text-amber-800 dark:text-amber-300"
        >
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{captureNotice}</span>
        </div>
      )}

      {!bindingValidation.valid && humanSlotIds.length > 0 && !hideKeybindings && (
        <div
          role="alert"
          className="flex items-start gap-2 px-3.5 py-2.5 text-xs font-medium rounded-xl bg-red-500/10 border border-red-500/35 text-red-700 dark:text-red-300"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>存在重复或非法按键绑定，请先修改标红冲突项后再开始比赛。</span>
        </div>
      )}

      <div className={keybindingsOnly ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'space-y-4'}>
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
          const activeCustom = activeSelection?.customScript ?? null;

          return (
            <div
              key={profile.slotId}
              data-testid={`player-setup-card-${profile.slotId}`}
              data-controller={controller}
              onClick={() => {
                if (!isAiSlot) onSelectSlot?.(profile.slotId);
              }}
              className={`bg-[var(--surface)] border rounded-xl p-4 space-y-4 transition-colors ${
                isSelectedCard
                  ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]/25'
                  : 'border-[var(--border)]'
              }`}
            >
              {/* 顶部：玩家位标识 + 微型坦克涂装预览 + 名字输入（keybindingsOnly 仅展示紧凑标题） */}
              {keybindingsOnly ? (
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-[var(--separator)]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-3 h-3 rounded-sm shrink-0"
                      style={{ backgroundColor: profile.colorHex }}
                    />
                    <span className="text-sm font-bold text-[var(--foreground)] truncate">
                      {displayName}（{profile.slotId.toUpperCase()}）
                    </span>
                  </div>
                  <span className="text-[11px] font-medium text-[var(--muted)]">
                    点击键帽改键
                  </span>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3.5">
                    <div
                      className="w-12 h-12 rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] flex items-center justify-center shrink-0"
                      aria-hidden="true"
                    >
                      <MiniTankPreview colorHex={profile.colorHex} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label
                          htmlFor={`player-name-${profile.slotId}`}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--muted)]"
                        >
                          <span>{profile.slotId.toUpperCase()}</span>
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              isAiSlot
                                ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
                                : 'bg-[var(--surface-secondary)] text-[var(--foreground)]'
                            }`}
                          >
                            {isAiSlot ? (
                              <>
                                <Bot className="w-3 h-3" aria-hidden="true" />
                                AI 脚本
                              </>
                            ) : (
                              <>
                                <User className="w-3 h-3" aria-hidden="true" />
                                人类玩家
                              </>
                            )}
                          </span>
                        </label>
                        <span className="text-xs text-[var(--muted)] whitespace-nowrap">
                          显示为 <strong className="text-[var(--foreground)]">{displayName}</strong>
                        </span>
                      </div>
                      <Input
                        id={`player-name-${profile.slotId}`}
                        type="text"
                        maxLength={10}
                        value={profile.name}
                        placeholder={profile.slotId.toUpperCase()}
                        onChange={(e) =>
                          onProfileChange(profile.slotId, { name: e.target.value })
                        }
                        className={`w-full min-h-[40px] max-sm:min-h-[44px] px-3 text-sm bg-[var(--field-background)] text-[var(--field-foreground)] border rounded-lg ${
                          nameError ? 'border-red-500' : 'border-[var(--field-border)]'
                        }`}
                      />
                      {nameError && (
                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                          {nameError}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* 涂装色板 */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold text-[var(--muted)]">
                        坦克与弹道涂装
                      </span>
                      {colorError && (
                        <span className="text-xs font-medium text-red-600 dark:text-red-400">
                          {colorError}
                        </span>
                      )}
                    </div>
                    <div
                      className="flex flex-wrap items-center gap-2"
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
                            title={isTaken ? `${option.label}（已由其他玩家占用）` : option.label}
                            className={`relative w-8 h-8 rounded-lg flex items-center justify-center transition-transform ${
                              isSelected
                                ? 'ring-2 ring-offset-2 ring-[var(--foreground)] ring-offset-[var(--surface)] scale-105'
                                : isTaken
                                ? 'opacity-30 cursor-not-allowed'
                                : 'hover:scale-105 cursor-pointer'
                            }`}
                            style={{ backgroundColor: option.hex }}
                          >
                            {isTaken && (
                              <Lock className="w-3.5 h-3.5 text-white drop-shadow" aria-hidden="true" />
                            )}
                            {isSelected && !isTaken && (
                              <span className="w-2.5 h-2.5 rounded-sm bg-white/95" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {/* 人类槽位：五个动作改键列表；AI 槽位：五档 TS 策略脚本选择器 */}
              {isAiSlot ? (
                !keybindingsOnly && (
                  <div
                    data-testid={`ai-model-selector-${profile.slotId}`}
                    className="pt-3 border-t border-[var(--separator)] space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--muted)]">
                        <Cpu className="w-3.5 h-3.5 text-[var(--foreground)]" aria-hidden="true" />
                        <span>选择 AI 对战模型（内置 / 自定义脚本）</span>
                      </div>
                      {activeSelection && (
                        <span
                          className="text-[11px] font-mono-num font-bold truncate max-w-[140px]"
                          style={{ color: activeSelection.accentColor }}
                        >
                          {activeSelection.tierText}
                        </span>
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
                            className={`relative text-left rounded-xl border px-3 py-2.5 min-h-[54px] transition-all cursor-pointer ${
                              isBoss
                                ? selected
                                  ? 'ring-2 ring-[#C81E3D]/60 shadow-sm'
                                  : 'hover:brightness-110'
                                : selected
                                ? 'bg-[var(--accent)]/12 border-[var(--accent)] shadow-xs'
                                : 'bg-[var(--surface-secondary)]/65 border-[var(--border)] hover:border-[var(--accent)]/50'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              <span
                                className={`inline-flex items-center gap-1.5 text-xs font-bold truncate ${
                                  isBoss ? '' : 'text-[var(--foreground)]'
                                }`}
                                style={isBoss ? { color: BOSS_TIER_THEME.textHex } : undefined}
                              >
                                <span
                                  className="w-2 h-2 rounded-xs shrink-0"
                                  style={{ backgroundColor: model.accentColor }}
                                  aria-hidden="true"
                                />
                                {model.name}
                              </span>
                              <span
                                className="text-[10px] font-mono-num font-bold shrink-0"
                                style={{ color: isBoss ? '#FB7185' : model.accentColor }}
                              >
                                Lv.{model.difficultyLevel}
                              </span>
                            </div>
                            <div
                              className={`text-[10px] mt-0.5 truncate ${
                                isBoss ? 'font-semibold' : 'text-[var(--muted)]'
                              }`}
                              style={isBoss ? { color: BOSS_TIER_THEME.mutedTextHex } : undefined}
                            >
                              {isBoss
                                ? `Lv.${model.difficultyLevel} · ${model.name} (${model.difficultyLabel})`
                                : model.difficultyLabel}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* 自定义大模型脚本库 */}
                    <div className="pt-2.5 border-t border-dashed border-[var(--border)] space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--muted)]">
                          <Code2 className="w-3.5 h-3.5 text-[var(--accent)]" aria-hidden="true" />
                          自定义大模型脚本（{customBotScripts.length}）
                        </span>
                        {onOpenAiStudio && (
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`open-studio-from-slot-${profile.slotId}`}
                            onPress={() => onOpenAiStudio('editor')}
                            className="h-7 px-2 text-[11px] font-bold text-[var(--accent)]"
                          >
                            <Plus className="w-3 h-3" aria-hidden="true" />
                            导入大模型脚本
                          </Button>
                        )}
                      </div>

                      {customBotScripts.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2">
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
                                className={`text-left rounded-xl border px-2.5 py-2 transition-colors cursor-pointer ${
                                  selected
                                    ? 'bg-[var(--accent)]/12 border-[var(--accent)] shadow-xs'
                                    : 'bg-[var(--surface-secondary)]/65 border-[var(--border)] hover:border-[var(--accent)]/50'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1.5">
                                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--foreground)] truncate">
                                    <span
                                      className="w-2 h-2 rounded-xs shrink-0"
                                      style={{ backgroundColor: script.defaultColorHex }}
                                      aria-hidden="true"
                                    />
                                    {script.name}
                                  </span>
                                  <span className="text-[10px] font-semibold text-[var(--accent)] shrink-0">
                                    {script.tierLabel}
                                  </span>
                                </div>
                                <div className="text-[10px] text-[var(--muted)] mt-0.5 truncate">
                                  {script.validation.status === 'verified'
                                    ? `沙箱通过 · ${script.validation.avgDecisionMs.toFixed(2)}ms`
                                    : script.authorModel || 'Worker 沙箱脚本'}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-[11px] text-[var(--muted)]">
                          还没有自定义脚本，可在「AI 脚本工坊」复制规则 MD 给大模型生成并粘贴参战。
                        </p>
                      )}
                    </div>

                    {activeModel && (
                      <div className="rounded-xl bg-[var(--surface-secondary)]/70 border border-[var(--border)] px-3 py-2.5 space-y-2">
                        <p className="text-[11px] leading-relaxed text-[var(--foreground)]/90">
                          {activeModel.summary}
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
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
                      </div>
                    )}

                    {activeCustom && (
                      <div className="rounded-xl bg-[var(--surface-secondary)]/70 border border-[var(--border)] px-3 py-2.5 space-y-1 text-[11px] text-[var(--muted)]">
                        <div className="flex items-center justify-between gap-2 font-bold text-[var(--foreground)]">
                          <span>自定义 Worker 沙箱 AI · {activeCustom.name}</span>
                          {activeCustom.authorModel && (
                            <span className="text-[var(--muted)] font-medium">
                              {activeCustom.authorModel}
                            </span>
                          )}
                        </div>
                        <p className="leading-relaxed">
                          {activeCustom.description ||
                            '在独立 Web Worker 沙箱内以 30Hz 异步决策运行，具备死循环硬超时隔离保护。'}
                        </p>
                      </div>
                    )}
                  </div>
                )
              ) : (
                !hideKeybindings && (
                  <div
                    data-testid={`keybind-section-${profile.slotId}`}
                    className={keybindingsOnly ? '' : 'pt-2.5 border-t border-[var(--separator)]'}
                  >
                    {!keybindingsOnly && (
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--muted)] mb-2">
                        <Keyboard className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>按键绑定（点击键帽后按下目标键）</span>
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                              className={`flex items-center justify-between gap-2 px-2.5 py-1.5 min-h-[42px] rounded-lg border ${
                                errorText
                                  ? 'bg-red-500/10 border-red-500/50'
                                  : isCapturing
                                  ? 'bg-amber-500/12 border-amber-500/50'
                                  : 'bg-[var(--surface-secondary)]/55 border-[var(--border)]'
                              }`}
                            >
                              <span className="text-xs font-medium text-[var(--foreground)] truncate">
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
                                className="min-h-[32px] px-2.5 text-xs font-mono-num font-bold whitespace-nowrap shrink-0"
                              >
                                {isCapturing ? '请按键…' : formatKeyCode(currentCode)}
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
                )
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
        <span className="font-mono-num font-bold text-[var(--foreground)]">{value}/5</span>
      </div>
      <div className="grid grid-cols-5 gap-0.5">
        {Array.from({ length: 5 }).map((_, idx) => (
          <span
            key={idx}
            className="h-1.5 rounded-[1px]"
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
