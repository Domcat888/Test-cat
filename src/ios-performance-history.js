const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_REPORTS = 250;
const MAX_LOGS = 1000;
const MAX_SAMPLES_PER_REPORT = 86400;
const UUID_PATTERN = /^[a-f0-9-]{36}$/i;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function text(value, maxLength = 200) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function validDate(value, fallback = new Date().toISOString()) {
  const date = new Date(value || fallback);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function reportSummary(report) {
  return {
    id: report.id,
    name: report.name,
    createdAt: report.createdAt,
    deviceSerial: report.config?.serial || report.meta?.serial || '',
    deviceName: report.meta?.model || report.config?.model || 'iPhone',
    appBundleId: report.config?.app?.bundleId || '',
    sampleCount: Array.isArray(report.samples) ? report.samples.length : 0,
    duration: Array.isArray(report.samples) && report.samples.length ? Number(report.samples.at(-1)?.elapsed) || 0 : 0,
    imported: Boolean(report.imported)
  };
}

function logSummary(log) {
  const { content, ...summary } = log;
  return clone(summary);
}

class IosPerformanceHistory {
  constructor(rootPath) {
    this.rootPath = rootPath;
    this.legacyPath = path.join(rootPath, 'history.json');
    this.indexPath = path.join(rootPath, 'index.json');
    this.reportRoot = path.join(rootPath, 'reports');
    this.logRoot = path.join(rootPath, 'logs');
    this.index = null;
    this.loadPromise = null;
    this.writeQueue = Promise.resolve();
  }

  enqueueWrite(task) {
    const operation = this.writeQueue.catch(() => {}).then(task);
    this.writeQueue = operation;
    return operation;
  }

  async atomicWrite(filePath, content) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, content, 'utf8');
    try {
      await fs.rename(temporary, filePath);
    } catch {
      await fs.rm(filePath, { force: true });
      await fs.rename(temporary, filePath);
    }
  }

  reportPath(id) {
    if (!UUID_PATTERN.test(String(id || ''))) throw new Error('报告编号无效。');
    return path.join(this.reportRoot, `${id}.json`);
  }

  logPath(id) {
    if (!UUID_PATTERN.test(String(id || ''))) throw new Error('日志编号无效。');
    return path.join(this.logRoot, `${id}.json`);
  }

  async persistIndex() {
    await this.atomicWrite(this.indexPath, JSON.stringify(this.index));
  }

  async loadIndex() {
    if (this.index) return this.index;
    if (!this.loadPromise) {
      this.loadPromise = this.initializeIndex().finally(() => {
        this.loadPromise = null;
      });
    }
    return this.loadPromise;
  }

  async initializeIndex() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.indexPath, 'utf8'));
      this.index = {
        version: 2,
        reports: Array.isArray(parsed.reports) ? parsed.reports : [],
        logs: Array.isArray(parsed.logs) ? parsed.logs : []
      };
      return this.index;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.index = { version: 2, reports: [], logs: [] };
        return this.index;
      }
    }
    return this.migrateLegacyHistory();
  }

  async migrateLegacyHistory() {
    let legacy;
    try {
      legacy = JSON.parse(await fs.readFile(this.legacyPath, 'utf8'));
    } catch {
      this.index = { version: 2, reports: [], logs: [] };
      return this.index;
    }

    const reports = [];
    const logs = [];
    const reportIds = new Set();
    const logIds = new Set();
    for (const source of Array.isArray(legacy.reports) ? legacy.reports : []) {
      const report = clone(source);
      let id = UUID_PATTERN.test(String(report?.id || '')) ? report.id : randomUUID();
      while (reportIds.has(id)) id = randomUUID();
      reportIds.add(id);
      report.id = id;
      await this.atomicWrite(this.reportPath(id), JSON.stringify(report));
      reports.push(reportSummary(report));
    }
    for (const source of Array.isArray(legacy.logs) ? legacy.logs : []) {
      const log = clone(source);
      let id = UUID_PATTERN.test(String(log?.id || '')) ? log.id : randomUUID();
      while (logIds.has(id)) id = randomUUID();
      logIds.add(id);
      log.id = id;
      await this.atomicWrite(this.logPath(id), JSON.stringify(log));
      logs.push(logSummary(log));
    }
    this.index = { version: 2, reports, logs, migratedAt: new Date().toISOString() };
    try {
      await this.persistIndex();
    } catch (error) {
      this.index = null;
      throw error;
    }
    const backupPath = path.join(this.rootPath, 'history.migrated-v1.json');
    try {
      await fs.access(backupPath);
    } catch {
      try { await fs.rename(this.legacyPath, backupPath); } catch {}
    }
    return this.index;
  }

  normalizeReport(payload, imported = false) {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.samples)) throw new Error('报告格式不正确。');
    const samples = clone(payload.samples.slice(-MAX_SAMPLES_PER_REPORT));
    return {
      ...clone(payload),
      type: 'ios-performance-report',
      version: Math.max(2, Number(payload.version) || 0),
      id: randomUUID(),
      name: text(payload.name, 80) || `iOS 性能测试 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      createdAt: validDate(payload.createdAt),
      imported: Boolean(imported),
      importedAt: imported ? new Date().toISOString() : undefined,
      samples
    };
  }

  async saveReport(payload, { imported = false } = {}) {
    const report = this.normalizeReport(payload, imported);
    return this.enqueueWrite(async () => {
      const index = await this.loadIndex();
      await this.atomicWrite(this.reportPath(report.id), JSON.stringify(report));
      const summary = reportSummary(report);
      const previousReports = index.reports;
      index.reports = [summary, ...previousReports].slice(0, MAX_REPORTS);
      const removed = previousReports.slice(Math.max(0, MAX_REPORTS - 1));
      try {
        await this.persistIndex();
      } catch (error) {
        index.reports = previousReports;
        await fs.rm(this.reportPath(report.id), { force: true }).catch(() => {});
        throw error;
      }
      await Promise.allSettled(removed.map((item) => fs.rm(this.reportPath(item.id), { force: true })));
      return clone(summary);
    });
  }

  async listReports() {
    const index = await this.loadIndex();
    return clone(index.reports);
  }

  async getReport(id) {
    const index = await this.loadIndex();
    if (!index.reports.some((item) => item.id === id)) return null;
    try {
      return JSON.parse(await fs.readFile(this.reportPath(id), 'utf8'));
    } catch {
      return null;
    }
  }

  async deleteReport(id) {
    return this.enqueueWrite(async () => {
      const index = await this.loadIndex();
      const before = index.reports.length;
      const previousReports = index.reports;
      index.reports = index.reports.filter((item) => item.id !== id);
      if (index.reports.length === before) return false;
      try {
        await this.persistIndex();
      } catch (error) {
        index.reports = previousReports;
        throw error;
      }
      await fs.rm(this.reportPath(id), { force: true }).catch(() => {});
      return true;
    });
  }

  normalizeLog(record) {
    const deviceSerial = text(record.deviceSerial, 200);
    const sourcePath = text(record.sourcePath, 1000);
    if (!deviceSerial || !sourcePath || !['Crash', 'Jetsam', 'Performance'].includes(record.type)) throw new Error('诊断日志数据无效。');
    return {
      id: randomUUID(),
      deviceSerial,
      deviceName: text(record.deviceName, 200) || 'iPhone',
      sourcePath,
      name: text(record.name, 500) || path.basename(sourcePath),
      type: record.type,
      occurredAt: validDate(record.occurredAt),
      collectedAt: new Date().toISOString(),
      size: Math.max(0, Number(record.size) || 0),
      content: String(record.content || ''),
      summary: clone(record.summary || {})
    };
  }

  async saveLogs(records) {
    const normalized = (Array.isArray(records) ? records : []).map((record) => this.normalizeLog(record));
    return this.enqueueWrite(async () => {
      const index = await this.loadIndex();
      const inserted = [];
      const writtenIds = [];
      const previousLogs = index.logs;
      const nextLogs = [...previousLogs];
      const existing = new Set(index.logs.map((item) => `${item.deviceSerial}\n${item.sourcePath}`));
      try {
        for (const record of normalized) {
          const key = `${record.deviceSerial}\n${record.sourcePath}`;
          if (existing.has(key)) continue;
          existing.add(key);
          await this.atomicWrite(this.logPath(record.id), JSON.stringify(record));
          writtenIds.push(record.id);
          const summary = logSummary(record);
          nextLogs.unshift(summary);
          inserted.push(summary);
        }
        if (inserted.length) {
          index.logs = nextLogs.slice(0, MAX_LOGS);
          await this.persistIndex();
        }
      } catch (error) {
        index.logs = previousLogs;
        await Promise.allSettled(writtenIds.map((id) => fs.rm(this.logPath(id), { force: true })));
        throw error;
      }
      if (inserted.length) {
        const retained = new Set(index.logs.map((item) => item.id));
        const removed = previousLogs.filter((item) => !retained.has(item.id));
        await Promise.allSettled(removed.map((item) => fs.rm(this.logPath(item.id), { force: true })));
      }
      return clone(inserted);
    });
  }

  async listLogs({ deviceSerial = '', type = '' } = {}) {
    const index = await this.loadIndex();
    return clone(index.logs
      .filter((item) => !deviceSerial || item.deviceSerial === deviceSerial)
      .filter((item) => !type || item.type === type));
  }

  async getLog(id) {
    const index = await this.loadIndex();
    if (!index.logs.some((item) => item.id === id)) return null;
    try {
      return JSON.parse(await fs.readFile(this.logPath(id), 'utf8'));
    } catch {
      return null;
    }
  }
}

module.exports = { IosPerformanceHistory, __test: { MAX_SAMPLES_PER_REPORT, logSummary, reportSummary } };
