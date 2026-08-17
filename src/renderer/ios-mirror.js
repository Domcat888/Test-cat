const api = window.testCat?.iosMirror;
const $ = (selector) => document.querySelector(selector);
document.body.dataset.platform = window.testCat?.platform || 'browser';

const state = { running: false, focus: false, latestFrame: '', decoder: null, videoConfigured: false, videoTimestamp: 0 };
const elements = {
  device: $('#ios-device-select'), refresh: $('#ios-refresh'), start: $('#ios-start'), stop: $('#ios-stop'),
  status: $('#ios-status'), statusText: $('#ios-status-text'), viewer: $('#ios-viewer'), placeholder: $('#ios-placeholder'),
  placeholderTitle: $('#ios-placeholder-title'), placeholderText: $('#ios-placeholder-text'), screen: $('#ios-screen'), video: $('#ios-video-stream'),
  canvas: $('#ios-video-canvas'),
  deviceName: $('#ios-device-name'), resolution: $('#ios-resolution'), streamMode: $('#ios-stream-mode'),
  alwaysOnTop: $('#ios-always-on-top'), focus: $('#ios-focus-mode')
};

function toast(message) {
  elements.status.dataset.phase = 'error';
  elements.statusText.textContent = message;
}

function showPlaceholder(title, text) {
  elements.placeholder.hidden = false;
  elements.screen.hidden = true;
  elements.video.hidden = true;
  elements.canvas.hidden = true;
  elements.placeholderTitle.textContent = title;
  elements.placeholderText.textContent = text;
}

function setFocusMode(enabled) {
  state.focus = Boolean(enabled);
  document.body.classList.toggle('mirror-focus-active', state.focus);
  elements.focus.textContent = state.focus ? '↙ 退出大画面' : '⛶ 大画面';
  elements.focus.setAttribute('aria-pressed', String(state.focus));
}

function setBusy(busy) {
  elements.device.disabled = busy || state.running;
  elements.refresh.disabled = busy || state.running;
  elements.start.disabled = busy || state.running || !elements.device.value;
  elements.stop.disabled = busy || !state.running;
  elements.alwaysOnTop.disabled = busy;
}

function setStatus(status = {}) {
  elements.status.dataset.phase = status.phase || 'idle';
  elements.statusText.textContent = status.message || '等待连接';
  if (status.model) elements.deviceName.textContent = status.model;
  if (status.streamMode) elements.streamMode.textContent = status.streamMode;
  if (status.phase === 'error') showPlaceholder('iOS 投屏不可用', status.message || '请检查设备连接和截图工具。');
  setBusy(['connecting', 'starting', 'stopping'].includes(status.phase));
}

function updateActionState() {
  elements.start.disabled = state.running || !elements.device.value;
  elements.stop.disabled = !state.running;
}

async function refreshDevices() {
  if (!api) return toast('iOS 投屏只能在 Test cat 桌面版中运行');
  elements.device.innerHTML = '<option value="">正在查找 iPhone…</option>';
  elements.refresh.disabled = true;
  try {
    const devices = await api.listDevices();
    elements.device.innerHTML = '';
    if (!devices.length) elements.device.innerHTML = '<option value="">未发现 iPhone</option>';
    for (const device of devices) {
      const option = document.createElement('option');
      option.value = device.serial;
      option.textContent = `${device.model || 'iPhone'} · ${device.serial} · ${['device', 'connected', 'ready', 'online'].includes(device.state) ? '已连接' : device.state}`;
      option.disabled = !['device', 'connected', 'ready', 'online'].includes(device.state);
      elements.device.append(option);
    }
    elements.device.value = devices.find((device) => ['device', 'connected', 'ready', 'online'].includes(device.state))?.serial || '';
    updateActionState();
  } catch (error) {
    elements.device.innerHTML = '<option value="">设备检测失败</option>';
    toast(error.message || String(error));
  } finally {
    elements.refresh.disabled = false;
    updateActionState();
  }
}

async function startMirror() {
  if (!elements.device.value || !api) return;
  setBusy(true);
  setStatus({ phase: 'starting', message: '正在准备 iOS USB 投屏…' });
  try {
    const meta = await api.start({ serial: elements.device.value, interval: 700 });
    state.running = true;
    elements.deviceName.textContent = meta.model || 'iPhone';
    elements.streamMode.textContent = meta.streamMode || 'USB 截图轮询';
    if (meta.streamUrl) {
      state.latestFrame = '';
      elements.screen.hidden = true;
      elements.video.src = meta.streamUrl;
      elements.video.hidden = false;
      elements.placeholder.hidden = true;
      elements.resolution.textContent = '自动适配';
    }
    setStatus({ phase: 'streaming', message: `已连接 ${meta.model || 'iPhone'}`, model: meta.model, streamMode: meta.streamMode });
  } catch (error) {
    state.running = false;
    setStatus({ phase: 'error', message: error.message || String(error) });
  } finally {
    setBusy(false);
    updateActionState();
  }
}

async function stopMirror() {
  if (!api) return;
  setBusy(true);
  try { await api.stop(); } catch (error) { toast(error.message || '停止 iOS 投屏失败'); }
  finally {
    state.running = false;
    state.latestFrame = '';
    state.videoConfigured = false;
    try { state.decoder?.close(); } catch {}
    state.decoder = null;
    elements.screen.removeAttribute('src');
    elements.video.removeAttribute('src');
    elements.video.hidden = true;
    elements.canvas.hidden = true;
    elements.resolution.textContent = '—';
    showPlaceholder('连接一台 iPhone', '用数据线连接已信任的 iPhone，安装设备桥接工具后即可开始投屏。');
    setStatus({ phase: 'idle', message: 'iOS 投屏已停止' });
    setBusy(false);
    updateActionState();
  }
}

function hasIdr(bytes) {
  for (let index = 0; index + 4 < bytes.length; index += 1) {
    if (bytes[index] === 0 && bytes[index + 1] === 0 && bytes[index + 2] === 0 && bytes[index + 3] === 1
      && (bytes[index + 4] & 0x1f) === 5) return true;
  }
  return false;
}

function configureVideo(config = {}) {
  if (typeof VideoDecoder === 'undefined') return toast('当前系统不支持 iOS H.264 硬件解码');
  try { state.decoder?.close(); } catch {}
  const width = Number(config.width) || 1170;
  const height = Number(config.height) || 2532;
  elements.canvas.width = width;
  elements.canvas.height = height;
  elements.resolution.textContent = `${width} × ${height}`;
  const context = elements.canvas.getContext('2d', { alpha: false, desynchronized: true });
  state.decoder = new VideoDecoder({
    output(videoFrame) {
      context.drawImage(videoFrame, 0, 0, width, height);
      videoFrame.close();
      elements.canvas.hidden = false;
      elements.screen.hidden = true;
      elements.video.hidden = true;
      elements.placeholder.hidden = true;
    },
    error(error) {
      toast(`iOS 视频解码失败：${error.message || error}`);
    }
  });
  state.decoder.configure({ codec: config.codec || 'avc1.64002a', optimizeForLatency: true });
  state.videoConfigured = true;
  state.videoTimestamp = 0;
}

function decodeVideoFrame(frame) {
  if (!state.videoConfigured || !state.decoder) return;
  const source = frame.data?.type === 'Buffer' ? frame.data.data : frame.data;
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source || []);
  if (!bytes.length) return;
  try {
    state.decoder.decode(new EncodedVideoChunk({
      type: hasIdr(bytes) ? 'key' : 'delta',
      timestamp: state.videoTimestamp,
      data: bytes
    }));
    state.videoTimestamp += 16667;
  } catch (error) {
    toast(`iOS 视频帧处理失败：${error.message || error}`);
  }
}

function frameReceived(frame) {
  if (frame?.kind === 'video-config') return configureVideo(frame.config);
  if (frame?.kind === 'video-frame') return decodeVideoFrame(frame);
  const dataUrl = String(frame?.dataUrl || '');
  if (!/^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(dataUrl)) return;
  const firstFrame = !state.latestFrame;
  state.latestFrame = dataUrl;
  elements.video.hidden = true;
  if (firstFrame) elements.screen.hidden = true;
  elements.screen.onload = () => {
    elements.resolution.textContent = `${elements.screen.naturalWidth} × ${elements.screen.naturalHeight}`;
    elements.screen.hidden = false;
    elements.placeholder.hidden = true;
  };
  elements.screen.onerror = () => {
    state.latestFrame = '';
    showPlaceholder('iOS 画面加载失败', '截图文件无法解析，请确认设备已信任并重试连接。');
  };
  elements.screen.src = dataUrl;
}

elements.screen.addEventListener('contextmenu', (event) => event.preventDefault());
elements.screenshot = $('#ios-screenshot');
elements.fullscreen = $('#ios-fullscreen');
elements.screenshot.addEventListener('click', async () => {
  if (!elements.canvas.hidden && elements.canvas.width && elements.canvas.height) {
    const link = document.createElement('a');
    link.href = elements.canvas.toDataURL('image/png');
    link.download = `test-cat-ios-${Date.now()}.png`;
    link.click();
    return;
  }
  if (!state.latestFrame && state.running) {
    try {
      const frame = await api?.capture();
      state.latestFrame = String(frame?.dataUrl || '');
    } catch (error) {
      return toast(error.message || 'iOS 截图保存失败');
    }
  }
  if (!state.latestFrame) return toast('当前没有可保存的 iOS 画面');
  const link = document.createElement('a');
  link.href = state.latestFrame;
  link.download = `test-cat-ios-${Date.now()}.png`;
  link.click();
});
elements.fullscreen.addEventListener('click', () => elements.viewer.requestFullscreen?.());
elements.focus.addEventListener('click', () => setFocusMode(!state.focus));
elements.refresh.addEventListener('click', refreshDevices);
elements.start.addEventListener('click', startMirror);
elements.stop.addEventListener('click', stopMirror);
elements.device.addEventListener('change', updateActionState);
elements.alwaysOnTop.addEventListener('change', async () => {
  try { elements.alwaysOnTop.checked = Boolean(await api?.setAlwaysOnTop(elements.alwaysOnTop.checked)); }
  catch { elements.alwaysOnTop.checked = false; }
});

api?.onFrame(frameReceived);
api?.onStatus(setStatus);
refreshDevices();
updateActionState();

function applyTheme() {
  const theme = localStorage.getItem('test-cat-theme');
  document.body.classList.toggle('dark', theme === 'dark');
  document.body.classList.toggle('purple-eye', theme === 'purple');
}

applyTheme();
window.addEventListener('storage', (event) => {
  if (event.key === 'test-cat-theme') applyTheme();
});
