import { useEffect, useMemo, useState } from 'react';
import { Button, Tabs } from '@heroui/react';
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
import { useTheme } from '../theme/ThemeContext';
import { MatchReplayModal } from './MatchReplayModal';
import { ThemeQuickToggle } from './heroUiHelpers';

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
 * HeroUI v3 比赛结算页（浅色/深色/强调色自适应）：
 * 展示获胜玩家、最终比分、Recharts 综合战力雷达图与占比饼图、历史战绩切换与对局录像弹窗。
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
  const { resolvedMode } = useTheme();
  const isDark = resolvedMode === 'dark';

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
    <main className="min-h-full drafting-surface flex items-start sm:items-center justify-center p-2.5 sm:p-6 text-[var(--foreground)]">
      <div className="w-full max-w-4xl bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-xl overflow-hidden">
        {/* 顶部胜利横幅 */}
        <div className="px-4 sm:px-8 py-4 sm:py-6 bg-[#181E29] text-[#F5F2EB] flex items-center justify-between gap-4 sm:gap-6 border-b border-white/10">
          <div>
            <p className="text-xs font-medium text-[#A9B2BC] tracking-wide">
              {isViewingPastMatch ? '坦克大战 · 历史对局回顾' : '坦克大战 · 比赛结算'}
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight mt-1 text-balance">
              {headline}
            </h1>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <ThemeQuickToggle testId="results-theme-quick-toggle" />
            <div
              className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0 border border-white/15"
              style={{
                backgroundColor: result.isTie
                  ? '#39424D'
                  : winnerPlayers[0]?.colorHex ?? '#D9432B',
              }}
            >
              <Trophy className="w-7 h-7 text-white" aria-hidden="true" />
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-8 space-y-5 sm:space-y-6">
          {/* 选手排行与关键战术指标卡 */}
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
                  className={`${isMultiSeat ? 'p-3.5' : 'p-5'} rounded-xl border ${
                    isWinner
                      ? 'bg-[var(--surface-secondary)]/85 border-[var(--accent)] ring-1 ring-[var(--accent)]/25'
                      : 'bg-[var(--surface-secondary)]/45 border-[var(--border)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {isMultiSeat && (
                        <span className="font-mono-num text-[11px] font-extrabold text-[var(--muted)] shrink-0">
                          #{idx + 1}
                        </span>
                      )}
                      <span
                        className="w-3 h-3 rounded-sm shrink-0"
                        style={{ backgroundColor: p.colorHex }}
                      />
                      <span
                        className={`${
                          isMultiSeat ? 'text-sm' : 'text-base'
                        } font-bold text-[var(--foreground)] truncate`}
                      >
                        {p.displayName}
                      </span>
                      {isAi && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)] text-[10px] font-bold whitespace-nowrap shrink-0 max-w-[92px] truncate">
                          <Bot className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                          <span className="truncate">{rawPlayer?.aiModelName ?? 'AI'}</span>
                        </span>
                      )}
                    </div>
                    {isWinner && (
                      <span className="text-xs font-bold text-[var(--accent)] whitespace-nowrap shrink-0">
                        胜者
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex items-end justify-between gap-2">
                    <div className="flex items-baseline gap-1">
                      <span
                        className={`${
                          isMultiSeat ? 'text-3xl' : 'text-4xl'
                        } font-extrabold font-mono-num text-[var(--foreground)] leading-none`}
                      >
                        {p.score}
                      </span>
                      <span className="text-xs text-[var(--muted)]">分</span>
                    </div>

                    <div
                      className={`flex items-center ${
                        isMultiSeat ? 'gap-2.5' : 'gap-3.5'
                      } text-right`}
                    >
                      <div>
                        <div className="text-[10px] text-[var(--muted)]">击杀</div>
                        <div className="text-xs font-bold font-mono-num text-[var(--foreground)]">
                          {isMultiSeat ? p.kills : `${p.killRatePct}%`}
                        </div>
                      </div>
                      <div className="w-px h-5 bg-[var(--border)]" aria-hidden="true" />
                      <div>
                        <div className="text-[10px] text-[var(--muted)]">命中率</div>
                        <div className="text-xs font-bold font-mono-num text-[var(--foreground)]">
                          {p.hitRatePct}%
                        </div>
                      </div>
                      {!isMultiSeat && (
                        <>
                          <div className="w-px h-5 bg-[var(--border)]" aria-hidden="true" />
                          <div>
                            <div className="text-[10px] text-[var(--muted)]">道具频率</div>
                            <div className="text-xs font-bold font-mono-num text-[var(--foreground)]">
                              {p.itemFreqPerMin}{' '}
                              <span className="text-[10px] font-medium text-[var(--muted)]">
                                次/分
                              </span>
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
          <div className="grid grid-cols-3 gap-4 py-3.5 border-y border-[var(--separator)] text-center">
            <div>
              <div className="text-xs text-[var(--muted)]">总回合数</div>
              <div className="text-xl font-bold font-mono-num text-[var(--foreground)] mt-0.5">
                {result.totalRounds}
              </div>
            </div>
            <div>
              <div className="text-xs text-[var(--muted)]">平局回合</div>
              <div className="text-xl font-bold font-mono-num text-[var(--foreground)] mt-0.5">
                {result.drawRounds}
              </div>
            </div>
            <div>
              <div className="text-xs text-[var(--muted)]">累计交战时长</div>
              <div className="text-xl font-bold font-mono-num text-[var(--foreground)] mt-0.5">
                {formatTime(result.totalBattleSeconds)}
              </div>
            </div>
          </div>

          {/* Recharts 对局战术数据分析区 */}
          <section
            data-testid="match-analytics-section"
            aria-label="对局战术数据可视化"
            className="grid grid-cols-1 md:grid-cols-2 gap-5"
          >
            {/* 左侧：综合战力雷达图 */}
            <div
              data-testid="radar-chart-card"
              className="bg-[var(--surface-secondary)]/45 border border-[var(--border)] rounded-xl p-4 sm:p-5 flex flex-col justify-between"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-bold text-[var(--foreground)]">
                    <RadarIcon className="w-4 h-4 text-[var(--accent)]" aria-hidden="true" />
                    <span>综合战力雷达图</span>
                  </div>
                  <p className="text-[11px] text-[var(--muted)] mt-0.5">
                    五维表现对比（0～100 标准化指数{analytics.players.length > 4 ? ' · 展示前 4 名' : ''}）
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2.5 pt-0.5">
                  {radarPlayers.map((p) => (
                    <span
                      key={p.slotId}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--foreground)]"
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
                  <RadarChart cx="50%" cy="52%" outerRadius="72%" data={analytics.radarData}>
                    <PolarGrid stroke={isDark ? '#2B3548' : '#DDD7C9'} />
                    <PolarAngleAxis
                      dataKey="metric"
                      tick={{
                        fill: isDark ? '#CBD5E1' : '#3A424C',
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    />
                    <PolarRadiusAxis
                      angle={18}
                      domain={[0, 100]}
                      tickCount={5}
                      tick={{ fill: isDark ? '#64748B' : '#8B949E', fontSize: 9 }}
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

              <div className="mt-2 pt-2.5 border-t border-[var(--separator)] grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] text-[var(--muted)]">
                {radarPlayers.map((p) => (
                  <div key={p.slotId} className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--foreground)] truncate">
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
              className="bg-[var(--surface-secondary)]/45 border border-[var(--border)] rounded-xl p-4 sm:p-5 flex flex-col justify-between"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-1.5 text-sm font-bold text-[var(--foreground)]">
                  <PieChartIcon className="w-4 h-4 text-[var(--accent)]" aria-hidden="true" />
                  <span>占比分析饼图</span>
                </div>

                <Tabs
                  selectedKey={pieMode}
                  onSelectionChange={(key) => setPieMode(String(key) as PieMode)}
                >
                  <Tabs.ListContainer>
                    <Tabs.List
                      aria-label="切换饼图数据维度"
                      className="bg-[var(--surface)] border border-[var(--border)] p-0.5 rounded-lg"
                    >
                      <Tabs.Tab
                        id="kills"
                        data-testid="pie-tab-kills"
                        className="px-2 py-1 text-[11px] font-semibold whitespace-nowrap"
                      >
                        击杀占比
                        <Tabs.Indicator />
                      </Tabs.Tab>
                      <Tabs.Tab
                        id="itemPlayers"
                        data-testid="pie-tab-item-players"
                        className="px-2 py-1 text-[11px] font-semibold whitespace-nowrap"
                      >
                        道具频率
                        <Tabs.Indicator />
                      </Tabs.Tab>
                      <Tabs.Tab
                        id="itemKinds"
                        data-testid="pie-tab-item-kinds"
                        className="px-2 py-1 text-[11px] font-semibold whitespace-nowrap"
                      >
                        道具分布
                        <Tabs.Indicator />
                      </Tabs.Tab>
                    </Tabs.List>
                  </Tabs.ListContainer>
                </Tabs>
              </div>

              {activePieSlices.length === 0 ? (
                <div
                  data-testid="pie-empty-state"
                  className="h-[235px] flex flex-col items-center justify-center text-center text-xs text-[var(--muted)] bg-[var(--surface)] rounded-lg border border-dashed border-[var(--border)] px-4"
                >
                  <p className="font-semibold text-[var(--foreground)]">本场对局暂未触发道具使用</p>
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
                        stroke={isDark ? '#141B29' : '#FFFFFF'}
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

                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-mono-num text-2xl font-extrabold text-[var(--foreground)] leading-none">
                      {pieCenterValue}
                    </span>
                    <span className="text-[10px] font-semibold text-[var(--muted)] mt-1">
                      {pieCenterLabel}
                    </span>
                  </div>
                </div>
              )}

              <div className="mt-2 pt-2.5 border-t border-[var(--separator)] flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-[11px]">
                {activePieSlices.length === 0 ? (
                  <span className="text-[var(--muted)]">可切换至「击杀占比」查看本场胜负分布</span>
                ) : (
                  activePieSlices.slice(0, 6).map((slice) => (
                    <div
                      key={slice.id}
                      className="inline-flex items-center gap-1.5 text-[var(--muted)]"
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-[3px] shrink-0"
                        style={{ backgroundColor: slice.color }}
                        aria-hidden="true"
                      />
                      <span className="font-semibold text-[var(--foreground)]">{slice.name}</span>
                      <span className="font-mono-num">
                        {slice.value} ({slice.sharePct}%)
                      </span>
                      {slice.subtitle && pieMode === 'itemPlayers' && (
                        <span className="font-mono-num opacity-80">· {slice.subtitle}</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          {/* 地图编号复玩 */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-[var(--surface-secondary)]/65 border border-[var(--border)] rounded-xl">
            <div>
              <div className="text-xs font-semibold text-[var(--muted)]">本场地图编号</div>
              <div className="text-sm font-mono-num font-bold text-[var(--foreground)] mt-0.5">
                {result.mapCode}
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onPress={handleCopyCode}
              className="min-h-[38px] whitespace-nowrap shrink-0"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-500" aria-hidden="true" />
              ) : (
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              {copied ? '已复制编号' : '复制地图编号'}
            </Button>
          </div>

          {/* 历史对局记录模块 */}
          {history.length > 0 && (
            <section
              data-testid="match-history-section"
              aria-label="历史对局记录"
              className="bg-[var(--surface-secondary)]/45 border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-[var(--accent)]" aria-hidden="true" />
                  <h2 className="text-sm font-bold text-[var(--foreground)]">历史记录</h2>
                  <span className="text-[11px] font-mono-num text-[var(--muted)]">
                    最近 {history.length} 场 · 点击切换回顾
                  </span>
                </div>

                {isViewingPastMatch && latestHistoryRecord && onSelectHistoryMatch && (
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="back-to-latest-match-btn"
                    onPress={() => onSelectHistoryMatch(latestHistoryRecord)}
                    className="h-7 px-2.5 text-[11px] font-semibold"
                  >
                    回到最新对局
                  </Button>
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
                      className={`group text-left rounded-xl border px-3.5 py-2.5 transition-colors flex items-stretch gap-3 cursor-pointer ${
                        isActive
                          ? 'bg-[var(--surface)] border-[var(--accent)] shadow-xs'
                          : 'bg-[var(--surface)]/75 border-[var(--border)] hover:border-[var(--accent)]/50'
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
                              <span className="text-xs font-bold text-[var(--foreground)] whitespace-nowrap">
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
                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--foreground)] truncate">
                                  <span
                                    className="w-2 h-2 rounded-[2px] shrink-0"
                                    style={{ backgroundColor: p1.colorHex }}
                                  />
                                  {p1.displayName}
                                  {p1.controller === 'ai' && (
                                    <span className="text-[10px] font-bold text-[var(--accent)]">
                                      (AI)
                                    </span>
                                  )}
                                </span>
                              )}
                              <span className="text-sm font-extrabold font-mono-num text-[var(--foreground)] px-1">
                                {p1?.score ?? 0} : {p2?.score ?? 0}
                              </span>
                              {p2 && (
                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--foreground)] truncate">
                                  <span
                                    className="w-2 h-2 rounded-[2px] shrink-0"
                                    style={{ backgroundColor: p2.colorHex }}
                                  />
                                  {p2.displayName}
                                  {p2.controller === 'ai' && (
                                    <span className="text-[10px] font-bold text-[var(--accent)]">
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

                        <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--muted)]">
                          <span className="font-mono-num truncate">
                            {idx === 0 ? '最新 · ' : ''}
                            {rec.result.totalRounds} 回合 · {formatTime(rec.result.totalBattleSeconds)} ·{' '}
                            {formatHistoryTimestamp(rec.completedAt)}
                          </span>

                          <span className="inline-flex items-center gap-1 shrink-0 font-semibold">
                            {recHasReplay && (
                              <Film
                                className="w-3 h-3 text-[var(--muted)]"
                                aria-label="含对局录像"
                              />
                            )}
                            {isActive ? (
                              <span className="text-[var(--foreground)]">当前查看</span>
                            ) : (
                              <span className="group-hover:text-[var(--foreground)] inline-flex items-center">
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

          {/* HeroUI 操作按钮组 */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="md"
                onPress={onBackToSetup}
                className="min-h-[42px] font-semibold whitespace-nowrap shrink-0"
              >
                <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
                返回赛前配置
              </Button>
              <Button
                variant="ghost"
                size="md"
                onPress={onBackToLobby}
                className="min-h-[42px] font-semibold whitespace-nowrap shrink-0"
              >
                <Home className="w-4 h-4" aria-hidden="true" />
                大厅
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {hasReplay && (
                <Button
                  variant="secondary"
                  size="md"
                  data-testid="open-replay-btn"
                  onPress={() => setReplayOpen(true)}
                  className="min-h-[42px] font-semibold whitespace-nowrap shrink-0"
                >
                  <Film className="w-4 h-4 text-amber-500" aria-hidden="true" />
                  观看对局录像
                </Button>
              )}
              <Button
                variant="secondary"
                size="md"
                onPress={onReplaySameMap}
                className="min-h-[42px] font-semibold whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-4 h-4" aria-hidden="true" />
                复玩同一地形
              </Button>
              <Button
                variant="primary"
                size="md"
                data-start="true"
                onPress={onPlayAgainNewMap}
                className="min-h-[42px] px-5 font-bold whitespace-nowrap shrink-0 accent-solid-btn"
              >
                再来一场（新地图）
              </Button>
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
