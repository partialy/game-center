import { useMemo, useState } from 'react';
import { Button, Modal } from '@heroui/react';
import {
  AlertCircle,
  Clock,
  Flame,
  Package,
  RotateCcw,
  SlidersHorizontal,
  Timer,
} from 'lucide-react';
import type { RuleFieldSchema, ValidationIssue } from '../../../platform/games/contracts';
import { AppNumberStepper, AppSwitch } from '../../../platform/ui/heroUiHelpers';
import { getDefaultTankRules, TANK_RULE_FIELDS } from '../rules';
import type { ItemKind, TankBattleRules } from '../types';
import { ITEM_ACCENT_COLORS, TankItemIcon } from './itemIcons';

interface TankItemsArmoryPanelProps {
  rules: TankBattleRules;
  issues: ValidationIssue[];
  onChangeRules: (next: TankBattleRules) => void;
}

interface ArmoryItemDef {
  kind: ItemKind;
  name: string;
  roleLabel: string;
  enableKey: keyof TankBattleRules;
  weightKey: keyof TankBattleRules;
  detailKeys: (keyof TankBattleRules)[];
  summarize: (r: TankBattleRules) => string;
}

const ARMORY_ITEMS: ArmoryItemDef[] = [
  {
    kind: 'shield',
    name: '能量护盾',
    roleLabel: '防护 · 抵挡一击',
    enableKey: 'enableShield',
    weightKey: 'weightShield',
    detailKeys: ['shieldDurationSeconds', 'shieldBreakGraceSeconds'],
    summarize: (r) => `持续 ${r.shieldDurationSeconds}s · 破盾无敌 ${r.shieldBreakGraceSeconds}s`,
  },
  {
    kind: 'rapid_fire',
    name: '高速连发',
    roleLabel: '持续火力 · 压制',
    enableKey: 'enableRapidFire',
    weightKey: 'weightRapidFire',
    detailKeys: ['rapidFireCooldownSeconds', 'rapidFireMaxShots', 'rapidFireDurationSeconds'],
    summarize: (r) => `${r.rapidFireCooldownSeconds}s/发 · 上限 ${r.rapidFireMaxShots} 发`,
  },
  {
    kind: 'shotgun',
    name: '三连散弹',
    roleLabel: '扇形散射 · 近战',
    enableKey: 'enableShotgun',
    weightKey: 'weightShotgun',
    detailKeys: [
      'shotgunPellets',
      'shotgunSpreadAngleDeg',
      'shotgunDurationSeconds',
      'shotgunAmmoCost',
      'shotgunBulletLifetimeSeconds',
    ],
    summarize: (r) => `${r.shotgunPellets} 颗 · ${r.shotgunSpreadAngleDeg}° · ${r.shotgunDurationSeconds}s`,
  },
  {
    kind: 'laser',
    name: '折射激光',
    roleLabel: '瞬发穿透 · 反射',
    enableKey: 'enableLaser',
    weightKey: 'weightLaser',
    detailKeys: ['laserMaxBounces', 'singleUseHoldLimitSeconds'],
    summarize: (r) => `最多反射 ${r.laserMaxBounces} 次 · 待用 ${r.singleUseHoldLimitSeconds}s`,
  },
  {
    kind: 'homing',
    name: '追踪导弹',
    roleLabel: '自动锁敌 · 绕墙',
    enableKey: 'enableHoming',
    weightKey: 'weightHoming',
    detailKeys: ['homingLifetimeSeconds', 'homingBulletSpeed', 'homingTurnRateDeg'],
    summarize: (r) => `飞行 ${r.homingLifetimeSeconds}s · 速度 ${r.homingBulletSpeed}`,
  },
  {
    kind: 'frag',
    name: '破片榴弹',
    roleLabel: '延迟爆裂 · 碎片',
    enableKey: 'enableFrag',
    weightKey: 'weightFrag',
    detailKeys: ['fragDetonateDelaySeconds', 'fragShardCount', 'fragShardLifetimeSeconds'],
    summarize: (r) => `${r.fragDetonateDelaySeconds}s 引爆 · ${r.fragShardCount} 枚碎片`,
  },
  {
    kind: 'mine',
    name: '感应地雷',
    roleLabel: '隐蔽布防 · 范围',
    enableKey: 'enableMine',
    weightKey: 'weightMine',
    detailKeys: ['mineArmDelaySeconds', 'mineTriggerRadius', 'mineBlastRadius'],
    summarize: (r) => `${r.mineArmDelaySeconds}s 布防 · 伤害半径 ${r.mineBlastRadius}`,
  },
];

const DROP_RHYTHM_KEYS: (keyof TankBattleRules)[] = [
  'firstDropDelaySeconds',
  'dropIntervalMinSeconds',
  'dropIntervalMaxSeconds',
  'maxDropsOnField',
  'dropLifetimeSeconds',
  'singleUseHoldLimitSeconds',
];

const FIELD_META_BY_KEY = new Map<string, RuleFieldSchema>(
  TANK_RULE_FIELDS.map((f) => [f.key, f])
);

/**
 * 坦克大战「道具军械库」面板：
 * - 顶部紧凑刷新节奏条（圆形 +- 步进器）
 * - 下方 7 张复用战场 WebP 图标的战术道具卡片（启停开关 + 权重步进 + 核心数值预览）
 * - 点击卡片或调校按钮打开 HeroUI Modal 精调该道具的全部专属数值
 */
export function TankItemsArmoryPanel({
  rules,
  issues,
  onChangeRules,
}: TankItemsArmoryPanelProps) {
  const [editingKind, setEditingKind] = useState<ItemKind | null>(null);

  const issuesByField = useMemo(() => {
    const map = new Map<string, ValidationIssue[]>();
    for (const iss of issues) {
      const list = map.get(iss.field) ?? [];
      list.push(iss);
      map.set(iss.field, list);
    }
    return map;
  }, [issues]);

  const enabledCount = ARMORY_ITEMS.filter((item) => Boolean(rules[item.enableKey])).length;

  const updateField = (key: keyof TankBattleRules, value: unknown) => {
    onChangeRules({
      ...rules,
      [key]: value,
    });
  };

  const handleResetRhythm = () => {
    const defaults = getDefaultTankRules();
    const next = { ...rules };
    for (const k of DROP_RHYTHM_KEYS) {
      (next as Record<string, unknown>)[k] = defaults[k];
    }
    onChangeRules(next);
  };

  const handleResetAllItems = () => {
    const defaults = getDefaultTankRules();
    const next = { ...rules };
    for (const k of DROP_RHYTHM_KEYS) {
      (next as Record<string, unknown>)[k] = defaults[k];
    }
    for (const item of ARMORY_ITEMS) {
      (next as Record<string, unknown>)[item.enableKey] = defaults[item.enableKey];
      (next as Record<string, unknown>)[item.weightKey] = defaults[item.weightKey];
      for (const dk of item.detailKeys) {
        (next as Record<string, unknown>)[dk] = defaults[dk];
      }
    }
    onChangeRules(next);
  };

  const handleResetSingleItem = (item: ArmoryItemDef) => {
    const defaults = getDefaultTankRules();
    const next = { ...rules };
    (next as Record<string, unknown>)[item.enableKey] = defaults[item.enableKey];
    (next as Record<string, unknown>)[item.weightKey] = defaults[item.weightKey];
    for (const dk of item.detailKeys) {
      (next as Record<string, unknown>)[dk] = defaults[dk];
    }
    onChangeRules(next);
  };

  const editingItem = editingKind
    ? ARMORY_ITEMS.find((i) => i.kind === editingKind) ?? null
    : null;

  const itemScopeIssues = issues.filter((i) => {
    if (DROP_RHYTHM_KEYS.includes(i.field as keyof TankBattleRules)) return true;
    return ARMORY_ITEMS.some(
      (item) =>
        item.enableKey === i.field ||
        item.weightKey === i.field ||
        item.detailKeys.includes(i.field as keyof TankBattleRules)
    );
  });

  return (
    <div data-testid="tank-items-armory" className="space-y-5">
      {itemScopeIssues.length > 0 && (
        <div
          role="alert"
          className="flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium rounded-xl bg-red-500/10 border border-red-500/35 text-red-700 dark:text-red-300"
        >
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{itemScopeIssues[0].message}</span>
        </div>
      )}

      {/* 1. 顶部掉落刷新节奏条 */}
      <section className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 space-y-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-[var(--accent)]/12 text-[var(--accent)] flex items-center justify-center shrink-0">
              <Timer className="w-4 h-4" aria-hidden="true" />
            </span>
            <h3 className="text-sm font-bold text-[var(--foreground)]">刷新节奏与场控</h3>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onPress={handleResetRhythm}
            className="h-8 px-3 !rounded-full text-xs font-semibold"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            恢复默认
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {DROP_RHYTHM_KEYS.map((key) => {
            const meta = FIELD_META_BY_KEY.get(key);
            if (!meta) return null;
            const fieldIssues = issuesByField.get(key) ?? [];
            const hasError = fieldIssues.some((i) => i.severity === 'error');
            const val = Number(rules[key]);
            return (
              <div
                key={key}
                className="rounded-xl bg-[var(--surface-secondary)]/55 border border-[var(--border)] px-3 py-2.5 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[var(--foreground)] truncate">
                    {SHORT_FIELD_LABELS[key] ?? meta.label}
                  </span>
                  <Clock className="w-3.5 h-3.5 text-[var(--muted)] shrink-0 opacity-70" aria-hidden="true" />
                </div>
                <AppNumberStepper
                  id={`armory-${key}`}
                  ariaLabel={meta.label}
                  testId={`armory-stepper-${key}`}
                  value={val}
                  min={meta.min}
                  max={meta.max}
                  step={meta.step ?? (meta.type === 'integer' ? 1 : 0.5)}
                  integer={meta.type === 'integer'}
                  unit={meta.unit}
                  hasError={hasError}
                  size="sm"
                  onChange={(next) => updateField(key, next)}
                />
                {fieldIssues[0] && (
                  <p className="text-[11px] font-medium text-red-600 dark:text-red-400">
                    {fieldIssues[0].message}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 2. 七大战术道具军械库卡片网格 */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-[var(--accent)]/12 text-[var(--accent)] flex items-center justify-center shrink-0">
              <Package className="w-4 h-4" aria-hidden="true" />
            </span>
            <h3 className="text-sm font-bold text-[var(--foreground)]">
              战术道具池
              <span className="ml-2 text-xs font-mono-num font-semibold text-[var(--muted)]">
                {enabledCount} / {ARMORY_ITEMS.length} 启用
              </span>
            </h3>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onPress={handleResetAllItems}
            className="h-8 px-3 !rounded-full text-xs font-semibold"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            重置全部道具
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {ARMORY_ITEMS.map((item) => {
            const enabled = Boolean(rules[item.enableKey]);
            const weight = Number(rules[item.weightKey]);
            const accent = ITEM_ACCENT_COLORS[item.kind];
            const cardErrors = [
              ...(issuesByField.get(item.weightKey) ?? []),
              ...item.detailKeys.flatMap((dk) => issuesByField.get(dk) ?? []),
            ].filter((i) => i.severity === 'error');

            return (
              <div
                key={item.kind}
                data-testid={`armory-item-card-${item.kind}`}
                role="button"
                tabIndex={0}
                onClick={() => setEditingKind(item.kind)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setEditingKind(item.kind);
                  }
                }}
                style={{
                  borderColor: cardErrors.length > 0
                    ? '#EF4444'
                    : enabled
                    ? `${accent.border}99`
                    : undefined,
                }}
                className={`group relative overflow-hidden rounded-2xl border bg-[var(--surface)] p-3.5 flex flex-col justify-between gap-3 transition-all duration-200 cursor-pointer ${
                  enabled
                    ? 'hover:-translate-y-0.5 hover:shadow-md'
                    : 'border-[var(--border)] opacity-60 hover:opacity-85'
                }`}
              >
                {/* 顶部专属色微光氛围 */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-0 h-16 opacity-35 dark:opacity-20 transition-opacity group-hover:opacity-50"
                  style={{
                    background: `linear-gradient(180deg, ${accent.border}55 0%, transparent 100%)`,
                  }}
                />

                {/* 卡片顶行：战场高清 WebP 图标 + 名称定位 + 右上启停开关 */}
                <div className="relative flex items-start justify-between gap-2.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border shadow-xs"
                      style={{
                        backgroundColor: accent.bg,
                        borderColor: `${accent.border}AA`,
                      }}
                    >
                      <TankItemIcon
                        kind={item.kind}
                        className={`w-9 h-9 transition-transform duration-200 group-hover:scale-110 ${
                          enabled ? '' : 'grayscale'
                        }`}
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-extrabold text-[var(--foreground)] truncate">
                          {item.name}
                        </span>
                        {cardErrors.length > 0 && (
                          <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" aria-hidden="true" />
                        )}
                      </div>
                      <div
                        className="text-[11px] font-semibold truncate mt-0.5"
                        style={{ color: enabled ? accent.fg : 'var(--muted)' }}
                      >
                        {item.roleLabel}
                      </div>
                    </div>
                  </div>

                  <div
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    className="shrink-0"
                  >
                    <AppSwitch
                      ariaLabel={`启用 ${item.name}`}
                      testId={`armory-enable-${item.kind}`}
                      isSelected={enabled}
                      onChange={(checked) => updateField(item.enableKey, checked)}
                    />
                  </div>
                </div>

                {/* 关键参数实况摘要（极简无胶囊文本） */}
                <div className="relative text-[11px] font-mono-num text-[var(--muted)] truncate">
                  {item.summarize(rules)}
                </div>

                {/* 底行：权重圆形步进器 + 调校按钮 */}
                <div className="relative flex items-center justify-between gap-2 pt-2 border-t border-[var(--separator)]">
                  <div
                    className="flex items-center gap-1.5 flex-1 min-w-0"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <span className="text-[11px] font-semibold text-[var(--muted)] whitespace-nowrap shrink-0">
                      权重
                    </span>
                    <div className="flex-1 max-w-[138px]">
                      <AppNumberStepper
                        ariaLabel={`${item.name} 掉落权重`}
                        testId={`armory-weight-${item.kind}`}
                        value={weight}
                        min={0}
                        max={20}
                        step={0.5}
                        size="sm"
                        isDisabled={!enabled}
                        onChange={(next) => updateField(item.weightKey, next)}
                      />
                    </div>
                  </div>

                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid={`armory-tune-${item.kind}`}
                    onPress={() => setEditingKind(item.kind)}
                    className="h-8 px-2.5 !rounded-full text-[11px] font-bold shrink-0 whitespace-nowrap"
                  >
                    <SlidersHorizontal className="w-3 h-3 text-[var(--accent)]" aria-hidden="true" />
                    调校
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 3. 点击卡片弹出的专属道具参数调校 Modal */}
      <Modal.Backdrop
        isOpen={editingItem !== null}
        onOpenChange={(open) => {
          if (!open) setEditingKind(null);
        }}
        variant="opaque"
      >
        <Modal.Container placement="center" size="md">
          {editingItem && (
            <Modal.Dialog
              data-testid={`armory-modal-${editingItem.kind}`}
              className="bg-[var(--overlay)] text-[var(--overlay-foreground)] border border-[var(--border)] rounded-2xl p-5 shadow-2xl space-y-4 max-h-[88vh] overflow-y-auto"
            >
              {(() => {
                const accent = ITEM_ACCENT_COLORS[editingItem.kind];
                const enabled = Boolean(rules[editingItem.enableKey]);
                const weight = Number(rules[editingItem.weightKey]);
                return (
                  <>
                    <Modal.Header className="!flex !flex-row !items-center !justify-between gap-3 pb-3 border-b border-[var(--separator)]">
                      <div className="w-full flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border shadow-xs"
                            style={{
                              backgroundColor: accent.bg,
                              borderColor: `${accent.border}CC`,
                            }}
                          >
                            <TankItemIcon kind={editingItem.kind} className="w-9 h-9" />
                          </div>
                          <div className="min-w-0 text-left">
                            <Modal.Heading className="font-display text-base font-extrabold text-[var(--foreground)] truncate">
                              {editingItem.name}
                            </Modal.Heading>
                            <div
                              className="text-xs font-semibold flex items-center gap-1 mt-0.5"
                              style={{ color: accent.fg }}
                            >
                              <Flame className="w-3 h-3 shrink-0" aria-hidden="true" />
                              <span>{editingItem.roleLabel}</span>
                            </div>
                          </div>
                        </div>

                        <AppSwitch
                          ariaLabel={`启用 ${editingItem.name}`}
                          isSelected={enabled}
                          onChange={(checked) => updateField(editingItem.enableKey, checked)}
                        />
                      </div>
                    </Modal.Header>

                    <Modal.Body className="space-y-4">
                      {/* 权重行 */}
                      <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--surface-secondary)]/65 border border-[var(--border)] px-3.5 py-2.5">
                        <span className="text-xs font-bold text-[var(--foreground)]">
                          掉落权重
                        </span>
                        <div className="w-40">
                          <AppNumberStepper
                            ariaLabel={`${editingItem.name} 掉落权重`}
                            value={weight}
                            min={0}
                            max={20}
                            step={0.5}
                            isDisabled={!enabled}
                            onChange={(next) => updateField(editingItem.weightKey, next)}
                          />
                        </div>
                      </div>

                      {/* 道具专属数值网格 */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {editingItem.detailKeys.map((dk) => {
                          const meta = FIELD_META_BY_KEY.get(dk);
                          if (!meta) return null;
                          const fieldIssues = issuesByField.get(dk) ?? [];
                          const hasError = fieldIssues.some((i) => i.severity === 'error');
                          const val = Number(rules[dk]);
                          return (
                            <div
                              key={dk}
                              className="rounded-xl bg-[var(--surface-secondary)]/50 border border-[var(--border)] px-3 py-2.5 space-y-2"
                            >
                              <div className="text-xs font-semibold text-[var(--foreground)]">
                                {SHORT_FIELD_LABELS[dk] ?? meta.label}
                              </div>
                              <AppNumberStepper
                                id={`modal-${dk}`}
                                ariaLabel={meta.label}
                                testId={`armory-modal-stepper-${dk}`}
                                value={val}
                                min={meta.min}
                                max={meta.max}
                                step={meta.step ?? (meta.type === 'integer' ? 1 : 0.1)}
                                integer={meta.type === 'integer'}
                                unit={meta.unit}
                                hasError={hasError}
                                onChange={(next) => updateField(dk, next)}
                              />
                              {fieldIssues[0] && (
                                <p className="text-[11px] font-medium text-red-600 dark:text-red-400">
                                  {fieldIssues[0].message}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </Modal.Body>

                    <Modal.Footer className="flex items-center justify-between gap-2 pt-3 border-t border-[var(--separator)]">
                      <Button
                        variant="ghost"
                        size="sm"
                        onPress={() => handleResetSingleItem(editingItem)}
                        className="h-9 px-3 !rounded-full text-xs font-semibold"
                      >
                        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                        恢复本道具默认
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        data-testid="armory-modal-done-btn"
                        onPress={() => setEditingKind(null)}
                        className="h-9 px-5 !rounded-full font-bold accent-solid-btn"
                      >
                        完成
                      </Button>
                    </Modal.Footer>
                  </>
                );
              })()}
            </Modal.Dialog>
          )}
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}

const SHORT_FIELD_LABELS: Partial<Record<keyof TankBattleRules, string>> = {
  firstDropDelaySeconds: '首次刷新',
  dropIntervalMinSeconds: '最小刷新间隔',
  dropIntervalMaxSeconds: '最大刷新间隔',
  maxDropsOnField: '同场上限',
  dropLifetimeSeconds: '留场时长',
  singleUseHoldLimitSeconds: '特武待用时限',
  shieldDurationSeconds: '护盾持续',
  shieldBreakGraceSeconds: '破盾无敌',
  rapidFireCooldownSeconds: '连发射击间隔',
  rapidFireMaxShots: '连发上限',
  rapidFireDurationSeconds: '连发持续',
  shotgunPellets: '单次弹丸数',
  shotgunSpreadAngleDeg: '散射张角',
  shotgunDurationSeconds: '持续时长',
  shotgunAmmoCost: '单次耗弹',
  shotgunBulletLifetimeSeconds: '散弹寿命',
  laserMaxBounces: '最大反射次数',
  homingLifetimeSeconds: '最长飞行时间',
  homingBulletSpeed: '飞行速度',
  homingTurnRateDeg: '转向上限',
  fragDetonateDelaySeconds: '引爆延迟',
  fragShardCount: '分裂碎片数',
  fragShardLifetimeSeconds: '碎片持续',
  mineArmDelaySeconds: '布防延迟',
  mineTriggerRadius: '触发半径',
  mineBlastRadius: '伤害半径',
};
