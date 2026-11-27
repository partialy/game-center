import { useEffect, useMemo, useState } from 'react';
import { Button, Input } from '@heroui/react';
import {
  AlertCircle,
  AlertTriangle,
  BookmarkPlus,
  Check,
  Copy,
  Crosshair,
  Dices,
  Gauge,
  Map as MapIcon,
  Package,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Trophy,
} from 'lucide-react';
import type {
  GameDefinition,
  RuleFieldSchema,
  RulePreset,
  ValidationIssue,
} from '../games/contracts';
import { generateFreshStickmanMapCode } from '../../games/stickman-duel/rules';
import { generateFreshMapCode } from '../../games/tank-battle/rules';
import {
  AppNumberStepper,
  AppSelect,
  AppSwitch,
  PillSegmentedControl,
  type SelectOptionItem,
} from '../ui/heroUiHelpers';
import { RuleFieldBadgeIcon } from './ruleFieldIcons';

export interface RulePresetsPanelProps<TRules extends Record<string, unknown>> {
  presets: RulePreset<TRules>[];
  activePresetId: string | null;
  issues: ValidationIssue[];
  onSelectPreset: (presetId: string | null) => void;
  onSaveNewPreset: (name: string) => void;
  onDeletePreset: (presetId: string) => void;
  onResetAllRules: () => void;
}

/**
 * HeroUI v3 命名规则预设工具栏（复用于赛前页与设置页「数据」分类）。
 */
export function RulePresetsPanel<TRules extends Record<string, unknown>>({
  presets,
  activePresetId,
  issues,
  onSelectPreset,
  onSaveNewPreset,
  onDeletePreset,
  onResetAllRules,
}: RulePresetsPanelProps<TRules>) {
  const [newPresetName, setNewPresetName] = useState('');
  const [presetFeedback, setPresetFeedback] = useState<string | null>(null);

  const presetOptions = useMemo<SelectOptionItem[]>(
    () => [
      { value: '__custom__', label: '当前自定义配置' },
      { value: '__default__', label: '官方默认规则' },
      ...presets.map((p) => ({ value: p.id, label: p.name })),
    ],
    [presets]
  );

  const handleCreatePreset = () => {
    const trimmed = newPresetName.trim();
    if (!trimmed) {
      setPresetFeedback('请先输入预设名称。');
      return;
    }
    const hasErrors = issues.some((i) => i.severity === 'error');
    if (hasErrors) {
      setPresetFeedback('当前规则存在错误，修正后才能保存为预设。');
      return;
    }
    onSaveNewPreset(trimmed);
    setNewPresetName('');
    setPresetFeedback(`已保存规则预设「${trimmed}」`);
    window.setTimeout(() => setPresetFeedback(null), 2600);
  };

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[180px]">
          <AppSelect
            ariaLabel="当前规则预设"
            label="规则预设"
            testId="rule-preset-select"
            value={activePresetId ?? '__custom__'}
            options={presetOptions}
            onChange={(val) => {
              if (val === '__default__') {
                onResetAllRules();
                onSelectPreset(null);
              } else if (val !== '__custom__') {
                onSelectPreset(val);
              }
            }}
          />
        </div>

        <Button
          variant="secondary"
          size="sm"
          onPress={() => {
            onResetAllRules();
            setPresetFeedback('已恢复默认规则');
            window.setTimeout(() => setPresetFeedback(null), 2000);
          }}
          className="h-[38px] max-sm:h-[44px] px-3.5 !rounded-full whitespace-nowrap shrink-0 font-semibold"
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          重置默认
        </Button>

        {activePresetId && (
          <Button
            variant="danger-soft"
            size="sm"
            isIconOnly
            aria-label="删除当前预设"
            onPress={() => onDeletePreset(activePresetId)}
            className="!w-[38px] !h-[38px] max-sm:!w-[44px] max-sm:!h-[44px] !min-w-[38px] !p-0 !rounded-full shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="text"
          maxLength={24}
          value={newPresetName}
          placeholder="输入新预设名称…"
          aria-label="新预设名称"
          onChange={(e) => setNewPresetName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCreatePreset();
          }}
          className="flex-1 min-w-[160px] h-[38px] max-sm:h-[44px] px-3.5 text-xs bg-[var(--field-background)] text-[var(--field-foreground)] border border-[var(--field-border)] rounded-full"
        />
        <Button
          variant="primary"
          size="sm"
          onPress={handleCreatePreset}
          className="h-[38px] max-sm:h-[44px] px-4 !rounded-full whitespace-nowrap shrink-0 font-bold accent-solid-btn"
        >
          <BookmarkPlus className="w-3.5 h-3.5" aria-hidden="true" />
          保存预设
        </Button>
      </div>

      {presetFeedback && (
        <p className="text-xs font-medium text-[var(--accent)]" role="status">
          {presetFeedback}
        </p>
      )}
    </div>
  );
}

interface RulesFormProps<TRules extends Record<string, unknown>> {
  game: GameDefinition<TRules, unknown>;
  rules: TRules;
  presets: RulePreset<TRules>[];
  activePresetId: string | null;
  issues: ValidationIssue[];
  onChangeRules: (next: TRules) => void;
  onSelectPreset: (presetId: string | null) => void;
  onSaveNewPreset: (name: string) => void;
  onDeletePreset: (presetId: string) => void;
  onResetAllRules: () => void;
  onResetGroupRules: (groupId: string) => void;
  filterGroupIds?: string[];
  excludeFieldKeys?: string[];
  hideHeader?: boolean;
  hidePresetBar?: boolean;
  /** 宽屏每行列数（设置中心常用 3 列，赛前右侧窄栏用 2 列） */
  columns?: 2 | 3;
}

function getGroupIcon(groupId: string) {
  switch (groupId) {
    case 'match':
      return Trophy;
    case 'map':
      return MapIcon;
    case 'combat':
      return Crosshair;
    case 'advanced':
      return Gauge;
    case 'drops':
    case 'items':
      return Package;
    case 'special':
      return Sparkles;
    default:
      return SlidersHorizontal;
  }
}

/**
 * 游戏 App 风格通用规则编辑器：
 * - 数字输入全部升级为圆形 −/+ 步进器，兼顾手机点按与桌面键入
 * - 分组切换与 2～3 项短选单统一采用药丸分段器
 * - 去除冗余描述与多余副文案，保留清晰图标、数值与校验反馈
 */
export function RulesForm<TRules extends Record<string, unknown>>({
  game,
  rules,
  presets,
  activePresetId,
  issues,
  onChangeRules,
  onSelectPreset,
  onSaveNewPreset,
  onDeletePreset,
  onResetAllRules,
  onResetGroupRules,
  filterGroupIds,
  excludeFieldKeys,
  hideHeader = false,
  hidePresetBar = false,
  columns = 2,
}: RulesFormProps<TRules>) {
  const excludedSet = useMemo(() => new Set(excludeFieldKeys ?? []), [excludeFieldKeys]);

  const availableGroups = useMemo(() => {
    if (!filterGroupIds || filterGroupIds.length === 0) {
      return game.ruleGroups;
    }
    const allow = new Set(filterGroupIds);
    return game.ruleGroups.filter((g) => allow.has(g.id));
  }, [filterGroupIds, game.ruleGroups]);

  const [selectedGroupId, setSelectedGroupId] = useState<string>(
    availableGroups[0]?.id ?? game.ruleGroups[0]?.id ?? 'match'
  );
  const [copiedMapCode, setCopiedMapCode] = useState(false);

  useEffect(() => {
    if (availableGroups.length > 0 && !availableGroups.some((g) => g.id === selectedGroupId)) {
      setSelectedGroupId(availableGroups[0].id);
    }
  }, [availableGroups, selectedGroupId]);

  const issuesByField = useMemo(() => {
    const map = new Map<string, ValidationIssue[]>();
    for (const issue of issues) {
      const list = map.get(issue.field) ?? [];
      list.push(issue);
      map.set(issue.field, list);
    }
    return map;
  }, [issues]);

  const errorCountByGroup = useMemo(() => {
    const fieldToGroup = new Map(game.ruleFields.map((f) => [f.key, f.group]));
    const counts = new Map<string, number>();
    for (const issue of issues) {
      if (issue.severity !== 'error') continue;
      if (excludedSet.has(issue.field)) continue;
      const g = fieldToGroup.get(issue.field);
      if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    return counts;
  }, [excludedSet, game.ruleFields, issues]);

  const scopedFieldKeys = useMemo(() => {
    const allowGroups = new Set(availableGroups.map((g) => g.id));
    return new Set(
      game.ruleFields
        .filter((f) => allowGroups.has(f.group) && !excludedSet.has(f.key))
        .map((f) => f.key)
    );
  }, [availableGroups, excludedSet, game.ruleFields]);

  const scopedIssues = useMemo(
    () => issues.filter((i) => scopedFieldKeys.has(i.field)),
    [issues, scopedFieldKeys]
  );

  const currentGroup =
    availableGroups.find((g) => g.id === selectedGroupId) ?? availableGroups[0];
  const visibleFields = game.ruleFields.filter(
    (f) =>
      f.group === currentGroup?.id &&
      !excludedSet.has(f.key) &&
      !f.isHidden?.(rules)
  );

  const handleFieldUpdate = (field: RuleFieldSchema, rawVal: unknown) => {
    const next = game.onRuleFieldChange
      ? game.onRuleFieldChange(rules, field.key, rawVal)
      : ({ ...rules, [field.key]: rawVal } as TRules);
    onChangeRules(next);
  };

  const handleCopyMapCode = () => {
    const code = String(rules.mapCode ?? '').trim();
    if (!code) return;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(code).catch(() => {});
    }
    setCopiedMapCode(true);
    window.setTimeout(() => setCopiedMapCode(false), 1800);
  };

  const handleRerollMapCode = () => {
    if (game.id === 'stickman-duel') {
      const tpl = String(rules.mapTemplate ?? 'random') as
        | 'random'
        | 'twin_towers'
        | 'stepped_ruins'
        | 'sky_platforms'
        | 'fortress_bunkers';
      const fresh = generateFreshStickmanMapCode(tpl);
      onChangeRules({ ...rules, mapCode: fresh } as TRules);
      return;
    }
    const cols = Number(rules.gridCols ?? 10);
    const rows = Number(rules.gridRows ?? 7);
    const extra = Number(rules.extraPassages ?? 8);
    const fresh = generateFreshMapCode(cols, rows, extra);
    onChangeRules({ ...rules, mapCode: fresh } as TRules);
  };

  const errorCount = scopedIssues.filter((i) => i.severity === 'error').length;
  const warningCount = scopedIssues.filter((i) => i.severity === 'warning').length;
  const GroupIcon = currentGroup ? getGroupIcon(currentGroup.id) : SlidersHorizontal;
  const gridColsClass =
    columns === 3
      ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
      : 'grid-cols-1 sm:grid-cols-2';
  const fullWidthSpanClass = columns === 3 ? 'sm:col-span-2 lg:col-span-3' : 'sm:col-span-2';

  return (
    <section aria-label="对局规则与预设" className="space-y-3.5">
      {!hideHeader && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold tracking-tight text-[var(--foreground)]">
            对局规则
          </h2>
          {hidePresetBar && (
            <Button
              variant="secondary"
              size="sm"
              onPress={onResetAllRules}
              className="h-8 px-3 !rounded-full whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              恢复默认
            </Button>
          )}
        </div>
      )}

      {!hidePresetBar && (
        <RulePresetsPanel
          presets={presets}
          activePresetId={activePresetId}
          issues={issues}
          onSelectPreset={onSelectPreset}
          onSaveNewPreset={onSaveNewPreset}
          onDeletePreset={onDeletePreset}
          onResetAllRules={onResetAllRules}
        />
      )}

      {/* 校验摘要（仅出错或警告时出现） */}
      {(errorCount > 0 || warningCount > 0) && (
        <div
          role={errorCount > 0 ? 'alert' : 'status'}
          className={`flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-xl border ${
            errorCount > 0
              ? 'bg-red-500/10 border-red-500/35 text-red-700 dark:text-red-300'
              : 'bg-amber-500/12 border-amber-500/35 text-amber-800 dark:text-amber-300'
          }`}
        >
          {errorCount > 0 ? (
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          )}
          <span>
            {errorCount > 0
              ? `存在 ${errorCount} 项参数错误，修正后方可开战`
              : `存在 ${warningCount} 项参数提醒`}
          </span>
        </div>
      )}

      {/* 药丸形态分组切换器 */}
      {availableGroups.length > 1 && currentGroup && (
        <PillSegmentedControl
          ariaLabel="规则分组"
          selectedKey={currentGroup.id}
          onChange={setSelectedGroupId}
          options={availableGroups.map((group) => {
            const groupErrors = errorCountByGroup.get(group.id) ?? 0;
            const Icon = getGroupIcon(group.id);
            return {
              id: group.id,
              label: group.title,
              icon: <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
              testId: `rules-group-tab-${group.id}`,
              badge:
                groupErrors > 0 ? (
                  <span className="text-red-600 dark:text-red-400 font-mono-num font-bold">
                    ({groupErrors})
                  </span>
                ) : undefined,
            };
          })}
        />
      )}

      {/* 当前分组字段面板 */}
      {currentGroup && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 space-y-3.5">
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-[var(--separator)]">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-7 h-7 rounded-lg bg-[var(--accent)]/12 text-[var(--accent)] flex items-center justify-center shrink-0">
                <GroupIcon className="w-4 h-4" aria-hidden="true" />
              </span>
              <h3 className="text-sm font-bold text-[var(--foreground)] truncate">
                {currentGroup.title}
              </h3>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onPress={() => onResetGroupRules(currentGroup.id)}
              className="h-8 px-3 !rounded-full text-xs font-semibold whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              恢复默认
            </Button>
          </div>

          <div className={`grid ${gridColsClass} gap-3`}>
            {visibleFields.map((field) => {
              const fieldIssues = issuesByField.get(field.key) ?? [];
              const hasError = fieldIssues.some((i) => i.severity === 'error');
              const disabled = Boolean(field.isDisabled?.(rules));
              const value = rules[field.key];
              const isFullWidth = field.key === 'mapCode' || field.key === 'controlMode';
              const usePillSelect =
                field.type === 'select' &&
                (field.options?.length ?? 0) >= 2 &&
                (field.options?.length ?? 0) <= 3 &&
                (field.options ?? []).every((opt) => opt.label.length <= 10);

              return (
                <div
                  key={field.key}
                  className={`${
                    isFullWidth ? fullWidthSpanClass : ''
                  } rounded-xl bg-[var(--surface-secondary)]/50 border border-[var(--border)] px-3 py-2.5 flex flex-col justify-center gap-2`}
                >
                  {field.type === 'boolean' ? (
                    <div className="flex items-center justify-between gap-3 min-h-[38px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <RuleFieldBadgeIcon fieldKey={field.key} disabled={disabled} />
                        <span className="text-xs font-semibold text-[var(--foreground)] truncate">
                          {field.label}
                        </span>
                      </div>
                      <AppSwitch
                        ariaLabel={field.label}
                        isSelected={Boolean(value)}
                        isDisabled={disabled}
                        onChange={(checked) => handleFieldUpdate(field, checked)}
                      />
                    </div>
                  ) : usePillSelect ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <RuleFieldBadgeIcon fieldKey={field.key} disabled={disabled} />
                        <span className="text-xs font-semibold text-[var(--foreground)] truncate">
                          {field.label}
                        </span>
                      </div>
                      <PillSegmentedControl
                        ariaLabel={field.label}
                        compact
                        selectedKey={String(value ?? '')}
                        onChange={(val) => handleFieldUpdate(field, val)}
                        options={(field.options ?? []).map((opt) => ({
                          id: opt.value,
                          label: opt.label.replace('每回合随机出生点', '随机出生'),
                        }))}
                      />
                    </div>
                  ) : field.type === 'select' ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <RuleFieldBadgeIcon fieldKey={field.key} disabled={disabled} />
                        <span className="text-xs font-semibold text-[var(--foreground)] truncate">
                          {field.label}
                        </span>
                      </div>
                      <AppSelect
                        ariaLabel={field.label}
                        testId={`rule-select-${field.key}`}
                        value={String(value ?? '')}
                        isDisabled={disabled}
                        options={(field.options ?? []).map((opt) => ({
                          value: opt.value,
                          label: opt.label,
                        }))}
                        onChange={(val) => handleFieldUpdate(field, val)}
                      />
                    </div>
                  ) : field.type === 'string' ? (
                    <>
                      <label
                        htmlFor={`rule-${field.key}`}
                        className="flex items-center gap-2 text-xs font-semibold text-[var(--foreground)]"
                      >
                        <RuleFieldBadgeIcon fieldKey={field.key} disabled={disabled} />
                        <span className="truncate">{field.label}</span>
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          id={`rule-${field.key}`}
                          type="text"
                          value={String(value ?? '')}
                          disabled={disabled}
                          placeholder="留空自动生成随机地图"
                          onChange={(e) => handleFieldUpdate(field, e.target.value)}
                          className={`flex-1 min-w-[180px] h-9 max-sm:h-11 px-3.5 text-xs font-mono-num bg-[var(--field-background)] text-[var(--field-foreground)] border rounded-full ${
                            hasError
                              ? 'border-red-500'
                              : 'border-[var(--field-border)]'
                          }`}
                        />
                        {field.key === 'mapCode' && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Button
                              variant="secondary"
                              size="sm"
                              onPress={handleRerollMapCode}
                              className="h-9 max-sm:h-11 px-3.5 !rounded-full whitespace-nowrap font-semibold"
                            >
                              <Dices className="w-3.5 h-3.5 text-[var(--accent)]" aria-hidden="true" />
                              随机
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              isDisabled={!String(value ?? '').trim()}
                              onPress={handleCopyMapCode}
                              className="h-9 max-sm:h-11 px-3.5 !rounded-full whitespace-nowrap font-semibold"
                            >
                              {copiedMapCode ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                              )}
                              {copiedMapCode ? '已复制' : '复制'}
                            </Button>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <label
                        htmlFor={`rule-${field.key}`}
                        className={`flex items-center gap-2 text-xs font-semibold min-w-0 ${
                          disabled ? 'text-[var(--muted)] opacity-60' : 'text-[var(--foreground)]'
                        }`}
                      >
                        <RuleFieldBadgeIcon fieldKey={field.key} disabled={disabled} />
                        <span className="truncate">{field.label}</span>
                      </label>
                      <AppNumberStepper
                        id={`rule-${field.key}`}
                        ariaLabel={field.label}
                        testId={`rule-stepper-${field.key}`}
                        value={typeof value === 'number' ? value : Number.NaN}
                        min={field.min}
                        max={field.max}
                        step={field.step ?? (field.type === 'integer' ? 1 : 0.1)}
                        integer={field.type === 'integer'}
                        unit={field.unit}
                        isDisabled={disabled}
                        hasError={hasError}
                        onChange={(next) => handleFieldUpdate(field, next)}
                      />
                    </>
                  )}

                  {fieldIssues.map((iss, idx) => (
                    <p
                      key={idx}
                      className={`text-[11px] font-medium leading-snug ${
                        iss.severity === 'error'
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {iss.message}
                    </p>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
