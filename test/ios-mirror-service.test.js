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
  assert.deepEqual(__test.buildPymobiledeviceScreenshotArgs('UDID12345678', '/tmp/frame.png', 'userspace'), [
    '-m', 'pymobiledevice3', '--no-color', 'developer', 'dvt', 'screenshot', '--userspace', '--udid', 'UDID12345678', '/tmp/frame.png'
  ]);
  assert.deepEqual(__test.buildPymobiledeviceScreenshotArgs('UDID12345678', '/tmp/frame.png', 'tunnel'), [
    '-m', 'pymobiledevice3', '--no-color', 'developer', 'dvt', 'screenshot', '--tunnel', 'UDID12345678', '/tmp/frame.png'
  ]);
  assert.deepEqual(__test.buildPymobiledeviceMounterArgs('UDID12345678', 'tunnel'), [
    '-m', 'pymobiledevice3', '--no-color', 'mounter', 'auto-mount', '--tunnel', 'UDID12345678'
  ]);
  assert.deepEqual(__test.buildPymobiledeviceWebStreamArgs('UDID12345678', 18662), [
    '-m', 'pymobiledevice3', '--no-color', 'developer', 'core-device', 'display', 'serve-web',
    '--tunnel', 'UDID12345678', '--bind', '127.0.0.1', '--http-port', '18662', '--no-audio'
  ]);
  assert.deepEqual(__test.buildPymobiledeviceMediaSupportArgs('UDID12345678'), [
    '-m', 'pymobiledevice3', '--no-color', 'developer', 'core-device', 'display',
    'get-media-support-info', '--tunnel', 'UDID12345678'
  ]);
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

test('starts the HEVC web stream for iOS 17 mirror sessions', async () => {
  const service = new IosMirrorService({ onFrame: () => {}, onStatus: () => {}, platform: 'win32' });
  service.resolveScreenshotTool = async () => ({ type: 'pymobiledevice3', path: '/runtime/python3' });
  service.listDevices = async () => [{ serial: 'UDID3', model: 'QA iPhone 15', iosVersion: '17.1.1', state: 'device', platform: 'ios' }];
  service.scheduleFrame = () => {};
  service.ensureTunnel = async () => {};
  service.supportsCoreDeviceStream = async () => true;
  service.startWebStream = async () => 'http://127.0.0.1:18662/';
  const meta = await service.start({ serial: 'UDID3' });
  assert.equal(service.session.usesUserspace, false);
  assert.equal(service.session.usesTunnel, true);
  assert.equal(meta.model, 'QA iPhone 15');
  assert.equal(meta.streamMode, 'USB HEVC 实时视频流');
  assert.equal(meta.streamUrl, 'http://127.0.0.1:18662/');
  await service.stop(false);
});

test('uses the persistent DVT stream when the iPhone reports no CoreDevice video features', async () => {
  const service = new IosMirrorService({ onFrame: () => {}, onStatus: () => {}, platform: 'win32' });
  service.resolveScreenshotTool = async () => ({ type: 'pymobiledevice3', path: '/runtime/python3' });
  service.listDevices = async () => [{ serial: 'UDID3', model: 'QA iPhone 14', iosVersion: '17.1.1', state: 'device', platform: 'ios' }];
  service.ensureTunnel = async () => {};
  service.supportsCoreDeviceStream = async () => false;
  service.startDvtStream = async () => {};
  const meta = await service.start({ serial: 'UDID3' });
  assert.equal(meta.streamMode, 'USB DVT 持续画面');
  assert.equal(service.session.streamMode, 'dvt');
  await service.stop(false);
});

test('prefers the Valeria H.264 stream on macOS without starting a tunnel', async () => {
  let tunnelStarts = 0;
  let valeriaStarts = 0;
  const service = new IosMirrorService({
    onFrame: () => {}, onStatus: () => {}, platform: 'darwin',
    ensureTunnel: async () => { tunnelStarts += 1; }
  });
  service.resolveScreenshotTool = async () => ({ type: 'pymobiledevice3', path: '/runtime/python3' });
  service.listDevices = async () => [{ serial: 'UDID3', model: 'QA iPhone 14', iosVersion: '17.1.1', state: 'device', platform: 'ios' }];
  service.startValeriaStream = async () => { valeriaStarts += 1; };
  const meta = await service.start({ serial: 'UDID3' });
  assert.equal(meta.streamMode, 'USB H.264 实时视频流');
  assert.equal(service.session.streamMode, 'valeria');
  assert.equal(valeriaStarts, 1);
  assert.equal(tunnelStarts, 0);
  await service.stop(false);
});

test('converts missing screenshot output into an actionable message', () => {
  assert.equal(__test.isUserspaceUnavailable({ stderr: 'no-root userspace tunnel unavailable: no RemotePairing service' }), true);
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
  assert.equal(meta.streamMode, 'USB 截图兼容模式');
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
