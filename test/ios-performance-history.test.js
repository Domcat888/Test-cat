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

test('migrates the legacy combined iOS history into indexed report and log files', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'test-cat-ios-history-migrate-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const reportId = '11111111-1111-4111-8111-111111111111';
  const logId = '22222222-2222-4222-8222-222222222222';
  await fs.writeFile(path.join(root, 'history.json'), JSON.stringify({
    reports: [{ id: reportId, name: '旧 iOS 报告', createdAt: '2026-08-07T12:00:00Z', config: { serial: 'UDID1', app: { bundleId: 'com.example.demo' } }, samples: [{ elapsed: 1, cpuUsage: 9 }] }],
    logs: [{ id: logId, deviceSerial: 'UDID1', sourcePath: '/old.ips', name: 'old.ips', type: 'Crash', content: 'legacy crash' }]
  }), 'utf8');

  const history = new IosPerformanceHistory(root);
  assert.equal((await history.listReports())[0].id, reportId);
  assert.equal((await history.getReport(reportId)).samples[0].cpuUsage, 9);
  assert.equal((await history.getLog(logId)).content, 'legacy crash');
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'index.json'), 'utf8')).version, 2);
  await fs.access(path.join(root, 'reports', `${reportId}.json`));
  await fs.access(path.join(root, 'logs', `${logId}.json`));
  await fs.access(path.join(root, 'history.migrated-v1.json'));
});

test('iOS history write queue recovers after a failed write', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'test-cat-ios-history-retry-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const history = new IosPerformanceHistory(root);
  const atomicWrite = history.atomicWrite.bind(history);
  let failIndex = true;
  history.atomicWrite = async (...args) => {
    if (failIndex && args[0] === history.indexPath) {
      failIndex = false;
      throw new Error('simulated disk failure');
    }
    return atomicWrite(...args);
  };
  const report = { config: { serial: 'UDID1' }, samples: [] };
  await assert.rejects(history.saveReport(report), /simulated disk failure/);
  const saved = await history.saveReport(report);
  assert.equal((await history.getReport(saved.id)).type, 'ios-performance-report');
  assert.equal((await history.listReports()).length, 1);
});

test('iOS diagnostic log save rolls back and can retry after an index failure', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'test-cat-ios-log-retry-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const history = new IosPerformanceHistory(root);
  const atomicWrite = history.atomicWrite.bind(history);
  let failIndex = true;
  history.atomicWrite = async (...args) => {
    if (failIndex && args[0] === history.indexPath) {
      failIndex = false;
      throw new Error('simulated log index failure');
    }
    return atomicWrite(...args);
  };
  const record = {
    deviceSerial: 'UDID1', sourcePath: '/retry.ips', type: 'Crash',
    content: 'retry crash', occurredAt: '2026-08-07T12:00:00Z'
  };
  await assert.rejects(history.saveLogs([record]), /simulated log index failure/);
  const [saved] = await history.saveLogs([record]);
  assert.equal((await history.listLogs()).length, 1);
  assert.equal((await history.getLog(saved.id)).content, 'retry crash');
});
