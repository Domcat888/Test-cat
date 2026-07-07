const test = require('node:test');
const assert = require('node:assert/strict');
const { MobileMirrorService, __test } = require('../src/mobile-mirror-service');

test('device environment parsers normalize Android command output', () => {
  const properties = __test.parseProperties('[ro.product.manufacturer]: [Google]\n[ro.product.model]: [Pixel 8]\n[ro.build.version.release]: [15]');
  assert.equal(properties['ro.product.model'], 'Pixel 8');
  assert.deepEqual(__test.parseResolution('Physical size: 1080x2400\nOverride size: 720x1600'), { width: 720, height: 1600, source: '系统当前分辨率' });
  assert.equal(__test.parseCpuCoreCount('0-3,6-7'), 6);
  assert.equal(__test.parseMemory('MemTotal:       11796480 kB').totalGb, 11.3);
  const battery = __test.parseBattery('AC powered: false\nUSB powered: true\nstatus: 2\nhealth: 2\nlevel: 86\nscale: 100\ntemperature: 352');
  assert.equal(battery.level, 86);
  assert.equal(battery.status, '充电中');
  assert.equal(battery.temperature, 35.2);
  assert.deepEqual(battery.plugged, ['USB']);
});

test('network and foreground app parsers use the active Android state', () => {
  const network = __test.parseNetwork({
    connectivity: 'NetworkAgentInfo [WIFI () - 100] CONNECTED VALIDATED',
    wifi: 'mWifiInfo BSSID: 00:11:22:33:44:55, SSID: "TestLab", Supplicant state: COMPLETED',
    route: 'default via 192.168.1.1 dev wlan0',
    ipAddress: '12: wlan0 inet 192.168.1.8/24 scope global wlan0',
    airplaneMode: '0',
    properties: {}
  });
  assert.equal(network.type, 'Wi-Fi');
  assert.equal(network.ssid, 'TestLab');
  assert.equal(network.ipv4, '192.168.1.8');
  assert.equal(__test.parseForegroundPackage('topResumedActivity=ActivityRecord{1 u0 com.example.game/.MainActivity t1}'), 'com.example.game');
});

test('device information collection produces a formal copy-ready bug report', async () => {
  const service = new MobileMirrorService({ appPath: '/tmp', onStatus: () => {} });
  service.ensureServerClient = async () => ({
    getDevices: async () => [{ serial: 'ABC123', state: 'device', model: 'Pixel 8', device: 'husky' }]
  });
  service.safeAdb = async (_serial, args) => {
    const command = args.join(' ');
    if (command === 'shell getprop') return [
      '[ro.product.manufacturer]: [Google]', '[ro.product.model]: [Pixel 8]', '[ro.product.device]: [husky]',
      '[ro.build.version.release]: [15]', '[ro.build.version.sdk]: [35]', '[ro.soc.manufacturer]: [Google]', '[ro.soc.model]: [Tensor G3]'
    ].join('\n');
    if (command === 'shell wm size') return 'Physical size: 1080x2400';
    if (command === 'shell cat /proc/meminfo') return 'MemTotal:       8388608 kB';
    if (command === 'shell cat /sys/devices/system/cpu/present') return '0-8';
    if (command === 'shell dumpsys battery') return 'USB powered: true\nstatus: 2\nhealth: 2\nlevel: 80\nscale: 100\ntemperature: 330';
    if (command.startsWith('shell for z in /sys/class/thermal/')) return 'cpu-thermal=41000';
    if (command === 'shell dumpsys connectivity') return 'NetworkAgentInfo WIFI CONNECTED VALIDATED';
    if (command === 'shell dumpsys wifi') return 'mWifiInfo SSID: "QA-Lab", Supplicant state: COMPLETED';
    if (command === 'shell ip route') return 'default via 10.0.0.1 dev wlan0';
    if (command.includes('ip -o -4 addr')) return '8: wlan0 inet 10.0.0.8/24 scope global wlan0';
    if (command.includes('airplane_mode_on')) return '0';
    if (command === 'shell dumpsys activity activities') return 'topResumedActivity=ActivityRecord{1 u0 com.example.app/.MainActivity t1}';
    if (command === 'get-devpath') return 'usb:1-1';
    if (command === 'shell dumpsys package com.example.app') return 'versionCode=123 minSdk=23\nversionName=1.2.3';
    return '';
  };
  const info = await service.getDeviceInfo({ serial: 'ABC123' });
  assert.equal(info.resolution.width, 1080);
  assert.equal(info.cpu.cores, 9);
  assert.equal(info.temperature.value, 41);
  assert.equal(info.network.type, 'Wi-Fi');
  assert.equal(info.app.packageName, 'com.example.app');
  assert.equal(info.app.versionName, '1.2.3');
  assert.match(info.report, /【缺陷环境信息】/);
  assert.match(info.report, /手机型号：Google Pixel 8/);
  assert.match(info.report, /App 包名：com\.example\.app/);
  assert.match(info.report, /versionCode：123/);
});
