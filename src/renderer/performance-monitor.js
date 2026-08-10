const api = window.testCat?.performanceMonitor;
const core = window.PerformanceReportCore;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const REPORT_KEY = 'test-cat-performance-reports-v1';
const MAX_RAW_SAMPLES = 86400;
const MAX_EVENTS = 10000;

document.body.dataset.platform = window.testCat?.platform || 'browser';

const groups = {
  cpu: { name: 'CPU', series: ['cpuUsage', 'appCpuUsage', 'cpuFrequency', 'cpuTemperature'] },
  memory: { name: '内存', series: ['memoryTotal', 'memoryUsed', 'appMemory', 'memoryLeakTrend'] },
  gpu: { name: 'GPU / 渲染', series: ['gpuLoad', 'gpuMemory', 'gpuFrequency', 'fps', 'jankCount'] },
  network: { name: '网络', series: ['downloadSpeed', 'uploadSpeed', 'networkLatency', 'packetLoss'] },
  disk: { name: '磁盘', series: ['diskReadSpeed', 'diskWriteSpeed', 'ioWait', 'diskFree'] },
  app: { name: '应用', series: ['startupTime', 'fps', 'jankCount', 'crashCount'] },
  device: { name: '设备', series: ['power', 'batteryLevel', 'deviceTemperature'] }
};

const metricDetails = {
  cpuUsage: { label: '整机 CPU 使用率', unit: '%', cardUnit: '设备瞬时 · %', reportUnit: '%', color: '#4b8cff', help: '整机 CPU 使用率，按所有 CPU 核心总时间归一化，范围 0–100%。' },
  appCpuUsage: { label: '目标 App CPU（单核口径）', unit: '%', cardUnit: 'App瞬时 · 单核%', reportUnit: '单核口径 %', color: '#42d392', help: 'Android/top 常用 App CPU 口径：单核满载=100%，多线程可超过100%；卡片会同时显示等效核心数。' },
  cpuFrequency: { label: 'CPU 平均频率', unit: 'MHz', cardUnit: '在线核心均值 · MHz', reportUnit: 'MHz', color: '#a982ff', help: '读取在线 CPU 核心 scaling_cur_freq 后求平均；不同厂商可能限制读取。' },
  cpuTemperature: { label: 'CPU/SOC 温度', unit: '℃', cardUnit: 'CPU/SOC · ℃', reportUnit: '℃', color: '#ff6b72', help: '优先选择 CPU/SOC thermal_zone，排除电池、GPU、外壳等温度传感器。' },
  memoryTotal: { label: '设备内存总量', unit: 'MB', cardUnit: '设备 · MB', reportUnit: 'MB', color: '#6c7f98', help: '设备物理内存总量，来自 /proc/meminfo MemTotal。' },
  memoryUsed: { label: '系统内存已用', unit: 'MB', cardUnit: '设备 · MB', reportUnit: 'MB', color: '#4b8cff', help: '系统内存已用量，优先按 MemTotal - MemAvailable 计算。' },
  appMemory: { label: '目标 App PSS 内存', unit: 'MB', cardUnit: 'App PSS · MB', reportUnit: 'PSS MB', color: '#42d392', help: 'App 按比例分摊后的物理内存 PSS，来自 dumpsys meminfo；App 未运行时显示不可用。' },
  memoryLeakTrend: { label: 'App PSS 增长趋势', unit: 'MB/分钟', cardUnit: 'App PSS趋势 · MB/分', reportUnit: 'MB/分钟', color: '#ffad57', help: '最近 5 分钟内 App PSS 的线性增长斜率，至少需要 60 秒有效数据。' },
  gpuLoad: { label: '设备 GPU 负载', unit: '%', cardUnit: '设备GPU瞬时 · %', reportUnit: '%', color: '#a982ff', help: 'GPU 驱动公开的 busy/utilization 计数器，不是 App 单独占用。' },
  gpuMemory: { label: '目标 App 图形内存', unit: 'MB', cardUnit: 'App图形 · MB', reportUnit: 'MB', color: '#ffad57', help: 'App 图形共享内存，来自 dumpsys meminfo 的 GL mtrack/Gfx dev。' },
  gpuFrequency: { label: 'GPU 当前频率', unit: 'MHz', cardUnit: '设备GPU · MHz', reportUnit: 'MHz', color: '#4b8cff', help: 'GPU devfreq 当前频率；厂商未开放节点时显示不可用。' },
  fps: { label: '前台画面 FPS', unit: 'FPS', cardUnit: '前台App · FPS', reportUnit: 'FPS', color: '#42d392', help: '优先使用 SurfaceFlinger 实际呈现帧时间；App 在后台或未运行时不可用。' },
  jankCount: { label: '采样间隔卡顿帧', unit: '帧', cardUnit: '本采样间隔 · 帧', reportUnit: '帧/采样', color: '#ff6b72', help: '当前采样间隔内估算的丢帧/卡顿帧数量，不是会话累计值。' },
  downloadSpeed: { label: '下载速率', unit: 'MB/s', cardUnit: '瞬时速率 · MB/s', reportUnit: 'MB/s', color: '#4b8cff', help: '优先使用 App UID 流量计数；取不到 UID 时回退为整机网卡流量，卡片悬停可看来源。' },
  uploadSpeed: { label: '上传速率', unit: 'MB/s', cardUnit: '瞬时速率 · MB/s', reportUnit: 'MB/s', color: '#42d392', help: '优先使用 App UID 流量计数；取不到 UID 时回退为整机网卡流量，卡片悬停可看来源。' },
  networkLatency: { label: '网络延迟', unit: 'ms', cardUnit: 'ping 4包 · ms', reportUnit: 'ms', color: '#ffad57', help: '对设置的探测目标执行 4 包 ping 后取平均 RTT。' },
  packetLoss: { label: '网络丢包率', unit: '%', cardUnit: 'ping 4包 · %', reportUnit: '%', color: '#ff6b72', help: '对设置的探测目标执行 4 包 ping 后得到的丢包率。' },
  diskReadSpeed: { label: '/data 磁盘读取速率', unit: 'MB/s', cardUnit: '/data瞬时 · MB/s', reportUnit: 'MB/s', color: '#4b8cff', help: '设备 /data 后端块设备读速率，来自块设备 stat 增量。' },
  diskWriteSpeed: { label: '/data 磁盘写入速率', unit: 'MB/s', cardUnit: '/data瞬时 · MB/s', reportUnit: 'MB/s', color: '#a982ff', help: '设备 /data 后端块设备写入速率，来自块设备 stat 增量。' },
  ioWait: { label: 'CPU IO Wait', unit: '%', cardUnit: '设备瞬时 · %', reportUnit: '%', color: '#ffad57', help: '整机 CPU 时间中等待 I/O 的比例，来自 /proc/stat iowait 增量。' },
  diskFree: { label: '/data 剩余空间', unit: 'MB', cardUnit: '/data · MB', reportUnit: 'MB', color: '#42d392', help: '设备 /data 分区剩余空间，来自 df /data。' },
  startupTime: { label: 'App 冷启动耗时', unit: 'ms', cardUnit: 'ActivityManager · ms', reportUnit: 'ms', color: '#ffad57', help: '点击“启动应用并计时”后 force-stop 再启动，读取 ActivityManager TotalTime。' },
  crashCount: { label: '崩溃/ANR 累计', unit: '次', cardUnit: '本次会话累计 · 次', reportUnit: '次', color: '#ff6b72', help: '本次监控会话中新出现的 Crash 和 ANR 去重累计。' },
  power: { label: '电池侧瞬时功率', unit: 'W', cardUnit: '计算值 · W', reportUnit: 'W', color: '#a982ff', help: '由电池 current_now × voltage_now 计算，代表电池侧功率，不等同整机墙上功耗。' },
  batteryLevel: { label: '电池电量', unit: '%', cardUnit: '设备 · %', reportUnit: '%', color: '#42d392', help: '设备当前电池电量，来自 dumpsys battery level。' },
  deviceTemperature: { label: '电池温度', unit: '℃', cardUnit: '电池 · ℃', reportUnit: '℃', color: '#ff6b72', help: '设备电池温度，来自 dumpsys battery temperature，不代表 CPU/GPU 温度。' }
};

const qualityLabels = { measured: '实测', derived: '计算值', background: '后台', unavailable: '不可用' };
const state = {
  reports: [], reportCache: new Map(), samples: [], events: [], anomalyTracker: {}, running: false,
  config: null, stopMeta: null, startupTime: null, startupQuality: null, comparison: null
};

function metricDetail(key) { return metricDetails[key] || { label: key, unit: '', cardUnit: '', reportUnit: '', color: '#fff', help: '未登记指标说明。' }; }
function metricLabel(key) { return metricDetail(key).label; }
function metricUnit(key) { return metricDetail(key).unit || ''; }
function metricCardUnit(key) { return metricDetail(key).cardUnit || metricUnit(key); }
function metricReportUnit(key) { return metricDetail(key).reportUnit || metricUnit(key); }
function metricColor(key) { return metricDetail(key).color || '#fff'; }
function selectedGroups() { return $$('.metric-options input:checked').map((input) => input.value); }
function activeSeries(groupIds = state.config?.metrics || selectedGroups()) { return [...new Set((groupIds || []).flatMap((id) => groups[id]?.series || []))]; }
function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]); }

function toast(message) {
  const node = $('#performance-toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 2600);
}

function normalizeValue(key, value) {
  if (!Number.isFinite(value)) return null;
  if (['downloadSpeed', 'uploadSpeed', 'diskReadSpeed', 'diskWriteSpeed'].includes(key)) return value / 1024 / 1024;
  return value;
}

function formatValue(key, value) {
  const normalized = normalizeValue(key, value);
  if (!Number.isFinite(normalized)) return '不可用';
  const digits = Math.abs(normalized) >= 100 ? 0 : Math.abs(normalized) >= 10 ? 1 : 2;
  if (key === 'appCpuUsage') return `${normalized.toFixed(digits)}% · ${(normalized / 100).toFixed(2)}核`;
  return `${normalized.toFixed(digits)}${metricUnit(key) ? ` ${metricUnit(key)}` : ''}`;
}

function formatDuration(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value % 3600 / 60);
  const remainder = Math.floor(value % 60);
  return hours ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

async function refreshDevices() {
  const select = $('#performance-device');
  select.innerHTML = '<option value="">正在检测…</option>';
  select.disabled = true;
  try {
    const devices = await api.listDevices();
    select.innerHTML = devices.length ? '' : '<option value="">未发现 Android 设备</option>';
    for (const device of devices) {
      const option = document.createElement('option');
      option.value = device.serial;
      option.disabled = device.state !== 'device';
      option.textContent = `${device.model} · ${device.serial} · ${device.state === 'device' ? '已就绪' : device.state === 'unauthorized' ? '等待授权' : '离线'}`;
      select.append(option);
    }
    select.value = devices.find((item) => item.state === 'device')?.serial || '';
  } catch (error) {
    select.innerHTML = '<option value="">设备检测失败</option>';
    toast(error.message || String(error));
  } finally {
    select.disabled = false;
    updateActionState();
  }
}

function updateActionState() {
  const hasDevice = Boolean($('#performance-device').value);
  $('#performance-start').disabled = state.running || !hasDevice || !selectedGroups().length;
  $('#performance-stop').disabled = !state.running;
  $('#performance-launch').disabled = state.running || !hasDevice || !$('#performance-package').value.trim();
  $('#performance-detect-app').disabled = state.running || !hasDevice;
  $$('.metric-options input,#performance-device,#performance-package,#performance-interval,#performance-follow-app,#performance-network-target').forEach((node) => { node.disabled = state.running; });
}

function calculateLeakTrend(samples) {
  const latestTimestamp = samples.at(-1)?.timestamp || Date.now();
  const values = samples.filter((sample) => sample.timestamp >= latestTimestamp - 5 * 60 * 1000 && Number.isFinite(sample.appMemory));
  if (values.length < 10 || values.at(-1).timestamp - values[0].timestamp < 60000) return null;
  const origin = values[0].timestamp;
  const points = values.map((sample) => ({ x: (sample.timestamp - origin) / 60000, y: sample.appMemory }));
  const xMean = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const yMean = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const numerator = points.reduce((sum, point) => sum + (point.x - xMean) * (point.y - yMean), 0);
  const denominator = points.reduce((sum, point) => sum + (point.x - xMean) ** 2, 0);
  return denominator > 0 ? numerator / denominator : null;
}

function setupDashboard() {
  const keys = activeSeries();
  $('#performance-kpis').innerHTML = keys.map((key) => `<div class="performance-kpi" id="kpi-card-${key}"><span>${metricLabel(key)}</span><strong id="kpi-${key}">—</strong><div><small>${metricCardUnit(key)}</small><em id="kpi-quality-${key}">等待采样</em></div></div>`).join('');
  $('#performance-charts').innerHTML = keys.map((key) => `<article class="chart-card"><header><h3>${metricLabel(key)}</h3><span>${metricReportUnit(key)}</span></header><canvas data-performance-chart="${key}"></canvas></article>`).join('');
  $('#performance-dashboard').hidden = false;
  renderEvents();
}

function prepareCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return { context, width, height };
}

function drawMetricChart(canvas, samples, key, events = []) {
  if (!canvas) return;
  const { context, width, height } = prepareCanvas(canvas);
  const rawPoints = core.minMaxDownsample(samples, key, Math.max(80, Math.floor(width)));
  const points = rawPoints.map((point) => ({ ...point, value: normalizeValue(key, point.value) })).filter((point) => Number.isFinite(point.value));
  if (!points.length) {
    context.fillStyle = '#637187';
    context.font = '11px system-ui';
    context.textAlign = 'center';
    context.fillText('等待设备返回数据', width / 2, height / 2);
    return;
  }
  const plot = { left: 38, right: width - 10, top: 17, bottom: height - 23 };
  let minimum = points.reduce((value, point) => Math.min(value, point.value), Infinity);
  let maximum = points.reduce((value, point) => Math.max(value, point.value), -Infinity);
  if (minimum === maximum) { minimum -= 1; maximum += 1; }
  const padding = Math.max((maximum - minimum) * 0.08, 0.01);
  minimum -= padding;
  maximum += padding;
  const start = points[0].timestamp;
  const end = Math.max(start + 1, points.at(-1).timestamp);
  const x = (timestamp) => plot.left + (timestamp - start) / (end - start) * (plot.right - plot.left);
  const y = (value) => plot.bottom - (value - minimum) / (maximum - minimum) * (plot.bottom - plot.top);
  context.strokeStyle = '#283545';
  context.lineWidth = 1;
  for (let index = 0; index < 4; index += 1) {
    const gridY = plot.top + index * (plot.bottom - plot.top) / 3;
    context.beginPath(); context.moveTo(plot.left, gridY); context.lineTo(plot.right, gridY); context.stroke();
  }
  context.strokeStyle = metricColor(key);
  context.lineWidth = 1.8;
  context.beginPath();
  points.forEach((point, index) => index ? context.lineTo(x(point.timestamp), y(point.value)) : context.moveTo(x(point.timestamp), y(point.value)));
  context.stroke();
  context.strokeStyle = 'rgba(255, 107, 114, .45)';
  for (const event of events.filter((item) => item.level === 'error' || item.level === 'warning')) {
    const timestamp = Number(event.timestamp);
    if (!Number.isFinite(timestamp) || timestamp < start || timestamp > end) continue;
    context.beginPath(); context.moveTo(x(timestamp), plot.top); context.lineTo(x(timestamp), plot.bottom); context.stroke();
  }
  context.fillStyle = '#7f8da3';
  context.font = '9px system-ui';
  context.textAlign = 'left';
  context.fillText(maximum.toFixed(1), 2, plot.top + 3);
  context.fillText(minimum.toFixed(1), 2, plot.bottom);
  context.fillText(formatDuration(points[0].elapsed), plot.left, height - 5);
  context.textAlign = 'right';
  context.fillText(formatDuration(points.at(-1).elapsed), plot.right, height - 5);
}

function updateDashboard() {
  const last = state.samples.at(-1);
  if (!last) return;
  for (const key of activeSeries()) {
    const value = key === 'startupTime' ? state.startupTime : last[key];
    const quality = key === 'startupTime' ? state.startupQuality : last.quality?.[key];
    const node = $(`#kpi-${key}`);
    const qualityNode = $(`#kpi-quality-${key}`);
    const card = $(`#kpi-card-${key}`);
    if (node) node.textContent = formatValue(key, value);
    if (qualityNode) { qualityNode.textContent = qualityLabels[quality?.state] || '等待采样'; qualityNode.dataset.state = quality?.state || 'waiting'; }
    if (card) card.title = `${metricDetail(key).help}\n状态：${qualityLabels[quality?.state] || '等待采样'}\n来源：${quality?.reason || quality?.source || '等待设备返回数据'}`;
  }
  $('#performance-duration').textContent = formatDuration(last.elapsed);
  $('#performance-sample-count').textContent = `${state.samples.length} 个采样点`;
  $$('[data-performance-chart]').forEach((canvas) => drawMetricChart(canvas, state.samples, canvas.dataset.performanceChart, state.events));
}

function appendEvent(event) {
  if (!event || !event.label) return;
  const normalized = { timestamp: Date.now(), level: 'info', type: 'event', ...event };
  const duplicate = state.events.at(-1);
  if (duplicate && duplicate.type === normalized.type && duplicate.label === normalized.label && Math.abs(duplicate.timestamp - normalized.timestamp) < 500) return;
  state.events.push(normalized);
  if (state.events.length > MAX_EVENTS) state.events.shift();
}

function renderEvents() {
  const container = $('#performance-events');
  if (!container) return;
  $('#performance-event-count').textContent = state.events.length;
  const visible = state.events.slice(-10).reverse();
  container.innerHTML = visible.length ? visible.map((event) => `<article data-level="${escapeHtml(event.level)}"><time>${new Date(event.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}</time><div><strong>${escapeHtml(event.label)}</strong><span>${escapeHtml(event.packageName || (event.metric ? metricLabel(event.metric) : '测试事件'))}</span></div></article>`).join('') : '<p>尚未发现异常事件</p>';
}

async function startTest() {
  const selected = selectedGroups();
  if (!selected.length) return toast('请至少选择一类监控数据');
  state.samples = [];
  state.events = [];
  state.anomalyTracker = {};
  state.stopMeta = null;
  state.config = {
    serial: $('#performance-device').value,
    packageName: $('#performance-package').value.trim(),
    followForeground: $('#performance-follow-app').checked,
    networkTarget: $('#performance-network-target').value.trim(),
    interval: Number($('#performance-interval').value),
    metrics: selected
  };
  try {
    const meta = await api.start(state.config);
    state.config = { ...state.config, ...meta };
    if (meta.packageName) $('#performance-package').value = meta.packageName;
    state.running = true;
    setupDashboard();
    updateActionState();
    $('#performance-session-summary').textContent = `正在监控 ${meta.model} · ${selected.map((id) => groups[id].name).join('、')}${meta.bundledRuntime ? ' · 内置 ADB' : ''}`;
  } catch (error) {
    toast(error.message || String(error));
  }
}

async function stopTest() {
  if (!state.running) return;
  try {
    state.stopMeta = await api.stop();
    state.running = false;
    updateActionState();
    $('#report-name').value = `性能测试 ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
    $('#report-name-modal').hidden = false;
    setTimeout(() => $('#report-name').select(), 0);
  } catch (error) {
    toast(error.message || String(error));
  }
}

function reportSummary(report) {
  const result = {};
  for (const key of activeSeries(report.config?.metrics || [])) {
    const values = (report.samples || []).map((sample) => normalizeValue(key, sample[key])).filter(Number.isFinite);
    const summary = core.summarizeValues(values);
    if (summary) result[key] = summary;
  }
  if (Number.isFinite(report.startupTime)) result.startupTime = core.summarizeValues([report.startupTime]);
  return result;
}

function reportQuality(report, key) {
  if (key === 'startupTime') return report.startupQuality;
  for (let index = report.samples.length - 1; index >= 0; index -= 1) {
    const quality = report.samples[index].quality?.[key];
    if (quality?.state !== 'unavailable') return quality;
  }
  return report.samples.at(-1)?.quality?.[key] || null;
}

function createReport(name, note) {
  const report = {
    version: 3,
    accuracyMode: 'strict-measured',
    name,
    note,
    createdAt: new Date().toISOString(),
    config: state.config,
    meta: state.stopMeta,
    startupTime: state.startupTime,
    startupQuality: state.startupQuality,
    samples: state.samples.slice(),
    events: state.events.slice()
  };
  report.analysis = { metrics: reportSummary(report), warnings: report.events.filter((event) => event.level === 'warning' || event.level === 'error').length };
  return report;
}

function legacyReports() {
  try {
    const reports = JSON.parse(localStorage.getItem(REPORT_KEY) || '[]');
    return Array.isArray(reports) ? reports : [];
  } catch {
    return [];
  }
}

async function loadReports() {
  const legacy = legacyReports();
  if (legacy.length) {
    try {
      const result = await api.migrateReports(legacy);
      localStorage.removeItem(REPORT_KEY);
      if (result.imported) toast(`已迁移 ${result.imported} 份旧性能报告`);
    } catch (error) {
      console.warn('旧性能报告迁移失败', error);
    }
  }
  state.reports = await api.listReports();
  renderReports();
}

async function getReport(id) {
  if (state.reportCache.has(id)) return state.reportCache.get(id);
  const report = await api.getReport(id);
  if (!report) throw new Error('报告不存在或已经损坏');
  state.reportCache.set(id, report);
  return report;
}

function renderReports() {
  $('#report-count').textContent = state.reports.length;
  $('#report-empty').hidden = state.reports.length > 0;
  $('#report-list').hidden = !state.reports.length;
  $('#report-list').innerHTML = state.reports.map((report) => `<article class="report-card"><h3>${escapeHtml(report.name)}</h3><p>${escapeHtml(report.note || '暂无测试备注')}</p><div class="report-meta"><span>${new Date(report.createdAt).toLocaleString('zh-CN', { hour12: false })}</span><span>${report.sampleCount} 点 · ${report.eventCount || 0} 事件</span></div><div class="report-actions"><button data-report-export="json" data-report-id="${report.id}">JSON</button><button data-report-export="html" data-report-id="${report.id}">HTML</button><button data-report-export="excel" data-report-id="${report.id}">Excel</button><button data-report-compare="${report.id}">对比</button><button class="delete" data-report-delete="${report.id}" title="删除报告">×</button></div></article>`).join('');
  $$('[data-report-export]').forEach((button) => button.onclick = async () => {
    try { await exportReport(await getReport(button.dataset.reportId), button.dataset.reportExport); } catch (error) { toast(error.message || String(error)); }
  });
  $$('[data-report-delete]').forEach((button) => button.onclick = async () => {
    if (!confirm('确定删除这份性能报告吗？')) return;
    await api.deleteReport(button.dataset.reportDelete);
    state.reportCache.delete(button.dataset.reportDelete);
    await loadReports();
  });
  $$('[data-report-compare]').forEach((button) => button.onclick = () => {
    $('#compare-left').value = button.dataset.reportCompare;
    switchPage('compare');
    toast('已选为基准报告，请再选择目标报告');
  });
  renderCompareOptions();
}

function formatReportNumber(key, value) {
  const normalized = normalizeValue(key, value);
  return Number.isFinite(normalized) ? normalized : '';
}

function formatStatistic(value) {
  return Number.isFinite(value) ? value : '';
}

function reportDocument(report, comparison = null) {
  const keys = activeSeries(report.config.metrics);
  const summary = reportSummary(report);
  const columns = ['elapsed', ...keys];
  const summaryRows = keys.map((key) => {
    const quality = reportQuality(report, key);
    const stats = summary[key];
    return `<tr><td>${metricLabel(key)}</td><td>${metricReportUnit(key)}</td><td>${qualityLabels[quality?.state] || '未知'}</td><td>${escapeHtml(quality?.source || quality?.reason || '')}</td><td>${formatStatistic(stats?.avg)}</td><td>${formatStatistic(stats?.max)}</td><td>${formatStatistic(stats?.p50)}</td><td>${formatStatistic(stats?.p90)}</td><td>${formatStatistic(stats?.p95)}</td><td>${formatStatistic(stats?.p99)}</td></tr>`;
  }).join('');
  const dataRows = report.samples.map((sample) => `<tr>${columns.map((key) => `<td>${key === 'elapsed' ? sample.elapsed : formatReportNumber(key, sample[key])}</td>`).join('')}</tr>`).join('');
  const eventRows = (report.events || []).map((event) => `<tr><td>${new Date(event.timestamp).toLocaleString('zh-CN', { hour12: false })}</td><td>${escapeHtml(event.level || 'info')}</td><td>${escapeHtml(event.label)}</td><td>${escapeHtml(event.packageName || '')}</td></tr>`).join('');
  const comparisonTable = comparison ? `<h2>性能对比</h2><table><tr><th>指标</th><th>单位</th><th>基准平均</th><th>目标平均</th><th>变化 %</th></tr>${comparison.rows.map((row) => `<tr><td>${metricLabel(row.key)}</td><td>${metricReportUnit(row.key)}</td><td>${row.left}</td><td>${row.right}</td><td>${Number.isFinite(row.delta) ? row.delta : ''}</td></tr>`).join('')}</table>` : '';
  const payload = JSON.stringify({ type: 'performance-report', report }).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(report.name)}</title><style>body{font-family:Arial,"Microsoft YaHei";color:#17212f;padding:24px}h1{color:#245fae}table{border-collapse:collapse;width:100%;margin:12px 0 24px}th{background:#245fae;color:white}th,td{border:1px solid #d7e0ec;padding:7px 9px;text-align:right}th:first-child,td:first-child,td:nth-child(4){text-align:left}.meta td:first-child{font-weight:bold;background:#edf4ff}.note{color:#5c6b7d;font-size:13px;line-height:1.7}</style></head><body><h1>${escapeHtml(report.name)}</h1><p class="note">严格实测模式：设备未公开的数据保持为空，不使用模拟值。报告包含原始样本、指标来源、分位数和测试事件。</p><table class="meta"><tr><td>报告时间</td><td>${new Date(report.createdAt).toLocaleString('zh-CN', { hour12: false })}</td></tr><tr><td>设备</td><td>${escapeHtml(report.config.model || report.config.serial)}</td></tr><tr><td>应用包名</td><td>${escapeHtml(report.config.packageName || '未指定')}</td></tr><tr><td>采样点</td><td>${report.samples.length}</td></tr><tr><td>测试事件</td><td>${report.events?.length || 0}</td></tr><tr><td>备注</td><td>${escapeHtml(report.note || '')}</td></tr></table>${comparisonTable}<h2>指标摘要</h2><table><tr><th>指标</th><th>单位</th><th>状态</th><th>数据来源</th><th>平均值</th><th>最大值</th><th>P50</th><th>P90</th><th>P95</th><th>P99</th></tr>${summaryRows}</table><h2>测试事件</h2><table><tr><th>时间</th><th>等级</th><th>事件</th><th>App</th></tr>${eventRows}</table><h2>采样明细</h2><table><tr>${columns.map((key) => `<th>${key === 'elapsed' ? '时间（秒）' : `${metricLabel(key)}（${metricReportUnit(key)}）`}</th>`).join('')}</tr>${dataRows}</table><script id="performance-report-data" type="application/json">${payload}</script></body></html>`;
}

function download(content, name, type, withBom = false) {
  const blob = new Blob(withBom ? ['\ufeff', content] : [content], { type });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name.replace(/[\\/:*?"<>|]/g, '_');
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function exportReport(report, format) {
  if (format === 'json') download(JSON.stringify(report, null, 2), `${report.name}.json`, 'application/json;charset=utf-8');
  else if (format === 'html') download(reportDocument(report), `${report.name}.html`, 'text/html;charset=utf-8');
  else {
    const result = await api.exportXlsx(report.id);
    if (!result) return;
  }
  toast(`${format === 'json' ? 'JSON' : format === 'html' ? 'HTML' : 'Excel'} 报告已导出`);
}

async function importReport(file) {
  const text = await file.text();
  let report;
  if (file.name.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(text);
    report = parsed.report || parsed;
  } else {
    const document = new DOMParser().parseFromString(text, 'text/html');
    const node = document.querySelector('#performance-report-data');
    if (!node) throw new Error('文件中没有 Test cat 报告数据');
    report = JSON.parse(node.textContent).report;
  }
  if (!report?.samples || !report?.config) throw new Error('报告格式不正确');
  await api.saveReport(report, { imported: true });
  await loadReports();
  toast('性能报告已导入');
}

function renderCompareOptions() {
  const html = '<option value="">选择报告</option>' + state.reports.map((report) => `<option value="${report.id}">${escapeHtml(report.name)}</option>`).join('');
  const left = $('#compare-left').value;
  const right = $('#compare-right').value;
  $('#compare-left').innerHTML = html;
  $('#compare-right').innerHTML = html;
  $('#compare-left').value = left;
  $('#compare-right').value = right;
  $('#compare-empty').hidden = state.reports.length >= 2;
}

function formatNormalized(key, value) {
  if (!Number.isFinite(value)) return '—';
  if (key === 'appCpuUsage') return `${value.toFixed(1)}% · ${(value / 100).toFixed(2)}核`;
  return `${value.toFixed(Math.abs(value) >= 100 ? 0 : 2)}${metricUnit(key) ? ` ${metricUnit(key)}` : ''}`;
}

async function runComparison() {
  const leftId = $('#compare-left').value;
  const rightId = $('#compare-right').value;
  if (!leftId || !rightId || leftId === rightId) return toast('请选择两份不同的报告');
  try {
    const [left, right] = await Promise.all([getReport(leftId), getReport(rightId)]);
    const leftSummary = reportSummary(left);
    const rightSummary = reportSummary(right);
    const keys = Object.keys(leftSummary).filter((key) => rightSummary[key]);
    const rows = keys.map((key) => ({ key, left: leftSummary[key].avg, right: rightSummary[key].avg, delta: leftSummary[key].avg === 0 ? null : (rightSummary[key].avg - leftSummary[key].avg) / Math.abs(leftSummary[key].avg) * 100 }));
    state.comparison = { left, right, rows };
    $('#compare-result').hidden = false;
    $('#compare-empty').hidden = true;
    $('#compare-title').textContent = `${left.name}  vs  ${right.name}`;
    $('#compare-table-body').innerHTML = rows.map((row) => `<tr title="${escapeHtml(metricDetail(row.key).help)}"><td>${metricLabel(row.key)}</td><td>${formatNormalized(row.key, row.left)}</td><td>${formatNormalized(row.key, row.right)}</td><td class="${row.delta > 0 ? 'delta-up' : 'delta-down'}">${Number.isFinite(row.delta) ? `${row.delta > 0 ? '+' : ''}${row.delta.toFixed(1)}%` : '—'}</td></tr>`).join('');
    $('#compare-metric').innerHTML = keys.map((key) => `<option value="${key}">${metricLabel(key)}</option>`).join('');
    drawComparison();
  } catch (error) {
    toast(error.message || String(error));
  }
}

function drawComparison() {
  const comparison = state.comparison;
  if (!comparison) return;
  const key = $('#compare-metric').value;
  const canvas = $('#compare-chart');
  const { context, width, height } = prepareCanvas(canvas);
  const datasets = [comparison.left, comparison.right].map((report, index) => ({
    color: index ? '#42d392' : '#4b8cff',
    name: report.name,
    points: core.minMaxDownsample(report.samples, key, Math.max(80, Math.floor(width / 2))).map((point) => ({ ...point, value: normalizeValue(key, point.value) })).filter((point) => Number.isFinite(point.value))
  }));
  const values = datasets.flatMap((dataset) => dataset.points.map((point) => point.value));
  if (!values.length) return;
  let minimum = values.reduce((result, value) => Math.min(result, value), Infinity);
  let maximum = values.reduce((result, value) => Math.max(result, value), -Infinity);
  if (minimum === maximum) { minimum -= 1; maximum += 1; }
  const plot = { left: 36, right: width - 10, top: 20, bottom: height - 16 };
  datasets.forEach((dataset, datasetIndex) => {
    context.strokeStyle = dataset.color; context.lineWidth = 2; context.beginPath();
    dataset.points.forEach((point, index) => {
      const x = plot.left + (dataset.points.length === 1 ? 0 : index / (dataset.points.length - 1)) * (plot.right - plot.left);
      const y = plot.bottom - (point.value - minimum) / (maximum - minimum) * (plot.bottom - plot.top);
      if (index) context.lineTo(x, y); else context.moveTo(x, y);
    });
    context.stroke();
    context.fillStyle = dataset.color; context.font = '10px system-ui'; context.textAlign = 'left'; context.fillText(dataset.name, 8 + datasetIndex * width / 2, 11);
  });
}

async function exportComparison() {
  if (!state.comparison) return;
  try {
    const result = await api.exportComparisonXlsx(state.comparison.left.id, state.comparison.right.id);
    if (result) toast('对比 Excel 已导出');
  } catch (error) {
    toast(error.message || String(error));
  }
}

function switchPage(page) {
  $$('[data-performance-page]').forEach((button) => button.classList.toggle('active', button.dataset.performancePage === page));
  $$('.performance-page').forEach((section) => section.classList.toggle('active', section.id === `performance-${page}-page`));
  if (page === 'history') renderReports();
  if (page === 'compare') renderCompareOptions();
}

function handleSample(sample) {
  const compact = { timestamp: sample.timestamp, elapsed: sample.elapsed, packageName: sample.packageName, appState: sample.appState, collectionDurationMs: sample.collectionDurationMs, quality: {} };
  for (const key of activeSeries()) {
    compact[key] = sample[key];
    compact.quality[key] = sample.quality?.[key];
  }
  compact.memoryLeakTrend = calculateLeakTrend([...state.samples, compact]);
  compact.quality.memoryLeakTrend = Number.isFinite(compact.memoryLeakTrend)
    ? { state: 'derived', source: '最近5分钟应用 PSS 线性回归（至少60秒）', scope: 'app' }
    : { state: 'unavailable', reason: '至少需要60秒有效 PSS 数据' };
  if (Number.isFinite(state.startupTime)) {
    compact.startupTime = state.startupTime;
    compact.quality.startupTime = state.startupQuality;
  }
  for (const event of sample.events || []) appendEvent({ ...event, elapsed: compact.elapsed });
  for (const event of core.evaluateAnomalies(compact, state.anomalyTracker)) appendEvent(event);
  state.samples.push(compact);
  if (state.samples.length > MAX_RAW_SAMPLES) state.samples.shift();
  renderEvents();
  updateDashboard();
}

$$('[data-performance-page]').forEach((button) => button.onclick = () => switchPage(button.dataset.performancePage));
$$('.metric-options input').forEach((input) => input.onchange = updateActionState);
$('#performance-toggle-all').onclick = () => {
  const all = $$('.metric-options input');
  const checked = all.every((input) => input.checked);
  all.forEach((input) => { input.checked = !checked; });
  $('#performance-toggle-all').textContent = checked ? '全选' : '取消全选';
  updateActionState();
};
$('#performance-refresh').onclick = refreshDevices;
$('#performance-device').onchange = updateActionState;
$('#performance-package').oninput = () => { state.startupTime = null; state.startupQuality = null; updateActionState(); };
$('#performance-start').onclick = startTest;
$('#performance-stop').onclick = stopTest;
$('#performance-detect-app').onclick = async () => {
  try {
    const result = await api.getForegroundApp($('#performance-device').value);
    $('#performance-package').value = result.packageName;
    state.startupTime = null;
    updateActionState();
    toast(`已读取当前应用：${result.packageName}`);
  } catch (error) { toast(error.message || String(error)); }
};
$('#performance-launch').onclick = async () => {
  try {
    const result = await api.launchApp($('#performance-device').value, $('#performance-package').value.trim());
    state.startupTime = result.totalTime;
    state.startupQuality = Number.isFinite(result.totalTime) ? { state: 'measured', source: result.source, scope: 'app' } : { state: 'unavailable', reason: '设备未返回 ActivityManager TotalTime' };
    appendEvent({ type: 'cold-start', level: 'info', label: Number.isFinite(result.totalTime) ? `App 冷启动 ${result.totalTime} ms` : 'App 已执行冷启动', packageName: $('#performance-package').value.trim() });
    renderEvents();
    toast(result.totalTime ? `应用冷启动耗时 ${result.totalTime} ms` : '应用已启动，设备未返回耗时');
    updateDashboard();
  } catch (error) { toast(error.message || String(error)); }
};
$('#report-name-form').onsubmit = async (event) => {
  event.preventDefault();
  try {
    const report = createReport($('#report-name').value.trim(), $('#report-note').value.trim());
    const saved = await api.saveReport(report);
    state.reportCache.set(saved.id, { ...report, id: saved.id, type: 'android-performance-report' });
    $('#report-name-modal').hidden = true;
    $('#report-note').value = '';
    state.startupTime = null;
    state.startupQuality = null;
    await loadReports();
    switchPage('history');
    toast('性能报告已保存');
  } catch (error) { toast(`报告保存失败：${error.message || error}`); }
};
$('#report-discard').onclick = () => { $('#report-name-modal').hidden = true; state.samples = []; state.events = []; state.startupTime = null; state.startupQuality = null; toast('本次测试未保存'); };
$('#report-import').onclick = () => $('#report-import-input').click();
$('#report-import-input').onchange = async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try { await importReport(file); } catch (error) { toast(`导入失败：${error.message}`); }
  event.target.value = '';
};
$('#compare-run').onclick = runComparison;
$('#compare-metric').onchange = drawComparison;
$('#compare-export').onclick = exportComparison;
window.addEventListener('resize', () => { if (state.samples.length) updateDashboard(); if (state.comparison) drawComparison(); });

async function initialize() {
  renderReports();
  updateActionState();
  if (!api) return toast('请通过 Test cat 本地预览入口运行安卓性能监控');
  api.onSample(handleSample);
  api.onStatus((status) => {
    const node = $('#performance-status');
    node.dataset.phase = status.phase || 'idle';
    node.querySelector('span').textContent = status.message || '等待开始';
    if (status.packageName) {
      $('#performance-package').value = status.packageName;
      if (state.config) state.config.packageName = status.packageName;
    }
  });
  await Promise.allSettled([loadReports(), refreshDevices()]);
}

initialize();
