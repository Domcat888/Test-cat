const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WeakNetworkService, WeakNetworkProxy, normalizeProfile, parseDevices, parseForegroundComponent, parseUiHierarchy, classifyInstallError } = require('../src/weak-network-service');

test('parseDevices extracts adb state and model', () => {
  const devices = parseDevices('List of devices attached\nABC123 device product:p model:Pixel_8 device:x transport_id:1\nXYZ unauthorized usb:1-2\n');
  assert.deepEqual(devices, [
    { serial: 'ABC123', state: 'device', model: 'Pixel 8' },
    { serial: 'XYZ', state: 'unauthorized', model: 'Android 设备' }
  ]);
});

test('parseForegroundComponent extracts the active app for weak-network restore', () => {
  assert.deepEqual(
    parseForegroundComponent('mCurrentFocus=Window{a1 u0 com.example.game/.MainActivity}'),
    { packageName: 'com.example.game', component: 'com.example.game/.MainActivity' }
  );
  assert.deepEqual(
    parseForegroundComponent('topResumedActivity=ActivityRecord{42 u0 com.demo/com.demo.PlayActivity t3}'),
    { packageName: 'com.demo', component: 'com.demo/com.demo.PlayActivity' }
  );
  assert.equal(parseForegroundComponent('mCurrentFocus=null'), null);
});

test('normalizeProfile clamps unsafe custom values', () => {
  const profile = normalizeProfile({ id: 'elevator', downKbps: 1, latencyMs: 99999, instability: -2 });
  assert.equal(profile.downKbps, 16);
  assert.equal(profile.latencyMs, 10000);
  assert.equal(profile.instability, 0);
  assert.equal(profile.name, '电梯');
});

test('parses Android UI hierarchy nodes used for release-agent configuration', () => {
  const nodes = parseUiHierarchy('<hierarchy><node text="UDP relay over TCP" resource-id="hev.sockstun:id/udp_in_tcp" checked="true" enabled="true" bounds="[20,40][120,80]" /></hierarchy>');
  assert.equal(nodes[0]['resource-id'], 'hev.sockstun:id/udp_in_tcp');
  assert.equal(nodes[0].checked, true);
  assert.deepEqual(nodes[0].center, { x: 70, y: 60 });
});

test('classifies recoverable and actionable APK installation failures', () => {
  assert.equal(classifyInstallError({ stderr: 'Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]' }).code, 'replace-required');
  assert.equal(classifyInstallError({ stderr: 'Failure [INSTALL_FAILED_DEPRECATED_SDK_VERSION]' }).code, 'low-target');
  assert.match(classifyInstallError({ stderr: 'Failure [INSTALL_FAILED_USER_RESTRICTED]' }).message, /USB 安装/);
});

test('encodes the official UDP-in-TCP relay framing', () => {
  const proxy = new WeakNetworkProxy({ id: '3g' });
  const payload = Buffer.from([1, 2, 3, 4]);
  const packet = proxy.createRelayPacket('127.0.0.1', 5353, payload);
  assert.equal(packet.readUInt16BE(0), packet.length);
  assert.equal(packet[2], 10);
  assert.equal(packet[3], 1);
  assert.equal(packet.readUInt16BE(8), 5353);
  assert.deepEqual(packet.subarray(packet[2]), payload);
});

test('replaces an incompatible installed agent and retries deployment', async () => {
  const calls = [];
  const service = new WeakNetworkService({ appPath: path.join(__dirname, '..') });
  service.adb = async (args) => {
    calls.push(args);
    if (args.includes('install') && args.includes('-r')) {
      const error = new Error('install failed');
      error.stderr = 'Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]';
      throw error;
    }
    if (args.includes('install')) return 'Success';
    return 'Success';
  };
  await service.deployAgent('emulator-5554');
  assert.ok(calls.some((args) => args.includes('uninstall')));
  assert.equal(calls.filter((args) => args.includes('install')).length, 2);
});

test('extracts weak-network agent from asar path before adb install', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cat-weak-agent-'));
  const fakeAsar = path.join(tempRoot, 'app.asar');
  const source = path.join(__dirname, '../resources/weak-network/sockstun-agent.apk');
  const bundled = path.join(fakeAsar, 'resources/weak-network/sockstun-agent.apk');
  fs.mkdirSync(path.dirname(bundled), { recursive: true });
  fs.copyFileSync(source, bundled);
  const service = new WeakNetworkService({ appPath: fakeAsar });
  const resolved = service.verifyAgent();
  assert.ok(fs.existsSync(resolved));
  assert.ok(!resolved.includes('.asar'));
  assert.ok(resolved.endsWith('.apk'));
});

test('configures the release agent through its public UI without run-as', async () => {
  const commands = [];
  const tapped = [];
  const service = new WeakNetworkService({ appPath: path.join(__dirname, '..') });
  const node = (id, checked = false) => ({ 'resource-id': `hev.sockstun:id/${id}`, checked, enabled: true, center: { x: 10, y: 10 }, text: id === 'control' ? 'Enable' : '' });
  const nodes = [node('socks_addr'), node('socks_port'), node('udp_in_tcp', true), node('remote_dns', true), node('global', true), node('ipv4', true), node('ipv6', false), node('save'), node('control')];
  service.dumpUi = async () => nodes;
  service.tapNode = async (_serial, item) => tapped.push(item['resource-id']);
  service.acceptVpnPermission = async () => false;
  service.adb = async (args) => {
    commands.push(args);
    if (args.includes('pidof')) return '1234\n';
    return '';
  };
  await service.configureAgent('emulator-5554');
  assert.ok(tapped.some((id) => id.endsWith('/save')));
  assert.ok(tapped.some((id) => id.endsWith('/control')));
  assert.ok(commands.some((args) => args.includes('127.0.0.1')));
  assert.ok(commands.every((args) => !args.includes('run-as')));
});

test('weak-network returns to the previous foreground app after enabling agent', async () => {
  const commands = [];
  const service = new WeakNetworkService({ appPath: path.join(__dirname, '..') });
  service.adb = async (args) => {
    commands.push(args);
    if (args.includes('pidof')) return '1234\n';
    return '';
  };
  await service.waitForAgentProcess('SERIAL', {
    packageName: 'com.example.game',
    component: 'com.example.game/.MainActivity'
  });
  assert.ok(commands.some((args) => args.includes('am') && args.includes('start') && args.includes('com.example.game/.MainActivity')));
  assert.ok(!commands.some((args) => args.includes('KEYCODE_HOME')));
});

test('weak-network prefers Back to return without relaunching the previous app', async () => {
  const commands = [];
  const service = new WeakNetworkService({ appPath: path.join(__dirname, '..') });
  service.adb = async (args) => {
    commands.push(args);
    if (args.includes('pidof')) return '1234\n';
    if (args.includes('dumpsys') && args.includes('window')) return 'mCurrentFocus=Window{x u0 com.example.game/.MainActivity}';
    return '';
  };
  await service.waitForAgentProcess('SERIAL', {
    packageName: 'com.example.game',
    component: 'com.example.game/.MainActivity'
  });
  assert.ok(commands.some((args) => args.includes('KEYCODE_BACK')));
  assert.ok(!commands.some((args) => args.includes('am') && args.includes('start')));
  assert.ok(!commands.some((args) => args.includes('KEYCODE_HOME')));
});

test('uses the landscape emulator coordinate fallback when UI hierarchy is unavailable', async () => {
  const fields = [];
  const taps = [];
  const service = new WeakNetworkService({ appPath: path.join(__dirname, '..') });
  service.getScreenSize = async () => ({ width: 1000, height: 600 });
  service.setTextField = async (_serial, item, value) => fields.push({ center: item.center, value });
  service.tapNode = async (_serial, item, label) => taps.push({ center: item.center, label });
  await service.configureEmulatorByCoordinates('emulator-5554');
  assert.deepEqual(fields.map((item) => item.value), ['127.0.0.1', '27183']);
  assert.deepEqual(fields.map((item) => item.center.y), [117, 232]);
  assert.ok(taps.some((item) => item.label === 'UDP relay over TCP' && item.center.x === 515));
  assert.ok(taps.some((item) => item.label === 'Enable' && item.center.x === 750));
  assert.ok(taps.some((item) => item.label === 'VPN 授权'));
});
