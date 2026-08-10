const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Readable } = require('node:stream');
const { androidAdbCandidates, resolveAndroidAdb } = require('./android-adb-runtime');

const execFileAsync = promisify(execFile);

function parseProperties(text) {
  const properties = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^\[([^\]]+)\]:\s*\[(.*)\]$/);
    if (match) properties[match[1]] = match[2].trim();
  }
  return properties;
}

function parseResolution(text) {
  const entries = [...String(text || '').matchAll(/(Physical|Override) size:\s*(\d+)x(\d+)/gi)];
  const selected = entries.find((match) => match[1].toLowerCase() === 'override') || entries[0];
  if (!selected) return null;
  return { width: Number(selected[2]), height: Number(selected[3]), source: selected[1].toLowerCase() === 'override' ? '系统当前分辨率' : '物理分辨率' };
}

function parseCpuCoreCount(text) {
  let count = 0;
  for (const part of String(text || '').trim().split(',')) {
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) count += Math.max(0, Number(range[2]) - Number(range[1]) + 1);
    else if (/^\d+$/.test(part)) count += 1;
  }
  return count || null;
}

function parseMemory(text) {
  const totalKb = Number(String(text || '').match(/^MemTotal:\s*(\d+)\s*kB/im)?.[1]);
  if (!Number.isFinite(totalKb) || totalKb <= 0) return null;
  const totalBytes = totalKb * 1024;
  return { totalBytes, totalGb: Math.round(totalBytes / 1024 ** 3 * 10) / 10 };
}

function parseBattery(text) {
  const source = String(text || '');
  const number = (name) => {
    const value = Number(source.match(new RegExp(`^\\s*${name}:\\s*(-?\\d+)`, 'im'))?.[1]);
    return Number.isFinite(value) ? value : null;
  };
  const level = number('level');
  const scale = number('scale') || 100;
  const statusCode = number('status');
  const healthCode = number('health');
  const temperatureRaw = number('temperature');
  const plugged = ['AC powered', 'USB powered', 'Wireless powered', 'Dock powered'].filter((name) => new RegExp(`^\\s*${name}:\\s*true`, 'im').test(source));
  const status = ({ 1: '状态未知', 2: '充电中', 3: '放电中', 4: '未充电', 5: '已充满' })[statusCode] || '设备未提供';
  const health = ({ 1: '状态未知', 2: '良好', 3: '过热', 4: '故障', 5: '过压', 6: '异常', 7: '过冷' })[healthCode] || '设备未提供';
  const connectionLabels = { 'AC powered': '交流电源', 'USB powered': 'USB', 'Wireless powered': '无线充电', 'Dock powered': '底座' };
  return {
    level: Number.isFinite(level) ? Math.max(0, Math.min(100, Math.round(level / scale * 100))) : null,
    status,
    health,
    plugged: plugged.map((name) => connectionLabels[name]),
    temperature: Number.isFinite(temperatureRaw) && temperatureRaw > 0 ? temperatureRaw / 10 : null
  };
}

function normalizeThermalValue(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const celsius = Math.abs(value) >= 1000 ? value / 1000 : Math.abs(value) >= 200 ? value / 10 : value;
  return celsius >= 0 && celsius <= 150 ? Math.round(celsius * 10) / 10 : null;
}

function parseThermals(text) {
  const sensors = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^([^=]+)=(-?[\d.]+)$/);
    if (!match) continue;
    const type = match[1].trim();
    const value = normalizeThermalValue(match[2]);
    if (value == null) continue;
    sensors.push({ type, value });
  }
  const cpuSensors = sensors.filter((sensor) => /cpu|soc|ap(?:_|$)|cluster|little|big/i.test(sensor.type) && !/gpu|battery|charger/i.test(sensor.type));
  return cpuSensors.sort((a, b) => b.value - a.value)[0] || null;
}

function parseForegroundPackage(activities, windows = '') {
  return String(activities || '').match(/(?:topResumedActivity|mResumedActivity)[^\n]*?\s([a-zA-Z0-9_.]+)\//)?.[1]
    || String(activities || '').match(/mFocusedApp[^\n]*?\s([a-zA-Z0-9_.]+)\//)?.[1]
    || String(windows || '').match(/(?:mCurrentFocus|mFocusedApp)[^\n]*?\s([a-zA-Z0-9_.]+)\//)?.[1]
    || '';
}

function parsePackageInfo(text, packageName) {
  const source = String(text || '');
  const versionNameRaw = source.match(/^\s*versionName=(.*)$/m)?.[1]?.trim() || '';
  const versionName = /^(?:null|unknown)$/i.test(versionNameRaw) ? '' : versionNameRaw;
  const versionCode = source.match(/^\s*versionCode=(\d+)/m)?.[1] || '';
  return { packageName: packageName || '', versionName, versionCode };
}

function parseNetwork({ connectivity, wifi, route, ipAddress, airplaneMode, properties }) {
  const connectivityText = String(connectivity || '');
  const wifiText = String(wifi || '');
  const routeInterface = String(route || '').match(/\bdefault\b[^\n]*\bdev\s+(\S+)/)?.[1] || '';
  const wifiConnected = /^wlan/i.test(routeInterface)
    || /Supplicant state:\s*COMPLETED|mNetworkInfo[^\n]*CONNECTED/i.test(wifiText)
    || /NetworkAgentInfo[^\n]*(?:TRANSPORT_WIFI|\bWIFI\b)[^\n]*(?:CONNECTED|VALIDATED)/i.test(connectivityText);
  const cellularConnected = /^(rmnet|ccmni|pdp)/i.test(routeInterface)
    || /NetworkAgentInfo[^\n]*(?:TRANSPORT_CELLULAR|\bMOBILE\b)[^\n]*(?:CONNECTED|VALIDATED)/i.test(connectivityText);
  const vpnActive = /NetworkAgentInfo[^\n]*(?:TRANSPORT_VPN|\bVPN\b)[^\n]*(?:CONNECTED|VALIDATED)/i.test(connectivityText);
  const ssidRaw = wifiText.match(/\bSSID:\s*(?:"([^"]+)"|([^,\n]+))/i);
  const ssid = (ssidRaw?.[1] || ssidRaw?.[2] || '').trim().replace(/^<unknown ssid>$/i, '');
  const ipv4 = String(ipAddress || '').match(/\binet\s+(\d+\.\d+\.\d+\.\d+)\//)?.[1] || '';
  const mobileType = properties?.['gsm.network.type'] || properties?.['ro.telephony.default_network'] || '';
  const airplane = String(airplaneMode).trim() === '1';
  let type = '未连接';
  if (wifiConnected || /^wlan/i.test(routeInterface)) type = 'Wi-Fi';
  else if (cellularConnected || /^(rmnet|ccmni|pdp)/i.test(routeInterface)) type = '移动网络';
  else if (routeInterface) type = `已连接（${routeInterface}）`;
  else if (airplane) type = '飞行模式';
  return { type, ssid, ipv4, interface: routeInterface, mobileType, vpnActive, airplaneMode: airplane };
}

function formatUnknown(value) {
  return value === null || value === undefined || value === '' ? '设备未提供' : String(value);
}

function formatDeviceReport(info) {
  const resolution = info.resolution ? `${info.resolution.width} × ${info.resolution.height} px` : '设备未提供';
  const cpu = info.cpu.model && info.cpu.cores ? `${info.cpu.model}（${info.cpu.cores} 核）` : info.cpu.model || (info.cpu.cores ? `${info.cpu.cores} 核` : '');
  const battery = info.battery.level == null ? '设备未提供' : `${info.battery.level}%（${info.battery.status}${info.battery.plugged.length ? `，${info.battery.plugged.join('/')}` : ''}）`;
  const temperature = info.temperature.value == null ? '设备未提供' : `${info.temperature.value.toFixed(1)} ℃（${info.temperature.source}）`;
  const networkDetails = [info.network.type, info.network.ssid ? `SSID：${info.network.ssid}` : '', info.network.mobileType && info.network.type === '移动网络' ? info.network.mobileType : '', info.network.ipv4 ? `IPv4：${info.network.ipv4}` : '', info.network.airplaneMode ? '飞行模式已开启' : '', info.network.vpnActive ? 'VPN 已启用' : ''].filter(Boolean).join('；');
  return [
    '【缺陷环境信息】',
    `手机型号：${formatUnknown([info.manufacturer, info.model].filter(Boolean).join(' '))}`,
    `设备代号：${formatUnknown(info.deviceCode)}`,
    `Android 版本：${formatUnknown(info.androidVersion ? `Android ${info.androidVersion}${info.sdk ? `（API ${info.sdk}）` : ''}` : '')}`,
    `系统构建：${formatUnknown(info.buildFingerprint)}`,
    `屏幕分辨率：${resolution}`,
    `CPU：${formatUnknown(cpu)}`,
    `内存：${info.memory ? `${info.memory.totalGb.toFixed(1)} GB` : '设备未提供'}`,
    `电量：${battery}`,
    `温度：${temperature}`,
    `网络状态：${formatUnknown(networkDetails)}`,
    `当前连接设备：${formatUnknown(`${info.connection.type}（${info.serial}）`)}`,
    '',
    '【被测应用信息】',
    `App 包名：${formatUnknown(info.app.packageName)}`,
    `App 版本号：${formatUnknown(info.app.versionName)}`,
    `versionCode：${formatUnknown(info.app.versionCode)}`,
    '',
    `采集时间：${info.collectedAt}`,
    '信息来源：Test cat 通过 ADB 读取当前连接设备。'
  ].join('\n');
}

class MobileMirrorService {
  constructor({ appPath, onStatus, runtimeRoots = [], packaged = false }) {
    this.appPath = appPath;
    this.onStatus = onStatus;
    this.streamPort = null;
    this.serverClient = null;
    this.session = null;
    this.modulesPromise = null;
    this.adbPath = null;
    this.adbSource = null;
    this.runtimeRoots = runtimeRoots;
    this.packaged = Boolean(packaged);
  }

  async loadModules() {
    if (!this.modulesPromise) {
      this.modulesPromise = Promise.all([
        import('@yume-chan/adb'),
        import('@yume-chan/adb-server-node-tcp'),
        import('@yume-chan/adb-scrcpy'),
        import('@yume-chan/scrcpy')
      ]).then(([adb, nodeTcp, adbScrcpy, scrcpy]) => ({ adb, nodeTcp, adbScrcpy, scrcpy }));
    }
    return this.modulesPromise;
  }

  emitStatus(phase, message, details = {}) {
    const payload = { phase, message, ...details };
    this.onStatus(payload);
    this.postToRenderer({ type: 'status', payload });
  }

  postToRenderer(message) {
    try {
      this.streamPort?.postMessage(message);
    } catch {
      // The renderer may be reloading. A new port will be requested afterwards.
    }
  }

  attachPort(port) {
    try { this.streamPort?.close(); } catch {}
    this.streamPort = port;
    port.on('message', (event) => this.handlePortMessage(event.data));
    port.on('close', () => {
      if (this.streamPort === port) this.streamPort = null;
    });
    port.start();
    this.postToRenderer({ type: 'ready' });
  }

  getAdbCandidates() {
    return androidAdbCandidates({ runtimeRoots: this.runtimeRoots, appPath: this.appPath });
  }

  async startAdbServer() {
    if (this.adbPath) return this.adbPath;
    const message = this.packaged
      ? '内置 Android 调试引擎缺失或损坏，请重新安装 Test cat。'
      : 'Android 调试引擎尚未准备，请运行 npm run prepare:android-runtime。';
    const resolved = await resolveAndroidAdb({
      candidates: this.getAdbCandidates(),
      errorMessage: message,
      sourceOptions: { runtimeRoots: this.runtimeRoots, appPath: this.appPath, resourcesPath: process.resourcesPath || '', environment: process.env }
    });
    this.adbPath = resolved.path;
    this.adbSource = resolved.source;
    return this.adbPath;
  }

  async runAdb(serial, args, timeout = 15000) {
    const adbPath = this.adbPath || await this.startAdbServer();
    const { stdout } = await execFileAsync(adbPath, ['-s', serial, ...args], {
      timeout,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024
    });
    return stdout;
  }

  async safeAdb(serial, args, timeout = 15000) {
    try {
      return await this.runAdb(serial, args, timeout);
    } catch {
      return '';
    }
  }

  async ensureServerClient() {
    await this.startAdbServer();
    if (!this.serverClient) {
      const { adb, nodeTcp } = await this.loadModules();
      const connector = new nodeTcp.AdbServerNodeTcpConnector({ host: '127.0.0.1', port: 5037 });
      this.serverClient = new adb.AdbServerClient(connector);
    }
    return this.serverClient;
  }

  async listDevices() {
    try {
      this.emitStatus('scanning', '正在查找 Android 设备…');
      const client = await this.ensureServerClient();
      const devices = await client.getDevices(['device', 'unauthorized', 'offline']);
      const result = devices.map((device) => ({
        serial: device.serial,
        state: device.state,
        model: device.model || device.device || 'Android 设备',
        product: device.product || '',
        transportId: device.transportId.toString()
      }));
      this.emitStatus('idle', result.length ? `发现 ${result.length} 台设备` : '没有发现设备', { deviceCount: result.length });
      return result;
    } catch (error) {
      this.emitStatus('error', this.formatError(error));
      throw error;
    }
  }

  async getDeviceInfo({ serial, packageName = '' } = {}) {
    const safeSerial = String(serial || '').trim();
    if (!safeSerial || safeSerial.length > 200) throw new Error('请选择要检测的 Android 设备。');
    const requestedPackage = String(packageName || '').trim();
    if (requestedPackage && (!/^[a-zA-Z0-9_.]+$/.test(requestedPackage) || requestedPackage.length > 180)) throw new Error('App 包名格式不正确。');

    const client = await this.ensureServerClient();
    const devices = await client.getDevices(['device', 'unauthorized', 'offline']);
    const device = devices.find((item) => item.serial === safeSerial);
    if (!device) throw new Error('设备已断开，请刷新设备列表。');
    if (device.state === 'unauthorized') throw new Error('请先在手机上允许 USB 调试。');
    if (device.state !== 'device') throw new Error('设备当前离线，无法读取环境信息。');

    const thermalCommand = 'for z in /sys/class/thermal/thermal_zone*; do type=$(cat "$z/type" 2>/dev/null); temp=$(cat "$z/temp" 2>/dev/null); echo "$type=$temp"; done';
    const [
      propertiesText, resolutionText, memoryText, cpuPresentText, batteryText, thermalText,
      connectivityText, wifiText, routeText, ipText, airplaneMode, activitiesText, windowsText, devPath
    ] = await Promise.all([
      this.safeAdb(safeSerial, ['shell', 'getprop']),
      this.safeAdb(safeSerial, ['shell', 'wm', 'size']),
      this.safeAdb(safeSerial, ['shell', 'cat', '/proc/meminfo']),
      this.safeAdb(safeSerial, ['shell', 'cat', '/sys/devices/system/cpu/present']),
      this.safeAdb(safeSerial, ['shell', 'dumpsys', 'battery']),
      this.safeAdb(safeSerial, ['shell', thermalCommand], 20000),
      this.safeAdb(safeSerial, ['shell', 'dumpsys', 'connectivity'], 20000),
      this.safeAdb(safeSerial, ['shell', 'dumpsys', 'wifi'], 20000),
      this.safeAdb(safeSerial, ['shell', 'ip', 'route']),
      this.safeAdb(safeSerial, ['shell', 'ip', '-o', '-4', 'addr', 'show', 'scope', 'global']),
      this.safeAdb(safeSerial, ['shell', 'settings', 'get', 'global', 'airplane_mode_on']),
      this.safeAdb(safeSerial, ['shell', 'dumpsys', 'activity', 'activities'], 20000),
      this.safeAdb(safeSerial, ['shell', 'dumpsys', 'window', 'windows'], 20000),
      this.safeAdb(safeSerial, ['get-devpath'])
    ]);

    const properties = parseProperties(propertiesText);
    const appPackage = requestedPackage || parseForegroundPackage(activitiesText, windowsText);
    const packageText = appPackage ? await this.safeAdb(safeSerial, ['shell', 'dumpsys', 'package', appPackage], 20000) : '';
    const app = parsePackageInfo(packageText, appPackage);
    const battery = parseBattery(batteryText);
    const thermal = parseThermals(thermalText);
    const info = {
      serial: safeSerial,
      manufacturer: properties['ro.product.manufacturer'] || properties['ro.product.brand'] || '',
      model: properties['ro.product.model'] || device.model || device.device || '',
      deviceCode: properties['ro.product.device'] || properties['ro.product.name'] || '',
      androidVersion: properties['ro.build.version.release'] || '',
      sdk: properties['ro.build.version.sdk'] || '',
      buildFingerprint: properties['ro.build.fingerprint'] || '',
      resolution: parseResolution(resolutionText),
      cpu: {
        model: [properties['ro.soc.manufacturer'], properties['ro.soc.model']].filter(Boolean).join(' ')
          || properties['ro.hardware'] || properties['ro.board.platform'] || '',
        cores: parseCpuCoreCount(cpuPresentText)
      },
      memory: parseMemory(memoryText),
      battery,
      temperature: thermal
        ? { value: thermal.value, source: `CPU/SoC 传感器 ${thermal.type}` }
        : { value: battery.temperature, source: '电池温度' },
      network: parseNetwork({ connectivity: connectivityText, wifi: wifiText, route: routeText, ipAddress: ipText, airplaneMode, properties }),
      connection: {
        type: properties['ro.kernel.qemu'] === '1' || /^emulator-/i.test(safeSerial) ? 'Android 模拟器' : safeSerial.includes(':') ? '无线 ADB' : /usb/i.test(devPath) ? 'USB' : 'ADB',
        devPath: String(devPath || '').trim()
      },
      app,
      collectedAt: new Date().toLocaleString('zh-CN', { hour12: false })
    };
    info.report = formatDeviceReport(info);
    return info;
  }

  getServerPath() {
    return path.join(this.appPath, 'resources', 'scrcpy', 'scrcpy-server-v3.3.1');
  }

  normalizeOptions(options = {}) {
    const allowedSizes = new Set([720, 1080, 1440]);
    const allowedFps = new Set([30, 60]);
    const maxSize = Number(options.maxSize);
    const maxFps = Number(options.maxFps);
    return {
      maxSize: allowedSizes.has(maxSize) ? maxSize : 1080,
      maxFps: allowedFps.has(maxFps) ? maxFps : 60,
      videoBitRate: maxSize <= 720 ? 2_000_000 : maxSize <= 1080 ? 5_000_000 : 8_000_000
    };
  }

  async start({ serial, options }) {
    if (!serial || typeof serial !== 'string' || serial.length > 200) {
      throw new Error('请选择要连接的 Android 设备。');
    }
    if (!this.streamPort) throw new Error('投屏页面尚未准备完成，请重新进入模块后重试。');

    await this.stop(false);
    const client = await this.ensureServerClient();
    const devices = await client.getDevices(['device', 'unauthorized', 'offline']);
    const device = devices.find((item) => item.serial === serial);
    if (!device) throw new Error('设备已断开，请刷新设备列表。');
    if (device.state === 'unauthorized') throw new Error('请在手机上点击“允许 USB 调试”，然后刷新设备。');
    if (device.state !== 'device') throw new Error('设备当前离线，请重新连接数据线。');

    const { adbScrcpy, scrcpy } = await this.loadModules();
    const adb = await client.createAdb({ serial });
    const serverPath = this.getServerPath();
    if (!fs.existsSync(serverPath)) throw new Error('scrcpy 服务资源缺失，请重新安装项目依赖。');

    this.emitStatus('deploying', '正在向手机部署 scrcpy 服务…', { serial });
    const file = Readable.toWeb(fs.createReadStream(serverPath));
    await adbScrcpy.AdbScrcpyClient.pushServer(adb, file, scrcpy.DefaultServerPath);

    const quality = this.normalizeOptions(options);
    this.emitStatus('starting', 'scrcpy 已部署，正在启动画面…', { serial });
    const scrcpyOptions = new adbScrcpy.AdbScrcpyOptions3_3_1({
      video: true,
      audio: false,
      control: true,
      tunnelForward: true,
      videoCodec: 'h264',
      maxSize: quality.maxSize,
      maxFps: quality.maxFps,
      videoBitRate: quality.videoBitRate,
      stayAwake: true,
      powerOn: true,
      clipboardAutosync: true,
      logLevel: 'info'
    });

    let scrcpyClient;
    try {
      scrcpyClient = await adbScrcpy.AdbScrcpyClient.start(adb, scrcpy.DefaultServerPath, scrcpyOptions);
      const video = await scrcpyClient.videoStream;
      if (!video) throw new Error('设备没有返回视频流。');

      const session = { serial, adb, client: scrcpyClient, video, stopping: false };
      this.session = session;
      session.unsubscribeVideoSize = video.sizeChanged(({ width, height }) => {
        this.postToRenderer({
          type: 'video-size',
          payload: { width, height, orientation: width >= height ? 'landscape' : 'portrait' }
        });
      });
      this.postToRenderer({
        type: 'video-meta',
        payload: {
          codec: video.metadata.codec,
          width: video.width,
          height: video.height,
          deviceName: video.metadata.deviceName || device.model || serial
        }
      });
      this.emitStatus('streaming', `正在投屏：${device.model || serial}`, { serial, model: device.model || serial });
      this.pumpVideo(session);
      this.consumeOutput(session);
      scrcpyClient.exited.then(() => this.handleSessionExit(session)).catch(() => this.handleSessionExit(session));
      adb.disconnected.then(() => this.handleSessionExit(session)).catch(() => this.handleSessionExit(session));
      return { serial, model: device.model || serial, ...quality };
    } catch (error) {
      try { await scrcpyClient?.close(); } catch {}
      try { await adb.close(); } catch {}
      this.emitStatus('error', this.formatError(error));
      throw error;
    }
  }

  async pumpVideo(session) {
    const reader = session.video.stream.getReader();
    session.reader = reader;
    try {
      while (!session.stopping) {
        const { value, done } = await reader.read();
        if (done) break;
        const bytes = value.data;
        const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const packet = { ...value, data };
        this.postToRenderer({ type: 'video-packet', payload: packet });
      }
    } catch (error) {
      if (!session.stopping) this.emitStatus('error', `视频流已中断：${this.formatError(error)}`);
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }

  async consumeOutput(session) {
    try {
      const reader = session.client.output.getReader();
      session.outputReader = reader;
      while (!session.stopping) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) this.postToRenderer({ type: 'log', payload: String(value) });
      }
      try { reader.releaseLock(); } catch {}
    } catch {}
  }

  async handlePortMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'control') {
      try {
        await this.sendControl(message.payload || {});
      } catch (error) {
        this.postToRenderer({ type: 'control-error', payload: this.formatError(error) });
      }
    }
  }

  async sendControl(command) {
    const controller = this.session?.client?.controller;
    if (!controller) return;
    switch (command.kind) {
      case 'touch': {
        const action = Number(command.action);
        const x = Math.max(0, Math.round(Number(command.x)));
        const y = Math.max(0, Math.round(Number(command.y)));
        const width = Math.max(1, Math.round(Number(command.width)));
        const height = Math.max(1, Math.round(Number(command.height)));
        await controller.injectTouch({
          action,
          pointerId: 0n,
          pointerX: x,
          pointerY: y,
          videoWidth: width,
          videoHeight: height,
          pressure: action === 1 ? 0 : 1,
          actionButton: 1,
          buttons: action === 1 ? 0 : 1
        });
        break;
      }
      case 'key': {
        const keyCode = Number(command.keyCode);
        if (!Number.isInteger(keyCode) || keyCode < 0 || keyCode > 400) return;
        await controller.injectKeyCode({ action: 0, keyCode, repeat: 0, metaState: 0 });
        await controller.injectKeyCode({ action: 1, keyCode, repeat: 0, metaState: 0 });
        break;
      }
      case 'text':
        await controller.injectText(String(command.text || '').slice(0, 500));
        break;
      case 'rotate':
        await controller.rotateDevice();
        break;
      case 'screen-off':
        await controller.setScreenPowerMode(0);
        break;
      case 'screen-on':
        await controller.setScreenPowerMode(2);
        break;
      default:
        break;
    }
  }

  async handleSessionExit(session) {
    if (this.session !== session || session.stopping) return;
    await this.stop(false);
    this.emitStatus('idle', '设备连接已结束');
  }

  async stop(announce = true) {
    const session = this.session;
    this.session = null;
    if (!session) {
      if (announce) this.emitStatus('idle', '投屏尚未启动');
      return;
    }
    session.stopping = true;
    try { session.unsubscribeVideoSize?.(); } catch {}
    try { await session.reader?.cancel(); } catch {}
    try { await session.outputReader?.cancel(); } catch {}
    try { await session.client.close(); } catch {}
    try { await session.adb.close(); } catch {}
    this.postToRenderer({ type: 'video-ended' });
    if (announce) this.emitStatus('idle', '投屏已停止');
  }

  formatError(error) {
    const message = error?.message || String(error || '未知错误');
    if (/ECONNREFUSED|5037/.test(message)) return 'ADB 服务连接失败，请确认 Android Platform Tools 可用。';
    if (/unauthorized/i.test(message)) return '设备尚未授权，请在手机上允许 USB 调试。';
    return message.replace(/^Error:\s*/, '');
  }

  async dispose() {
    await this.stop(false);
    try { this.streamPort?.close(); } catch {}
    this.streamPort = null;
  }
}

module.exports = {
  MobileMirrorService,
  __test: {
    formatDeviceReport,
    parseBattery,
    parseCpuCoreCount,
    parseForegroundPackage,
    parseMemory,
    parseNetwork,
    parsePackageInfo,
    parseProperties,
    parseResolution,
    parseThermals
  }
};
