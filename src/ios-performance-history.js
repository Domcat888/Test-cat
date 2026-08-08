const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_REPORTS = 250;
const MAX_LOGS = 1000;
const MAX_SAMPLES_PER_REPORT = 86400;

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

class IosPerformanceHistory {
  constructor(rootPath) {
    this.rootPath = rootPath;
    this.filePath = path.join(rootPath, 'history.json');
    this.data = null;
    this.writeQueue = Promise.resolve();
  }

  async load() {
    if (this.data) return this.data;
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      this.data = {
        version: 1,
        reports: Array.isArray(parsed.reports) ? parsed.reports : [],
        logs: Array.isArray(parsed.logs) ? parsed.logs : []
      };
    } catch {
      this.data = { version: 1, reports: [], logs: [] };
    }
    return this.data;
  }

  async persist() {
    const snapshot = JSON.stringify(this.data);
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(this.rootPath, { recursive: true });
      const temporary = `${this.filePath}.${process.pid}.tmp`;
      await fs.writeFile(temporary, snapshot, 'utf8');
      try {
        await fs.rename(temporary, this.filePath);
      } catch {
        await fs.rm(this.filePath, { force: true });
        await fs.rename(temporary, this.filePath);
      }
    });
    return this.writeQueue;
  }

  normalizeReport(payload, imported = false) {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.samples)) throw new Error('报告格式不正确。');
    const samples = payload.samples.slice(-MAX_SAMPLES_PER_REPORT);
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
    const data = await this.load();
    const report = this.normalizeReport(payload, imported);
    data.reports.unshift(report);
    data.reports = data.reports.slice(0, MAX_REPORTS);
    await this.persist();
    return reportSummary(report);
  }

  async listReports() {
    const data = await this.load();
    return data.reports.map(reportSummary);
  }

  async getReport(id) {
    const data = await this.load();
    return clone(data.reports.find((item) => item.id === id) || null);
  }

  async deleteReport(id) {
    const data = await this.load();
    const before = data.reports.length;
    data.reports = data.reports.filter((item) => item.id !== id);
    if (data.reports.length === before) return false;
    await this.persist();
    return true;
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
    const data = await this.load();
    const inserted = [];
    const existing = new Set(data.logs.map((item) => `${item.deviceSerial}\n${item.sourcePath}`));
    for (const source of Array.isArray(records) ? records : []) {
      const record = this.normalizeLog(source);
      const key = `${record.deviceSerial}\n${record.sourcePath}`;
      if (existing.has(key)) continue;
      existing.add(key);
      data.logs.unshift(record);
      inserted.push(record);
    }
    if (inserted.length) {
      data.logs = data.logs.slice(0, MAX_LOGS);
      await this.persist();
    }
    return inserted.map(({ content, ...item }) => clone(item));
  }

  async listLogs({ deviceSerial = '', type = '' } = {}) {
    const data = await this.load();
    return data.logs
      .filter((item) => !deviceSerial || item.deviceSerial === deviceSerial)
      .filter((item) => !type || item.type === type)
      .map(({ content, ...item }) => clone(item));
  }

  async getLog(id) {
    const data = await this.load();
    return clone(data.logs.find((item) => item.id === id) || null);
  }
}

module.exports = { IosPerformanceHistory, __test: { MAX_SAMPLES_PER_REPORT, reportSummary } };
