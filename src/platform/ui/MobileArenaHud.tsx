import {
  Check,
  Copy,
  Eye,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  BOSS_TIER_THEME,
  type BotRuntimeStatus,
  type HudState,
  type MatchLaunchSnapshot,
  type PlayerConfig,
  type PlayerHudEntry,
  type PlayerSlotId,
} from '../games/contracts';
import { ITEM_ACCENT_COLORS, TankItemIcon } from '../../games/tank-battle/ui/itemIcons';
import type { ItemKind } from '../../games/tank-battle/types';

interface MobileArenaHudProps {
  hud: HudState | null;
  snapshot: MatchLaunchSnapshot<unknown>;
  botStatuses: Record<PlayerSlotId, BotRuntimeStatus>;
  isMultiSeatArena: boolean;
  isAiSpectate: boolean;
  paused: boolean;
  muted: boolean;
  copiedCode: boolean;
  isFullscreen: boolean;
  canRequestFullscreen: boolean;
  editingLayout: boolean;
  onToggleMute: () => void;
  onToggleFullscreen: () => void;
  onTogglePause: () => void;
  onCopyMapCode: () => void;
}

function formatHudClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * 移动端战斗边缘悬浮 HUD：
 * - 去掉整条顶部栏，将 100% 区域留给游戏画布
 * - 顶部正中：时间 + 静音/全屏/暂停工具按钮（2 人模式两侧紧贴双方迷你比分）
 * - 左上与右上最边缘：弹夹进度与当前持有道具；3～8 席乱斗时分列左右两侧最边缘
 * - 左下角：当前回合 / 目标分；右下角：可点击复制的地图 ID
 */
export function MobileArenaHud({
  hud,
  snapshot,
  botStatuses,
  isMultiSeatArena,
  isAiSpectate,
  paused,
  muted,
  copiedCode,
  isFullscreen,
  canRequestFullscreen,
  editingLayout,
  onToggleMute,
  onToggleFullscreen,
  onTogglePause,
  onCopyMapCode,
}: MobileArenaHudProps) {
  const players = hud?.players ?? [];
  const p1 = players[0];
  const p2 = players[1];
  const p1Config = snapshot.players[0];
  const p2Config = snapshot.players[1];

  const halfCount = Math.ceil(players.length / 2);
  const leftBrawlPlayers = isMultiSeatArena ? players.slice(0, halfCount) : [];
  const rightBrawlPlayers = isMultiSeatArena ? players.slice(halfCount) : [];

  const clockValue =
    hud?.roundTimeRemainingSeconds !== null && hud?.roundTimeRemainingSeconds !== undefined
      ? formatHudClock(hud.roundTimeRemainingSeconds)
      : formatHudClock(hud?.battleElapsedSeconds ?? 0);
  const clockUrgent =
    hud?.roundTimeRemainingSeconds !== null &&
    hud?.roundTimeRemainingSeconds !== undefined &&
    hud.roundTimeRemainingSeconds <= 10;

  return (
    <div
      data-testid="mobile-arena-hud"
      className={`pointer-events-none absolute inset-0 z-20 select-none ${
        editingLayout ? 'opacity-35' : ''
      }`}
    >
      {/* 顶部居中：时间 + 暂停等工具按钮（2人模式两侧紧贴 P1 / P2 比分） */}
      <div className="pointer-events-auto absolute top-1.5 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-[#FAF8F4]/90 border border-[#CFC8B9] shadow-sm">
        {!isMultiSeatArena && p1 && (
          <MiniScorePill player={p1} config={p1Config} align="left" />
        )}

        {isMultiSeatArena && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#222830] text-[#E9D5FF] text-[10px] font-bold whitespace-nowrap">
            <Eye className="w-2.5 h-2.5 text-[#C084FC]" aria-hidden="true" />
            {snapshot.players.length}席
          </span>
        )}

        {!isMultiSeatArena && isAiSpectate && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-[#222830] text-[#7DD3FC] text-[9px] font-bold whitespace-nowrap">
            <Eye className="w-2.5 h-2.5" aria-hidden="true" />
            AI观战
          </span>
        )}

        <span
          className={`font-mono-num text-xs font-extrabold px-1 ${
            clockUrgent ? 'text-[#C93420]' : 'text-[#1C2127]'
          }`}
        >
          {clockValue}
        </span>

        <button
          type="button"
          tabIndex={-1}
          onClick={onToggleMute}
          aria-label={muted ? '开启音效' : '静音'}
          className="w-6 h-6 rounded-full bg-[#EEE9DD] hover:bg-[#E2DCCE] border border-[#D4CEC0] flex items-center justify-center text-[#2C333B] cursor-pointer"
        >
          {muted ? (
            <VolumeX className="w-3 h-3" aria-hidden="true" />
          ) : (
            <Volume2 className="w-3 h-3" aria-hidden="true" />
          )}
        </button>

        {canRequestFullscreen && (
          <button
            type="button"
            tabIndex={-1}
            onClick={onToggleFullscreen}
            aria-label={isFullscreen ? '退出全屏' : '全屏横屏'}
            className="w-6 h-6 rounded-full bg-[#EEE9DD] hover:bg-[#E2DCCE] border border-[#D4CEC0] flex items-center justify-center text-[#2C333B] cursor-pointer"
          >
            {isFullscreen ? (
              <Minimize2 className="w-3 h-3" aria-hidden="true" />
            ) : (
              <Maximize2 className="w-3 h-3" aria-hidden="true" />
            )}
          </button>
        )}

        <button
          type="button"
          tabIndex={-1}
          onClick={onTogglePause}
          aria-label={paused ? '继续对战' : '暂停对战'}
          className="w-6 h-6 rounded-full bg-[#222830] hover:bg-[#343C47] flex items-center justify-center text-white cursor-pointer"
        >
          {paused ? (
            <Play className="w-3 h-3 fill-current" aria-hidden="true" />
          ) : (
            <Pause className="w-3 h-3" aria-hidden="true" />
          )}
        </button>

        {!isMultiSeatArena && p2 && (
          <MiniScorePill player={p2} config={p2Config} align="right" />
        )}
      </div>

      {/* 2 人对战：弹药与道具信息贴左上与右上最边缘，完全避开摇杆与开火区 */}
      {!isMultiSeatArena && p1 && (
        <div className="absolute top-1.5 left-1.5 max-w-[138px]">
          <EdgeAmmoItemStrip player={p1} align="left" />
        </div>
      )}
      {!isMultiSeatArena && p2 && (
        <div className="absolute top-1.5 right-1.5 max-w-[138px]">
          <EdgeAmmoItemStrip player={p2} align="right" />
        </div>
      )}

      {/* 3～8 席乱斗：各席位分列左右最边缘 */}
      {isMultiSeatArena && (
        <>
          <div className="absolute top-1.5 left-1.5 flex flex-col gap-1 w-[108px]">
            {leftBrawlPlayers.map((entry) => (
              <EdgeBrawlTile
                key={entry.slotId}
                entry={entry}
                config={snapshot.players.find((c) => c.slotId === entry.slotId)}
                runtime={botStatuses[entry.slotId]}
                align="left"
              />
            ))}
          </div>
          <div className="absolute top-1.5 right-1.5 flex flex-col gap-1 w-[108px]">
            {rightBrawlPlayers.map((entry) => (
              <EdgeBrawlTile
                key={entry.slotId}
                entry={entry}
                config={snapshot.players.find((c) => c.slotId === entry.slotId)}
                runtime={botStatuses[entry.slotId]}
                align="right"
              />
            ))}
          </div>
        </>
      )}

      {/* 左下角：回合数与目标分 */}
      <div className="absolute bottom-1 left-2 px-2 py-0.5 rounded bg-[#FAF8F4]/80 border border-[#CFC8B9] text-[10px] font-bold text-[#1C2127] whitespace-nowrap">
        第 <span className="font-mono-num">{hud?.roundNumber ?? 1}</span> 回合 · 先得{' '}
        <span className="font-mono-num">{hud?.targetScore ?? 5}</span> 分
      </div>

      {/* 右下角：地图 ID（支持点按复制） */}
      {hud?.mapCode && (
        <button
          type="button"
          tabIndex={-1}
          onClick={onCopyMapCode}
          title="点击复制地图编号"
          className="pointer-events-auto absolute bottom-1 right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#FAF8F4]/82 hover:bg-[#FAF8F4] border border-[#CFC8B9] text-[10px] font-mono-num font-semibold text-[#3C4550] cursor-pointer"
        >
          <span className="truncate max-w-[132px]">{hud.mapCode}</span>
          {copiedCode ? (
            <Check className="w-2.5 h-2.5 text-[#1F8A5B] shrink-0" aria-hidden="true" />
          ) : (
            <Copy className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
          )}
        </button>
      )}
    </div>
  );
}

function MiniScorePill({
  player,
  config,
  align,
}: {
  player: PlayerHudEntry;
  config?: PlayerConfig;
  align: 'left' | 'right';
}) {
  const isBoss =
    config?.controller === 'ai' &&
    config?.aiSource !== 'custom' &&
    config?.aiModelId === 'hellbringer';
  const isRight = align === 'right';

  return (
    <div
      style={
        isBoss
          ? {
              backgroundColor: BOSS_TIER_THEME.bgHex,
              borderColor: BOSS_TIER_THEME.borderHex,
              color: BOSS_TIER_THEME.textHex,
            }
          : undefined
      }
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[11px] font-bold whitespace-nowrap ${
        isBoss ? '' : 'bg-white/90 border-[#D6D0C2] text-[#1C2127]'
      } ${isRight ? 'flex-row-reverse' : 'flex-row'} ${
        player.alive ? '' : 'opacity-60'
      }`}
    >
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: player.alive ? player.colorHex : '#7D8590' }}
      />
      <span className="max-w-[54px] truncate text-[10px]">{player.displayName}</span>
      <span className="font-mono-num text-xs font-extrabold">{player.score}</span>
    </div>
  );
}

function EdgeAmmoItemStrip({
  player,
  align,
}: {
  player: PlayerHudEntry;
  align: 'left' | 'right';
}) {
  const isRight = align === 'right';
  const ammoPct = Math.round((player.ammo / Math.max(1, player.maxAmmo)) * 100);

  return (
    <div
      className={`flex flex-col gap-1 px-1.5 py-1 rounded-md bg-[#FAF8F4]/78 border border-[#CFC8B9]/90 ${
        isRight ? 'items-end text-right' : 'items-start text-left'
      } ${player.alive ? '' : 'opacity-60'}`}
    >
      <div
        className={`flex items-center gap-1.5 text-[10px] font-bold text-[#2B323A] ${
          isRight ? 'flex-row-reverse' : 'flex-row'
        }`}
      >
        <span className="truncate max-w-[64px]">{player.displayName}</span>
        <span className="font-mono-num text-[#525C68]">
          {player.ammo}/{player.maxAmmo}
        </span>
      </div>

      {/* 极细弹夹与补弹进度条 */}
      <div className="relative w-20 h-1.5 rounded-full bg-[#DFD9CA] overflow-hidden">
        <div
          className="h-full transition-[width] duration-75"
          style={{
            width: `${ammoPct}%`,
            backgroundColor: player.alive ? player.colorHex : '#88909A',
          }}
        />
        {player.reloadProgress > 0 && player.ammo < player.maxAmmo && (
          <div
            className="absolute inset-y-0 left-0 opacity-45"
            style={{
              width: `${Math.min(100, ammoPct + Math.round((player.reloadProgress * 100) / Math.max(1, player.maxAmmo)))}%`,
              backgroundColor: player.colorHex,
            }}
          />
        )}
      </div>

      {/* 当前激活道具微缩贴片 */}
      {player.statusItems.length > 0 && (
        <div
          className={`flex flex-wrap gap-1 ${isRight ? 'justify-end' : 'justify-start'}`}
        >
          {player.statusItems.map((item) => {
            const accent =
              ITEM_ACCENT_COLORS[(item.iconKey as ItemKind) ?? 'shield'] ??
              ITEM_ACCENT_COLORS.shield;
            return (
              <div
                key={item.id}
                style={{
                  backgroundColor: accent.bg,
                  borderColor: accent.border,
                  color: accent.fg,
                }}
                className="inline-flex items-center gap-1 px-1 py-0.5 rounded border text-[9px] font-bold leading-none whitespace-nowrap"
              >
                {item.iconKey && <TankItemIcon kind={item.iconKey} className="w-3 h-3 shrink-0" />}
                <span>{item.label}</span>
                <span className="font-mono-num">{item.valueText}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EdgeBrawlTile({
  entry,
  config,
  runtime,
  align,
}: {
  entry: PlayerHudEntry;
  config?: PlayerConfig;
  runtime?: BotRuntimeStatus;
  align: 'left' | 'right';
}) {
  const isBoss =
    config?.controller === 'ai' &&
    config?.aiSource !== 'custom' &&
    config?.aiModelId === 'hellbringer';
  const hasFault =
    runtime && (runtime.state === 'timeout' || runtime.state === 'error');
  const ammoPct = Math.round((entry.ammo / Math.max(1, entry.maxAmmo)) * 100);
  const firstItem = entry.statusItems[0];

  return (
    <div
      data-testid={`arena-hud-tile-${entry.slotId}`}
      style={
        isBoss && entry.alive
          ? {
              backgroundColor: BOSS_TIER_THEME.bgHex,
              borderColor: BOSS_TIER_THEME.borderHex,
              color: BOSS_TIER_THEME.textHex,
            }
          : undefined
      }
      className={`rounded border px-1.5 py-1 flex flex-col gap-0.5 ${
        isBoss && entry.alive
          ? ''
          : entry.alive
          ? 'bg-[#FAF8F4]/82 border-[#D4CEC0] text-[#1C2127]'
          : 'bg-[#ECE7DB]/70 border-[#DDD7C9] opacity-55 text-[#555F6B]'
      }`}
    >
      <div
        className={`flex items-center justify-between gap-1 text-[10px] font-bold ${
          align === 'right' ? 'flex-row-reverse' : 'flex-row'
        }`}
      >
        <span className="flex items-center gap-1 min-w-0">
          <span
            className="w-2 h-2 rounded-[2px] shrink-0"
            style={{ backgroundColor: entry.alive ? entry.colorHex : '#7D8590' }}
          />
          <span className="truncate">{entry.displayName}</span>
        </span>
        <span className="font-mono-num text-[11px] font-extrabold shrink-0">{entry.score}</span>
      </div>

      <div className="h-[3px] w-full rounded-full bg-[#DFD9CA] overflow-hidden">
        <div
          className="h-full"
          style={{
            width: `${ammoPct}%`,
            backgroundColor: entry.alive ? entry.colorHex : '#98A0AA',
          }}
        />
      </div>

      {!entry.alive ? (
        <span className="text-[9px] font-semibold text-[#9B2216]">已淘汰</span>
      ) : hasFault ? (
        <span className="text-[9px] font-semibold text-[#B3261E]">
          {runtime.state === 'timeout' ? '超时' : '异常'}
        </span>
      ) : firstItem ? (
        <div className="flex items-center gap-1 text-[9px] font-semibold truncate">
          {firstItem.iconKey && <TankItemIcon kind={firstItem.iconKey} className="w-2.5 h-2.5 shrink-0" />}
          <span className="truncate">{firstItem.label}</span>
          <span className="font-mono-num shrink-0">{firstItem.valueText}</span>
        </div>
      ) : null}
    </div>
  );
}
