import {
  BitmapVideoFrameRenderer,
  WebCodecsVideoDecoder,
  WebGLVideoFrameRenderer
} from '@yume-chan/scrcpy-decoder-webcodecs';

const api = window.testCat?.mobileMirror;
const $ = (selector) => document.querySelector(selector);
document.body.dataset.platform = window.testCat?.platform || 'browser';

const elements = {
  select: $('#mirror-device-select'),
  refresh: $('#mirror-refresh'),
  start: $('#mirror-start'),
  stop: $('#mirror-stop'),
  quality: $('#mirror-quality'),
  fps: $('#mirror-fps'),
  status: $('#mirror-status'),
  statusText: $('#mirror-status-text'),
  canvas: $('#mirror-canvas'),
  placeholder: $('#mirror-placeholder'),
  placeholderTitle: $('#mirror-placeholder-title'),
  placeholderText: $('#mirror-placeholder-text'),
  deviceName: $('#mirror-device-name'),
  resolution: $('#mirror-resolution'),
  orientation: $('#mirror-orientation'),
  screenshot: $('#mirror-screenshot'),
  fullscreen: $('#mirror-fullscreen'),
  focusMode: $('#mirror-focus-mode'),
  viewer: $('#mirror-viewer'),
  alwaysOnTop: $('#mirror-always-on-top'),
  deviceInfoButton: $('#mirror-device-info-button'),
  deviceInfoModal: $('#device-info-modal'),
  deviceInfoClose: $('#device-info-close'),
  deviceInfoPackage: $('#device-info-package'),
  deviceInfoForeground: $('#device-info-foreground'),
  deviceInfoRefresh: $('#device-info-refresh'),
  deviceInfoLoading: $('#device-info-loading'),
  deviceInfoContent: $('#device-info-content'),
  deviceInfoFields: $('#device-info-fields'),
  deviceInfoReport: $('#device-info-report'),
  deviceInfoCopy: $('#device-info-copy'),
  deviceInfoMessage: $('#device-info-message')
};

let decoder = null;
let writer = null;
let writeChain = Promise.resolve();
let isStreaming = false;
let pointerActive = false;
let pendingMove = null;
let moveFrame = 0;
let videoSize = null;
let focusMode = false;
let latestDeviceInfo = null;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function known(value) {
  return value === null || value === undefined || value === '' ? '设备未提供' : String(value);
}

function renderDeviceInfo(info) {
  const model = [info.manufacturer, info.model].filter(Boolean).join(' ');
  const resolution = info.resolution ? `${info.resolution.width} × ${info.resolution.height} px` : '';
  const cpu = info.cpu.model && info.cpu.cores ? `${info.cpu.model}（${info.cpu.cores} 核）` : info.cpu.model || (info.cpu.cores ? `${info.cpu.cores} 核` : '');
  const battery = info.battery.level == null ? '' : `${info.battery.level}% · ${info.battery.status}`;
  const temperature = info.temperature.value == null ? '' : `${info.temperature.value.toFixed(1)} ℃`;
  const networkParts = [info.network.type, info.network.ssid ? `SSID：${info.network.ssid}` : '', info.network.mobileType && info.network.type === '移动网络' ? info.network.mobileType : '', info.network.airplaneMode ? '飞行模式' : '', info.network.vpnActive ? 'VPN' : ''].filter(Boolean);
  const fields = [
    ['手机型号', model, info.deviceCode ? `设备代号：${info.deviceCode}` : ''],
    ['Android 版本', info.androidVersion ? `Android ${info.androidVersion}` : '', info.sdk ? `API ${info.sdk}` : ''],
    ['屏幕分辨率', resolution, info.resolution?.source || ''],
    ['CPU', cpu, 'SoC 与在线核心数'],
    ['内存', info.memory ? `${info.memory.totalGb.toFixed(1)} GB` : '', '系统物理内存总量'],
    ['电量', battery, info.battery.plugged?.length ? info.battery.plugged.join('/') : info.battery.health],
    ['温度', temperature, info.temperature.source || ''],
    ['网络状态', networkParts.join('；'), info.network.ipv4 ? `IPv4：${info.network.ipv4}` : ''],
    ['当前连接设备', `${info.connection.type}（${info.serial}）`, info.connection.devPath || '当前 ADB 目标'],
    ['App 包名', info.app.packageName, info.app.packageName ? '当前前台或手动指定 App' : '保持被测 App 在前台后刷新'],
    ['App 版本号', info.app.versionName, 'versionName'],
    ['versionCode', info.app.versionCode, 'Android 内部版本号']
  ];
  elements.deviceInfoFields.innerHTML = fields.map(([label, value, note]) => `<article class="device-info-field"><span>${escapeHtml(label)}</span><strong title="${escapeHtml(known(value))}">${escapeHtml(known(value))}</strong><small title="${escapeHtml(note)}">${escapeHtml(note || '由设备通过 ADB 返回')}</small></article>`).join('');
  elements.deviceInfoReport.value = info.report || '';
  elements.deviceInfoMessage.textContent = `采集完成 · ${info.collectedAt}`;
  elements.deviceInfoLoading.hidden = true;
  elements.deviceInfoContent.hidden = false;
  elements.deviceInfoCopy.disabled = !info.report;
}

async function loadDeviceInfo({ useForeground = false } = {}) {
  const serial = elements.select.value;
  if (!serial) return;
  if (useForeground) elements.deviceInfoPackage.value = '';
  latestDeviceInfo = null;
  elements.deviceInfoLoading.hidden = false;
  elements.deviceInfoLoading.classList.remove('error');
  elements.deviceInfoLoading.querySelector('b').textContent = '正在读取设备环境信息…';
  elements.deviceInfoLoading.querySelector('small').textContent = '首次读取通常需要几秒钟';
  elements.deviceInfoContent.hidden = true;
  elements.deviceInfoCopy.disabled = true;
  elements.deviceInfoRefresh.disabled = true;
  elements.deviceInfoForeground.disabled = true;
  elements.deviceInfoMessage.textContent = '正在通过 ADB 读取当前设备';
  try {
    const info = await api.getDeviceInfo({ serial, packageName: elements.deviceInfoPackage.value.trim() });
    latestDeviceInfo = info;
    renderDeviceInfo(info);
  } catch (error) {
    elements.deviceInfoLoading.classList.add('error');
    elements.deviceInfoLoading.querySelector('b').textContent = '环境信息读取失败';
    elements.deviceInfoLoading.querySelector('small').textContent = error.message || String(error);
    elements.deviceInfoMessage.textContent = '请确认设备在线并已允许 USB 调试';
  } finally {
    elements.deviceInfoRefresh.disabled = false;
    elements.deviceInfoForeground.disabled = false;
  }
}

function openDeviceInfo() {
  if (!elements.select.value) return;
  elements.deviceInfoModal.hidden = false;
  loadDeviceInfo();
}

function closeDeviceInfo() {
  elements.deviceInfoModal.hidden = true;
}

function setFocusMode(enabled) {
  focusMode = Boolean(enabled);
  document.body.classList.toggle('mirror-focus-active', focusMode);
  elements.focusMode.textContent = focusMode ? '↙ 退出大画面' : '⛶ 大画面';
  elements.focusMode.setAttribute('aria-pressed', String(focusMode));
  requestAnimationFrame(() => fitCanvasToViewer());
}

function fitCanvasToViewer(width = videoSize?.width, height = videoSize?.height) {
  if (!width || !height) return;
  videoSize = { width, height };
  const availableWidth = Math.max(1, elements.viewer.clientWidth - 2);
  const availableHeight = Math.max(1, elements.viewer.clientHeight - 2);
  const scale = Math.min(availableWidth / width, availableHeight / height);
  elements.canvas.style.width = `${Math.max(1, Math.floor(width * scale))}px`;
  elements.canvas.style.height = `${Math.max(1, Math.floor(height * scale))}px`;
  elements.canvas.dataset.orientation = width >= height ? 'landscape' : 'portrait';
  elements.resolution.textContent = `${width} × ${height}`;
  elements.orientation.textContent = width >= height ? '横屏（自动）' : '竖屏（自动）';
}

function setStatus(status) {
  if (!status) return;
  elements.status.dataset.phase = status.phase || 'idle';
  elements.statusText.textContent = status.message || '等待连接';
  const busy = ['scanning', 'deploying', 'starting'].includes(status.phase);
  isStreaming = status.phase === 'streaming';
  elements.start.disabled = busy || isStreaming || !elements.select.value;
  elements.refresh.disabled = busy || isStreaming;
  elements.stop.disabled = !busy && !isStreaming;
  if (status.phase === 'error') showPlaceholder('连接失败', status.message);
}

function showPlaceholder(title, text) {
  elements.placeholder.hidden = false;
  elements.canvas.hidden = true;
  elements.placeholderTitle.textContent = title;
  elements.placeholderText.textContent = text;
}

function disposeDecoder() {
  try { writer?.releaseLock(); } catch {}
  try { decoder?.dispose(); } catch {}
  writer = null;
  decoder = null;
  writeChain = Promise.resolve();
  elements.canvas.hidden = true;
  elements.placeholder.hidden = false;
  elements.canvas.style.removeProperty('width');
  elements.canvas.style.removeProperty('height');
  delete elements.canvas.dataset.orientation;
  videoSize = null;
  elements.resolution.textContent = '—';
  elements.orientation.textContent = '自动跟随';
  setFocusMode(false);
}

function createDecoder(metadata) {
  disposeDecoder();
  if (!WebCodecsVideoDecoder.isSupported) {
    showPlaceholder('当前环境不支持视频解码', '请使用 Test cat 桌面版运行此模块。');
    return;
  }
  const Renderer = WebGLVideoFrameRenderer.isSupported ? WebGLVideoFrameRenderer : BitmapVideoFrameRenderer;
  const renderer = new Renderer(elements.canvas, true);
  decoder = new WebCodecsVideoDecoder({ codec: metadata.codec, renderer });
  writer = decoder.writable.getWriter();
  decoder.sizeChanged(({ width, height }) => {
    if (videoSize?.width === width && videoSize?.height === height) return;
    requestAnimationFrame(() => fitCanvasToViewer(width, height));
  });
  elements.deviceName.textContent = metadata.deviceName || 'Android 设备';
  elements.placeholder.hidden = true;
  elements.canvas.hidden = false;
  setFocusMode(true);
  elements.canvas.focus();
}

function handleStreamMessage(message) {
  if (!message) return;
  switch (message.type) {
    case 'video-meta':
      createDecoder(message.payload);
      break;
    case 'video-packet': {
      if (!writer) return;
      const packet = { ...message.payload, data: new Uint8Array(message.payload.data) };
      writeChain = writeChain.then(() => writer?.write(packet)).catch((error) => {
        showPlaceholder('视频解码失败', error.message || String(error));
      });
      break;
    }
    case 'video-size':
      requestAnimationFrame(() => fitCanvasToViewer(message.payload.width, message.payload.height));
      break;
    case 'video-ended':
      disposeDecoder();
      showPlaceholder('投屏已停止', '选择设备后可以再次一键部署并投屏。');
      break;
    case 'status':
      setStatus(message.payload);
      break;
    case 'control-error':
      setStatus({ phase: 'error', message: message.payload });
      break;
    default:
      break;
  }
}

async function refreshDevices() {
  if (!api) return setStatus({ phase: 'error', message: '安卓投屏服务仅能在 Test cat 桌面版中使用。' });
  elements.select.innerHTML = '<option value="">正在查找设备…</option>';
  elements.select.disabled = true;
  try {
    const devices = await api.listDevices();
    elements.select.innerHTML = '';
    if (!devices.length) {
      elements.select.innerHTML = '<option value="">未发现设备</option>';
      showPlaceholder('连接一台 Android 手机', '开启 USB 调试并连接数据线，然后点击“刷新设备”。');
    } else {
      for (const device of devices) {
        const option = document.createElement('option');
        option.value = device.serial;
        const state = device.state === 'device' ? '已就绪' : device.state === 'unauthorized' ? '等待手机授权' : '离线';
        option.textContent = `${device.model} · ${device.serial} · ${state}`;
        option.disabled = device.state !== 'device';
        elements.select.append(option);
      }
      const firstReady = devices.find((device) => device.state === 'device');
      elements.select.value = firstReady?.serial || '';
      if (!firstReady) showPlaceholder('等待手机授权', '请在手机弹窗中点击“允许 USB 调试”。');
    }
  } catch (error) {
    elements.select.innerHTML = '<option value="">设备检测失败</option>';
    setStatus({ phase: 'error', message: error.message || String(error) });
  } finally {
    elements.select.disabled = false;
    elements.start.disabled = !elements.select.value;
    elements.deviceInfoButton.disabled = !elements.select.value;
  }
}

async function startMirror() {
  if (!elements.select.value) return;
  try {
    await api.start({
      serial: elements.select.value,
      options: {
        maxSize: Number(elements.quality.value),
        maxFps: Number(elements.fps.value)
      }
    });
  } catch (error) {
    setStatus({ phase: 'error', message: error.message || String(error) });
  }
}

async function stopMirror() {
  try { await api?.stop(); } catch (error) {
    setStatus({ phase: 'error', message: error.message || String(error) });
  }
}

function mapPointer(event) {
  const rect = elements.canvas.getBoundingClientRect();
  const width = decoder?.width || elements.canvas.width;
  const height = decoder?.height || elements.canvas.height;
  return {
    x: Math.max(0, Math.min(width - 1, (event.clientX - rect.left) / rect.width * width)),
    y: Math.max(0, Math.min(height - 1, (event.clientY - rect.top) / rect.height * height)),
    width,
    height
  };
}

function sendTouch(action, event) {
  if (!isStreaming || !decoder) return;
  api.sendControl({ kind: 'touch', action, ...mapPointer(event) });
}

elements.canvas.addEventListener('pointerdown', (event) => {
  pointerActive = true;
  elements.canvas.setPointerCapture(event.pointerId);
  elements.canvas.focus();
  sendTouch(0, event);
});
elements.canvas.addEventListener('pointermove', (event) => {
  if (!pointerActive) return;
  pendingMove = event;
  if (!moveFrame) {
    moveFrame = requestAnimationFrame(() => {
      if (pendingMove) sendTouch(2, pendingMove);
      pendingMove = null;
      moveFrame = 0;
    });
  }
});
elements.canvas.addEventListener('pointerup', (event) => {
  pointerActive = false;
  sendTouch(1, event);
});
elements.canvas.addEventListener('pointercancel', (event) => {
  pointerActive = false;
  sendTouch(3, event);
});
elements.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
elements.canvas.addEventListener('keydown', (event) => {
  if (!isStreaming) return;
  const keyCodes = { Enter: 66, Backspace: 67, Escape: 4, ArrowUp: 19, ArrowDown: 20, ArrowLeft: 21, ArrowRight: 22 };
  if (keyCodes[event.key]) {
    api.sendControl({ kind: 'key', keyCode: keyCodes[event.key] });
    event.preventDefault();
  } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
    api.sendControl({ kind: 'text', text: event.key });
    event.preventDefault();
  }
});

document.querySelectorAll('[data-android-key]').forEach((button) => button.addEventListener('click', () => {
  api?.sendControl({ kind: 'key', keyCode: Number(button.dataset.androidKey) });
}));
$('#mirror-rotate').addEventListener('click', () => api?.sendControl({ kind: 'rotate' }));
$('#mirror-screen-off').addEventListener('click', () => api?.sendControl({ kind: 'screen-off' }));
elements.refresh.addEventListener('click', refreshDevices);
elements.start.addEventListener('click', startMirror);
elements.stop.addEventListener('click', stopMirror);
elements.select.addEventListener('change', () => {
  elements.start.disabled = !elements.select.value;
  elements.deviceInfoButton.disabled = !elements.select.value;
});
elements.fullscreen.addEventListener('click', () => elements.viewer.requestFullscreen?.());
elements.focusMode.addEventListener('click', () => setFocusMode(!focusMode));
elements.screenshot.addEventListener('click', async () => {
  const blob = await decoder?.snapshot();
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `test-cat-screen-${Date.now()}.png`;
  link.click();
  URL.revokeObjectURL(url);
});

elements.alwaysOnTop.addEventListener('change', async () => {
  try {
    const enabled = await api?.setAlwaysOnTop(elements.alwaysOnTop.checked);
    elements.alwaysOnTop.checked = Boolean(enabled);
  } catch {
    elements.alwaysOnTop.checked = false;
  }
});

elements.deviceInfoButton.addEventListener('click', openDeviceInfo);
elements.deviceInfoClose.addEventListener('click', closeDeviceInfo);
elements.deviceInfoModal.addEventListener('click', (event) => { if (event.target === elements.deviceInfoModal) closeDeviceInfo(); });
elements.deviceInfoRefresh.addEventListener('click', () => loadDeviceInfo());
elements.deviceInfoForeground.addEventListener('click', () => loadDeviceInfo({ useForeground: true }));
elements.deviceInfoPackage.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); loadDeviceInfo(); }
});
elements.deviceInfoCopy.addEventListener('click', async () => {
  if (!latestDeviceInfo?.report) return;
  try {
    await api.copyText(latestDeviceInfo.report);
    elements.deviceInfoCopy.textContent = '已复制，可粘贴到缺陷单';
    setTimeout(() => { elements.deviceInfoCopy.textContent = '复制缺陷环境文案'; }, 1800);
  } catch (error) {
    elements.deviceInfoMessage.textContent = error.message || '复制失败，请手动选择文案';
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !elements.deviceInfoModal.hidden) closeDeviceInfo();
});

function applyTheme() {
  const theme = localStorage.getItem('test-cat-theme');
  document.body.classList.toggle('dark', theme === 'dark');
  document.body.classList.toggle('purple-eye', theme === 'purple');
}

applyTheme();
const viewerResizeObserver = new ResizeObserver(() => requestAnimationFrame(() => fitCanvasToViewer()));
viewerResizeObserver.observe(elements.viewer);
window.addEventListener('storage', (event) => {
  if (event.key === 'test-cat-theme') applyTheme();
});
window.addEventListener('beforeunload', () => {
  viewerResizeObserver.disconnect();
  disposeDecoder();
});

if (api) {
  api.onStream(handleStreamMessage);
  api.onStatus(setStatus);
  api.requestStream();
  refreshDevices();
} else {
  setStatus({ phase: 'error', message: '请通过“本地预览”入口运行 Test cat。' });
}
