import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Film,
  Pause,
  Play,
  RotateCcw,
  Route,
  Shield,
  SkipBack,
  SkipForward,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  MatchReplayData,
  ReplaySnapshotEvent,
} from '../games/contracts';
import {
  REPLAY_HIGHLIGHT_LABELS,
  extractTankTrails,
  findAdjacentHighlightIndex,
  formatReplayTimestamp,
  getHighlightEvents,
  interpolateReplayFrame,
  stepReplayIndex,
  type TankTrailSeries,
} from '../replay/replayEngine';
import { ITEM_ACCENT_COLORS } from '../../games/tank-battle/ui/itemIcons';
import {
  CELL_SIZE,
  DROP_PICKUP_RADIUS,
  ITEM_LABELS,
  MINE_VISUAL_RADIUS,
  TANK_BARREL_LENGTH,
  TANK_RADIUS,
  WALL_THICKNESS,
  type ItemKind,
} from '../../games/tank-battle/types';

interface MatchReplayModalProps {
  replay: MatchReplayData;
  mapCode: string;
  onClose: () => void;
}

const SPEED_OPTIONS = [0.5, 1, 2] as const;

/**
 * 高精度步进式对局录像回顾弹窗：
 * - 基于 10 Hz + 拐点加密 Snapshot Events 序列渲染真实迷宫、坦克、弹道、激光、护盾、后坐力与即时特效
 * - 播放时由 RAF 直接驱动 Canvas 60 FPS 平滑插值绘制，避免 React 频繁重渲染，兼顾丝滑与低开销
 * - 支持战术走位轨迹开关、时间轴精彩节点标尺、0.5x/1x/2x 倍速、逐帧步进与精彩事件一键跳转
 */
export function MatchReplayModal({
  replay,
  mapCode,
  onClose,
}: MatchReplayModalProps) {
  const events = replay.events;
  const totalCount = events.length;
  const highlights = useMemo(() => getHighlightEvents(events), [events]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [scrubberPos, setScrubberPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEED_OPTIONS)[number]>(1);
  const [showTrails, setShowTrails] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageBoxRef = useRef<HTMLDivElement | null>(null);

  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;
  const subAlphaRef = useRef(0);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const showTrailsRef = useRef(showTrails);
  showTrailsRef.current = showTrails;
  const playingRef = useRef(playing);
  playingRef.current = playing;

  const paintFrameToCanvas = useCallback(
    (idx: number, alpha: number) => {
      const canvas = canvasRef.current;
      const box = stageBoxRef.current;
      if (!canvas || !box || events.length === 0) return;

      const cur = events[idx] ?? events[0];
      const nxt = events[idx + 1];
      if (!cur) return;

      const frame = alpha > 0 ? interpolateReplayFrame(cur, nxt, alpha) : cur;
      const trails = showTrailsRef.current
        ? extractTankTrails(events, idx, frame, 20)
        : [];

      const rect = box.getBoundingClientRect();
      const cssW = Math.max(320, Math.floor(rect.width));
      const cssH = Math.max(220, Math.floor(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const targetW = Math.floor(cssW * dpr);
      const targetH = Math.floor(cssH * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      renderReplaySnapshot(ctx, replay, frame, trails, cssW, cssH, dpr);
    },
    [events, replay]
  );

  const jumpToIndex = useCallback(
    (nextIdx: number) => {
      const clamped = stepReplayIndex(nextIdx, 0, totalCount);
      setPlaying(false);
      playingRef.current = false;
      currentIndexRef.current = clamped;
      subAlphaRef.current = 0;
      setCurrentIndex(clamped);
      setScrubberPos(clamped);
      paintFrameToCanvas(clamped, 0);
    },
    [paintFrameToCanvas, totalCount]
  );

  const handleStep = useCallback(
    (delta: number) => {
      setPlaying(false);
      playingRef.current = false;
      const next = stepReplayIndex(currentIndexRef.current, delta, totalCount);
      currentIndexRef.current = next;
      subAlphaRef.current = 0;
      setCurrentIndex(next);
      setScrubberPos(next);
      paintFrameToCanvas(next, 0);
    },
    [paintFrameToCanvas, totalCount]
  );

  const handleJumpHighlight = useCallback(
    (direction: -1 | 1) => {
      setPlaying(false);
      playingRef.current = false;
      const next = findAdjacentHighlightIndex(events, currentIndexRef.current, direction);
      currentIndexRef.current = next;
      subAlphaRef.current = 0;
      setCurrentIndex(next);
      setScrubberPos(next);
      paintFrameToCanvas(next, 0);
    },
    [events, paintFrameToCanvas]
  );

  const handleTogglePlay = useCallback(() => {
    if (totalCount <= 1) return;
    setPlaying((prev) => {
      const nextPlaying = !prev;
      if (nextPlaying && currentIndexRef.current >= totalCount - 1) {
        currentIndexRef.current = 0;
        subAlphaRef.current = 0;
        setCurrentIndex(0);
        setScrubberPos(0);
      }
      playingRef.current = nextPlaying;
      return nextPlaying;
    });
  }, [totalCount]);

  const handleRestart = useCallback(() => {
    currentIndexRef.current = 0;
    subAlphaRef.current = 0;
    setCurrentIndex(0);
    setScrubberPos(0);
    const shouldPlay = totalCount > 1;
    playingRef.current = shouldPlay;
    setPlaying(shouldPlay);
    paintFrameToCanvas(0, 0);
  }, [paintFrameToCanvas, totalCount]);

  // 键盘快捷操控：Space 播放/暂停，←/→ 步进，Esc 关闭
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        handleTogglePlay();
        return;
      }
      if (event.code === 'ArrowLeft') {
        event.preventDefault();
        handleStep(-1);
        return;
      }
      if (event.code === 'ArrowRight') {
        event.preventDefault();
        handleStep(1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleStep, handleTogglePlay, onClose]);

  // 静止或配置变化时立即重绘（含容器尺寸自适应）
  useEffect(() => {
    const box = stageBoxRef.current;
    if (!box) return;
    paintFrameToCanvas(currentIndexRef.current, playingRef.current ? subAlphaRef.current : 0);
    const ro = new ResizeObserver(() => {
      paintFrameToCanvas(currentIndexRef.current, playingRef.current ? subAlphaRef.current : 0);
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [currentIndex, paintFrameToCanvas, showTrails]);

  // 高帧率 RAF 播放引擎：直接绘制 Canvas 避免高频 setState，按真实时间差推进流畅插值
  useEffect(() => {
    if (!playing || totalCount <= 1) return;
    let rafId = 0;
    let lastTs = performance.now();
    let lastUiSyncTs = lastTs;

    const tick = (now: number) => {
      const dt = Math.min(0.08, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;

      let idx = currentIndexRef.current;
      let alpha = subAlphaRef.current;

      if (idx >= totalCount - 1) {
        playingRef.current = false;
        setPlaying(false);
        setScrubberPos(totalCount - 1);
        paintFrameToCanvas(totalCount - 1, 0);
        return;
      }

      let remainingBudget = dt * speedRef.current;
      let indexChanged = false;

      // 在一次 RAF 内按真实时长消耗，确保高速/高采样率录像丝滑不掉拍
      while (remainingBudget > 0 && idx < totalCount - 1) {
        const cur = events[idx];
        const nxt = events[idx + 1];
        const isCrossRound = nxt.roundNumber !== cur.roundNumber;
        const isDramaticHighlight =
          cur.kind === 'elimination' ||
          cur.kind === 'shield_break' ||
          cur.kind === 'round_end';

        const realGap = Math.max(0.05, Math.min(0.85, nxt.battleTime - cur.battleTime));
        const stepDuration = isCrossRound
          ? 0.68
          : isDramaticHighlight
          ? Math.max(0.55, realGap)
          : realGap;

        const needed = (1 - alpha) * stepDuration;
        if (remainingBudget >= needed) {
          remainingBudget -= needed;
          idx += 1;
          alpha = 0;
          indexChanged = true;
        } else {
          alpha += remainingBudget / stepDuration;
          remainingBudget = 0;
        }
      }

      currentIndexRef.current = idx;
      subAlphaRef.current = alpha;

      // 直接以 60 FPS 渲染当前插值帧到 Canvas
      paintFrameToCanvas(idx, alpha);

      if (idx >= totalCount - 1) {
        playingRef.current = false;
        setCurrentIndex(idx);
        setScrubberPos(idx);
        setPlaying(false);
        return;
      }

      if (indexChanged) {
        setCurrentIndex(idx);
        setScrubberPos(idx + alpha);
        lastUiSyncTs = now;
      } else if (now - lastUiSyncTs >= 48) {
        setScrubberPos(idx + alpha);
        lastUiSyncTs = now;
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [events, paintFrameToCanvas, playing, totalCount]);

  const curSnap = events[currentIndex] ?? events[0];
  const latestHighlightIndex = useMemo(() => {
    for (let i = currentIndex; i >= 0; i -= 1) {
      if (events[i]?.kind !== 'keyframe') return i;
    }
    return 0;
  }, [currentIndex, events]);

  if (!curSnap) return null;

  const sampleHz = replay.sampleRateHz ?? 10;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="对局录像回放"
      data-testid="match-replay-modal"
      className="fixed inset-0 z-50 bg-[#14181E]/75 flex items-center justify-center p-3 sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-5xl max-h-[92vh] bg-[#FAF8F4] border border-[#D4CEC0] rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* 顶部栏：回合、时间、实时双方状态（比分 + 弹药 + 当前道具）与关闭 */}
        <header className="px-5 py-3 bg-[#222830] text-[#F5F2EB] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Film className="w-4 h-4 text-[#F2A65A] shrink-0" aria-hidden="true" />
            <h2 className="font-display text-base font-bold tracking-tight truncate">
              对局录像回放
            </h2>
            <span className="text-xs font-mono-num text-[#AEB7C2] whitespace-nowrap">
              第 {curSnap.roundNumber} 回合 · {formatReplayTimestamp(curSnap.battleTime)}
            </span>
          </div>

          {/* 实时同步的玩家战术状态条 */}
          <div className="flex items-center gap-3">
            <div
              data-testid="replay-live-hud"
              className="hidden sm:flex items-center gap-3 px-3 py-1 rounded-md bg-white/8 border border-white/10 text-xs"
            >
              {curSnap.tanks.map((t, idx) => {
                const maxAmmo = t.maxAmmo ?? 5;
                const ammo = t.ammo ?? maxAmmo;
                const offenseLabel = t.offenseKind
                  ? ITEM_LABELS[(t.offenseKind as ItemKind) ?? 'shield'] ?? t.offenseKind
                  : null;
                return (
                  <div key={t.slotId} className="flex items-center gap-2">
                    {idx > 0 && <span className="text-[#697482] font-bold">:</span>}
                    <span
                      className="w-2.5 h-2.5 rounded-[2px] shrink-0"
                      style={{ backgroundColor: t.colorHex }}
                    />
                    <span className={`font-semibold ${t.alive ? 'text-[#F5F2EB]' : 'text-[#8B95A3] line-through'}`}>
                      {t.displayName}
                    </span>
                    <span className="font-mono-num font-bold text-white">
                      {curSnap.scores[t.slotId] ?? 0}
                    </span>
                    {/* 精简弹药点指示 */}
                    <span
                      className="inline-flex items-center gap-0.5 ml-0.5"
                      title={`剩余弹药 ${ammo}/${maxAmmo}`}
                    >
                      {Array.from({ length: maxAmmo }).map((_, dotIdx) => (
                        <span
                          key={dotIdx}
                          className={`w-1.5 h-1.5 rounded-full ${
                            dotIdx < ammo ? 'bg-[#F2A65A]' : 'bg-white/20'
                          }`}
                        />
                      ))}
                    </span>
                    {t.hasShield && (
                      <Shield className="w-3.5 h-3.5 text-[#38BDF8]" aria-label="护盾生效中" />
                    )}
                    {offenseLabel && (
                      <span className="text-[10px] font-semibold text-[#FDE68A] bg-white/10 px-1.5 py-0.5 rounded">
                        {offenseLabel}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="关闭录像回放"
              className="w-8 h-8 rounded-md bg-white/10 hover:bg-white/20 text-[#F5F2EB] inline-flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* 主体区：左战场回放画布 + 右侧精彩事件日志 */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_285px]">
          {/* 左侧：高精度回放画布 */}
          <div className="relative bg-[#E8E3D7] flex flex-col min-h-[300px] lg:min-h-[450px]">
            <div ref={stageBoxRef} className="relative flex-1 min-h-[280px] w-full overflow-hidden">
              <canvas
                ref={canvasRef}
                data-testid="replay-canvas"
                className="block w-full h-full"
              />

              {/* 左上角轻量精度角标 */}
              <div className="pointer-events-none absolute top-3 left-3 px-2 py-1 rounded bg-[#1C2127]/75 text-[#E7E3D9] text-[10px] font-mono-num">
                {sampleHz} Hz 精细采样 · {totalCount} 帧
              </div>

              {/* 右上角战术轨迹开关 */}
              <button
                type="button"
                data-testid="replay-trails-toggle"
                onClick={() => setShowTrails((v) => !v)}
                aria-pressed={showTrails}
                className={`absolute top-3 right-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors cursor-pointer ${
                  showTrails
                    ? 'bg-[#1C2127]/90 text-[#F5F2EB] border-white/20'
                    : 'bg-white/85 text-[#4B5560] border-[#CFC8BA] hover:bg-white'
                }`}
              >
                <Route className="w-3.5 h-3.5" aria-hidden="true" />
                战术轨迹
              </button>

              {/* 底部精简事件字幕条 */}
              {curSnap.headline && (
                <div
                  data-testid="replay-caption"
                  className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 max-w-[92%] px-3.5 py-1.5 rounded-lg bg-[#1C2127]/90 text-[#F5F2EB] text-xs font-semibold shadow-md border border-white/10 flex items-center gap-2 whitespace-nowrap truncate"
                >
                  {curSnap.actorColorHex && (
                    <span
                      className="w-2 h-2 rounded-[2px] shrink-0"
                      style={{ backgroundColor: curSnap.actorColorHex }}
                    />
                  )}
                  <span className="truncate">{curSnap.headline}</span>
                </div>
              )}
            </div>
          </div>

          {/* 右侧：精彩事件日志时间线（点击可一键跳转） */}
          <aside className="border-t lg:border-t-0 lg:border-l border-[#D6CFC0] bg-[#FAF8F4] flex flex-col min-h-[180px] max-h-[260px] lg:max-h-none overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#E3DDD0] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#1C2127]">
                <Sparkles className="w-3.5 h-3.5 text-[#D9432B]" aria-hidden="true" />
                <span>精彩事件日志</span>
              </div>
              <span className="text-[11px] font-mono-num text-[#68717D]">
                共 {highlights.length} 个瞬间
              </span>
            </div>

            <div
              data-testid="replay-event-log"
              className="flex-1 overflow-y-auto divide-y divide-[#ECE7DC]"
            >
              {highlights.map((ev) => {
                const isExact = ev.index === currentIndex;
                const isLatest = ev.index === latestHighlightIndex;
                const kindLabel = REPLAY_HIGHLIGHT_LABELS[ev.kind] ?? ev.kind;
                return (
                  <button
                    key={ev.index}
                    type="button"
                    data-testid={`replay-event-item-${ev.index}`}
                    onClick={() => jumpToIndex(ev.index)}
                    className={`w-full text-left px-4 py-2.5 transition-colors flex items-start justify-between gap-2.5 cursor-pointer ${
                      isExact
                        ? 'bg-[#EFE9DC]'
                        : isLatest
                        ? 'bg-[#F6F2E8]'
                        : 'hover:bg-[#F3EFE6]'
                    }`}
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-2 h-2 rounded-[2px] shrink-0"
                          style={{ backgroundColor: ev.actorColorHex ?? '#4B5560' }}
                          aria-hidden="true"
                        />
                        <span className="text-[11px] font-bold text-[#4B5560]">
                          R{ev.roundNumber} · {kindLabel}
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-[#1C2127] truncate">
                        {ev.headline ?? kindLabel}
                      </p>
                    </div>

                    <span className="text-[11px] font-mono-num text-[#68717D] shrink-0 pt-0.5">
                      {formatReplayTimestamp(ev.battleTime)}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="shrink-0 px-4 py-2 border-t border-[#E3DDD0] text-[10px] font-mono-num text-[#7B8490] flex items-center justify-between">
              <span className="truncate">{mapCode}</span>
              <span>Space 播放 · ←/→ 步进</span>
            </div>
          </aside>
        </div>

        {/* 底部步进与时间轴控制条 */}
        <div className="shrink-0 px-5 py-3.5 bg-[#F3EFE6] border-t border-[#D6CFC0] space-y-3">
          {/* 进度条 + 精彩事件节点标尺 */}
          <div className="relative pt-2.5 pb-1">
            {/* 精彩事件标记点 */}
            {totalCount > 1 && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-0 left-1 right-1 h-2"
              >
                {highlights.map((ev) => {
                  const pct = (ev.index / (totalCount - 1)) * 100;
                  const isMajor =
                    ev.kind === 'elimination' ||
                    ev.kind === 'shield_break' ||
                    ev.kind === 'round_end';
                  return (
                    <span
                      key={ev.index}
                      style={{
                        left: `${pct}%`,
                        backgroundColor: ev.actorColorHex ?? (isMajor ? '#D9432B' : '#7B8490'),
                      }}
                      className={`absolute -translate-x-1/2 rounded-full ${
                        isMajor ? 'w-2 h-2 top-0' : 'w-1.5 h-1.5 top-0.5 opacity-70'
                      }`}
                    />
                  );
                })}
              </div>
            )}

            <input
              type="range"
              min={0}
              max={Math.max(0, totalCount - 1)}
              step={0.01}
              value={Math.min(Math.max(0, totalCount - 1), scrubberPos)}
              data-testid="replay-scrubber"
              aria-label="对局录像步进进度条"
              onChange={(e) => jumpToIndex(Math.round(Number(e.target.value)))}
              className="w-full accent-[#D9432B] cursor-pointer h-1.5 block"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* 步进与播放控制 */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleRestart}
                title="从头重播"
                aria-label="从头重播"
                className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-[#CFC8BA] bg-white hover:bg-[#ECE7DC] text-[#2C333B] transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={() => handleJumpHighlight(-1)}
                disabled={currentIndex <= 0}
                title="上一个精彩瞬间"
                aria-label="上一个精彩瞬间"
                className="inline-flex items-center gap-1 px-2.5 h-8 text-xs font-semibold rounded-md border border-[#CFC8BA] bg-white hover:bg-[#ECE7DC] disabled:opacity-40 text-[#2C333B] transition-colors cursor-pointer"
              >
                <SkipBack className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">上一精彩</span>
              </button>

              <button
                type="button"
                data-testid="replay-step-prev"
                onClick={() => handleStep(-1)}
                disabled={currentIndex <= 0}
                aria-label="上一步"
                className="inline-flex items-center gap-1 px-2.5 h-8 text-xs font-semibold rounded-md border border-[#CFC8BA] bg-white hover:bg-[#ECE7DC] disabled:opacity-40 text-[#2C333B] transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
                上一步
              </button>

              <button
                type="button"
                data-testid="replay-play-toggle"
                onClick={handleTogglePlay}
                disabled={totalCount <= 1}
                className="inline-flex items-center gap-1.5 px-4 h-8 text-xs font-bold rounded-md bg-[#D9432B] hover:bg-[#BE3620] disabled:opacity-40 text-white transition-colors cursor-pointer whitespace-nowrap"
              >
                {playing ? (
                  <>
                    <Pause className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                    暂停
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                    播放动画
                  </>
                )}
              </button>

              <button
                type="button"
                data-testid="replay-step-next"
                onClick={() => handleStep(1)}
                disabled={currentIndex >= totalCount - 1}
                aria-label="下一步"
                className="inline-flex items-center gap-1 px-2.5 h-8 text-xs font-semibold rounded-md border border-[#CFC8BA] bg-white hover:bg-[#ECE7DC] disabled:opacity-40 text-[#2C333B] transition-colors cursor-pointer"
              >
                下一步
                <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={() => handleJumpHighlight(1)}
                disabled={currentIndex >= totalCount - 1}
                title="下一个精彩瞬间"
                aria-label="下一个精彩瞬间"
                className="inline-flex items-center gap-1 px-2.5 h-8 text-xs font-semibold rounded-md border border-[#CFC8BA] bg-white hover:bg-[#ECE7DC] disabled:opacity-40 text-[#2C333B] transition-colors cursor-pointer"
              >
                <span className="hidden sm:inline">下一精彩</span>
                <SkipForward className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>

            {/* 倍速切换与帧步进计数 */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-0.5 p-0.5 bg-[#E4DEC9] rounded-md" role="group" aria-label="回放倍速">
                {SPEED_OPTIONS.map((sp) => (
                  <button
                    key={sp}
                    type="button"
                    onClick={() => setSpeed(sp)}
                    className={`px-2 py-1 text-[11px] font-mono-num font-semibold rounded transition-colors cursor-pointer ${
                      speed === sp
                        ? 'bg-white text-[#1C2127] shadow-xs'
                        : 'text-[#4F5864] hover:text-[#1C2127]'
                    }`}
                  >
                    {sp}x
                  </button>
                ))}
              </div>

              <span
                data-testid="replay-step-counter"
                className="text-xs font-mono-num font-bold text-[#3A424C] whitespace-nowrap"
              >
                步进 {currentIndex + 1} / {totalCount}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 将单个 ReplaySnapshotEvent 及战术走位轨迹按《坦克大战》制图美学绘制到 Canvas */
function renderReplaySnapshot(
  ctx: CanvasRenderingContext2D,
  replay: MatchReplayData,
  frame: ReplaySnapshotEvent,
  trails: TankTrailSeries[],
  cssW: number,
  cssH: number,
  dpr: number
): void {
  const padding = 20;
  const availW = Math.max(80, cssW - padding * 2);
  const availH = Math.max(80, cssH - padding * 2);
  const scale = Math.min(availW / replay.arenaWidth, availH / replay.arenaHeight);
  const drawW = replay.arenaWidth * scale;
  const drawH = replay.arenaHeight * scale;
  const offsetX = (cssW - drawW) * 0.5;
  const offsetY = (cssH - drawH) * 0.5;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // 外部暖岩纸色底板
  ctx.fillStyle = '#E8E3D7';
  ctx.fillRect(0, 0, cssW, cssH);

  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  // 1. 战场底板与网格
  ctx.save();
  ctx.shadowColor = 'rgba(28, 33, 39, 0.14)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = '#F3EFE6';
  ctx.fillRect(0, 0, replay.arenaWidth, replay.arenaHeight);
  ctx.restore();

  ctx.strokeStyle = 'rgba(38, 45, 53, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 1; c < replay.gridCols; c += 1) {
    const x = c * CELL_SIZE;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, replay.arenaHeight);
  }
  for (let r = 1; r < replay.gridRows; r += 1) {
    const y = r * CELL_SIZE;
    ctx.moveTo(0, y);
    ctx.lineTo(replay.arenaWidth, y);
  }
  ctx.stroke();

  // 1.5 战术走位轨迹（淡出虚线路径）
  for (const trail of trails) {
    if (trail.points.length < 2) continue;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = trail.colorHex;
    ctx.setLineDash([6, 6]);
    for (let i = 1; i < trail.points.length; i += 1) {
      const segRatio = i / trail.points.length;
      ctx.globalAlpha = 0.08 + segRatio * 0.34;
      ctx.lineWidth = 1.8 + segRatio * 1.8;
      ctx.beginPath();
      ctx.moveTo(trail.points[i - 1].x, trail.points[i - 1].y);
      ctx.lineTo(trail.points[i].x, trail.points[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 2. 地雷
  for (const mine of frame.mines) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(mine.x, mine.y, MINE_VISUAL_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = mine.armed ? '#2B3139' : 'rgba(43,49,57,0.45)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = mine.colorHex;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mine.x, mine.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = mine.armed ? '#F87171' : '#9CA3AF';
    ctx.fill();
    ctx.restore();
  }

  // 3. 场上待拾取道具
  for (const drop of frame.drops) {
    const accent =
      ITEM_ACCENT_COLORS[(drop.kind as ItemKind) ?? 'shield'] ?? ITEM_ACCENT_COLORS.shield;
    const shortLabel = ITEM_LABELS[(drop.kind as ItemKind) ?? 'shield'] ?? '道';
    ctx.save();
    ctx.translate(drop.x, drop.y);
    ctx.fillStyle = accent.bg;
    ctx.strokeStyle = accent.border;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.roundRect(
      -DROP_PICKUP_RADIUS,
      -DROP_PICKUP_RADIUS,
      DROP_PICKUP_RADIUS * 2,
      DROP_PICKUP_RADIUS * 2,
      6
    );
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = accent.fg;
    ctx.font = '700 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(shortLabel.slice(0, 2), 0, 1);
    ctx.restore();
  }

  // 4. 迷宫墙体（投影 + 主墙 + 墙脊高光）
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(28, 33, 39, 0.14)';
  ctx.lineWidth = WALL_THICKNESS + 2;
  ctx.beginPath();
  for (const w of replay.walls) {
    ctx.moveTo(w.x1 + 2.5, w.y1 + 3.5);
    ctx.lineTo(w.x2 + 2.5, w.y2 + 3.5);
  }
  ctx.stroke();

  ctx.strokeStyle = '#262D35';
  ctx.lineWidth = WALL_THICKNESS;
  ctx.beginPath();
  for (const w of replay.walls) {
    ctx.moveTo(w.x1, w.y1);
    ctx.lineTo(w.x2, w.y2);
  }
  ctx.stroke();

  ctx.strokeStyle = '#3C4652';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  for (const w of replay.walls) {
    ctx.moveTo(w.x1, w.y1 - 1.5);
    ctx.lineTo(w.x2, w.y2 - 1.5);
  }
  ctx.stroke();
  ctx.restore();

  // 5. 激光光迹（含平滑衰减）
  for (const beam of frame.laserBeams) {
    if (beam.points.length < 2) continue;
    const beamAlpha = beam.alpha ?? 1;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = beam.colorHex;
    ctx.globalAlpha = 0.34 * beamAlpha;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(beam.points[0].x, beam.points[0].y);
    for (let i = 1; i < beam.points.length; i += 1) {
      ctx.lineTo(beam.points[i].x, beam.points[i].y);
    }
    ctx.stroke();

    ctx.globalAlpha = 0.95 * beamAlpha;
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
    ctx.restore();
  }

  // 6. 弹体（含不同弹种尾迹）
  for (const proj of frame.projectiles) {
    ctx.save();
    const speed = Math.hypot(proj.vx, proj.vy) || 1;
    const tailLen =
      proj.source === 'frag_shard' ? 14 : proj.source === 'homing' ? 22 : 17;
    ctx.strokeStyle = proj.colorHex;
    ctx.globalAlpha = 0.38;
    ctx.lineWidth = Math.max(2, proj.radius * 1.15);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(proj.x, proj.y);
    ctx.lineTo(proj.x - (proj.vx / speed) * tailLen, proj.y - (proj.vy / speed) * tailLen);
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(proj.x, proj.y, proj.radius, 0, Math.PI * 2);
    ctx.fillStyle = proj.colorHex;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#1C2127';
    ctx.stroke();
    ctx.restore();
  }

  // 7. 坦克本体（含后坐力、履带纹理、护盾剩余弧线与精简弹药点）
  for (const tank of frame.tanks) {
    ctx.save();
    ctx.translate(tank.x, tank.y);
    if (!tank.alive) {
      ctx.strokeStyle = tank.colorHex;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-12, -12);
      ctx.lineTo(12, 12);
      ctx.moveTo(12, -12);
      ctx.lineTo(-12, 12);
      ctx.stroke();
      ctx.restore();
      continue;
    }

    // 护盾环（含剩余时间进度实弧）
    if (tank.hasShield) {
      const shieldRatio = Math.max(0.08, Math.min(1, tank.shieldRatio ?? 1));
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, TANK_RADIUS + 8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(14, 107, 168, 0.12)';
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = 'rgba(14, 107, 168, 0.32)';
      ctx.setLineDash([6, 4]);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(
        0,
        0,
        TANK_RADIUS + 8,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * shieldRatio
      );
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = '#0E6BA8';
      ctx.stroke();
      ctx.restore();
    }

    // 车身旋转绘制
    const recoilPx = Math.min(5, (tank.recoil ?? 0) * 4.5);
    const treadShift = ((tank.treadPhase ?? 0) % 8 + 8) % 8;
    ctx.save();
    ctx.rotate(tank.angle);

    // 履带 + 节纹
    ctx.fillStyle = '#262D35';
    ctx.fillRect(-17, -18, 34, 7);
    ctx.fillRect(-17, 11, 34, 7);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1.2;
    for (let tx = -15 + (treadShift % 6); tx <= 15; tx += 6) {
      ctx.beginPath();
      ctx.moveTo(tx, -17.5);
      ctx.lineTo(tx, -11.5);
      ctx.moveTo(tx, 11.5);
      ctx.lineTo(tx, 17.5);
      ctx.stroke();
    }

    // 主车体
    ctx.fillStyle = tank.colorHex;
    ctx.strokeStyle = '#1C2127';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.roundRect(-15, -13, 30, 26, 4);
    ctx.fill();
    ctx.stroke();

    // 炮管（应用开火后坐力回缩）
    ctx.fillStyle = '#262D35';
    ctx.strokeStyle = '#14181C';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(2 - recoilPx, -3.2, TANK_BARREL_LENGTH - 2, 6.4, 2);
    ctx.fill();
    ctx.stroke();

    // 炮塔
    ctx.beginPath();
    ctx.arc(-1, 0, 8.2, 0, Math.PI * 2);
    ctx.fillStyle = tank.colorHex;
    ctx.fill();
    ctx.strokeStyle = '#1C2127';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // 头顶玩家名
    ctx.font = '700 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#1C2127';
    ctx.fillText(tank.displayName, 0, -TANK_RADIUS - 8);

    // 脚下迷你弹药槽指示（当快照记录了弹药信息时显示）
    if (tank.maxAmmo && tank.maxAmmo > 0 && tank.ammo !== undefined) {
      const count = Math.min(6, tank.maxAmmo);
      const spacing = 6;
      const startX = -((count - 1) * spacing) / 2;
      for (let i = 0; i < count; i += 1) {
        ctx.beginPath();
        ctx.arc(startX + i * spacing, TANK_RADIUS + 11, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = i < tank.ammo ? '#1C2127' : 'rgba(28,33,39,0.22)';
        ctx.fill();
      }
    }

    ctx.restore();
  }

  // 8. 即时特效提示（炮口火光、弹体反弹火花、弹幕抵消环、拾取光波）
  if (frame.cues) {
    for (const cue of frame.cues) {
      const p = Math.max(0, Math.min(1, cue.progress ?? 0.35));
      const fade = Math.max(0, 1 - p);
      ctx.save();
      ctx.translate(cue.x, cue.y);
      ctx.globalAlpha = fade;

      if (cue.kind === 'muzzle') {
        ctx.rotate(cue.angle ?? 0);
        ctx.fillStyle = '#FDE68A';
        ctx.beginPath();
        ctx.ellipse(6 + p * 4, 0, 9 * fade + 3, 5 * fade + 2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (cue.kind === 'bounce') {
        ctx.strokeStyle = '#F97316';
        ctx.lineWidth = 2;
        const r = 4 + p * 12;
        for (let k = 0; k < 4; k += 1) {
          const a = (k * Math.PI) / 2 + Math.PI / 4;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * (r * 0.4), Math.sin(a) * (r * 0.4));
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
          ctx.stroke();
        }
      } else if (cue.kind === 'cancel' || cue.kind === 'pickup' || cue.kind === 'shield_break') {
        ctx.strokeStyle = cue.colorHex;
        ctx.lineWidth = cue.kind === 'shield_break' ? 3 : 2.2;
        ctx.beginPath();
        ctx.arc(0, 0, 10 + p * 26, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // 9. 爆炸冲击波（基于 progress 平滑扩散与淡出）
  for (const exp of frame.explosions) {
    const p = Math.max(0.1, Math.min(1, exp.progress ?? 0.4));
    const fade = Math.max(0.12, 1 - p * 0.78);
    const curRadius = exp.radius * (0.45 + p * 0.75);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.beginPath();
    ctx.arc(exp.x, exp.y, curRadius * 0.7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(234, 88, 12, 0.28)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(exp.x, exp.y, curRadius, 0, Math.PI * 2);
    ctx.strokeStyle = exp.colorHex;
    ctx.lineWidth = 3.2;
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}
