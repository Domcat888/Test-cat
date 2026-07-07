const api = window.testCat?.logAnalysis;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
document.body.dataset.platform = window.testCat?.platform || 'browser';

const elements = {
  device: $('#log-device'), refresh: $('#log-refresh'), packageName: $('#log-package'), foreground: $('#log-foreground'),
  clearDevice: $('#log-clear-device'), start: $('#log-start'), stop: $('#log-stop'), keyword: $('#log-keyword'),
  interfaceName: $('#log-interface'), playerId: $('#log-player'), level: $('#log-level'), follow: $('#log-follow'),
  pause: $('#log-pause'), clearView: $('#log-clear-view'), list: $('#log-list'), empty: $('#log-empty'), issueList: $('#issue-list'),
  issueEmpty: $('#issue-empty'), visibleCount: $('#visible-count'), totalCount: $('#total-count'), crashCount: $('#crash-count'),
  anrCount: $('#anr-count'), errorCount: $('#error-count'), issueCount: $('#issue-count'), displayNote: $('#display-note'),
  streamBadge: $('#stream-badge'), titleStatus: $('.title-status'), titleStatusText: $('#title-status-text'),
  exportScope: $('#export-scope'), exportFormat: $('#export-format'), copyButton: $('#log-copy'), exportButton: $('#log-export'), toast: $('#log-toast')
};

const LEVEL_RANK = { V: 0, D: 1, I: 2, W: 3, E: 4, F: 5 };
const MAX_RECORDS = 30000;
const MAX_RENDER_ROWS = 2500;
const MAX_ISSUES = 400;
let records = [];
let issues = [];
let issueKeys = new Set();
let activeKind = 'all';
let streaming = false;
let paused = false;
let renderTimer = null;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => elements.toast.classList.remove('show'), 2300);
}

function filterTerms() {
  return [elements.keyword.value, elements.interfaceName.value, elements.playerId.value].map((value) => value.trim()).filter(Boolean);
}

function packageMatches(record) {
  const packageName = elements.packageName.value.trim().toLowerCase();
  if (!packageName) return true;
  return record.processName?.toLowerCase().startsWith(packageName)
    || record.raw.toLowerCase().includes(packageName);
}

function recordMatches(record) {
  if (!packageMatches(record)) return false;
  const minimum = elements.level.value;
  if (minimum !== 'all' && (LEVEL_RANK[record.level] ?? -1) < LEVEL_RANK[minimum]) return false;
  if (activeKind !== 'all' && record.kind !== activeKind) return false;
  const haystack = `${record.raw}\n${record.processName}`.toLowerCase();
  return filterTerms().every((term) => haystack.includes(term.toLowerCase()));
}

function filteredRecords() {
  return records.filter(recordMatches);
}

function highlight(value) {
  const terms = filterTerms().sort((a, b) => b.length - a.length);
  if (!terms.length) return escapeHtml(value);
  const pattern = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  if (!pattern) return escapeHtml(value);
  const regex = new RegExp(`(${pattern})`, 'gi');
  return String(value).split(regex).map((part, index) => index % 2 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)).join('');
}

function issueKey(record) {
  return `${record.kind}|${record.pid}|${record.tag}|${record.message.replace(/\d+/g, '#').slice(0, 140)}`;
}

function shouldCreateIssue(record) {
  if (!['crash', 'anr', 'exception', 'error'].includes(record.kind)) return false;
  if (record.kind === 'exception' && /^\s*(?:at\s+|Caused by:|Suppressed:|\.\.\.)/.test(record.message)) return false;
  return true;
}

function rememberIssues(batch) {
  for (const record of batch) {
    if (!shouldCreateIssue(record)) continue;
    const key = issueKey(record);
    if (issueKeys.has(key)) continue;
    issueKeys.add(key);
    issues.push(record);
  }
  if (issues.length > MAX_ISSUES) {
    issues = issues.slice(-MAX_ISSUES);
    issueKeys = new Set(issues.map(issueKey));
  }
}

function renderIssues() {
  const visibleIssues = issues.filter(packageMatches).slice().reverse();
  elements.issueCount.textContent = String(visibleIssues.length);
  elements.issueEmpty.hidden = visibleIssues.length > 0;
  elements.issueList.hidden = visibleIssues.length === 0;
  elements.issueList.innerHTML = visibleIssues.map((record) => `
    <button class="issue-card ${escapeHtml(record.kind)}" data-log-id="${record.id}">
      <span><i>${escapeHtml(record.label)}</i><time>${escapeHtml(record.time || '未提供时间')}</time></span>
      <b title="${escapeHtml(record.tag || record.processName || record.kind)}">${escapeHtml(record.tag || record.processName || record.kind)}</b>
      <p>${escapeHtml(record.message)}</p>
    </button>`).join('');
}

function render() {
  renderTimer = null;
  if (paused) return;
  const filtered = filteredRecords();
  const rendered = filtered.slice(-MAX_RENDER_ROWS);
  const counts = records.filter(packageMatches).reduce((result, record) => {
    if (record.kind === 'crash') result.crash += 1;
    if (record.kind === 'anr') result.anr += 1;
    if (record.kind === 'exception' || record.kind === 'error') result.error += 1;
    return result;
  }, { crash: 0, anr: 0, error: 0 });
  elements.visibleCount.textContent = filtered.length.toLocaleString('zh-CN');
  elements.totalCount.textContent = records.length.toLocaleString('zh-CN');
  elements.crashCount.textContent = counts.crash.toLocaleString('zh-CN');
  elements.anrCount.textContent = counts.anr.toLocaleString('zh-CN');
  elements.errorCount.textContent = counts.error.toLocaleString('zh-CN');
  elements.empty.hidden = records.length > 0;
  elements.list.innerHTML = rendered.map((record) => `
    <div class="log-row kind-${escapeHtml(record.kind)}" data-record-id="${record.id}">
      <span class="log-cell log-time" title="${escapeHtml(record.time)}">${escapeHtml(record.time || '—')}</span>
      <b class="log-cell level-${escapeHtml(record.level)}">${escapeHtml(record.level || '—')}</b>
      <span class="log-cell log-process" title="${escapeHtml(record.processName || record.pid)}">${escapeHtml(record.pid || '—')}${record.processName ? ` · ${escapeHtml(record.processName)}` : ''}</span>
      <span class="log-cell log-tag" title="${escapeHtml(record.tag)}">${escapeHtml(record.tag || '—')}</span>
      <span class="log-cell log-message">${highlight(record.message)}</span>
    </div>`).join('');
  elements.displayNote.textContent = filtered.length > MAX_RENDER_ROWS
    ? `为保证流畅，页面展示最后 ${MAX_RENDER_ROWS.toLocaleString('zh-CN')} 条；导出仍包含全部筛选结果。`
    : streaming ? '日志正在实时更新，筛选条件可以随时调整。' : records.length ? '监听已停止，仍可筛选和导出本次日志。' : '连接设备并点击“开始监听”，日志会实时出现在这里。';
  elements.exportButton.disabled = records.length === 0;
  elements.copyButton.disabled = filtered.length === 0;
  renderIssues();
  if (elements.follow.checked) elements.list.scrollTop = elements.list.scrollHeight;
}

function scheduleRender() {
  if (renderTimer || paused) return;
  renderTimer = setTimeout(render, 100);
}

function setStreaming(value, message = '') {
  streaming = Boolean(value);
  elements.start.disabled = streaming || !elements.device.value;
  elements.stop.disabled = !streaming;
  elements.device.disabled = streaming;
  elements.refresh.disabled = streaming;
  elements.streamBadge.textContent = streaming ? '实时监听中' : '未监听';
  elements.streamBadge.classList.toggle('streaming', streaming);
  elements.titleStatus.classList.toggle('streaming', streaming);
  elements.titleStatus.classList.remove('error');
  elements.titleStatusText.textContent = message || (streaming ? '正在接收实时日志' : '日志监听已停止');
}

async function refreshDevices() {
  if (!api) return;
  const selected = elements.device.value;
  elements.refresh.disabled = true;
  elements.device.innerHTML = '<option value="">正在查找设备…</option>';
  try {
    const devices = await api.listDevices();
    elements.device.innerHTML = '<option value="">请选择设备</option>' + devices.map((device) => `<option value="${escapeHtml(device.serial)}"${device.state !== 'device' ? ' disabled' : ''}>${escapeHtml(device.model)} · ${escapeHtml(device.serial)} · ${device.state === 'device' ? '已就绪' : device.state === 'unauthorized' ? '未授权' : '离线'}</option>`).join('');
    if (devices.some((device) => device.serial === selected && device.state === 'device')) elements.device.value = selected;
    const ready = devices.filter((device) => device.state === 'device');
    if (!elements.device.value && ready.length === 1) elements.device.value = ready[0].serial;
    elements.start.disabled = !elements.device.value;
    elements.titleStatusText.textContent = ready.length ? `发现 ${ready.length} 台可用设备` : '未发现已授权设备';
  } catch (error) {
    elements.device.innerHTML = '<option value="">设备检测失败</option>';
    elements.titleStatus.classList.add('error');
    elements.titleStatusText.textContent = error.message || '设备检测失败';
  } finally {
    elements.refresh.disabled = false;
  }
}

async function startListening() {
  const serial = elements.device.value;
  if (!serial || !api) return;
  records = [];
  issues = [];
  issueKeys.clear();
  render();
  elements.start.disabled = true;
  elements.titleStatusText.textContent = '正在启动 logcat…';
  try {
    await api.start({ serial, packageName: elements.packageName.value.trim(), clearBeforeStart: elements.clearDevice.checked });
    setStreaming(true);
  } catch (error) {
    setStreaming(false);
    elements.titleStatus.classList.add('error');
    elements.titleStatusText.textContent = error.message || '日志监听启动失败';
    toast(error.message || '日志监听启动失败');
  }
}

async function stopListening() {
  try { await api?.stop(); } catch (error) { toast(error.message || '停止监听失败'); }
  setStreaming(false);
  render();
}

async function readForegroundApp() {
  if (!elements.device.value || !api) return toast('请先选择 Android 设备');
  elements.foreground.disabled = true;
  try {
    const packageName = await api.getForegroundApp(elements.device.value);
    elements.packageName.value = packageName;
    scheduleRender();
    toast(`已识别前台 App：${packageName}`);
  } catch (error) {
    toast(error.message || '前台 App 识别失败');
  } finally {
    elements.foreground.disabled = false;
  }
}

async function exportLogs() {
  if (!api || !records.length) return;
  elements.exportButton.disabled = true;
  try {
    const scope = elements.exportScope.value;
    const result = await api.exportLogs({
      scope,
      format: elements.exportFormat.value,
      filter: { packageName: elements.packageName.value.trim(), minimumLevel: elements.level.value, kind: activeKind, terms: filterTerms() }
    });
    if (!result.canceled) toast(`已导出 ${result.count.toLocaleString('zh-CN')} 条日志`);
  } catch (error) {
    toast(error.message || '日志导出失败');
  } finally {
    elements.exportButton.disabled = records.length === 0;
  }
}

elements.refresh.addEventListener('click', refreshDevices);
elements.device.addEventListener('change', () => { elements.start.disabled = streaming || !elements.device.value; });
elements.start.addEventListener('click', startListening);
elements.stop.addEventListener('click', stopListening);
elements.foreground.addEventListener('click', readForegroundApp);
elements.clearView.addEventListener('click', async () => {
  try { await api?.clear(); } catch {}
  records = []; issues = []; issueKeys.clear(); render(); toast('本次已采集日志已清空');
});
elements.pause.addEventListener('click', () => {
  paused = !paused;
  elements.pause.textContent = paused ? '继续显示' : '暂停显示';
  elements.displayNote.textContent = paused ? '页面已暂停刷新，后台仍在继续接收日志。' : '日志显示已恢复。';
  if (!paused) render();
});
for (const input of [elements.keyword, elements.interfaceName, elements.playerId, elements.packageName]) input.addEventListener('input', scheduleRender);
elements.level.addEventListener('change', render);
$$('[data-kind]').forEach((button) => button.addEventListener('click', () => {
  activeKind = button.dataset.kind;
  $$('[data-kind]').forEach((item) => item.classList.toggle('active', item === button));
  render();
}));
elements.issueList.addEventListener('click', (event) => {
  const card = event.target.closest('[data-log-id]');
  if (!card) return;
  const row = elements.list.querySelector(`[data-record-id="${card.dataset.logId}"]`);
  if (!row) return toast('该日志被当前筛选条件隐藏，请调整筛选后查看');
  row.scrollIntoView({ block: 'center' });
  row.animate([{ outline: '2px solid #ff9d55' }, { outline: '2px solid transparent' }], { duration: 1300 });
});
elements.exportButton.addEventListener('click', exportLogs);
elements.copyButton.addEventListener('click', async () => {
  const selected = filteredRecords();
  if (!selected.length) return;
  try {
    await api.copyText(selected.map((record) => record.raw).join('\n'));
    toast(`已复制筛选日志（${selected.length.toLocaleString('zh-CN')} 条，最多 2 MB）`);
  } catch (error) {
    toast(error.message || '日志复制失败');
  }
});

if (api) {
  api.onLogs((batch) => {
    if (!Array.isArray(batch) || !batch.length) return;
    records.push(...batch);
    rememberIssues(batch);
    if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
    scheduleRender();
  });
  api.onStatus((status) => {
    if (status.phase === 'streaming') setStreaming(true, status.message);
    else if (status.phase === 'error') {
      setStreaming(false);
      elements.titleStatus.classList.add('error');
      elements.titleStatusText.textContent = status.message;
      toast(status.message);
    } else if (status.phase === 'idle') setStreaming(false, status.message);
  });
  refreshDevices();
} else {
  elements.titleStatus.classList.add('error');
  elements.titleStatusText.textContent = '请通过“本地预览”入口运行 Test cat';
}

window.addEventListener('beforeunload', () => api?.stop());
render();
