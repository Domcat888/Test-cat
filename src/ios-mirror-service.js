const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 8 * 1024 * 1024;
const DEFAULT_INTERVAL = 700;

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

class IosMirrorService {
  constructor({ onFrame = () => {}, onStatus = () => {}, runtimeRoots = [], packaged = false, ensureTunnel = null } = {}) {
    this.onFrame = onFrame;
    this.onStatus = onStatus;
    this.runtimeRoots = runtimeRoots;
    this.packaged = Boolean(packaged);
    this.bundledPython = bundledPythonCandidates(runtimeRoots);
    this.pythonSource = null;
    this.ensureTunnel = typeof ensureTunnel === 'function' ? ensureTunnel : null;
    this.session = null;
    this.timer = null;
    this.commandCache = new Map();
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
    const requiresTunnel = tool.type === 'pymobiledevice3' && Number.parseInt(device.iosVersion, 10) >= 17;
    if (requiresTunnel && this.ensureTunnel) {
      this.onStatus({ phase: 'starting', message: '正在启动 iOS 17 投屏桥接…', serial, model: device.model });
      try {
        await this.ensureTunnel();
      } catch (error) {
        throw new Error(`iOS 17 投屏桥接启动失败：${error.message || String(error)}`);
      }
    }
    const interval = this.validateInterval(configuration.interval);
    this.session = { serial, model: device.model || 'iPhone', tool, interval, requiresTunnel, startedAt: Date.now(), stopped: false };
    this.onStatus({ phase: 'streaming', message: `iOS 投屏已连接：${this.session.model}`, serial, model: this.session.model, controlSupported: false, streamMode: 'USB 截图轮询' });
    this.scheduleFrame(0);
    return { serial, model: this.session.model, interval, startedAt: this.session.startedAt, controlSupported: false, streamMode: 'USB 截图轮询' };
  }

  async captureScreenshot(session) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-cat-ios-'));
    const outputPath = path.join(tempDir, 'screen.png');
    try {
      let result;
      if (session.tool.type === 'pymobiledevice3') {
        const target = session.requiresTunnel ? ['--tunnel', session.serial] : ['--udid', session.serial];
        try {
          result = await execFileAsync(session.tool.path, ['-m', 'pymobiledevice3', '--no-color', 'developer', 'screenshot', ...target, outputPath], { timeout: 30000, windowsHide: true, maxBuffer: MAX_OUTPUT });
        } catch (error) {
          throw classifyScreenshotFailure(error);
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
    if (announce) this.onStatus({ phase: 'idle', message: 'iOS 投屏已停止' });
    return { serial: session.serial, model: session.model, startedAt: session.startedAt, endedAt: Date.now() };
  }

  dispose() { return this.stop(false); }
}

module.exports = {
  IosMirrorService,
  __test: {
    buildScreenshotCommand,
    bundledPythonCandidates,
    classifyScreenshotFailure,
    commandCandidates,
    normalizeScreenshotData,
    parseIdeviceIds,
    parseIdeviceInfo,
    parseTideviceList,
    parseUsbDevices,
    parseUsbmuxDevices,
    pythonCandidates
  }
};
