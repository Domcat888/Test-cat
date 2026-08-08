const test = require('node:test');
const assert = require('node:assert/strict');
const { createPerformanceWorkbook } = require('../src/android-performance-xlsx');
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
