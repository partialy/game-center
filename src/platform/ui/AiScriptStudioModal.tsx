import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  CopyPlus,
  Download,
  FileText,
  Loader2,
  Play,
  Plus,
  Save,
  ShieldAlert,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  BotValidationReport,
  CustomBotScriptRecord,
  GameDefinition,
} from '../games/contracts';
import {
  createCustomBotId,
  exportCustomBotScriptsJson,
  parseImportedCustomBotScriptsJson,
  validateCustomBotName,
} from '../ai/customBotStore';
import { validateCustomBotInWorker } from '../ai/workerSandbox';
import { PLAYER_COLOR_PALETTE } from '../input/bindings';

interface AiScriptStudioModalProps<TRules extends Record<string, unknown>> {
  game: GameDefinition<TRules, unknown>;
  rules: TRules;
  scripts: CustomBotScriptRecord[];
  initialTab?: 'prompt' | 'editor';
  onSaveScript: (record: CustomBotScriptRecord) => void;
  onDeleteScript: (scriptId: string) => void;
  onImportScripts: (records: CustomBotScriptRecord[]) => void;
  onClose: () => void;
}

const UNTESTED_VALIDATION: BotValidationReport = {
  status: 'untested',
  checkedAt: 0,
  ticksSimulated: 0,
  avgDecisionMs: 0,
  maxDecisionMs: 0,
  actionsTriggered: [],
};

/**
 * 跨游戏通用「AI 脚本工坊」工作台模态框：
 * - 规则说明 MD：一键复制或下载当前游戏的标准规则与接口说明书给大模型（可选附带当前对局自定义规则参数）
 * - 脚本编辑与试跑：直接粘贴大模型生成的 JS/TS 或 Markdown 回复，在独立 Web Worker 沙箱内进行 120 帧无头校验，
 *   验证通过（含死循环硬超时隔离）后保存为持久化自定义 AI 选手，通用于单人模式与多 AI 乱斗模式。
 */
export function AiScriptStudioModal<TRules extends Record<string, unknown>>({
  game,
  rules,
  scripts,
  initialTab = 'prompt',
  onSaveScript,
  onDeleteScript,
  onImportScripts,
  onClose,
}: AiScriptStudioModalProps<TRules>) {
  const aiSdk = game.aiSdk;
  const [activeTab, setActiveTab] = useState<'prompt' | 'editor'>(initialTab);
  const [includeCurrentRules, setIncludeCurrentRules] = useState(true);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  // 当前编辑的脚本草稿状态
  const [editingId, setEditingId] = useState<string | null>(() => scripts[0]?.id ?? null);
  const [draftName, setDraftName] = useState<string>(() => scripts[0]?.name ?? '');
  const [draftTier, setDraftTier] = useState<string>(() => scripts[0]?.tierLabel ?? '自定义');
  const [draftAuthor, setDraftAuthor] = useState<string>(() => scripts[0]?.authorModel ?? '');
  const [draftDesc, setDraftDesc] = useState<string>(() => scripts[0]?.description ?? '');
  const [draftColor, setDraftColor] = useState<string>(
    () => scripts[0]?.defaultColorHex ?? PLAYER_COLOR_PALETTE[2].hex
  );
  const [draftCode, setDraftCode] = useState<string>(
    () => scripts[0]?.code ?? aiSdk?.defaultTemplateCode ?? ''
  );
  const [draftValidation, setDraftValidation] = useState<BotValidationReport>(
    () => scripts[0]?.validation ?? UNTESTED_VALIDATION
  );

  const [validating, setValidating] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const promptMarkdown = useMemo(() => {
    if (!aiSdk) return '# 当前游戏暂未注册 AI SDK 规则说明书。';
    return aiSdk.buildPromptMarkdown(rules, { includeCurrentRules });
  }, [aiSdk, includeCurrentRules, rules]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const loadScriptIntoEditor = (record: CustomBotScriptRecord) => {
    setEditingId(record.id);
    setDraftName(record.name);
    setDraftTier(record.tierLabel);
    setDraftAuthor(record.authorModel);
    setDraftDesc(record.description);
    setDraftColor(record.defaultColorHex);
    setDraftCode(record.code);
    setDraftValidation(record.validation);
    setFeedback(null);
    setActiveTab('editor');
  };

  const handleStartNew = () => {
    const nextColor =
      PLAYER_COLOR_PALETTE[(scripts.length + 2) % PLAYER_COLOR_PALETTE.length].hex;
    setEditingId(null);
    setDraftName('');
    setDraftTier('自定义');
    setDraftAuthor('');
    setDraftDesc('');
    setDraftColor(nextColor);
    setDraftCode(aiSdk?.defaultTemplateCode ?? '');
    setDraftValidation(UNTESTED_VALIDATION);
    setFeedback(null);
    setActiveTab('editor');
  };

  const handleDuplicate = (record: CustomBotScriptRecord) => {
    const now = Date.now();
    const copyName = `${record.name.slice(0, 12)} 副本`;
    const duplicated: CustomBotScriptRecord = {
      ...record,
      id: createCustomBotId(),
      name: copyName,
      createdAt: now,
      updatedAt: now,
    };
    onSaveScript(duplicated);
    loadScriptIntoEditor(duplicated);
    setFeedback({ tone: 'ok', text: `已复制脚本「${copyName}」。` });
  };

  const handleCopyPrompt = () => {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(promptMarkdown).catch(() => {});
    }
    setCopiedPrompt(true);
    window.setTimeout(() => setCopiedPrompt(false), 1800);
  };

  const handleDownloadPrompt = () => {
    const blob = new Blob([promptMarkdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${game.id}-ai-guide.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportJson = () => {
    const json = exportCustomBotScriptsJson(game.id, scripts);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${game.id}-custom-bots.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setFeedback({ tone: 'ok', text: `已导出 ${scripts.length} 份自定义 AI 脚本。` });
  };

  const handleImportFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const parsed = parseImportedCustomBotScriptsJson(text, game.id);
      if (!parsed.ok) {
        setFeedback({ tone: 'err', text: parsed.error });
        return;
      }
      onImportScripts(parsed.scripts);
      loadScriptIntoEditor(parsed.scripts[0]);
      setFeedback({
        tone: 'ok',
        text: `成功导入 ${parsed.scripts.length} 份 AI 脚本，建议逐一试跑校验。`,
      });
    };
    reader.readAsText(file);
  };

  const handleValidate = async () => {
    if (!aiSdk) return;
    setValidating(true);
    setFeedback(null);
    try {
      const report = await validateCustomBotInWorker({
        rawCode: draftCode,
        validActionIds: game.actions.map((a) => a.id),
        ticks: 120,
        seed: 20260401,
        createDryRun: () => {
          const dry = aiSdk.createDryRunWorld(rules, 20260401);
          return {
            world: dry.world,
            selfSlotId: dry.selfSlotId,
            buildObservation: (w, slot, tick) => aiSdk.buildObservation(w, slot, tick),
            stepWorld: dry.stepWorld,
          };
        },
      });
      setDraftValidation(report);
      if (report.status === 'verified') {
        setFeedback({
          tone: 'ok',
          text: `Worker 沙箱 120 帧试跑通过（平均 ${report.avgDecisionMs.toFixed(2)}ms）。`,
        });
      } else {
        setFeedback({
          tone: 'err',
          text: report.errorMessage ?? '沙箱校验未通过，请检查脚本逻辑。',
        });
      }
    } finally {
      setValidating(false);
    }
  };

  const nameError = validateCustomBotName(draftName);

  const handleSave = () => {
    if (nameError) {
      setFeedback({ tone: 'err', text: nameError });
      return;
    }
    if (!draftCode.trim()) {
      setFeedback({ tone: 'err', text: '脚本代码不能为空，请粘贴大模型生成的 JS/TS 代码或填入参考模板。' });
      return;
    }

    const now = Date.now();
    const existing = editingId ? scripts.find((s) => s.id === editingId) : null;
    const record: CustomBotScriptRecord = {
      id: existing?.id ?? createCustomBotId(),
      gameId: game.id,
      name: draftName.trim(),
      defaultColorHex: draftColor,
      tierLabel: draftTier.trim() || '自定义',
      authorModel: draftAuthor.trim(),
      description: draftDesc.trim(),
      code: draftCode,
      validation: draftValidation,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    onSaveScript(record);
    setEditingId(record.id);
    setFeedback({
      tone: 'ok',
      text: `已保存「${record.name}」至本地 AI 脚本库，可在单人游戏与 AI 乱斗中直接选用。`,
    });
  };

  const handleDelete = (scriptId: string) => {
    onDeleteScript(scriptId);
    if (editingId === scriptId) {
      const remaining = scripts.filter((s) => s.id !== scriptId);
      if (remaining.length > 0) {
        loadScriptIntoEditor(remaining[0]);
      } else {
        handleStartNew();
      }
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="AI 脚本工坊"
      data-testid="ai-script-studio-modal"
      className="fixed inset-0 z-50 bg-[#0B101D]/72 flex items-center justify-center p-2 sm:p-6"
    >
      <div className="w-full max-w-[1220px] h-[min(92%,820px)] bg-[#FAF8F4] border border-[#CFC8B9] rounded-xl shadow-2xl flex flex-col overflow-hidden text-[#1C2127]">
        {/* 顶部标题栏 */}
        <header className="shrink-0 px-5 py-3.5 bg-[#222830] text-[#F5F2EB] flex items-center justify-between gap-4 border-b border-white/10">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4 text-[#7DD3FC] shrink-0" aria-hidden="true" />
              <h2 className="font-display text-base sm:text-lg font-extrabold tracking-tight truncate">
                AI 脚本工坊 · {game.name}
              </h2>
              {aiSdk && (
                <span className="text-[11px] font-mono-num text-[#94A3B8] whitespace-nowrap">
                  SDK {aiSdk.schemaVersion}
                </span>
              )}
            </div>
            <p className="text-xs text-[#B6C0CC] mt-0.5 truncate">
              导出规则 MD 给任意大模型生成策略 · 粘贴 JS/TS 在独立 Worker 沙箱校验并复用至单人与乱斗
            </p>
          </div>
          <button
            type="button"
            data-testid="studio-close-btn"
            onClick={onClose}
            aria-label="关闭 AI 脚本工坊"
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-[#F5F2EB] transition-colors shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>

        {/* 主体双栏 */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12">
          {/* 左侧：持久化自定义 AI 脚本库 */}
          <aside className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-[#DDD7C9] bg-[#F3EFE6] flex flex-col min-h-0">
            <div className="shrink-0 p-3.5 border-b border-[#DDD7C9] space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-[#1C2127]">
                  本地 AI 脚本库（<span className="font-mono-num">{scripts.length}</span>）
                </span>
                <button
                  type="button"
                  data-testid="studio-new-bot-btn"
                  onClick={handleStartNew}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-white bg-[#D9432B] hover:bg-[#BE3620] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  新建 AI 脚本
                </button>
              </div>

              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  onChange={handleImportFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-[#2C333B] bg-white hover:bg-[#FAF8F4] border border-[#CFC8B9] rounded-md transition-colors cursor-pointer"
                >
                  <Upload className="w-3 h-3" aria-hidden="true" />
                  导入 JSON
                </button>
                <button
                  type="button"
                  disabled={scripts.length === 0}
                  onClick={handleExportJson}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-[#2C333B] bg-white hover:bg-[#FAF8F4] disabled:opacity-45 disabled:cursor-not-allowed border border-[#CFC8B9] rounded-md transition-colors cursor-pointer"
                >
                  <Download className="w-3 h-3" aria-hidden="true" />
                  导出 JSON
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
              {scripts.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#CFC8B9] bg-[#FAF8F4] p-4 space-y-2 text-xs text-[#55606C]">
                  <p className="font-bold text-[#1C2127]">尚未保存自定义 AI 选手</p>
                  <ol className="list-decimal list-inside space-y-1 text-[11px] leading-relaxed">
                    <li>在右侧「规则说明 MD」一键复制给大模型</li>
                    <li>切到「脚本编辑与试跑」粘贴大模型返回的 JS/TS 代码</li>
                    <li>沙箱试跑 120 帧通过后保存，即可用于单人或 2～8 席 AI 乱斗</li>
                  </ol>
                </div>
              ) : (
                scripts.map((item) => {
                  const selected = editingId === item.id;
                  return (
                    <div
                      key={item.id}
                      data-testid={`studio-script-item-${item.id}`}
                      onClick={() => loadScriptIntoEditor(item)}
                      className={`rounded-lg border p-3 transition-colors cursor-pointer space-y-1.5 ${
                        selected
                          ? 'bg-white border-[#1C2127] shadow-xs'
                          : 'bg-[#FAF8F4] border-[#DDD7C9] hover:bg-white hover:border-[#BEB7A8]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-3 h-3 rounded-[3px] shrink-0"
                            style={{ backgroundColor: item.defaultColorHex }}
                            aria-hidden="true"
                          />
                          <span className="text-xs font-bold text-[#1C2127] truncate">
                            {item.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            title="复制为新脚本"
                            aria-label={`复制 ${item.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDuplicate(item);
                            }}
                            className="p-1 text-[#5D6672] hover:text-[#1C2127] hover:bg-[#EFECE3] rounded cursor-pointer"
                          >
                            <CopyPlus className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            title="删除脚本"
                            aria-label={`删除 ${item.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(item.id);
                            }}
                            className="p-1 text-[#5D6672] hover:text-[#B3261E] hover:bg-[#FDECE9] rounded cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-[#5D6672] truncate">
                          {item.tierLabel}
                          {item.authorModel ? ` · ${item.authorModel}` : ''}
                        </span>
                        <span
                          className={`font-mono-num font-semibold shrink-0 ${
                            item.validation.status === 'verified'
                              ? 'text-[#1F8A5B]'
                              : item.validation.status === 'error'
                              ? 'text-[#B3261E]'
                              : 'text-[#68717D]'
                          }`}
                        >
                          {item.validation.status === 'verified'
                            ? `已通过 · ${item.validation.avgDecisionMs.toFixed(2)}ms`
                            : item.validation.status === 'error'
                            ? '校验异常'
                            : '未试跑'}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </aside>

          {/* 右侧：规则说明 MD / 脚本编辑与沙箱试跑 */}
          <section className="lg:col-span-8 flex flex-col min-h-0 bg-[#FAF8F4]">
            {/* Tab 切换栏 */}
            <div className="shrink-0 px-5 pt-3.5 pb-2.5 border-b border-[#E3DDD0] flex flex-wrap items-center justify-between gap-3">
              <div
                className="flex items-center gap-1 p-1 bg-[#EAE5DA] rounded-lg"
                role="tablist"
                aria-label="工坊视图切换"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'prompt'}
                  data-testid="studio-tab-prompt"
                  onClick={() => setActiveTab('prompt')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    activeTab === 'prompt'
                      ? 'bg-white text-[#1C2127] shadow-xs'
                      : 'text-[#4F5864] hover:text-[#1C2127]'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                  1. 规则说明 MD（给大模型）
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'editor'}
                  data-testid="studio-tab-editor"
                  onClick={() => setActiveTab('editor')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    activeTab === 'editor'
                      ? 'bg-white text-[#1C2127] shadow-xs'
                      : 'text-[#4F5864] hover:text-[#1C2127]'
                  }`}
                >
                  <Code2 className="w-3.5 h-3.5" aria-hidden="true" />
                  2. 脚本粘贴、沙箱试跑与保存
                </button>
              </div>

              {activeTab === 'prompt' && (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 text-xs font-medium text-[#3A424C] cursor-pointer">
                    <input
                      type="checkbox"
                      data-testid="studio-toggle-include-rules"
                      checked={includeCurrentRules}
                      onChange={(e) => setIncludeCurrentRules(e.target.checked)}
                      className="w-3.5 h-3.5 accent-[#1C2127] rounded cursor-pointer"
                    />
                    <span>附带当前对局规则参数</span>
                  </label>
                  <button
                    type="button"
                    data-testid="studio-copy-prompt-btn"
                    onClick={handleCopyPrompt}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-[#222830] hover:bg-[#313A46] rounded-md transition-colors whitespace-nowrap cursor-pointer"
                  >
                    {copiedPrompt ? (
                      <Check className="w-3.5 h-3.5 text-[#4ADE80]" aria-hidden="true" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    {copiedPrompt ? '已复制 MD' : '一键复制给大模型'}
                  </button>
                  <button
                    type="button"
                    data-testid="studio-download-prompt-btn"
                    onClick={handleDownloadPrompt}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-[#1C2127] bg-white hover:bg-[#F3EFE6] border border-[#CFC8B9] rounded-md transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    下载 .md
                  </button>
                </div>
              )}
            </div>

            {activeTab === 'prompt' ? (
              <div className="flex-1 min-h-0 flex flex-col p-5 gap-3">
                <p className="text-xs text-[#55606C]">
                  将下方标准 Markdown 完整发给任意大模型（Gemini、ChatGPT、Claude、DeepSeek 等），要求它直接输出策略代码，随后切到「脚本粘贴、沙箱试跑与保存」页签粘贴即可参战。
                </p>
                <pre
                  data-testid="studio-prompt-preview"
                  className="flex-1 min-h-0 overflow-auto rounded-lg border border-[#D4CEC0] bg-[#141922] text-[#E6EDF5] p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap select-text"
                >
                  {promptMarkdown}
                </pre>
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
                {feedback && (
                  <div
                    role="status"
                    data-testid="studio-feedback-banner"
                    className={`flex items-start gap-2 px-3.5 py-2.5 rounded-lg border text-xs font-medium ${
                      feedback.tone === 'ok'
                        ? 'bg-[#EAF7F1] border-[#A7DFC3] text-[#175B3D]'
                        : 'bg-[#FDECE9] border-[#EAB5AC] text-[#9B2216]'
                    }`}
                  >
                    {feedback.tone === 'ok' ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                    ) : (
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                    )}
                    <span>{feedback.text}</span>
                  </div>
                )}

                {/* 选手基础资料 */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <div className="sm:col-span-5 space-y-1">
                    <label
                      htmlFor="studio-bot-name"
                      className="block text-xs font-semibold text-[#3A424C]"
                    >
                      AI 选手名称（1～16 字，支持中英文）
                    </label>
                    <input
                      id="studio-bot-name"
                      data-testid="studio-bot-name"
                      type="text"
                      maxLength={16}
                      value={draftName}
                      placeholder="例如：Gemini 雷神 / DeepSeek 刺客"
                      onChange={(e) => setDraftName(e.target.value)}
                      className="w-full px-3 py-1.5 text-sm bg-white border border-[#CFC8B9] rounded-md text-[#1C2127] focus:outline-none focus:ring-2 focus:ring-[#1C2127]/20"
                    />
                  </div>
                  <div className="sm:col-span-3 space-y-1">
                    <label
                      htmlFor="studio-bot-tier"
                      className="block text-xs font-semibold text-[#3A424C]"
                    >
                      难度标签
                    </label>
                    <input
                      id="studio-bot-tier"
                      data-testid="studio-bot-tier"
                      type="text"
                      maxLength={12}
                      value={draftTier}
                      placeholder="自定义 / 大师"
                      onChange={(e) => setDraftTier(e.target.value)}
                      className="w-full px-3 py-1.5 text-sm bg-white border border-[#CFC8B9] rounded-md text-[#1C2127] focus:outline-none focus:ring-2 focus:ring-[#1C2127]/20"
                    />
                  </div>
                  <div className="sm:col-span-4 space-y-1">
                    <label
                      htmlFor="studio-bot-author"
                      className="block text-xs font-semibold text-[#3A424C]"
                    >
                      来源模型备注（选填）
                    </label>
                    <input
                      id="studio-bot-author"
                      data-testid="studio-bot-author"
                      type="text"
                      maxLength={24}
                      value={draftAuthor}
                      placeholder="例如：Gemini 2.5 Pro"
                      onChange={(e) => setDraftAuthor(e.target.value)}
                      className="w-full px-3 py-1.5 text-sm bg-white border border-[#CFC8B9] rounded-md text-[#1C2127] focus:outline-none focus:ring-2 focus:ring-[#1C2127]/20"
                    />
                  </div>
                </div>

                {/* 默认涂装与简介 */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-6 space-y-1.5">
                    <span className="block text-xs font-semibold text-[#3A424C]">
                      默认涂装色
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {PLAYER_COLOR_PALETTE.map((opt) => {
                        const selected =
                          draftColor.toLowerCase() === opt.hex.toLowerCase();
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            data-testid={`studio-color-${opt.id}`}
                            aria-label={`选择涂装色 ${opt.label}`}
                            onClick={() => setDraftColor(opt.hex)}
                            className={`w-7 h-7 rounded-md flex items-center justify-center transition-transform cursor-pointer ${
                              selected
                                ? 'ring-2 ring-offset-2 ring-[#1C2127] scale-105'
                                : 'hover:scale-105'
                            }`}
                            style={{ backgroundColor: opt.hex }}
                          >
                            {selected && (
                              <span className="w-2 h-2 rounded-xs bg-white/95" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="sm:col-span-6 space-y-1">
                    <label
                      htmlFor="studio-bot-desc"
                      className="block text-xs font-semibold text-[#3A424C]"
                    >
                      策略简介（选填）
                    </label>
                    <input
                      id="studio-bot-desc"
                      type="text"
                      maxLength={120}
                      value={draftDesc}
                      placeholder="简述该 AI 的打法风格，例如：偏向走位反打与抢激光"
                      onChange={(e) => setDraftDesc(e.target.value)}
                      className="w-full px-3 py-1.5 text-sm bg-white border border-[#CFC8B9] rounded-md text-[#1C2127] focus:outline-none focus:ring-2 focus:ring-[#1C2127]/20"
                    />
                  </div>
                </div>

                {/* 代码粘贴区 */}
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label
                      htmlFor="studio-bot-code"
                      className="text-xs font-semibold text-[#3A424C]"
                    >
                      策略代码（可直接粘贴整段含 ```ts / ```js 代码块的大模型回复）
                    </label>
                    <div className="flex items-center gap-2">
                      {aiSdk && (
                        <button
                          type="button"
                          data-testid="studio-fill-template-btn"
                          onClick={() => {
                            setDraftCode(aiSdk.defaultTemplateCode);
                            setDraftValidation(UNTESTED_VALIDATION);
                            setFeedback(null);
                          }}
                          className="px-2.5 py-1 text-[11px] font-semibold text-[#2C333B] bg-[#EAE5DA] hover:bg-[#DFD9CB] rounded transition-colors cursor-pointer"
                        >
                          填入参考模板
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setDraftCode('');
                          setDraftValidation(UNTESTED_VALIDATION);
                        }}
                        className="px-2.5 py-1 text-[11px] font-semibold text-[#5D6672] hover:text-[#1C2127] bg-white border border-[#D8D2C5] rounded transition-colors cursor-pointer"
                      >
                        清空
                      </button>
                    </div>
                  </div>
                  <textarea
                    id="studio-bot-code"
                    data-testid="studio-bot-code"
                    spellCheck={false}
                    rows={12}
                    value={draftCode}
                    onChange={(e) => {
                      setDraftCode(e.target.value);
                      if (draftValidation.status !== 'untested') {
                        setDraftValidation(UNTESTED_VALIDATION);
                      }
                    }}
                    placeholder="在此粘贴大模型生成的 JS/TS 脚本（需导出 createBot(ctx) 或 decide(obs, state)）..."
                    className="w-full rounded-lg border border-[#2C3440] bg-[#141922] text-[#E6EDF5] p-3.5 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#7DD3FC]/40 resize-y"
                  />
                </div>

                {/* 沙箱校验报告区 */}
                <div
                  data-testid="studio-validation-result"
                  className={`rounded-lg border px-3.5 py-2.5 text-xs space-y-1 ${
                    draftValidation.status === 'verified'
                      ? 'bg-[#EAF7F1] border-[#A7DFC3] text-[#175B3D]'
                      : draftValidation.status === 'error'
                      ? 'bg-[#FDECE9] border-[#EAB5AC] text-[#9B2216]'
                      : 'bg-[#EFECE3] border-[#D8D2C5] text-[#4A535E]'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 font-bold">
                    <span className="inline-flex items-center gap-1.5">
                      {draftValidation.status === 'verified' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      ) : draftValidation.status === 'error' ? (
                        <ShieldAlert className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      ) : (
                        <Play className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      )}
                      {draftValidation.status === 'verified'
                        ? `沙箱校验通过 · 模拟 ${draftValidation.ticksSimulated} 帧`
                        : draftValidation.status === 'error'
                        ? '沙箱校验拦截到错误或超时'
                        : '待校验 · 点击下方按钮在独立 Web Worker 沙箱内试跑 120 帧'}
                    </span>
                    {draftValidation.status === 'verified' && (
                      <span className="font-mono-num text-[11px]">
                        平均 {draftValidation.avgDecisionMs.toFixed(2)}ms · 峰值{' '}
                        {draftValidation.maxDecisionMs.toFixed(2)}ms
                      </span>
                    )}
                  </div>
                  {draftValidation.status === 'verified' && (
                    <p className="text-[11px] opacity-90">
                      触发动作：
                      {draftValidation.actionsTriggered.length > 0
                        ? draftValidation.actionsTriggered.join('、')
                        : '暂无激活按键（建议检查返回动作字段名）'}
                    </p>
                  )}
                  {draftValidation.status === 'error' && draftValidation.errorMessage && (
                    <p className="text-[11px] leading-relaxed">
                      {draftValidation.errorMessage}
                    </p>
                  )}
                </div>

                {/* 底部校验与保存按钮 */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <button
                    type="button"
                    data-testid="studio-validate-btn"
                    disabled={validating || !draftCode.trim() || !aiSdk}
                    onClick={() => void handleValidate()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-[#F5F2EB] bg-[#222830] hover:bg-[#313A46] disabled:opacity-45 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                  >
                    {validating ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Play className="w-3.5 h-3.5 text-[#7DD3FC]" aria-hidden="true" />
                    )}
                    {validating ? '正在 Worker 沙箱试跑…' : '沙箱试跑校验（120 帧）'}
                  </button>

                  <button
                    type="button"
                    data-testid="studio-save-btn"
                    disabled={validating}
                    onClick={handleSave}
                    className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-white bg-[#D9432B] hover:bg-[#BE3620] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" aria-hidden="true" />
                    保存到本地 AI 脚本库
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
