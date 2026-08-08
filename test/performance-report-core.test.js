const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAnomalies, minMaxDownsample, percentile, summarizeValues } = require('../src/renderer/performance-report-core');

test('calculates percentile statistics for Android reports', () => {
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
  assert.deepEqual(summarizeValues([1, null, 2, 3]).count, 3);
  assert.equal(summarizeValues([1, 2, 3]).p95, 2.9);
});

test('emits a cooldown-protected warning after a sustained threshold breach', () => {
  const tracker = {};
  const base = { quality: { cpuUsage: { state: 'measured' } }, cpuUsage: 90 };
  assert.equal(evaluateAnomalies({ ...base, timestamp: 100000 }, tracker).length, 0);
  assert.equal(evaluateAnomalies({ ...base, timestamp: 101000 }, tracker).length, 0);
  assert.equal(evaluateAnomalies({ ...base, timestamp: 102000 }, tracker).length, 1);
  assert.equal(evaluateAnomalies({ ...base, timestamp: 103000 }, tracker).length, 0);
});

test('min-max downsampling preserves long-test peaks', () => {
  const samples = Array.from({ length: 1000 }, (_, index) => ({ timestamp: index, elapsed: index, cpuUsage: index === 501 ? 99 : 10 }));
  const points = minMaxDownsample(samples, 'cpuUsage', 100);
  assert.ok(points.length <= 100);
  assert.ok(points.some((point) => point.value === 99));
});
