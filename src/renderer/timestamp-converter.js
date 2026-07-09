const api = window.testCat?.timestampConverter;
document.body.dataset.platform = window.testCat?.platform || 'browser';

const $ = (selector) => document.querySelector(selector);

const UNIT_LABELS = {
  second: '秒',
  millisecond: '毫秒',
  microsecond: '微秒',
  nanosecond: '纳秒',
  localDate: '本地日期',
  utcDate: 'UTC 日期'
};

const state = {
  timestampResults: [],
  dateResult: null
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 2200);
}

function setStatus(text, phase = 'done') {
  const node = $('#title-status');
  node.classList.toggle('working', phase === 'working');
  node.classList.toggle('done', phase === 'done');
  node.classList.toggle('error', phase === 'error');
  node.querySelector('span').textContent = text;
}

function pad(value, length = 2) {
  return String(value).padStart(length, '0');
}

function formatLocalInput(date, zone = 'local') {
  const getter = zone === 'utc'
    ? ['getUTCFullYear', 'getUTCMonth', 'getUTCDate', 'getUTCHours', 'getUTCMinutes', 'getUTCSeconds']
    : ['getFullYear', 'getMonth', 'getDate', 'getHours', 'getMinutes', 'getSeconds'];
  const year = date[getter[0]]();
  const month = date[getter[1]]() + 1;
  const day = date[getter[2]]();
  const hour = date[getter[3]]();
  const minute = date[getter[4]]();
  const second = date[getter[5]]();
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

function formatDateTime(date, zone = 'local') {
  const utc = zone === 'utc';
  const year = utc ? date.getUTCFullYear() : date.getFullYear();
  const month = (utc ? date.getUTCMonth() : date.getMonth()) + 1;
  const day = utc ? date.getUTCDate() : date.getDate();
  const hour = utc ? date.getUTCHours() : date.getHours();
  const minute = utc ? date.getUTCMinutes() : date.getMinutes();
  const second = utc ? date.getUTCSeconds() : date.getSeconds();
  const ms = utc ? date.getUTCMilliseconds() : date.getMilliseconds();
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}.${pad(ms, 3)}`;
}

function localTimezoneLabel() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local';
  const minutes = -new Date().getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  return `${zone} UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function relativeText(ms) {
  const delta = ms - Date.now();
  const abs = Math.abs(delta);
  const suffix = delta >= 0 ? '后' : '前';
  if (abs < 1000) return '刚刚';
  const units = [
    ['天', 86400000],
    ['小时', 3600000],
    ['分钟', 60000],
    ['秒', 1000]
  ];
  const [label, size] = units.find(([, value]) => abs >= value);
  return `${Math.round(abs / size)} ${label}${suffix}`;
}

function splitTimestampValues(text) {
  return String(text || '')
    .split(/[\s,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 200);
}

function inferUnit(token) {
  if (token.includes('.')) return 'second';
  const digits = token.replace(/^[+-]/, '').replace(/^0+(?=\d)/, '');
  if (digits.length <= 10) return 'second';
  if (digits.length <= 13) return 'millisecond';
  if (digits.length <= 16) return 'microsecond';
  return 'nanosecond';
}

function integerTimestampToMs(token, unit) {
  const value = BigInt(token);
  const ms = {
    second: value * 1000n,
    millisecond: value,
    microsecond: value / 1000n,
    nanosecond: value / 1000000n
  }[unit];
  const maxDateMs = 8640000000000000n;
  if (ms > maxDateMs || ms < -maxDateMs) throw new Error('超出 JavaScript Date 可表示范围');
  return Number(ms);
}

function decimalTimestampToMs(token, unit) {
  const value = Number(token);
  if (!Number.isFinite(value)) throw new Error('不是有效数字');
  const ms = {
    second: value * 1000,
    millisecond: value,
    microsecond: value / 1000,
    nanosecond: value / 1000000
  }[unit];
  if (!Number.isFinite(ms) || Math.abs(ms) > 8640000000000000) throw new Error('超出 JavaScript Date 可表示范围');
  return Math.trunc(ms);
}

function parseTimestamp(token, selectedUnit) {
  const clean = String(token || '').trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(clean)) throw new Error('只支持纯数字时间戳');
  const unit = selectedUnit === 'auto' ? inferUnit(clean) : selectedUnit;
  const ms = clean.includes('.') ? decimalTimestampToMs(clean, unit) : integerTimestampToMs(clean, unit);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) throw new Error('无法转换成有效日期');
  return buildResult(clean, unit, ms, date);
}

function buildResult(source, unit, ms, date) {
  const second = Math.trunc(ms / 1000);
  const millisecond = Math.trunc(ms);
  return {
    source,
    unit,
    ms,
    second,
    millisecond,
    local: formatDateTime(date, 'local'),
    utc: formatDateTime(date, 'utc') + ' UTC',
    iso: date.toISOString(),
    relative: relativeText(ms)
  };
}

function resultCopyText(result) {
  return [
    `输入：${result.source}`,
    `识别单位：${UNIT_LABELS[result.unit]}`,
    `本地时间：${result.local}`,
    `UTC 时间：${result.utc}`,
    `秒级时间戳：${result.second}`,
    `毫秒级时间戳：${result.millisecond}`,
    `ISO 8601：${result.iso}`,
    `相对当前：${result.relative}`
  ].join('\n');
}

function allTimestampCopyText() {
  return state.timestampResults.map((item, index) => {
    if (item.error) return `#${index + 1} ${item.source}\n错误：${item.error}`;
    return `#${index + 1}\n${resultCopyText(item)}`;
  }).join('\n\n');
}

function renderResultCard(result, index) {
  if (result.error) {
    return `
      <article class="result-card error">
        <div class="result-head">
          <strong>${escapeHtml(result.source)}</strong>
          <div class="result-actions"><span class="unit-pill">解析失败</span></div>
        </div>
        <div class="error-message">${escapeHtml(result.error)}</div>
      </article>`;
  }
  return `
    <article class="result-card">
      <div class="result-head">
        <strong>${escapeHtml(result.source)}</strong>
        <div class="result-actions">
          <span class="unit-pill">${escapeHtml(UNIT_LABELS[result.unit])}</span>
          <button class="copy-mini" type="button" data-copy-result="${index}">复制</button>
        </div>
      </div>
      <div class="result-body">
        <div class="result-row"><span>本地时间</span><strong title="${escapeHtml(result.local)}">${escapeHtml(result.local)}</strong></div>
        <div class="result-row"><span>UTC 时间</span><strong title="${escapeHtml(result.utc)}">${escapeHtml(result.utc)}</strong></div>
        <div class="result-row"><span>秒级时间戳</span><code>${escapeHtml(result.second)}</code></div>
        <div class="result-row"><span>毫秒级时间戳</span><code>${escapeHtml(result.millisecond)}</code></div>
        <div class="result-row"><span>ISO 8601</span><code title="${escapeHtml(result.iso)}">${escapeHtml(result.iso)}</code></div>
        <div class="result-row"><span>相对当前</span><strong>${escapeHtml(result.relative)}</strong></div>
      </div>
    </article>`;
}

function renderTimestampResults() {
  const node = $('#timestamp-results');
  $('#stat-count').textContent = String(state.timestampResults.length);
  $('#copy-timestamp-results').disabled = !state.timestampResults.length;
  if (!state.timestampResults.length) {
    node.innerHTML = '<div class="empty">粘贴时间戳后点击“转换时间戳”。</div>';
    return;
  }
  node.innerHTML = state.timestampResults.map(renderResultCard).join('');
}

function convertTimestampInput() {
  setStatus('正在转换时间戳', 'working');
  const values = splitTimestampValues($('#timestamp-input').value);
  const unit = $('#timestamp-unit').value;
  if (!values.length) {
    state.timestampResults = [];
    renderTimestampResults();
    setStatus('请输入时间戳', 'error');
    toast('先输入一个时间戳');
    return;
  }
  state.timestampResults = values.map((value) => {
    try {
      return parseTimestamp(value, unit);
    } catch (error) {
      return { source: value, error: error.message || '解析失败' };
    }
  });
  renderTimestampResults();
  const failed = state.timestampResults.filter((item) => item.error).length;
  if (failed) {
    setStatus(`转换完成，${failed} 条失败`, 'error');
  } else {
    setStatus(`已转换 ${state.timestampResults.length} 条时间戳`, 'done');
  }
}

function clampDateMilliseconds() {
  const input = $('#date-ms');
  const value = Math.max(0, Math.min(999, Number(input.value) || 0));
  input.value = value;
  return value;
}

function parseDateInput() {
  const value = $('#date-input').value;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new Error('请选择完整日期时间');
  const [, year, month, day, hour, minute, second = '0'] = match;
  const ms = clampDateMilliseconds();
  const parts = [year, month, day, hour, minute, second].map(Number);
  const zone = $('#date-zone').value;
  const date = zone === 'utc'
    ? new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5], ms))
    : new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5], ms);
  if (Number.isNaN(date.getTime())) throw new Error('日期无效');
  const actual = zone === 'utc'
    ? [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
    : [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()];
  if (actual.some((item, index) => item !== parts[index])) throw new Error('日期不存在，请检查年月日和时间');
  return buildResult(value + '.' + pad(ms, 3), zone === 'utc' ? 'utcDate' : 'localDate', date.getTime(), date);
}

function dateCopyText() {
  if (!state.dateResult) return '';
  return resultCopyText(state.dateResult);
}

function renderDateResult() {
  $('#copy-date-result').disabled = !state.dateResult;
  const node = $('#date-output');
  if (!state.dateResult) {
    node.innerHTML = '<div class="empty">选择日期后点击“转换日期”。</div>';
    return;
  }
  node.innerHTML = renderResultCard(state.dateResult, 'date');
}

function convertDateInput() {
  try {
    state.dateResult = parseDateInput();
    renderDateResult();
    setStatus('日期已转换成时间戳', 'done');
  } catch (error) {
    state.dateResult = null;
    renderDateResult();
    setStatus('日期转换失败', 'error');
    toast(error.message || '日期转换失败');
  }
}

function fillCurrentDate() {
  const now = new Date();
  $('#date-input').value = formatLocalInput(now, $('#date-zone').value === 'utc' ? 'utc' : 'local');
  $('#date-ms').value = now.getMilliseconds();
  convertDateInput();
}

function useCurrentTimestamp() {
  $('#timestamp-unit').value = 'millisecond';
  $('#timestamp-input').value = String(Date.now());
  convertTimestampInput();
}

function clearTimestamp() {
  $('#timestamp-input').value = '';
  state.timestampResults = [];
  renderTimestampResults();
  setStatus('已清空时间戳', 'done');
}

async function copyText(text, successMessage = '已复制') {
  if (!text) return;
  try {
    if (api?.copyText) await api.copyText(text);
    else await navigator.clipboard.writeText(text);
    toast(successMessage);
  } catch (error) {
    toast(error.message || '复制失败，请手动复制');
  }
}

function updateNowStats() {
  const now = Date.now();
  $('#stat-timezone').textContent = localTimezoneLabel();
  $('#stat-second').textContent = String(Math.trunc(now / 1000));
  $('#stat-ms').textContent = String(now);
}

$('#parse-timestamp').addEventListener('click', convertTimestampInput);
$('#use-current-timestamp').addEventListener('click', useCurrentTimestamp);
$('#clear-timestamp').addEventListener('click', clearTimestamp);
$('#copy-timestamp-results').addEventListener('click', () => copyText(allTimestampCopyText(), '转换结果已复制'));
$('#convert-date').addEventListener('click', convertDateInput);
$('#fill-current-date').addEventListener('click', fillCurrentDate);
$('#copy-date-result').addEventListener('click', () => copyText(dateCopyText(), '日期转换结果已复制'));
$('#date-zone').addEventListener('change', () => {
  if ($('#date-input').value) convertDateInput();
});
$('#date-ms').addEventListener('change', clampDateMilliseconds);
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-copy-result]');
  if (!button) return;
  if (button.dataset.copyResult === 'date') {
    copyText(dateCopyText(), '日期转换结果已复制');
    return;
  }
  const result = state.timestampResults[Number(button.dataset.copyResult)];
  if (result && !result.error) copyText(resultCopyText(result), '单条结果已复制');
});

updateNowStats();
fillCurrentDate();
useCurrentTimestamp();
setInterval(updateNowStats, 1000);
