const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 8 * 1024 * 1024;
const DEFAULT_INTERVAL = 700;
const WEB_STREAM_HOST = '127.0.0.1';
const MAX_FRAME_SIZE = 32 * 1024 * 1024;
const VALERIA_CONFIG = 1;
const VALERIA_FRAME = 2;

function cleanRuntimeOutput(value) {
  return String(value || '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').trim();
}

function bundledPythonCandidates(runtimeRoots = [], platform = process.platform, arch = process.arch) {
  const folder = `${platform}-${arch}`;
  return runtimeRoots.flatMap((root) => platform === 'win32'
    ? [path.join(root, folder, 'python.exe')]
    : [path.join(root, folder, 'bin', 'python3'), path.join(root, folder, 'bin', 'python')]);
}

function pythonCandidates(environment = process.env, platform = process.platform, bundled = []) {
  const configured = [environment?.IPM_PYTHON_PATH, environment?.PYMOBILEDEVICE3_PYTHON, environment?.PYTHON_PATH];
  const system = platform === 'win32' ? ['python.exe', 'python'] : ['python3', 'python'];
  return [...new Set([...bundled, ...configured, ...system].filter(Boolean))];
}

function parseUsbmuxDevices(output) {
  let value;
  try { value = JSON.parse(cleanRuntimeOutput(output)); } catch { return []; }
  const rows = Array.isArray(value) ? value : value?.devices || value?.DeviceList || [];
  return rows.map((row) => {
    if (typeof row === 'string') return { serial: row, model: 'iPhone', state: 'device', platform: 'ios', source: 'pymobiledevice3' };
    const properties = row?.Properties || row?.properties || row || {};
    const serial = row?.Identifier || row?.UDID || row?.SerialNumber || row?.UniqueDeviceID
      || properties.SerialNumber || properties.UDID || properties.UniqueDeviceID;
    if (!serial) return null;
    const iosVersion = row?.ProductVersion || properties.ProductVersion;
    return {
      serial: String(serial),
      model: String(row?.DeviceName || row?.ProductType || properties.DeviceName || properties.ProductType || properties.DeviceClass || 'iPhone'),
      state: 'device',
      platform: 'ios',
      connectionType: String(row?.ConnectionType || properties.ConnectionType || 'USB'),
      source: 'pymobiledevice3',
      ...(iosVersion ? { iosVersion: String(iosVersion) } : {})
    };
  }).filter(Boolean);
}

function classifyScreenshotFailure(error) {
  const details = [error?.stderr, error?.stdout, error?.message].filter(Boolean).join('\n');
  if (/tunneld|no tunnel|unable to connect.*tunnel|connection refused/i.test(details)) {
    return new Error('iOS 17 投屏桥接未就绪，请重新连接手机并允许管理员授权。');
  }
  if (/device not found|no device|not connected/i.test(details)) {
    return new Error('iPhone 已断开，请重新连接并保持手机解锁。');
  }
  return new Error('iOS 截图未生成，请保持手机解锁并重新开始投屏。');
}

function isUserspaceUnavailable(error) {
  const details = [error?.stderr, error?.stdout, error?.message].filter(Boolean).join('\n');
  return /no-root userspace tunnel unavailable|coredeviceproxy unavailable|no remotepairing service/i.test(details);
}

function parseKeyValue(text) {
  const result = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) result[match[1].trim()] = match[2].trim();
  }
  return result;
}

function parseIdeviceInfo(text, serial = '') {
  const values = parseKeyValue(text);
  return {
    serial: values.UniqueDeviceID || serial,
    model: values.DeviceName || values.ProductType || 'iPhone',
    productType: values.ProductType || '',
    iosVersion: values.ProductVersion || '',
    batteryLevel: Number.isFinite(Number(values.BatteryCurrentCapacity)) ? Number(values.BatteryCurrentCapacity) : null,
    state: 'device',
    platform: 'ios'
  };
}

function parseIdeviceIds(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter((line) => /^[a-f0-9-]{8,}$/i.test(line));
}

function parseTideviceList(text) {
  const devices = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^\s*([a-f0-9-]{8,})\s+(.+?)\s*$/i);
    if (!match) continue;
    const stateMatch = match[2].match(/\s*(?:\[([^\]]+)\]|(online|offline|ready))\s*$/i);
    const state = (stateMatch?.[1] || stateMatch?.[2] || 'device').toLowerCase();
    const model = match[2].replace(/\s*(?:\[[^\]]+\]|online|offline|ready)\s*$/i, '').trim() || 'iPhone';
    devices.push({ serial: match[1], model, state, platform: 'ios' });
  }
  return devices;
}

function parseUsbDevices(payload) {
  const devices = [];
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    const name = String(value._name || value.name || '');
    const manufacturer = String(value.manufacturer || '');
    if (/iphone/i.test(name) || /apple mobile device/i.test(manufacturer)) {
      devices.push({
        serial: String(value.serial_num || value.location_id || '').trim(),
        model: name || 'iPhone',
        state: 'connected',
        platform: 'ios',
        source: 'system_profiler'
      });
    }
    Object.values(value).forEach(walk);
  };
  walk(payload);
  return [...new Map(devices.filter((device) => device.serial).map((device) => [device.serial, device])).values()];
}

function normalizeScreenshotData(value) {
  if (Buffer.isBuffer(value)) {
    return value.length ? `data:image/png;base64,${value.toString('base64')}` : null;
  }
  const source = String(value || '').trim();
  if (!source) return null;
  if (/^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(source)) return source;
  const base64 = source.replace(/\s+/g, '');
  if (base64.length < 16 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
  return `data:image/png;base64,${base64}`;
}

function commandCandidates(command, platform = process.platform, environment = process.env) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const envKey = {
    idevice_id: 'IDEVICE_ID_PATH',
    ideviceinfo: 'IDEVICEINFO_PATH',
    idevicescreenshot: 'IDEVICESCREENSHOT_PATH',
    tidevice: 'TIDEVICE_PATH'
  }[command];
  const candidates = [environment?.[envKey], command];
  if (platform === 'win32') {
    candidates.push(`${command}.exe`);
    const roots = [environment?.ProgramFiles, environment?.['ProgramFiles(x86)'], environment?.LOCALAPPDATA].filter(Boolean);
    for (const root of roots) {
      candidates.push(pathApi.join(root, 'libimobiledevice', `${command}.exe`));
      candidates.push(pathApi.join(root, 'tidevice', `${command}.exe`));
      candidates.push(pathApi.join(root, 'Python', 'Scripts', `${command}.exe`));
    }
  } else {
    candidates.push(`/opt/homebrew/bin/${command}`, `/usr/local/bin/${command}`, `/usr/bin/${command}`);
  }
  return [...new Set(candidates.filter(Boolean))];
}

function buildScreenshotCommand(backend, serial, outputPath) {
  if (backend === 'idevicescreenshot') return { command: backend, args: ['-u', serial, outputPath] };
  if (backend === 'tidevice') return { command: backend, args: ['-u', serial, 'screenshot', outputPath] };
  throw new Error('不支持的 iOS 截图工具。');
}

function buildPymobiledeviceScreenshotArgs(serial, outputPath, connection = 'direct') {
  const developerCommand = connection === 'direct' ? ['developer', 'screenshot'] : ['developer', 'dvt', 'screenshot'];
  return [
    '-m', 'pymobiledevice3', '--no-color', ...developerCommand,
    ...(connection === 'userspace' ? ['--userspace', '--udid', serial] : []),
    ...(connection === 'tunnel' ? ['--tunnel', serial] : []),
    ...(connection === 'direct' ? ['--udid', serial] : []),
    outputPath
  ];
}

function buildPymobiledeviceMounterArgs(serial, connection) {
  return [
    '-m', 'pymobiledevice3', '--no-color', 'mounter', 'auto-mount',
    ...(connection === 'userspace' ? ['--userspace', '--udid', serial] : []),
    ...(connection === 'tunnel' ? ['--tunnel', serial] : [])
  ];
}

function buildPymobiledeviceWebStreamArgs(serial, port) {
  return [
    '-m', 'pymobiledevice3', '--no-color', 'developer', 'core-device', 'display', 'serve-web',
    '--tunnel', serial, '--bind', WEB_STREAM_HOST, '--http-port', String(port), '--no-audio'
  ];
}

function buildPymobiledeviceMediaSupportArgs(serial) {
  return [
    '-m', 'pymobiledevice3', '--no-color', 'developer', 'core-device', 'display',
    'get-media-support-info', '--tunnel', serial
  ];
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, WEB_STREAM_HOST, () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function webServerReady(url, timeout = 20000) {
  const deadline = Date.now() + timeout;
  return new Promise((resolve, reject) => {
    const probe = () => {
      const request = http.get(url, { timeout: 1000 }, (response) => {
        response.resume();
        if (response.statusCode >= 200 && response.statusCode < 500) return resolve(true);
        if (Date.now() >= deadline) return reject(new Error(`视频服务返回 HTTP ${response.statusCode}`));
        setTimeout(probe, 180);
      });
      request.on('timeout', () => request.destroy());
      request.on('error', () => {
        if (Date.now() >= deadline) reject(new Error('iOS 视频服务启动超时'));
        else setTimeout(probe, 180);
      });
    };
    probe();
  });
}

class IosMirrorService {
  constructor({ onFrame = () => {}, onStatus = () => {}, runtimeRoots = [], packaged = false, ensureTunnel = null, platform = process.platform } = {}) {
    this.onFrame = onFrame;
    this.onStatus = onStatus;
    this.runtimeRoots = runtimeRoots;
    this.packaged = Boolean(packaged);
    this.bundledPython = bundledPythonCandidates(runtimeRoots);
    this.pythonSource = null;
    this.ensureTunnel = typeof ensureTunnel === 'function' ? ensureTunnel : null;
    this.platform = platform;
    this.session = null;
    this.timer = null;
    this.commandCache = new Map();
    this.helperPath = null;
    this.valeriaHelperPath = null;
    this.valeriaVendorPath = null;
  }

  async commandPath(command) {
    if (this.commandCache.has(command)) return this.commandCache.get(command);
    for (const candidate of commandCandidates(command)) {
      try {
        await execFileAsync(candidate, ['--help'], { timeout: 5000, windowsHide: true, maxBuffer: 512 * 1024 });
        this.commandCache.set(command, candidate);
        return candidate;
      } catch (error) {
        if (error.code !== 'ENOENT') {
          this.commandCache.set(command, candidate);
          return candidate;
        }
      }
    }
    this.commandCache.set(command, null);
    return null;
  }

  async run(command, args, timeout = 15000) {
    const executable = await this.commandPath(command);
    if (!executable) return null;
    const { stdout, stderr } = await execFileAsync(executable, args, { timeout, windowsHide: true, maxBuffer: MAX_OUTPUT });
    return stdout || stderr || '';
  }

  async pythonPath() {
    if (this.commandCache.has('python')) return this.commandCache.get('python');
    for (const candidate of pythonCandidates(process.env, process.platform, this.bundledPython)) {
      if (this.packaged && !this.bundledPython.includes(candidate)) continue;
      try {
        await execFileAsync(candidate, ['-c', 'import pymobiledevice3'], { timeout: 8000, windowsHide: true, maxBuffer: 512 * 1024 });
        this.commandCache.set('python', candidate);
        this.pythonSource = this.bundledPython.includes(candidate) ? 'bundled' : 'configured';
        return candidate;
      } catch {}
    }
    this.commandCache.set('python', null);
    return null;
  }

  async runPython(args, timeout = 20000) {
    const executable = await this.pythonPath();
    if (!executable) return null;
    return execFileAsync(executable, ['-m', 'pymobiledevice3', '--no-color', ...args], { timeout, windowsHide: true, maxBuffer: MAX_OUTPUT });
  }

  async listRuntimeDevices() {
    try {
      const result = await this.runPython(['usbmux', 'list'], 15000);
      return parseUsbmuxDevices(result?.stdout || '');
    } catch {
      return [];
    }
  }

  async listDevices() {
    const ideviceId = await this.commandPath('idevice_id');
    let bridgeFound = Boolean(ideviceId);
    if (ideviceId) {
      let ids = [];
      try { ids = parseIdeviceIds(await this.run('idevice_id', ['-l']) || ''); } catch {}
      const devices = await Promise.all(ids.map(async (serial) => {
        try {
          const executable = await this.commandPath('ideviceinfo');
          if (executable) {
            const { stdout } = await execFileAsync(executable, ['-u', serial], { timeout: 10000, windowsHide: true, maxBuffer: MAX_OUTPUT });
            return parseIdeviceInfo(stdout, serial);
          }
        } catch {}
        return { serial, model: 'iPhone', state: 'device', platform: 'ios' };
      }));
      if (devices.length) return devices;
    }

    const tidevice = await this.commandPath('tidevice');
    bridgeFound ||= Boolean(tidevice);
    if (tidevice) {
      try {
        const output = await this.run('tidevice', ['list']) || '';
        const devices = parseTideviceList(output);
        if (devices.length) return devices;
      } catch {}
    }

    const runtimeDevices = await this.listRuntimeDevices();
    if (runtimeDevices.length) return runtimeDevices;

    if (process.platform === 'darwin') {
      try {
        const { stdout } = await execFileAsync('/usr/sbin/system_profiler', ['SPUSBDataType', '-json'], { timeout: 10000, windowsHide: true, maxBuffer: MAX_OUTPUT });
        const devices = parseUsbDevices(JSON.parse(stdout));
        if (!devices.length && !bridgeFound) this.onStatus({ phase: 'warning', message: '未找到 iOS 设备桥接工具。请安装 libimobiledevice 或 tidevice，并用 USB 连接已信任的 iPhone。' });
        else if (devices.length && !bridgeFound) this.onStatus({ phase: 'warning', message: '已发现 USB iPhone，但未找到设备桥接工具；请安装 libimobiledevice 或 tidevice。' });
        return devices;
      } catch {}
    }
    if (!bridgeFound) this.onStatus({ phase: 'warning', message: '无法读取 iOS 设备。请安装 libimobiledevice 或 tidevice，并确认 Apple USB 驱动已安装。' });
    return [];
  }

  validateSerial(serial) {
    const value = String(serial || '').trim();
    if (!value || value.length > 200 || !/^[a-zA-Z0-9_.:-]+$/.test(value)) throw new Error('请选择有效的 iPhone 设备。');
    return value;
  }

  validateInterval(interval) {
    const value = Number(interval);
    if (!Number.isFinite(value)) return DEFAULT_INTERVAL;
    return Math.max(300, Math.min(5000, Math.round(value)));
  }

  async resolveScreenshotTool() {
    const idevice = await this.commandPath('idevicescreenshot');
    if (idevice) return { type: 'idevicescreenshot', path: idevice };
    const tidevice = await this.commandPath('tidevice');
    if (tidevice) return { type: 'tidevice', path: tidevice };
    const python = await this.pythonPath();
    if (python) return { type: 'pymobiledevice3', path: python };
    throw new Error('未找到 iOS 截图工具。请安装 libimobiledevice/tidevice，或重新安装包含 iOS 运行时的 Test cat。');
  }

  async start(configuration = {}) {
    await this.stop(false);
    const serial = this.validateSerial(configuration.serial);
    const device = (await this.listDevices()).find((item) => item.serial === serial) || { serial, model: 'iPhone', platform: 'ios' };
    const tool = await this.resolveScreenshotTool();
    const iosMajor = Number.parseInt(device.iosVersion, 10);
    const usesUserspace = tool.type === 'pymobiledevice3' && iosMajor >= 17;
    const interval = this.validateInterval(configuration.interval);
    this.session = { serial, model: device.model || 'iPhone', tool, interval, usesUserspace, iosMajor, startedAt: Date.now(), stopped: false };
    if (tool.type === 'pymobiledevice3' && this.platform === 'darwin') {
      try {
        this.onStatus({ phase: 'starting', message: '正在启动 iOS USB 实时视频流…', serial, model: this.session.model });
        await this.startValeriaStream(this.session);
        const streamMode = 'USB H.264 实时视频流';
        this.session.streamMode = 'valeria';
        this.onStatus({ phase: 'streaming', message: `iOS 实时投屏已连接：${this.session.model}`, serial, model: this.session.model, controlSupported: false, streamMode });
        return { serial, model: this.session.model, interval, startedAt: this.session.startedAt, controlSupported: false, streamMode };
      } catch (error) {
        await this.stopValeriaStream(this.session);
        if (/录屏权限|屏幕与系统录音|screen recording|tcc permission/i.test(String(error?.message || error))) {
          throw new Error('Test cat 需要系统录屏权限才能显示 iPhone 实时画面。请在“系统设置 > 隐私与安全性 > 屏幕与系统录音”中允许 Test cat（开发版可能显示 Electron），然后完全退出并重新打开。');
        }
        this.onStatus({ phase: 'warning', message: `实时视频启动失败，正在切换兼容通道：${error.message}`, serial, model: this.session.model });
      }
    }
    if (tool.type === 'pymobiledevice3' && iosMajor >= 17 && this.ensureTunnel) {
      try {
        this.onStatus({ phase: 'starting', message: '正在建立 iOS USB 视频通道…', serial, model: this.session.model });
        await this.ensureTunnel(serial);
        this.session.usesUserspace = false;
        this.session.usesTunnel = true;
        if (await this.supportsCoreDeviceStream(this.session)) {
          const streamUrl = await this.startWebStream(this.session);
          const streamMode = 'USB HEVC 实时视频流';
          this.session.streamMode = 'video';
          this.session.streamUrl = streamUrl;
          this.onStatus({ phase: 'streaming', message: `iOS 实时投屏已连接：${this.session.model}`, serial, model: this.session.model, controlSupported: false, streamMode, streamUrl });
          return { serial, model: this.session.model, interval, startedAt: this.session.startedAt, controlSupported: false, streamMode, streamUrl };
        }
        await this.startDvtStream(this.session);
        const streamMode = 'USB DVT 持续画面';
        this.session.streamMode = 'dvt';
        this.onStatus({ phase: 'streaming', message: `iOS 投屏已连接：${this.session.model}`, serial, model: this.session.model, controlSupported: false, streamMode });
        return { serial, model: this.session.model, interval, startedAt: this.session.startedAt, controlSupported: false, streamMode };
      } catch (error) {
        await this.stopWebStream(this.session);
        await this.stopDvtStream(this.session);
        this.onStatus({ phase: 'warning', message: `实时视频不可用，已切换兼容画面：${error.message}`, serial, model: this.session.model });
      }
    }
    const streamMode = usesUserspace ? 'USB userspace 截图兼容模式' : 'USB 截图兼容模式';
    this.session.streamMode = 'screenshot';
    this.onStatus({ phase: 'streaming', message: `iOS 投屏已连接：${this.session.model}`, serial, model: this.session.model, controlSupported: false, streamMode });
    this.scheduleFrame(0);
    return { serial, model: this.session.model, interval, startedAt: this.session.startedAt, controlSupported: false, streamMode };
  }

  async startWebStream(session) {
    const port = await availablePort();
    const streamUrl = `http://${WEB_STREAM_HOST}:${port}/`;
    const args = buildPymobiledeviceWebStreamArgs(session.serial, port);
    const child = spawn(session.tool.path, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    session.webProcess = child;
    session.webError = '';
    child.stderr?.on('data', (chunk) => {
      session.webError = `${session.webError}${chunk}`.slice(-4000);
    });
    const exited = new Promise((_, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (!session.stopped) reject(new Error(session.webError.trim() || `视频服务已退出（${code ?? signal}）`));
      });
    });
    await Promise.race([webServerReady(streamUrl), exited]);
    return streamUrl;
  }

  async supportsCoreDeviceStream(session) {
    try {
      const { stdout } = await execFileAsync(session.tool.path, buildPymobiledeviceMediaSupportArgs(session.serial), {
        timeout: 15000, windowsHide: true, maxBuffer: MAX_OUTPUT
      });
      const info = JSON.parse(cleanRuntimeOutput(stdout));
      return Number(info?.supportedFeatures) > 0;
    } catch {
      return false;
    }
  }

  async resolveStreamHelperPath() {
    if (this.helperPath) return this.helperPath;
    const candidates = [
      path.join(process.resourcesPath || '', 'app.asar.unpacked', 'src', 'ios-mirror-helper.py'),
      path.join(__dirname, 'ios-mirror-helper.py')
    ];
    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        this.helperPath = candidate;
        return candidate;
      } catch {}
    }
    throw new Error('iOS 持续投屏组件缺失，请重新安装 Test cat。');
  }

  async resolveValeriaPaths() {
    if (this.valeriaHelperPath && this.valeriaVendorPath) {
      return { helper: this.valeriaHelperPath, vendor: this.valeriaVendorPath };
    }
    const roots = [
      path.join(process.resourcesPath || '', 'app.asar.unpacked'),
      path.resolve(__dirname, '..')
    ];
    for (const root of roots) {
      const helper = path.join(root, 'src', 'ios-valeria-helper.py');
      const vendor = path.join(root, 'resources', 'ios-valeria');
      try {
        await Promise.all([fs.access(helper), fs.access(path.join(vendor, 'pymobiledevice3', 'services', 'valeria_cmio.py'))]);
        this.valeriaHelperPath = helper;
        this.valeriaVendorPath = vendor;
        return { helper, vendor };
      } catch {}
    }
    throw new Error('iOS 实时视频组件缺失，请重新安装 Test cat。');
  }

  async startValeriaStream(session) {
    const { helper, vendor } = await this.resolveValeriaPaths();
    const child = spawn(session.tool.path, [helper, '--udid', session.serial, '--vendor-root', vendor], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    session.valeriaProcess = child;
    session.valeriaError = '';
    session.valeriaBuffer = Buffer.alloc(0);
    let readyResolve;
    let readyReject;
    let readyDone = false;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const settleReady = (fn, value) => {
      if (readyDone) return;
      readyDone = true;
      fn(value);
    };
    const timer = setTimeout(() => settleReady(readyReject, new Error('iOS 实时视频启动超时，请检查系统录屏权限。')), 20000);
    child.stderr.on('data', (chunk) => {
      session.valeriaError = `${session.valeriaError}${chunk}`.slice(-6000);
    });
    child.stdout.on('data', (chunk) => {
      session.valeriaBuffer = Buffer.concat([session.valeriaBuffer, chunk]);
      while (session.valeriaBuffer.length >= 5) {
        const kind = session.valeriaBuffer[0];
        const length = session.valeriaBuffer.readUInt32BE(1);
        if (length <= 0 || length > MAX_FRAME_SIZE) {
          child.kill('SIGTERM');
          settleReady(readyReject, new Error('iOS 实时视频数据格式异常'));
          return;
        }
        if (session.valeriaBuffer.length < length + 5) return;
        const payload = session.valeriaBuffer.subarray(5, length + 5);
        session.valeriaBuffer = session.valeriaBuffer.subarray(length + 5);
        if (this.session !== session || session.stopped) continue;
        if (kind === VALERIA_CONFIG) {
          try {
            const config = JSON.parse(payload.toString('utf8'));
            session.valeriaConfig = config;
            this.onFrame({ kind: 'video-config', config, timestamp: Date.now() });
          } catch {}
        } else if (kind === VALERIA_FRAME) {
          clearTimeout(timer);
          settleReady(readyResolve, true);
          this.onFrame({ kind: 'video-frame', data: payload, timestamp: Date.now() });
        }
      }
    });
    child.once('error', (error) => settleReady(readyReject, error));
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (session.stopped) return;
      const detail = cleanRuntimeOutput(session.valeriaError);
      const error = new Error(detail || `iOS 实时视频已退出（${code ?? signal}）`);
      settleReady(readyReject, error);
      if (session.streamMode === 'valeria') this.onStatus({ phase: 'error', message: error.message });
    });
    try {
      await ready;
    } finally {
      clearTimeout(timer);
    }
  }

  async stopValeriaStream(session) {
    const child = session?.valeriaProcess;
    if (!child) return;
    session.valeriaProcess = null;
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
  }

  async startDvtStream(session) {
    const helper = await this.resolveStreamHelperPath();
    const child = spawn(session.tool.path, [helper, '--udid', session.serial], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    session.dvtProcess = child;
    session.dvtError = '';
    session.dvtBuffer = Buffer.alloc(0);
    session.dvtExpected = 0;
    let readyResolve;
    let readyReject;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const timer = setTimeout(() => readyReject(new Error('iOS 持续画面启动超时')), 15000);
    child.stderr.on('data', (chunk) => {
      session.dvtError = `${session.dvtError}${chunk}`.slice(-4000);
    });
    child.stdout.on('data', (chunk) => {
      session.dvtBuffer = Buffer.concat([session.dvtBuffer, chunk]);
      while (session.dvtBuffer.length >= 4) {
        if (!session.dvtExpected) {
          session.dvtExpected = session.dvtBuffer.readUInt32BE(0);
          if (session.dvtExpected <= 0 || session.dvtExpected > MAX_FRAME_SIZE) {
            child.kill('SIGTERM');
            readyReject(new Error('iOS 画面数据格式异常'));
            return;
          }
        }
        if (session.dvtBuffer.length < session.dvtExpected + 4) return;
        const frame = session.dvtBuffer.subarray(4, session.dvtExpected + 4);
        session.dvtBuffer = session.dvtBuffer.subarray(session.dvtExpected + 4);
        session.dvtExpected = 0;
        clearTimeout(timer);
        readyResolve(true);
        if (this.session === session && !session.stopped) {
          this.onFrame({ dataUrl: normalizeScreenshotData(frame), timestamp: Date.now() });
        }
      }
    });
    child.once('error', (error) => readyReject(error));
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (!session.stopped) {
        const error = new Error(session.dvtError.trim() || `iOS 持续画面已退出（${code ?? signal}）`);
        readyReject(error);
        if (session.streamMode === 'dvt') this.onStatus({ phase: 'error', message: error.message });
      }
    });
    try {
      await ready;
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }
  }

  async stopDvtStream(session) {
    const child = session?.dvtProcess;
    if (!child) return;
    session.dvtProcess = null;
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
  }

  async stopWebStream(session) {
    const child = session?.webProcess;
    if (!child) return;
    session.webProcess = null;
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
  }

  async captureScreenshot(session) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-cat-ios-'));
    const outputPath = path.join(tempDir, 'screen.png');
    try {
      let result;
      if (session.tool.type === 'pymobiledevice3') {
        try {
          const connection = session.usesTunnel ? 'tunnel' : (session.usesUserspace ? 'userspace' : 'direct');
          if (connection !== 'direct' && !session.developerImageReady) {
            const mountArgs = buildPymobiledeviceMounterArgs(session.serial, connection);
            await execFileAsync(session.tool.path, mountArgs, { timeout: 90000, windowsHide: true, maxBuffer: MAX_OUTPUT });
            session.developerImageReady = true;
          }
          const args = buildPymobiledeviceScreenshotArgs(session.serial, outputPath, connection);
          result = await execFileAsync(session.tool.path, args, { timeout: 30000, windowsHide: true, maxBuffer: MAX_OUTPUT });
        } catch (error) {
          if (session.usesUserspace && this.ensureTunnel && isUserspaceUnavailable(error)) {
            this.onStatus({ phase: 'starting', message: '当前 iOS 版本需要系统桥接，正在请求管理员授权…', serial: session.serial, model: session.model });
            try {
              await this.ensureTunnel(session.serial);
              session.usesUserspace = false;
              session.usesTunnel = true;
              const mountArgs = buildPymobiledeviceMounterArgs(session.serial, 'tunnel');
              await execFileAsync(session.tool.path, mountArgs, { timeout: 90000, windowsHide: true, maxBuffer: MAX_OUTPUT });
              session.developerImageReady = true;
              const args = buildPymobiledeviceScreenshotArgs(session.serial, outputPath, 'tunnel');
              result = await execFileAsync(session.tool.path, args, { timeout: 30000, windowsHide: true, maxBuffer: MAX_OUTPUT });
              this.onStatus({ phase: 'streaming', message: `iOS 投屏已连接：${session.model}`, serial: session.serial, model: session.model, controlSupported: false, streamMode: 'USB 系统桥接截图轮询' });
            } catch (fallbackError) {
              throw classifyScreenshotFailure(fallbackError);
            }
          } else {
            throw classifyScreenshotFailure(error);
          }
        }
      } else {
        const command = buildScreenshotCommand(session.tool.type, session.serial, outputPath);
        try {
          result = await execFileAsync(session.tool.path, command.args, { timeout: 20000, windowsHide: true, maxBuffer: MAX_OUTPUT });
        } catch (error) {
          throw classifyScreenshotFailure(error);
        }
      }
      let buffer;
      try {
        buffer = await fs.readFile(outputPath);
      } catch (error) {
        if (error.code === 'ENOENT') throw classifyScreenshotFailure(result);
        throw error;
      }
      const dataUrl = normalizeScreenshotData(buffer);
      if (!dataUrl) throw new Error('截图文件为空或格式无法解析。');
      return dataUrl;
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async captureFrame() {
    const session = this.session;
    if (!session || session.stopped) throw new Error('请先开始 iOS 投屏。');
    return { dataUrl: await this.captureScreenshot(session), timestamp: Date.now() };
  }

  scheduleFrame(delay = 0) {
    const session = this.session;
    if (!session || session.stopped) return;
    this.timer = setTimeout(async () => {
      try {
        const dataUrl = await this.captureScreenshot(session);
        if (this.session === session && !session.stopped) this.onFrame({ dataUrl, timestamp: Date.now() });
      } catch (error) {
        if (this.session === session && !session.stopped) this.onStatus({ phase: 'warning', message: `iOS 画面读取失败：${error.message}` });
      } finally {
        if (this.session === session && !session.stopped) this.scheduleFrame(session.interval);
      }
    }, delay);
  }

  async stop(announce = true) {
    const session = this.session;
    this.session = null;
    clearTimeout(this.timer);
    this.timer = null;
    if (!session) return null;
    session.stopped = true;
    await this.stopValeriaStream(session);
    await this.stopWebStream(session);
    await this.stopDvtStream(session);
    if (announce) this.onStatus({ phase: 'idle', message: 'iOS 投屏已停止' });
    return { serial: session.serial, model: session.model, startedAt: session.startedAt, endedAt: Date.now() };
  }

  dispose() { return this.stop(false); }
}

module.exports = {
  IosMirrorService,
  __test: {
    buildScreenshotCommand,
    buildPymobiledeviceMounterArgs,
    buildPymobiledeviceScreenshotArgs,
    buildPymobiledeviceMediaSupportArgs,
    buildPymobiledeviceWebStreamArgs,
    bundledPythonCandidates,
    classifyScreenshotFailure,
    commandCandidates,
    isUserspaceUnavailable,
    normalizeScreenshotData,
    parseIdeviceIds,
    parseIdeviceInfo,
    parseTideviceList,
    parseUsbDevices,
    parseUsbmuxDevices,
    pythonCandidates
  }
};
