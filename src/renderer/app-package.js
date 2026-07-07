const api = window.testCat?.appPackage;

const state = {
  current: null,
  compare: null,
  devices: [],
  installedPackages: [],
  selectedInstalled: '',
  busy: false
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

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
  toast.timer = setTimeout(() => node.classList.remove('show'), 2400);
}

function friendlyError(error, fallback = '操作失败') {
  return String(error?.message || error || fallback).replace(/^Error invoking remote method '[^']+':\s*/i, '').trim() || fallback;
}

function setStatus(text, phase = '') {
  const node = $('#title-status');
  node.classList.toggle('working', phase === 'working');
  node.classList.toggle('done', phase === 'done');
  node.classList.toggle('error', phase === 'error');
  node.querySelector('span').textContent = text;
}

function field(label, value) {
  return '<div class="info-card"><span>' + escapeHtml(label) + '</span><strong title="' + escapeHtml(value || '—') + '">' + escapeHtml(value || '—') + '</strong></div>';
}

function displayPackagePath(info) {
  return info?.fileName ? '本机路径已隐藏 · ' + info.fileName : '本机路径已隐藏';
}

function renderPackage(info) {
  const disabled = !info || info.type !== 'apk';
  $('#install-button').disabled = disabled;
  if (!info) return;
  $('#package-summary').innerHTML =
    '<div class="summary-head"><div><h1>' + escapeHtml(info.appName || info.fileName) + '</h1><p>' + escapeHtml(displayPackagePath(info)) + '</p></div><span class="type-badge">' + escapeHtml(info.type) + '</span></div>' +
    '<div class="summary-kpis">' +
      '<div><span>包名</span><strong title="' + escapeHtml(info.packageName) + '">' + escapeHtml(info.packageName || '—') + '</strong></div>' +
      '<div><span>版本</span><strong>' + escapeHtml(info.versionName || '—') + '</strong></div>' +
      '<div><span>versionCode / Build</span><strong>' + escapeHtml(info.versionCode || '—') + '</strong></div>' +
      '<div><span>文件大小</span><strong>' + escapeHtml(info.fileSizeText || '—') + '</strong></div>' +
    '</div>';

  $('#info-grid').innerHTML = [
    field('文件名', info.fileName),
    field('包类型', info.type.toUpperCase()),
    field('应用名', info.appName),
    field('包名 / Bundle ID', info.packageName),
    field('版本名', info.versionName),
    field('版本号', info.versionCode),
    field(info.type === 'apk' ? 'minSdk' : '最低 iOS', info.minSdk),
    field('targetSdk', info.targetSdk),
    field('Debuggable', info.debuggable ? '是' : '否'),
    field('签名状态', info.signature?.signed ? '已签名' : '未识别签名'),
    field('签名方案', (info.signature?.schemes || []).join('、')),
    field('SHA256', info.sha256)
  ].join('');

  const permissions = info.permissions || [];
  $('#permission-box').innerHTML = permissions.length
    ? '<b>权限列表（' + permissions.length + '）</b>' + permissions.map((item) => '<div>' + escapeHtml(item) + '</div>').join('')
    : '<b>权限列表</b><div>未读取到权限，或当前安装包没有声明权限。</div>';
}

async function inspectFilePath(filePath) {
  if (!api) return toast('安装包管理能力未初始化');
  try {
    setStatus('正在解析安装包', 'working');
    state.current = await api.inspectPackage(filePath);
    state.compare = null;
    renderPackage(state.current);
    renderCompare();
    setStatus('安装包解析完成', 'done');
    toast('安装包信息已读取');
  } catch (error) {
    setStatus('解析失败', 'error');
    toast(friendlyError(error, '安装包解析失败'));
  }
}

async function selectPackage() {
  if (!api) return toast('安装包管理能力未初始化');
  try {
    const info = await api.selectPackage();
    if (!info) return;
    state.current = info;
    state.compare = null;
    renderPackage(info);
    renderCompare();
    setStatus('安装包解析完成', 'done');
  } catch (error) {
    setStatus('解析失败', 'error');
    toast(friendlyError(error, '安装包解析失败'));
  }
}

function selectedSerials() {
  return $$('.device-item input:checked').map((input) => input.value);
}

function primaryDeviceSerial() {
  return $('#installed-device').value || selectedSerials()[0] || '';
}

function renderDevices() {
  const list = $('#device-list');
  $('#device-empty').hidden = state.devices.length > 0;
  list.hidden = state.devices.length === 0;
  list.innerHTML = state.devices.map((device) => {
    const ok = device.state === 'device';
    return '<label class="device-item">' +
      '<input type="checkbox" value="' + escapeHtml(device.serial) + '"' + (ok ? ' checked' : ' disabled') + ' />' +
      '<div><strong>' + escapeHtml(device.model || device.serial) + '</strong><span>' + escapeHtml(device.serial) + '</span></div>' +
      '<em class="device-state ' + (ok ? '' : 'bad') + '">' + escapeHtml(device.state) + '</em>' +
    '</label>';
  }).join('');
  renderInstalledDeviceOptions();
}

function renderInstalledDeviceOptions() {
  const select = $('#installed-device');
  const previous = select.value;
  const online = state.devices.filter((device) => device.state === 'device');
  select.innerHTML = online.length
    ? online.map((device) => '<option value="' + escapeHtml(device.serial) + '">' + escapeHtml(device.model || device.serial) + ' · ' + escapeHtml(device.serial) + '</option>').join('')
    : '<option value="">暂无在线设备</option>';
  select.value = online.some((device) => device.serial === previous) ? previous : (online[0]?.serial || '');
}

async function refreshDevices() {
  if (!api) return toast('安装包管理能力未初始化');
  try {
    setStatus('正在查找设备', 'working');
    state.devices = await api.listDevices();
    renderDevices();
    setStatus(state.devices.length ? '设备列表已更新' : '未检测到设备', state.devices.length ? 'done' : 'error');
  } catch (error) {
    setStatus('设备刷新失败', 'error');
    toast(friendlyError(error, '设备刷新失败，请确认已安装 ADB'));
  }
}

function renderResults(results = []) {
  $('#result-list').innerHTML = results.map((item) => (
    '<div class="result-item ' + (item.ok ? '' : 'fail') + '">' +
      '<strong>' + escapeHtml(item.serial) + ' · ' + (item.ok ? '成功' : '失败') + '</strong>' +
      '<span>' + escapeHtml(item.ok ? (item.output || '操作完成') : item.message) + '</span>' +
    '</div>'
  )).join('');
}

function filteredInstalledPackages() {
  const keyword = $('#installed-search').value.trim().toLowerCase();
  return state.installedPackages.filter((item) => !keyword || item.packageName.toLowerCase().includes(keyword));
}

function renderInstalledPackages() {
  const list = $('#installed-list');
  const rows = filteredInstalledPackages();
  $('#installed-empty').hidden = rows.length > 0;
  if (!rows.length) {
    $('#installed-empty').textContent = state.installedPackages.length
      ? '没有匹配的安装包，请换个关键字。'
      : '请选择一台在线设备，然后点击“读取安装包”。';
  }
  list.hidden = rows.length === 0;
  list.innerHTML = rows.map((item) => (
    '<button class="installed-item ' + (state.selectedInstalled === item.packageName ? 'active' : '') + '" data-package="' + escapeHtml(item.packageName) + '">' +
      '<div><strong>' + escapeHtml(item.packageName) + '</strong><span>' + escapeHtml(item.apkPath || '路径不可用') + '</span></div>' +
      '<em>' + escapeHtml(item.versionCode ? 'vCode ' + item.versionCode : (item.system ? '系统应用' : '第三方')) + '</em>' +
    '</button>'
  )).join('');
  list.querySelectorAll('.installed-item').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedInstalled = button.dataset.package;
      renderInstalledPackages();
    });
  });
  const selected = Boolean(state.selectedInstalled);
  $('#clear-selected').disabled = !selected;
  $('#uninstall-selected').disabled = !selected;
}

async function loadInstalledPackages() {
  const serial = primaryDeviceSerial();
  if (!serial) return toast('请先选择一台在线设备');
  try {
    setStatus('正在读取设备安装包', 'working');
    state.selectedInstalled = '';
    state.installedPackages = await api.listInstalled({ serial, includeSystem: $('#include-system').checked });
    renderInstalledPackages();
    setStatus('设备安装包读取完成', 'done');
    toast('已读取 ' + state.installedPackages.length + ' 个安装包');
  } catch (error) {
    setStatus('读取安装包失败', 'error');
    toast(friendlyError(error, '读取设备安装包失败'));
  }
}

async function runInstalledAction(name, action) {
  const serial = primaryDeviceSerial();
  const packageName = state.selectedInstalled;
  if (!serial) return toast('请先选择一台在线设备');
  if (!packageName) return toast('请先选中一个设备上的安装包');
  if (state.busy) return;
  state.busy = true;
  try {
    setStatus('正在' + name, 'working');
    const results = await action(serial, packageName);
    renderResults(results);
    setStatus(name + '完成', results.every((item) => item.ok) ? 'done' : 'error');
    if (results.every((item) => item.ok) && name === '卸载') {
      state.installedPackages = state.installedPackages.filter((item) => item.packageName !== packageName);
      state.selectedInstalled = '';
      renderInstalledPackages();
    }
  } catch (error) {
    setStatus(name + '失败', 'error');
    toast(friendlyError(error, name + '失败'));
  } finally {
    state.busy = false;
  }
}

async function runAction(name, runner) {
  if (state.busy) return;
  const serials = selectedSerials();
  if (!serials.length) return toast('请选择至少一台在线设备');
  state.busy = true;
  try {
    setStatus('正在' + name, 'working');
    const results = await runner(serials);
    renderResults(results);
    setStatus(name + '完成', results.every((item) => item.ok) ? 'done' : 'error');
  } catch (error) {
    setStatus(name + '失败', 'error');
    toast(friendlyError(error, name + '失败'));
  } finally {
    state.busy = false;
  }
}

async function chooseComparePackage() {
  if (!api) return toast('安装包管理能力未初始化');
  try {
    const info = await api.selectPackage();
    if (!info) return;
    state.compare = info;
    renderCompare();
  } catch (error) {
    toast(friendlyError(error, '对比包解析失败'));
  }
}

function compareRows(left, right) {
  const pairs = [
    ['packageName', '包名'],
    ['appName', '应用名'],
    ['versionName', '版本名'],
    ['versionCode', '版本号'],
    ['minSdk', '最低系统'],
    ['targetSdk', '目标系统'],
    ['sha256', '文件 SHA256']
  ];
  return pairs.map(([key, label]) => ({
    label,
    left: left?.[key] || '',
    right: right?.[key] || '',
    changed: String(left?.[key] || '') !== String(right?.[key] || '')
  }));
}

function renderCompare() {
  const node = $('#compare-result');
  if (!state.current) {
    node.innerHTML = '<div class="empty-box">先选择一个安装包，再选择对比包。</div>';
    return;
  }
  if (!state.compare) {
    node.innerHTML = '<div class="empty-box">已选择主包。点击“选择对比包”后查看差异。</div>';
    return;
  }
  node.innerHTML = compareRows(state.current, state.compare).map((row) => (
    '<div class="compare-row ' + (row.changed ? 'changed' : '') + '">' +
      '<span>' + escapeHtml(row.label) + '</span>' +
      '<div><strong title="' + escapeHtml(row.left || '—') + '">主包：' + escapeHtml(row.left || '—') + '</strong>' +
      '<strong title="' + escapeHtml(row.right || '—') + '">对比：' + escapeHtml(row.right || '—') + '</strong></div>' +
    '</div>'
  )).join('');
}

$('#package-picker').addEventListener('click', selectPackage);
$('#refresh-devices').addEventListener('click', refreshDevices);
$('#compare-picker').addEventListener('click', chooseComparePackage);
$('#load-installed').addEventListener('click', loadInstalledPackages);
$('#include-system').addEventListener('change', () => {
  state.installedPackages = [];
  state.selectedInstalled = '';
  renderInstalledPackages();
});
$('#installed-device').addEventListener('change', () => {
  state.installedPackages = [];
  state.selectedInstalled = '';
  renderInstalledPackages();
});
$('#installed-search').addEventListener('input', renderInstalledPackages);
$('#install-button').addEventListener('click', () => runAction('安装', (serials) => api.install({
  serials,
  filePath: state.current?.filePath,
  allowDowngrade: $('#allow-downgrade').checked,
  grantPermissions: $('#grant-permissions').checked,
  replace: $('#replace-existing').checked
})));
$('#clear-selected').addEventListener('click', () => runInstalledAction('清数据', (serial, packageName) => api.clearData({ serials: [serial], packageName })));
$('#uninstall-selected').addEventListener('click', () => runInstalledAction('卸载', (serial, packageName) => api.uninstall({ serials: [serial], packageName })));

for (const target of [document.body, $('#package-picker')]) {
  target.addEventListener('dragover', (event) => {
    event.preventDefault();
    $('#package-picker').classList.add('dragover');
  });
  target.addEventListener('dragleave', () => $('#package-picker').classList.remove('dragover'));
  target.addEventListener('drop', (event) => {
    event.preventDefault();
    $('#package-picker').classList.remove('dragover');
    const [file] = event.dataTransfer.files;
    if (!file) return;
    const filePath = api.pathForFile(file);
    inspectFilePath(filePath);
  });
}

document.body.dataset.platform = window.testCat?.platform || '';
renderCompare();
renderInstalledPackages();
refreshDevices();
