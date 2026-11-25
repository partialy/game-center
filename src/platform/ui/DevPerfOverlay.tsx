import { Activity, Cpu, X } from 'lucide-react';
import { getFpsHealthLevel, type PerfSnapshot } from '../debug/perfMonitor';

interface DevPerfOverlayProps {
  snapshot: PerfSnapshot;
  onClose: () => void;
  /** 当嵌入侧栏垂直栈中（如避让玩家按键提示）时设为 true，由外层容器控制定位 */
  embedded?: boolean;
}

const SPARKLINE_WIDTH = 122;
const SPARKLINE_HEIGHT = 24;

/**
 * 开发者调试性能悬浮面板：
 * - 仅在开发者调试模式下挂载于 GameViewport 侧边留白区域
 * - 无 backdrop-blur，使用低开销纯色高对比度战术面板样式，避免干扰 Canvas 帧率
 */
export function DevPerfOverlay({ snapshot, onClose, embedded = false }: DevPerfOverlayProps) {
  const health = snapshot.paused ? 'good' : getFpsHealthLevel(snapshot.fps);
  const fpsColorClass = snapshot.paused
    ? 'text-[#B5BEC9]'
    : health === 'good'
    ? 'text-[#4ADE80]'
    : health === 'warn'
    ? 'text-[#FBBF24]'
    : 'text-[#F87171]';

  const memory = snapshot.memory;
  const memoryPercent = memory ? Math.min(100, Math.round(memory.usedRatio * 100)) : 0;

  return (
    <aside
      data-testid="dev-perf-overlay"
      aria-label="开发者性能监控"
      className={`pointer-events-none ${
        embedded ? 'w-full' : 'absolute top-2.5 left-2 z-20 w-[146px]'
      } rounded-lg border border-[#3B444F] bg-[#1C2127]/94 text-[#F4F1EA] shadow-lg px-2.5 py-2`}
    >
      {/* 标题栏与快速关闭 */}
      <div className="flex items-center justify-between gap-1.5 pb-1.5 border-b border-[#323A44]">
        <div className="flex items-center gap-1 min-w-0">
          <Activity className="w-3 h-3 text-[#4ADE80] shrink-0" aria-hidden="true" />
          <span className="text-[10px] font-bold tracking-wide text-[#E6E2D8] truncate">
            DEV 监控
          </span>
        </div>
        <button
          type="button"
          tabIndex={-1}
          onClick={onClose}
          aria-label="关闭性能监控"
          title="关闭（F3 或 Ctrl+Shift+D）"
          className="pointer-events-auto w-4 h-4 rounded flex items-center justify-center text-[#9BA5B2] hover:text-white hover:bg-[#2F3742] transition-colors cursor-pointer"
        >
          <X className="w-3 h-3" aria-hidden="true" />
        </button>
      </div>

      {/* 帧率与帧耗时 */}
      <div className="mt-1.5 flex items-baseline justify-between gap-1">
        <div className="flex items-baseline gap-1">
          <span
            data-testid="dev-perf-fps"
            className={`font-mono-num text-xl font-extrabold leading-none ${fpsColorClass}`}
          >
            {snapshot.paused ? '--' : snapshot.fps}
          </span>
          <span className="text-[9px] font-semibold text-[#9BA5B2]">FPS</span>
        </div>

        {snapshot.paused ? (
          <span className="text-[10px] font-semibold text-[#FBBF24]">已暂停</span>
        ) : (
          <span
            data-testid="dev-perf-frametime"
            className="font-mono-num text-[10px] text-[#C8D0DA]"
          >
            {snapshot.avgFrameMs.toFixed(1)} ms
          </span>
        )}
      </div>

      {/* 帧率微型趋势图 */}
      <div className="mt-1.5 rounded bg-[#14181D] border border-[#2C333C] px-1 py-0.5">
        <FpsSparkline history={snapshot.fpsHistory} />
      </div>

      {/* 峰值帧耗时与单帧步数 */}
      <div className="mt-1 flex items-center justify-between text-[9px] font-mono-num text-[#9BA5B2]">
        <span>峰 {snapshot.maxFrameMs.toFixed(1)}ms</span>
        <span>步 {snapshot.simStepsPerFrame.toFixed(1)}/f</span>
      </div>

      {/* AI 决策耗时与超预算状态 */}
      {snapshot.aiComputeMs !== undefined && snapshot.aiComputeMs > 0 && (
        <div className="mt-1 flex items-center justify-between text-[9px] font-mono-num">
          <span className="text-[#9BA5B2]">AI {snapshot.aiComputeMs.toFixed(2)}ms</span>
          <span
            className={
              snapshot.aiOverBudget ? 'text-[#FBBF24] font-bold' : 'text-[#4ADE80]'
            }
          >
            {snapshot.aiOverBudget ? '正在计算' : '60Hz 同步'}
          </span>
        </div>
      )}

      {/* JS 堆内存占用 */}
      <div className="mt-1.5 pt-1.5 border-t border-[#323A44]">
        <div className="flex items-center justify-between gap-1 text-[9px] text-[#B5BEC9]">
          <span className="inline-flex items-center gap-1 font-semibold shrink-0">
            <Cpu className="w-2.5 h-2.5 text-[#7DD3FC]" aria-hidden="true" />
            内存
          </span>
          <span data-testid="dev-perf-memory" className="font-mono-num text-[#E6E2D8] truncate">
            {memory ? `${memory.usedMb.toFixed(1)}/${memory.totalMb.toFixed(0)}MB` : '不可用'}
          </span>
        </div>

        {memory ? (
          <>
            <div className="mt-1 h-1.5 w-full rounded-xs bg-[#14181D] overflow-hidden border border-[#2C333C]">
              <div
                className={`h-full ${
                  memoryPercent >= 80
                    ? 'bg-[#F87171]'
                    : memoryPercent >= 55
                    ? 'bg-[#FBBF24]'
                    : 'bg-[#38BDF8]'
                }`}
                style={{ width: `${Math.max(2, memoryPercent)}%` }}
              />
            </div>
            <div className="mt-1 flex items-center justify-between text-[9px] font-mono-num text-[#8B95A3]">
              <span>上限 {memory.limitMb.toFixed(0)}M</span>
              <span>{memoryPercent}%</span>
            </div>
          </>
        ) : (
          <p className="mt-1 text-[9px] text-[#8B95A3]">浏览器未开放堆接口</p>
        )}
      </div>

      <div className="mt-1.5 pt-1 border-t border-[#2A313A] text-[9px] text-[#7F8996] text-center">
        F3 / Ctrl+Shift+D
      </div>
    </aside>
  );
}

function FpsSparkline({ history }: { history: number[] }) {
  const maxRef = 65;
  const y60 = SPARKLINE_HEIGHT - (60 / maxRef) * SPARKLINE_HEIGHT;
  const y30 = SPARKLINE_HEIGHT - (30 / maxRef) * SPARKLINE_HEIGHT;

  if (history.length < 2) {
    return (
      <svg
        viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
        className="w-full h-[26px] block"
        aria-hidden="true"
      >
        <line
          x1={0}
          y1={y60}
          x2={SPARKLINE_WIDTH}
          y2={y60}
          stroke="#2E3742"
          strokeDasharray="2 2"
          strokeWidth={1}
        />
        <line
          x1={0}
          y1={y30}
          x2={SPARKLINE_WIDTH}
          y2={y30}
          stroke="#262E37"
          strokeDasharray="2 2"
          strokeWidth={1}
        />
      </svg>
    );
  }

  const stepX = SPARKLINE_WIDTH / Math.max(1, history.length - 1);
  const points = history
    .map((val, idx) => {
      const x = idx * stepX;
      const clamped = Math.max(0, Math.min(maxRef, val));
      const y = SPARKLINE_HEIGHT - (clamped / maxRef) * (SPARKLINE_HEIGHT - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const latest = history[history.length - 1] ?? 60;
  const strokeColor =
    latest >= 55 ? '#4ADE80' : latest >= 30 ? '#FBBF24' : '#F87171';

  return (
    <svg
      viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
      className="w-full h-[26px] block"
      aria-hidden="true"
    >
      <line
        x1={0}
        y1={y60}
        x2={SPARKLINE_WIDTH}
        y2={y60}
        stroke="#2E3742"
        strokeDasharray="2 2"
        strokeWidth={1}
      />
      <line
        x1={0}
        y1={y30}
        x2={SPARKLINE_WIDTH}
        y2={y30}
        stroke="#262E37"
        strokeDasharray="2 2"
        strokeWidth={1}
      />
      <polyline
        fill="none"
        stroke={strokeColor}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
    </svg>
  );
}
