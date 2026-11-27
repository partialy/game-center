import { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Crosshair,
  Infinity as InfinityIcon,
  Package,
  RotateCcw,
  Send,
  ShieldOff,
  Trash2,
  UserX,
} from 'lucide-react';
import type {
  StickPickupKind,
  StickmanTrainingDrill,
  StickmanTrainingState,
  TrainingDispenseMode,
  TrainingDummyMotion,
  TrainingParryAmmo,
  TrainingParryCadence,
} from '../types';
import {
  TRAINING_DRILL_LIST,
  computeHeadshotRatePercent,
} from '../simulation/training';
import { StickmanItemIcon } from './StickmanItemIcons';

interface StickmanTrainingConsoleProps {
  state: StickmanTrainingState;
  paused: boolean;
  compactDefault?: boolean;
  onSelectDrill: (drill: StickmanTrainingDrill) => void;
  onUpdateConfig: (
    patch: Partial<
      Pick<
        StickmanTrainingState,
        | 'dummyMotion'
        | 'infiniteWeapon'
        | 'showHitZones'
        | 'zeroHurtInvuln'
        | 'parryAmmo'
        | 'parryCadence'
      >
    >
  ) => void;
  onDispenseItem: (kind: StickPickupKind | 'unarmed', mode: TrainingDispenseMode) => void;
  onClearPickups: () => void;
  onTriggerVolley: () => void;
  onResetArena: () => void;
}

const DISPENSE_ITEMS: ReadonlyArray<{
  kind: StickPickupKind;
  shortLabel: string;
  hotkey: string;
  code: string;
}> = [
  { kind: 'sword', shortLabel: '长剑', hotkey: '1', code: 'Digit1' },
  { kind: 'pistol', shortLabel: '手枪', hotkey: '2', code: 'Digit2' },
  { kind: 'shotgun', shortLabel: '猎枪', hotkey: '3', code: 'Digit3' },
  { kind: 'rocket', shortLabel: '火箭', hotkey: '4', code: 'Digit4' },
  { kind: 'grenade', shortLabel: '手雷', hotkey: '5', code: 'Digit5' },
  { kind: 'medkit', shortLabel: '血包', hotkey: '6', code: 'Digit6' },
];

const DUMMY_MOTION_OPTIONS: ReadonlyArray<{ value: TrainingDummyMotion; label: string }> = [
  { value: 'stand', label: '静止' },
  { value: 'strafe', label: '巡逻' },
  { value: 'jump', label: '跳跃' },
];

const PARRY_AMMO_OPTIONS: ReadonlyArray<{ value: TrainingParryAmmo; label: string }> = [
  { value: 'pistol', label: '手枪' },
  { value: 'shotgun', label: '猎枪' },
  { value: 'grenade', label: '手雷' },
  { value: 'mixed', label: '混合含火箭' },
];

const PARRY_CADENCE_OPTIONS: ReadonlyArray<{ value: TrainingParryCadence; label: string }> = [
  { value: 'slow', label: '慢' },
  { value: 'normal', label: '中' },
  { value: 'fast', label: '快' },
];

function blurActive(): void {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}

/**
 * 火柴人专项练习顶栏控制台（锚定于画布上方，零遮挡竞技场、零 backdrop-blur）：
 * - 第一行：4 项专项练习切换 + 实时无框指标读数 + 重置场地 / 折叠开关
 * - 第二行（可折叠）：随意发放道具（直接装备 / 空投到场 + 1~6 快捷键）+ 专项训练参数
 */
export function StickmanTrainingConsole({
  state,
  paused,
  compactDefault = false,
  onSelectDrill,
  onUpdateConfig,
  onDispenseItem,
  onClearPickups,
  onTriggerVolley,
  onResetArena,
}: StickmanTrainingConsoleProps) {
  const [expanded, setExpanded] = useState(!compactDefault);
  const [dispenseMode, setDispenseMode] = useState<TrainingDispenseMode>('equip');

  // 快捷键：1-6 发放对应道具，0 切空手，R 重置场地（不与 WASD / JKL / Space 冲突）
  useEffect(() => {
    if (paused) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.code === 'KeyR') {
        event.preventDefault();
        onResetArena();
        return;
      }
      if (event.code === 'Digit0') {
        event.preventDefault();
        onDispenseItem('unarmed', dispenseMode);
        return;
      }
      const matched = DISPENSE_ITEMS.find((item) => item.code === event.code);
      if (matched) {
        event.preventDefault();
        onDispenseItem(matched.kind, dispenseMode);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dispenseMode, onDispenseItem, onResetArena, paused]);

  const { stats, drill } = state;
  const rangedTotal = stats.headshots + stats.bodyHits + stats.legHits;
  const hsRate = computeHeadshotRatePercent(stats);

  return (
    <section
      aria-label="火柴人练习关卡控制台"
      data-testid="stickman-training-console"
      className="shrink-0 bg-[var(--surface)] border-b border-[var(--border)] text-[var(--foreground)] select-none"
    >
      {/* 第一行：专项切换 + 实时统计 + 重置与折叠 */}
      <div className="max-w-[1440px] mx-auto px-3 py-1.5 flex flex-wrap items-center justify-between gap-2">
        {/* 左侧：4 项专项练习分段栏 */}
        <div
          role="tablist"
          aria-label="选择练习专项"
          className="inline-flex items-center p-0.5 rounded-lg bg-[var(--surface-secondary)] border border-[var(--border)] shrink-0"
        >
          {TRAINING_DRILL_LIST.map((item) => {
            const active = drill === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`training-drill-${item.id}`}
                tabIndex={-1}
                onClick={() => {
                  onSelectDrill(item.id);
                  blurActive();
                }}
                className={`h-8 px-3 rounded-md text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                  active
                    ? 'bg-[var(--accent)] text-white shadow-xs'
                    : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* 中部：实时无框专项遥测 */}
        <div
          data-testid="training-live-metrics"
          className="flex items-center gap-2 text-xs text-[var(--muted)] font-mono-num overflow-x-auto whitespace-nowrap"
        >
          {drill === 'headshot' ? (
            <>
              <span>
                爆头 <strong className="text-red-500 font-extrabold">{stats.headshots}</strong>/
                {rangedTotal}
              </span>
              <span aria-hidden="true" className="opacity-40">
                ·
              </span>
              <span>
                爆头率 <strong className="text-[var(--foreground)]">{hsRate}%</strong>
              </span>
              <span aria-hidden="true" className="opacity-40">
                ·
              </span>
              <span>
                连爆 <strong className="text-[var(--foreground)]">{stats.headshotStreak}</strong>
                <span className="opacity-65"> (最高 {stats.bestHeadshotStreak})</span>
              </span>
            </>
          ) : drill === 'parry' ? (
            <>
              <span>
                斩弹 <strong className="text-sky-500 font-extrabold">{stats.parries}</strong>
              </span>
              <span aria-hidden="true" className="opacity-40">
                ·
              </span>
              <span>
                连斩 <strong className="text-[var(--foreground)]">{stats.parryStreak}</strong>
                <span className="opacity-65"> (最高 {stats.bestParryStreak})</span>
              </span>
              <span aria-hidden="true" className="opacity-40">
                ·
              </span>
              <span>
                漏防 <strong className="text-amber-500">{stats.playerHitsTaken}</strong>
              </span>
            </>
          ) : drill === 'combo' ? (
            <>
              <span>
                当前连击{' '}
                <strong className="text-amber-500 font-extrabold">{stats.comboHits}</strong>
              </span>
              <span aria-hidden="true" className="opacity-40">
                ·
              </span>
              <span>
                本套伤害 <strong className="text-[var(--foreground)]">{stats.comboDamage}</strong>
              </span>
              <span aria-hidden="true" className="opacity-40">
                ·
              </span>
              <span>
                最高 <strong className="text-[var(--foreground)]">{stats.bestComboHits}连</strong> /{' '}
                <strong className="text-[var(--foreground)]">{stats.bestComboDamage}伤</strong>
              </span>
            </>
          ) : (
            <>
              <span>
                命中 <strong className="text-[var(--foreground)]">{stats.totalHits}</strong>
              </span>
              <span aria-hidden="true" className="opacity-40">
                ·
              </span>
              <span>
                爆头 <strong className="text-red-500">{stats.headshots}</strong>
              </span>
              <span aria-hidden="true" className="opacity-40">
                ·
              </span>
              <span>
                斩弹 <strong className="text-sky-500">{stats.parries}</strong>
              </span>
              <span aria-hidden="true" className="opacity-40">
                ·
              </span>
              <span>
                最高连击 <strong className="text-[var(--foreground)]">{stats.bestComboHits}</strong>
              </span>
            </>
          )}
        </div>

        {/* 右侧：重置场地 + 展开/收起发放条 */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            tabIndex={-1}
            data-testid="training-reset-btn"
            title="修复砖墙、重置站位与统计（快捷键 R）"
            onClick={() => {
              onResetArena();
              blurActive();
            }}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-secondary)] hover:bg-[var(--border)]/45 text-xs font-semibold text-[var(--foreground)] whitespace-nowrap cursor-pointer transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>重置场地</span>
            <kbd className="hidden xl:inline text-[10px] font-mono-num opacity-60">R</kbd>
          </button>

          <button
            type="button"
            tabIndex={-1}
            aria-expanded={expanded}
            data-testid="training-toggle-drawer-btn"
            onClick={() => {
              setExpanded((prev) => !prev);
              blurActive();
            }}
            className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-secondary)] hover:bg-[var(--border)]/45 text-xs font-semibold text-[var(--foreground)] whitespace-nowrap cursor-pointer transition-colors"
          >
            <Package className="w-3.5 h-3.5 text-[var(--accent)]" aria-hidden="true" />
            <span>{expanded ? '收起工具' : '道具与参数'}</span>
            {expanded ? (
              <ChevronUp className="w-3.5 h-3.5 opacity-70" aria-hidden="true" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 opacity-70" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* 第二行：随意发放道具区 + 专项参数调节区 */}
      {expanded && (
        <div
          data-testid="training-tools-drawer"
          className="border-t border-[var(--separator)] bg-[var(--surface-secondary)]/55"
        >
          <div className="max-w-[1440px] mx-auto px-3 py-1.5 flex flex-wrap items-center justify-between gap-2">
            {/* 左侧：道具发放器 */}
            <div className="flex flex-wrap items-center gap-1.5">
              {/* 直接装备 / 空投到场 切换 */}
              <div
                role="group"
                aria-label="道具发放方式"
                className="inline-flex items-center p-0.5 rounded-md bg-[var(--surface)] border border-[var(--border)] shrink-0"
              >
                <button
                  type="button"
                  tabIndex={-1}
                  data-testid="training-dispense-mode-equip"
                  aria-pressed={dispenseMode === 'equip'}
                  onClick={() => {
                    setDispenseMode('equip');
                    blurActive();
                  }}
                  className={`h-7 px-2 rounded text-[11px] font-bold whitespace-nowrap cursor-pointer transition-colors ${
                    dispenseMode === 'equip'
                      ? 'bg-[var(--foreground)] text-[var(--background)]'
                      : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                  }`}
                >
                  直接装备
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  data-testid="training-dispense-mode-drop"
                  aria-pressed={dispenseMode === 'drop'}
                  onClick={() => {
                    setDispenseMode('drop');
                    blurActive();
                  }}
                  className={`h-7 px-2 rounded text-[11px] font-bold whitespace-nowrap cursor-pointer transition-colors ${
                    dispenseMode === 'drop'
                      ? 'bg-[var(--foreground)] text-[var(--background)]'
                      : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                  }`}
                >
                  空投到场
                </button>
              </div>

              {/* 6 种道具快捷按钮 */}
              {DISPENSE_ITEMS.map((item) => (
                <button
                  key={item.kind}
                  type="button"
                  tabIndex={-1}
                  data-testid={`training-give-${item.kind}`}
                  title={`${dispenseMode === 'equip' ? '直接装备' : '空投'}${item.shortLabel}（快捷键 ${item.hotkey}）`}
                  onClick={() => {
                    onDispenseItem(item.kind, dispenseMode);
                    blurActive();
                  }}
                  className="inline-flex items-center gap-1 h-8 px-2 rounded-md border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)] text-xs font-semibold text-[var(--foreground)] whitespace-nowrap cursor-pointer transition-colors"
                >
                  <StickmanItemIcon kind={item.kind} className="w-4 h-4 shrink-0" />
                  <span>{item.shortLabel}</span>
                  <kbd className="hidden lg:inline text-[10px] font-mono-num text-[var(--muted)]">
                    {item.hotkey}
                  </kbd>
                </button>
              ))}

              {/* 切空手 */}
              <button
                type="button"
                tabIndex={-1}
                data-testid="training-give-unarmed"
                title="卸下当前武器切回空手（快捷键 0）"
                onClick={() => {
                  onDispenseItem('unarmed', dispenseMode);
                  blurActive();
                }}
                className="inline-flex items-center gap-1 h-8 px-2 rounded-md border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)] text-xs font-semibold text-[var(--muted)] hover:text-[var(--foreground)] whitespace-nowrap cursor-pointer transition-colors"
              >
                <UserX className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>空手</span>
              </button>
            </div>

            {/* 右侧：专项与辅助开关 */}
            <div className="flex flex-wrap items-center gap-1.5">
              {/* 砍子弹专练专属：来袭弹种 + 节奏 + 立即发射 */}
              {drill === 'parry' ? (
                <>
                  <div
                    role="group"
                    aria-label="来袭弹种"
                    className="inline-flex items-center p-0.5 rounded-md bg-[var(--surface)] border border-[var(--border)] shrink-0"
                  >
                    {PARRY_AMMO_OPTIONS.map((opt) => {
                      const active = state.parryAmmo === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          tabIndex={-1}
                          data-testid={`training-parry-ammo-${opt.value}`}
                          aria-pressed={active}
                          onClick={() => {
                            onUpdateConfig({ parryAmmo: opt.value });
                            blurActive();
                          }}
                          className={`h-7 px-2 rounded text-[11px] font-bold whitespace-nowrap cursor-pointer transition-colors ${
                            active
                              ? 'bg-[var(--accent)] text-white'
                              : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>

                  <div
                    role="group"
                    aria-label="发球节奏"
                    className="inline-flex items-center p-0.5 rounded-md bg-[var(--surface)] border border-[var(--border)] shrink-0"
                  >
                    {PARRY_CADENCE_OPTIONS.map((opt) => {
                      const active = state.parryCadence === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          tabIndex={-1}
                          data-testid={`training-parry-cadence-${opt.value}`}
                          aria-pressed={active}
                          onClick={() => {
                            onUpdateConfig({ parryCadence: opt.value });
                            blurActive();
                          }}
                          className={`h-7 px-2 rounded text-[11px] font-bold whitespace-nowrap cursor-pointer transition-colors ${
                            active
                              ? 'bg-[var(--foreground)] text-[var(--background)]'
                              : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    tabIndex={-1}
                    data-testid="training-trigger-volley-btn"
                    onClick={() => {
                      onTriggerVolley();
                      blurActive();
                    }}
                    className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md bg-[var(--accent)] text-white text-xs font-bold whitespace-nowrap cursor-pointer hover:opacity-90 transition-opacity"
                  >
                    <Send className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>立即发射</span>
                  </button>
                </>
              ) : (
                <>
                  {/* 假人行为：静止 / 巡逻 / 跳跃 */}
                  <div
                    role="group"
                    aria-label="假人行为"
                    className="inline-flex items-center p-0.5 rounded-md bg-[var(--surface)] border border-[var(--border)] shrink-0"
                  >
                    {DUMMY_MOTION_OPTIONS.map((opt) => {
                      const active = state.dummyMotion === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          tabIndex={-1}
                          data-testid={`training-dummy-motion-${opt.value}`}
                          aria-pressed={active}
                          onClick={() => {
                            onUpdateConfig({ dummyMotion: opt.value });
                            blurActive();
                          }}
                          className={`h-7 px-2 rounded text-[11px] font-bold whitespace-nowrap cursor-pointer transition-colors ${
                            active
                              ? 'bg-[var(--accent)] text-white'
                              : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* 0s 受伤无敌开关（连招木桩与自由沙盒可用） */}
                  <button
                    type="button"
                    tabIndex={-1}
                    data-testid="training-toggle-zero-invuln"
                    aria-pressed={state.zeroHurtInvuln}
                    onClick={() => {
                      onUpdateConfig({ zeroHurtInvuln: !state.zeroHurtInvuln });
                      blurActive();
                    }}
                    className={`inline-flex items-center gap-1 h-8 px-2 rounded-md border text-[11px] font-bold whitespace-nowrap cursor-pointer transition-colors ${
                      state.zeroHurtInvuln
                        ? 'border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-300'
                        : 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    <ShieldOff className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>0s无敌</span>
                  </button>
                </>
              )}

              {/* 无限弹药/耐久开关 */}
              <button
                type="button"
                tabIndex={-1}
                data-testid="training-toggle-infinite"
                aria-pressed={state.infiniteWeapon}
                onClick={() => {
                  onUpdateConfig({ infiniteWeapon: !state.infiniteWeapon });
                  blurActive();
                }}
                className={`inline-flex items-center gap-1 h-8 px-2 rounded-md border text-[11px] font-bold whitespace-nowrap cursor-pointer transition-colors ${
                  state.infiniteWeapon
                    ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]'
                    : 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--foreground)]'
                }`}
              >
                <InfinityIcon className="w-3.5 h-3.5" aria-hidden="true" />
                <span>无限弹药</span>
              </button>

              {/* 部位判定线开关 */}
              <button
                type="button"
                tabIndex={-1}
                data-testid="training-toggle-hitzones"
                aria-pressed={state.showHitZones}
                onClick={() => {
                  onUpdateConfig({ showHitZones: !state.showHitZones });
                  blurActive();
                }}
                className={`inline-flex items-center gap-1 h-8 px-2 rounded-md border text-[11px] font-bold whitespace-nowrap cursor-pointer transition-colors ${
                  state.showHitZones
                    ? 'border-red-500 bg-red-500/15 text-red-600 dark:text-red-300'
                    : 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--foreground)]'
                }`}
              >
                <Crosshair className="w-3.5 h-3.5" aria-hidden="true" />
                <span>部位线</span>
              </button>

              {/* 清空地面道具 */}
              <button
                type="button"
                tabIndex={-1}
                data-testid="training-clear-pickups-btn"
                title="清空场地上所有掉落道具"
                onClick={() => {
                  onClearPickups();
                  blurActive();
                }}
                className="inline-flex items-center gap-1 h-8 px-2 rounded-md border border-[var(--border)] bg-[var(--surface)] hover:border-red-500/60 text-[11px] font-semibold text-[var(--muted)] hover:text-[var(--foreground)] whitespace-nowrap cursor-pointer transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>清道具</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
