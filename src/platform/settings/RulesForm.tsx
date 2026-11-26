import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Tabs } from '@heroui/react';
import {
  AlertCircle,
  AlertTriangle,
  BookmarkPlus,
  Check,
  Copy,
  Dices,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import type {
  GameDefinition,
  RuleFieldSchema,
  RulePreset,
  ValidationIssue,
} from '../games/contracts';
import { generateFreshMapCode } from '../../games/tank-battle/rules';
import { AppSelect, AppSwitch, type SelectOptionItem } from '../ui/heroUiHelpers';

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
 * 切换规则预设仅替换规则草稿，绝不覆盖玩家姓名、涂装颜色或改键。
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
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex-1 min-w-[200px]">
          <AppSelect
            ariaLabel="当前规则预设"
            label="当前规则预设"
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

        <div className="flex items-end gap-2 self-end">
          {activePresetId && (
            <Button
              variant="danger-soft"
              size="sm"
              aria-label="删除当前选中预设"
              onPress={() => onDeletePreset(activePresetId)}
              className="min-h-[40px] max-sm:min-h-[44px] whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              删除预设
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onPress={onResetAllRules}
            className="min-h-[40px] max-sm:min-h-[44px] whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            恢复全部默认
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[var(--separator)]">
        <Input
          type="text"
          value={newPresetName}
          maxLength={24}
          placeholder="输入新预设名（如：快节奏激光战）"
          aria-label="新规则预设名称"
          onChange={(e) => setNewPresetName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleCreatePreset();
            }
          }}
          className="flex-1 min-w-[180px] min-h-[40px] max-sm:min-h-[44px] bg-[var(--field-background)] text-[var(--field-foreground)] border border-[var(--field-border)] rounded-lg px-3 text-xs"
        />
        <Button
          variant="primary"
          size="sm"
          onPress={handleCreatePreset}
          className="min-h-[40px] max-sm:min-h-[44px] whitespace-nowrap shrink-0 accent-solid-btn"
        >
          <BookmarkPlus className="w-3.5 h-3.5" aria-hidden="true" />
          保存为新预设
        </Button>
      </div>

      {presetFeedback && (
        <p role="status" className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
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
  /** 仅显示指定规则分组（用于设置中心按 7 大模块拆分展示） */
  filterGroupIds?: string[];
  /** 隐藏特定字段（例如操控模式已归入「操控」分类） */
  excludeFieldKeys?: string[];
  /** 隐藏顶部标题行 */
  hideHeader?: boolean;
  /** 隐藏预设工具栏（设置中心将预设集中到「数据」分类） */
  hidePresetBar?: boolean;
}

/**
 * HeroUI v3 通用规则与命名预设编辑器（赛前页与设置页共用同一套表单与校验器）。
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

  // 当外部切换 filterGroupIds 时自动选中第一个可见分组
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
    const cols = Number(rules.gridCols ?? 10);
    const rows = Number(rules.gridRows ?? 7);
    const extra = Number(rules.extraPassages ?? 8);
    const fresh = generateFreshMapCode(cols, rows, extra);
    onChangeRules({ ...rules, mapCode: fresh } as TRules);
  };

  const errorCount = scopedIssues.filter((i) => i.severity === 'error').length;
  const warningCount = scopedIssues.filter((i) => i.severity === 'warning').length;

  return (
    <section aria-label="对局规则与预设" className="space-y-4">
      {!hideHeader && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-[var(--foreground)]">
              对局规则与预设
            </h2>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              切换预设仅影响规则，保留玩家名字、颜色与按键
            </p>
          </div>
          {hidePresetBar && (
            <Button
              variant="secondary"
              size="sm"
              onPress={onResetAllRules}
              className="min-h-[38px] max-sm:min-h-[44px] whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              恢复全部默认规则
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

      {/* 校验摘要 */}
      {(errorCount > 0 || warningCount > 0) && (
        <div
          role={errorCount > 0 ? 'alert' : 'status'}
          className={`flex items-start gap-2.5 px-3.5 py-2.5 text-xs font-medium rounded-xl border ${
            errorCount > 0
              ? 'bg-red-500/10 border-red-500/35 text-red-700 dark:text-red-300'
              : 'bg-amber-500/12 border-amber-500/35 text-amber-800 dark:text-amber-300'
          }`}
        >
          {errorCount > 0 ? (
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          )}
          <span>
            {errorCount > 0
              ? `规则配置中有 ${errorCount} 项错误，修正后方可开始比赛。`
              : `规则配置中有 ${warningCount} 项提醒，请确认参数符合预期。`}
          </span>
        </div>
      )}

      {/* HeroUI 分组标签栏（当包含多个分组时展示） */}
      {availableGroups.length > 1 && currentGroup && (
        <Tabs
          selectedKey={currentGroup.id}
          onSelectionChange={(key) => setSelectedGroupId(String(key))}
          className="w-full"
        >
          <Tabs.ListContainer>
            <Tabs.List
              aria-label="规则分组"
              className="bg-[var(--surface-secondary)] border border-[var(--border)] p-1 rounded-xl flex flex-wrap gap-1 w-full"
            >
              {availableGroups.map((group) => {
                const groupErrors = errorCountByGroup.get(group.id) ?? 0;
                return (
                  <Tabs.Tab
                    key={group.id}
                    id={group.id}
                    data-testid={`rules-group-tab-${group.id}`}
                    className="!w-auto flex-none px-3 py-1.5 min-h-[36px] max-sm:min-h-[44px] text-xs font-semibold whitespace-nowrap inline-flex items-center gap-1.5"
                  >
                    <span>{group.title}</span>
                    {groupErrors > 0 && (
                      <span className="text-red-600 dark:text-red-400 font-mono-num font-bold">
                        ({groupErrors})
                      </span>
                    )}
                    <Tabs.Indicator />
                  </Tabs.Tab>
                );
              })}
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>
      )}

      {/* 当前分组字段面板 */}
      {currentGroup && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--separator)]">
            <div>
              <h3 className="text-sm font-bold text-[var(--foreground)]">
                {currentGroup.title}
              </h3>
              {currentGroup.description && (
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  {currentGroup.description}
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onPress={() => onResetGroupRules(currentGroup.id)}
              className="min-h-[36px] max-sm:min-h-[42px] text-xs font-semibold whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              恢复本组默认
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
            {visibleFields.map((field) => {
              const fieldIssues = issuesByField.get(field.key) ?? [];
              const hasError = fieldIssues.some((i) => i.severity === 'error');
              const disabled = Boolean(field.isDisabled?.(rules));
              const value = rules[field.key];
              const isFullWidth = field.key === 'mapCode' || field.key === 'controlMode';

              return (
                <div
                  key={field.key}
                  className={`${isFullWidth ? 'sm:col-span-2' : ''} space-y-1.5`}
                >
                  {field.type === 'boolean' ? (
                    <div className="flex items-center justify-between gap-3 px-3 py-1.5 min-h-[44px] bg-[var(--surface-secondary)]/65 border border-[var(--border)] rounded-lg">
                      <span className="text-xs font-semibold text-[var(--foreground)]">
                        {field.label}
                      </span>
                      <AppSwitch
                        ariaLabel={field.label}
                        isSelected={Boolean(value)}
                        isDisabled={disabled}
                        onChange={(checked) => handleFieldUpdate(field, checked)}
                      />
                    </div>
                  ) : field.type === 'select' ? (
                    <AppSelect
                      ariaLabel={field.label}
                      label={field.label}
                      testId={`rule-select-${field.key}`}
                      value={String(value ?? '')}
                      isDisabled={disabled}
                      options={(field.options ?? []).map((opt) => ({
                        value: opt.value,
                        label: opt.label,
                      }))}
                      onChange={(val) => handleFieldUpdate(field, val)}
                    />
                  ) : field.type === 'string' ? (
                    <>
                      <label
                        htmlFor={`rule-${field.key}`}
                        className="block text-xs font-semibold text-[var(--foreground)]"
                      >
                        {field.label}
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          id={`rule-${field.key}`}
                          type="text"
                          value={String(value ?? '')}
                          disabled={disabled}
                          placeholder={field.placeholder}
                          onChange={(e) => handleFieldUpdate(field, e.target.value)}
                          className={`flex-1 min-w-[200px] min-h-[40px] max-sm:min-h-[44px] px-3 text-xs font-mono-num bg-[var(--field-background)] text-[var(--field-foreground)] border rounded-lg ${
                            hasError
                              ? 'border-red-500'
                              : 'border-[var(--field-border)]'
                          }`}
                        />
                        {field.key === 'mapCode' && (
                          <div className="flex items-center gap-2 shrink-0">
                            <Button
                              variant="secondary"
                              size="sm"
                              onPress={handleRerollMapCode}
                              className="min-h-[40px] max-sm:min-h-[44px] whitespace-nowrap"
                            >
                              <Dices className="w-3.5 h-3.5" aria-hidden="true" />
                              生成编号
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              isDisabled={!String(value ?? '').trim()}
                              onPress={handleCopyMapCode}
                              className="min-h-[40px] max-sm:min-h-[44px] whitespace-nowrap"
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
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor={`rule-${field.key}`}
                          className={`text-xs font-semibold ${
                            disabled ? 'text-[var(--muted)] opacity-60' : 'text-[var(--foreground)]'
                          }`}
                        >
                          {field.label}
                        </label>
                        {field.unit && (
                          <span className="text-[11px] font-mono-num text-[var(--muted)]">
                            {field.unit}
                          </span>
                        )}
                      </div>
                      <Input
                        id={`rule-${field.key}`}
                        type="number"
                        value={
                          typeof value === 'number' && Number.isFinite(value)
                            ? String(value)
                            : ''
                        }
                        min={field.min}
                        max={field.max}
                        step={field.step ?? (field.type === 'integer' ? 1 : 0.1)}
                        disabled={disabled}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const parsed = raw === '' ? Number.NaN : Number(raw);
                          handleFieldUpdate(field, parsed);
                        }}
                        className={`w-full min-h-[40px] max-sm:min-h-[44px] px-3 text-xs font-mono-num bg-[var(--field-background)] text-[var(--field-foreground)] border rounded-lg disabled:opacity-50 ${
                          hasError
                            ? 'border-red-500'
                            : 'border-[var(--field-border)]'
                        }`}
                      />
                    </>
                  )}

                  {field.helperText && fieldIssues.length === 0 && (
                    <p className="text-[11px] text-[var(--muted)] leading-snug">
                      {field.helperText}
                    </p>
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
