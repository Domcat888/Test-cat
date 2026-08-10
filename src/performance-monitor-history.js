const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_REPORTS = 250;
const MAX_SAMPLES_PER_REPORT = 86400;
const MAX_EVENTS_PER_REPORT = 10000;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function text(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function validDate(value, fallback = new Date().toISOString()) {
  const date = new Date(value || fallback);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function reportSummary(report) {
  const samples = Array.isArray(report.samples) ? report.samples : [];
  return {
    id: report.id,
    name: report.name,
    note: report.note || '',
    createdAt: report.createdAt,
    deviceSerial: report.config?.serial || report.meta?.serial || '',
    deviceName: report.config?.model || report.meta?.model || 'Android 设备',
    packageName: report.config?.packageName || report.meta?.packageName || '',
    sampleCount: samples.length,
    eventCount: Array.isArray(report.events) ? report.events.length : 0,
    duration: samples.length ? Number(samples.at(-1)?.elapsed) || 0 : 0,
    imported: Boolean(report.imported),
    migrated: Boolean(report.migrated)
  };
}

class PerformanceMonitorHistory {
  constructor(rootPath) {
    this.rootPath = rootPath;
    this.reportRoot = path.join(rootPath, 'reports');
    this.indexPath = path.join(rootPath, 'index.json');
    this.index = null;
    this.writeQueue = Promise.resolve();
  }

  async loadIndex() {
    if (this.index) return this.index;
    try {
      const parsed = JSON.parse(await fs.readFile(this.indexPath, 'utf8'));
      this.index = { version: 1, reports: Array.isArray(parsed.reports) ? parsed.reports : [] };
    } catch {
      this.index = { version: 1, reports: [] };
    }
    return this.index;
  }

  async atomicWrite(filePath, content) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, content, 'utf8');
    try {
      await fs.rename(temporary, filePath);
    } catch {
      await fs.rm(filePath, { force: true });
      await fs.rename(temporary, filePath);
    }
  }

  async persistIndex() {
    await this.atomicWrite(this.indexPath, JSON.stringify(this.index));
  }

  enqueueWrite(task) {
    const operation = this.writeQueue.catch(() => {}).then(task);
    this.writeQueue = operation;
    return operation;
  }

  normalizeReport(payload, options = {}) {
    if (!payload || typeof payload !== 'object' || !payload.config || !Array.isArray(payload.samples)) throw new Error('安卓性能报告格式不正确。');
    const id = randomUUID();
    const samples = clone(payload.samples.slice(-MAX_SAMPLES_PER_REPORT));
    const events = clone((Array.isArray(payload.events) ? payload.events : []).slice(-MAX_EVENTS_PER_REPORT));
    return {
      ...clone(payload),
      type: 'android-performance-report',
      version: Math.max(3, Number(payload.version) || 0),
      id,
      name: text(payload.name, 80) || `安卓性能测试 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      note: text(payload.note, 500),
      createdAt: validDate(payload.createdAt),
      imported: Boolean(options.imported),
      importedAt: options.imported ? new Date().toISOString() : undefined,
      migrated: Boolean(options.migrated),
      samples,
      events
    };
  }

  reportPath(id) {
    const value = String(id || '');
    if (!/^[a-f0-9-]{36}$/i.test(value)) throw new Error('报告编号无效。');
    return path.join(this.reportRoot, `${value}.json`);
  }

  async saveReport(payload, options = {}) {
    const report = this.normalizeReport(payload, options);
    await this.enqueueWrite(async () => {
      const index = await this.loadIndex();
      await this.atomicWrite(this.reportPath(report.id), JSON.stringify(report));
      const previousReports = index.reports;
      const summary = reportSummary(report);
      if (options.legacyId) summary.legacyId = text(options.legacyId, 200);
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
    });
    return reportSummary(report);
  }

  async migrateReports(reports) {
    const index = await this.loadIndex();
    if (!Array.isArray(reports) || !reports.length) return { imported: 0 };
    const existingLegacyIds = new Set(index.reports.map((item) => item.legacyId).filter(Boolean));
    let imported = 0;
    for (const source of reports.slice(0, MAX_REPORTS)) {
      const legacyId = text(source?.id, 200);
      if (legacyId && existingLegacyIds.has(legacyId)) continue;
      await this.saveReport({ ...source, id: undefined }, { migrated: true, legacyId });
      if (legacyId) existingLegacyIds.add(legacyId);
      imported += 1;
    }
    return { imported };
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
}

module.exports = {
  PerformanceMonitorHistory,
  __test: { MAX_EVENTS_PER_REPORT, MAX_REPORTS, MAX_SAMPLES_PER_REPORT, reportSummary }
};
