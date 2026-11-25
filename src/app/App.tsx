import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRandomSeed } from '../games/tank-battle/map/rng';
import type {
  ArenaSeatConfig,
  CustomBotScriptRecord,
  GameDefinition,
  GameMode,
  MatchLaunchSnapshot,
  MatchResultEvent,
  PlayerConfig,
  PlayerProfile,
  PlayerSlotId,
  RulePreset,
  SingleMatchup,
} from '../platform/games/contracts';
import { gameRegistry } from '../platform/games/registry';
import {
  loadCustomBotScripts,
  saveCustomBotScripts,
} from '../platform/ai/customBotStore';
import {
  resolveDisplayName,
  validateBindings,
  validatePlayerColors,
  validatePlayerName,
} from '../platform/input/bindings';
import {
  getDefaultArenaSeats,
  loadArenaSeats,
  loadGameBindings,
  loadGameRules,
  loadModePreferences,
  loadPlayerProfiles,
  loadRulePresets,
  saveArenaSeats,
  saveGameBindings,
  saveGameRules,
  saveModePreferences,
  savePlayerProfiles,
  saveRulePresets,
  type ModePreferences,
} from '../platform/settings/preferencesStore';
import {
  resolveDevDebugMode,
  saveDevDebugMode,
} from '../platform/debug/perfMonitor';
import {
  appendMatchHistory,
  createDemoMatchHistory,
  loadMatchHistory,
  type MatchHistoryRecord,
} from '../platform/history/matchHistoryStore';
import { AiScriptStudioModal } from '../platform/ui/AiScriptStudioModal';
import { findNextUnusedColorHex, validateArenaSeats } from '../platform/ui/ArenaRosterPanel';
import { GameViewport } from '../platform/ui/GameViewport';
import { LobbyView } from '../platform/ui/LobbyView';
import { MatchResultsView } from '../platform/ui/MatchResultsView';
import { resolveSlotAiSelection, resolveSlotController } from '../platform/ui/PlayerSetupPanel';
import { PreMatchView } from '../platform/ui/PreMatchView';
import { SettingsView } from '../platform/ui/SettingsView';
import { registerAllGames } from './gameCatalog';

registerAllGames();

type AppView = 'lobby' | 'setup' | 'settings' | 'battle' | 'results';

export default function App() {
  const games = useMemo(() => gameRegistry.list(), []);
  const [selectedGameId, setSelectedGameId] = useState<string>(
    () => games[0]?.id ?? 'tank-battle'
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentGame = useMemo<GameDefinition<any, any>>(() => {
    return gameRegistry.get(selectedGameId) ?? games[0];
  }, [games, selectedGameId]);

  const [storageNotice, setStorageNotice] = useState<string | null>(null);

  // 0. 游戏模式偏好（单人/多人、玩家 vs AI / AI 观战、各槽位 AI 策略脚本模型）
  const [modePrefs, setModePrefs] = useState<ModePreferences>(() => {
    const defaultModelId = currentGame.defaultBotModelId ?? 'tactical';
    const res = loadModePreferences(defaultModelId);
    if (res.notice) setStorageNotice(res.notice);
    return res.value;
  });

  const { gameMode, singleMatchup, aiModelBySlot } = modePrefs;

  // 1. 全站玩家资料草稿
  const [profiles, setProfiles] = useState<PlayerProfile[]>(() => {
    const res = loadPlayerProfiles(currentGame.defaultPlayerCount);
    if (res.notice) setStorageNotice((prev) => prev ?? res.notice);
    return res.value;
  });

  // 2. 当前游戏按键映射草稿
  const [bindingsBySlot, setBindingsBySlot] = useState<
    Record<PlayerSlotId, Record<string, string>>
  >(() => {
    const res = loadGameBindings(currentGame);
    if (res.notice) setStorageNotice((prev) => prev ?? res.notice);
    return res.value;
  });

  // 3. 当前游戏在当前模式（single / multi）下独立保存的规则草稿与命名预设
  const [rulesDraft, setRulesDraft] = useState<Record<string, unknown>>(() => {
    const res = loadGameRules(currentGame, undefined, modePrefs.gameMode);
    if (res.notice) setStorageNotice((prev) => prev ?? res.notice);
    return res.value as Record<string, unknown>;
  });

  const [presets, setPresets] = useState<RulePreset<Record<string, unknown>>[]>(() => {
    const res = loadRulePresets(currentGame, undefined, modePrefs.gameMode);
    if (res.notice) setStorageNotice((prev) => prev ?? res.notice);
    return res.value as RulePreset<Record<string, unknown>>[];
  });

  const [activePresetId, setActivePresetId] = useState<string | null>(null);

  // 4. 当前游戏的持久化自定义 AI 脚本库与多 AI 乱斗席位阵容（2～8 席）
  const [customBotScripts, setCustomBotScripts] = useState<CustomBotScriptRecord[]>(() => {
    const res = loadCustomBotScripts(currentGame.id);
    if (res.notice) setStorageNotice((prev) => prev ?? res.notice);
    return res.value;
  });

  const [arenaSeats, setArenaSeats] = useState<ArenaSeatConfig[]>(() => {
    const builtinIds = (currentGame.botModels ?? []).map((m) => m.id);
    const res = loadArenaSeats(currentGame.id, builtinIds);
    if (res.notice) setStorageNotice((prev) => prev ?? res.notice);
    return res.value;
  });

  const [aiStudioState, setAiStudioState] = useState<{
    open: boolean;
    initialTab: 'prompt' | 'editor';
  }>({ open: false, initialTab: 'prompt' });

  // 视图与对局快照状态
  const [view, setView] = useState<AppView>('lobby');
  const [activeSnapshot, setActiveSnapshot] =
    useState<MatchLaunchSnapshot<Record<string, unknown>> | null>(null);
  const [lastResult, setLastResult] = useState<MatchResultEvent | null>(null);
  const [matchHistory, setMatchHistory] = useState<MatchHistoryRecord[]>(() =>
    loadMatchHistory()
  );
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [battlePaused, setBattlePaused] = useState(false);
  const [settingsOverlayOpen, setSettingsOverlayOpen] = useState(false);
  const [devDebugMode, setDevDebugMode] = useState<boolean>(() => resolveDevDebugMode());

  const handleToggleDevDebugMode = useCallback(() => {
    setDevDebugMode((prev) => {
      const next = !prev;
      saveDevDebugMode(next);
      return next;
    });
  }, []);

  const ruleIssues = useMemo(
    () => currentGame.validateRules(rulesDraft),
    [currentGame, rulesDraft]
  );

  // 切换游戏时重载对应游戏的按键、当前模式下的规则、预设、自定义脚本库与乱斗席位
  const handleSelectGame = useCallback(
    (gameId: string) => {
      const nextGame = gameRegistry.get(gameId);
      if (!nextGame) return;
      setSelectedGameId(gameId);
      const bRes = loadGameBindings(nextGame);
      const rRes = loadGameRules(nextGame, undefined, gameMode);
      const pRes = loadRulePresets(nextGame, undefined, gameMode);
      const cRes = loadCustomBotScripts(nextGame.id);
      const sRes = loadArenaSeats(
        nextGame.id,
        (nextGame.botModels ?? []).map((m) => m.id)
      );
      setBindingsBySlot(bRes.value);
      setRulesDraft(rRes.value as Record<string, unknown>);
      setPresets(pRes.value as RulePreset<Record<string, unknown>>[]);
      setCustomBotScripts(cRes.value);
      setArenaSeats(sRes.value);
      setActivePresetId(null);
      setStorageNotice(
        bRes.notice ?? rRes.notice ?? pRes.notice ?? cRes.notice ?? sRes.notice ?? null
      );
    },
    [gameMode]
  );

  // 自定义 AI 脚本库增删改与导入
  const handleSaveCustomBotScript = useCallback(
    (record: CustomBotScriptRecord) => {
      setCustomBotScripts((prev) => {
        const idx = prev.findIndex((s) => s.id === record.id);
        const next =
          idx >= 0
            ? prev.map((s) => (s.id === record.id ? record : s))
            : [record, ...prev];
        const saved = saveCustomBotScripts(currentGame.id, next);
        if (!saved.ok && saved.error) setStorageNotice(saved.error);
        return next;
      });
    },
    [currentGame.id]
  );

  const handleDeleteCustomBotScript = useCallback(
    (scriptId: string) => {
      setCustomBotScripts((prev) => {
        const next = prev.filter((s) => s.id !== scriptId);
        const saved = saveCustomBotScripts(currentGame.id, next);
        if (!saved.ok && saved.error) setStorageNotice(saved.error);
        return next;
      });
    },
    [currentGame.id]
  );

  const handleImportCustomBotScripts = useCallback(
    (records: CustomBotScriptRecord[]) => {
      setCustomBotScripts((prev) => {
        const next = [...records, ...prev];
        const saved = saveCustomBotScripts(currentGame.id, next);
        if (!saved.ok && saved.error) setStorageNotice(saved.error);
        return next;
      });
    },
    [currentGame.id]
  );

  const handleArenaSeatsChange = useCallback(
    (nextSeats: ArenaSeatConfig[]) => {
      setArenaSeats(nextSeats);
      const check = validateArenaSeats(nextSeats);
      if (check.valid) {
        const saved = saveArenaSeats(currentGame.id, nextSeats);
        if (!saved.ok && saved.error) setStorageNotice(saved.error);
      }
    },
    [currentGame.id]
  );

  const handleQuickSetArenaSeatCount = useCallback(
    (targetCount: number) => {
      const clamped = Math.max(2, Math.min(Math.min(8, currentGame.maxPlayers), targetCount));
      setArenaSeats((prev) => {
        let next: ArenaSeatConfig[];
        if (clamped <= prev.length) {
          next = prev.slice(0, clamped).map((s, idx) => ({ ...s, slotId: `p${idx + 1}` }));
        } else {
          const models = currentGame.botModels ?? [];
          next = [...prev];
          while (next.length < clamped) {
            const idx = next.length;
            const builtin = models[idx % Math.max(1, models.length)];
            next.push({
              slotId: `p${idx + 1}`,
              name: '',
              colorHex: findNextUnusedColorHex(next),
              controller: 'ai',
              aiSource: 'builtin',
              aiModelId: builtin?.id ?? 'tactical',
            });
          }
        }
        const saved = saveArenaSeats(currentGame.id, next);
        if (!saved.ok && saved.error) setStorageNotice(saved.error);
        return next;
      });
    },
    [currentGame.botModels, currentGame.id, currentGame.maxPlayers]
  );

  // 切换单人 / 多人模式时，自动重载该模式独立保存的规则与预设
  const handleGameModeChange = useCallback(
    (nextMode: GameMode) => {
      setModePrefs((prev) => {
        if (prev.gameMode === nextMode) return prev;
        const next: ModePreferences = { ...prev, gameMode: nextMode };
        const saved = saveModePreferences(next);
        if (!saved.ok && saved.error) setStorageNotice(saved.error);
        return next;
      });
      const rRes = loadGameRules(currentGame, undefined, nextMode);
      const pRes = loadRulePresets(currentGame, undefined, nextMode);
      setRulesDraft(rRes.value as Record<string, unknown>);
      setPresets(pRes.value as RulePreset<Record<string, unknown>>[]);
      setActivePresetId(null);
      if (rRes.notice ?? pRes.notice) {
        setStorageNotice(rRes.notice ?? pRes.notice ?? null);
      }
    },
    [currentGame]
  );

  const handleSingleMatchupChange = useCallback((nextMatchup: SingleMatchup) => {
    setModePrefs((prev) => {
      if (prev.singleMatchup === nextMatchup) return prev;
      const next: ModePreferences = { ...prev, singleMatchup: nextMatchup };
      const saved = saveModePreferences(next);
      if (!saved.ok && saved.error) setStorageNotice(saved.error);
      return next;
    });
  }, []);

  const handleAiModelChange = useCallback((slotId: PlayerSlotId, modelId: string) => {
    setModePrefs((prev) => {
      if (prev.aiModelBySlot[slotId] === modelId) return prev;
      const next: ModePreferences = {
        ...prev,
        aiModelBySlot: {
          ...prev.aiModelBySlot,
          [slotId]: modelId,
        },
      };
      const saved = saveModePreferences(next);
      if (!saved.ok && saved.error) setStorageNotice(saved.error);
      return next;
    });
  }, []);

  // 构造经校验的玩家与 AI 配置并冻结比赛快照（兼容单人、多人与 2～8 席 AI 乱斗）
  const launchMatch = useCallback(
    (
      game: GameDefinition<Record<string, unknown>, unknown>,
      overrideRules?: Record<string, unknown>,
      forceFreshMap = false,
      overrideModePrefs?: Partial<ModePreferences>,
      overrideArenaSeats?: ArenaSeatConfig[]
    ) => {
      const effectiveMode = overrideModePrefs?.gameMode ?? gameMode;
      const effectiveMatchup = overrideModePrefs?.singleMatchup ?? singleMatchup;
      const effectiveAiModels = overrideModePrefs?.aiModelBySlot ?? aiModelBySlot;
      const effectiveSeats = overrideArenaSeats ?? arenaSeats;

      const targetRules = overrideRules ?? rulesDraft;
      const models = game.botModels ?? [];
      const fallbackModel =
        models.find((m) => m.id === game.defaultBotModelId) ?? models[0];
      const issues = game.validateRules(targetRules);
      const hasRuleErr = issues.some((i) => i.severity === 'error');

      let players: PlayerConfig[] = [];

      if (effectiveMode === 'brawl') {
        const seatCheck = validateArenaSeats(effectiveSeats);
        const humanBindingSlots = effectiveSeats
          .filter((s) => s.controller === 'human')
          .slice(0, 2)
          .map((_, idx) => (idx === 0 ? 'p1' : 'p2'));
        const bindingCheck = validateBindings(
          humanBindingSlots,
          game.actions,
          bindingsBySlot
        );
        if (!seatCheck.valid || !bindingCheck.valid || hasRuleErr) {
          setView('setup');
          return;
        }

        let humanSeq = 0;
        players = effectiveSeats.map((seat) => {
          if (seat.controller === 'human') {
            humanSeq += 1;
            const bindSlotKey = humanSeq === 1 ? 'p1' : 'p2';
            const displayName = seat.name.trim() || seat.slotId.toUpperCase();
            return {
              slotId: seat.slotId,
              rawName: seat.name,
              displayName,
              colorHex: seat.colorHex,
              bindings: { ...(bindingsBySlot[bindSlotKey] ?? {}) },
              controller: 'human',
            };
          }

          const rawModelKey =
            seat.aiSource === 'custom' ? `custom:${seat.aiModelId}` : seat.aiModelId;
          const resolved = resolveSlotAiSelection(rawModelKey, models, customBotScripts);
          const aiSource = resolved?.source ?? 'builtin';
          const aiModelId = resolved?.modelId ?? fallbackModel?.id;
          const aiModelName = resolved?.displayName ?? fallbackModel?.name;
          const customCode =
            resolved?.source === 'custom' ? resolved.customScript?.code : undefined;

          return {
            slotId: seat.slotId,
            rawName: seat.name,
            displayName: seat.name.trim() || aiModelName || seat.slotId.toUpperCase(),
            colorHex: seat.colorHex,
            bindings: {},
            controller: 'ai',
            aiSource,
            aiModelId,
            aiModelName,
            customBotCode: customCode,
          };
        });
      } else {
        const humanSlotIds = profiles
          .filter((p) => resolveSlotController(p.slotId, effectiveMode, effectiveMatchup) === 'human')
          .map((p) => p.slotId);
        const hasNameErr = profiles.some((p) => validatePlayerName(p.name) !== null);
        const hasColorErr = Object.keys(validatePlayerColors(profiles)).length > 0;
        const bindingCheck = validateBindings(humanSlotIds, game.actions, bindingsBySlot);

        if (hasNameErr || hasColorErr || !bindingCheck.valid || hasRuleErr) {
          setView('setup');
          return;
        }

        players = profiles.map((p) => {
          const controller = resolveSlotController(p.slotId, effectiveMode, effectiveMatchup);
          const resolved =
            controller === 'ai'
              ? resolveSlotAiSelection(effectiveAiModels[p.slotId], models, customBotScripts)
              : null;

          return {
            slotId: p.slotId,
            rawName: p.name,
            displayName: resolveDisplayName(p.slotId, p.name),
            colorHex: p.colorHex,
            bindings: { ...(bindingsBySlot[p.slotId] ?? {}) },
            controller,
            aiSource: controller === 'ai' ? resolved?.source ?? 'builtin' : undefined,
            aiModelId: controller === 'ai' ? resolved?.modelId ?? fallbackModel?.id : undefined,
            aiModelName:
              controller === 'ai' ? resolved?.displayName ?? fallbackModel?.name : undefined,
            customBotCode:
              controller === 'ai' && resolved?.source === 'custom'
                ? resolved.customScript?.code
                : undefined,
          };
        });
      }

      const seed = createRandomSeed();
      const preRules = forceFreshMap ? { ...targetRules, mapCode: '' } : { ...targetRules };
      const finalizedRules = game.finalizeMatchRules
        ? game.finalizeMatchRules(preRules, seed)
        : preRules;

      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }

      const snapshot: MatchLaunchSnapshot<Record<string, unknown>> = {
        gameId: game.id,
        rulesVersion: game.rulesVersion,
        rules: finalizedRules,
        players,
        sessionSeed: seed,
        gameMode: effectiveMode,
        singleMatchup: effectiveMode === 'single' ? effectiveMatchup : undefined,
      };

      setLastResult(null);
      setBattlePaused(false);
      setSettingsOverlayOpen(false);
      setActiveSnapshot(snapshot);
      setView('battle');
    },
    [
      aiModelBySlot,
      arenaSeats,
      bindingsBySlot,
      customBotScripts,
      gameMode,
      profiles,
      rulesDraft,
      singleMatchup,
    ]
  );

  // 支持 ?autostart=1(&mode=single|brawl&seats=6&matchup=ai_vs_ai...) 直达实时对战，或 ?demoResults=1 直达结算页
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('demoResults') === '1' && view === 'lobby' && !lastResult) {
      const demoHistory = createDemoMatchHistory();
      setMatchHistory(demoHistory);
      setActiveHistoryId(demoHistory[0]?.id ?? null);
      setLastResult(demoHistory[0]?.result ?? null);
      setView('results');
      return;
    }
    if (params.get('autostart') === '1' && view === 'lobby' && !activeSnapshot) {
      const modeParam = params.get('mode');
      const paramMode: GameMode =
        modeParam === 'brawl' ? 'brawl' : modeParam === 'single' ? 'single' : 'multi';
      const paramMatchup: SingleMatchup =
        params.get('matchup') === 'ai_vs_ai' ? 'ai_vs_ai' : 'human_vs_ai';
      const nextAiModels: Record<PlayerSlotId, string> = {
        ...aiModelBySlot,
      };
      const p1Bot = params.get('p1Bot');
      const p2Bot = params.get('p2Bot');
      if (p1Bot) nextAiModels.p1 = p1Bot;
      if (p2Bot) nextAiModels.p2 = p2Bot;

      const seatsParam = Number(params.get('seats') ?? '0');
      const customBrawlSeats =
        paramMode === 'brawl' && Number.isFinite(seatsParam) && seatsParam >= 2
          ? getDefaultArenaSeats(
              Math.min(8, Math.floor(seatsParam)),
              (currentGame.botModels ?? []).map((m) => m.id)
            )
          : undefined;

      const quickRules: Record<string, unknown> = {
        ...currentGame.getDefaultRules(),
        countdownSeconds: 0,
      };
      if (paramMode === 'brawl' && (customBrawlSeats?.length ?? arenaSeats.length) >= 5) {
        quickRules.gridCols = (customBrawlSeats?.length ?? arenaSeats.length) >= 7 ? 14 : 12;
        quickRules.gridRows = (customBrawlSeats?.length ?? arenaSeats.length) >= 7 ? 9 : 8;
      }

      launchMatch(
        currentGame,
        quickRules,
        true,
        {
          gameMode: paramMode,
          singleMatchup: paramMatchup,
          aiModelBySlot: nextAiModels,
        },
        customBrawlSeats
      );
    }
    // 仅在首次挂载检查启动参数
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 将平台与应用阶段同步到 document.body.dataset.state
  useEffect(() => {
    let stateLabel = 'title';
    if (view === 'lobby') stateLabel = 'title';
    else if (view === 'setup') stateLabel = 'setup';
    else if (view === 'settings') stateLabel = 'settings';
    else if (view === 'results') stateLabel = 'gameover';
    else if (view === 'battle') {
      stateLabel = settingsOverlayOpen || battlePaused ? 'paused' : 'playing';
    }
    document.body.dataset.state = stateLabel;
  }, [view, battlePaused, settingsOverlayOpen]);

  // ===== 玩家资料与改键更新（仅在合法时持久化） =====
  const handleProfileChange = useCallback(
    (slotId: PlayerSlotId, patch: Partial<PlayerProfile>) => {
      setProfiles((prev) => {
        const next = prev.map((p) => (p.slotId === slotId ? { ...p, ...patch } : p));
        const hasNameErr = next.some((p) => validatePlayerName(p.name) !== null);
        const hasColorErr = Object.keys(validatePlayerColors(next)).length > 0;
        if (!hasNameErr && !hasColorErr) {
          const saved = savePlayerProfiles(next);
          if (!saved.ok && saved.error) setStorageNotice(saved.error);
        }
        return next;
      });
    },
    []
  );

  const handleBindingChange = useCallback(
    (slotId: PlayerSlotId, actionId: string, keyCode: string) => {
      setBindingsBySlot((prev) => {
        const next: Record<PlayerSlotId, Record<string, string>> = {
          ...prev,
          [slotId]: {
            ...(prev[slotId] ?? {}),
            [actionId]: keyCode,
          },
        };
        const humanSlotIds = profiles
          .filter((p) => resolveSlotController(p.slotId, gameMode, singleMatchup) === 'human')
          .map((p) => p.slotId);
        const check = validateBindings(humanSlotIds, currentGame.actions, next);
        if (check.valid) {
          const saved = saveGameBindings(currentGame.id, next);
          if (!saved.ok && saved.error) setStorageNotice(saved.error);
        }
        return next;
      });
    },
    [currentGame.actions, currentGame.id, gameMode, profiles, singleMatchup]
  );

  const handleResetBindings = useCallback(() => {
    const defaults: Record<PlayerSlotId, Record<string, string>> = {};
    for (const [slot, map] of Object.entries(currentGame.defaultBindingsBySlot)) {
      defaults[slot] = { ...map };
    }
    setBindingsBySlot(defaults);
    const saved = saveGameBindings(currentGame.id, defaults);
    if (!saved.ok && saved.error) setStorageNotice(saved.error);
  }, [currentGame]);

  // ===== 规则草稿与命名预设更新（严格按当前 gameMode 独立持久化） =====
  const persistRulesIfValid = useCallback(
    (nextRules: Record<string, unknown>) => {
      const issues = currentGame.validateRules(nextRules);
      if (!issues.some((i) => i.severity === 'error')) {
        const saved = saveGameRules(
          currentGame.id,
          currentGame.rulesVersion,
          nextRules,
          undefined,
          gameMode
        );
        if (!saved.ok && saved.error) setStorageNotice(saved.error);
      }
    },
    [currentGame, gameMode]
  );

  const handleChangeRules = useCallback(
    (nextRules: Record<string, unknown>) => {
      setRulesDraft(nextRules);
      setActivePresetId(null);
      persistRulesIfValid(nextRules);
    },
    [persistRulesIfValid]
  );

  const handleSelectPreset = useCallback(
    (presetId: string | null) => {
      setActivePresetId(presetId);
      if (!presetId) return;
      const preset = presets.find((p) => p.id === presetId);
      if (!preset) return;
      const cloned = { ...preset.rules };
      setRulesDraft(cloned);
      persistRulesIfValid(cloned);
    },
    [persistRulesIfValid, presets]
  );

  const handleSaveNewPreset = useCallback(
    (name: string) => {
      const newPreset: RulePreset<Record<string, unknown>> = {
        id: `preset_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        name,
        rulesVersion: currentGame.rulesVersion,
        rules: { ...rulesDraft },
        updatedAt: Date.now(),
      };
      const nextPresets = [...presets, newPreset];
      setPresets(nextPresets);
      setActivePresetId(newPreset.id);
      const saved = saveRulePresets(currentGame.id, nextPresets, undefined, gameMode);
      if (!saved.ok && saved.error) setStorageNotice(saved.error);
    },
    [currentGame.id, currentGame.rulesVersion, gameMode, presets, rulesDraft]
  );

  const handleDeletePreset = useCallback(
    (presetId: string) => {
      const nextPresets = presets.filter((p) => p.id !== presetId);
      setPresets(nextPresets);
      if (activePresetId === presetId) setActivePresetId(null);
      const saved = saveRulePresets(currentGame.id, nextPresets, undefined, gameMode);
      if (!saved.ok && saved.error) setStorageNotice(saved.error);
    },
    [activePresetId, currentGame.id, gameMode, presets]
  );

  const handleResetAllRules = useCallback(() => {
    const defaults = currentGame.getDefaultRules() as Record<string, unknown>;
    setRulesDraft(defaults);
    setActivePresetId(null);
    persistRulesIfValid(defaults);
  }, [currentGame, persistRulesIfValid]);

  const handleResetGroupRules = useCallback(
    (groupId: string) => {
      const defaults = currentGame.getDefaultRules() as Record<string, unknown>;
      const groupFieldKeys = currentGame.ruleFields
        .filter((f) => f.group === groupId)
        .map((f) => f.key);
      const next = { ...rulesDraft };
      for (const k of groupFieldKeys) {
        next[k] = defaults[k];
      }
      setRulesDraft(next);
      setActivePresetId(null);
      persistRulesIfValid(next);
    },
    [currentGame, persistRulesIfValid, rulesDraft]
  );

  const openAiStudio = useCallback(
    (tab: 'prompt' | 'editor' = 'prompt', gameId?: string) => {
      if (gameId && gameId !== currentGame.id) {
        handleSelectGame(gameId);
      }
      setAiStudioState({ open: true, initialTab: tab });
    },
    [currentGame.id, handleSelectGame]
  );

  const aiStudioOverlay =
    aiStudioState.open && currentGame.aiSdk ? (
      <AiScriptStudioModal
        game={currentGame}
        rules={rulesDraft}
        scripts={customBotScripts}
        initialTab={aiStudioState.initialTab}
        onSaveScript={handleSaveCustomBotScript}
        onDeleteScript={handleDeleteCustomBotScript}
        onImportScripts={handleImportCustomBotScripts}
        onClose={() => setAiStudioState((prev) => ({ ...prev, open: false }))}
      />
    ) : null;

  // ===== 视图渲染 =====
  if (view === 'lobby') {
    return (
      <>
        <LobbyView
          games={games}
          gameMode={gameMode}
          onGameModeChange={handleGameModeChange}
          singleMatchup={singleMatchup}
          onSingleMatchupChange={handleSingleMatchupChange}
          aiModelBySlot={aiModelBySlot}
          onAiModelChange={handleAiModelChange}
          customBotScripts={customBotScripts}
          arenaSeats={arenaSeats}
          onQuickSetArenaSeatCount={handleQuickSetArenaSeatCount}
          onOpenAiStudio={(gameId, tab) => openAiStudio(tab ?? 'prompt', gameId)}
          onEnterPreMatch={(gameId) => {
            handleSelectGame(gameId);
            setView('setup');
          }}
          onEnterSettings={(gameId) => {
            handleSelectGame(gameId);
            setView('settings');
          }}
          onQuickStart={(gameId) => {
            const g = gameRegistry.get(gameId) ?? currentGame;
            if (g.id !== currentGame.id) handleSelectGame(g.id);
            launchMatch(g, undefined, true);
          }}
        />
        {aiStudioOverlay}
      </>
    );
  }

  if (view === 'setup') {
    return (
      <>
        <PreMatchView
          game={currentGame}
          gameMode={gameMode}
          onGameModeChange={handleGameModeChange}
          singleMatchup={singleMatchup}
          onSingleMatchupChange={handleSingleMatchupChange}
          aiModelBySlot={aiModelBySlot}
          onAiModelChange={handleAiModelChange}
          customBotScripts={customBotScripts}
          arenaSeats={arenaSeats}
          onArenaSeatsChange={handleArenaSeatsChange}
          onOpenAiStudio={(tab) => openAiStudio(tab ?? 'prompt')}
          profiles={profiles}
          bindingsBySlot={bindingsBySlot}
          rules={rulesDraft}
          presets={presets}
          activePresetId={activePresetId}
          ruleIssues={ruleIssues}
          storageNotice={storageNotice}
          onBackToLobby={() => setView('lobby')}
          onProfileChange={handleProfileChange}
          onBindingChange={handleBindingChange}
          onResetBindings={handleResetBindings}
          onChangeRules={handleChangeRules}
          onSelectPreset={handleSelectPreset}
          onSaveNewPreset={handleSaveNewPreset}
          onDeletePreset={handleDeletePreset}
          onResetAllRules={handleResetAllRules}
          onResetGroupRules={handleResetGroupRules}
          onStartMatch={() => launchMatch(currentGame, rulesDraft, false)}
        />
        {aiStudioOverlay}
      </>
    );
  }

  if (view === 'settings') {
    return (
      <>
        <SettingsView
          games={games}
          selectedGame={currentGame}
          onSelectGame={handleSelectGame}
          gameMode={gameMode}
          onGameModeChange={handleGameModeChange}
          singleMatchup={singleMatchup}
          onSingleMatchupChange={handleSingleMatchupChange}
          aiModelBySlot={aiModelBySlot}
          onAiModelChange={handleAiModelChange}
          customBotScripts={customBotScripts}
          arenaSeats={arenaSeats}
          onArenaSeatsChange={handleArenaSeatsChange}
          onOpenAiStudio={(tab) => openAiStudio(tab ?? 'prompt')}
          profiles={profiles}
          bindingsBySlot={bindingsBySlot}
          rules={rulesDraft}
          presets={presets}
          activePresetId={activePresetId}
          ruleIssues={ruleIssues}
          storageNotice={storageNotice}
          onBack={() => setView('lobby')}
          onProfileChange={handleProfileChange}
          onBindingChange={handleBindingChange}
          onResetBindings={handleResetBindings}
          onChangeRules={handleChangeRules}
          onSelectPreset={handleSelectPreset}
          onSaveNewPreset={handleSaveNewPreset}
          onDeletePreset={handleDeletePreset}
          onResetAllRules={handleResetAllRules}
          onResetGroupRules={handleResetGroupRules}
          devDebugMode={devDebugMode}
          onToggleDevDebugMode={handleToggleDevDebugMode}
        />
        {aiStudioOverlay}
      </>
    );
  }

  if (view === 'battle' && activeSnapshot) {
    const battleGame = gameRegistry.get(activeSnapshot.gameId) ?? currentGame;
    return (
      <>
        <GameViewport
          game={battleGame}
          snapshot={activeSnapshot}
          settingsOverlayOpen={settingsOverlayOpen}
          debugMode={devDebugMode}
          onToggleDebugMode={handleToggleDevDebugMode}
          onOpenSettingsFromPause={() => setSettingsOverlayOpen(true)}
          onPausedStateChange={setBattlePaused}
          onExitToSetup={() => {
            setActiveSnapshot(null);
            setSettingsOverlayOpen(false);
            setView('setup');
          }}
          onExitToLobby={() => {
            setActiveSnapshot(null);
            setSettingsOverlayOpen(false);
            setView('lobby');
          }}
          onMatchFinished={(result) => {
            const { records, newRecord } = appendMatchHistory(result, matchHistory);
            setMatchHistory(records);
            setActiveHistoryId(newRecord.id);
            setLastResult(result);
            setActiveSnapshot(null);
            setSettingsOverlayOpen(false);
            setView('results');
          }}
        />
        {settingsOverlayOpen && (
          <SettingsView
            games={games}
            selectedGame={currentGame}
            onSelectGame={handleSelectGame}
            gameMode={gameMode}
            onGameModeChange={handleGameModeChange}
            singleMatchup={singleMatchup}
            onSingleMatchupChange={handleSingleMatchupChange}
            aiModelBySlot={aiModelBySlot}
            onAiModelChange={handleAiModelChange}
            customBotScripts={customBotScripts}
            arenaSeats={arenaSeats}
            onArenaSeatsChange={handleArenaSeatsChange}
            onOpenAiStudio={(tab) => openAiStudio(tab ?? 'prompt')}
            profiles={profiles}
            bindingsBySlot={bindingsBySlot}
            rules={rulesDraft}
            presets={presets}
            activePresetId={activePresetId}
            ruleIssues={ruleIssues}
            storageNotice={storageNotice}
            inPausedMatch
            onBack={() => setSettingsOverlayOpen(false)}
            onProfileChange={handleProfileChange}
            onBindingChange={handleBindingChange}
            onResetBindings={handleResetBindings}
            onChangeRules={handleChangeRules}
            onSelectPreset={handleSelectPreset}
            onSaveNewPreset={handleSaveNewPreset}
            onDeletePreset={handleDeletePreset}
            onResetAllRules={handleResetAllRules}
            onResetGroupRules={handleResetGroupRules}
            devDebugMode={devDebugMode}
            onToggleDevDebugMode={handleToggleDevDebugMode}
          />
        )}
        {aiStudioOverlay}
      </>
    );
  }

  if (view === 'results' && lastResult) {
    return (
      <MatchResultsView
        result={lastResult}
        history={matchHistory}
        activeHistoryId={activeHistoryId}
        onSelectHistoryMatch={(record) => {
          setActiveHistoryId(record.id);
          setLastResult(record.result);
        }}
        onPlayAgainNewMap={() => launchMatch(currentGame, rulesDraft, true)}
        onReplaySameMap={() =>
          launchMatch(
            currentGame,
            { ...rulesDraft, mapCode: lastResult.mapCode },
            false
          )
        }
        onBackToSetup={() => setView('setup')}
        onBackToLobby={() => setView('lobby')}
      />
    );
  }

  return null;
}
