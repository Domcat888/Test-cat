const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const dgram = require('node:dgram');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const AGENT_PACKAGE = 'hev.sockstun';
const AGENT_COMPONENT = 'hev.sockstun/.MainActivity';
const PROXY_PORT = 27183;
const AGENT_SHA256 = 'ce24ff0a284e44031277f16fb81d6e08036b871565033aeeb3148442f6ba490c';

const PRESETS = Object.freeze({
  forest: { id: 'forest', name: '深山老林', icon: '🌲', downKbps: 180, upKbps: 80, latencyMs: 850, jitterMs: 420, instability: 12, outageEveryMs: 24000, outageMs: 2600 },
  elevator: { id: 'elevator', name: '电梯', icon: '🛗', downKbps: 96, upKbps: 48, latencyMs: 1200, jitterMs: 700, instability: 24, outageEveryMs: 12000, outageMs: 4200 },
  subway: { id: 'subway', name: '地铁', icon: '🚇', downKbps: 1200, upKbps: 384, latencyMs: 260, jitterMs: 190, instability: 8, outageEveryMs: 32000, outageMs: 1800 },
  tunnel: { id: 'tunnel', name: '隧道穿行', icon: '🚇', downKbps: 384, upKbps: 128, latencyMs: 650, jitterMs: 520, instability: 18, outageEveryMs: 18000, outageMs: 3200 },
  '2g': { id: '2g', name: '2G 网络', icon: '📶', downKbps: 200, upKbps: 80, latencyMs: 600, jitterMs: 180, instability: 6, outageEveryMs: 0, outageMs: 0 },
  '3g': { id: '3g', name: '3G 网络', icon: '📡', downKbps: 1500, upKbps: 512, latencyMs: 180, jitterMs: 80, instability: 2, outageEveryMs: 0, outageMs: 0 }
});

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeProfile(input = {}) {
  const base = PRESETS[input.id] || PRESETS.subway;
  return {
    ...base,
    ...input,
    downKbps: clampNumber(input.downKbps, 16, 100000, base.downKbps),
    upKbps: clampNumber(input.upKbps, 16, 100000, base.upKbps),
    latencyMs: clampNumber(input.latencyMs, 0, 10000, base.latencyMs),
    jitterMs: clampNumber(input.jitterMs, 0, 10000, base.jitterMs),
    instability: clampNumber(input.instability, 0, 100, base.instability),
    outageEveryMs: clampNumber(input.outageEveryMs, 0, 600000, base.outageEveryMs),
    outageMs: clampNumber(input.outageMs, 0, 60000, base.outageMs)
  };
}

function parseDevices(output) {
  return String(output || '').split(/\r?\n/).slice(1).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [serial, state] = line.split(/\s+/, 2);
    return {
      serial,
      state,
      model: line.match(/model:([^\s]+)/)?.[1]?.replace(/_/g, ' ') || 'Android 设备'
    };
  });
}

function normalizeForegroundComponent(raw = '') {
  const component = String(raw || '').trim().replace(/[},]+$/g, '');
  const match = component.match(/^([A-Za-z0-9_.]+)\/([A-Za-z0-9_.$/]+)$/);
  if (!match) return null;
  return {
    packageName: match[1],
    component: `${match[1]}/${match[2]}`
  };
}

function parseForegroundComponent(output) {
  const text = String(output || '');
  const patterns = [
    /topResumedActivity=.*?\s([A-Za-z0-9_.]+\/[A-Za-z0-9_.$/]+)/i,
    /mCurrentFocus=.*?\s([A-Za-z0-9_.]+\/[A-Za-z0-9_.$/]+)/i,
    /mFocusedApp=.*?\s([A-Za-z0-9_.]+\/[A-Za-z0-9_.$/]+)/i,
    /ACTIVITY\s+([A-Za-z0-9_.]+\/[A-Za-z0-9_.$/]+)/i
  ];
  for (const pattern of patterns) {
    const result = normalizeForegroundComponent(text.match(pattern)?.[1]);
    if (result) return result;
  }
  return null;
}

function decodeXml(value = '') {
  return String(value).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function parseUiHierarchy(xml) {
  const nodes = [];
  for (const match of String(xml || '').matchAll(/<node\b([^>]*)\/?\s*>/g)) {
    const attributes = {};
    for (const attribute of match[1].matchAll(/([\w:-]+)="([^"]*)"/g)) attributes[attribute[1]] = decodeXml(attribute[2]);
    const bounds = attributes.bounds?.match(/\[(\d+),(\d+)]\[(\d+),(\d+)]/);
    nodes.push({
      ...attributes,
      checked: attributes.checked === 'true',
      enabled: attributes.enabled !== 'false',
      center: bounds ? { x: Math.round((Number(bounds[1]) + Number(bounds[3])) / 2), y: Math.round((Number(bounds[2]) + Number(bounds[4])) / 2) } : null
    });
  }
  return nodes;
}

function classifyInstallError(error) {
  const raw = [error?.stdout, error?.stderr, error?.message, error].filter(Boolean).join('\n');
  if (/UPDATE_INCOMPATIBLE|VERSION_DOWNGRADE|INCONSISTENT_CERTIFICATES/i.test(raw)) return { code: 'replace-required', message: '检测到旧版或签名不同的弱网组件，需要自动替换。' };
  if (/DEPRECATED_SDK_VERSION|LOW_TARGET_SDK|target sdk version/i.test(raw)) return { code: 'low-target', message: 'Android 阻止了低目标版本应用安装。' };
  if (/USER_RESTRICTED|install canceled by user|用户拒绝|禁止安装/i.test(raw)) return { code: 'user-restricted', message: '手机禁止通过 USB 安装。请在开发者选项中开启“USB 安装/通过 USB 验证应用”，并保持手机解锁。' };
  if (/NO_MATCHING_ABIS/i.test(raw)) return { code: 'abi', message: '手机或模拟器的 CPU 架构与弱网组件不兼容。' };
  if (/INSUFFICIENT_STORAGE/i.test(raw)) return { code: 'storage', message: '手机存储空间不足，无法安装弱网组件。' };
  const failure = raw.match(/Failure\s*\[([^\]]+)]/i)?.[1] || raw.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || '未知安装错误';
  return { code: 'other', message: `手机端组件安装失败：${failure}` };
}

class BufferedSocketReader {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.pending = [];
    this.onData = (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.flush();
    };
    this.onClosed = () => {
      const error = new Error('Socket closed');
      for (const pending of this.pending.splice(0)) pending.reject(error);
    };
    socket.on('data', this.onData);
    socket.on('close', this.onClosed);
    socket.on('error', this.onClosed);
  }

  read(length) {
    if (this.buffer.length >= length) return Promise.resolve(this.take(length));
    return new Promise((resolve, reject) => this.pending.push({ length, resolve, reject }));
  }

  take(length) {
    const result = this.buffer.subarray(0, length);
    this.buffer = this.buffer.subarray(length);
    return result;
  }

  flush() {
    while (this.pending.length && this.buffer.length >= this.pending[0].length) {
      const pending = this.pending.shift();
      pending.resolve(this.take(pending.length));
    }
  }

  detach() {
    this.socket.off('data', this.onData);
    this.socket.off('close', this.onClosed);
    this.socket.off('error', this.onClosed);
    const remaining = this.buffer;
    this.buffer = Buffer.alloc(0);
    return remaining;
  }
}

class ShapingTransform extends Transform {
  constructor({ profile, kbps, direction, stats, shouldInterrupt }) {
    super();
    this.profile = profile;
    this.kbps = kbps;
    this.direction = direction;
    this.stats = stats;
    this.shouldInterrupt = shouldInterrupt;
  }

  _transform(chunk, _encoding, callback) {
    if (this.shouldInterrupt(chunk.length)) {
      this.stats.interruptions += 1;
      callback(new Error('Test cat simulated a weak-network interruption'));
      return;
    }
    const jitter = (Math.random() * 2 - 1) * this.profile.jitterMs;
    const bandwidthDelay = chunk.length * 8 / Math.max(1, this.kbps);
    const delay = Math.max(0, this.profile.latencyMs / 2 + jitter / 2 + bandwidthDelay);
    setTimeout(() => {
      this.stats[this.direction] += chunk.length;
      this.push(chunk);
      callback();
    }, delay);
  }
}

class WeakNetworkProxy {
  constructor(profile, onStats) {
    this.profile = normalizeProfile(profile);
    this.onStats = onStats;
    this.server = null;
    this.sockets = new Set();
    this.startedAt = 0;
    this.stats = { upBytes: 0, downBytes: 0, connections: 0, interruptions: 0 };
  }

  async start() {
    this.startedAt = Date.now();
    this.server = net.createServer((socket) => this.handleClient(socket));
    this.server.on('error', () => {});
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(PROXY_PORT, '127.0.0.1', resolve);
    });
    this.statsTimer = setInterval(() => this.onStats?.({ ...this.stats }), 1000);
  }

  isOutage() {
    const { outageEveryMs, outageMs } = this.profile;
    if (!outageEveryMs || !outageMs) return false;
    return (Date.now() - this.startedAt) % outageEveryMs < outageMs;
  }

  shouldInterrupt(bytes) {
    if (this.isOutage()) return true;
    const probability = (this.profile.instability / 100) * Math.min(1, bytes / (512 * 1024)) * 0.35;
    return Math.random() < probability;
  }

  async readSocksAddress(reader, type) {
    if (type === 1) return [...await reader.read(4)].join('.');
    if (type === 3) return (await reader.read((await reader.read(1))[0])).toString('utf8');
    if (type === 4) {
      const bytes = await reader.read(16);
      return Array.from({ length: 8 }, (_, index) => bytes.readUInt16BE(index * 2).toString(16)).join(':');
    }
    throw new Error('Unsupported address type');
  }

  parseRelayAddress(body, type) {
    if (type === 1) return { host: [...body.subarray(2, 6)].join('.'), portOffset: 6 };
    if (type === 3) {
      const length = body[2];
      return { host: body.subarray(3, 3 + length).toString('utf8'), portOffset: 3 + length };
    }
    if (type === 4) {
      const bytes = body.subarray(2, 18);
      return { host: Array.from({ length: 8 }, (_, index) => bytes.readUInt16BE(index * 2).toString(16)).join(':'), portOffset: 18 };
    }
    throw new Error('Unsupported UDP address type');
  }

  createRelayPacket(host, port, data) {
    const family = net.isIP(host);
    let address;
    let type;
    if (family === 4) {
      type = 1;
      address = Buffer.from(host.split('.').map(Number));
    } else if (family === 6) {
      type = 4;
      const [rawLeft = '', rawRight = ''] = host.split('::');
      const left = rawLeft ? rawLeft.split(':') : [];
      const right = rawRight ? rawRight.split(':') : [];
      const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
      address = Buffer.alloc(16);
      groups.slice(0, 8).forEach((group, index) => address.writeUInt16BE(parseInt(group || '0', 16), index * 2));
    } else {
      type = 3;
      const name = Buffer.from(host, 'utf8');
      address = Buffer.concat([Buffer.from([name.length]), name]);
    }
    const headerLength = 2 + 1 + 1 + address.length + 2;
    const packet = Buffer.alloc(headerLength + data.length);
    packet.writeUInt16BE(packet.length, 0);
    packet[2] = headerLength;
    packet[3] = type;
    address.copy(packet, 4);
    packet.writeUInt16BE(port, 4 + address.length);
    data.copy(packet, headerLength);
    return packet;
  }

  async handleUdpInTcp(client, reader) {
    const udp = dgram.createSocket('udp4');
    this.sockets.add(udp);
    udp.on('close', () => this.sockets.delete(udp));
    udp.on('error', () => client.destroy());
    udp.on('message', (message, remote) => {
      if (this.shouldInterrupt(message.length)) {
        this.stats.interruptions += 1;
        return;
      }
      const jitter = (Math.random() * 2 - 1) * this.profile.jitterMs;
      const delay = Math.max(0, this.profile.latencyMs / 2 + jitter / 2 + message.length * 8 / this.profile.downKbps);
      setTimeout(() => {
        if (client.destroyed) return;
        this.stats.downBytes += message.length;
        client.write(this.createRelayPacket(remote.address, remote.port, message));
      }, delay);
    });
    client.on('close', () => { try { udp.close(); } catch {} });
    client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
    this.stats.connections += 1;
    while (!client.destroyed) {
      const totalLength = (await reader.read(2)).readUInt16BE(0);
      if (totalLength < 8 || totalLength > 65535) throw new Error('Invalid UDP relay message');
      const body = await reader.read(totalLength - 2);
      const headerLength = body[0];
      const { host, portOffset } = this.parseRelayAddress(body, body[1]);
      const port = body.readUInt16BE(portOffset);
      const dataOffset = headerLength - 2;
      if (dataOffset < portOffset + 2 || dataOffset > body.length) throw new Error('Invalid UDP relay header');
      const data = body.subarray(dataOffset);
      if (this.shouldInterrupt(data.length)) {
        this.stats.interruptions += 1;
        continue;
      }
      const jitter = (Math.random() * 2 - 1) * this.profile.jitterMs;
      const delay = Math.max(0, this.profile.latencyMs / 2 + jitter / 2 + data.length * 8 / this.profile.upKbps);
      setTimeout(() => {
        if (client.destroyed) return;
        this.stats.upBytes += data.length;
        udp.send(data, port, host);
      }, delay);
    }
  }

  async handleClient(client) {
    this.sockets.add(client);
    client.on('close', () => this.sockets.delete(client));
    client.on('error', () => {});
    const reader = new BufferedSocketReader(client);
    try {
      const hello = await reader.read(2);
      if (hello[0] !== 5) throw new Error('Unsupported SOCKS version');
      await reader.read(hello[1]);
      client.write(Buffer.from([5, 0]));
      const request = await reader.read(4);
      if (request[0] !== 5 || ![1, 5].includes(request[1])) throw new Error('Unsupported SOCKS command');
      const host = await this.readSocksAddress(reader, request[3]);
      const port = (await reader.read(2)).readUInt16BE(0);
      if (request[1] === 5) {
        await this.handleUdpInTcp(client, reader);
        return;
      }
      const upstream = net.createConnection({ host, port });
      this.sockets.add(upstream);
      upstream.on('close', () => this.sockets.delete(upstream));
      upstream.on('error', () => client.destroy());
      await new Promise((resolve, reject) => {
        upstream.once('connect', resolve);
        upstream.once('error', reject);
        upstream.setTimeout(15000, () => reject(new Error('Upstream timeout')));
      });
      upstream.setTimeout(0);
      client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
      this.stats.connections += 1;
      const remainder = reader.detach();
      const closeBoth = () => { client.destroy(); upstream.destroy(); };
      const up = new ShapingTransform({ profile: this.profile, kbps: this.profile.upKbps, direction: 'upBytes', stats: this.stats, shouldInterrupt: (bytes) => this.shouldInterrupt(bytes) });
      const down = new ShapingTransform({ profile: this.profile, kbps: this.profile.downKbps, direction: 'downBytes', stats: this.stats, shouldInterrupt: (bytes) => this.shouldInterrupt(bytes) });
      up.on('error', closeBoth);
      down.on('error', closeBoth);
      if (remainder.length) up.write(remainder);
      client.pipe(up).pipe(upstream);
      upstream.pipe(down).pipe(client);
    } catch {
      try { client.write(Buffer.from([5, 1, 0, 1, 0, 0, 0, 0, 0, 0])); } catch {}
      client.destroy();
    }
  }

  async stop() {
    clearInterval(this.statsTimer);
    for (const socket of this.sockets) {
      if (typeof socket.destroy === 'function') socket.destroy();
      else if (typeof socket.close === 'function') { try { socket.close(); } catch {} }
    }
    this.sockets.clear();
    if (this.server) await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
  }
}

class WeakNetworkService {
  constructor({ appPath, onStatus, onStats }) {
    this.appPath = appPath;
    this.onStatus = onStatus;
    this.onStats = onStats;
    this.adbPath = process.env.ADB_PATH || (process.platform === 'win32' ? 'adb.exe' : 'adb');
    this.resolvedAgentPath = null;
    this.session = null;
    this.operationId = null;
  }

  emit(phase, message, details = {}) {
    this.onStatus?.({ phase, message, ...details });
  }

  async adb(args, timeout = 30000) {
    const { stdout } = await execFileAsync(this.adbPath, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  }

  async ensureAdb() {
    try { await this.adb(['start-server']); }
    catch (error) { throw new Error(error.code === 'ENOENT' ? '未找到 ADB，请先安装 Android Platform Tools。' : `ADB 启动失败：${error.message}`); }
  }

  async listDevices() {
    await this.ensureAdb();
    return parseDevices(await this.adb(['devices', '-l']));
  }

  agentCandidates() {
    const resourcesPath = process.resourcesPath || path.dirname(this.appPath);
    return [...new Set([
      path.join(this.appPath, 'resources', 'weak-network', 'sockstun-agent.apk'),
      path.join(resourcesPath, 'app.asar.unpacked', 'resources', 'weak-network', 'sockstun-agent.apk'),
      path.join(resourcesPath, 'resources', 'weak-network', 'sockstun-agent.apk'),
      path.join(path.dirname(this.appPath), 'resources', 'weak-network', 'sockstun-agent.apk')
    ])];
  }

  agentTempPath() {
    return path.join(os.tmpdir(), 'test-cat-weak-network', 'sockstun-agent-' + AGENT_SHA256.slice(0, 12) + '.apk');
  }

  verifyAgent() {
    if (this.resolvedAgentPath && fs.existsSync(this.resolvedAgentPath)) return this.resolvedAgentPath;
    let lastError = null;
    for (const file of this.agentCandidates()) {
      try {
        const content = fs.readFileSync(file);
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        if (hash !== AGENT_SHA256) throw new Error('弱网手机端组件校验失败，为安全起见已停止部署。');
        if (!file.includes('.asar')) {
          this.resolvedAgentPath = file;
          return file;
        }
        const tempFile = this.agentTempPath();
        fs.mkdirSync(path.dirname(tempFile), { recursive: true });
        if (!fs.existsSync(tempFile) || crypto.createHash('sha256').update(fs.readFileSync(tempFile)).digest('hex') !== AGENT_SHA256) {
          fs.writeFileSync(tempFile, content);
        }
        this.resolvedAgentPath = tempFile;
        return tempFile;
      } catch (error) {
        lastError = error;
      }
    }
    const error = new Error('弱网手机端组件缺失，请重新获取项目资源。');
    error.cause = lastError;
    throw error;
  }

  async isAgentInstalled(serial) {
    try { return (await this.adb(['-s', serial, 'shell', 'pm', 'path', AGENT_PACKAGE])).includes('package:'); }
    catch { return false; }
  }

  async getForegroundComponent(serial) {
    const commands = [
      ['-s', serial, 'shell', 'dumpsys', 'window'],
      ['-s', serial, 'shell', 'dumpsys', 'activity', 'activities']
    ];
    for (const args of commands) {
      try {
        const target = parseForegroundComponent(await this.adb(args, 5000));
        if (target) return target;
      } catch {}
    }
    return null;
  }

  isRestorableForeground(target) {
    if (!target?.packageName || !target?.component) return false;
    if (target.packageName === AGENT_PACKAGE) return false;
    if (target.packageName === 'android') return false;
    if (target.packageName === 'com.android.systemui') return false;
    if (/launcher/i.test(target.packageName)) return false;
    return true;
  }

  async restoreForeground(serial, target) {
    if (this.isRestorableForeground(target)) {
      try {
        await this.adb(['-s', serial, 'shell', 'input', 'keyevent', 'KEYCODE_BACK']);
        await new Promise((resolve) => setTimeout(resolve, 350));
        const current = await this.getForegroundComponent(serial);
        if (current?.packageName === target.packageName) return true;
      } catch {}
      try {
        await this.adb(['-s', serial, 'shell', 'am', 'start', '-W', '-n', target.component], 20000);
        return true;
      } catch {}
      try {
        await this.adb(['-s', serial, 'shell', 'monkey', '-p', target.packageName, '1'], 12000);
        return true;
      } catch {}
    }
    try { await this.adb(['-s', serial, 'shell', 'input', 'keyevent', 'KEYCODE_HOME']); } catch {}
    return false;
  }

  async deployAgent(serial) {
    const file = this.verifyAgent();
    this.emit('deploying', '正在一键部署手机端弱网组件…');
    const install = async (options) => {
      try {
        const output = await this.adb(['-s', serial, 'install', ...options, file], 120000);
        if (!/Success/i.test(output)) throw Object.assign(new Error(output || 'ADB install failed'), { stdout: output });
        return output;
      } catch (error) {
        error.installFailure = classifyInstallError(error);
        throw error;
      }
    };

    try {
      await install(['-r', '-d', '-t', '-g']);
      return;
    } catch (firstError) {
      if (firstError.installFailure.code === 'low-target') {
        try {
          await install(['--bypass-low-target-sdk-block', '-r', '-d', '-t', '-g']);
          return;
        } catch (error) {
          if (error.installFailure.code !== 'replace-required') throw new Error(error.installFailure.message);
        }
      } else if (firstError.installFailure.code !== 'replace-required') {
        throw new Error(firstError.installFailure.message);
      }
    }

    this.emit('deploying', '正在替换手机中的旧版弱网组件…');
    try { await this.adb(['-s', serial, 'uninstall', AGENT_PACKAGE], 60000); } catch {}
    try {
      await install(['-t', '-g']);
    } catch (error) {
      if (error.installFailure.code !== 'low-target') throw new Error(error.installFailure.message);
      try { await install(['--bypass-low-target-sdk-block', '-t', '-g']); }
      catch (lastError) { throw new Error(lastError.installFailure.message); }
    }
  }

  async dumpUi(serial) {
    const remoteFile = '/sdcard/test-cat-window.xml';
    const allModes = ['stdout', 'compressed-file', 'plain-file'];
    const modes = this.uiDumpMode ? [this.uiDumpMode, ...allModes.filter((mode) => mode !== this.uiDumpMode)] : allModes;
    let lastError;
    for (const mode of modes) {
      try {
        let xml;
        if (mode === 'stdout') {
          xml = await this.adb(['-s', serial, 'exec-out', 'uiautomator', 'dump', '/dev/tty'], 2500);
        } else {
          const args = mode === 'compressed-file'
            ? ['-s', serial, 'shell', 'uiautomator', 'dump', '--compressed', remoteFile]
            : ['-s', serial, 'shell', 'uiautomator', 'dump', remoteFile];
          await this.adb(args, 2500);
          xml = await this.adb(['-s', serial, 'shell', 'cat', remoteFile], 2500);
        }
        const nodes = parseUiHierarchy(xml);
        if (!nodes.length) throw new Error('UI hierarchy is empty');
        this.uiDumpMode = mode;
        this.lastUiError = null;
        return nodes;
      } catch (error) {
        lastError = error;
        if (this.uiDumpMode) this.uiDumpMode = null;
      } finally {
        if (mode !== 'stdout') {
          try { await this.adb(['-s', serial, 'shell', 'rm', '-f', remoteFile]); } catch {}
        }
      }
    }
    this.lastUiError = lastError;
    throw lastError || new Error('Unable to read Android UI hierarchy');
  }

  findUiNode(nodes, id) {
    const exact = nodes.find((node) => node['resource-id'] === id || node['resource-id']?.endsWith(`:id/${id}`) || node['resource-id']?.endsWith(`/id/${id}`));
    if (exact) return exact;
    const textMatchers = {
      socks_addr: (node) => /EditText$/.test(node.class || '') && /^127\.0\.0\.1$/.test(node.text || ''),
      socks_port: (node) => /EditText$/.test(node.class || '') && /^1080$|^27183$/.test(node.text || ''),
      udp_in_tcp: (node) => /UDP relay over TCP/i.test(node.text || ''),
      remote_dns: (node) => /^Remote DNS$/i.test(node.text || ''),
      global: (node) => /^Global$/i.test(node.text || ''),
      ipv4: (node) => /^IPv4$/i.test(node.text || ''),
      ipv6: (node) => /^IPv6$/i.test(node.text || ''),
      save: (node) => /^Save$/i.test(node.text || ''),
      control: (node) => /^(Enable|Disable)$/i.test(node.text || '')
    };
    return textMatchers[id] ? nodes.find(textMatchers[id]) : undefined;
  }

  async tapNode(serial, node, label) {
    if (!node?.center || !node.enabled) throw new Error(`手机端配置项“${label}”不可用，请保持手机解锁后重试。`);
    await this.adb(['-s', serial, 'shell', 'input', 'tap', String(node.center.x), String(node.center.y)]);
    await new Promise((resolve) => setTimeout(resolve, 180));
  }

  async waitForUi(serial, predicate, timeout = 12000) {
    const deadline = Date.now() + timeout;
    let lastNodes = [];
    while (Date.now() < deadline) {
      try {
        lastNodes = await this.dumpUi(serial);
        if (predicate(lastNodes)) return lastNodes;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 450));
    }
    return lastNodes;
  }

  async acceptVpnPermission(serial) {
    const nodes = await this.waitForUi(serial, (items) => items.some((node) => node['resource-id'] === 'android:id/button1' || /^(确定|允许|OK|Allow)$/i.test(node.text || '')), 2500);
    const confirm = nodes.find((node) => node['resource-id'] === 'android:id/button1')
      || nodes.find((node) => /^(确定|允许|OK|Allow)$/i.test(node.text || ''));
    if (!confirm) return false;
    await this.tapNode(serial, confirm, 'VPN 授权');
    return true;
  }

  findVpnConfirmation(nodes) {
    return nodes.find((node) => node['resource-id'] === 'android:id/button1')
      || nodes.find((node) => /^(确定|允许|OK|Allow)$/i.test(node.text || ''));
  }

  async setTextField(serial, node, value, label) {
    await this.tapNode(serial, node, label);
    await this.adb(['-s', serial, 'shell', 'input', 'keyevent', 'KEYCODE_MOVE_END']);
    await this.adb(['-s', serial, 'shell', 'sh', '-c', 'i=0; while [ $i -lt 32 ]; do input keyevent KEYCODE_DEL; i=$((i+1)); done']);
    await this.adb(['-s', serial, 'shell', 'input', 'text', String(value)]);
    try {
      const state = await this.adb(['-s', serial, 'shell', 'dumpsys', 'input_method']);
      if (/mInputShown=true|isInputViewShown=true|mIsInputViewShown=true/.test(state)) {
        await this.adb(['-s', serial, 'shell', 'input', 'keyevent', 'KEYCODE_BACK']);
      }
    } catch {}
  }

  async isEmulator(serial) {
    if (/^emulator-|^127\.0\.0\.1:|^localhost:/i.test(serial)) return true;
    try {
      const values = await Promise.all([
        this.adb(['-s', serial, 'shell', 'getprop', 'ro.kernel.qemu']),
        this.adb(['-s', serial, 'shell', 'getprop', 'ro.hardware'])
      ]);
      return values[0].trim() === '1' || /goldfish|ranchu|qemu|vbox|nemu/i.test(values.join(' '));
    } catch {
      return false;
    }
  }

  async getScreenSize(serial) {
    const output = await this.adb(['-s', serial, 'shell', 'wm', 'size']);
    const matches = [...output.matchAll(/(?:Physical|Override) size:\s*(\d+)x(\d+)/gi)];
    const match = matches.at(-1) || output.match(/(\d+)x(\d+)/);
    if (!match) throw new Error('无法读取模拟器分辨率。');
    return { width: Number(match[1]), height: Number(match[2]) };
  }

  async configureEmulatorByCoordinates(serial) {
    this.emit('configuring', '正在使用模拟器兼容模式自动配置…');
    const { width, height } = await this.getScreenSize(serial);
    if (width <= height) throw new Error('模拟器兼容模式需要横屏，请将模拟器切换为横屏后重试。');
    const nodeAt = (x, y) => ({ enabled: true, center: { x: Math.round(width * x), y: Math.round(height * y) } });

    await this.setTextField(serial, nodeAt(0.2, 0.195), '127.0.0.1', '代理地址');
    await this.setTextField(serial, nodeAt(0.2, 0.386), String(PROXY_PORT), '代理端口');

    // pm clear guarantees the official defaults: Remote DNS/IPv4/IPv6 on,
    // UDP-over-TCP/Global off. Toggle only the three values that must change.
    await this.tapNode(serial, nodeAt(0.515, 0.837), 'UDP relay over TCP');
    await this.tapNode(serial, nodeAt(0.267, 0.9), 'IPv6');
    await this.tapNode(serial, nodeAt(0.515, 0.9), 'Global');
    await this.tapNode(serial, nodeAt(0.25, 0.968), 'Save');
    await this.tapNode(serial, nodeAt(0.75, 0.968), 'Enable');
    await new Promise((resolve) => setTimeout(resolve, 450));
    // A fresh emulator may show the system VPN confirmation after Enable.
    // This point is the positive-button area on the landscape Android dialog;
    // if no dialog is present it lands on an inert part of the form.
    await this.tapNode(serial, nodeAt(0.75, 0.68), 'VPN 授权');
  }

  async configureAgent(serial, restoreTarget = null) {
    this.emit('configuring', '正在自动配置手机端弱网组件…');
    await this.adb(['-s', serial, 'shell', 'am', 'force-stop', AGENT_PACKAGE]);
    const cleared = await this.adb(['-s', serial, 'shell', 'pm', 'clear', AGENT_PACKAGE], 30000);
    if (cleared && !/Success/i.test(cleared)) throw new Error('无法重置手机端弱网组件，请确认手机已解锁后重试。');
    await this.adb(['-s', serial, 'shell', 'am', 'start', '-W', '-n', AGENT_COMPONENT], 30000);
    const emulatorMode = await this.isEmulator(serial);
    let nodes = await this.waitForUi(serial, (items) => Boolean(this.findUiNode(items, 'socks_port') || this.findVpnConfirmation(items)), emulatorMode ? 9000 : 15000);
    const firstConfirmation = this.findVpnConfirmation(nodes);
    if (firstConfirmation) {
      await this.tapNode(serial, firstConfirmation, 'VPN 授权');
      nodes = await this.waitForUi(serial, (items) => Boolean(this.findUiNode(items, 'socks_port')), 12000);
    }
    const address = this.findUiNode(nodes, 'socks_addr');
    const port = this.findUiNode(nodes, 'socks_port');
    if (!address || !port) {
      if (emulatorMode) {
        await this.configureEmulatorByCoordinates(serial);
        nodes = [];
      } else {
        const detail = this.lastUiError?.message ? `（页面读取失败：${this.lastUiError.message}）` : '';
        throw new Error(`无法打开手机端弱网配置页。请保持手机解锁，并允许 Test cat 的 VPN 请求后重试。${detail}`);
      }
    }
    if (!nodes.length) {
      await this.acceptVpnPermission(serial);
      return this.waitForAgentProcess(serial, restoreTarget);
    }
    await this.setTextField(serial, address, '127.0.0.1', '代理地址');
    nodes = await this.dumpUi(serial);
    await this.setTextField(serial, this.findUiNode(nodes, 'socks_port'), String(PROXY_PORT), '代理端口');

    nodes = await this.dumpUi(serial);
    const checkboxStates = { udp_in_tcp: true, remote_dns: true, global: true, ipv4: true, ipv6: false };
    for (const [id, desired] of Object.entries(checkboxStates)) {
      const node = this.findUiNode(nodes, id);
      if (!node) throw new Error(`手机端组件缺少配置项 ${id}，请重新部署。`);
      if (node.checked !== desired) await this.tapNode(serial, node, id);
    }

    nodes = await this.dumpUi(serial);
    await this.tapNode(serial, this.findUiNode(nodes, 'save'), '保存');
    nodes = await this.dumpUi(serial);
    await this.tapNode(serial, this.findUiNode(nodes, 'control'), '启用');
    await this.acceptVpnPermission(serial);

    return this.waitForAgentProcess(serial, restoreTarget);
  }

  async waitForAgentProcess(serial, restoreTarget = null) {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      try {
        const pid = (await this.adb(['-s', serial, 'shell', 'pidof', `${AGENT_PACKAGE}:native`])).trim();
        if (pid) {
          await this.restoreForeground(serial, restoreTarget);
          return;
        }
      } catch {}
      try {
        const permissionNodes = await this.dumpUi(serial);
        const confirmation = this.findVpnConfirmation(permissionNodes);
        if (confirmation) await this.tapNode(serial, confirmation, 'VPN 授权');
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('手机端 VPN 未能启动。请确认手机已解锁，并允许 SocksTun 的 VPN 连接请求。');
  }

  async disableAgent(serial) {
    let disabled = false;
    try {
      await this.adb(['-s', serial, 'shell', 'am', 'start', '-W', '-n', AGENT_COMPONENT], 20000);
      const nodes = await this.waitForUi(serial, (items) => Boolean(this.findUiNode(items, 'control')), 6000);
      const control = this.findUiNode(nodes, 'control');
      if (control && /disable|停用|禁用|关闭/i.test(control.text || '')) {
        await this.tapNode(serial, control, '停用');
        disabled = true;
      }
    } catch {}
    try { await this.adb(['-s', serial, 'shell', 'am', 'force-stop', AGENT_PACKAGE]); } catch {}
    if (!disabled) {
      try { await this.adb(['-s', serial, 'shell', 'pm', 'clear', AGENT_PACKAGE], 30000); } catch {}
    }
  }

  async start({ serial, profile }) {
    if (!serial || typeof serial !== 'string' || serial.length > 200) throw new Error('请选择一台已连接的 Android 设备。');
    await this.stop();
    const operationId = Symbol('weak-network-start');
    this.operationId = operationId;
    const ensureActive = () => {
      if (this.operationId !== operationId) {
        const error = new Error('弱网开启操作已取消');
        error.code = 'CANCELLED';
        throw error;
      }
    };
    const devices = await this.listDevices();
    ensureActive();
    const device = devices.find((item) => item.serial === serial);
    if (!device) throw new Error('设备已断开，请刷新设备列表。');
    if (device.state === 'unauthorized') throw new Error('请在手机上点击“允许 USB 调试”，然后刷新设备。');
    if (device.state !== 'device') throw new Error('设备当前离线，请重新连接数据线。');
    const selectedProfile = normalizeProfile(profile);
    if (!await this.isAgentInstalled(serial)) await this.deployAgent(serial);
    ensureActive();
    const restoreTarget = await this.getForegroundComponent(serial);
    const proxy = new WeakNetworkProxy(selectedProfile, (stats) => this.onStats?.(stats));
    try {
      this.emit('starting', '正在建立 USB 弱网通道…');
      await proxy.start();
      this.session = { serial, profile: selectedProfile, proxy };
      ensureActive();
      await this.adb(['-s', serial, 'reverse', `tcp:${PROXY_PORT}`, `tcp:${PROXY_PORT}`]);
      ensureActive();
      await this.configureAgent(serial, restoreTarget);
      ensureActive();
      this.emit('running', `${selectedProfile.name}弱网已开启`, { serial, profile: selectedProfile, needsVpnConfirmation: false });
      return { serial, profile: selectedProfile, needsVpnConfirmation: false };
    } catch (error) {
      if (this.session?.proxy === proxy) this.session = null;
      await proxy.stop();
      try { await this.disableAgent(serial); } catch {}
      try { await this.restoreForeground(serial, restoreTarget); } catch {}
      try { await this.adb(['-s', serial, 'reverse', '--remove', `tcp:${PROXY_PORT}`]); } catch {}
      if (error.code !== 'CANCELLED') this.emit('error', error.message || '弱网开启失败');
      throw error;
    }
  }

  async stop() {
    this.operationId = Symbol('weak-network-stopped');
    const session = this.session;
    this.session = null;
    if (!session) return { stopped: true };
    this.emit('stopping', '正在恢复手机正常网络…');
    try { await this.disableAgent(session.serial); } catch {}
    try { await this.adb(['-s', session.serial, 'reverse', '--remove', `tcp:${PROXY_PORT}`]); } catch {}
    await session.proxy.stop();
    this.emit('idle', '已恢复正常网络');
    return { stopped: true };
  }

  getPresets() {
    return Object.values(PRESETS);
  }

  async dispose() {
    await this.stop();
  }
}

module.exports = { WeakNetworkService, WeakNetworkProxy, PRESETS, normalizeProfile, parseDevices, parseForegroundComponent, parseUiHierarchy, classifyInstallError, PROXY_PORT };
