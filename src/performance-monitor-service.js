const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const ALLOWED_METRICS = new Set(['cpu', 'memory', 'gpu', 'network', 'disk', 'app', 'device']);
const PACKAGE_METRICS = new Set(['cpu', 'memory', 'gpu', 'network', 'app']);

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function isIgnoredForegroundPackage(packageName) {
  const value = String(packageName || '').toLowerCase();
  if (!value) return true;
  if (value === 'android' || value === 'com.android.systemui') return true;
  return /(^|\.)(launcher|home|trebuchet)(\.|$)/.test(value)
    || /miui\.home|huawei\.android\.launcher|samsung\.android\.app\.launcher|oppo\.launcher|coloros\.launcher|vivo\.launcher|realme\.launcher|oneplus\.launcher|pixel\.launcher|nexuslauncher/.test(value);
}

function parseCpuStat(text) {
  const values = String(text || '').trim().split(/\s+/).slice(1).map(Number);
  if (values.length < 5 || values.some((value) => !Number.isFinite(value))) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return { total, idle: values[3], ioWait: values[4] };
}

function calculateCpuDelta(current, previous) {
  if (!current || !previous) return null;
  const total = current.total - previous.total;
  if (total <= 0) return null;
  const idle = current.idle - previous.idle;
  const ioWait = current.ioWait - previous.ioWait;
  return {
    usage: clamp(100 * (total - idle - ioWait) / total, 0, 100),
    ioWait: clamp(100 * ioWait / total, 0, 100),
    total
  };
}

function normalizeFrequencyMHz(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  if (number >= 10_000_000) return number / 1_000_000;
  if (number >= 10_000) return number / 1_000;
  return number;
}

function parseCpuFrequency(text) {
  const values = String(text || '').split(/\s+/).map(normalizeFrequencyMHz).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function parseCpuTemperature(text) {
  const candidates = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const [rawType, rawValue] = line.split('|');
    const type = String(rawType || '').trim().toLowerCase();
    let value = Number(rawValue);
    if (!type || !Number.isFinite(value)) continue;
    if (Math.abs(value) >= 1000) value /= 1000;
    if (value < 10 || value > 130) continue;
    const excluded = /(battery|batt|gpu|skin|shell|charger|usb|pmic|modem|wifi|quiet|xo)/.test(type);
    const cpuLike = /(cpu|soc|cluster|big|little|gold|silver|^ap$|ap[-_])/i.test(type);
    if (cpuLike && !excluded) candidates.push({ type, value });
  }
  if (!candidates.length) return null;
  return candidates.reduce((best, item) => item.value > best.value ? item : best);
}

function parseMeminfo(text) {
  const source = String(text || '');
  const readMb = (key) => {
    const value = Number(source.match(new RegExp(`^${key}:\\s+(\\d+)`, 'im'))?.[1]);
    return Number.isFinite(value) ? value / 1024 : null;
  };
  const total = readMb('MemTotal');
  const reportedAvailable = readMb('MemAvailable');
  const fallbackParts = [readMb('MemFree'), readMb('Buffers'), readMb('Cached'), readMb('SReclaimable')];
  const fallbackAvailable = fallbackParts.every(Number.isFinite)
    ? fallbackParts.reduce((sum, value) => sum + value, 0) - (readMb('Shmem') || 0)
    : null;
  const available = reportedAvailable ?? fallbackAvailable;
  return { total, used: Number.isFinite(total) && Number.isFinite(available) ? Math.max(0, total - available) : null, estimatedAvailable: reportedAvailable === null && Number.isFinite(fallbackAvailable) };
}

function parseAppMemory(text) {
  const source = String(text || '');
  const totalMatch = source.match(/TOTAL PSS:\s*(\d+)|^\s*TOTAL\s+(\d+)/im);
  const pssKb = Number(totalMatch?.slice(1).find(Boolean));
  const graphicsMatch = source.match(/(?:GL mtrack|Gfx dev)\s*:?\s*(\d+)/i);
  const graphicsKb = Number(graphicsMatch?.[1]);
  return {
    pssMb: Number.isFinite(pssKb) ? pssKb / 1024 : null,
    graphicsMb: Number.isFinite(graphicsKb) ? graphicsKb / 1024 : null
  };
}

function parseProcessTicks(text) {
  let ticks = 0;
  let processCount = 0;
  for (const line of String(text || '').split(/\r?\n/)) {
    const close = line.lastIndexOf(')');
    if (close < 0) continue;
    const fields = line.slice(close + 1).trim().split(/\s+/);
    const user = Number(fields[11]);
    const system = Number(fields[12]);
    if (!Number.isFinite(user) || !Number.isFinite(system)) continue;
    ticks += user + system;
    processCount += 1;
  }
  return processCount ? ticks : null;
}

function parseGpuLoad(text) {
  const source = String(text || '');
  const adapter = source.match(/^source=(.+)$/m)?.[1]?.trim() || null;
  const raw = Number(source.match(/^value=([\d.]+)/m)?.[1]);
  return { adapter, value: Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : null };
}

function parseGpuFrequency(text) {
  return normalizeFrequencyMHz(String(text || '').match(/(?:^|\n)value=(\d+)/)?.[1]);
}

function parseNetworkCounters(text) {
  const source = String(text || '');
  const kind = source.match(/^source=(.+)$/m)?.[1]?.trim() || 'device';
  const directRx = Number(source.match(/^rx=(\d+)/m)?.[1]);
  const directTx = Number(source.match(/^tx=(\d+)/m)?.[1]);
  if (Number.isFinite(directRx) && Number.isFinite(directTx)) return { rx: directRx, tx: directTx, scope: 'app', source: kind };
  let rx = 0;
  let tx = 0;
  let interfaces = 0;
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([^:]+):\s*(\d+)\s+(?:\d+\s+){7}(\d+)/);
    if (!match || match[1].trim() === 'lo') continue;
    rx += Number(match[2]);
    tx += Number(match[3]);
    interfaces += 1;
  }
  return interfaces ? { rx, tx, scope: 'device', source: 'proc-net-dev' } : null;
}

function parseDiskStat(text) {
  const source = String(text || '');
  const device = source.match(/^device=(.+)$/m)?.[1]?.trim();
  const statLine = source.split(/\r?\n/).find((line) => /^stat=/.test(line));
  const fields = statLine?.replace(/^stat=/, '').trim().split(/\s+/).map(Number) || [];
  if (!device || fields.length < 11 || fields.some((value) => !Number.isFinite(value))) return null;
  return { device, readBytes: fields[2] * 512, writeBytes: fields[6] * 512, busyMs: fields[9] };
}

function parsePower(text) {
  const source = String(text || '');
  const currentRaw = Number(source.match(/current=(-?\d+)/)?.[1]);
  const voltageRaw = Number(source.match(/voltage=(-?\d+)/)?.[1]);
  if (!Number.isFinite(currentRaw) || !Number.isFinite(voltageRaw) || currentRaw === 0 || voltageRaw === 0) return null;
  const currentAmp = Math.abs(currentRaw) / 1_000_000;
  const voltageVolt = Math.abs(voltageRaw) / 1_000_000;
  if (currentAmp > 20 || voltageVolt < 2.5 || voltageVolt > 6) return null;
  return { watts: currentAmp * voltageVolt, currentAmp, voltageVolt, charging: currentRaw > 0 };
}

function parseGfxSummary(text) {
  const source = String(text || '');
  const total = Number(source.match(/Total frames rendered:\s*(\d+)/i)?.[1]);
  const janky = Number(source.match(/Janky frames:\s*(\d+)/i)?.[1]);
  return Number.isFinite(total) && Number.isFinite(janky) ? { total, janky } : null;
}

function parseSurfaceFlingerLatency(text) {
  const lines = String(text || '').trim().split(/\r?\n/);
  const refreshPeriodNs = Number(lines.shift());
  if (!Number.isFinite(refreshPeriodNs) || refreshPeriodNs <= 0) return null;
  const timestamps = [];
  for (const line of lines) {
    const fields = line.trim().split(/\s+/).map(Number);
    const actualPresent = fields[1];
    if (!Number.isFinite(actualPresent) || actualPresent <= 0 || actualPresent >= 9e18) continue;
    timestamps.push(actualPresent);
  }
  timestamps.sort((a, b) => a - b);
  return { refreshPeriodNs, timestamps: [...new Set(timestamps)] };
}

function parsePing(text) {
  const source = String(text || '');
  const loss = Number(source.match(/([\d.]+)%\s*packet loss/i)?.[1]);
  const timing = source.match(/=\s*[\d.]+\/([\d.]+)\/[\d.]+/);
  const latency = Number(timing?.[1]);
  return {
    latency: Number.isFinite(latency) ? latency : null,
    packetLoss: Number.isFinite(loss) ? clamp(loss, 0, 100) : null
  };
}

function parseCrashEventKeys(text, packageName) {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lines = String(text || '').split(/\r?\n/);
  const keys = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/FATAL EXCEPTION|Fatal signal|DEBUG\s*:/.test(line)) {
      const block = lines.slice(index, index + 14).join('\n');
      if (new RegExp(`(?:Process:\\s*|>>>\\s*)${escaped}(?:\\s|,|<<<)`).test(block)) {
        const timestamp = line.match(/^(\d+\.\d+)/)?.[1] || `line-${index}`;
        const pid = block.match(/PID:\s*(\d+)|pid[: ]+(\d+)/i)?.slice(1).find(Boolean) || 'unknown';
        keys.add(`crash:${timestamp}:${pid}`);
      }
    }
    if (/am_anr/.test(line) && new RegExp(`(?:^|[,\\s])${escaped}(?:[,\\s]|$)`).test(line)) {
      const timestamp = line.match(/^(\d+\.\d+)/)?.[1] || `line-${index}`;
      keys.add(`anr:${timestamp}:${line.trim()}`);
    }
  }
  return keys;
}

function setMetric(sample, key, value, metadata) {
  const measured = finite(value);
  sample[key] = measured;
  sample.quality[key] = measured === null
    ? { state: 'unavailable', source: metadata.source, scope: metadata.scope, reason: metadata.reason || '设备没有公开该指标' }
    : { state: metadata.state || 'measured', source: metadata.source, scope: metadata.scope };
}

class PerformanceMonitorService {
  constructor({ onSample, onStatus }) {
    this.onSample = onSample;
    this.onStatus = onStatus;
    this.session = null;
    this.adbPath = process.env.ADB_PATH || (process.platform === 'win32' ? 'adb.exe' : 'adb');
  }

  async adb(args, timeout = 15000) {
    const { stdout } = await execFileAsync(this.adbPath, args, { timeout, windowsHide: true, maxBuffer: 12 * 1024 * 1024 });
    return stdout;
  }

  async ensureAdb() {
    try {
      await this.adb(['start-server']);
    } catch (error) {
      const message = error.code === 'ENOENT' ? '未找到 ADB，请先安装 Android Platform Tools。' : `ADB 启动失败：${error.message}`;
      throw new Error(message);
    }
  }

  async listDevices() {
    await this.ensureAdb();
    const output = await this.adb(['devices', '-l']);
    return output.split(/\r?\n/).slice(1).map((line) => line.trim()).filter(Boolean).map((line) => {
      const [serial, state] = line.split(/\s+/, 2);
      const model = line.match(/model:([^\s]+)/)?.[1]?.replace(/_/g, ' ') || 'Android 设备';
      return { serial, state, model };
    });
  }

  validatePackage(packageName) {
    const value = String(packageName || '').trim();
    if (!value) return '';
    if (!/^[a-zA-Z0-9_.]+$/.test(value) || value.length > 180) throw new Error('应用包名格式不正确。');
    return value;
  }

  validateNetworkTarget(target) {
    const value = String(target || '8.8.8.8').trim();
    if (!/^[a-zA-Z0-9.-]+$/.test(value) || value.length > 253) throw new Error('网络探测地址格式不正确。');
    return value;
  }

  async getForegroundApp(serial) {
    const safeSerial = String(serial || '').trim();
    if (!safeSerial || safeSerial.length > 200) throw new Error('请选择 Android 设备。');
    const output = await this.adb(['-s', safeSerial, 'shell', 'dumpsys', 'activity', 'activities']);
    let packageName = output.match(/(?:topResumedActivity|mResumedActivity)[^\n]*?\s([a-zA-Z0-9_.]+)\//)?.[1]
      || output.match(/mFocusedApp[^\n]*?\s([a-zA-Z0-9_.]+)\//)?.[1];
    if (!packageName) {
      const windows = await this.adb(['-s', safeSerial, 'shell', 'dumpsys', 'window', 'windows']);
      packageName = windows.match(/(?:mCurrentFocus|mFocusedApp)[^\n]*?\s([a-zA-Z0-9_.]+)\//)?.[1];
    }
    if (!packageName) throw new Error('暂时无法读取前台应用，请保持手机解锁后重试。');
    return { packageName };
  }

  async getPackageUid(serial, packageName) {
    try {
      const output = await this.adb(['-s', serial, 'shell', 'cmd', 'package', 'list', 'packages', '-U', packageName]);
      const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const uid = Number(output.match(new RegExp(`^package:${escaped}\\s+uid:(\\d+)$`, 'm'))?.[1]);
      if (Number.isFinite(uid)) return uid;
    } catch {}
    try {
      const output = await this.adb(['-s', serial, 'shell', 'dumpsys', 'package', packageName]);
      const uid = Number(output.match(/userId=(\d+)/)?.[1]);
      return Number.isFinite(uid) ? uid : null;
    } catch {
      return null;
    }
  }

  async discoverSurfaceLayer(serial, packageName) {
    try {
      const output = await this.adb(['-s', serial, 'shell', 'dumpsys', 'SurfaceFlinger', '--list']);
      const layers = output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.includes(packageName));
      return layers.find((line) => /SurfaceView|BLAST/i.test(line)) || layers.find((line) => !/Background|Dim Layer/i.test(line)) || null;
    } catch {
      return null;
    }
  }

  async readCrashEventKeys(serial, packageName) {
    if (!packageName) return new Set();
    try {
      const command = "echo __CRASH__; logcat -b crash -d -v epoch -t 400 2>/dev/null; echo __EVENTS__; logcat -b events -d -v epoch -t 500 2>/dev/null | grep am_anr";
      const output = await this.adb(['-s', serial, 'shell', command], 20000);
      return parseCrashEventKeys(output, packageName);
    } catch {
      return null;
    }
  }

  async preparePackage(session, packageName) {
    session.packageName = packageName;
    session.packageUid = packageName ? await this.getPackageUid(session.serial, packageName) : null;
    session.surfaceLayer = packageName ? await this.discoverSurfaceLayer(session.serial, packageName) : null;
    session.previous.appTicks = null;
    session.previous.gfx = null;
    session.previous.surfaceTimestamp = null;
    session.previous.network = null;
    if (packageName) {
      try { await this.adb(['-s', session.serial, 'shell', 'dumpsys', 'gfxinfo', packageName, 'reset']); } catch {}
      const existingEvents = await this.readCrashEventKeys(session.serial, packageName);
      if (existingEvents) for (const key of existingEvents) session.crashSeen.add(key);
    }
  }

  async start(configuration = {}) {
    await this.stop(false);
    await this.ensureAdb();
    const serial = String(configuration.serial || '').trim();
    if (!serial || serial.length > 200) throw new Error('请选择 Android 设备。');
    const devices = await this.listDevices();
    const device = devices.find((item) => item.serial === serial);
    if (!device) throw new Error('设备已断开，请刷新设备列表。');
    if (device.state === 'unauthorized') throw new Error('请在手机上允许 USB 调试。');
    if (device.state !== 'device') throw new Error('设备当前离线。');

    const metrics = [...new Set(configuration.metrics || [])].filter((item) => ALLOWED_METRICS.has(item));
    if (!metrics.length) throw new Error('请至少选择一类监控数据。');
    let packageName = this.validatePackage(configuration.packageName);
    const followForeground = configuration.followForeground !== false;
    const needsPackage = metrics.some((metric) => PACKAGE_METRICS.has(metric));
    if (!packageName && needsPackage && followForeground) packageName = (await this.getForegroundApp(serial)).packageName;
    const interval = Math.max(1000, Math.min(10000, Number(configuration.interval) || 2000));
    const session = {
      serial,
      model: device.model,
      metrics,
      packageName: '',
      packageUid: null,
      foregroundPackage: packageName || null,
      followForeground,
      networkTarget: this.validateNetworkTarget(configuration.networkTarget),
      interval,
      startedAt: Date.now(),
      previous: {},
      sampleIndex: 0,
      stopped: false,
      timer: null,
      probe: { latency: null, packetLoss: null, measuredAt: 0, running: false },
      crashSeen: new Set(),
      crashCount: 0,
      crashSupported: true,
      surfaceLayer: null,
      lastForegroundNotice: '',
      lastAppRunningState: null
    };
    this.session = session;
    await this.preparePackage(session, packageName);
    this.onStatus({ phase: 'running', message: `严格实测模式：正在监控 ${device.model}`, serial, packageName });
    this.scheduleSample(0);
    return { serial, model: device.model, metrics, packageName, followForeground, networkTarget: session.networkTarget, interval, startedAt: session.startedAt };
  }

  scheduleSample(delay) {
    const session = this.session;
    if (!session || session.stopped) return;
    session.timer = setTimeout(async () => {
      try {
        const sample = await this.collectSample(session);
        if (this.session === session && !session.stopped) this.onSample(sample);
      } catch (error) {
        if (this.session === session && !session.stopped) this.onStatus({ phase: 'warning', message: `部分实测数据不可用：${error.message}` });
      } finally {
        if (this.session === session && !session.stopped) this.scheduleSample(session.interval);
      }
    }, delay);
  }

  buildNetworkCommand(session) {
    const uid = session.packageUid;
    if (!session.metrics.includes('network')) return 'echo unavailable';
    if (Number.isFinite(uid)) {
      return `if [ -r /proc/uid_stat/${uid}/tcp_rcv ]; then echo source=uid_stat; echo rx=$(cat /proc/uid_stat/${uid}/tcp_rcv); echo tx=$(cat /proc/uid_stat/${uid}/tcp_snd); elif [ -r /proc/net/xt_qtaguid/stats ]; then echo source=xt_qtaguid; awk '$3 == ${uid} && $2 == "0x0" { rx += $5; tx += $7 } END { print "rx=" rx; print "tx=" tx }' /proc/net/xt_qtaguid/stats; else echo source=device; cat /proc/net/dev; fi`;
    }
    return 'echo source=device; cat /proc/net/dev 2>/dev/null';
  }

  buildShellCommand(session) {
    const packageName = session.packageName;
    const has = (metric) => session.metrics.includes(metric);
    const appPids = packageName && (has('cpu') || has('memory') || has('gpu') || has('network') || has('app')) ? `pidof ${packageName} 2>/dev/null || true` : 'echo unavailable';
    const appProcess = packageName && has('cpu') ? `for p in $(pidof ${packageName} 2>/dev/null); do cat /proc/$p/stat 2>/dev/null; done` : 'echo unavailable';
    const appMemory = packageName && (has('memory') || has('gpu')) ? `dumpsys meminfo ${packageName} 2>/dev/null | grep -E 'TOTAL PSS|^[[:space:]]*TOTAL[[:space:]]|GL mtrack|Gfx dev' | head -n 8` : 'echo unavailable';
    const gfx = packageName && (has('app') || has('gpu')) ? `dumpsys gfxinfo ${packageName} 2>/dev/null | grep -E 'Total frames rendered|Janky frames' | head -n 3` : 'echo unavailable';
    return [
      'echo __PROC_STAT__', has('cpu') || has('disk') ? 'cat /proc/stat 2>/dev/null | head -n 1' : 'echo unavailable',
      'echo __CPU_CORES__', has('cpu') ? "grep -c '^cpu[0-9]' /proc/stat 2>/dev/null" : 'echo unavailable',
      'echo __APP_PIDS__', appPids,
      'echo __APP_PROC__', appProcess,
      'echo __CPU_FREQ__', has('cpu') ? 'for f in /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq; do cat "$f" 2>/dev/null; done' : 'echo unavailable',
      'echo __THERMAL__', has('cpu') ? 'for z in /sys/class/thermal/thermal_zone*; do [ -r "$z/type" ] && [ -r "$z/temp" ] && echo "$(cat "$z/type")|$(cat "$z/temp")"; done' : 'echo unavailable',
      'echo __MEMINFO__', has('memory') ? 'cat /proc/meminfo 2>/dev/null' : 'echo unavailable',
      'echo __APP_MEM__', appMemory,
      'echo __GPU__', has('gpu') ? "if [ -r /sys/class/kgsl/kgsl-3d0/gpu_busy_percentage ]; then echo source=qualcomm-kgsl; echo value=$(cat /sys/class/kgsl/kgsl-3d0/gpu_busy_percentage | grep -oE '[0-9.]+' | head -n 1); elif [ -r /sys/class/misc/mali0/device/utilization ]; then echo source=arm-mali; echo value=$(cat /sys/class/misc/mali0/device/utilization | grep -oE '[0-9.]+' | head -n 1); else echo unavailable; fi" : 'echo unavailable',
      'echo __GPU_FREQ__', has('gpu') ? "if [ -r /sys/class/kgsl/kgsl-3d0/devfreq/cur_freq ]; then echo value=$(cat /sys/class/kgsl/kgsl-3d0/devfreq/cur_freq); else for f in /sys/class/devfreq/*gpu*/cur_freq /sys/class/devfreq/*mali*/cur_freq; do [ -r \"$f\" ] && { echo value=$(cat \"$f\"); break; }; done; fi" : 'echo unavailable',
      'echo __NET__', this.buildNetworkCommand(session),
      'echo __DISK__', has('disk') ? "dev=$(df -P /data 2>/dev/null | tail -n 1 | awk '{print $1}'); base=$(basename \"$(readlink -f \"$dev\" 2>/dev/null)\"); echo device=$base; [ -r /sys/class/block/$base/stat ] && echo stat=$(cat /sys/class/block/$base/stat)" : 'echo unavailable',
      'echo __DF__', has('disk') ? 'df -Pk /data 2>/dev/null | tail -n 1' : 'echo unavailable',
      'echo __BATTERY__', has('device') ? 'dumpsys battery 2>/dev/null' : 'echo unavailable',
      'echo __POWER__', has('device') ? 'echo current=$(cat /sys/class/power_supply/battery/current_now 2>/dev/null); echo voltage=$(cat /sys/class/power_supply/battery/voltage_now 2>/dev/null)' : 'echo unavailable',
      'echo __GFX__', gfx,
      'echo __END__'
    ].join('; ');
  }

  section(output, name, next) {
    const start = output.indexOf(`__${name}__`);
    if (start < 0) return '';
    const end = output.indexOf(`__${next}__`, start + name.length + 4);
    return output.slice(start + name.length + 4, end < 0 ? output.length : end).trim();
  }

  deltaRate(current, previous, elapsedSeconds) {
    if (!Number.isFinite(current) || !Number.isFinite(previous) || elapsedSeconds <= 0 || current < previous) return null;
    return (current - previous) / elapsedSeconds;
  }

  async updateNetworkProbe(session) {
    if (session.probe.running || Date.now() - session.probe.measuredAt < 10000) return;
    session.probe.running = true;
    try {
      const output = await this.adb(['-s', session.serial, 'shell', 'ping', '-c', '4', '-W', '1', session.networkTarget], 12000);
      const result = parsePing(output);
      session.probe = { ...result, measuredAt: Date.now(), running: false };
    } catch (error) {
      const output = `${error.stdout || ''}\n${error.stderr || ''}`;
      const result = parsePing(output);
      session.probe = { ...result, measuredAt: Date.now(), running: false };
    }
  }

  async collectSurfaceFrames(session) {
    if (!session.surfaceLayer) return null;
    try {
      const command = `dumpsys SurfaceFlinger --latency ${shellQuote(session.surfaceLayer)}`;
      return parseSurfaceFlingerLatency(await this.adb(['-s', session.serial, 'shell', command], 10000));
    } catch {
      return null;
    }
  }

  async updateCrashEvents(session) {
    if (!session.packageName) return;
    const keys = await this.readCrashEventKeys(session.serial, session.packageName);
    if (!keys) {
      session.crashSupported = false;
      return;
    }
    session.crashSupported = true;
    for (const key of keys) {
      if (session.crashSeen.has(key)) continue;
      session.crashSeen.add(key);
      session.crashCount += 1;
    }
  }

  async collectSample(session) {
    session.sampleIndex += 1;
    const followsPackage = session.metrics.some((metric) => PACKAGE_METRICS.has(metric));
    if (session.followForeground && followsPackage && (session.sampleIndex === 1 || session.sampleIndex % Math.max(2, Math.round(6000 / session.interval)) === 0)) {
      try {
        const { packageName } = await this.getForegroundApp(session.serial);
        session.foregroundPackage = packageName;
        if (isIgnoredForegroundPackage(packageName)) {
          if (session.lastForegroundNotice !== packageName) {
            session.lastForegroundNotice = packageName;
            this.onStatus({ phase: 'warning', message: '当前在桌面/系统界面，继续监控原 App；App 指标会按运行状态显示。', packageName: session.packageName });
          }
        } else if (packageName !== session.packageName) {
          await this.preparePackage(session, packageName);
          session.foregroundPackage = packageName;
          session.lastForegroundNotice = '';
          this.onStatus({ phase: 'running', message: `已切换实测应用：${packageName}`, packageName });
        }
      } catch {}
    }

    if (session.metrics.includes('network')) void this.updateNetworkProbe(session);
    const shouldReadCrashes = session.metrics.includes('app') && (session.sampleIndex === 1 || session.sampleIndex % Math.max(2, Math.round(6000 / session.interval)) === 0);
    const capturedAt = Date.now();
    const [output, surfaceFrames] = await Promise.all([
      this.adb(['-s', session.serial, 'shell', this.buildShellCommand(session)], Math.max(15000, session.interval * 5)),
      (session.metrics.includes('app') || session.metrics.includes('gpu')) ? this.collectSurfaceFrames(session) : null,
      shouldReadCrashes ? this.updateCrashEvents(session) : null
    ]);
    const completedAt = Date.now();
    const sample = { timestamp: completedAt, elapsed: (completedAt - session.startedAt) / 1000, packageName: session.packageName, appState: {}, quality: {} };
    const previous = session.previous;
    const elapsedSeconds = previous.timestamp ? (completedAt - previous.timestamp) / 1000 : 0;

    const cpu = parseCpuStat(this.section(output, 'PROC_STAT', 'CPU_CORES'));
    const cpuDelta = calculateCpuDelta(cpu, previous.cpu);
    const cpuCores = Number(this.section(output, 'CPU_CORES', 'APP_PIDS').match(/\d+/)?.[0]);
    setMetric(sample, 'cpuUsage', cpuDelta?.usage, { source: '/proc/stat 增量', scope: 'device', reason: '设备未开放 /proc/stat' });
    const appPidsText = this.section(output, 'APP_PIDS', 'APP_PROC');
    const appRunning = Boolean(session.packageName && /\b\d+\b/.test(appPidsText));
    const appForeground = Boolean(appRunning && (!session.foregroundPackage || session.foregroundPackage === session.packageName));
    const appMetricState = appRunning && !appForeground ? 'background' : undefined;
    const appUnavailableReason = session.packageName
      ? (appRunning ? '应用进程尚未产生连续样本' : '应用未运行或已被系统杀掉')
      : '未指定应用包名';
    sample.appState = {
      packageName: session.packageName,
      foregroundPackage: session.foregroundPackage || null,
      running: appRunning,
      foreground: appForeground
    };
    if (session.packageName && session.lastAppRunningState !== appRunning) {
      session.lastAppRunningState = appRunning;
      if (!appRunning) this.onStatus({ phase: 'warning', message: `${session.packageName} 未运行，App 指标已暂停。`, packageName: session.packageName });
      else this.onStatus({ phase: 'running', message: `正在监控 ${session.packageName}${appForeground ? '' : '（后台）'}`, packageName: session.packageName });
    }
    const appTicks = parseProcessTicks(this.section(output, 'APP_PROC', 'CPU_FREQ'));
    const appTickDelta = Number.isFinite(appTicks) && Number.isFinite(previous.appTicks) ? appTicks - previous.appTicks : null;
    const appCpuUsage = appRunning && cpuDelta && Number.isFinite(appTickDelta) && appTickDelta >= 0 && Number.isFinite(cpuCores)
      ? clamp(100 * appTickDelta * cpuCores / cpuDelta.total, 0, cpuCores * 100)
      : null;
    setMetric(sample, 'appCpuUsage', appCpuUsage, { source: '/proc/PID/stat 与 /proc/stat 增量', scope: 'app', state: appMetricState, reason: appUnavailableReason });
    setMetric(sample, 'cpuFrequency', parseCpuFrequency(this.section(output, 'CPU_FREQ', 'THERMAL')), { source: '在线核心 scaling_cur_freq 平均值', scope: 'device', reason: '厂商未公开 CPU 当前频率' });
    const cpuTemperature = parseCpuTemperature(this.section(output, 'THERMAL', 'MEMINFO'));
    setMetric(sample, 'cpuTemperature', cpuTemperature?.value, { source: cpuTemperature ? `thermal_zone: ${cpuTemperature.type}` : 'CPU/SOC thermal_zone', scope: 'device', reason: '没有可识别的 CPU/SOC 温度传感器' });

    const memory = parseMeminfo(this.section(output, 'MEMINFO', 'APP_MEM'));
    setMetric(sample, 'memoryTotal', memory.total, { source: '/proc/meminfo MemTotal', scope: 'device' });
    setMetric(sample, 'memoryUsed', memory.used, { source: memory.estimatedAvailable ? '/proc/meminfo 可回收内存兼容算法' : '/proc/meminfo MemTotal-MemAvailable', scope: 'device', state: memory.estimatedAvailable ? 'derived' : 'measured' });
    const appMemory = parseAppMemory(this.section(output, 'APP_MEM', 'GPU'));
    setMetric(sample, 'appMemory', appRunning ? appMemory.pssMb : null, { source: 'dumpsys meminfo TOTAL PSS', scope: 'app', state: appMetricState, reason: appRunning ? '应用未返回 PSS' : appUnavailableReason });
    setMetric(sample, 'gpuMemory', appRunning ? appMemory.graphicsMb : null, { source: 'dumpsys meminfo GL mtrack/Gfx dev', scope: 'app', state: appMetricState, reason: appRunning ? '应用或系统未公开图形共享内存' : appUnavailableReason });

    const gpu = parseGpuLoad(this.section(output, 'GPU', 'GPU_FREQ'));
    setMetric(sample, 'gpuLoad', gpu.value, { source: gpu.adapter ? `GPU 驱动: ${gpu.adapter}` : 'GPU 驱动 busy counter', scope: 'device', reason: '该机型没有可访问的 GPU busy counter' });
    setMetric(sample, 'gpuFrequency', parseGpuFrequency(this.section(output, 'GPU_FREQ', 'NET')), { source: 'GPU devfreq cur_freq', scope: 'device', reason: '该机型没有可访问的 GPU 频率节点' });

    const network = parseNetworkCounters(this.section(output, 'NET', 'DISK'));
    const networkElapsed = previous.network?.timestamp ? (completedAt - previous.network.timestamp) / 1000 : 0;
    const downloadSpeed = network ? this.deltaRate(network.rx, previous.network?.rx, networkElapsed) : null;
    const uploadSpeed = network ? this.deltaRate(network.tx, previous.network?.tx, networkElapsed) : null;
    const networkSource = network?.scope === 'app' ? `应用 UID 流量 (${network.source})` : '整机网卡流量 (/proc/net/dev)';
    setMetric(sample, 'downloadSpeed', downloadSpeed, { source: networkSource, scope: network?.scope || 'device', reason: '设备未开放网络计数器或尚无连续样本' });
    setMetric(sample, 'uploadSpeed', uploadSpeed, { source: networkSource, scope: network?.scope || 'device', reason: '设备未开放网络计数器或尚无连续样本' });
    setMetric(sample, 'networkLatency', session.probe.latency, { source: `ping ${session.networkTarget} · 4包平均`, scope: 'network', reason: '目标不可达或禁止 ICMP' });
    setMetric(sample, 'packetLoss', session.probe.packetLoss, { source: `ping ${session.networkTarget} · 4包`, scope: 'network', reason: '目标不可达或禁止 ICMP' });

    const disk = parseDiskStat(this.section(output, 'DISK', 'DF'));
    const diskElapsed = previous.disk?.timestamp ? (completedAt - previous.disk.timestamp) / 1000 : 0;
    setMetric(sample, 'diskReadSpeed', disk ? this.deltaRate(disk.readBytes, previous.disk?.readBytes, diskElapsed) : null, { source: disk ? `/data 后端块设备 ${disk.device}` : '/data 后端块设备', scope: 'device', reason: '无法识别 /data 的后端块设备或尚无连续样本' });
    setMetric(sample, 'diskWriteSpeed', disk ? this.deltaRate(disk.writeBytes, previous.disk?.writeBytes, diskElapsed) : null, { source: disk ? `/data 后端块设备 ${disk.device}` : '/data 后端块设备', scope: 'device', reason: '无法识别 /data 的后端块设备或尚无连续样本' });
    setMetric(sample, 'ioWait', cpuDelta?.ioWait, { source: '/proc/stat iowait 增量', scope: 'device', reason: '设备未开放 CPU iowait' });
    const df = this.section(output, 'DF', 'BATTERY').trim().split(/\s+/);
    const diskFree = df.length >= 4 ? Number(df[3]) / 1024 : null;
    setMetric(sample, 'diskFree', diskFree, { source: 'df /data', scope: 'device' });

    const battery = this.section(output, 'BATTERY', 'POWER');
    const batteryValue = (key) => Number(battery.match(new RegExp(`${key}:\\s*(-?\\d+)`, 'i'))?.[1]);
    setMetric(sample, 'batteryLevel', batteryValue('level'), { source: 'dumpsys battery level', scope: 'device' });
    const batteryTemp = batteryValue('temperature');
    setMetric(sample, 'deviceTemperature', Number.isFinite(batteryTemp) ? batteryTemp / 10 : null, { source: 'dumpsys battery temperature', scope: 'battery', reason: '系统未返回电池温度' });
    const power = parsePower(this.section(output, 'POWER', 'GFX'));
    setMetric(sample, 'power', power?.watts, { source: '电池 current_now × voltage_now（单位校验后）', scope: 'battery', state: 'derived', reason: '电流/电压单位不可信或设备未开放节点' });

    const gfx = parseGfxSummary(this.section(output, 'GFX', 'END'));
    let fps = null;
    let jankCount = null;
    let frameSource = null;
    let frameState = 'measured';
    if (surfaceFrames?.timestamps.length) {
      const newFrames = surfaceFrames.timestamps.filter((timestamp) => !Number.isFinite(previous.surfaceTimestamp) || timestamp > previous.surfaceTimestamp);
      if (Number.isFinite(previous.surfaceTimestamp) && elapsedSeconds > 0) {
        const frameSpanSeconds = newFrames.length > 1 ? (newFrames.at(-1) - newFrames[0]) / 1e9 : 0;
        fps = frameSpanSeconds > 0 ? (newFrames.length - 1) / frameSpanSeconds : newFrames.length / elapsedSeconds;
        const previousGap = newFrames.length ? newFrames[0] - previous.surfaceTimestamp : 0;
        let lastTimestamp = previousGap > surfaceFrames.refreshPeriodNs * 4 ? newFrames[0] : previous.surfaceTimestamp;
        jankCount = 0;
        for (const timestamp of newFrames.filter((timestamp) => timestamp > lastTimestamp)) {
          const missedIntervals = Math.max(0, Math.round((timestamp - lastTimestamp) / surfaceFrames.refreshPeriodNs) - 1);
          jankCount += missedIntervals;
          lastTimestamp = timestamp;
        }
      }
      previous.surfaceTimestamp = surfaceFrames.timestamps.at(-1);
      frameSource = `SurfaceFlinger 实际呈现 · ${session.surfaceLayer}`;
      frameState = 'derived';
    } else if (gfx && previous.gfx && elapsedSeconds > 0 && gfx.total >= previous.gfx.total && gfx.janky >= previous.gfx.janky) {
      fps = (gfx.total - previous.gfx.total) / elapsedSeconds;
      jankCount = gfx.janky - previous.gfx.janky;
      frameSource = 'dumpsys gfxinfo 增量（View UI）';
    }
    const frameReason = !session.packageName ? '未指定应用包名' : !appRunning ? appUnavailableReason : !appForeground ? '应用在后台，无法采集前台画面帧' : '应用没有可读取的 SurfaceFlinger/gfxinfo 帧数据';
    if (!appRunning || !appForeground) {
      fps = null;
      jankCount = null;
    }
    setMetric(sample, 'fps', fps, { source: frameSource || 'Android 帧时间统计', scope: 'app', state: frameState, reason: frameReason });
    setMetric(sample, 'jankCount', jankCount, { source: frameSource || 'Android 帧时间统计', scope: 'app', state: frameState, reason: frameReason });
    setMetric(sample, 'crashCount', session.crashSupported ? session.crashCount : null, { source: 'logcat crash + events/am_anr 去重', scope: 'app', reason: '设备未开放 crash/events 日志' });

    previous.timestamp = completedAt;
    previous.cpu = cpu;
    previous.appTicks = appRunning ? appTicks : null;
    previous.gfx = appRunning && appForeground ? gfx : null;
    if (!appRunning || !appForeground) previous.surfaceTimestamp = null;
    previous.network = network ? { ...network, timestamp: completedAt } : null;
    previous.disk = disk ? { ...disk, timestamp: completedAt } : null;
    sample.collectionDurationMs = completedAt - capturedAt;
    return sample;
  }

  async launchApp(serial, packageName) {
    const pkg = this.validatePackage(packageName);
    if (!pkg) throw new Error('请填写应用包名。');
    const component = (await this.adb(['-s', serial, 'shell', 'cmd', 'package', 'resolve-activity', '--brief', pkg])).trim().split(/\r?\n/).pop();
    if (!component || !component.includes('/')) throw new Error('找不到应用启动入口，请检查包名。');
    await this.adb(['-s', serial, 'shell', 'am', 'force-stop', pkg]);
    const output = await this.adb(['-s', serial, 'shell', 'am', 'start', '-W', '-n', component]);
    const totalTime = Number(output.match(/TotalTime:\s*(\d+)/)?.[1]);
    return { component, totalTime: Number.isFinite(totalTime) ? totalTime : null, source: 'ActivityManager TotalTime（force-stop 后冷启动）' };
  }

  async stop(announce = true) {
    const session = this.session;
    this.session = null;
    if (!session) return null;
    session.stopped = true;
    clearTimeout(session.timer);
    const result = { startedAt: session.startedAt, endedAt: Date.now(), serial: session.serial, model: session.model, metrics: session.metrics, packageName: session.packageName, networkTarget: session.networkTarget, accuracyMode: 'strict-measured' };
    if (announce) this.onStatus({ phase: 'idle', message: '性能测试已结束' });
    return result;
  }

  dispose() { return this.stop(false); }
}

module.exports = {
  PerformanceMonitorService,
  __test: {
    calculateCpuDelta,
    isIgnoredForegroundPackage,
    parseAppMemory,
    parseCpuFrequency,
    parseCpuStat,
    parseCpuTemperature,
    parseCrashEventKeys,
    parseDiskStat,
    parseGfxSummary,
    parseMeminfo,
    parseNetworkCounters,
    parsePing,
    parsePower,
    parseProcessTicks,
    parseSurfaceFlingerLatency
  }
};
