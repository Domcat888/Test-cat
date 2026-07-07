const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const MAX_RECORDS = 100000;
const MAX_CAPTURE_BYTES = 50 * 1024 * 1024;
const LEVEL_RANK = { V: 0, D: 1, I: 2, W: 3, E: 4, F: 5 };

function parseDeviceList(text) {
  return String(text || '').split(/\r?\n/).slice(1).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [serial, state] = line.split(/\s+/, 2);
    const model = line.match(/model:([^\s]+)/)?.[1]?.replace(/_/g, ' ') || 'Android 设备';
    return { serial, state, model };
  });
}

function parseForegroundPackage(text) {
  return String(text || '').match(/(?:topResumedActivity|mResumedActivity)[^\n]*?\s([a-zA-Z0-9_.]+)\//)?.[1]
    || String(text || '').match(/mFocusedApp[^\n]*?\s([a-zA-Z0-9_.]+)\//)?.[1]
    || '';
}

function classifyLog({ level = '', tag = '', message = '', raw = '' }) {
  const content = `${tag}: ${message || raw}`;
  const stack = /^\s*(?:at\s+|Caused by:|Suppressed:|\.\.\.\s+\d+\s+more)/.test(message)
    || /\b(?:Native backtrace|backtrace):/i.test(content);
  if (/\bFATAL EXCEPTION\b|\bFatal signal\b|\bam_crash\b|\bCRASH:\s|Force finishing activity/i.test(content)) return { kind: 'crash', label: '崩溃', stack };
  if (/\bANR in\b|\bam_anr\b|Application Not Responding|Input dispatching timed out/i.test(content)) return { kind: 'anr', label: 'ANR', stack };
  if (stack || /\b(?:Exception|RuntimeException|NullPointerException|OutOfMemoryError|SecurityException)\b/i.test(content)) return { kind: 'exception', label: stack ? '堆栈' : '异常', stack: true };
  if (level === 'F') return { kind: 'crash', label: '严重', stack };
  if (level === 'E' || /\b(?:error|failed|failure)\b/i.test(content)) return { kind: 'error', label: '报错', stack };
  if (level === 'W') return { kind: 'warning', label: '警告', stack };
  return { kind: 'normal', label: '', stack };
}

function parseLogcatLine(raw, processMap = new Map(), id = 0) {
  const line = String(raw || '').replace(/\r$/, '');
  const match = line.match(/^(\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}\.\d+)\s+((?:\d+\s+){1,3})([VDIWEF])\s+([^:]*):\s?(.*)$/);
  if (!match) {
    const classification = classifyLog({ raw: line, message: line });
    return { id, time: '', pid: '', tid: '', level: '', tag: '', message: line, raw: line, processName: '', ...classification };
  }
  const numbers = match[3].trim().split(/\s+/);
  const pid = numbers.length >= 2 ? numbers[numbers.length - 2] : numbers[0];
  const tid = numbers.length >= 2 ? numbers[numbers.length - 1] : numbers[0];
  const record = {
    id,
    time: `${match[1]} ${match[2]}`,
    pid,
    tid,
    level: match[4],
    tag: match[5].trim(),
    message: match[6],
    raw: line,
    processName: processMap.get(String(pid)) || ''
  };
  return { ...record, ...classifyLog(record) };
}

function parseProcessMap(text) {
  const result = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /\bPID\b.*\bNAME\b/i.test(trimmed)) continue;
    const columns = trimmed.split(/\s+/);
    const pidIndex = columns.findIndex((value) => /^\d+$/.test(value));
    if (pidIndex < 0) continue;
    const pid = columns[pidIndex];
    const name = columns[columns.length - 1];
    if (name && !/^\d+$/.test(name)) result.set(pid, name);
  }
  return result;
}

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function safeFileName(value) {
  return String(value || 'android-logcat').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-').slice(0, 80);
}

function recordMatchesFilter(record, filter = {}) {
  const packageName = String(filter.packageName || '').trim().toLowerCase();
  if (packageName && !String(record.processName || '').toLowerCase().startsWith(packageName) && !String(record.raw || '').toLowerCase().includes(packageName)) return false;
  const minimumLevel = Object.hasOwn(LEVEL_RANK, filter.minimumLevel) ? filter.minimumLevel : 'all';
  if (minimumLevel !== 'all' && (LEVEL_RANK[record.level] ?? -1) < LEVEL_RANK[minimumLevel]) return false;
  const kind = ['error', 'crash', 'anr', 'exception'].includes(filter.kind) ? filter.kind : 'all';
  if (kind !== 'all' && record.kind !== kind) return false;
  const haystack = `${record.raw || ''}\n${record.processName || ''}`.toLowerCase();
  const terms = Array.isArray(filter.terms) ? filter.terms.slice(0, 6) : [];
  return terms.map((term) => String(term || '').trim().toLowerCase()).filter(Boolean).every((term) => haystack.includes(term));
}

class LogAnalysisService {
  constructor({ dialog, getWindow, onLogs, onStatus }) {
    this.dialog = dialog;
    this.getWindow = getWindow;
    this.onLogs = onLogs;
    this.onStatus = onStatus;
    this.adbPath = process.env.ADB_PATH || (process.platform === 'win32' ? 'adb.exe' : 'adb');
    this.session = null;
    this.processMap = new Map();
    this.batch = [];
    this.batchTimer = null;
    this.processMapTimer = null;
    this.nextId = 1;
  }

  emitStatus(phase, message, details = {}) {
    this.onStatus?.({ phase, message, ...details });
  }

  async adb(args, timeout = 15000) {
    const { stdout } = await execFileAsync(this.adbPath, args, { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  }

  async ensureAdb() {
    try {
      await this.adb(['start-server']);
    } catch (error) {
      throw new Error(error.code === 'ENOENT' ? '未找到 ADB，请先安装 Android Platform Tools。' : `ADB 启动失败：${error.message}`);
    }
  }

  async listDevices() {
    await this.ensureAdb();
    return parseDeviceList(await this.adb(['devices', '-l']));
  }

  async getForegroundApp(serial) {
    const safeSerial = String(serial || '').trim();
    if (!safeSerial) throw new Error('请先选择 Android 设备。');
    const output = await this.adb(['-s', safeSerial, 'shell', 'dumpsys', 'activity', 'activities'], 20000);
    const packageName = parseForegroundPackage(output);
    if (!packageName) throw new Error('没有识别到前台 App，请先将被测 App 保持在前台。');
    return packageName;
  }

  async refreshProcessMap() {
    const session = this.session;
    if (!session) return;
    try {
      const output = await this.adb(['-s', session.serial, 'shell', 'ps', '-A', '-o', 'PID,NAME']);
      const parsed = parseProcessMap(output);
      if (this.session === session && parsed.size) this.processMap = parsed;
    } catch {
      try {
        const fallback = await this.adb(['-s', session.serial, 'shell', 'ps', '-A']);
        const parsed = parseProcessMap(fallback);
        if (this.session === session && parsed.size) this.processMap = parsed;
      } catch {}
    }
  }

  addRecord(record) {
    if (!this.session) return;
    this.session.records.push(record);
    this.session.bytes += Buffer.byteLength(record.raw, 'utf8') + 1;
    while (this.session.records.length > MAX_RECORDS || this.session.bytes > MAX_CAPTURE_BYTES) {
      const removed = this.session.records.splice(0, Math.min(1000, this.session.records.length));
      this.session.bytes -= removed.reduce((sum, item) => sum + Buffer.byteLength(item.raw, 'utf8') + 1, 0);
      this.session.truncated = true;
    }
    this.batch.push(record);
    if (this.batch.length >= 200) this.flushBatch();
    else if (!this.batchTimer) this.batchTimer = setTimeout(() => this.flushBatch(), 80);
  }

  flushBatch() {
    clearTimeout(this.batchTimer);
    this.batchTimer = null;
    if (!this.batch.length) return;
    const payload = this.batch.splice(0);
    this.onLogs?.(payload);
  }

  handleChunk(chunk) {
    if (!this.session) return;
    this.session.buffer += chunk.toString('utf8');
    const lines = this.session.buffer.split(/\r?\n/);
    this.session.buffer = lines.pop() || '';
    for (const line of lines) this.addRecord(parseLogcatLine(line, this.processMap, this.nextId++));
  }

  async start({ serial, packageName = '', clearBeforeStart = false } = {}) {
    const safeSerial = String(serial || '').trim();
    const safePackage = String(packageName || '').trim();
    if (!safeSerial || safeSerial.length > 200) throw new Error('请选择要监听的 Android 设备。');
    if (safePackage && (!/^[a-zA-Z0-9_.:]+$/.test(safePackage) || safePackage.length > 180)) throw new Error('App 包名格式不正确。');
    await this.stop(false);
    const devices = await this.listDevices();
    const device = devices.find((item) => item.serial === safeSerial);
    if (!device) throw new Error('设备已断开，请刷新设备列表。');
    if (device.state === 'unauthorized') throw new Error('请先在手机上允许 USB 调试。');
    if (device.state !== 'device') throw new Error('设备当前离线，无法读取日志。');
    if (clearBeforeStart) await this.adb(['-s', safeSerial, 'logcat', '-c']);

    this.processMap = new Map();
    this.batch = [];
    this.nextId = 1;
    this.session = {
      serial: safeSerial,
      model: device.model,
      packageName: safePackage,
      startedAt: new Date().toISOString(),
      records: [],
      bytes: 0,
      buffer: '',
      truncated: false,
      stopping: false,
      process: null
    };
    await this.refreshProcessMap();
    const child = spawn(this.adbPath, ['-s', safeSerial, 'logcat', '-v', 'threadtime'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, LANG: 'C' }
    });
    const session = this.session;
    session.process = child;
    let stderr = '';
    child.stdout.on('data', (chunk) => { if (this.session === session) this.handleChunk(chunk); });
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
    child.on('error', (error) => {
      if (this.session === session && !session.stopping) this.emitStatus('error', `日志监听启动失败：${error.message}`);
    });
    child.on('exit', (code) => {
      if (this.session !== session) return;
      clearInterval(this.processMapTimer);
      this.processMapTimer = null;
      this.flushBatch();
      if (!session.stopping) {
        if (code === 0) this.emitStatus('idle', '设备日志流已结束');
        else this.emitStatus('error', stderr.trim() || `logcat 已停止（退出码 ${code}）`);
      }
    });
    this.processMapTimer = setInterval(() => this.refreshProcessMap(), 5000);
    this.emitStatus('streaming', `正在监听 ${device.model} 的实时日志`, { serial: safeSerial, packageName: safePackage });
    return { serial: safeSerial, model: device.model, packageName: safePackage, startedAt: this.session.startedAt };
  }

  async stop(announce = true) {
    if (!this.session) return false;
    const session = this.session;
    session.stopping = true;
    clearInterval(this.processMapTimer);
    this.processMapTimer = null;
    const child = session.process;
    if (child && child.exitCode === null) {
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 800);
        child.once('exit', () => { clearTimeout(timeout); resolve(); });
        try { child.kill(); } catch { clearTimeout(timeout); resolve(); }
      });
    }
    if (this.session !== session) return true;
    if (session.buffer) this.addRecord(parseLogcatLine(session.buffer, this.processMap, this.nextId++));
    session.buffer = '';
    this.flushBatch();
    if (announce) this.emitStatus('idle', '日志监听已停止');
    return true;
  }

  clearCaptured() {
    if (!this.session) return false;
    clearTimeout(this.batchTimer);
    this.batchTimer = null;
    this.batch = [];
    this.session.records = [];
    this.session.bytes = 0;
    this.session.truncated = false;
    return true;
  }

  async exportLogs({ scope = 'all', format = 'log', filter = {} } = {}) {
    if (!this.session) throw new Error('当前没有可导出的日志。');
    const source = scope === 'filtered'
      ? this.session.records.filter((record) => recordMatchesFilter(record, filter))
      : this.session.records;
    if (!source.length) throw new Error('当前筛选条件下没有可导出的日志。');
    const safeFormat = format === 'html' ? 'html' : 'log';
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const packagePart = this.session?.packageName ? `-${safeFileName(this.session.packageName)}` : '';
    const result = await this.dialog.showSaveDialog(this.getWindow(), {
      title: '导出 Android 日志',
      defaultPath: `Test-cat-logcat${packagePart}-${stamp}.${safeFormat}`,
      filters: safeFormat === 'html' ? [{ name: 'HTML 日志报告', extensions: ['html'] }] : [{ name: 'Logcat 原始日志', extensions: ['log', 'txt'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const summary = {
      crash: source.filter((item) => item.kind === 'crash').length,
      anr: source.filter((item) => item.kind === 'anr').length,
      exception: source.filter((item) => item.kind === 'exception').length,
      error: source.filter((item) => item.kind === 'error').length
    };
    let content;
    if (safeFormat === 'html') {
      const rows = source.map((item) => `<tr class="${htmlEscape(item.kind)}"><td>${htmlEscape(item.time)}</td><td>${htmlEscape(item.level)}</td><td>${htmlEscape(item.pid)}</td><td>${htmlEscape(item.processName)}</td><td>${htmlEscape(item.tag)}</td><td><pre>${htmlEscape(item.message)}</pre></td></tr>`).join('');
      content = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Test cat Android 日志报告</title><style>body{margin:28px;font:14px system-ui;color:#202938}h1{margin:0 0 8px}.meta{color:#667085}.stats{display:flex;gap:10px;margin:20px 0}.stats b{padding:8px 12px;border-radius:8px;background:#edf3ff}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:7px;border:1px solid #d7deea;text-align:left;vertical-align:top}th{position:sticky;top:0;background:#eaf0fa}pre{margin:0;white-space:pre-wrap;word-break:break-word;font:12px/1.45 ui-monospace,monospace}.crash,.anr{background:#ffe2e2}.exception,.error{background:#fff0e5}.warning{background:#fff9df}</style></head><body><h1>Test cat Android 日志报告</h1><p class="meta">设备：${htmlEscape(this.session?.model || '')}（${htmlEscape(this.session?.serial || '')}）　App：${htmlEscape(this.session?.packageName || '全部进程')}　导出时间：${htmlEscape(new Date().toLocaleString('zh-CN', { hour12: false }))}</p><div class="stats"><b>日志 ${source.length}</b><b>崩溃 ${summary.crash}</b><b>ANR ${summary.anr}</b><b>异常 ${summary.exception}</b><b>报错 ${summary.error}</b></div><table><thead><tr><th>时间</th><th>级别</th><th>PID</th><th>进程</th><th>标签</th><th>内容</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    } else {
      const header = [`# Test cat Android logcat`, `# 设备：${this.session?.model || ''}（${this.session?.serial || ''}）`, `# App：${this.session?.packageName || '全部进程'}`, `# 监听开始：${this.session?.startedAt || ''}`, `# 导出时间：${new Date().toISOString()}`, `# 日志数量：${source.length}，崩溃：${summary.crash}，ANR：${summary.anr}，异常：${summary.exception}，报错：${summary.error}`, ''].join('\n');
      content = header + source.map((item) => item.raw).join('\n');
    }
    await fs.promises.writeFile(result.filePath, content, 'utf8');
    return { canceled: false, filePath: path.resolve(result.filePath), count: source.length };
  }

  async dispose() {
    await this.stop(false);
    this.session = null;
  }
}

module.exports = {
  LogAnalysisService,
  __test: { classifyLog, parseDeviceList, parseForegroundPackage, parseLogcatLine, parseProcessMap, recordMatchesFilter }
};
