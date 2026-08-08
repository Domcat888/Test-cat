const api = window.testCat?.iosPerformance;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const MAX_RAW_SAMPLES = 86400;

document.body.dataset.platform = window.testCat?.platform || 'browser';

const state = {
  running: false,
  config: null,
  samples: [],
  lastMeta: null,
  apps: [],
  reports: [],
  logs: [],
  reportCache: new Map(),
  comparison: null
};

const elements = {
  device: $('#ios-performance-device'), refresh: $('#ios-performance-refresh'), interval: $('#ios-performance-interval'),
  tunnel: $('#ios-performance-tunnel'), start: $('#ios-performance-start'), stop: $('#ios-performance-stop'),
  status: $('#ios-performance-status'), statusText: $('#ios-performance-status-text'), environment: $('#ios-performance-environment'),
  platform: $('#ios-platform-badge'), app: $('#ios-performance-app'), appRefresh: $('#ios-performance-app-refresh'),
  reportName: $('#ios-performance-report-name'), dashboard: $('#ios-performance-dashboard'), dashboardDevice: $('#ios-dashboard-device'),
  duration: $('#ios-dashboard-duration'), sampleCount: $('#ios-dashboard-samples'), toast: $('#ios-performance-toast')
};

const series = {
  cpuUsage: { label: 'CPU', unit: '%', color: '#2f7ee6', scale: (value) => value },
  memoryUsed: { label: '内存', unit: 'MB', color: '#8356c5', scale: (value) => value / 1024 / 1024 },
  batteryTemperature: { label: '电池温度', unit: '°C', color: '#c97824', scale: (value) => value },
  fps: { label: 'FPS', unit: 'FPS', color: '#168b62', scale: (value) => value },
  gpuUsage: { label: 'GPU', unit: '%', color: '#db5964', scale: (value) => value },
  appCpuUsage: { label: 'App CPU', unit: '%', color: '#168b62', scale: (value) => value },
  appMemory: { label: 'App 内存', unit: 'MB', color: '#8356c5', scale: (value) => value / 1024 / 1024 }
};

function applyTheme() {
  const theme = localStorage.getItem('test-cat-theme');
  document.body.classList.toggle('dark', theme === 'dark');
  document.body.classList.toggle('purple-eye', theme === 'purple');
  redrawVisibleCharts();
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => elements.toast.classList.remove('show'), 2800);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function format(value, unit = '', digits) {
  if (!Number.isFinite(value)) return '—';
  const precision = Number.isFinite(digits) ? digits : Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  return `${value.toFixed(precision)}${unit ? ` ${unit}` : ''}`;
}

function formatBytes(value) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '—';
  const bytes = Number(value);
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false });
}

function setStatus(status = {}) {
  elements.status.dataset.phase = status.phase || 'idle';
  elements.statusText.textContent = status.message || '等待连接';
  if (status.model) elements.dashboardDevice.textContent = status.model;
  if (status.bundledRuntime) elements.environment.textContent = '内置 iOS 采集引擎已就绪';
}

function updateActions() {
  const hasDevice = Boolean(elements.device.value);
  elements.start.disabled = state.running || !hasDevice;
  elements.stop.disabled = !state.running;
  elements.refresh.disabled = state.running;
  elements.tunnel.disabled = state.running;
  elements.appRefresh.disabled = !hasDevice || state.running;
  $('#ios-device-load').disabled = !hasDevice || state.running;
  $('#ios-log-collect').disabled = !hasDevice || state.running;
}

function selectedMetrics() {
  return $$('.ios-metric-options input:checked').map((input) => input.value);
}

async function refreshDevices() {
  if (!api) return toast('iOS 性能监控只能在 Test cat 桌面版运行');
  const previous = elements.device.value;
  elements.device.innerHTML = '<option value="">正在查找 iPhone…</option>';
  try {
    const devices = await api.listDevices();
    elements.device.innerHTML = devices.length ? '' : '<option value="">未发现 iPhone</option>';
    for (const device of devices) {
      const option = document.createElement('option');
      option.value = device.serial;
      option.textContent = `${device.model || 'iPhone'} · ${device.connectionType || 'USB'} · ${device.serial}`;
      elements.device.append(option);
    }
    elements.device.value = devices.some((item) => item.serial === previous) ? previous : devices[0]?.serial || '';
    if (elements.device.value) await refreshApps();
  } catch (error) {
    elements.device.innerHTML = '<option value="">设备检测失败</option>';
    toast(error.message || String(error));
  }
  updateActions();
}

async function refreshApps() {
  if (!api || !elements.device.value) return;
  const selectedBundle = elements.app.value === '' ? '' : state.apps[Number(elements.app.value)]?.bundleId;
  elements.app.innerHTML = '<option value="">正在读取用户 App…</option>';
  elements.appRefresh.disabled = true;
  try {
    state.apps = await api.listApps(elements.device.value);
    elements.app.innerHTML = '<option value="">不采集 App 进程</option>';
    for (const [index, app] of state.apps.entries()) {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = `${app.name} · ${app.bundleId}`;
      elements.app.append(option);
      if (app.bundleId === selectedBundle) elements.app.value = String(index);
    }
  } catch (error) {
    state.apps = [];
    elements.app.innerHTML = '<option value="">App 列表不可用</option>';
    toast(error.message || String(error));
  } finally {
    updateActions();
  }
}

function renderKpi(key, value, quality) {
  const node = $(`#ios-kpi-${key}`);
  const qualityNode = $(`#ios-quality-${key}`);
  const detail = series[key];
  if (!node || !qualityNode) return;
  const scaled = Number.isFinite(value) ? detail.scale(value) : null;
  node.textContent = format(scaled, detail.unit);
  qualityNode.textContent = quality?.state === 'unavailable' ? '不可用' : quality?.state === 'derived' ? '推导值' : quality ? '实测' : '等待采样';
  node.closest('article').title = `${quality?.source || '等待设备返回'}${quality?.reason ? `\n${quality.reason}` : ''}`;
}

function minMaxDownsample(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  const bucketCount = Math.max(1, Math.floor(maxPoints / 2));
  const bucketSize = points.length / bucketCount;
  const result = [];
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.floor(bucket * bucketSize);
    const end = Math.min(points.length, Math.ceil((bucket + 1) * bucketSize));
    const values = points.slice(start, end);
    if (!values.length) continue;
    let minimum = values[0];
    let maximum = values[0];
    for (const point of values) {
      if (point.y < minimum.y) minimum = point;
      if (point.y > maximum.y) maximum = point;
    }
    if (minimum.x <= maximum.x) result.push(minimum, maximum);
    else result.push(maximum, minimum);
  }
  return result;
}

function chartTheme() {
  const styles = getComputedStyle(document.body);
  return { line: styles.getPropertyValue('--line').trim(), muted: styles.getPropertyValue('--muted').trim(), panel: styles.getPropertyValue('--panel').trim() };
}

function drawDatasets(canvas, datasets, unit = '', xMode = 'time') {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = Math.min(2, devicePixelRatio || 1);
  const width = Math.max(280, Math.floor(rect.width * ratio));
  const height = Math.max(120, Math.floor(rect.height * ratio));
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const theme = chartTheme();
  ctx.clearRect(0, 0, width, height);
  const usable = datasets.map((dataset) => ({ ...dataset, points: dataset.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) })).filter((dataset) => dataset.points.length);
  if (!usable.length) {
    ctx.fillStyle = theme.muted;
    ctx.font = `${10 * ratio}px system-ui`;
    ctx.fillText('暂无有效样本', 12 * ratio, 24 * ratio);
    return;
  }
  const ranges = usable.flatMap((dataset) => dataset.points).reduce((result, point) => ({
    xMin: Math.min(result.xMin, point.x), xMax: Math.max(result.xMax, point.x),
    yMin: Math.min(result.yMin, point.y), yMax: Math.max(result.yMax, point.y)
  }), { xMin: Infinity, xMax: -Infinity, yMin: Infinity, yMax: -Infinity });
  const { xMin, xMax, yMin, yMax } = ranges;
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || Math.max(1, Math.abs(yMax) * .15);
  const left = 12 * ratio;
  const right = width - 10 * ratio;
  const top = 14 * ratio;
  const bottom = height - 17 * ratio;
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = ratio;
  for (let row = 0; row <= 3; row += 1) {
    const y = top + (row / 3) * (bottom - top);
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
  }
  for (const dataset of usable) {
    const points = minMaxDownsample(dataset.points, Math.max(80, Math.floor(rect.width * 1.5)));
    ctx.strokeStyle = dataset.color;
    ctx.lineWidth = 1.8 * ratio;
    ctx.beginPath();
    points.forEach((point, index) => {
      const x = left + ((point.x - xMin) / xRange) * (right - left);
      const y = bottom - ((point.y - yMin) / yRange) * (bottom - top);
      if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.fillStyle = theme.muted;
  ctx.font = `${8 * ratio}px system-ui`;
  ctx.fillText(`${yMax.toFixed(1)} ${unit}`, left, 9 * ratio);
  const xLabel = xMode === 'progress' ? `${xMax.toFixed(0)}% 进度` : `${Math.max(0, xMax / 60).toFixed(1)} 分钟`;
  ctx.fillText(xLabel, Math.max(left, right - 60 * ratio), height - 3 * ratio);
}

function reportPoints(report, key) {
  const detail = series[key];
  return (report?.samples || []).map((sample, index) => ({ x: Number(sample.elapsed) || index, y: Number.isFinite(sample[key]) ? detail.scale(sample[key]) : null }));
}

function reportProgressPoints(report, key) {
  const points = reportPoints(report, key);
  const duration = points.reduce((maximum, point) => Math.max(maximum, point.x), 1);
  return points.map((point) => ({ ...point, x: point.x / duration * 100 }));
}

function drawLiveChart(canvas, key) {
  const detail = series[key];
  drawDatasets(canvas, [{ color: detail.color, points: reportPoints({ samples: state.samples }, key) }], detail.unit);
}

function updateDashboard() {
  const last = state.samples.at(-1);
  if (!last) return;
  const hours = Math.floor(last.elapsed / 3600);
  const minutes = Math.floor(last.elapsed % 3600 / 60);
  const seconds = Math.floor(last.elapsed % 60);
  elements.duration.textContent = `${hours ? `${String(hours).padStart(2, '0')}:` : ''}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  elements.sampleCount.textContent = `${state.samples.length} 个原始采样点`;
  for (const key of Object.keys(series)) renderKpi(key, last[key], last.quality?.[key]);
  for (const canvas of $$('canvas[data-series]')) drawLiveChart(canvas, canvas.dataset.series);
}

function reportPayload() {
  return {
    type: 'ios-performance-report',
    version: 2,
    name: elements.reportName.value.trim() || `iOS 性能测试 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    createdAt: new Date().toISOString(),
    config: state.config,
    meta: state.lastMeta,
    samples: state.samples.slice()
  };
}

function download(content, name, type) {
  const blob = new Blob([content], { type });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name.replace(/[\\/:*?"<>|]/g, '_');
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function metricStats(report, key) {
  const detail = series[key];
  const values = (report.samples || []).map((sample) => Number.isFinite(sample[key]) ? detail.scale(sample[key]) : null).filter(Number.isFinite);
  if (!values.length) return null;
  const stats = values.reduce((result, value) => ({
    sum: result.sum + value,
    min: Math.min(result.min, value),
    max: Math.max(result.max, value)
  }), { sum: 0, min: Infinity, max: -Infinity });
  return { average: stats.sum / values.length, min: stats.min, max: stats.max };
}

function reportHtml(report) {
  const summary = Object.entries(series).map(([key, detail]) => {
    const stats = metricStats(report, key);
    return `<tr><td>${escapeHtml(detail.label)}</td><td>${stats ? format(stats.average, detail.unit) : '—'}</td><td>${stats ? format(stats.max, detail.unit) : '—'}</td><td>${stats ? format(stats.min, detail.unit) : '—'}</td></tr>`;
  }).join('');
  const rows = report.samples.map((sample) => `<tr><td>${formatDate(sample.timestamp)}</td>${Object.entries(series).map(([key, detail]) => `<td>${Number.isFinite(sample[key]) ? format(detail.scale(sample[key]), detail.unit) : ''}</td>`).join('')}</tr>`).join('');
  const embedded = JSON.stringify({ report }).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(report.name)}</title><style>body{font-family:Arial,"Microsoft YaHei";color:#17212f;padding:24px}table{width:100%;border-collapse:collapse;margin:14px 0 26px}th,td{padding:7px 9px;border:1px solid #d7e0ea;text-align:right}th{color:#fff;background:#2772df}th:first-child,td:first-child{text-align:left}p{color:#657285}</style></head><body><h1>${escapeHtml(report.name)}</h1><p>${escapeHtml(report.meta?.model || 'iPhone')} · ${formatDate(report.createdAt)} · ${report.samples.length} 个原始采样点</p><p>严格实测模式：设备未返回的指标保持为空，不使用模拟值。</p><h2>指标摘要</h2><table><tr><th>指标</th><th>平均值</th><th>峰值</th><th>最小值</th></tr>${summary}</table><h2>采样明细</h2><table><tr><th>时间</th>${Object.values(series).map((detail) => `<th>${escapeHtml(detail.label)}</th>`).join('')}</tr>${rows}</table><script id="ios-performance-report-data" type="application/json">${embedded}</script></body></html>`;
}

async function startTest() {
  const metrics = selectedMetrics();
  if (!metrics.length) return toast('请至少选择一项采集指标');
  const app = elements.app.value === '' ? null : state.apps[Number(elements.app.value)];
  state.config = { serial: elements.device.value, interval: Number(elements.interval.value), metrics, app, autoMount: true, autoTunnel: true };
  state.samples = [];
  state.running = true;
  elements.dashboard.hidden = false;
  updateActions();
  try {
    state.lastMeta = await api.start(state.config);
    elements.dashboardDevice.textContent = state.lastMeta.model || 'iPhone';
  } catch (error) {
    state.running = false;
    elements.dashboard.hidden = true;
    updateActions();
    toast(error.message || String(error));
  }
}

async function stopTest() {
  if (!state.running) return;
  try {
    const stopped = await api.stop();
    state.lastMeta = { ...(state.lastMeta || {}), ...(stopped || {}) };
  } catch (error) {
    toast(error.message || String(error));
  }
  state.running = false;
  updateActions();
  if (!state.samples.length) return toast('本次没有有效采样');
  try {
    const saved = await api.saveReport(reportPayload());
    await loadReports();
    toast(`报告“${saved.name}”已保存`);
  } catch (error) {
    toast(`报告保存失败：${error.message || error}`);
  }
}

function switchPage(page) {
  $$('[data-ios-page]').forEach((button) => button.classList.toggle('active', button.dataset.iosPage === page));
  $$('.ios-page').forEach((section) => section.classList.toggle('active', section.id === `ios-${page}-page`));
  if (page === 'reports') loadReports();
  if (page === 'logs') loadLogs();
  if (page === 'compare') renderCompareOptions();
  requestAnimationFrame(redrawVisibleCharts);
}

function infoItem(label, value, wide = false) {
  return `<article class="ios-info-item${wide ? ' wide' : ''}"><span>${escapeHtml(label)}</span><strong title="${escapeHtml(value)}">${escapeHtml(value || '—')}</strong></article>`;
}

async function loadDeviceInfo() {
  if (!elements.device.value) return toast('请先连接并选择 iPhone');
  const container = $('#ios-device-info');
  container.innerHTML = '<div class="ios-empty"><h3>正在读取设备信息…</h3></div>';
  try {
    const info = await api.getDeviceStatus(elements.device.value);
    let deviceTime = info.deviceTimestamp;
    if (deviceTime != null && deviceTime !== '' && Number.isFinite(Number(deviceTime))) deviceTime = new Date(Number(deviceTime) * 1000).toISOString();
    const fields = [
      ['设备名称', info.name], ['产品型号', info.productType], ['iOS 版本', info.productVersion], ['系统构建', info.buildVersion],
      ['设备序列号', info.serialNumber], ['设备 UDID', info.udid || info.serial, true], ['硬件型号', info.hardwareModel], ['CPU 架构', info.cpuArchitecture],
      ['电量', info.batteryLevel != null && Number.isFinite(Number(info.batteryLevel)) ? `${info.batteryLevel}%` : '—'], ['充电状态', info.charging == null ? '—' : info.charging ? '正在充电' : '未充电'],
      ['总存储', formatBytes(info.totalDiskCapacity)], ['可用存储', formatBytes(info.freeDiskCapacity)], ['设备时间', deviceTime ? formatDate(deviceTime) : '—'],
      ['时区', info.timeZone], ['Wi-Fi 地址', info.wifiAddress], ['配对状态', info.paired ? '已信任 / 已配对' : '未配对']
    ];
    container.innerHTML = fields.map(([label, value, wide]) => infoItem(label, value, wide)).join('');
  } catch (error) {
    container.innerHTML = `<div class="ios-empty"><h3>设备信息读取失败</h3><p>${escapeHtml(error.message || String(error))}</p></div>`;
  }
}

async function loadLogs() {
  if (!api) return;
  try {
    state.logs = await api.listLogs({ type: $('#ios-log-filter').value });
    $('#ios-log-count').textContent = state.logs.length;
    renderLogs();
  } catch (error) {
    toast(error.message || String(error));
  }
}

function renderLogs() {
  const container = $('#ios-log-list');
  if (!state.logs.length) {
    container.innerHTML = '<div class="ios-empty"><h3>暂无诊断日志</h3><p>读取后会保存在本机历史中。</p></div>';
    return;
  }
  container.innerHTML = state.logs.map((log) => `<button class="ios-log-row" data-log-id="${escapeHtml(log.id)}"><header><strong>${escapeHtml(log.summary?.title || log.name)}</strong><em>${escapeHtml(log.type)}</em></header><p>${escapeHtml(log.summary?.exceptionType || log.summary?.terminationReason || log.sourcePath)}</p><small>${formatDate(log.occurredAt)} · ${formatBytes(log.size)} · ${escapeHtml(log.deviceName)}</small></button>`).join('');
  $$('.ios-log-row').forEach((button) => button.addEventListener('click', () => showLog(button.dataset.logId, button)));
}

async function collectLogs() {
  if (!elements.device.value) return toast('请先连接并选择 iPhone');
  const button = $('#ios-log-collect');
  button.disabled = true;
  button.textContent = '正在读取…';
  try {
    const result = await api.collectLogs(elements.device.value);
    await loadLogs();
    toast(result.imported ? `已保存 ${result.imported} 份新日志` : '没有发现新的诊断日志');
  } catch (error) {
    toast(error.message || String(error));
  } finally {
    button.textContent = '读取最新日志';
    updateActions();
  }
}

async function showLog(id, button) {
  $$('.ios-log-row').forEach((node) => node.classList.toggle('active', node === button));
  const detail = $('#ios-log-detail');
  detail.innerHTML = '<div class="ios-empty"><h3>正在读取日志…</h3></div>';
  try {
    const log = await api.getLog(id);
    if (!log) throw new Error('日志不存在');
    const summary = log.summary || {};
    detail.innerHTML = `<header><div><h3>${escapeHtml(summary.title || log.name)}</h3><p>${formatDate(log.occurredAt)} · ${escapeHtml(log.sourcePath)}</p></div><button class="ios-button secondary" id="ios-log-export">导出原文</button></header><div class="ios-log-summary">${infoSummary('进程', summary.processName)}${infoSummary('Bundle ID', summary.bundleId)}${infoSummary('异常类型', summary.exceptionType)}${infoSummary('终止原因', summary.terminationReason)}${infoSummary('Incident ID', summary.incidentId)}${infoSummary('日志类型', log.type)}</div><pre>${escapeHtml(log.content)}</pre>`;
    $('#ios-log-export').addEventListener('click', () => download(log.content, log.name, 'text/plain;charset=utf-8'));
  } catch (error) {
    detail.innerHTML = `<div class="ios-empty"><h3>日志读取失败</h3><p>${escapeHtml(error.message || String(error))}</p></div>`;
  }
}

function infoSummary(label, value) {
  return `<div><span>${escapeHtml(label)}</span><strong title="${escapeHtml(value || '—')}">${escapeHtml(value || '—')}</strong></div>`;
}

async function loadReports() {
  if (!api) return;
  try {
    state.reports = await api.listReports();
    $('#ios-report-count').textContent = state.reports.length;
    renderReports();
    renderCompareOptions();
  } catch (error) {
    toast(error.message || String(error));
  }
}

function renderReports() {
  const container = $('#ios-report-list');
  if (!state.reports.length) {
    container.innerHTML = '<div class="ios-empty"><h3>暂无性能报告</h3><p>完成一次测试后会自动保存。</p></div>';
    return;
  }
  container.innerHTML = state.reports.map((report) => `<article class="ios-report-card"><h3 title="${escapeHtml(report.name)}">${escapeHtml(report.name)}</h3><p>${formatDate(report.createdAt)}${report.imported ? ' · 已导入' : ''}</p><dl><div><dt>设备</dt><dd>${escapeHtml(report.deviceName)}</dd></div><div><dt>App</dt><dd>${escapeHtml(report.appBundleId || '未指定')}</dd></div><div><dt>原始采样</dt><dd>${report.sampleCount} 点</dd></div><div><dt>时长</dt><dd>${format(report.duration, '秒', 0)}</dd></div></dl><div class="ios-report-actions"><button data-action="json" data-report-id="${report.id}">JSON</button><button data-action="html" data-report-id="${report.id}">HTML</button><button data-action="compare" data-report-id="${report.id}">对比</button><button data-action="delete" data-report-id="${report.id}" title="删除报告">删除</button></div></article>`).join('');
  $$('[data-report-id]').forEach((button) => button.addEventListener('click', () => handleReportAction(button.dataset.action, button.dataset.reportId)));
}

async function getReport(id) {
  if (state.reportCache.has(id)) return state.reportCache.get(id);
  const report = await api.getReport(id);
  if (report) state.reportCache.set(id, report);
  return report;
}

async function handleReportAction(action, id) {
  if (action === 'delete') {
    if (!confirm('确定删除这份 iOS 性能报告吗？')) return;
    await api.deleteReport(id);
    state.reportCache.delete(id);
    await loadReports();
    return toast('报告已删除');
  }
  if (action === 'compare') {
    switchPage('compare');
    $('#ios-compare-left').value = id;
    return;
  }
  const report = await getReport(id);
  if (!report) return toast('报告不存在');
  if (action === 'json') download(JSON.stringify(report, null, 2), `${report.name}.json`, 'application/json;charset=utf-8');
  if (action === 'html') download(reportHtml(report), `${report.name}.html`, 'text/html;charset=utf-8');
}

async function importReport(file) {
  const value = JSON.parse(await file.text());
  const report = value.report || value;
  if (!report || !Array.isArray(report.samples)) throw new Error('文件中没有有效的 iOS 性能报告');
  await api.saveReport(report, { imported: true });
  await loadReports();
  toast('报告已导入');
}

function renderCompareOptions() {
  const options = '<option value="">选择报告</option>' + state.reports.map((report) => `<option value="${report.id}">${escapeHtml(report.name)}</option>`).join('');
  for (const select of [$('#ios-compare-left'), $('#ios-compare-right')]) {
    const selected = select.value;
    select.innerHTML = options;
    select.value = selected;
  }
}

async function runComparison() {
  const leftId = $('#ios-compare-left').value;
  const rightId = $('#ios-compare-right').value;
  if (!leftId || !rightId || leftId === rightId) return toast('请选择两份不同的报告');
  try {
    const [left, right] = await Promise.all([getReport(leftId), getReport(rightId)]);
    if (!left || !right) throw new Error('报告不存在');
    const rows = Object.entries(series).map(([key, detail]) => ({ key, detail, left: metricStats(left, key), right: metricStats(right, key) })).filter((row) => row.left && row.right);
    state.comparison = { left, right, rows };
    $('#ios-compare-body').innerHTML = rows.map((row) => {
      const delta = row.left.average === 0 ? null : (row.right.average - row.left.average) / Math.abs(row.left.average) * 100;
      return `<tr><td>${escapeHtml(row.detail.label)}</td><td>${format(row.left.average, row.detail.unit)}</td><td>${format(row.right.average, row.detail.unit)}</td><td class="${delta > 0 ? 'ios-delta-up' : delta < 0 ? 'ios-delta-down' : ''}">${Number.isFinite(delta) ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%` : '—'}</td><td>${format(row.left.max, row.detail.unit)}</td><td>${format(row.right.max, row.detail.unit)}</td></tr>`;
    }).join('');
    $('#ios-compare-metric').innerHTML = rows.map((row) => `<option value="${row.key}">${escapeHtml(row.detail.label)}</option>`).join('');
    $('#ios-compare-title').textContent = `${left.name} 对比 ${right.name}`;
    $('#ios-compare-result').hidden = false;
    $('#ios-compare-empty').hidden = true;
    drawComparison();
  } catch (error) {
    toast(error.message || String(error));
  }
}

function drawComparison() {
  if (!state.comparison) return;
  const key = $('#ios-compare-metric').value;
  const detail = series[key];
  if (!detail) return;
  drawDatasets($('#ios-compare-canvas'), [
    { color: detail.color, points: reportProgressPoints(state.comparison.left, key) },
    { color: '#db5964', points: reportProgressPoints(state.comparison.right, key) }
  ], detail.unit, 'progress');
}

function redrawVisibleCharts() {
  if (!$('#ios-monitor-page').classList.contains('active')) {
    if ($('#ios-compare-page').classList.contains('active')) drawComparison();
    return;
  }
  updateDashboard();
}

$$('[data-ios-page]').forEach((button) => button.addEventListener('click', () => switchPage(button.dataset.iosPage)));
elements.platform.textContent = window.testCat?.platform === 'win32' ? 'Windows' : window.testCat?.platform === 'darwin' ? 'macOS' : '桌面版';
elements.refresh.addEventListener('click', refreshDevices);
elements.appRefresh.addEventListener('click', refreshApps);
elements.device.addEventListener('change', () => { updateActions(); refreshApps(); });
elements.start.addEventListener('click', startTest);
elements.stop.addEventListener('click', stopTest);
elements.tunnel.addEventListener('click', async () => { try { await api.startTunnel(); } catch (error) { toast(error.message || String(error)); } });
$('#ios-device-load').addEventListener('click', loadDeviceInfo);
$('#ios-log-collect').addEventListener('click', collectLogs);
$('#ios-log-filter').addEventListener('change', loadLogs);
$('#ios-report-import').addEventListener('click', () => $('#ios-report-import-input').click());
$('#ios-report-import-input').addEventListener('change', async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try { await importReport(file); } catch (error) { toast(`导入失败：${error.message || error}`); }
  event.target.value = '';
});
$('#ios-compare-run').addEventListener('click', runComparison);
$('#ios-compare-metric').addEventListener('change', drawComparison);
$('#ios-performance-toggle-all').addEventListener('click', () => {
  const inputs = $$('.ios-metric-options input');
  const checked = inputs.every((input) => input.checked);
  inputs.forEach((input) => { input.checked = !checked; });
  $('#ios-performance-toggle-all').textContent = checked ? '全选' : '取消全选';
});

api?.onSample((sample) => {
  state.samples.push(sample);
  if (state.samples.length > MAX_RAW_SAMPLES) state.samples.shift();
  updateDashboard();
});
api?.onStatus(setStatus);
api?.checkEnvironment().then((result) => {
  elements.environment.textContent = result.message;
  if (!result.ready) setStatus({ phase: 'error', message: result.message });
}).catch((error) => {
  elements.environment.textContent = error.message || String(error);
});

window.addEventListener('storage', (event) => { if (event.key === 'test-cat-theme') applyTheme(); });
window.addEventListener('resize', redrawVisibleCharts);
applyTheme();
refreshDevices();
loadReports();
loadLogs();
updateActions();
