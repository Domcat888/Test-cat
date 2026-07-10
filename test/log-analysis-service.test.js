const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LogAnalysisService, __test } = require('../src/log-analysis-service');

test('parses adb devices and Android foreground package', () => {
  const devices = __test.parseDeviceList('List of devices attached\nABC123 device product:husky model:Pixel_8 device:husky transport_id:1\nXYZ unauthorized');
  assert.deepEqual(devices[0], { serial: 'ABC123', state: 'device', model: 'Pixel 8' });
  assert.equal(devices[1].state, 'unauthorized');
  assert.equal(__test.parseForegroundPackage('topResumedActivity=ActivityRecord{1 u0 com.example.game/.MainActivity t1}'), 'com.example.game');
});

test('parses threadtime logcat metadata and maps the process name', () => {
  const processMap = new Map([['1234', 'com.example.game']]);
  const record = __test.parseLogcatLine('07-06 12:34:56.789  1234  5678 E AndroidRuntime: FATAL EXCEPTION: main', processMap, 9);
  assert.equal(record.id, 9);
  assert.equal(record.pid, '1234');
  assert.equal(record.tid, '5678');
  assert.equal(record.level, 'E');
  assert.equal(record.processName, 'com.example.game');
  assert.equal(record.kind, 'crash');
});

test('classifies ANR, exceptions, stacks and ordinary warnings', () => {
  assert.equal(__test.classifyLog({ message: 'ANR in com.example.game' }).kind, 'anr');
  assert.equal(__test.classifyLog({ message: 'java.lang.NullPointerException: value is null' }).kind, 'exception');
  assert.equal(__test.classifyLog({ message: '    at com.example.Game.run(Game.java:8)' }).kind, 'exception');
  assert.equal(__test.classifyLog({ level: 'W', message: 'slow operation' }).kind, 'warning');
  assert.equal(__test.classifyLog({ level: 'I', message: 'ready' }).kind, 'normal');
});

test('combines package, level, issue type and keyword filters', () => {
  const record = { level: 'E', kind: 'error', processName: 'com.example.game:service', raw: '07-06 E Api: /api/login player=1008611 failed' };
  assert.equal(__test.recordMatchesFilter(record, { packageName: 'com.example.game', minimumLevel: 'W', kind: 'error', terms: ['/api/login', '1008611'] }), true);
  assert.equal(__test.recordMatchesFilter(record, { terms: ['another-player'] }), false);
  assert.equal(__test.recordMatchesFilter(record, { kind: 'crash' }), false);
});

test('device log scope ignores package while app scope applies package filter', () => {
  const record = { level: 'I', kind: 'normal', processName: 'com.other.app', raw: '07-06 I Game: boot finished' };
  assert.equal(__test.recordMatchesFilter(record, { logScope: 'device', packageName: 'com.example.game', terms: ['boot'] }), true);
  assert.equal(__test.recordMatchesFilter(record, { logScope: 'app', packageName: 'com.example.game', terms: ['boot'] }), false);
});

test('streams log chunks in batches and clears the captured session safely', () => {
  const batches = [];
  const service = new LogAnalysisService({ dialog: {}, getWindow: () => null, onLogs: (records) => batches.push(records), onStatus: () => {} });
  service.processMap = new Map([['1234', 'com.example.game']]);
  service.session = { serial: 'ABC123', records: [], bytes: 0, buffer: '', truncated: false };
  service.handleChunk(Buffer.from('07-06 12:00:00.000  1234  1234 I Game: ready\n07-06 12:00:01.000  1234  1234 E Game: request failed\n'));
  service.flushBatch();
  assert.equal(service.session.records.length, 2);
  assert.equal(batches.flat().length, 2);
  assert.equal(batches[0][1].kind, 'error');
  assert.equal(service.clearCaptured(), true);
  assert.equal(service.session.records.length, 0);
});

test('exports a visible HTML log report with escaped device content', async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'test-cat-log-'));
  const output = path.join(directory, 'report.html');
  const service = new LogAnalysisService({
    dialog: { showSaveDialog: async () => ({ canceled: false, filePath: output }) },
    getWindow: () => null,
    onLogs: () => {},
    onStatus: () => {}
  });
  service.session = {
    model: 'Pixel 8', serial: 'ABC123', logScope: 'app', packageName: 'com.example.game', startedAt: '2026-07-06T00:00:00.000Z',
    records: [{ id: 1, time: '07-06 12:00:00.000', level: 'E', pid: '1234', processName: 'com.example.game', tag: 'Game', message: '<script>alert(1)</script>', raw: 'raw', kind: 'error' }]
  };
  const result = await service.exportLogs({ format: 'html' });
  const html = await fs.promises.readFile(output, 'utf8');
  assert.equal(result.count, 1);
  assert.match(html, /Test cat Android 日志报告/);
  assert.match(html, /范围：指定 App 日志/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  await fs.promises.rm(directory, { recursive: true, force: true });
});
