import { Button, Input } from '@heroui/react';
import {
  AlertCircle,
  Bot,
  Code2,
  Lock,
  Plus,
  Shuffle,
  Sparkles,
  Trash2,
  User,
} from 'lucide-react';
import {
  BOSS_TIER_THEME,
  type ArenaSeatConfig,
  type BotModelDefinition,
  type CustomBotScriptRecord,
  type GameDefinition,
} from '../games/contracts';
import { validateArenaSeatName } from '../ai/customBotStore';
import { PLAYER_COLOR_PALETTE } from '../input/bindings';
import { AppSelect, type SelectOptionGroup } from './heroUiHelpers';

interface ArenaRosterPanelProps<TRules extends Record<string, unknown>> {
  game: GameDefinition<TRules, unknown>;
  seats: ArenaSeatConfig[];
  customBotScripts: CustomBotScriptRecord[];
  rules: Record<string, unknown>;
  onSeatsChange: (next: ArenaSeatConfig[]) => void;
  onApplyRecommendedMapSize?: (cols: number, rows: number) => void;
  onOpenAiStudio: (tab?: 'prompt' | 'editor') => void;
}

const SEAT_PRESETS = [2, 4, 6, 8] as const;

export function findNextUnusedColorHex(seats: ArenaSeatConfig[]): string {
  const used = new Set(seats.map((s) => s.colorHex.toLowerCase()));
  const found = PLAYER_COLOR_PALETTE.find((opt) => !used.has(opt.hex.toLowerCase()));
  return found?.hex ?? PLAYER_COLOR_PALETTE[seats.length % PLAYER_COLOR_PALETTE.length].hex;
}

export function validateArenaSeats(seats: ArenaSeatConfig[]): {
  valid: boolean;
  nameErrors: Record<string, string>;
  colorErrors: Record<string, string>;
  humanCount: number;
} {
  const nameErrors: Record<string, string> = {};
  const colorErrors: Record<string, string> = {};
  const colorMap = new Map<string, string[]>();
  let humanCount = 0;

  for (const seat of seats) {
    if (seat.controller === 'human') humanCount += 1;
    const nameErr = validateArenaSeatName(seat.name);
    if (nameErr) nameErrors[seat.slotId] = nameErr;

    const hex = seat.colorHex.toLowerCase();
    const list = colorMap.get(hex) ?? [];
    list.push(seat.slotId);
    colorMap.set(hex, list);
  }

  for (const slotIds of colorMap.values()) {
    if (slotIds.length > 1) {
      for (const id of slotIds) {
        colorErrors[id] = '涂装颜色重复';
      }
    }
  }

  return {
    valid:
      seats.length >= 2 &&
      seats.length <= 8 &&
      humanCount <= 2 &&
      Object.keys(nameErrors).length === 0 &&
      Object.keys(colorErrors).length === 0,
    nameErrors,
    colorErrors,
    humanCount,
  };
}

/**
 * HeroUI v3 2～8 席多 AI 竞技场编队面板。
 */
export function ArenaRosterPanel<TRules extends Record<string, unknown>>({
  game,
  seats,
  customBotScripts,
  rules,
  onSeatsChange,
  onApplyRecommendedMapSize,
  onOpenAiStudio,
}: ArenaRosterPanelProps<TRules>) {
  const builtinModels: BotModelDefinition<unknown>[] = (game.botModels ??
    []) as BotModelDefinition<unknown>[];
  const validation = validateArenaSeats(seats);
  const maxSeats = Math.min(8, Math.max(2, game.maxPlayers));

  const gridCols = typeof rules.gridCols === 'number' ? rules.gridCols : 10;
  const gridRows = typeof rules.gridRows === 'number' ? rules.gridRows : 7;
  const recommendedCols = seats.length >= 7 ? 14 : seats.length >= 5 ? 12 : 10;
  const recommendedRows = seats.length >= 7 ? 9 : seats.length >= 5 ? 8 : 7;
  const needsLargerMap =
    seats.length >= 5 && (gridCols < recommendedCols || gridRows < recommendedRows);

  const reindexSeats = (list: ArenaSeatConfig[]): ArenaSeatConfig[] =>
    list.map((seat, idx) => ({
      ...seat,
      slotId: `p${idx + 1}`,
    }));

  const handleSetCount = (targetCount: number) => {
    const clamped = Math.max(2, Math.min(maxSeats, targetCount));
    if (clamped === seats.length) return;
    if (clamped < seats.length) {
      onSeatsChange(reindexSeats(seats.slice(0, clamped)));
      return;
    }
    const next = [...seats];
    while (next.length < clamped) {
      const idx = next.length;
      const customCandidate =
        customBotScripts.length > 0 && idx % 2 === 1
          ? customBotScripts[Math.floor(idx / 2) % customBotScripts.length]
          : null;
      const builtinCandidate =
        builtinModels[idx % Math.max(1, builtinModels.length)] ?? builtinModels[0];
      next.push({
        slotId: `p${idx + 1}`,
        name: customCandidate ? customCandidate.name : '',
        colorHex: findNextUnusedColorHex(next),
        controller: 'ai',
        aiSource: customCandidate ? 'custom' : 'builtin',
        aiModelId: customCandidate ? customCandidate.id : builtinCandidate?.id ?? 'tactical',
      });
    }
    onSeatsChange(reindexSeats(next));
  };

  const handleAddSeat = () => {
    if (seats.length >= maxSeats) return;
    handleSetCount(seats.length + 1);
  };

  const handleRemoveSeat = (slotId: string) => {
    if (seats.length <= 2) return;
    onSeatsChange(reindexSeats(seats.filter((s) => s.slotId !== slotId)));
  };

  const handleUpdateSeat = (slotId: string, patch: Partial<ArenaSeatConfig>) => {
    onSeatsChange(
      seats.map((seat) => (seat.slotId === slotId ? { ...seat, ...patch } : seat))
    );
  };

  const handleRandomizeRoster = () => {
    const pool: Array<{ source: 'builtin' | 'custom'; id: string; defaultName: string }> = [
      ...customBotScripts.map((c) => ({
        source: 'custom' as const,
        id: c.id,
        defaultName: c.name,
      })),
      ...builtinModels.map((b) => ({
        source: 'builtin' as const,
        id: b.id,
        defaultName: b.name,
      })),
    ];
    if (pool.length === 0) return;

    const next = seats.map((seat, idx) => {
      const pick = pool[(idx + Math.floor(Math.random() * pool.length)) % pool.length];
      return {
        ...seat,
        colorHex: PLAYER_COLOR_PALETTE[idx % PLAYER_COLOR_PALETTE.length].hex,
        controller: 'ai' as const,
        aiSource: pick.source,
        aiModelId: pick.id,
        name: pick.source === 'custom' ? pick.defaultName : '',
      };
    });
    onSeatsChange(next);
  };

  const modelSelectGroups: SelectOptionGroup[] = [];
  if (customBotScripts.length > 0) {
    modelSelectGroups.push({
      title: '自定义大模型脚本库',
      options: customBotScripts.map((c) => ({
        value: `custom:${c.id}`,
        label: `[自定义] ${c.name}（${c.tierLabel}${c.validation.status === 'verified' ? ' · 已校验' : ''}）`,
      })),
    });
  }
  modelSelectGroups.push({
    title: '内置 TS 策略脚本',
    options: builtinModels.map((m) => ({
      value: `builtin:${m.id}`,
      label: `[内置 Lv.${m.difficultyLevel}] ${m.name} · ${m.difficultyLabel}`,
    })),
  });

  return (
    <section aria-label="多 AI 乱斗阵容编队" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base sm:text-lg font-bold tracking-tight text-[var(--foreground)]">
            多 AI 乱斗阵容（<span className="font-mono-num">{seats.length}</span> 席）
          </h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            支持 2～{maxSeats} 席同台混战 · 可混搭大模型自定义脚本、内置模型及最多 2 名人类玩家
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          data-testid="roster-open-studio-btn"
          onPress={() => onOpenAiStudio('editor')}
          className="min-h-[38px] max-sm:min-h-[44px] whitespace-nowrap shrink-0 font-semibold"
        >
          <Code2 className="w-3.5 h-3.5 text-[var(--accent)]" aria-hidden="true" />
          AI 脚本工坊（{customBotScripts.length}）
        </Button>
      </div>

      {/* 规模快捷预设 + 增席 + 随机填充 */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-[var(--muted)] mr-1">规模</span>
          {SEAT_PRESETS.filter((n) => n <= maxSeats).map((count) => {
            const active = seats.length === count;
            return (
              <Button
                key={count}
                size="sm"
                variant={active ? 'primary' : 'secondary'}
                data-testid={`brawl-preset-${count}`}
                onPress={() => handleSetCount(count)}
                className={`min-h-[36px] max-sm:min-h-[42px] px-2.5 font-mono-num font-bold ${
                  active ? 'accent-solid-btn' : ''
                }`}
              >
                {count} 席
              </Button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            data-testid="brawl-randomize-btn"
            onPress={handleRandomizeRoster}
            className="min-h-[36px] max-sm:min-h-[42px] whitespace-nowrap"
          >
            <Shuffle className="w-3.5 h-3.5" aria-hidden="true" />
            随机多模型
          </Button>
          <Button
            variant="primary"
            size="sm"
            data-testid="brawl-add-seat"
            isDisabled={seats.length >= maxSeats}
            onPress={handleAddSeat}
            className="min-h-[36px] max-sm:min-h-[42px] whitespace-nowrap accent-solid-btn"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            加席
          </Button>
        </div>
      </div>

      {/* 5~8 席推荐大地图提示 */}
      {needsLargerMap && onApplyRecommendedMapSize && (
        <div
          data-testid="brawl-map-recommend-banner"
          className="flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl bg-amber-500/12 border border-amber-500/35 text-xs text-amber-800 dark:text-amber-300"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              当前为 <strong className="font-mono-num">{seats.length}</strong> 席混战，建议地图尺寸至少{' '}
              <strong className="font-mono-num">
                {recommendedCols}×{recommendedRows}
              </strong>{' '}
              以保证走位与出生空间。
            </span>
          </div>
          <Button
            size="sm"
            variant="primary"
            data-testid="brawl-apply-map-btn"
            onPress={() => onApplyRecommendedMapSize(recommendedCols, recommendedRows)}
            className="min-h-[34px] whitespace-nowrap shrink-0 accent-solid-btn"
          >
            一键套用 {recommendedCols}×{recommendedRows}
          </Button>
        </div>
      )}

      {!validation.valid && (
        <div
          role="alert"
          className="flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium rounded-xl bg-red-500/10 border border-red-500/35 text-red-700 dark:text-red-300"
        >
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>请确保所有席位涂装颜色互不重复且名称合法（最多支持 2 名人类玩家同屏）。</span>
        </div>
      )}

      {/* 席位卡片列表 */}
      <div className="space-y-3">
        {seats.map((seat, idx) => {
          const takenByOthers = new Set(
            seats
              .filter((other) => other.slotId !== seat.slotId)
              .map((other) => other.colorHex.toLowerCase())
          );
          const colorError = validation.colorErrors[seat.slotId];
          const nameError = validation.nameErrors[seat.slotId];
          const canBeHuman = seat.controller === 'human' || validation.humanCount < 2;
          const humanOrdinal =
            seat.controller === 'human'
              ? seats.slice(0, idx + 1).filter((s) => s.controller === 'human').length
              : 0;

          const selectValue =
            seat.aiSource === 'custom'
              ? `custom:${seat.aiModelId}`
              : `builtin:${seat.aiModelId}`;

          const matchedCustom =
            seat.aiSource === 'custom'
              ? customBotScripts.find((c) => c.id === seat.aiModelId) ?? null
              : null;
          const matchedBuiltin =
            seat.aiSource === 'builtin'
              ? builtinModels.find((m) => m.id === seat.aiModelId) ?? builtinModels[0] ?? null
              : null;

          const fallbackPlaceholder =
            seat.controller === 'human'
              ? seat.slotId.toUpperCase()
              : matchedCustom?.name ?? matchedBuiltin?.name ?? seat.slotId.toUpperCase();

          return (
            <div
              key={seat.slotId}
              data-testid={`brawl-seat-card-${seat.slotId}`}
              className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3.5 space-y-3"
            >
              {/* 顶行：席位序号 + 身份切换 + 删除 */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-6 h-6 rounded-md text-white font-mono-num text-[11px] font-extrabold flex items-center justify-center shrink-0"
                    style={{ backgroundColor: seat.colorHex }}
                  >
                    {idx + 1}
                  </span>
                  <span className="text-xs font-bold text-[var(--foreground)]">
                    席位 {seat.slotId.toUpperCase()}
                  </span>
                  {seat.controller === 'ai' && seat.aiSource === 'custom' && (
                    <span className="text-[10px] font-bold text-[var(--accent)]">
                      Worker 沙箱脚本
                    </span>
                  )}
                  {seat.controller === 'ai' &&
                    seat.aiSource === 'builtin' &&
                    builtinModels.some(
                      (m) => m.id === seat.aiModelId && (m.isBoss || m.difficultyLevel === 5)
                    ) && (
                      <span
                        data-testid={`brawl-boss-badge-${seat.slotId}`}
                        className="px-1.5 py-0.5 rounded text-[10px] font-bold border"
                        style={{
                          backgroundColor: BOSS_TIER_THEME.bgHex,
                          borderColor: BOSS_TIER_THEME.borderHex,
                          color: BOSS_TIER_THEME.textHex,
                        }}
                      >
                        Lv.5 · 地狱使者
                      </span>
                    )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="flex items-center gap-1 p-0.5 bg-[var(--surface-secondary)] border border-[var(--border)] rounded-lg">
                    <Button
                      size="sm"
                      variant={seat.controller === 'ai' ? 'primary' : 'ghost'}
                      onPress={() => handleUpdateSeat(seat.slotId, { controller: 'ai' })}
                      className={`h-7 px-2 text-[11px] font-semibold ${
                        seat.controller === 'ai' ? 'accent-solid-btn' : ''
                      }`}
                    >
                      <Bot className="w-3 h-3" aria-hidden="true" />
                      AI
                    </Button>
                    <Button
                      size="sm"
                      variant={seat.controller === 'human' ? 'primary' : 'ghost'}
                      isDisabled={!canBeHuman}
                      onPress={() => handleUpdateSeat(seat.slotId, { controller: 'human' })}
                      className={`h-7 px-2 text-[11px] font-semibold ${
                        seat.controller === 'human' ? 'accent-solid-btn' : ''
                      }`}
                    >
                      <User className="w-3 h-3" aria-hidden="true" />
                      玩家
                    </Button>
                  </div>

                  {seats.length > 2 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      isIconOnly
                      aria-label={`移除席位 ${seat.slotId.toUpperCase()}`}
                      onPress={() => handleRemoveSeat(seat.slotId)}
                      className="min-w-[32px] h-8 text-[var(--muted)] hover:text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </div>

              {/* 中行：名称输入 + HeroUI Select 模型选择 */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                <div className="sm:col-span-5">
                  <Input
                    type="text"
                    maxLength={16}
                    data-testid={`brawl-seat-name-${seat.slotId}`}
                    value={seat.name}
                    placeholder={fallbackPlaceholder}
                    aria-label={`${seat.slotId.toUpperCase()} 选手名称`}
                    onChange={(e) =>
                      handleUpdateSeat(seat.slotId, { name: e.target.value })
                    }
                    className={`w-full min-h-[40px] max-sm:min-h-[44px] px-3 text-xs bg-[var(--field-background)] text-[var(--field-foreground)] border rounded-lg ${
                      nameError ? 'border-red-500' : 'border-[var(--field-border)]'
                    }`}
                  />
                </div>

                <div className="sm:col-span-7">
                  {seat.controller === 'ai' ? (
                    <AppSelect
                      ariaLabel={`${seat.slotId.toUpperCase()} 选择 AI 模型`}
                      testId={`brawl-seat-model-${seat.slotId}`}
                      value={selectValue}
                      groups={modelSelectGroups}
                      onChange={(raw) => {
                        if (raw.startsWith('custom:')) {
                          const cid = raw.slice('custom:'.length);
                          const target = customBotScripts.find((c) => c.id === cid);
                          handleUpdateSeat(seat.slotId, {
                            aiSource: 'custom',
                            aiModelId: cid,
                            name: seat.name.trim() ? seat.name : target?.name ?? '',
                          });
                        } else if (raw.startsWith('builtin:')) {
                          const bid = raw.slice('builtin:'.length);
                          handleUpdateSeat(seat.slotId, {
                            aiSource: 'builtin',
                            aiModelId: bid,
                          });
                        }
                      }}
                    />
                  ) : (
                    <div className="min-h-[40px] flex items-center px-3 py-1.5 text-[11px] font-medium text-[var(--muted)] bg-[var(--surface-secondary)] border border-[var(--border)] rounded-lg">
                      复用本地键盘配置：{humanOrdinal === 1 ? 'P1 键位（WASD + 空格）' : 'P2 键位（方向键 + Enter）'}
                    </div>
                  )}
                </div>
              </div>

              {/* 底行：8 色涂装选择 */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {PLAYER_COLOR_PALETTE.map((opt) => {
                    const selected =
                      seat.colorHex.toLowerCase() === opt.hex.toLowerCase();
                    const taken = takenByOthers.has(opt.hex.toLowerCase());
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={taken}
                        aria-label={`${seat.slotId.toUpperCase()} 颜色 ${opt.label}`}
                        onClick={() =>
                          handleUpdateSeat(seat.slotId, { colorHex: opt.hex })
                        }
                        className={`w-6 h-6 rounded-md flex items-center justify-center transition-transform ${
                          selected
                            ? 'ring-2 ring-offset-1 ring-[var(--foreground)] ring-offset-[var(--surface)] scale-105'
                            : taken
                            ? 'opacity-30 cursor-not-allowed'
                            : 'hover:scale-105 cursor-pointer'
                        }`}
                        style={{ backgroundColor: opt.hex }}
                      >
                        {taken && (
                          <Lock className="w-3 h-3 text-white drop-shadow" aria-hidden="true" />
                        )}
                        {selected && !taken && (
                          <span className="w-2 h-2 rounded-xs bg-white/95" />
                        )}
                      </button>
                    );
                  })}
                </div>
                {colorError && (
                  <span className="text-[11px] font-semibold text-red-600 dark:text-red-400">
                    {colorError}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
