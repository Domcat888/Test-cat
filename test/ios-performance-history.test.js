const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { IosPerformanceHistory } = require('../src/ios-performance-history');

test('persists iOS reports and diagnostic logs with source-path deduplication', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'test-cat-ios-history-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const history = new IosPerformanceHistory(root);
  const saved = await history.saveReport({
    name: '登录基线',
    createdAt: '2026-08-07T12:00:00Z',
    config: { serial: 'UDID1', app: { bundleId: 'com.example.demo' } },
    meta: { model: 'QA iPhone' },
    samples: [{ elapsed: 0, cpuUsage: 10 }, { elapsed: 2, cpuUsage: 20 }]
  });
  assert.equal(saved.sampleCount, 2);
  assert.equal((await history.listReports())[0].deviceName, 'QA iPhone');
  assert.equal((await history.getReport(saved.id)).samples[1].cpuUsage, 20);

  const record = {
    deviceSerial: 'UDID1', deviceName: 'QA iPhone', sourcePath: '/Demo.ips', name: 'Demo.ips',
    type: 'Crash', occurredAt: '2026-08-07T12:00:00Z', size: 12, content: 'crash report', summary: { processName: 'Demo' }
  };
  assert.equal((await history.saveLogs([record])).length, 1);
  assert.equal((await history.saveLogs([record])).length, 0);
  const logs = await history.listLogs({ deviceSerial: 'UDID1' });
  assert.equal(logs.length, 1);
  assert.equal(Object.hasOwn(logs[0], 'content'), false);
  assert.equal((await history.getLog(logs[0].id)).content, 'crash report');

  const reloaded = new IosPerformanceHistory(root);
  assert.equal((await reloaded.listReports()).length, 1);
  assert.equal(await reloaded.deleteReport(saved.id), true);
  assert.equal((await reloaded.listReports()).length, 0);
});
