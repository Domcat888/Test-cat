const test = require('node:test');
const assert = require('node:assert/strict');
const { PerformanceMonitorService, __test } = require('../src/performance-monitor-service');

test('calculates device CPU and real iowait from /proc/stat deltas', () => {
  const previous = __test.parseCpuStat('cpu 100 0 100 700 100 0 0 0');
  const current = __test.parseCpuStat('cpu 150 0 150 1300 150 0 0 0');
  const result = __test.calculateCpuDelta(current, previous);
  assert.equal(result.usage.toFixed(2), '13.33');
  assert.equal(result.ioWait.toFixed(2), '6.67');
});

test('normalizes CPU frequency reported in kHz and Hz', () => {
  assert.equal(__test.parseCpuFrequency('1800000\n2200000'), 2000);
  assert.equal(__test.parseCpuFrequency('1800000000\n2200000000'), 2000);
});

test('uses CPU/SOC thermal zones and excludes battery or GPU sensors', () => {
  const result = __test.parseCpuTemperature('battery|42000\ngpu-therm|68000\ncpu-big|73500\nsoc|69000');
  assert.deepEqual(result, { type: 'cpu-big', value: 73.5 });
  assert.equal(__test.parseCpuTemperature('battery|42000\nskin|35000'), null);
});

test('parses system and application PSS memory in MB', () => {
  assert.deepEqual(__test.parseMeminfo('MemTotal: 8192000 kB\nMemAvailable: 3072000 kB'), { total: 8000, used: 5000, estimatedAvailable: false });
  assert.deepEqual(__test.parseAppMemory('TOTAL PSS: 524288\nGL mtrack: 65536'), { pssMb: 512, graphicsMb: 64 });
});

test('sums CPU ticks from all processes in the target package', () => {
  const first = '123 (com.example.app) S 1 2 3 4 5 6 7 8 9 10 120 30 0 0';
  const second = '456 (com.example.app:worker) S 1 2 3 4 5 6 7 8 9 10 20 10 0 0';
  assert.equal(__test.parseProcessTicks(`${first}\n${second}`), 180);
});

test('keeps app UID traffic separate and parses device fallback counters', () => {
  assert.deepEqual(__test.parseNetworkCounters('source=uid_stat\nrx=1000\ntx=400'), { rx: 1000, tx: 400, scope: 'app', source: 'uid_stat' });
  const device = __test.parseNetworkCounters('source=device\nwlan0: 1000 0 0 0 0 0 0 0 500 0 0 0 0 0 0 0\nlo: 99 0 0 0 0 0 0 0 99 0 0 0 0 0 0 0');
  assert.deepEqual(device, { rx: 1000, tx: 500, scope: 'device', source: 'proc-net-dev' });
});

test('parses only the /data backing block device statistics', () => {
  const result = __test.parseDiskStat('device=dm-8\nstat=10 0 100 20 30 0 200 40 0 50 60');
  assert.deepEqual(result, { device: 'dm-8', readBytes: 51200, writeBytes: 102400, busyMs: 50 });
});

test('converts power supply micro-units and rejects implausible readings', () => {
  assert.equal(__test.parsePower('current=-1000000\nvoltage=4000000').watts, 4);
  assert.equal(__test.parsePower('current=-1000\nvoltage=4000'), null);
  assert.equal(__test.parsePower('current=999999999\nvoltage=4000000'), null);
});

test('parses exact four-packet latency and loss values', () => {
  assert.deepEqual(__test.parsePing('4 packets transmitted, 3 received, 25% packet loss\nrtt min/avg/max/mdev = 10.0/12.5/14.0/1.0 ms'), { latency: 12.5, packetLoss: 25 });
});

test('parses SurfaceFlinger presentation timestamps without sentinel values', () => {
  const result = __test.parseSurfaceFlingerLatency('16666666\n100 200 300\n200 300 400\n0 9223372036854775807 0');
  assert.deepEqual(result, { refreshPeriodNs: 16666666, timestamps: [200, 300] });
});

test('parses gfxinfo counters without converting smooth-frame ratio to FPS', () => {
  assert.deepEqual(__test.parseGfxSummary('Total frames rendered: 120\nJanky frames: 8 (6.67%)'), { total: 120, janky: 8 });
});

test('deduplicates crash and ANR events for the selected package', () => {
  const log = [
    '1700000000.123 123 123 E AndroidRuntime: FATAL EXCEPTION: main',
    '1700000000.124 123 123 E AndroidRuntime: Process: com.example.app, PID: 123',
    '1700000001.000 222 222 I am_anr: [0,123,com.example.app,0,Input dispatching timed out]'
  ].join('\n');
  assert.equal(__test.parseCrashEventKeys(log, 'com.example.app').size, 2);
  assert.equal(__test.parseCrashEventKeys(log, 'com.other.app').size, 0);
});

test('recognizes launchers as ignored foreground packages', () => {
  assert.equal(__test.isIgnoredForegroundPackage('com.android.systemui'), true);
  assert.equal(__test.isIgnoredForegroundPackage('com.miui.home'), true);
  assert.equal(__test.isIgnoredForegroundPackage('com.google.android.apps.nexuslauncher'), true);
  assert.equal(__test.isIgnoredForegroundPackage('com.example.game'), false);
});

test('app metrics become unavailable after the target app is killed', async () => {
  const service = new PerformanceMonitorService({
    onSample: () => {},
    onStatus: () => {}
  });
  const session = {
    serial: 'SERIAL',
    model: 'Android',
    metrics: ['cpu', 'memory', 'app'],
    packageName: 'com.example.game',
    packageUid: null,
    foregroundPackage: 'com.example.game',
    followForeground: false,
    networkTarget: '8.8.8.8',
    interval: 1000,
    startedAt: Date.now() - 1000,
    previous: {
      timestamp: Date.now() - 1000,
      cpu: __test.parseCpuStat('cpu 100 0 100 700 100 0 0 0'),
      appTicks: 100
    },
    sampleIndex: 0,
    stopped: false,
    probe: { latency: null, packetLoss: null, measuredAt: 0, running: false },
    crashSeen: new Set(),
    crashCount: 0,
    crashSupported: true,
    surfaceLayer: null,
    lastForegroundNotice: '',
    lastAppRunningState: true
  };
  service.adb = async (args) => {
    if (args.includes('dumpsys') && args.includes('activity')) return 'topResumedActivity=ActivityRecord{u0 com.miui.home/.Launcher}';
    return [
      '__PROC_STAT__',
      'cpu 150 0 150 1300 150 0 0 0',
      '__CPU_CORES__',
      '8',
      '__APP_PIDS__',
      '',
      '__APP_PROC__',
      '',
      '__CPU_FREQ__',
      '',
      '__THERMAL__',
      '',
      '__MEMINFO__',
      'MemTotal: 8192000 kB\nMemAvailable: 4096000 kB',
      '__APP_MEM__',
      'TOTAL PSS: 524288',
      '__GPU__',
      'unavailable',
      '__GPU_FREQ__',
      'unavailable',
      '__NET__',
      'source=device',
      '__DISK__',
      'unavailable',
      '__DF__',
      '',
      '__BATTERY__',
      '',
      '__POWER__',
      '',
      '__GFX__',
      '',
      '__END__'
    ].join('\n');
  };
  const sample = await service.collectSample(session);
  assert.equal(sample.packageName, 'com.example.game');
  assert.equal(sample.appState.running, false);
  assert.equal(sample.appCpuUsage, null);
  assert.equal(sample.appMemory, null);
  assert.match(sample.quality.appCpuUsage.reason, /未运行|杀掉/);
});

test('resolves bundled ADB candidates for Windows and macOS', () => {
  const root = '/runtime/platform-tools';
  assert.deepEqual(__test.adbCandidates([root], {}, 'win32', 'x64'), [
    '/runtime/platform-tools/win32-x64/adb.exe',
    'adb.exe'
  ]);
  assert.deepEqual(__test.adbCandidates([root], {}, 'darwin', 'arm64'), [
    '/runtime/platform-tools/darwin-arm64/adb',
    'adb'
  ]);
});
