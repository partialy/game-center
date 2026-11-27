import test from 'node:test';
import assert from 'node:assert/strict';
import { getStepDecimals, stepNumericValue } from './numberStepperMath';

test('stepNumericValue 处理小数步长不产生浮点误差并准确钳制边界', () => {
  assert.equal(getStepDecimals(0.05), 2);
  assert.equal(getStepDecimals(0.1), 1);
  assert.equal(getStepDecimals(5), 0);

  // 0.1 + 0.2 === 0.3（非 0.30000000000000004）
  assert.equal(
    stepNumericValue({ value: 0.1, deltaSteps: 2, step: 0.1, min: 0.1, max: 5 }),
    0.3
  );

  // 0.35 - 0.05 === 0.3
  assert.equal(
    stepNumericValue({ value: 0.35, deltaSteps: -1, step: 0.05, min: 0, max: 2 }),
    0.3
  );

  // 钳制上下限
  assert.equal(
    stepNumericValue({ value: 1, deltaSteps: -1, step: 1, min: 1, max: 30, integer: true }),
    1
  );
  assert.equal(
    stepNumericValue({ value: 30, deltaSteps: 1, step: 1, min: 1, max: 30, integer: true }),
    30
  );

  // NaN 回退至 min
  assert.equal(
    stepNumericValue({ value: Number.NaN, deltaSteps: 1, step: 5, min: 10, max: 600 }),
    15
  );
});
