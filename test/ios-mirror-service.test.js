const test = require('node:test');
const assert = require('node:assert/strict');
const { IosMirrorService, __test } = require('../src/ios-mirror-service');

test('parses trusted iPhone identifiers and device metadata', () => {
  assert.deepEqual(__test.parseIdeviceIds('abc12345\n\nnot-a-device\nABCDEF12-1234'), ['abc12345', 'ABCDEF12-1234']);
  const info = __test.parseIdeviceInfo('DeviceName: QA iPhone\nProductType: iPhone15,2\nProductVersion: 17.6.1\nBatteryCurrentCapacity: 86\nUniqueDeviceID: UDID12345678');
  assert.deepEqual(info, {
    serial: 'UDID12345678',
    model: 'QA iPhone',
    productType: 'iPhone15,2',
    iosVersion: '17.6.1',
    batteryLevel: 86,
    state: 'device',
    platform: 'ios'
  });
});

test('parses tidevice rows and system profiler iPhone records', () => {
  const rows = __test.parseTideviceList('ABCDEF123456 QA iPhone [online]\n1234567890AB iPhone 15 [offline]');
  assert.equal(rows[0].model, 'QA iPhone');
  assert.equal(rows[0].state, 'online');
  const devices = __test.parseUsbDevices({ SPUSBDataType: [{ _name: 'iPhone', manufacturer: 'Apple Mobile Device', serial_num: 'UDID12345678' }] });
  assert.deepEqual(devices[0], { serial: 'UDID12345678', model: 'iPhone', state: 'connected', platform: 'ios', source: 'system_profiler' });
});

test('builds cross-platform screenshot commands', () => {
  assert.deepEqual(__test.buildScreenshotCommand('idevicescreenshot', 'UDID12345678', '/tmp/frame.png'), {
    command: 'idevicescreenshot', args: ['-u', 'UDID12345678', '/tmp/frame.png']
  });
  assert.deepEqual(__test.buildScreenshotCommand('tidevice', 'UDID12345678', 'C:\\Temp\\frame.png'), {
    command: 'tidevice', args: ['-u', 'UDID12345678', 'screenshot', 'C:\\Temp\\frame.png']
  });
  assert.throws(() => __test.buildScreenshotCommand('wda', 'UDID12345678', '/tmp/frame.png'), /不支持/);
});

test('resolves Windows command candidates including executable paths', () => {
  const candidates = __test.commandCandidates('idevicescreenshot', 'win32', {
    IDEVICESCREENSHOT_PATH: 'D:\\tools\\idevicescreenshot.exe',
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)'
  });
  assert.equal(candidates[0], 'D:\\tools\\idevicescreenshot.exe');
  assert.ok(candidates.includes('idevicescreenshot.exe'));
  assert.ok(candidates.includes('C:\\Program Files\\libimobiledevice\\idevicescreenshot.exe'));
});

test('parses pymobiledevice3 short-info rows used by the bundled iOS runtime', () => {
  const rows = __test.parseUsbmuxDevices('[{"UniqueDeviceID":"UDID3","DeviceName":"QA iPhone 15","ProductType":"iPhone15,2","ProductVersion":"17.1.1","ConnectionType":"USB"}]');
  assert.deepEqual(rows[0], { serial: 'UDID3', model: 'QA iPhone 15', state: 'device', platform: 'ios', connectionType: 'USB', source: 'pymobiledevice3', iosVersion: '17.1.1' });
});

test('uses the bundled pymobiledevice3 runtime when native screenshot tools are unavailable', async () => {
  const service = new IosMirrorService({ runtimeRoots: ['/runtime/ios'], onFrame: () => {}, onStatus: () => {} });
  service.commandPath = async () => null;
  service.pythonPath = async () => '/runtime/ios/darwin-arm64/bin/python3';
  service.runPython = async () => ({ stdout: '[{"UniqueDeviceID":"UDID3","DeviceName":"QA iPhone 15"}]' });
  const devices = await service.listDevices();
  assert.equal(devices[0].serial, 'UDID3');
  assert.equal((await service.resolveScreenshotTool()).type, 'pymobiledevice3');
});

test('starts the iOS 17 tunnel before a bundled-runtime mirror session', async () => {
  let tunnelCalls = 0;
  const service = new IosMirrorService({
    ensureTunnel: async () => { tunnelCalls += 1; },
    onFrame: () => {},
    onStatus: () => {}
  });
  service.resolveScreenshotTool = async () => ({ type: 'pymobiledevice3', path: '/runtime/python3' });
  service.listDevices = async () => [{ serial: 'UDID3', model: 'QA iPhone 15', iosVersion: '17.1.1', state: 'device', platform: 'ios' }];
  service.scheduleFrame = () => {};
  const meta = await service.start({ serial: 'UDID3' });
  assert.equal(tunnelCalls, 1);
  assert.equal(service.session.requiresTunnel, true);
  assert.equal(meta.model, 'QA iPhone 15');
  await service.stop(false);
});

test('converts missing screenshot output into an actionable message', () => {
  assert.match(__test.classifyScreenshotFailure({ stderr: 'Unable to connect to Tunneld' }).message, /桥接未就绪/);
  assert.match(__test.classifyScreenshotFailure({ stderr: 'Device not found' }).message, /已断开/);
  assert.doesNotMatch(__test.classifyScreenshotFailure({ message: 'ENOENT /tmp/screen.png' }).message, /\/tmp|ENOENT/);
});

test('normalizes screenshot buffers and data URLs', () => {
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
  assert.equal(__test.normalizeScreenshotData(Buffer.from(base64, 'base64')), `data:image/png;base64,${base64}`);
  assert.equal(__test.normalizeScreenshotData(base64), `data:image/png;base64,${base64}`);
  assert.equal(__test.normalizeScreenshotData(`data:image/png;base64,${base64}`), `data:image/png;base64,${base64}`);
  assert.equal(__test.normalizeScreenshotData('not-an-image'), null);
});

test('starts a view-only session without WDA settings', async () => {
  const statuses = [];
  const service = new IosMirrorService({ onFrame: () => {}, onStatus: (status) => statuses.push(status) });
  service.resolveScreenshotTool = async () => ({ type: 'idevicescreenshot', path: '/tools/idevicescreenshot' });
  service.listDevices = async () => [{ serial: 'UDID12345678', model: 'QA iPhone', state: 'device', platform: 'ios' }];
  service.scheduleFrame = () => {};
  const meta = await service.start({ serial: 'UDID12345678', interval: 100 });
  assert.equal(meta.model, 'QA iPhone');
  assert.equal(meta.controlSupported, false);
  assert.equal(meta.streamMode, 'USB 截图轮询');
  assert.equal(meta.interval, 300);
  assert.equal(typeof service.sendControl, 'undefined');
  assert.equal(statuses.at(-1).phase, 'streaming');
  await service.stop(false);
});

test('validates iOS service input before resolving screenshot tools', async () => {
  const service = new IosMirrorService({ onFrame: () => {}, onStatus: () => {} });
  let resolved = false;
  service.resolveScreenshotTool = async () => { resolved = true; return null; };
  await assert.rejects(() => service.start({ serial: '' }), /有效的 iPhone/);
  assert.equal(resolved, false);
});
