import { useMemo, useState } from 'react';
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
}

/**
 * 通用规则与命名预设编辑器（赛前页与设置页共用同一套表单与校验器）。
 * 切换规则预设仅替换规则草稿，绝不覆盖玩家姓名、涂装颜色或改键。
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
}: RulesFormProps<TRules>) {
  const [selectedGroupId, setSelectedGroupId] = useState<string>(
    game.ruleGroups[0]?.id ?? 'match'
  );
  const [newPresetName, setNewPresetName] = useState('');
  const [presetFeedback, setPresetFeedback] = useState<string | null>(null);
  const [copiedMapCode, setCopiedMapCode] = useState(false);

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
      const g = fieldToGroup.get(issue.field);
      if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    return counts;
  }, [game.ruleFields, issues]);

  const currentGroup =
    game.ruleGroups.find((g) => g.id === selectedGroupId) ?? game.ruleGroups[0];
  const visibleFields = game.ruleFields.filter(
    (f) => f.group === currentGroup?.id && !f.isHidden?.(rules)
  );

  const handleFieldUpdate = (field: RuleFieldSchema, rawVal: unknown) => {
    const next = game.onRuleFieldChange
      ? game.onRuleFieldChange(rules, field.key, rawVal)
      : ({ ...rules, [field.key]: rawVal } as TRules);
    onChangeRules(next);
  };

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

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;

  return (
    <section aria-label="对局规则与预设" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-[#1C2127]">对局规则与预设</h2>
          <p className="text-xs text-[#59626D] mt-0.5">
            切换预设仅影响规则，保留玩家名字、颜色与按键
          </p>
        </div>
        <button
          type="button"
          onClick={onResetAllRules}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#3A424C] bg-[#EAE5DA] hover:bg-[#DFD9CB] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          恢复全部默认规则
        </button>
      </div>

      {/* 命名规则预设工具栏 */}
      <div className="bg-[#FAF8F4] border border-[#D8D2C5] rounded-lg p-3.5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="rule-preset-select" className="text-xs font-semibold text-[#4A535E] whitespace-nowrap">
            当前规则预设
          </label>
          <select
            id="rule-preset-select"
            value={activePresetId ?? '__custom__'}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '__default__') {
                onResetAllRules();
                onSelectPreset(null);
              } else if (val !== '__custom__') {
                onSelectPreset(val);
              }
            }}
            className="flex-1 min-w-[180px] px-2.5 py-1.5 text-xs font-medium bg-white border border-[#CFC8BA] rounded-md text-[#1C2127] focus:outline-none focus:ring-2 focus:ring-[#1C2127]/20"
          >
            <option value="__custom__">当前自定义配置</option>
            <option value="__default__">官方默认规则</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {activePresetId && (
            <button
              type="button"
              onClick={() => onDeletePreset(activePresetId)}
              aria-label="删除当前选中预设"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#9B2216] bg-[#FDECE9] hover:bg-[#F9D9D3] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              删除预设
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#E6E1D6]">
          <input
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
            className="flex-1 min-w-[180px] px-2.5 py-1.5 text-xs bg-white border border-[#CFC8BA] rounded-md text-[#1C2127] placeholder:text-[#98A0AA] focus:outline-none focus:ring-2 focus:ring-[#1C2127]/20"
          />
          <button
            type="button"
            onClick={handleCreatePreset}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#262D35] hover:bg-[#181D23] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <BookmarkPlus className="w-3.5 h-3.5" aria-hidden="true" />
            保存为新预设
          </button>
        </div>

        {presetFeedback && (
          <p role="status" className="text-xs font-medium text-[#1F6E4A]">
            {presetFeedback}
          </p>
        )}
      </div>

      {/* 校验摘要 */}
      {(errorCount > 0 || warningCount > 0) && (
        <div
          role={errorCount > 0 ? 'alert' : 'status'}
          className={`flex items-start gap-2 px-3 py-2 text-xs font-medium rounded-md border ${
            errorCount > 0
              ? 'bg-[#FDECE9] border-[#EAB5AC] text-[#9B2216]'
              : 'bg-[#FCF2DF] border-[#E7C78C] text-[#8A4B08]'
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

      {/* 分组标签栏 */}
      <div
        role="tablist"
        aria-label="规则分组"
        className="flex flex-wrap items-center gap-1 p-1 bg-[#EAE5DA] rounded-lg"
      >
        {game.ruleGroups.map((group) => {
          const isActive = group.id === currentGroup?.id;
          const groupErrors = errorCountByGroup.get(group.id) ?? 0;
          return (
            <button
              key={group.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setSelectedGroupId(group.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isActive
                  ? 'bg-white text-[#1C2127] shadow-xs'
                  : 'text-[#4F5864] hover:text-[#1C2127]'
              }`}
            >
              {group.title}
              {groupErrors > 0 && (
                <span className="ml-1.5 text-[#C93420] font-mono-num">({groupErrors})</span>
              )}
            </button>
          );
        })}
      </div>

      {/* 当前分组字段面板 */}
      {currentGroup && (
        <div className="bg-[#FAF8F4] border border-[#D8D2C5] rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between gap-3 pb-2.5 border-b border-[#E6E1D6]">
            <div>
              <h3 className="text-sm font-bold text-[#1C2127]">{currentGroup.title}</h3>
              {currentGroup.description && (
                <p className="text-xs text-[#646E7A] mt-0.5">{currentGroup.description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onResetGroupRules(currentGroup.id)}
              className="text-xs font-semibold text-[#4F5864] hover:text-[#1C2127] underline underline-offset-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              恢复本组默认
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3.5">
            {visibleFields.map((field) => {
              const fieldIssues = issuesByField.get(field.key) ?? [];
              const hasError = fieldIssues.some((i) => i.severity === 'error');
              const disabled = Boolean(field.isDisabled?.(rules));
              const value = rules[field.key];
              const isFullWidth = field.key === 'mapCode';

              return (
                <div
                  key={field.key}
                  className={`${isFullWidth ? 'sm:col-span-2' : ''} space-y-1`}
                >
                  {field.type === 'boolean' ? (
                    <label className="flex items-center justify-between gap-3 py-1.5 px-2.5 bg-white border border-[#DDD7CB] rounded-md cursor-pointer">
                      <span className="text-xs font-medium text-[#222830]">
                        {field.label}
                      </span>
                      <input
                        type="checkbox"
                        checked={Boolean(value)}
                        disabled={disabled}
                        onChange={(e) => handleFieldUpdate(field, e.target.checked)}
                        className="w-4 h-4 accent-[#D9432B] rounded cursor-pointer"
                      />
                    </label>
                  ) : field.type === 'select' ? (
                    <>
                      <label
                        htmlFor={`rule-${field.key}`}
                        className="block text-xs font-medium text-[#3B444F]"
                      >
                        {field.label}
                      </label>
                      <select
                        id={`rule-${field.key}`}
                        value={String(value ?? '')}
                        disabled={disabled}
                        onChange={(e) => handleFieldUpdate(field, e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#CFC8BA] rounded-md text-[#1C2127] focus:outline-none focus:ring-2 focus:ring-[#1C2127]/20"
                      >
                        {field.options?.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : field.type === 'string' ? (
                    <>
                      <label
                        htmlFor={`rule-${field.key}`}
                        className="block text-xs font-medium text-[#3B444F]"
                      >
                        {field.label}
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          id={`rule-${field.key}`}
                          type="text"
                          value={String(value ?? '')}
                          disabled={disabled}
                          placeholder={field.placeholder}
                          onChange={(e) => handleFieldUpdate(field, e.target.value)}
                          className={`flex-1 px-2.5 py-1.5 text-xs font-mono-num bg-white border rounded-md text-[#1C2127] placeholder:text-[#98A0AA] focus:outline-none focus:ring-2 focus:ring-[#1C2127]/20 ${
                            hasError ? 'border-[#C93420]' : 'border-[#CFC8BA]'
                          }`}
                        />
                        {field.key === 'mapCode' && (
                          <>
                            <button
                              type="button"
                              onClick={handleRerollMapCode}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#1C2127] bg-[#EAE5DA] hover:bg-[#DDD7C8] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Dices className="w-3.5 h-3.5" aria-hidden="true" />
                              生成编号
                            </button>
                            <button
                              type="button"
                              onClick={handleCopyMapCode}
                              disabled={!String(value ?? '').trim()}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#1C2127] bg-[#EAE5DA] hover:bg-[#DDD7C8] disabled:opacity-40 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              {copiedMapCode ? (
                                <Check className="w-3.5 h-3.5 text-[#1F8A5B]" aria-hidden="true" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                              )}
                              {copiedMapCode ? '已复制' : '复制'}
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor={`rule-${field.key}`}
                          className={`text-xs font-medium ${
                            disabled ? 'text-[#9AA2AC]' : 'text-[#3B444F]'
                          }`}
                        >
                          {field.label}
                        </label>
                        {field.unit && (
                          <span className="text-[11px] text-[#78828E]">{field.unit}</span>
                        )}
                      </div>
                      <input
                        id={`rule-${field.key}`}
                        type="number"
                        value={typeof value === 'number' && Number.isFinite(value) ? value : ''}
                        min={field.min}
                        max={field.max}
                        step={field.step ?? (field.type === 'integer' ? 1 : 0.1)}
                        disabled={disabled}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const parsed = raw === '' ? Number.NaN : Number(raw);
                          handleFieldUpdate(field, parsed);
                        }}
                        className={`w-full px-2.5 py-1.5 text-xs font-mono-num bg-white border rounded-md text-[#1C2127] disabled:bg-[#EFECE4] disabled:text-[#8E96A0] focus:outline-none focus:ring-2 focus:ring-[#1C2127]/20 ${
                          hasError ? 'border-[#C93420]' : 'border-[#CFC8BA]'
                        }`}
                      />
                    </>
                  )}

                  {field.helperText && fieldIssues.length === 0 && (
                    <p className="text-[11px] text-[#6B7480] leading-snug">
                      {field.helperText}
                    </p>
                  )}

                  {fieldIssues.map((iss, idx) => (
                    <p
                      key={idx}
                      className={`text-[11px] font-medium leading-snug ${
                        iss.severity === 'error' ? 'text-[#B3261E]' : 'text-[#9A5808]'
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
