const test = require('node:test');
const assert = require('node:assert/strict');
const { createPerformanceComparisonWorkbook, createPerformanceWorkbook } = require('../src/android-performance-xlsx');
const { parseXlsx, unzipEntries } = require('../src/file-compare-service');

test('creates a real XLSX workbook with summary, samples, and events', () => {
  const buffer = createPerformanceWorkbook({
    name: '登录基线',
    startupTime: 420,
    samples: [{ timestamp: Date.now(), elapsed: 1, packageName: 'com.example.app', cpuUsage: 20, downloadSpeed: 1024 * 1024 }],
    events: [{ timestamp: Date.now(), level: 'warning', type: 'performance-warning', label: 'CPU 偏高', metric: 'cpuUsage', value: 90, threshold: 85 }]
  });
  const entries = unzipEntries(buffer);
  assert.ok(entries.has('xl/workbook.xml'));
  const workbook = parseXlsx(buffer);
  assert.deepEqual(workbook.sheets.map((sheet) => sheet.name), ['指标摘要', '原始采样', '测试事件']);
  assert.equal(workbook.sheets[1].cells.D2.value, '20');
  assert.equal(workbook.sheets[1].cells.E2.value, '1');
  assert.equal(workbook.sheets[0].cells.D3.value, '1');
});

test('creates a real XLSX comparison workbook with both raw sample sheets', () => {
  const timestamp = Date.now();
  const buffer = createPerformanceComparisonWorkbook(
    { name: '基准', samples: [{ timestamp, elapsed: 1, cpuUsage: 20, downloadSpeed: 1024 * 1024 }] },
    { name: '目标', samples: [{ timestamp, elapsed: 1, cpuUsage: 30, downloadSpeed: 2 * 1024 * 1024 }] }
  );
  const workbook = parseXlsx(buffer);
  assert.deepEqual(workbook.sheets.map((sheet) => sheet.name), ['对比摘要', '基准原始采样', '目标原始采样']);
  assert.equal(workbook.sheets[0].cells.C2.value, '20');
  assert.equal(workbook.sheets[0].cells.D2.value, '30');
  assert.equal(workbook.sheets[0].cells.E2.value, '50');
  assert.equal(workbook.sheets[1].cells.D2.value, '20');
  assert.equal(workbook.sheets[2].cells.D2.value, '30');
});
