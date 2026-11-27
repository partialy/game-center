/**
 * 纯函数数字步进计算工具（兼容小数步长防浮点漂移、边界钳制与非法值回退）。
 */
export interface StepNumericOptions {
  value: number;
  deltaSteps: number;
  step?: number;
  min?: number;
  max?: number;
  integer?: boolean;
}

export function getStepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const text = step.toString().toLowerCase();
  if (text.includes('e-')) {
    const [, exp] = text.split('e-');
    return Math.max(0, Number.parseInt(exp, 10) || 0);
  }
  const dotIdx = text.indexOf('.');
  return dotIdx >= 0 ? text.length - dotIdx - 1 : 0;
}

export function stepNumericValue({
  value,
  deltaSteps,
  step = 1,
  min,
  max,
  integer = false,
}: StepNumericOptions): number {
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1;
  const base = Number.isFinite(value) ? value : min ?? 0;
  const rawNext = base + deltaSteps * safeStep;
  const decimals = integer ? 0 : getStepDecimals(safeStep);
  const factor = 10 ** decimals;
  let rounded = Math.round(rawNext * factor) / factor;
  if (integer) {
    rounded = Math.round(rounded);
  }
  if (typeof min === 'number' && Number.isFinite(min)) {
    rounded = Math.max(min, rounded);
  }
  if (typeof max === 'number' && Number.isFinite(max)) {
    rounded = Math.min(max, rounded);
  }
  // 避免 -0
  return Object.is(rounded, -0) ? 0 : rounded;
}
