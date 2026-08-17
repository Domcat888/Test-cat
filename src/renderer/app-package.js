const api = window.testCat?.appPackage;
const requestedPlatform = new URLSearchParams(window.location.search).get('platform');

const state = {
  current: null,
  compare: null,
  devices: [],
  installedPackages: [],
  selectedInstalled: '',
  platform: 'android',
  lockedPlatform: ['ios', 'android'].includes(requestedPlatform) ? requestedPlatform : 'android',
  deviceRequestId: 0,
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

function field(label, value, className = '') {
  return '<div class="info-card ' + escapeHtml(className) + '"><span>' + escapeHtml(label) + '</span><strong title="' + escapeHtml(value || '—') + '">' + escapeHtml(value || '—') + '</strong></div>';
}

function upperHash(value) {
  return value ? String(value).toUpperCase() : '';
}

function certificateMd5(info) {
  const values = (info.signature?.certificates || []).map((item) => upperHash(item.md5)).filter(Boolean);
  if (values.length) return values.join(' / ');
  if (info.signature?.signed) return '已签名，但当前安装包未包含可直接读取的 v1 证书 MD5';
  return '';
}

function displayPackagePath(info) {
  return info?.fileName ? '本机路径已隐藏 · ' + info.fileName : '本机路径已隐藏';
}

function renderPackage(info) {
  $('#install-button').disabled = !info;
  if (!info) return;
  $('#package-summary').innerHTML =
    '<div class="summary-head"><div><h1>' + escapeHtml(info.appName || info.fileName) + '</h1><p>' + escapeHtml(displayPackagePath(info)) + '</p></div><span class="type-badge">' + escapeHtml(info.type) + '</span></div>' +
    '<div class="summary-kpis">' +
      '<div><span>包名</span><strong title="' + escapeHtml(info.packageName) + '">' + escapeHtml(info.packageName || '—') + '</strong></div>' +
      '<div><span>版本</span><strong>' + escapeHtml(info.versionName || '—') + '</strong></div>' +
      '<div><span>versionCode / Build</span><strong>' + escapeHtml(info.versionCode || '—') + '</strong></div>' +
      '<div><span>文件大小</span><strong>' + escapeHtml(info.fileSizeText || '—') + '</strong></div>' +
      '<div><span>文件 MD5</span><strong title="' + escapeHtml(upperHash(info.md5)) + '">' + escapeHtml(upperHash(info.md5) || '—') + '</strong></div>' +
    '</div>';

  const commonFields = [
    field('文件名', info.fileName),
    field('文件大小', info.fileSizeText),
    field('文件 MD5', upperHash(info.md5), 'hash-card'),
    field('文件 SHA1', upperHash(info.sha1), 'hash-card'),
    field('文件 SHA256', upperHash(info.sha256), 'hash-card'),
    field('包类型', info.type.toUpperCase()),
    field('应用名', info.appName),
    field('包名 / Bundle ID', info.packageName),
    field('版本名', info.versionName),
    field('内部版本号 / versionCode', info.versionCode),
    field(info.type === 'apk' ? 'Min SDK' : '最低 iOS', info.type === 'apk' ? (info.minSdkLabel || info.minSdk) : info.minSdk),
    field('签名状态', info.signature?.signed ? '已签名' : '未识别签名'),
    field('签名方案', (info.signature?.schemes || []).join('、'))
  ];
  if (info.type === 'apk') {
    commonFields.push(
      field('Target SDK', info.targetSdkLabel || info.targetSdk),
      field('Debuggable', info.debuggable ? '是' : '否'),
      field('证书 MD5', certificateMd5(info), 'hash-card')
    );
  }
  $('#info-grid').innerHTML = commonFields.join('');

  const permissions = info.permissions || [];
  $('#permission-box').innerHTML = permissions.length
    ? '<b>权限列表（' + permissions.length + '）</b>' + permissions.map((item) => '<div>' + escapeHtml(item) + '</div>').join('')
    : info.type === 'ipa'
      ? '<b>权限说明</b><div>IPA 不使用 Android 权限清单；当前版本暂不展开隐私用途描述。</div>'
      : '<b>权限列表</b><div>未读取到权限，或当前安装包没有声明权限。</div>';
}

function clearSelectedPackage() {
  state.current = null;
  state.compare = null;
  $('#install-button').disabled = true;
  $('#package-summary').innerHTML = '<div class="empty-copy"><b>先选一个' + (state.lockedPlatform === 'ios' ? ' IPA' : ' APK') + '</b><span>会自动读取包名、版本、签名、SDK 和文件指纹。</span></div>';
  $('#info-grid').innerHTML = '';
  $('#permission-box').innerHTML = '';
  $('#result-list').innerHTML = '';
  renderCompare();
}

function assertAllowedPackage(info) {
  if (state.lockedPlatform === 'ios' && info?.type !== 'ipa') throw new Error('IPA 管理仅支持 .ipa 文件，请选择 iOS 安装包。');
  if (state.lockedPlatform === 'android' && info?.type !== 'apk') throw new Error('APK 管理仅支持 .apk 文件，请选择 Android 安装包。');
  return info;
}

function updateWindowCopy() {
  const iosOnly = state.lockedPlatform === 'ios';
  document.title = iosOnly ? 'IPA 管理 - Test cat' : 'APK 管理 - Test cat';
  $('.package-brand strong').textContent = iosOnly ? 'IPA 管理' : 'APK 管理';
  $('.package-brand span').textContent = iosOnly ? 'Test cat · iOS App Lab' : 'Test cat · Android APK Lab';
  $('#package-picker strong').textContent = iosOnly ? '选择 IPA' : '选择 APK';
  $('#package-picker small').textContent = iosOnly ? '选择已签名 IPA，也可以直接拖到这里' : '选择 Android APK，也可以直接拖到这里';
}

function setPlatform(platform) {
  state.platform = platform === 'ios' ? 'ios' : 'android';
  const ios = state.platform === 'ios';
  $('#device-title').textContent = ios ? 'iPhone 设备' : 'Android 设备';
  $('#device-copy').textContent = ios ? '支持已签名 IPA 安装、应用读取和卸载' : '支持多设备批量安装、卸载和清数据';
  $('#install-title').textContent = ios ? 'IPA 安装' : 'APK 安装';
  $('#install-copy').textContent = ios ? '把当前选择的已签名 IPA 安装到选中 iPhone' : '把当前选择的 APK 安装到选中设备';
  $('#install-button').textContent = ios ? '安装 IPA 到选中 iPhone' : '安装 APK 到选中设备';
  $('#android-install-options').hidden = ios;
  $('#clear-selected').hidden = ios;
  $('#installed-copy').textContent = ios
    ? '读取选中 iPhone 的 App，选中后可卸载；iOS 不支持电脑直接清除单个 App 数据'
    : '读取选中设备上的应用，选中后可清除数据或卸载';
  $('#device-empty').textContent = ios
    ? '未检测到 iPhone。请连接数据线、解锁手机并信任此电脑。Windows 还需要 Apple Devices 或 iTunes 驱动。'
    : '未检测到设备，请连接 Android 并开启 USB 调试。';
  state.devices = [];
  state.installedPackages = [];
  state.selectedInstalled = '';
  renderDevices();
  renderInstalledPackages();
}

function applyPackagePlatform(info) {
  const platform = info?.type === 'ipa' ? 'ios' : 'android';
  if (state.platform !== platform) setPlatform(platform);
}

async function inspectFilePath(filePath) {
  if (!api) return toast('安装包管理能力未初始化');
  try {
    setStatus('正在解析安装包', 'working');
    state.current = assertAllowedPackage(await api.inspectPackage(filePath));
    state.compare = null;
    applyPackagePlatform(state.current);
    renderPackage(state.current);
    renderCompare();
    setStatus('安装包解析完成', 'done');
    toast('安装包信息已读取');
    refreshDevices();
  } catch (error) {
    setStatus('解析失败', 'error');
    toast(friendlyError(error, '安装包解析失败'));
  }
}

async function selectPackage() {
  if (!api) return toast('安装包管理能力未初始化');
  try {
    const info = assertAllowedPackage(await api.selectPackage({ platform: state.lockedPlatform || state.platform }));
    if (!info) return;
    state.current = info;
    state.compare = null;
    applyPackagePlatform(info);
    renderPackage(info);
    renderCompare();
    setStatus('安装包解析完成', 'done');
    refreshDevices();
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
    const platformLabel = device.platform === 'ios' ? 'iOS' : 'Android';
    return '<label class="device-item">' +
      '<input type="checkbox" value="' + escapeHtml(device.serial) + '"' + (ok ? ' checked' : ' disabled') + ' />' +
      '<div><strong>' + escapeHtml(device.model || device.serial) + '</strong><span>' + escapeHtml(device.serial) + '</span></div>' +
      '<em class="device-state ' + (ok ? '' : 'bad') + '">' + platformLabel + ' · ' + escapeHtml(device.state) + '</em>' +
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
  const platform = state.platform;
  const requestId = ++state.deviceRequestId;
  try {
    setStatus('正在查找设备', 'working');
    const devices = await api.listDevices({ platform });
    if (requestId !== state.deviceRequestId || platform !== state.platform) return;
    state.devices = devices;
    renderDevices();
    setStatus(state.devices.length ? '设备列表已更新' : '未检测到设备', state.devices.length ? 'done' : 'error');
  } catch (error) {
    if (requestId !== state.deviceRequestId || platform !== state.platform) return;
    setStatus('设备刷新失败', 'error');
    toast(friendlyError(error, platform === 'ios' ? 'iPhone 刷新失败，请检查连接和 Apple 驱动' : '设备刷新失败，请确认 ADB 可用'));
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
      : '请选择一台在线设备，然后点击“读取应用”。';
  }
  list.hidden = rows.length === 0;
  list.innerHTML = rows.map((item) => (
    '<button class="installed-item ' + (state.selectedInstalled === item.packageName ? 'active' : '') + '" data-package="' + escapeHtml(item.packageName) + '">' +
      '<div><strong>' + escapeHtml(item.appName || item.packageName) + '</strong><span>' + escapeHtml(item.platform === 'ios' ? item.packageName : (item.apkPath || item.packageName)) + '</span></div>' +
      '<em>' + escapeHtml(item.platform === 'ios'
        ? (item.versionName ? 'v' + item.versionName + (item.versionCode ? ' (' + item.versionCode + ')' : '') : '用户 App')
        : (item.versionCode ? 'vCode ' + item.versionCode : (item.system ? '系统应用' : '第三方'))) + '</em>' +
    '</button>'
  )).join('');
  list.querySelectorAll('.installed-item').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedInstalled = button.dataset.package;
      renderInstalledPackages();
    });
  });
  const selectedItem = state.installedPackages.find((item) => item.packageName === state.selectedInstalled);
  const selected = Boolean(selectedItem);
  $('#clear-selected').disabled = !selected || state.platform === 'ios';
  $('#uninstall-selected').disabled = !selected || Boolean(state.platform === 'ios' && selectedItem.system);
  $('#uninstall-selected').title = state.platform === 'ios' && selectedItem?.system ? 'iOS 系统 App 不支持卸载' : '';
}

async function loadInstalledPackages() {
  const serial = primaryDeviceSerial();
  if (!serial) return toast('请先选择一台在线设备');
  try {
    setStatus('正在读取设备安装包', 'working');
    state.selectedInstalled = '';
    state.installedPackages = await api.listInstalled({ serial, platform: state.platform, includeSystem: $('#include-system').checked });
    renderInstalledPackages();
    setStatus('设备安装包读取完成', 'done');
    toast('已读取 ' + state.installedPackages.length + ' 个应用');
  } catch (error) {
    setStatus('读取应用失败', 'error');
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
    const allOk = results.every((item) => item.ok);
    setStatus(allOk ? name + '完成' : name + '失败', allOk ? 'done' : 'error');
    if (!allOk) toast(results.find((item) => !item.ok)?.message || (name + '失败'));
    if (allOk && name === '卸载') {
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
    const info = assertAllowedPackage(await api.selectPackage({ platform: state.lockedPlatform || state.platform }));
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
    ['md5', '文件 MD5'],
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
$('#clear-selected').addEventListener('click', () => runInstalledAction('清数据', (serial, packageName) => api.clearData({ serials: [serial], packageName, platform: state.platform })));
$('#uninstall-selected').addEventListener('click', () => runInstalledAction('卸载', (serial, packageName) => api.uninstall({ serials: [serial], packageName, platform: state.platform })));

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
api?.onPlatform((platform) => {
  const nextPlatform = platform === 'ios' ? 'ios' : 'android';
  const packageMatches = !state.current || (nextPlatform === 'ios' ? state.current.type === 'ipa' : state.current.type === 'apk');
  state.lockedPlatform = nextPlatform;
  updateWindowCopy();
  if (!packageMatches) clearSelectedPackage();
  if (state.platform !== state.lockedPlatform) setPlatform(state.lockedPlatform);
  refreshDevices();
});
setPlatform(state.lockedPlatform);
updateWindowCopy();
renderCompare();
renderInstalledPackages();
refreshDevices();
