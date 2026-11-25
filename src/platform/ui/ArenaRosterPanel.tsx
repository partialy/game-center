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
import type {
  ArenaSeatConfig,
  BotModelDefinition,
  CustomBotScriptRecord,
  GameDefinition,
} from '../games/contracts';
import { validateArenaSeatName } from '../ai/customBotStore';
import { PLAYER_COLOR_PALETTE } from '../input/bindings';

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
 * 2～8 席多 AI 竞技场编队面板：
 * - 支持一键切换 2/4/6/8 席规模、增减席位与多模型随机填充
 * - 支持为每席自定义名称、涂装颜色、人类/AI 身份及任意内置/自定义大模型 AI 脚本
 * - 5 席以上自动提供非阻塞推荐大地图尺寸快捷套用
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

  return (
    <section aria-label="多 AI 乱斗阵容编队" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-[#1C2127]">
            多 AI 乱斗阵容（<span className="font-mono-num">{seats.length}</span> 席）
          </h2>
          <p className="text-xs text-[#59626D] mt-0.5">
            支持 2～{maxSeats} 席同台混战 · 可混搭大模型自定义脚本、内置模型及最多 2 名人类玩家
          </p>
        </div>
        <button
          type="button"
          data-testid="roster-open-studio-btn"
          onClick={() => onOpenAiStudio('editor')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-[#F5F2EB] bg-[#222830] hover:bg-[#313A46] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Code2 className="w-3.5 h-3.5 text-[#7DD3FC]" aria-hidden="true" />
          AI 脚本工坊（{customBotScripts.length}）
        </button>
      </div>

      {/* 规模快捷预设 + 增席 + 随机填充 */}
      <div className="bg-[#FAF8F4] border border-[#D8D2C5] rounded-lg p-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-[#4A535E] mr-1">规模</span>
          {SEAT_PRESETS.filter((n) => n <= maxSeats).map((count) => {
            const active = seats.length === count;
            return (
              <button
                key={count}
                type="button"
                data-testid={`brawl-preset-${count}`}
                onClick={() => handleSetCount(count)}
                className={`px-2.5 py-1 text-xs font-mono-num font-bold rounded-md border transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#1C2127] text-white border-[#1C2127]'
                    : 'bg-white text-[#3A424C] border-[#D4CEC0] hover:bg-[#EFECE3]'
                }`}
              >
                {count} 席
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="brawl-randomize-btn"
            onClick={handleRandomizeRoster}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#3A424C] bg-[#EAE5DA] hover:bg-[#DFD9CB] rounded-md transition-colors whitespace-nowrap cursor-pointer"
          >
            <Shuffle className="w-3 h-3" aria-hidden="true" />
            随机多模型
          </button>
          <button
            type="button"
            data-testid="brawl-add-seat"
            disabled={seats.length >= maxSeats}
            onClick={handleAddSeat}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-white bg-[#D9432B] hover:bg-[#BE3620] disabled:opacity-40 disabled:cursor-not-allowed rounded-md transition-colors whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            加席
          </button>
        </div>
      </div>

      {/* 5~8 席推荐大地图提示 */}
      {needsLargerMap && onApplyRecommendedMapSize && (
        <div
          data-testid="brawl-map-recommend-banner"
          className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-lg bg-[#FCF2DF] border border-[#E7C78C] text-xs text-[#7D4508]"
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
          <button
            type="button"
            data-testid="brawl-apply-map-btn"
            onClick={() => onApplyRecommendedMapSize(recommendedCols, recommendedRows)}
            className="px-2.5 py-1 text-[11px] font-bold text-white bg-[#B45309] hover:bg-[#92400E] rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            一键套用 {recommendedCols}×{recommendedRows}
          </button>
        </div>
      )}

      {!validation.valid && (
        <div
          role="alert"
          className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-[#9B2216] bg-[#FDECE9] border border-[#EAB5AC] rounded-md"
        >
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>请确保所有席位涂装颜色互不重复且名称合法（最多支持 2 名人类玩家同屏）。</span>
        </div>
      )}

      {/* 席位卡片列表 */}
      <div className="space-y-2.5">
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
              className="bg-[#FAF8F4] border border-[#D8D2C5] rounded-lg p-3 space-y-2.5"
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
                  <span className="text-xs font-bold text-[#1C2127]">
                    席位 {seat.slotId.toUpperCase()}
                  </span>
                  {seat.controller === 'ai' && seat.aiSource === 'custom' && (
                    <span className="text-[10px] font-bold text-[#1F4E78]">
                      Worker 沙箱脚本
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="flex items-center p-0.5 bg-[#EAE5DA] rounded-md">
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateSeat(seat.slotId, { controller: 'ai' })
                      }
                      className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded transition-colors cursor-pointer ${
                        seat.controller === 'ai'
                          ? 'bg-[#222830] text-[#F5F2EB]'
                          : 'text-[#4F5864] hover:text-[#1C2127]'
                      }`}
                    >
                      <Bot className="w-3 h-3" aria-hidden="true" />
                      AI
                    </button>
                    <button
                      type="button"
                      disabled={!canBeHuman}
                      onClick={() =>
                        handleUpdateSeat(seat.slotId, { controller: 'human' })
                      }
                      title={!canBeHuman ? '本地同屏最多支持 2 名人类玩家' : '切换为人类键位操控'}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded transition-colors ${
                        seat.controller === 'human'
                          ? 'bg-white text-[#1C2127] shadow-xs cursor-pointer'
                          : canBeHuman
                          ? 'text-[#4F5864] hover:text-[#1C2127] cursor-pointer'
                          : 'text-[#9AA2AC] cursor-not-allowed'
                      }`}
                    >
                      <User className="w-3 h-3" aria-hidden="true" />
                      玩家
                    </button>
                  </div>

                  {seats.length > 2 && (
                    <button
                      type="button"
                      aria-label={`移除席位 ${seat.slotId.toUpperCase()}`}
                      onClick={() => handleRemoveSeat(seat.slotId)}
                      className="p-1 text-[#68717D] hover:text-[#B3261E] hover:bg-[#FDECE9] rounded transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>

              {/* 中行：名称输入 + 模型选择 */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                <div className="sm:col-span-5">
                  <input
                    type="text"
                    maxLength={16}
                    data-testid={`brawl-seat-name-${seat.slotId}`}
                    value={seat.name}
                    placeholder={fallbackPlaceholder}
                    aria-label={`${seat.slotId.toUpperCase()} 选手名称`}
                    onChange={(e) =>
                      handleUpdateSeat(seat.slotId, { name: e.target.value })
                    }
                    className={`w-full px-2.5 py-1.5 text-xs bg-white border rounded-md text-[#1C2127] placeholder:text-[#8E96A0] focus:outline-none focus:ring-2 focus:ring-[#1C2127]/20 ${
                      nameError ? 'border-[#C93420]' : 'border-[#CFC8BA]'
                    }`}
                  />
                </div>

                <div className="sm:col-span-7">
                  {seat.controller === 'ai' ? (
                    <select
                      data-testid={`brawl-seat-model-${seat.slotId}`}
                      aria-label={`${seat.slotId.toUpperCase()} 选择 AI 模型`}
                      value={selectValue}
                      onChange={(e) => {
                        const raw = e.target.value;
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
                      className="w-full px-2.5 py-1.5 text-xs font-semibold bg-white border border-[#CFC8BA] rounded-md text-[#1C2127] focus:outline-none focus:ring-2 focus:ring-[#1C2127]/20"
                    >
                      {customBotScripts.length > 0 && (
                        <optgroup label="自定义大模型脚本库">
                          {customBotScripts.map((c) => (
                            <option key={c.id} value={`custom:${c.id}`}>
                              [自定义] {c.name}（{c.tierLabel}
                              {c.validation.status === 'verified' ? ' · 已校验' : ''}）
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="内置 TS 策略脚本">
                        {builtinModels.map((m) => (
                          <option key={m.id} value={`builtin:${m.id}`}>
                            [内置 Lv.{m.difficultyLevel}] {m.name} · {m.difficultyLabel}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  ) : (
                    <div className="h-full flex items-center px-2.5 py-1.5 text-[11px] font-medium text-[#3A424C] bg-[#EFECE3] border border-[#DDD7C9] rounded-md">
                      复用本地键盘配置：{humanOrdinal === 1 ? 'P1 键位（WASD + 空格）' : 'P2 键位（方向键 + Enter）'}
                    </div>
                  )}
                </div>
              </div>

              {/* 底行：8 色涂装选择 */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
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
                        className={`w-6 h-6 rounded flex items-center justify-center transition-transform ${
                          selected
                            ? 'ring-2 ring-offset-1 ring-[#1C2127] scale-105'
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
                  <span className="text-[11px] font-semibold text-[#B3261E]">
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
