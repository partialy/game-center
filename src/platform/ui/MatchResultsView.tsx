import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Check,
  ChevronRight,
  Copy,
  Film,
  History,
  Home,
  PieChart as PieChartIcon,
  Radar as RadarIcon,
  RotateCcw,
  SlidersHorizontal,
  Trophy,
} from 'lucide-react';
import {
  Cell,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import {
  buildMatchAnalytics,
  type PieSliceDatum,
} from '../analytics/matchAnalytics';
import type { MatchResultEvent } from '../games/contracts';
import {
  formatHistoryTimestamp,
  type MatchHistoryRecord,
} from '../history/matchHistoryStore';
import { MatchReplayModal } from './MatchReplayModal';

interface MatchResultsViewProps {
  result: MatchResultEvent;
  history?: MatchHistoryRecord[];
  activeHistoryId?: string | null;
  onSelectHistoryMatch?: (record: MatchHistoryRecord) => void;
  onPlayAgainNewMap: () => void;
  onReplaySameMap: () => void;
  onBackToSetup: () => void;
  onBackToLobby: () => void;
}

type PieMode = 'kills' | 'itemPlayers' | 'itemKinds';

/**
 * 比赛结算页：展示获胜玩家、最终比分、核心对局统计，以及基于 Recharts 的
 * 双人综合战力雷达图与击杀率/道具使用频率饼图。
 */
export function MatchResultsView({
  result,
  history = [],
  activeHistoryId = null,
  onSelectHistoryMatch,
  onPlayAgainNewMap,
  onReplaySameMap,
  onBackToSetup,
  onBackToLobby,
}: MatchResultsViewProps) {
  const [copied, setCopied] = useState(false);
  const [pieMode, setPieMode] = useState<PieMode>('kills');
  const [replayOpen, setReplayOpen] = useState(false);

  // 切换查看另一场历史对局时，重置弹窗与复制状态
  useEffect(() => {
    setReplayOpen(false);
    setCopied(false);
  }, [activeHistoryId, result]);

  const hasReplay = Boolean(result.replay && result.replay.events.length > 0);
  const analytics = useMemo(() => buildMatchAnalytics(result), [result]);
  const isMultiSeat = analytics.players.length >= 3;
  const rankedPlayers = useMemo(
    () =>
      isMultiSeat
        ? [...analytics.players].sort((a, b) => b.score - a.score || b.kills - a.kills)
        : analytics.players,
    [analytics.players, isMultiSeat]
  );
  const radarPlayers = useMemo(() => rankedPlayers.slice(0, 4), [rankedPlayers]);
  const latestHistoryRecord = history[0] ?? null;
  const isViewingPastMatch = Boolean(
    activeHistoryId && latestHistoryRecord && activeHistoryId !== latestHistoryRecord.id
  );

  const winnerPlayers = result.players.filter((p) =>
    result.winnerSlotIds.includes(p.slotId)
  );
  const headline = result.isTie
    ? isMultiSeat
      ? '多方战平'
      : '双方战平'
    : `${winnerPlayers[0]?.displayName ?? '获胜方'} 赢得本场比赛`;

  const formatTime = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const rem = Math.floor(sec % 60);
    return `${mins}:${String(rem).padStart(2, '0')}`;
  };

  const handleCopyCode = () => {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(result.mapCode).catch(() => {});
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const activePieSlices: PieSliceDatum[] =
    pieMode === 'kills'
      ? analytics.killSharePie
      : pieMode === 'itemPlayers'
      ? analytics.itemPlayerPie
      : analytics.itemKindPie;

  const pieCenterValue =
    pieMode === 'kills'
      ? analytics.totalKills > 0
        ? analytics.totalKills
        : result.totalRounds
      : analytics.totalItemsUsed;

  const pieCenterLabel =
    pieMode === 'kills'
      ? analytics.totalKills > 0
        ? '总击杀'
        : '总回合'
      : '道具使用';

  return (
    <main className="min-h-screen drafting-surface flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-4xl bg-[#FAF8F4] border border-[#D4CEC0] rounded-xl shadow-lg overflow-hidden">
        {/* 顶部胜利横幅 */}
        <div className="px-6 sm:px-8 py-6 bg-[#222830] text-[#F5F2EB] flex items-center justify-between gap-6">
          <div>
            <p className="text-xs font-medium text-[#A9B2BC] tracking-wide">
              {isViewingPastMatch ? '坦克大战 · 历史对局回顾' : '坦克大战 · 比赛结算'}
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight mt-1 text-balance">
              {headline}
            </h1>
          </div>
          <div
            className="w-14 h-14 rounded-lg flex items-center justify-center shrink-0 border border-white/15"
            style={{
              backgroundColor: result.isTie
                ? '#39424D'
                : winnerPlayers[0]?.colorHex ?? '#D9432B',
            }}
          >
            <Trophy className="w-7 h-7 text-white" aria-hidden="true" />
          </div>
        </div>

        <div className="p-6 sm:p-8 space-y-6">
          {/* 选手排行与关键战术指标卡（2 人宽卡 / 3～8 席自适应排行矩阵） */}
          <div
            className={`grid gap-3.5 ${
              isMultiSeat
                ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
                : 'grid-cols-1 sm:grid-cols-2'
            }`}
          >
            {rankedPlayers.map((p, idx) => {
              const isWinner = !result.isTie && result.winnerSlotIds.includes(p.slotId);
              const rawPlayer = result.players.find((rp) => rp.slotId === p.slotId);
              const isAi = rawPlayer?.controller === 'ai';
              return (
                <div
                  key={p.slotId}
                  className={`${isMultiSeat ? 'p-3.5' : 'p-5'} rounded-lg border ${
                    isWinner
                      ? 'bg-white border-[#1C2127]'
                      : 'bg-[#F3EFE6] border-[#DDD7C9]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {isMultiSeat && (
                        <span className="font-mono-num text-[11px] font-extrabold text-[#68717D] shrink-0">
                          #{idx + 1}
                        </span>
                      )}
                      <span
                        className="w-3 h-3 rounded-sm shrink-0"
                        style={{ backgroundColor: p.colorHex }}
                      />
                      <span className={`${isMultiSeat ? 'text-sm' : 'text-base'} font-bold text-[#1C2127] truncate`}>
                        {p.displayName}
                      </span>
                      {isAi && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#222830] text-[#F5F2EB] text-[10px] font-bold whitespace-nowrap shrink-0 max-w-[92px] truncate">
                          <Bot className="w-2.5 h-2.5 text-[#7DD3FC] shrink-0" aria-hidden="true" />
                          <span className="truncate">{rawPlayer?.aiModelName ?? 'AI'}</span>
                        </span>
                      )}
                    </div>
                    {isWinner && (
                      <span className="text-xs font-bold text-[#D9432B] whitespace-nowrap shrink-0">
                        胜者
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex items-end justify-between gap-2">
                    <div className="flex items-baseline gap-1">
                      <span className={`${isMultiSeat ? 'text-3xl' : 'text-4xl'} font-extrabold font-mono-num text-[#1C2127] leading-none`}>
                        {p.score}
                      </span>
                      <span className="text-xs text-[#656F7A]">分</span>
                    </div>

                    <div className={`flex items-center ${isMultiSeat ? 'gap-2.5' : 'gap-3.5'} text-right`}>
                      <div>
                        <div className="text-[10px] text-[#68717D]">击杀</div>
                        <div className="text-xs font-bold font-mono-num text-[#1C2127]">
                          {isMultiSeat ? p.kills : `${p.killRatePct}%`}
                        </div>
                      </div>
                      <div className="w-px h-5 bg-[#DDD7C9]" aria-hidden="true" />
                      <div>
                        <div className="text-[10px] text-[#68717D]">命中率</div>
                        <div className="text-xs font-bold font-mono-num text-[#1C2127]">
                          {p.hitRatePct}%
                        </div>
                      </div>
                      {!isMultiSeat && (
                        <>
                          <div className="w-px h-5 bg-[#DDD7C9]" aria-hidden="true" />
                          <div>
                            <div className="text-[10px] text-[#68717D]">道具频率</div>
                            <div className="text-xs font-bold font-mono-num text-[#1C2127]">
                              {p.itemFreqPerMin}{' '}
                              <span className="text-[10px] font-medium text-[#68717D]">次/分</span>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 比赛基础摘要条 */}
          <div className="grid grid-cols-3 gap-4 py-3.5 border-y border-[#E3DDD0] text-center">
            <div>
              <div className="text-xs text-[#646E7A]">总回合数</div>
              <div className="text-xl font-bold font-mono-num text-[#1C2127] mt-0.5">
                {result.totalRounds}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#646E7A]">平局回合</div>
              <div className="text-xl font-bold font-mono-num text-[#1C2127] mt-0.5">
                {result.drawRounds}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#646E7A]">累计交战时长</div>
              <div className="text-xl font-bold font-mono-num text-[#1C2127] mt-0.5">
                {formatTime(result.totalBattleSeconds)}
              </div>
            </div>
          </div>

          {/* Recharts 对局战术数据分析区：综合战力雷达图 + 击杀率/道具使用频率饼图 */}
          <section
            data-testid="match-analytics-section"
            aria-label="对局战术数据可视化"
            className="grid grid-cols-1 md:grid-cols-2 gap-5"
          >
            {/* 左侧：双人综合战力雷达图 */}
            <div
              data-testid="radar-chart-card"
              className="bg-white border border-[#DCD6C8] rounded-xl p-4 sm:p-5 flex flex-col justify-between"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-bold text-[#1C2127]">
                    <RadarIcon className="w-4 h-4 text-[#4B5560]" aria-hidden="true" />
                    <span>综合战力雷达图</span>
                  </div>
                  <p className="text-[11px] text-[#68717D] mt-0.5">
                    五维表现对比（0～100 标准化指数{analytics.players.length > 4 ? ' · 展示前 4 名' : ''}）
                  </p>
                </div>

                {/* 玩家色标图例 */}
                <div className="flex flex-wrap items-center justify-end gap-2.5 pt-0.5">
                  {radarPlayers.map((p) => (
                    <span
                      key={p.slotId}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2C333B]"
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-[3px] shrink-0"
                        style={{ backgroundColor: p.colorHex }}
                        aria-hidden="true"
                      />
                      {p.displayName}
                    </span>
                  ))}
                </div>
              </div>

              <div className="h-[235px] w-full">
                <ResponsiveContainer width="100%" height="100%" minWidth={220} minHeight={210}>
                  <RadarChart
                    cx="50%"
                    cy="52%"
                    outerRadius="72%"
                    data={analytics.radarData}
                  >
                    <PolarGrid stroke="#DDD7C9" />
                    <PolarAngleAxis
                      dataKey="metric"
                      tick={{ fill: '#3A424C', fontSize: 11, fontWeight: 600 }}
                    />
                    <PolarRadiusAxis
                      angle={18}
                      domain={[0, 100]}
                      tickCount={5}
                      tick={{ fill: '#8B949E', fontSize: 9 }}
                      axisLine={false}
                    />
                    {radarPlayers.map((p) => (
                      <Radar
                        key={p.slotId}
                        name={p.displayName}
                        dataKey={p.slotId}
                        stroke={p.colorHex}
                        fill={p.colorHex}
                        fillOpacity={0.22}
                        strokeWidth={2}
                        isAnimationActive={false}
                      />
                    ))}
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1C2127',
                        borderColor: '#363E48',
                        borderRadius: '8px',
                        color: '#F5F2EB',
                        fontSize: '12px',
                        padding: '8px 10px',
                      }}
                      itemStyle={{ fontSize: '12px', padding: '1px 0' }}
                      formatter={(value) => [`${value ?? 0}`, '']}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>

              {/* 底部精简数值对照 */}
              <div className="mt-2 pt-2.5 border-t border-[#ECE7DC] grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] text-[#55606C]">
                {radarPlayers.map((p) => (
                  <div key={p.slotId} className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-[#2C333B] truncate">
                      <span
                        className="w-2 h-2 rounded-[2px] shrink-0"
                        style={{ backgroundColor: p.colorHex }}
                        aria-hidden="true"
                      />
                      {p.displayName}
                    </span>
                    <span className="font-mono-num whitespace-nowrap">
                      击杀 {p.kills} · 命中 {p.hitsLanded}/{p.shotsFired}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* 右侧：击杀率与道具使用频率饼图 */}
            <div
              data-testid="pie-chart-card"
              className="bg-white border border-[#DCD6C8] rounded-xl p-4 sm:p-5 flex flex-col justify-between"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-1.5 text-sm font-bold text-[#1C2127]">
                  <PieChartIcon className="w-4 h-4 text-[#4B5560]" aria-hidden="true" />
                  <span>占比分析饼图</span>
                </div>

                <div
                  className="flex items-center gap-0.5 p-0.5 bg-[#EFECE3] rounded-md"
                  role="tablist"
                  aria-label="切换饼图数据维度"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={pieMode === 'kills'}
                    data-testid="pie-tab-kills"
                    onClick={() => setPieMode('kills')}
                    className={`px-2 py-1 text-[11px] font-semibold rounded transition-colors whitespace-nowrap cursor-pointer ${
                      pieMode === 'kills'
                        ? 'bg-white text-[#1C2127] shadow-xs'
                        : 'text-[#55606C] hover:text-[#1C2127]'
                    }`}
                  >
                    击杀占比
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={pieMode === 'itemPlayers'}
                    data-testid="pie-tab-item-players"
                    onClick={() => setPieMode('itemPlayers')}
                    className={`px-2 py-1 text-[11px] font-semibold rounded transition-colors whitespace-nowrap cursor-pointer ${
                      pieMode === 'itemPlayers'
                        ? 'bg-white text-[#1C2127] shadow-xs'
                        : 'text-[#55606C] hover:text-[#1C2127]'
                    }`}
                  >
                    道具频率
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={pieMode === 'itemKinds'}
                    data-testid="pie-tab-item-kinds"
                    onClick={() => setPieMode('itemKinds')}
                    className={`px-2 py-1 text-[11px] font-semibold rounded transition-colors whitespace-nowrap cursor-pointer ${
                      pieMode === 'itemKinds'
                        ? 'bg-white text-[#1C2127] shadow-xs'
                        : 'text-[#55606C] hover:text-[#1C2127]'
                    }`}
                  >
                    道具分布
                  </button>
                </div>
              </div>

              {activePieSlices.length === 0 ? (
                <div
                  data-testid="pie-empty-state"
                  className="h-[235px] flex flex-col items-center justify-center text-center text-xs text-[#68717D] bg-[#FAF8F4] rounded-lg border border-dashed border-[#DDD7C9] px-4"
                >
                  <p className="font-semibold text-[#3A424C]">本场对局暂未触发道具使用</p>
                  <p className="mt-1 text-[11px]">
                    拾取并使用战术道具后，此处将展示双方道具使用占比与类型分布。
                  </p>
                </div>
              ) : (
                <div className="relative h-[235px] w-full">
                  <ResponsiveContainer width="100%" height="100%" minWidth={220} minHeight={210}>
                    <PieChart>
                      <Pie
                        data={activePieSlices}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={48}
                        outerRadius={82}
                        paddingAngle={3}
                        stroke="#FFFFFF"
                        strokeWidth={2}
                        isAnimationActive={false}
                      >
                        {activePieSlices.map((slice) => (
                          <Cell key={slice.id} fill={slice.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1C2127',
                          borderColor: '#363E48',
                          borderRadius: '8px',
                          color: '#F5F2EB',
                          fontSize: '12px',
                          padding: '8px 10px',
                        }}
                        itemStyle={{ color: '#F5F2EB', fontSize: '12px' }}
                        formatter={(value, name, item) => {
                          const payload = item?.payload as PieSliceDatum | undefined;
                          const suffix = payload ? ` (${payload.sharePct}%)` : '';
                          return [`${value ?? 0}${suffix}`, String(name ?? '')];
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>

                  {/* 环形中心核心数值 */}
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-mono-num text-2xl font-extrabold text-[#1C2127] leading-none">
                      {pieCenterValue}
                    </span>
                    <span className="text-[10px] font-semibold text-[#68717D] mt-1">
                      {pieCenterLabel}
                    </span>
                  </div>
                </div>
              )}

              {/* 饼图清晰明细行 */}
              <div className="mt-2 pt-2.5 border-t border-[#ECE7DC] flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-[11px]">
                {activePieSlices.length === 0 ? (
                  <span className="text-[#808995]">可切换至「击杀占比」查看本场胜负分布</span>
                ) : (
                  activePieSlices.slice(0, 6).map((slice) => (
                    <div
                      key={slice.id}
                      className="inline-flex items-center gap-1.5 text-[#3A424C]"
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-[3px] shrink-0"
                        style={{ backgroundColor: slice.color }}
                        aria-hidden="true"
                      />
                      <span className="font-semibold text-[#1C2127]">{slice.name}</span>
                      <span className="font-mono-num text-[#55606C]">
                        {slice.value} ({slice.sharePct}%)
                      </span>
                      {slice.subtitle && pieMode === 'itemPlayers' && (
                        <span className="font-mono-num text-[#7B8490]">· {slice.subtitle}</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          {/* 地图编号复玩 */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-[#EFECE3] border border-[#DBD5C7] rounded-lg">
            <div>
              <div className="text-xs font-semibold text-[#4B5560]">本场地图编号</div>
              <div className="text-sm font-mono-num font-bold text-[#1C2127] mt-0.5">
                {result.mapCode}
              </div>
            </div>
            <button
              type="button"
              onClick={handleCopyCode}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#1C2127] bg-white hover:bg-[#F5F2EB] border border-[#CFC8BA] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-[#1F8A5B]" aria-hidden="true" />
              ) : (
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              {copied ? '已复制编号' : '复制地图编号'}
            </button>
          </div>

          {/* 历史对局记录模块：展示最近几场胜负概览并一键切换结算回顾 */}
          {history.length > 0 && (
            <section
              data-testid="match-history-section"
              aria-label="历史对局记录"
              className="bg-white border border-[#DCD6C8] rounded-xl p-4 sm:p-5 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-[#4B5560]" aria-hidden="true" />
                  <h2 className="text-sm font-bold text-[#1C2127]">历史记录</h2>
                  <span className="text-[11px] font-mono-num text-[#68717D]">
                    最近 {history.length} 场 · 点击切换回顾
                  </span>
                </div>

                {isViewingPastMatch && latestHistoryRecord && onSelectHistoryMatch && (
                  <button
                    type="button"
                    data-testid="back-to-latest-match-btn"
                    onClick={() => onSelectHistoryMatch(latestHistoryRecord)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-[#D9432B] bg-[#FDF1EE] hover:bg-[#FAE3DD] border border-[#F2C3B8] rounded-md transition-colors cursor-pointer"
                  >
                    回到最新对局
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {history.map((rec, idx) => {
                  const isActive = rec.id === activeHistoryId;
                  const p1 = rec.result.players[0];
                  const p2 = rec.result.players[1];
                  const winner = rec.result.isTie
                    ? null
                    : rec.result.players.find((p) =>
                        rec.result.winnerSlotIds.includes(p.slotId)
                      ) ?? null;
                  const accentColor = winner?.colorHex ?? '#64748B';
                  const outcomeText = rec.result.isTie
                    ? '平局'
                    : `${winner?.displayName ?? '胜方'} 胜`;
                  const recHasReplay = Boolean(
                    rec.result.replay && rec.result.replay.events.length > 0
                  );

                  return (
                    <button
                      key={rec.id}
                      type="button"
                      data-testid={`history-item-${rec.id}`}
                      aria-current={isActive ? 'true' : undefined}
                      onClick={() => onSelectHistoryMatch?.(rec)}
                      className={`group text-left rounded-lg border px-3.5 py-2.5 transition-colors flex items-stretch gap-3 cursor-pointer ${
                        isActive
                          ? 'bg-[#F5F1E7] border-[#1C2127] shadow-xs'
                          : 'bg-[#FAF8F4] border-[#E2DCCE] hover:bg-[#F3EFE6] hover:border-[#C9C1B0]'
                      }`}
                    >
                      <span
                        className="w-1 rounded-full shrink-0"
                        style={{ backgroundColor: accentColor }}
                        aria-hidden="true"
                      />

                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          {rec.result.players.length > 2 ? (
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-xs font-bold text-[#1C2127] whitespace-nowrap">
                                {rec.result.players.length} 席 AI 乱斗
                              </span>
                              <div className="flex items-center gap-1">
                                {rec.result.players.slice(0, 6).map((rp) => (
                                  <span
                                    key={rp.slotId}
                                    className="w-2 h-2 rounded-[2px]"
                                    style={{ backgroundColor: rp.colorHex }}
                                  />
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 min-w-0">
                              {p1 && (
                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#1C2127] truncate">
                                  <span
                                    className="w-2 h-2 rounded-[2px] shrink-0"
                                    style={{ backgroundColor: p1.colorHex }}
                                  />
                                  {p1.displayName}
                                  {p1.controller === 'ai' && (
                                    <span className="text-[10px] font-bold text-[#1F4E78]">
                                      (AI)
                                    </span>
                                  )}
                                </span>
                              )}
                              <span className="text-sm font-extrabold font-mono-num text-[#1C2127] px-1">
                                {p1?.score ?? 0} : {p2?.score ?? 0}
                              </span>
                              {p2 && (
                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#1C2127] truncate">
                                  <span
                                    className="w-2 h-2 rounded-[2px] shrink-0"
                                    style={{ backgroundColor: p2.colorHex }}
                                  />
                                  {p2.displayName}
                                  {p2.controller === 'ai' && (
                                    <span className="text-[10px] font-bold text-[#1F4E78]">
                                      (AI)
                                    </span>
                                  )}
                                </span>
                              )}
                            </div>
                          )}

                          <span
                            className="text-[11px] font-bold shrink-0"
                            style={{ color: accentColor }}
                          >
                            {outcomeText}
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-2 text-[11px] text-[#68717D]">
                          <span className="font-mono-num truncate">
                            {idx === 0 ? '最新 · ' : ''}
                            {rec.result.totalRounds} 回合 · {formatTime(rec.result.totalBattleSeconds)} ·{' '}
                            {formatHistoryTimestamp(rec.completedAt)}
                          </span>

                          <span className="inline-flex items-center gap-1 shrink-0 font-semibold">
                            {recHasReplay && (
                              <Film
                                className="w-3 h-3 text-[#7B8490]"
                                aria-label="含对局录像"
                              />
                            )}
                            {isActive ? (
                              <span className="text-[#1C2127]">当前查看</span>
                            ) : (
                              <span className="text-[#525C68] group-hover:text-[#1C2127] inline-flex items-center">
                                回顾
                                <ChevronRight className="w-3 h-3" aria-hidden="true" />
                              </span>
                            )}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* 操作按钮组 */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onBackToSetup}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-[#2A3139] bg-[#EAE5DA] hover:bg-[#DFD9CB] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
                返回赛前配置
              </button>
              <button
                type="button"
                onClick={onBackToLobby}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-semibold text-[#525C68] hover:text-[#1C2127] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Home className="w-4 h-4" aria-hidden="true" />
                大厅
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {hasReplay && (
                <button
                  type="button"
                  data-testid="open-replay-btn"
                  onClick={() => setReplayOpen(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-[#F5F2EB] bg-[#222830] hover:bg-[#313944] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Film className="w-4 h-4 text-[#F2A65A]" aria-hidden="true" />
                  观看对局录像
                </button>
              )}
              <button
                type="button"
                onClick={onReplaySameMap}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-[#1C2127] bg-white hover:bg-[#F3EFE6] border border-[#C6BFB0] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" aria-hidden="true" />
                复玩同一地形
              </button>
              <button
                type="button"
                data-start="true"
                onClick={onPlayAgainNewMap}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-[#D9432B] hover:bg-[#BE3620] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                再来一场（新地图）
              </button>
            </div>
          </div>
        </div>
      </div>

      {replayOpen && result.replay && (
        <MatchReplayModal
          replay={result.replay}
          mapCode={result.mapCode}
          onClose={() => setReplayOpen(false)}
        />
      )}
    </main>
  );
}
