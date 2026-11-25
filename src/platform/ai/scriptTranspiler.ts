import { transform } from 'sucrase';
import type { BotActionIntent } from '../games/contracts';

export interface TranspileBotResult {
  ok: boolean;
  extractedSource: string;
  compiledBody: string;
  errorMessage?: string;
}

/**
 * 从大模型整段回复中智能提取 JS/TS 代码：
 * - 若包含 ```ts / ```typescript / ```js / ```javascript / ``` 代码围栏，提取最长代码块
 * - 若本身即为纯源码，直接清洗首尾空白后返回
 */
export function extractCodeFromLlmResponse(rawText: string): string {
  const trimmed = rawText.trim();
  if (!trimmed) return '';

  const fenceRegex = /```(?:typescript|ts|javascript|js)?\s*\r?\n([\s\S]*?)```/gi;
  let bestBlock = '';
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(trimmed)) !== null) {
    const candidate = match[1].trim();
    if (candidate.length > bestBlock.length) {
      bestBlock = candidate;
    }
  }

  return bestBlock || trimmed;
}

/**
 * 将用户/大模型粘贴的 JS 或 TS 策略脚本转译为可在沙箱内直接执行并导出
 * `{ createBot?, decide?, defaultExport? }` 的纯标准 ES5/ES6 函数体。
 *
 * 兼容大模型常见的 4 种写法：
 * 1. `export function createBot(ctx) { return { decide(obs) { ... } }; }`
 * 2. `export function decide(obs, state) { ... }`
 * 3. `export default function createBot(ctx) { ... }` 或 `export default { decide(obs) { ... } }`
 * 4. 非 export 的顶层 `function createBot(...)` 或 `function decide(...)`
 */
export function transpileUserBotScript(rawText: string): TranspileBotResult {
  const extracted = extractCodeFromLlmResponse(rawText);
  if (!extracted) {
    return {
      ok: false,
      extractedSource: '',
      compiledBody: '',
      errorMessage: '脚本内容为空，请粘贴 JavaScript 或 TypeScript 策略代码。',
    };
  }

  // 禁止外部模块 import 语句与动态 import()（沙箱内无模块加载器，也不允许网络加载）
  if (
    /^\s*import\s+(?!type\b)[\s\S]*?\sfrom\s+['"][^'"]+['"]/m.test(extracted) ||
    /^\s*import\s+['"][^'"]+['"]/m.test(extracted) ||
    /\bimport\s*\(/.test(extracted)
  ) {
    return {
      ok: false,
      extractedSource: extracted,
      compiledBody: '',
      errorMessage:
        '自定义 AI 脚本必须为单文件自包含脚本，不能使用外部 import 依赖（可使用 import type）。',
    };
  }

  let jsCode: string;
  try {
    const transformed = transform(extracted, {
      transforms: ['typescript'],
      disableESTransforms: true,
    });
    jsCode = transformed.code;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      extractedSource: extracted,
      compiledBody: '',
      errorMessage: `TypeScript/JavaScript 语法解析失败：${msg}`,
    };
  }

  // 轻量重写常见 ESM export 语法，使其能在隔离函数作用域中返回统一入口
  let rewritten = jsCode
    // export default ... -> const __defaultExport = ...
    .replace(/\bexport\s+default\s+/g, 'const __defaultExport = ')
    // export function / const / let / var / class -> 去掉 export 前缀
    .replace(/\bexport\s+(?=(?:async\s+)?function\b|const\b|let\b|var\b|class\b)/g, '')
    // export { a, b } -> 注释掉（顶层标识符已由下方统一探测）
    .replace(/\bexport\s*\{[^}]*\}\s*;?/g, '');

  // 兼容 CommonJS module.exports / exports.decide
  const compiledBody = `
"use strict";
const module = { exports: {} };
const exports = module.exports;
${rewritten}
return {
  defaultExport: typeof __defaultExport !== 'undefined' ? __defaultExport : undefined,
  createBot: typeof createBot === 'function' ? createBot : undefined,
  decide: typeof decide === 'function' ? decide : undefined,
  moduleExports: module.exports,
};
`;

  // 提前用 Function 构造做一次纯语法校验（不执行任何用户代码）
  try {
    // eslint-disable-next-line no-new-func
    new Function(compiledBody);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      extractedSource: extracted,
      compiledBody: '',
      errorMessage: `脚本编译语法错误：${msg}`,
    };
  }

  return {
    ok: true,
    extractedSource: extracted,
    compiledBody,
  };
}

/**
 * 严格白名单过滤 AI 返回的动作对象，仅保留合法 actionId 的布尔值，
 * 彻底阻断非法字段、非布尔值与原型链属性污染。
 */
export function sanitizeBotActionIntent(
  raw: unknown,
  validActionIds: readonly string[]
): BotActionIntent {
  const result: BotActionIntent = {};
  for (let i = 0; i < validActionIds.length; i += 1) {
    result[validActionIds[i]] = false;
  }
  if (!raw || typeof raw !== 'object') {
    return result;
  }

  const record = raw as Record<string, unknown>;
  for (let i = 0; i < validActionIds.length; i += 1) {
    const actionId = validActionIds[i];
    if (Object.prototype.hasOwnProperty.call(record, actionId)) {
      result[actionId] = Boolean(record[actionId]);
    }
  }
  return result;
}
