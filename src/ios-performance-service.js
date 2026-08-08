const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const http = require('node:http');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 12 * 1024 * 1024;
const PAGE_SIZE = 16 * 1024;
const DEFAULT_INTERVAL = 2000;
const MAX_DIAGNOSTIC_LOG_SIZE = 2 * 1024 * 1024;
const ALLOWED_METRICS = new Set(['cpu', 'memory', 'thermal', 'graphics', 'app']);

function cleanOutput(value) {
  return String(value || '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function errorText(result) {
  return cleanOutput(result?.stderr || result?.stdout || '');
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function appleScriptString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function parseSystemSnapshot(output) {
  const values = {};
  for (const rawLine of cleanOutput(output).split(/\r?\n/)) {
    const match = rawLine.trim().match(/^([A-Za-z_]+)\s*:\s*(-?[\d.]+)/);
    if (match) values[match[1]] = number(match[2]);
  }
  const totalLoad = values.CPU_TotalLoad;
  const cores = values.EnabledCPUs || values.CPUCount;
  const cpuUsage = Number.isFinite(totalLoad) && Number.isFinite(cores) && cores > 0
    ? clamp(totalLoad / cores, 0, 100)
    : null;
  const usedPages = values.vmUsedCount;
  const freePages = values.vmFreeCount;
  const externalPages = values.vmExtPageCount;
  let memoryUsed = null;
  let memoryTotal = null;
  if ([usedPages, freePages, externalPages].every((value) => Number.isFinite(value) && value >= 0) && externalPages <= usedPages) {
    memoryUsed = (usedPages - externalPages) * PAGE_SIZE;
    memoryTotal = (usedPages + freePages) * PAGE_SIZE;
    if (memoryTotal <= 0 || memoryUsed > memoryTotal) {
      memoryUsed = null;
      memoryTotal = null;
    }
  }
  return { cpuUsage, enabledCpuCount: Number.isFinite(cores) ? cores : null, memoryUsed, memoryTotal };
}

function parseBatterySnapshot(output) {
  const source = cleanOutput(output);
  let value;
  try { value = JSON.parse(source); } catch { value = null; }
  const values = {};
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    for (const [key, item] of Object.entries(node)) {
      if (typeof item === 'number' || typeof item === 'string' || typeof item === 'boolean') {
        const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
        values[normalized] = number(item);
      }
      walk(item);
    }
  };
  walk(value);
  const rawTemperature = values.temperature;
  const temperature = Number.isFinite(rawTemperature) ? rawTemperature / (Math.abs(rawTemperature) > 200 ? 100 : 1) : null;
  const rawBattery = values.currentcapacity ?? values.batterycurrentcapacity ?? values.batterypercent ?? values.level;
  const batteryLevel = Number.isFinite(rawBattery) && rawBattery >= 0 && rawBattery <= 100 ? rawBattery : null;
  const charging = values.ischarging === 1 || values.ischarging === true || values.charging === 1 || values.charging === true ? true
    : values.ischarging === 0 || values.charging === 0 ? false : null;
  return { batteryLevel, temperature, charging };
}

function classifyTemperature(value) {
  if (!Number.isFinite(value)) return null;
  if (value < 35) return 'nominal';
  if (value < 40) return 'fair';
  if (value < 45) return 'serious';
  return 'critical';
}

function parseGraphicsSnapshot(output) {
  let value;
  try { value = JSON.parse(cleanOutput(output)); } catch { return { fps: null, gpuUsage: null }; }
  const fps = number(value?.CoreAnimationFramesPerSecond);
  const gpuUsage = number(value?.['Device Utilization %']);
  return {
    fps: Number.isFinite(fps) && fps >= 0 && fps <= 240 ? fps : null,
    gpuUsage: Number.isFinite(gpuUsage) && gpuUsage >= 0 && gpuUsage <= 100 ? gpuUsage : null
  };
}

function parseInstalledApps(output) {
  let value;
  try { value = JSON.parse(cleanOutput(output)); } catch { return []; }
  const apps = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const bundleId = node.CFBundleIdentifier || node.bundleIdentifier || node.bundle_id || node.identifier;
    if (bundleId && typeof bundleId === 'string' && bundleId.includes('.')) {
      const executable = node.CFBundleExecutable || node.executable || node.execName || '';
      apps.push({
        name: String(node.CFBundleDisplayName || node.CFBundleName || node.displayName || node.name || bundleId),
        bundleId: String(bundleId),
        executable: String(executable || '').trim()
      });
      return;
    }
    Object.values(node).forEach(walk);
  };
  walk(value);
  return [...new Map(apps.map((app) => [app.bundleId, app])).values()].sort((a, b) => a.name.localeCompare(b.name));
}

function parseUsbmuxDevices(output) {
  let value;
  try { value = JSON.parse(cleanOutput(output)); } catch { return []; }
  const rows = Array.isArray(value) ? value : value?.devices || value?.DeviceList || [];
  return rows.map((row) => {
    if (typeof row === 'string') return { serial: row, model: 'iPhone', state: 'device', platform: 'ios', source: 'pymobiledevice3' };
    const properties = row?.Properties || row?.properties || row || {};
    const serial = row?.Identifier || row?.UDID || row?.SerialNumber || properties.SerialNumber || properties.UDID;
    if (!serial) return null;
    return {
      serial: String(serial),
      model: String(row?.DeviceName || row?.ProductType || properties.DeviceName || properties.ProductType || properties.DeviceClass || 'iPhone'),
      state: 'device',
      platform: 'ios',
      connectionType: String(row?.ConnectionType || properties.ConnectionType || 'USB'),
      source: 'pymobiledevice3'
    };
  }).filter(Boolean);
}

function parseProcessSnapshot(output, executable) {
  let value;
  try { value = JSON.parse(cleanOutput(output)); } catch { return null; }
  const rows = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  const expected = String(executable || '').toLowerCase();
  const process = rows.find((row) => {
    const names = [row?.name, row?.execName, row?.executable].filter(Boolean).map((item) => path.basename(String(item)).toLowerCase());
    return names.includes(expected) || names.some((item) => item.endsWith(`/${expected}`) || item.endsWith(`\\${expected}`));
  });
  if (!process) return null;
  const cpu = number(process.cpuUsage);
  const memory = number(process.physFootprint);
  return {
    cpuUsage: Number.isFinite(cpu) && cpu >= 0 ? cpu : null,
    memoryUsed: Number.isFinite(memory) && memory >= 0 ? memory : null
  };
}

function bundledPythonCandidates(runtimeRoots = [], platform = process.platform, arch = process.arch) {
  const folder = `${platform}-${arch}`;
  return runtimeRoots.flatMap((root) => platform === 'win32'
    ? [path.join(root, folder, 'python.exe')]
    : [path.join(root, folder, 'bin', 'python3'), path.join(root, folder, 'bin', 'python')]);
}

function pythonCandidates(environment = process.env, platform = process.platform, options = {}) {
  const configured = [environment.IPM_PYTHON_PATH, environment.PYMOBILEDEVICE3_PYTHON, environment.PYTHON_PATH];
  const system = platform === 'win32' ? ['python.exe', 'python'] : ['python3', 'python'];
  return [...new Set([
    ...(options.bundled || []),
    ...configured,
    ...(options.includeSystem === false ? [] : system)
  ].filter(Boolean))];
}

function parseJsonOutput(output, operation) {
  try {
    return JSON.parse(cleanOutput(output));
  } catch {
    throw new Error(`${operation}返回了无法识别的数据。`);
  }
}

function diagnosticType(filePath) {
  const name = path.basename(String(filePath || '')).toLowerCase();
  if (!/\.(ips|panic)$/.test(name)) return null;
  if (name.startsWith('jetsamevent-') || name.includes('jetsam')) return 'Jetsam';
  if (name.includes('_resource') || /performance|spin|hang/.test(name)) return 'Performance';
  if (/^(analytics-|awdd-|log-aggregated|stacks-|sysdiagnose|shutdown|resetcounter|coretime)/.test(name)) return null;
  return 'Crash';
}

function validTimestamp(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function diagnosticSummary(content, filePath, type) {
  const source = String(content || '');
  let metadata = {};
  const firstLine = source.split(/\r?\n/, 1)[0];
  try { metadata = JSON.parse(firstLine); } catch {}
  const match = (...patterns) => {
    for (const pattern of patterns) {
      const result = source.match(pattern);
      if (result?.[1]) return result[1].trim();
    }
    return '';
  };
  const processName = metadata.app_name || metadata.name || match(/"procName"\s*:\s*"([^"]+)"/i, /Process:\s+([^\[\r\n]+)/i);
  const bundleId = metadata.bundleID || metadata.bundle_id || match(/"bundleID"\s*:\s*"([^"]+)"/i, /Identifier:\s+([^\s\r\n]+)/i);
  const exceptionType = match(/Exception Type:\s+([^\r\n]+)/i, /"exception"\s*:\s*\{[^}]*"type"\s*:\s*"([^"]+)"/is);
  const terminationReason = match(/Termination Reason:\s+([^\r\n]+)/i, /"termination"\s*:\s*\{[^}]*"reason"\s*:\s*"([^"]+)"/is);
  const incidentId = metadata.incident_id || match(/Incident Identifier:\s+([^\s\r\n]+)/i, /"incident"\s*:\s*"([^"]+)"/i);
  const timestamp = validTimestamp(metadata.timestamp || metadata.captureTime || match(/Date\/Time:\s+([^\r\n]+)/i));
  return {
    title: processName ? `${processName} · ${type}` : path.basename(filePath),
    processName,
    bundleId,
    exceptionType,
    terminationReason,
    incidentId,
    timestamp
  };
}

class IosPerformanceService {
  constructor({ onSample = () => {}, onStatus = () => {}, listDevices = async () => [], runtimeRoots = [], packaged = false } = {}) {
    this.onSample = onSample;
    this.onStatus = onStatus;
    this.fallbackListDevices = listDevices;
    this.session = null;
    this.timer = null;
    this.commandCache = new Map();
    this.tunnelProcess = null;
    this.helperPath = null;
    this.packaged = Boolean(packaged);
    this.bundledPython = bundledPythonCandidates(runtimeRoots);
    this.pythonSource = null;
  }

  async pythonPath() {
    if (this.commandCache.has('python')) return this.commandCache.get('python');
    for (const candidate of pythonCandidates(process.env, process.platform, { bundled: this.bundledPython, includeSystem: !this.packaged })) {
      try {
        await execFileAsync(candidate, ['-c', 'import pymobiledevice3'], { timeout: 8000, windowsHide: true, maxBuffer: 512 * 1024 });
        this.commandCache.set('python', candidate);
        this.pythonSource = this.bundledPython.includes(candidate) ? 'bundled' : process.env.IPM_PYTHON_PATH === candidate || process.env.PYMOBILEDEVICE3_PYTHON === candidate || process.env.PYTHON_PATH === candidate ? 'configured' : 'system';
        return candidate;
      } catch {}
    }
    this.commandCache.set('python', null);
    return null;
  }

  async runPython(args, timeout = 20000) {
    const executable = await this.pythonPath();
    if (!executable) throw new Error(this.runtimeUnavailableMessage());
    try {
      return await execFileAsync(executable, ['-m', 'pymobiledevice3', '--no-color', ...args], { timeout, windowsHide: true, maxBuffer: MAX_OUTPUT });
    } catch (error) {
      error.stdout = error.stdout || '';
      error.stderr = error.stderr || '';
      throw error;
    }
  }

  async checkEnvironment() {
    if (!['win32', 'darwin'].includes(process.platform)) {
      return { ready: false, python: null, message: 'iOS 性能采集目前支持 Windows 和 macOS。' };
    }
    const python = await this.pythonPath();
    if (!python) return { ready: false, python: null, bundled: false, message: this.runtimeUnavailableMessage() };
    const bundled = this.pythonSource === 'bundled';
    return { ready: true, python, bundled, message: bundled ? '内置 iOS 采集引擎已就绪' : `开发环境采集引擎已就绪：${python}` };
  }

  runtimeUnavailableMessage() {
    return this.packaged
      ? '内置 iOS 采集引擎缺失或损坏，请重新安装 Test cat。'
      : '内置 iOS 采集引擎尚未准备，请运行 npm run prepare:ios-runtime。';
  }

  async listDevices() {
    try {
      const result = await this.runPython(['usbmux', 'list'], 15000);
      const devices = parseUsbmuxDevices(result.stdout);
      if (devices.length) return devices;
    } catch {}
    try { return await this.fallbackListDevices(); } catch { return []; }
  }

  async getInstalledApps(serial) {
    const result = await this.runPython(['apps', 'list', '--udid', this.validateSerial(serial), '--type', 'User'], 30000);
    if (result.code && result.code !== 0) throw this.commandError(result, '读取 iPhone 安装 App 失败');
    return parseInstalledApps(result.stdout);
  }

  validateSerial(serial) {
    const value = String(serial || '').trim();
    if (!value || value.length > 200 || !/^[a-zA-Z0-9_.:-]+$/.test(value)) throw new Error('请选择有效的 iPhone 设备。');
    return value;
  }

  validateMetrics(metrics) {
    const values = [...new Set((Array.isArray(metrics) ? metrics : ['cpu', 'memory', 'thermal', 'graphics']).map((item) => String(item)))].filter((item) => ALLOWED_METRICS.has(item));
    return values.length ? values : ['cpu', 'memory', 'thermal', 'graphics'];
  }

  validateInterval(interval) {
    const value = Number(interval);
    return Number.isFinite(value) ? Math.max(1000, Math.min(10000, Math.round(value))) : DEFAULT_INTERVAL;
  }

  async start(configuration = {}) {
    await this.stop(false);
    const serial = this.validateSerial(configuration.serial);
    const environment = await this.checkEnvironment();
    if (!environment.ready) throw new Error(environment.message);
    const metrics = this.validateMetrics(configuration.metrics);
    const device = (await this.listDevices()).find((item) => item.serial === serial) || { serial, model: 'iPhone' };
    let developerImageReady = null;
    if (configuration.autoMount !== false) {
      this.onStatus({ phase: 'starting', message: '正在准备 iPhone 开发者服务…' });
      try {
        await this.prepareDeveloperImage(serial);
        developerImageReady = true;
      } catch (error) {
        developerImageReady = false;
        this.onStatus({ phase: 'warning', message: `开发者服务准备失败：${error.message}` });
      }
    }
    let tunnelReady = await this.isTunnelRunning();
    if (!tunnelReady && metrics.includes('graphics') && configuration.autoTunnel !== false) {
      this.onStatus({ phase: 'starting', message: '正在启动 iOS 性能桥接…' });
      try {
        await this.startTunnel();
        tunnelReady = await this.waitForTunnel();
      } catch (error) {
        this.onStatus({ phase: 'warning', message: `性能桥接启动失败：${error.message}` });
      }
    }
    const app = configuration.app && typeof configuration.app === 'object' ? configuration.app : null;
    this.session = {
      serial,
      model: device.model || 'iPhone',
      metrics,
      app,
      interval: this.validateInterval(configuration.interval),
      startedAt: Date.now(),
      stopped: false,
      sampleIndex: 0
    };
    this.onStatus({ phase: 'streaming', message: `iOS 性能采集已开始：${this.session.model}`, serial, model: this.session.model, metrics, bundledRuntime: environment.bundled, platformSupported: true });
    this.scheduleSample(0);
    return { serial, model: this.session.model, metrics, interval: this.session.interval, startedAt: this.session.startedAt, bundledRuntime: environment.bundled, developerImageReady, tunnelReady, platformSupported: true };
  }

  async prepareDeveloperImage(serial) {
    try {
      await this.runPython(['mounter', 'auto-mount', '--udid', this.validateSerial(serial)], 90000);
      return true;
    } catch (error) {
      throw this.commandError(error, 'DeveloperDiskImage 自动挂载失败');
    }
  }

  async collectSystem(session) {
    let result;
    try {
      result = await this.runPython(['developer', 'dvt', 'sysmon', 'system', '--tunnel', session.serial, '--fields', 'CPU_TotalLoad,CPUCount,EnabledCPUs,vmUsedCount,vmFreeCount,vmExtPageCount']);
      if (/device is not connected/i.test(errorText(result))) {
        result = await this.runPython(['developer', 'dvt', 'sysmon', 'system', '--udid', session.serial, '--fields', 'CPU_TotalLoad,CPUCount,EnabledCPUs,vmUsedCount,vmFreeCount,vmExtPageCount']);
      }
    } catch (error) {
      const text = `${error.stdout || ''}\n${error.stderr || ''}`;
      if (/device is not connected/i.test(text)) {
        result = await this.runPython(['developer', 'dvt', 'sysmon', 'system', '--udid', session.serial, '--fields', 'CPU_TotalLoad,CPUCount,EnabledCPUs,vmUsedCount,vmFreeCount,vmExtPageCount']);
      } else throw error;
    }
    if (result?.code && result.code !== 0) throw this.commandError(result, 'iPhone CPU/内存采集失败');
    return parseSystemSnapshot(result.stdout);
  }

  async collectThermal(session) {
    const result = await this.runPython(['diagnostics', 'battery', 'single', '--udid', session.serial]);
    if (result.code && result.code !== 0) throw this.commandError(result, 'iPhone 温度采集失败');
    return parseBatterySnapshot(result.stdout);
  }

  async resolveHelperPath() {
    if (this.helperPath) return this.helperPath;
    const candidates = [
      path.join(process.resourcesPath || '', 'app.asar.unpacked', 'src', 'ios-performance-helper.py'),
      path.join(__dirname, 'ios-performance-helper.py')
    ];
    this.helperPath = candidates.find((candidate) => candidate && require('node:fs').existsSync(candidate)) || null;
    return this.helperPath;
  }

  async runHelper(mode, serial, arguments_ = [], timeout = 30000) {
    const python = await this.pythonPath();
    const helper = await this.resolveHelperPath();
    if (!python || !helper) throw new Error('iOS 采集脚本不可用，请重新安装 Test cat。');
    try {
      const result = await execFileAsync(
        python,
        [helper, mode, '--udid', this.validateSerial(serial), ...arguments_],
        { timeout, windowsHide: true, maxBuffer: MAX_OUTPUT }
      );
      return parseJsonOutput(result.stdout, 'iOS 采集引擎');
    } catch (error) {
      throw this.commandError(error, 'iOS 设备数据读取失败');
    }
  }

  async getDeviceStatus(serial) {
    const result = await this.runHelper('device-info', serial, [], 30000);
    return { ...result, serial: this.validateSerial(serial) };
  }

  async collectDiagnosticLogs(serial) {
    const validatedSerial = this.validateSerial(serial);
    const entries = await this.runHelper('crash-list', validatedSerial, [], 45000);
    const candidates = (Array.isArray(entries) ? entries : [])
      .map((entry) => ({ ...entry, type: diagnosticType(entry.path || entry.name) }))
      .filter((entry) => entry.type && Number(entry.size) > 0 && Number(entry.size) <= MAX_DIAGNOSTIC_LOG_SIZE)
      .sort((left, right) => new Date(right.modifiedAt || 0) - new Date(left.modifiedAt || 0));
    const latestByType = [];
    for (const type of ['Crash', 'Jetsam', 'Performance']) {
      const entry = candidates.find((item) => item.type === type);
      if (entry) latestByType.push(entry);
    }
    const device = (await this.listDevices()).find((item) => item.serial === validatedSerial);
    const records = [];
    for (const entry of latestByType) {
      try {
        const result = await this.runHelper(
          'crash-read',
          validatedSerial,
          ['--remote-path', entry.path, '--max-bytes', String(MAX_DIAGNOSTIC_LOG_SIZE)],
          45000
        );
        if (!result.content || Number(result.size) <= 0 || Number(result.size) > MAX_DIAGNOSTIC_LOG_SIZE) continue;
        const summary = diagnosticSummary(result.content, entry.path, entry.type);
        records.push({
          deviceSerial: validatedSerial,
          deviceName: device?.model || 'iPhone',
          sourcePath: entry.path,
          name: entry.name || path.basename(entry.path),
          type: entry.type,
          occurredAt: summary.timestamp || validTimestamp(entry.modifiedAt) || new Date().toISOString(),
          size: Number(result.size),
          content: result.content,
          summary
        });
      } catch (error) {
        this.onStatus({ phase: 'warning', message: `${entry.type} 日志读取失败：${error.message}` });
      }
    }
    return { records, scanned: candidates.length, selected: latestByType.length };
  }

  async collectGraphics(session) {
    const result = await this.runHelper('graphics', session.serial, ['--timeout', '10'], 18000);
    return parseGraphicsSnapshot(JSON.stringify(result));
  }

  async collectApp(session) {
    if (!session.app?.executable) return { cpuUsage: null, memoryUsed: null, reason: '未选择带可执行文件的 App' };
    let result;
    try {
      result = await this.runPython(['developer', 'dvt', 'sysmon', 'process', 'single', '--tunnel', session.serial, '--key', 'name', '--key', 'execName', '--key', 'cpuUsage', '--key', 'physFootprint']);
      if (/device is not connected/i.test(errorText(result))) {
        result = await this.runPython(['developer', 'dvt', 'sysmon', 'process', 'single', '--udid', session.serial, '--key', 'name', '--key', 'execName', '--key', 'cpuUsage', '--key', 'physFootprint']);
      }
    } catch (error) {
      const text = `${error.stdout || ''}\n${error.stderr || ''}`;
      if (/device is not connected/i.test(text)) {
        result = await this.runPython(['developer', 'dvt', 'sysmon', 'process', 'single', '--udid', session.serial, '--key', 'name', '--key', 'execName', '--key', 'cpuUsage', '--key', 'physFootprint']);
      } else throw error;
    }
    if (result?.code && result.code !== 0) throw this.commandError(result, 'iPhone App 进程采集失败');
    return parseProcessSnapshot(result.stdout, session.app.executable) || { cpuUsage: null, memoryUsed: null, reason: `${session.app.name || session.app.bundleId || '目标 App'} 当前未运行` };
  }

  async collectSample(session) {
    session.sampleIndex += 1;
    const sample = { timestamp: Date.now(), elapsed: (Date.now() - session.startedAt) / 1000, serial: session.serial, model: session.model, app: session.app, quality: {} };
    const operations = [];
    if (session.metrics.includes('cpu') || session.metrics.includes('memory')) operations.push(['system', this.collectSystem(session)]);
    if (session.metrics.includes('thermal')) operations.push(['thermal', this.collectThermal(session)]);
    if (session.metrics.includes('graphics')) operations.push(['graphics', this.collectGraphics(session)]);
    if (session.metrics.includes('app')) operations.push(['app', this.collectApp(session)]);
    const results = await Promise.allSettled(operations.map(([, promise]) => promise));
    for (let index = 0; index < operations.length; index += 1) {
      const [name] = operations[index];
      const result = results[index];
      if (result.status === 'rejected') {
        this.markUnavailable(sample, name, result.reason?.message || String(result.reason));
        continue;
      }
      this.applyMetricResult(sample, name, result.value);
    }
    this.onSample(sample);
    return sample;
  }

  markUnavailable(sample, name, reason) {
    const fields = {
      system: ['cpuUsage', 'enabledCpuCount', 'memoryUsed', 'memoryTotal'],
      thermal: ['batteryLevel', 'batteryTemperature', 'thermalState'],
      graphics: ['fps', 'gpuUsage'],
      app: ['appCpuUsage', 'appMemory']
    }[name] || [];
    for (const field of fields) sample.quality[field] = { state: 'unavailable', source: 'pymobiledevice3 / Apple DVT', reason };
  }

  applyMetricResult(sample, name, value) {
    const source = name === 'system' ? 'Apple DVT sysmontap' : name === 'thermal' ? 'diagnostics_relay' : name === 'graphics' ? 'Apple DVT graphics.opengl' : 'Apple DVT DVT process';
    const add = (field, data, state = 'measured') => {
      sample[field] = data;
      sample.quality[field] = { state: Number.isFinite(data) || typeof data === 'string' ? state : 'unavailable', source, reason: Number.isFinite(data) || typeof data === 'string' ? '' : '设备未返回该指标' };
    };
    if (name === 'system') {
      add('cpuUsage', value.cpuUsage); add('enabledCpuCount', value.enabledCpuCount); add('memoryUsed', value.memoryUsed); add('memoryTotal', value.memoryTotal);
    } else if (name === 'thermal') {
      add('batteryLevel', value.batteryLevel); add('batteryTemperature', value.temperature); sample.thermalState = classifyTemperature(value.temperature); sample.charging = value.charging; sample.quality.thermalState = { state: sample.thermalState ? 'derived' : 'unavailable', source, reason: sample.thermalState ? '按电池温度分级' : '设备未返回电池温度' };
    } else if (name === 'graphics') {
      add('fps', value.fps); add('gpuUsage', value.gpuUsage);
    } else if (name === 'app') {
      add('appCpuUsage', value.cpuUsage); add('appMemory', value.memoryUsed);
    }
  }

  scheduleSample(delay = 0) {
    const session = this.session;
    if (!session || session.stopped) return;
    this.timer = setTimeout(async () => {
      try {
        await this.collectSample(session);
      } catch (error) {
        if (this.session === session && !session.stopped) this.onStatus({ phase: 'warning', message: error.message || String(error) });
      } finally {
        if (this.session === session && !session.stopped) this.scheduleSample(session.interval);
      }
    }, delay);
  }

  commandError(result, operation) {
    const details = errorText(result);
    const normalized = details.toLowerCase();
    if (normalized.includes('no module named') || normalized.includes('pymobiledevice3') && normalized.includes('not found')) return new Error('内置 iOS 采集引擎缺少 pymobiledevice3，请重新安装 Test cat。');
    if (normalized.includes('developer mode')) return new Error('iPhone 未开启开发者模式。');
    if (normalized.includes('developerdiskimage') || normalized.includes('developer disk image')) return new Error('DeveloperDiskImage 自动挂载失败，请解锁 iPhone 并保持网络可用后重试。');
    if (normalized.includes('tunneld') || normalized.includes('no tunnel') || normalized.includes('connection refused')) return new Error('iPhone 性能隧道未运行，请先启动 pymobiledevice3 remote tunneld。');
    if (normalized.includes('not connected') || normalized.includes('no device')) return new Error('目标 iPhone 已断开。');
    return new Error(details ? `${operation}：${details.slice(-500)}` : `${operation}。`);
  }

  async startTunnel() {
    const python = await this.pythonPath();
    if (!python) throw new Error(this.runtimeUnavailableMessage());
    if (await this.isTunnelRunning()) return { started: false, ready: true, external: true };
    if (this.tunnelProcess && !this.tunnelProcess.killed) return { started: true, managed: true };
    const args = ['-m', 'pymobiledevice3', '--no-color', 'remote', 'tunneld', '--host', '127.0.0.1', '--port', '49151', '--protocol', 'quic'];
    if (process.platform === 'win32') {
      const command = `& ${JSON.stringify(python)} ${args.map((arg) => JSON.stringify(arg)).join(' ')}`;
      await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-Command','${command.replace(/'/g, "''")}'`], { timeout: 10000, windowsHide: true });
      this.onStatus({ phase: 'tunnel', message: '已请求管理员启动 iOS 性能隧道，请等待几秒后重试采集。' });
      return { started: true, managed: false };
    }
    this.tunnelProcess = spawn(python, args, { detached: true, stdio: 'ignore' });
    this.tunnelProcess.unref();
    if (process.platform !== 'darwin' || await this.waitForTunnel(2500)) {
      this.onStatus({ phase: 'tunnel', message: 'iOS 性能隧道已启动。' });
      return { started: true, managed: true };
    }
    try { this.tunnelProcess.kill(); } catch {}
    this.tunnelProcess = null;
    const command = `nohup ${[python, ...args].map(shellQuote).join(' ')} >/tmp/test-cat-ios-tunneld.log 2>&1 &`;
    await execFileAsync('/usr/bin/osascript', ['-e', `do shell script "${appleScriptString(command)}" with administrator privileges`], { timeout: 120000, windowsHide: true });
    this.onStatus({ phase: 'tunnel', message: '已通过系统授权启动 iOS 性能桥接。' });
    return { started: true, managed: false };
  }

  isTunnelRunning() {
    return new Promise((resolve) => {
      const request = http.get('http://127.0.0.1:49151/', { timeout: 900 }, (response) => {
        response.resume();
        resolve(true);
      });
      request.on('timeout', () => { request.destroy(); resolve(false); });
      request.on('error', () => resolve(false));
    });
  }

  async waitForTunnel(timeout = 12000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.isTunnelRunning()) return true;
      await wait(500);
    }
    return false;
  }

  async stop(announce = true) {
    const session = this.session;
    this.session = null;
    clearTimeout(this.timer);
    this.timer = null;
    if (this.tunnelProcess && !this.tunnelProcess.killed) {
      try { this.tunnelProcess.kill(); } catch {}
      this.tunnelProcess = null;
    }
    if (!session) return null;
    session.stopped = true;
    if (announce) this.onStatus({ phase: 'idle', message: 'iOS 性能采集已停止' });
    return { serial: session.serial, model: session.model, startedAt: session.startedAt, endedAt: Date.now() };
  }

  dispose() { return this.stop(false); }
}

module.exports = {
  IosPerformanceService,
  __test: {
    bundledPythonCandidates,
    classifyTemperature,
    diagnosticSummary,
    diagnosticType,
    shellQuote,
    parseBatterySnapshot,
    parseGraphicsSnapshot,
    parseInstalledApps,
    parseProcessSnapshot,
    parseSystemSnapshot,
    parseUsbmuxDevices,
    pythonCandidates
  }
};
