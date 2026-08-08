const test = require('node:test');
const assert = require('node:assert/strict');
const { IosPerformanceService, __test } = require('../src/ios-performance-service');

test('parses Apple DVT CPU and 16 KiB memory pages', () => {
  const sample = __test.parseSystemSnapshot('CPU_TotalLoad: 202.08\nEnabledCPUs: 6\nvmUsedCount: 1000\nvmFreeCount: 500\nvmExtPageCount: 100');
  assert.equal(sample.cpuUsage, 33.68);
  assert.equal(sample.enabledCpuCount, 6);
  assert.equal(sample.memoryUsed, 900 * 16 * 1024);
  assert.equal(sample.memoryTotal, 1500 * 16 * 1024);
});

test('parses diagnostics battery JSON and classifies temperature', () => {
  const battery = __test.parseBatterySnapshot('{"Temperature":3279,"CurrentCapacity":91,"IsCharging":true}');
  assert.equal(battery.temperature, 32.79);
  assert.equal(battery.batteryLevel, 91);
  assert.equal(battery.charging, true);
  assert.equal(__test.classifyTemperature(battery.temperature), 'nominal');
  assert.equal(__test.classifyTemperature(42), 'serious');
});

test('parses graphics, installed apps, and DVT process snapshots', () => {
  assert.deepEqual(__test.parseGraphicsSnapshot('{"CoreAnimationFramesPerSecond":59.5,"Device Utilization %":21}'), { fps: 59.5, gpuUsage: 21 });
  const apps = __test.parseInstalledApps('[{"CFBundleDisplayName":"QA Demo","CFBundleIdentifier":"com.example.demo","CFBundleExecutable":"Demo"}]');
  assert.deepEqual(apps, [{ name: 'QA Demo', bundleId: 'com.example.demo', executable: 'Demo' }]);
  assert.deepEqual(__test.parseProcessSnapshot('[{"name":"Demo","cpuUsage":35.2,"physFootprint":123456}]', 'Demo'), { cpuUsage: 35.2, memoryUsed: 123456 });
});

test('parses pymobiledevice3 usbmux device rows', () => {
  assert.deepEqual(__test.parseUsbmuxDevices('["UDID12345678"]')[0], { serial: 'UDID12345678', model: 'iPhone', state: 'device', platform: 'ios', source: 'pymobiledevice3' });
  assert.deepEqual(__test.parseUsbmuxDevices('[{"Identifier":"UDID2","Properties":{"DeviceName":"QA iPhone","ConnectionType":"USB"}}]')[0], { serial: 'UDID2', model: 'QA iPhone', state: 'device', platform: 'ios', connectionType: 'USB', source: 'pymobiledevice3' });
});

test('builds Python candidates for both Windows and macOS', () => {
  assert.deepEqual(__test.pythonCandidates({ IPM_PYTHON_PATH: 'C:\\Python\\python.exe', PYMOBILEDEVICE3_PYTHON: 'other' }, 'win32'), ['C:\\Python\\python.exe', 'other', 'python.exe', 'python']);
  assert.deepEqual(__test.pythonCandidates({ IPM_PYTHON_PATH: '/opt/python3' }, 'darwin'), ['/opt/python3', 'python3', 'python']);
  assert.deepEqual(__test.bundledPythonCandidates(['/runtime'], 'darwin', 'arm64'), ['/runtime/darwin-arm64/bin/python3', '/runtime/darwin-arm64/bin/python']);
  assert.deepEqual(__test.pythonCandidates({}, 'darwin', { bundled: ['/runtime/python3'], includeSystem: false }), ['/runtime/python3']);
});

test('classifies iOS diagnostic logs and extracts crash summaries', () => {
  assert.equal(__test.diagnosticType('/JetsamEvent-2026-08-07.ips'), 'Jetsam');
  assert.equal(__test.diagnosticType('/Demo-2026-08-07_resource.cpu.ips'), 'Performance');
  assert.equal(__test.diagnosticType('/Demo-2026-08-07.ips'), 'Crash');
  assert.equal(__test.diagnosticType('/Analytics-2026-08-07.ips'), null);
  assert.equal(__test.diagnosticType('/notes.txt'), null);
  const summary = __test.diagnosticSummary(
    '{"app_name":"QA Demo","bundleID":"com.example.demo","incident_id":"ABC","timestamp":"2026-08-07T12:00:00Z"}\nException Type: EXC_BAD_ACCESS\nTermination Reason: SIGNAL 11',
    '/QA-Demo.ips',
    'Crash'
  );
  assert.equal(summary.title, 'QA Demo · Crash');
  assert.equal(summary.bundleId, 'com.example.demo');
  assert.equal(summary.exceptionType, 'EXC_BAD_ACCESS');
  assert.equal(summary.terminationReason, 'SIGNAL 11');
  assert.equal(summary.timestamp, '2026-08-07T12:00:00.000Z');
  assert.equal(__test.shellQuote("C:/QA's Phone/python.exe"), `'C:/QA'"'"'s Phone/python.exe'`);
});

test('collects only the latest safe diagnostic log for each IPM category', async () => {
  const service = new IosPerformanceService();
  service.listDevices = async () => [{ serial: 'UDID1', model: 'QA iPhone' }];
  service.runHelper = async (mode, _serial, args) => {
    if (mode === 'crash-list') return [
      { path: '/Old.ips', name: 'Old.ips', size: 100, modifiedAt: '2026-08-01T10:00:00Z' },
      { path: '/New.ips', name: 'New.ips', size: 100, modifiedAt: '2026-08-07T10:00:00Z' },
      { path: '/JetsamEvent-new.ips', name: 'JetsamEvent-new.ips', size: 120, modifiedAt: '2026-08-07T09:00:00Z' },
      { path: '/Demo_resource.cpu.ips', name: 'Demo_resource.cpu.ips', size: 130, modifiedAt: '2026-08-07T08:00:00Z' },
      { path: '/TooLarge.ips', name: 'TooLarge.ips', size: 3 * 1024 * 1024, modifiedAt: '2026-08-08T10:00:00Z' }
    ];
    const remotePath = args[args.indexOf('--remote-path') + 1];
    return { path: remotePath, size: 100, content: `{"app_name":"Demo","timestamp":"2026-08-07T10:00:00Z"}\n${remotePath}` };
  };
  const result = await service.collectDiagnosticLogs('UDID1');
  assert.deepEqual(result.records.map((item) => [item.type, item.sourcePath]), [
    ['Crash', '/New.ips'],
    ['Jetsam', '/JetsamEvent-new.ips'],
    ['Performance', '/Demo_resource.cpu.ips']
  ]);
  assert.equal(result.records.every((item) => item.deviceName === 'QA iPhone'), true);
});

test('starts a cross-platform iOS performance session with selected metrics', async () => {
  const statuses = [];
  const service = new IosPerformanceService({ onSample: () => {}, onStatus: (status) => statuses.push(status) });
  service.checkEnvironment = async () => ({ ready: true, python: '/usr/local/bin/python3', message: 'ready' });
  service.listDevices = async () => [{ serial: 'UDID12345678', model: 'QA iPhone' }];
  service.scheduleSample = () => {};
  const meta = await service.start({ serial: 'UDID12345678', metrics: ['cpu', 'graphics', 'invalid'], interval: 100, autoMount: false, autoTunnel: false });
  assert.deepEqual(meta.metrics, ['cpu', 'graphics']);
  assert.equal(meta.interval, 1000);
  assert.equal(meta.model, 'QA iPhone');
  assert.equal(statuses.at(-1).phase, 'streaming');
  await service.stop(false);
});
