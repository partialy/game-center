import { useMemo, useState } from 'react';
import { Button, Modal } from '@heroui/react';
import {
  AlertCircle,
  Clock,
  Flame,
  MapPin,
  Package,
  RotateCcw,
  SlidersHorizontal,
  Timer,
} from 'lucide-react';
import type { RuleFieldSchema, ValidationIssue } from '../../../platform/games/contracts';
import { RuleFieldBadgeIcon } from '../../../platform/settings/ruleFieldIcons';
import {
  AppNumberStepper,
  AppSwitch,
  PillSegmentedControl,
} from '../../../platform/ui/heroUiHelpers';
import { getDefaultStickmanRules, STICKMAN_RULE_FIELDS } from '../rules';
import type {
  StickmanDropSpawnMode,
  StickmanDuelRules,
  StickPickupKind,
} from '../types';
import { STICKMAN_ITEM_ACCENTS, StickmanItemIcon } from './StickmanItemIcons';

interface StickmanItemsArmoryPanelProps {
  rules: StickmanDuelRules;
  issues: ValidationIssue[];
  onChangeRules: (next: StickmanDuelRules) => void;
}

type StickmanRuleKey = Extract<keyof StickmanDuelRules, string>;

interface StickmanArmoryItemDef {
  kind: StickPickupKind;
  name: string;
  roleLabel: string;
  enableKey: StickmanRuleKey;
  detailKeys: StickmanRuleKey[];
  summarize: (r: StickmanDuelRules) => string;
}

const STICKMAN_ARMORY_ITEMS: StickmanArmoryItemDef[] = [
  {
    kind: 'sword',
    name: '长剑',
    roleLabel: '近战大弧斩击 · 耐久制',
    enableKey: 'enableSword',
    detailKeys: ['swordDurability', 'swordDamage'],
    summarize: (r) => `${r.swordDurability} 点耐久 · ${r.swordDamage} 伤害 · 命中 -1`,
  },
  {
    kind: 'pistol',
    name: '手枪',
    roleLabel: '高速直线射击 · 精准点射',
    enableKey: 'enablePistol',
    detailKeys: ['pistolAmmo', 'pistolDamage', 'pistolSpeed'],
    summarize: (r) => `${r.pistolAmmo} 发 · ${r.pistolDamage} 伤害 · 弹速 ${r.pistolSpeed}`,
  },
  {
    kind: 'rocket',
    name: '火箭筒',
    roleLabel: '抛物线爆破 · 炸毁地形',
    enableKey: 'enableRocket',
    detailKeys: [
      'rocketAmmo',
      'rocketDamage',
      'rocketBlastRadius',
      'rocketSpeed',
      'rocketGravity',
    ],
    summarize: (r) =>
      `${r.rocketAmmo} 发 · ${r.rocketDamage} 爆伤 · 半径 ${r.rocketBlastRadius}px`,
  },
  {
    kind: 'medkit',
    name: '血包',
    roleLabel: '即时急救 · 不占武器槽',
    enableKey: 'enableMedkit',
    detailKeys: ['medkitHealPercent'],
    summarize: (r) => `立即恢复 ${r.medkitHealPercent}% 最大生命`,
  },
];

const DROP_RHYTHM_KEYS: StickmanRuleKey[] = [
  'firstDropDelaySeconds',
  'dropIntervalMinSeconds',
  'dropIntervalMaxSeconds',
  'maxDropsOnField',
];

const FIELD_META_BY_KEY = new Map<string, RuleFieldSchema>(
  STICKMAN_RULE_FIELDS.map((f) => [f.key, f])
);

const SHORT_FIELD_LABELS: Partial<Record<StickmanRuleKey, string>> = {
  firstDropDelaySeconds: '首次刷新',
  dropIntervalMinSeconds: '最小间隔',
  dropIntervalMaxSeconds: '最大间隔',
  maxDropsOnField: '同场上限',
  swordDurability: '耐久点数',
  swordDamage: '挥砍伤害',
  pistolAmmo: '备弹数量',
  pistolDamage: '单发伤害',
  pistolSpeed: '子弹速度',
  rocketAmmo: '备弹数量',
  rocketDamage: '中心伤害',
  rocketBlastRadius: '爆炸半径',
  rocketSpeed: '发射初速',
  rocketGravity: '重力下坠',
  medkitHealPercent: '回复比例',
};

const DROP_MODE_OPTIONS: Array<{ id: StickmanDropSpawnMode; label: string }> = [
  { id: 'random', label: '随机位置' },
  { id: 'center', label: '固定中间' },
];

/**
 * 火柴人决斗「武器与道具军械库」面板（与坦克大战军械库统一视觉语言）：
 * - 顶部：刷新位置分段器（随机位置 / 固定中间，均在落点上方短距落下）+ 4 项节奏步进器
 * - 下方：4 张道具卡片（长剑 / 手枪 / 火箭筒 / 血包），带定制图标、启停开关与数值摘要
 * - 点击卡片或调校按钮弹出 HeroUI Modal 精调专属参数
 */
export function StickmanItemsArmoryPanel({
  rules,
  issues,
  onChangeRules,
}: StickmanItemsArmoryPanelProps) {
  const [editingKind, setEditingKind] = useState<StickPickupKind | null>(null);

  const issuesByField = useMemo(() => {
    const map = new Map<string, ValidationIssue[]>();
    for (const iss of issues) {
      const list = map.get(iss.field) ?? [];
      list.push(iss);
      map.set(iss.field, list);
    }
    return map;
  }, [issues]);

  const enabledCount = STICKMAN_ARMORY_ITEMS.filter((item) =>
    Boolean(rules[item.enableKey])
  ).length;

  const updateField = (key: StickmanRuleKey, value: unknown) => {
    onChangeRules({
      ...rules,
      [key]: value,
    });
  };

  const handleResetRhythm = () => {
    const defaults = getDefaultStickmanRules();
    const next = { ...rules, dropSpawnMode: defaults.dropSpawnMode };
    for (const k of DROP_RHYTHM_KEYS) {
      (next as Record<string, unknown>)[k] = defaults[k];
    }
    onChangeRules(next);
  };

  const handleResetAllItems = () => {
    const defaults = getDefaultStickmanRules();
    const next = { ...rules, dropSpawnMode: defaults.dropSpawnMode };
    for (const k of DROP_RHYTHM_KEYS) {
      (next as Record<string, unknown>)[k] = defaults[k];
    }
    for (const item of STICKMAN_ARMORY_ITEMS) {
      (next as Record<string, unknown>)[item.enableKey] = defaults[item.enableKey];
      for (const dk of item.detailKeys) {
        (next as Record<string, unknown>)[dk] = defaults[dk];
      }
    }
    onChangeRules(next);
  };

  const handleResetSingleItem = (item: StickmanArmoryItemDef) => {
    const defaults = getDefaultStickmanRules();
    const next = { ...rules };
    (next as Record<string, unknown>)[item.enableKey] = defaults[item.enableKey];
    for (const dk of item.detailKeys) {
      (next as Record<string, unknown>)[dk] = defaults[dk];
    }
    onChangeRules(next);
  };

  const editingItem = editingKind
    ? STICKMAN_ARMORY_ITEMS.find((i) => i.kind === editingKind) ?? null
    : null;

  const itemScopeIssues = issues.filter((i) => {
    if (i.field === 'dropSpawnMode') return true;
    if (DROP_RHYTHM_KEYS.includes(i.field as StickmanRuleKey)) return true;
    return STICKMAN_ARMORY_ITEMS.some(
      (item) =>
        item.enableKey === i.field ||
        item.detailKeys.includes(i.field as StickmanRuleKey)
    );
  });

  const currentDropMode: StickmanDropSpawnMode =
    rules.dropSpawnMode === 'center' ? 'center' : 'random';

  return (
    <div data-testid="stickman-items-armory" className="space-y-5">
      {itemScopeIssues.length > 0 && (
        <div
          role="alert"
          className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium rounded-xl border ${
            itemScopeIssues[0].severity === 'error'
              ? 'bg-red-500/10 border-red-500/35 text-red-700 dark:text-red-300'
              : 'bg-amber-500/10 border-amber-500/35 text-amber-800 dark:text-amber-300'
          }`}
        >
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{itemScopeIssues[0].message}</span>
        </div>
      )}

      {/* 1. 顶部：刷新位置与节奏控制条 */}
      <section className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-[var(--accent)]/12 text-[var(--accent)] flex items-center justify-center shrink-0">
              <Timer className="w-4 h-4" aria-hidden="true" />
            </span>
            <h3 className="text-sm font-bold text-[var(--foreground)]">刷新位置与节奏</h3>
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

        {/* 刷新位置药丸分段器 */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--surface-secondary)]/55 border border-[var(--border)] px-3.5 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-6 h-6 rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400 inline-flex items-center justify-center shrink-0">
              <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="text-xs font-bold text-[var(--foreground)]">道具刷新位置</div>
              <div className="text-[11px] text-[var(--muted)] truncate">
                {currentDropMode === 'center'
                  ? '统一在中轴有效落点上方短距掉落'
                  : '统一在全场随机落点上方短距掉落'}
              </div>
            </div>
          </div>
          <div data-testid="stickman-drop-mode-selector">
            <PillSegmentedControl
              ariaLabel="道具刷新位置"
              selectedKey={currentDropMode}
              compact
              options={DROP_MODE_OPTIONS}
              onChange={(nextMode) => updateField('dropSpawnMode', nextMode)}
            />
          </div>
        </div>

        {/* 4 项掉落节奏步进器 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
                  <Clock
                    className="w-3.5 h-3.5 text-[var(--muted)] shrink-0 opacity-70"
                    aria-hidden="true"
                  />
                </div>
                <AppNumberStepper
                  id={`stickman-armory-${key}`}
                  ariaLabel={meta.label}
                  testId={`stickman-armory-stepper-${key}`}
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

      {/* 2. 四大武器与补给军械库卡片网格 */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-[var(--accent)]/12 text-[var(--accent)] flex items-center justify-center shrink-0">
              <Package className="w-4 h-4" aria-hidden="true" />
            </span>
            <h3 className="text-sm font-bold text-[var(--foreground)]">
              武器与补给池
              <span className="ml-2 text-xs font-mono-num font-semibold text-[var(--muted)]">
                {enabledCount} / {STICKMAN_ARMORY_ITEMS.length} 启用
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {STICKMAN_ARMORY_ITEMS.map((item) => {
            const enabled = Boolean(rules[item.enableKey]);
            const accent = STICKMAN_ITEM_ACCENTS[item.kind];
            const cardErrors = item.detailKeys
              .flatMap((dk) => issuesByField.get(dk) ?? [])
              .filter((i) => i.severity === 'error');

            return (
              <div
                key={item.kind}
                data-testid={`stickman-armory-card-${item.kind}`}
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
                  borderColor:
                    cardErrors.length > 0
                      ? '#EF4444'
                      : enabled
                      ? `${accent.border}99`
                      : undefined,
                }}
                className={`group relative overflow-hidden rounded-2xl border bg-[var(--surface)] p-4 flex flex-col justify-between gap-3.5 transition-all duration-200 cursor-pointer ${
                  enabled
                    ? 'hover:-translate-y-0.5 hover:shadow-md'
                    : 'border-[var(--border)] opacity-60 hover:opacity-85'
                }`}
              >
                {/* 顶部语义色微光氛围 */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-0 h-16 opacity-35 dark:opacity-20 transition-opacity group-hover:opacity-50"
                  style={{
                    background: `linear-gradient(180deg, ${accent.border}55 0%, transparent 100%)`,
                  }}
                />

                {/* 顶行：专属图标 + 名称定位 + 右上启停开关 */}
                <div className="relative flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border shadow-xs"
                      style={{
                        backgroundColor: accent.bg,
                        borderColor: `${accent.border}AA`,
                      }}
                    >
                      <StickmanItemIcon
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
                          <AlertCircle
                            className="w-3.5 h-3.5 text-red-500 shrink-0"
                            aria-hidden="true"
                          />
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
                      testId={`stickman-armory-enable-${item.kind}`}
                      isSelected={enabled}
                      onChange={(checked) => updateField(item.enableKey, checked)}
                    />
                  </div>
                </div>

                {/* 底行：核心数值摘要 + 调校弹窗入口 */}
                <div className="relative flex items-center justify-between gap-2 pt-2.5 border-t border-[var(--separator)]">
                  <span className="text-xs font-mono-num text-[var(--muted)] truncate">
                    {item.summarize(rules)}
                  </span>

                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid={`stickman-armory-tune-${item.kind}`}
                    onPress={() => setEditingKind(item.kind)}
                    className="h-8 px-3 !rounded-full text-[11px] font-bold shrink-0 whitespace-nowrap"
                  >
                    <SlidersHorizontal
                      className="w-3 h-3 text-[var(--accent)]"
                      aria-hidden="true"
                    />
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
              data-testid={`stickman-armory-modal-${editingItem.kind}`}
              className="bg-[var(--overlay)] text-[var(--overlay-foreground)] border border-[var(--border)] rounded-2xl p-5 shadow-2xl space-y-4 max-h-[88vh] overflow-y-auto"
            >
              {(() => {
                const accent = STICKMAN_ITEM_ACCENTS[editingItem.kind];
                const enabled = Boolean(rules[editingItem.enableKey]);
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
                            <StickmanItemIcon kind={editingItem.kind} className="w-9 h-9" />
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

                    <Modal.Body className="space-y-3">
                      <div
                        className={`grid grid-cols-1 ${
                          editingItem.detailKeys.length > 1 ? 'sm:grid-cols-2' : ''
                        } gap-3`}
                      >
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
                              <div className="flex items-center gap-2">
                                <RuleFieldBadgeIcon fieldKey={dk} disabled={!enabled} />
                                <span className="text-xs font-semibold text-[var(--foreground)]">
                                  {SHORT_FIELD_LABELS[dk] ?? meta.label}
                                </span>
                              </div>
                              <AppNumberStepper
                                id={`stickman-modal-${dk}`}
                                ariaLabel={meta.label}
                                testId={`stickman-armory-modal-stepper-${dk}`}
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
                        data-testid="stickman-armory-modal-done-btn"
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
