const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PerformanceMonitorHistory, __test } = require('../src/performance-monitor-history');

test('persists Android performance reports outside renderer storage', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'test-cat-android-history-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const history = new PerformanceMonitorHistory(root);
  const saved = await history.saveReport({
    name: '登录基线',
    config: { serial: 'SERIAL', model: 'Pixel', packageName: 'com.example.app', metrics: ['cpu'] },
    samples: [{ timestamp: Date.now(), elapsed: 1, cpuUsage: 20 }],
    events: [{ timestamp: Date.now(), type: 'warning', label: 'CPU 持续偏高' }]
  });

  assert.equal((await history.listReports()).length, 1);
  assert.equal(saved.sampleCount, 1);
  assert.equal(saved.eventCount, 1);
  const report = await history.getReport(saved.id);
  assert.equal(report.type, 'android-performance-report');
  assert.equal(report.config.packageName, 'com.example.app');
  assert.equal(await history.deleteReport(saved.id), true);
  assert.equal((await history.listReports()).length, 0);
});

test('caps long Android reports at 24 hours of one-second samples', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'test-cat-android-history-cap-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const history = new PerformanceMonitorHistory(root);
  const samples = Array.from({ length: __test.MAX_SAMPLES_PER_REPORT + 2 }, (_, index) => ({ timestamp: index, elapsed: index }));
  const saved = await history.saveReport({ config: { serial: 'SERIAL', metrics: ['cpu'] }, samples });
  const report = await history.getReport(saved.id);
  assert.equal(report.samples.length, __test.MAX_SAMPLES_PER_REPORT);
  assert.equal(report.samples[0].elapsed, 2);
});

test('migrates legacy renderer reports once', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'test-cat-android-history-migrate-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const history = new PerformanceMonitorHistory(root);
  const legacy = [{ id: 'legacy-1', name: '旧报告', config: { serial: 'SERIAL', metrics: ['cpu'] }, samples: [] }];
  assert.equal((await history.migrateReports(legacy)).imported, 1);
  assert.equal((await history.migrateReports(legacy)).imported, 0);
});
