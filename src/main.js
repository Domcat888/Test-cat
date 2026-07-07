const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const {
  app,
  BrowserWindow,
  Menu,
  MessageChannelMain,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  shell
} = require('electron');
const { MobileMirrorService } = require('./mobile-mirror-service');
const { PerformanceMonitorService } = require('./performance-monitor-service');
const { WeakNetworkService } = require('./weak-network-service');
const { FileCompareService } = require('./file-compare-service');
const { LogAnalysisService } = require('./log-analysis-service');
const { AppPackageService } = require('./app-package-service');

const isMac = process.platform === 'darwin';
let mainWindow = null;
let mobileMirrorWindow = null;
let calculatorWindow = null;
let performanceMonitorWindow = null;
let weakNetworkWindow = null;
let fileCompareWindow = null;
let logAnalysisWindow = null;
let appPackageWindow = null;
let mockDataWindow = null;
let companionPetWindow = null;
let recorderWindow = null;
let recordingBorderWindow = null;
let capturePreviewWindow = null;
let mobileMirrorService = null;
let performanceMonitorService = null;
let weakNetworkService = null;
let fileCompareService = null;
let logAnalysisService = null;
let appPackageService = null;
let ipcReady = false;
let quitCleanupStarted = false;
let quitCleanupFinished = false;
let captureSettings = null;
let captureShortcutStatus = { enabled: true, screenshot: null, recorder: null };
let activeCaptureShortcuts = [];
let companionPetSettings = null;
let companionPetWalkTimer = null;
let companionPetAnimationTimer = null;
let companionPetDragState = null;
const companionPetReminderTimers = new Map();
const selectionWindows = new Map();
const capturePayloads = new Map();

const DEFAULT_CAPTURE_SETTINGS = Object.freeze({
  enabled: true,
  screenshotShortcut: 'Alt+Shift+S',
  recorderShortcut: 'Alt+Shift+R',
  screenshotAction: 'toolbar'
});

const DEFAULT_COMPANION_PET_SETTINGS = Object.freeze({
  activePetId: 'yuexinmiao',
  enabled: true,
  movementEnabled: true,
  walkIntervalSeconds: 24,
  waterReminderEnabled: true,
  waterReminderMinutes: 30,
  standReminderEnabled: true,
  standReminderMinutes: 45
});

const COMPANION_PETS = Object.freeze({
  yuexinmiao: Object.freeze({
    id: 'yuexinmiao',
    name: '月薪喵',
    description: '从录屏里提取的月薪喵，会在桌面随机移动、跳舞，并提醒你喝水、站起来活动。',
    title: '月薪喵 - Test cat',
    frameBase: '../../assets/companion-pet/yuexinmiao/dance-',
    frameCount: 17
  })
});

function captureSettingsPath() {
  return path.join(app.getPath('userData'), 'capture-settings.json');
}

function companionPetSettingsPath() {
  return path.join(app.getPath('userData'), 'companion-pet-settings.json');
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function normalizeCompanionPetSettings(value = {}) {
  const activePetId = COMPANION_PETS[value.activePetId] ? value.activePetId : DEFAULT_COMPANION_PET_SETTINGS.activePetId;
  return {
    activePetId,
    enabled: value.enabled !== false,
    movementEnabled: value.movementEnabled !== false,
    walkIntervalSeconds: clampNumber(value.walkIntervalSeconds, DEFAULT_COMPANION_PET_SETTINGS.walkIntervalSeconds, 8, 300),
    waterReminderEnabled: value.waterReminderEnabled !== false,
    waterReminderMinutes: clampNumber(value.waterReminderMinutes, DEFAULT_COMPANION_PET_SETTINGS.waterReminderMinutes, 1, 480),
    standReminderEnabled: value.standReminderEnabled !== false,
    standReminderMinutes: clampNumber(value.standReminderMinutes, DEFAULT_COMPANION_PET_SETTINGS.standReminderMinutes, 1, 480)
  };
}

function loadCompanionPetSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(companionPetSettingsPath(), 'utf8'));
    return normalizeCompanionPetSettings({ ...DEFAULT_COMPANION_PET_SETTINGS, ...parsed });
  } catch {
    return { ...DEFAULT_COMPANION_PET_SETTINGS };
  }
}

async function saveCompanionPetSettingsToDisk() {
  await fsp.mkdir(path.dirname(companionPetSettingsPath()), { recursive: true });
  await fsp.writeFile(companionPetSettingsPath(), JSON.stringify(companionPetSettings, null, 2));
}

function normalizeAccelerator(value, fallback) {
  const raw = String(value || '').replace(/[＋﹢]/g, '+').trim();
  const tokens = raw.split('+').map((item) => item.trim()).filter(Boolean);
  const modifierMap = {
    cmd: 'Command',
    command: 'Command',
    meta: 'Command',
    control: 'Ctrl',
    ctrl: 'Ctrl',
    cmdorctrl: 'CommandOrControl',
    commandorcontrol: 'CommandOrControl',
    commandorctrl: 'CommandOrControl',
    option: 'Alt',
    alt: 'Alt',
    shift: 'Shift',
    super: 'Super'
  };
  const keyMap = {
    esc: 'Escape',
    escape: 'Escape',
    space: 'Space',
    tab: 'Tab',
    enter: 'Return',
    return: 'Return',
    backspace: 'Backspace',
    delete: 'Delete',
    del: 'Delete',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right'
  };
  const modifiers = [];
  let key = '';
  for (const token of tokens) {
    const normalized = token.toLowerCase().replace(/[\s_-]/g, '');
    const modifier = modifierMap[normalized];
    if (modifier) {
      if (!modifiers.includes(modifier)) modifiers.push(modifier);
      continue;
    }
    if (!key) {
      if (/^f\d{1,2}$/i.test(token)) key = token.toUpperCase();
      else if (/^[a-z]$/i.test(token)) key = token.toUpperCase();
      else if (/^\d$/.test(token)) key = token;
      else key = keyMap[normalized] || token;
    }
  }
  if (!key || modifiers.length === 0) return fallback;
  return [...modifiers, key].join('+');
}

function normalizeCaptureSettings(value = {}) {
  const action = ['toolbar', 'copy', 'editor', 'pin', 'save'].includes(value.screenshotAction)
    ? value.screenshotAction
    : DEFAULT_CAPTURE_SETTINGS.screenshotAction;
  return {
    enabled: value.enabled !== false,
    screenshotShortcut: normalizeAccelerator(value.screenshotShortcut, DEFAULT_CAPTURE_SETTINGS.screenshotShortcut),
    recorderShortcut: normalizeAccelerator(value.recorderShortcut, DEFAULT_CAPTURE_SETTINGS.recorderShortcut),
    screenshotAction: action
  };
}

function loadCaptureSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(captureSettingsPath(), 'utf8'));
    return normalizeCaptureSettings({ ...DEFAULT_CAPTURE_SETTINGS, ...parsed });
  } catch {
    return { ...DEFAULT_CAPTURE_SETTINGS };
  }
}

async function saveCaptureSettingsToDisk() {
  await fsp.mkdir(path.dirname(captureSettingsPath()), { recursive: true });
  await fsp.writeFile(captureSettingsPath(), JSON.stringify(captureSettings, null, 2));
}

function unregisterCaptureShortcuts() {
  for (const accelerator of activeCaptureShortcuts) {
    try { globalShortcut.unregister(accelerator); } catch {}
  }
  activeCaptureShortcuts = [];
}

function notifyCaptureMessage(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('capture:notice', message);
  }
}

function registerCaptureShortcuts() {
  unregisterCaptureShortcuts();
  const settings = captureSettings || DEFAULT_CAPTURE_SETTINGS;
  const status = {
    enabled: settings.enabled,
    screenshot: { accelerator: settings.screenshotShortcut, registered: false, error: '' },
    recorder: { accelerator: settings.recorderShortcut, registered: false, error: '' }
  };
  if (!settings.enabled) {
    captureShortcutStatus = status;
    return status;
  }

  try {
    status.screenshot.registered = globalShortcut.register(settings.screenshotShortcut, () => {
      createScreenshotSelection().catch((error) => notifyCaptureMessage(error.message || '截图启动失败'));
    });
    if (status.screenshot.registered) activeCaptureShortcuts.push(settings.screenshotShortcut);
    else status.screenshot.error = '快捷键可能已被系统或其他软件占用';
  } catch (error) {
    status.screenshot.error = error.message || '快捷键注册失败';
  }

  if (settings.recorderShortcut === settings.screenshotShortcut) {
    status.recorder.error = '录屏快捷键不能和截图快捷键相同';
  } else {
    try {
      status.recorder.registered = globalShortcut.register(settings.recorderShortcut, () => {
        createRecordingSelection().catch((error) => notifyCaptureMessage(error.message || '录屏启动失败'));
      });
      if (status.recorder.registered) activeCaptureShortcuts.push(settings.recorderShortcut);
      else status.recorder.error = '快捷键可能已被系统或其他软件占用';
    } catch (error) {
      status.recorder.error = error.message || '快捷键注册失败';
    }
  }

  captureShortcutStatus = status;
  return status;
}

function captureSettingsSnapshot() {
  return {
    settings: captureSettings || { ...DEFAULT_CAPTURE_SETTINGS },
    shortcutStatus: captureShortcutStatus
  };
}

function capturePayloadId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function storeCapturePayload(payload) {
  const id = capturePayloadId();
  capturePayloads.set(id, payload);
  const timer = setTimeout(() => capturePayloads.delete(id), 10 * 60 * 1000);
  timer.unref?.();
  return id;
}

function timestampForFile() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function getKnownPath(name, fallback) {
  try { return app.getPath(name); } catch { return app.getPath(fallback); }
}

function imageFromDataUrl(dataUrl) {
  if (!String(dataUrl || '').startsWith('data:image/')) throw new Error('图片数据无效');
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) throw new Error('图片数据为空，无法处理');
  return image;
}

function closeSelectionWindows() {
  for (const window of selectionWindows.values()) {
    if (window && !window.isDestroyed()) window.close();
  }
  selectionWindows.clear();
}

function closeRecordingBorderWindow() {
  if (recordingBorderWindow && !recordingBorderWindow.isDestroyed()) {
    recordingBorderWindow.close();
  }
  recordingBorderWindow = null;
}

async function saveImageDataUrl(dataUrl, ownerWindow = mainWindow) {
  const image = imageFromDataUrl(dataUrl);
  const defaultPath = path.join(getKnownPath('pictures', 'downloads'), `TestCat_截图_${timestampForFile()}.png`);
  const result = await dialog.showSaveDialog(ownerWindow || undefined, {
    title: '保存截图',
    defaultPath,
    filters: [{ name: 'PNG 图片', extensions: ['png'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const filePath = result.filePath.toLowerCase().endsWith('.png') ? result.filePath : `${result.filePath}.png`;
  await fsp.writeFile(filePath, image.toPNG());
  return { canceled: false, filePath };
}

async function saveVideoBuffer(data, ownerWindow = recorderWindow || mainWindow) {
  const bytes = data instanceof ArrayBuffer ? Buffer.from(new Uint8Array(data)) : Buffer.from(data || []);
  if (!bytes.length) throw new Error('录屏数据为空，无法保存');
  const defaultPath = path.join(getKnownPath('videos', 'downloads'), `TestCat_录屏_${timestampForFile()}.webm`);
  const result = await dialog.showSaveDialog(ownerWindow || undefined, {
    title: '保存录屏',
    defaultPath,
    filters: [{ name: 'WebM 视频', extensions: ['webm'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const filePath = result.filePath.toLowerCase().endsWith('.webm') ? result.filePath : `${result.filePath}.webm`;
  await fsp.writeFile(filePath, bytes);
  return { canceled: false, filePath };
}

function createPinWindow(dataUrl) {
  const image = imageFromDataUrl(dataUrl);
  const imageSize = image.getSize();
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const scale = Math.min(1, (workArea.width * 0.56) / imageSize.width, (workArea.height * 0.72) / imageSize.height);
  const width = Math.max(260, Math.round(imageSize.width * scale));
  const height = Math.max(180, Math.round(imageSize.height * scale) + 42);
  const payloadId = storeCapturePayload({ type: 'pin', imageDataUrl: dataUrl });
  const window = new BrowserWindow({
    width,
    height,
    minWidth: 180,
    minHeight: 120,
    frame: false,
    resizable: true,
    show: false,
    title: '贴屏截图 - Test cat',
    icon: path.join(__dirname, '../assets/icon.png'),
    alwaysOnTop: true,
    backgroundColor: '#111923',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.setAlwaysOnTop(true, isMac ? 'floating' : 'normal');
  window.loadFile(path.join(__dirname, 'renderer/capture-pin.html'), { query: { id: payloadId } });
  window.once('ready-to-show', () => window.show());
  configureWindow(window);
  return window;
}

function createCaptureEditorWindow(dataUrl) {
  imageFromDataUrl(dataUrl);
  const payloadId = storeCapturePayload({ type: 'editor', imageDataUrl: dataUrl });
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    show: false,
    title: '截图编辑 - Test cat',
    icon: path.join(__dirname, '../assets/icon.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#101720',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.loadFile(path.join(__dirname, 'renderer/capture-editor.html'), { query: { id: payloadId } });
  window.once('ready-to-show', () => {
    window.show();
    if (process.argv.includes('--devtools')) window.webContents.openDevTools({ mode: 'detach' });
  });
  configureWindow(window);
  return window;
}

function createCapturePreviewWindow(dataUrl) {
  imageFromDataUrl(dataUrl);
  if (capturePreviewWindow && !capturePreviewWindow.isDestroyed()) {
    capturePreviewWindow.close();
    capturePreviewWindow = null;
  }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  const width = 372;
  const height = 138;
  const payloadId = storeCapturePayload({ type: 'preview', imageDataUrl: dataUrl });
  const window = new BrowserWindow({
    width,
    height,
    x: Math.round(area.x + area.width - width - 18),
    y: Math.round(area.y + area.height - height - 18),
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    title: '截图预览 - Test cat',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  capturePreviewWindow = window;
  window.setAlwaysOnTop(true, isMac ? 'floating' : 'pop-up-menu');
  window.loadFile(path.join(__dirname, 'renderer/capture-preview.html'), { query: { id: payloadId } });
  window.once('ready-to-show', () => {
    if (typeof window.showInactive === 'function') window.showInactive();
    else window.show();
  });
  configureWindow(window);
  window.on('closed', () => {
    if (capturePreviewWindow === window) capturePreviewWindow = null;
  });
  return window;
}

function recordingRegionGlobalRect(region = {}) {
  const display = screen.getAllDisplays().find((item) => String(item.id) === String(region.displayId))
    || screen.getPrimaryDisplay();
  const bounds = region.bounds || display.bounds;
  const rect = region.dipRect || {};
  return {
    x: Math.round((Number(bounds.x) || 0) + (Number(rect.x) || 0)),
    y: Math.round((Number(bounds.y) || 0) + (Number(rect.y) || 0)),
    width: Math.max(8, Math.round(Number(rect.width) || 0)),
    height: Math.max(8, Math.round(Number(rect.height) || 0))
  };
}

function clampToWorkArea(value, min, max) {
  if (max < min) return Math.round(min);
  return Math.round(Math.min(max, Math.max(min, value)));
}

function floatingBoundsNearRegion(region, width, height) {
  const rect = recordingRegionGlobalRect(region);
  const display = screen.getDisplayMatching(rect);
  const area = display.workArea;
  const gap = 10;
  const candidates = [
    { x: rect.x + (rect.width - width) / 2, y: rect.y + rect.height + gap },
    { x: rect.x + (rect.width - width) / 2, y: rect.y - height - gap },
    { x: rect.x + rect.width + gap, y: rect.y + (rect.height - height) / 2 },
    { x: rect.x - width - gap, y: rect.y + (rect.height - height) / 2 },
    { x: area.x + area.width - width - 16, y: area.y + area.height - height - 16 }
  ];
  const fits = (item) => item.x >= area.x
    && item.y >= area.y
    && item.x + width <= area.x + area.width
    && item.y + height <= area.y + area.height;
  const chosen = candidates.find(fits) || candidates[candidates.length - 1];
  return {
    width,
    height,
    x: clampToWorkArea(chosen.x, area.x + 8, area.x + area.width - width - 8),
    y: clampToWorkArea(chosen.y, area.y + 8, area.y + area.height - height - 8)
  };
}

function createRecordingBorderWindow(region = {}) {
  const rect = recordingRegionGlobalRect(region);
  if (!rect.width || !rect.height) throw new Error('录屏区域无效，请重新框选');
  closeRecordingBorderWindow();
  const padding = 8;
  const window = new BrowserWindow({
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    title: '录制区域边框 - Test cat',
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  recordingBorderWindow = window;
  window.setAlwaysOnTop(true, isMac ? 'screen-saver' : 'pop-up-menu');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setIgnoreMouseEvents(true, { forward: true });
  window.loadFile(path.join(__dirname, 'renderer/recording-border.html'));
  window.once('ready-to-show', () => {
    if (typeof window.showInactive === 'function') window.showInactive();
    else window.show();
  });
  window.on('closed', () => {
    if (recordingBorderWindow === window) recordingBorderWindow = null;
  });
  return window;
}

async function listCaptureSources() {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 360, height: 220 },
    fetchWindowIcons: true
  });
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    displayId: source.display_id || '',
    type: source.id.startsWith('screen') ? 'screen' : 'window',
    thumbnail: source.thumbnail?.isEmpty() ? '' : source.thumbnail.toDataURL(),
    appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : ''
  }));
}

async function createRecorderWindow(region = null) {
  if (!region) return createRecordingSelection();
  if (recorderWindow && !recorderWindow.isDestroyed()) {
    recorderWindow.close();
    recorderWindow = null;
  }
  closeRecordingBorderWindow();
  const payloadId = storeCapturePayload({ type: 'recording', region });
  const controlBounds = floatingBoundsNearRegion(region, 392, 108);
  const window = new BrowserWindow({
    ...controlBounds,
    minWidth: 392,
    minHeight: 108,
    maxWidth: 392,
    maxHeight: 108,
    frame: false,
    resizable: false,
    show: false,
    title: '录屏 - Test cat',
    icon: path.join(__dirname, '../assets/icon.png'),
    alwaysOnTop: true,
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  recorderWindow = window;
  window.setAlwaysOnTop(true, isMac ? 'floating' : 'normal');
  window.loadFile(path.join(__dirname, 'renderer/screen-recorder.html'), { query: { id: payloadId } });
  window.once('ready-to-show', () => {
    window.show();
    if (process.argv.includes('--devtools')) window.webContents.openDevTools({ mode: 'detach' });
  });
  configureWindow(window);
  window.on('closed', () => {
    if (recorderWindow === window) recorderWindow = null;
    closeRecordingBorderWindow();
  });
  return window;
}

function matchDisplaySource(display, sources, index, displayCount) {
  const exact = sources.find((source) => String(source.display_id || '') === String(display.id));
  if (exact) return exact;
  if (sources.length === displayCount) return sources[index] || sources[0];
  return sources[0];
}

async function createCaptureSelection(mode = 'screenshot') {
  closeSelectionWindows();
  const displays = screen.getAllDisplays();
  const maxWidth = Math.max(...displays.map((display) => Math.round(display.bounds.width * display.scaleFactor)), 1280);
  const maxHeight = Math.max(...displays.map((display) => Math.round(display.bounds.height * display.scaleFactor)), 720);
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: maxWidth, height: maxHeight }
  });
  if (!sources.length) throw new Error('没有获取到屏幕画面，请检查系统屏幕录制权限');

  displays.forEach((display, index) => {
    const source = matchDisplaySource(display, sources, index, displays.length);
    if (!source || !source.thumbnail || source.thumbnail.isEmpty()) return;
    const bounds = display.bounds;
    const thumbnailSize = source.thumbnail.getSize();
    const payloadId = storeCapturePayload({
      type: 'selection',
      selectionMode: mode,
      imageDataUrl: source.thumbnail.toDataURL(),
      sourceId: source.id,
      sourceName: source.name,
      displayId: display.id,
      displayName: source.name,
      bounds,
      scaleFactor: display.scaleFactor,
      screenPixelSize: thumbnailSize,
      defaultAction: mode === 'recording' ? 'record' : (captureSettings || DEFAULT_CAPTURE_SETTINGS).screenshotAction,
      platform: process.platform
    });
    const window = new BrowserWindow({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      transparent: true,
      hasShadow: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      title: mode === 'recording' ? '录屏区域选择 - Test cat' : '截图选择 - Test cat',
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    selectionWindows.set(payloadId, window);
    window.setAlwaysOnTop(true, isMac ? 'screen-saver' : 'pop-up-menu');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.loadFile(path.join(__dirname, 'renderer/capture-select.html'), { query: { id: payloadId } });
    window.once('ready-to-show', () => {
      window.show();
      window.focus();
    });
    window.on('closed', () => selectionWindows.delete(payloadId));
  });

  if (!selectionWindows.size) throw new Error('屏幕画面为空，请检查系统屏幕录制权限');
}

async function createScreenshotSelection() {
  return createCaptureSelection('screenshot');
}

async function createRecordingSelection() {
  if (recorderWindow && !recorderWindow.isDestroyed()) {
    if (recorderWindow.isMinimized()) recorderWindow.restore();
    recorderWindow.show();
    recorderWindow.focus();
    return recorderWindow;
  }
  return createCaptureSelection('recording');
}

function companionPetSnapshot() {
  const settings = companionPetSettings || { ...DEFAULT_COMPANION_PET_SETTINGS };
  const activePet = COMPANION_PETS[settings.activePetId] || COMPANION_PETS[DEFAULT_COMPANION_PET_SETTINGS.activePetId];
  return {
    activePet,
    pets: Object.values(COMPANION_PETS),
    settings,
    visible: Boolean(companionPetWindow && !companionPetWindow.isDestroyed() && companionPetWindow.isVisible())
  };
}

function sendCompanionPetSettings() {
  const snapshot = companionPetSnapshot();
  for (const targetWindow of [mainWindow, companionPetWindow]) {
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.webContents.send('companion-pet:settings-changed', snapshot);
    }
  }
}

function clearCompanionPetTimers() {
  if (companionPetWalkTimer) clearInterval(companionPetWalkTimer);
  if (companionPetAnimationTimer) clearInterval(companionPetAnimationTimer);
  companionPetWalkTimer = null;
  companionPetAnimationTimer = null;
  companionPetDragState = null;
  for (const timer of companionPetReminderTimers.values()) clearInterval(timer);
  companionPetReminderTimers.clear();
}

function initialCompanionPetBounds(width = 260, height = 320) {
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  return {
    width,
    height,
    x: Math.max(area.x + 12, area.x + area.width - width - 42),
    y: Math.max(area.y + 12, area.y + area.height - height - 34)
  };
}

function randomCompanionPetBounds(width = 260, height = 320) {
  const displays = screen.getAllDisplays();
  const display = displays[Math.floor(Math.random() * displays.length)] || screen.getPrimaryDisplay();
  const area = display.workArea;
  const maxX = Math.max(area.x + 12, area.x + area.width - width - 12);
  const maxY = Math.max(area.y + 12, area.y + area.height - height - 12);
  return {
    width,
    height,
    x: Math.round(area.x + 12 + Math.random() * Math.max(0, maxX - area.x - 12)),
    y: Math.round(area.y + 12 + Math.random() * Math.max(0, maxY - area.y - 12))
  };
}

function showCompanionPetWindow(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) return;
  targetWindow.setAlwaysOnTop(true, isMac ? 'floating' : 'pop-up-menu');
  try { targetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
  if (typeof targetWindow.showInactive === 'function') targetWindow.showInactive();
  else targetWindow.show();
}

function createCompanionPetWindow() {
  if (companionPetWindow && !companionPetWindow.isDestroyed()) {
    showCompanionPetWindow(companionPetWindow);
    return companionPetWindow;
  }

  const activePet = COMPANION_PETS[companionPetSettings?.activePetId] || COMPANION_PETS[DEFAULT_COMPANION_PET_SETTINGS.activePetId];
  const targetWindow = new BrowserWindow({
    ...initialCompanionPetBounds(),
    minWidth: 240,
    minHeight: 300,
    maxWidth: 300,
    maxHeight: 360,
    resizable: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    title: activePet.title,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  companionPetWindow = targetWindow;
  targetWindow.loadFile(path.join(__dirname, 'renderer/companion-pet.html'));
  targetWindow.once('ready-to-show', () => {
    showCompanionPetWindow(targetWindow);
    sendCompanionPetSettings();
    if (process.argv.includes('--devtools')) targetWindow.webContents.openDevTools({ mode: 'detach' });
  });
  configureWindow(targetWindow);
  targetWindow.on('closed', () => {
    if (companionPetWindow === targetWindow) companionPetWindow = null;
    if (companionPetAnimationTimer) clearInterval(companionPetAnimationTimer);
    companionPetAnimationTimer = null;
    sendCompanionPetSettings();
  });

  return targetWindow;
}

function moveCompanionPet(immediate = false, force = false) {
  if (!companionPetSettings?.enabled || (!force && !companionPetSettings?.movementEnabled)) return;
  const targetWindow = companionPetWindow && !companionPetWindow.isDestroyed() ? companionPetWindow : createCompanionPetWindow();
  if (!targetWindow || targetWindow.isDestroyed()) return;
  if (companionPetDragState) return;
  const start = targetWindow.getBounds();
  const target = randomCompanionPetBounds(start.width, start.height);
  const distance = Math.hypot(target.x - start.x, target.y - start.y);
  const direction = target.x >= start.x ? 'right' : 'left';

  if (distance < 24 || immediate) {
    targetWindow.setBounds(target, false);
    targetWindow.webContents.send('companion-pet:walk', { direction, durationMs: 0 });
    return;
  }

  if (companionPetAnimationTimer) clearInterval(companionPetAnimationTimer);
  const durationMs = Math.min(11000, Math.max(3600, distance * 16));
  const startedAt = Date.now();
  targetWindow.webContents.send('companion-pet:walk', { direction, durationMs });
  companionPetAnimationTimer = setInterval(() => {
    if (!targetWindow || targetWindow.isDestroyed()) {
      clearInterval(companionPetAnimationTimer);
      companionPetAnimationTimer = null;
      return;
    }
    const progress = Math.min(1, (Date.now() - startedAt) / durationMs);
    const eased = 0.5 - Math.cos(progress * Math.PI) / 2;
    targetWindow.setBounds({
      ...start,
      x: Math.round(start.x + (target.x - start.x) * eased),
      y: Math.round(start.y + (target.y - start.y) * eased)
    }, false);
    if (progress >= 1) {
      clearInterval(companionPetAnimationTimer);
      companionPetAnimationTimer = null;
      targetWindow.webContents.send('companion-pet:idle');
    }
  }, 50);
  companionPetAnimationTimer.unref?.();
}

function scheduleCompanionPetMovement() {
  if (companionPetWalkTimer) clearInterval(companionPetWalkTimer);
  companionPetWalkTimer = null;
  if (!companionPetSettings?.enabled || !companionPetSettings?.movementEnabled) return;
  companionPetWalkTimer = setInterval(() => moveCompanionPet(false), companionPetSettings.walkIntervalSeconds * 1000);
  companionPetWalkTimer.unref?.();
}

function sendCompanionPetReminder(type) {
  if (!companionPetSettings?.enabled) return;
  const activePet = COMPANION_PETS[companionPetSettings.activePetId] || COMPANION_PETS[DEFAULT_COMPANION_PET_SETTINGS.activePetId];
  const petName = activePet.name;
  const reminderCopy = {
    water: {
      type: 'water',
      title: '喝水时间到',
      message: petName + '扭了两下：喝口水吧，身体也要补蓝量。'
    },
    stand: {
      type: 'stand',
      title: '站起来伸展一下',
      message: petName + '开始扭扭：站起来走两步，肩膀和尾巴都松一松。'
    }
  };
  const reminder = reminderCopy[type];
  if (!reminder) return;
  const targetWindow = companionPetWindow && !companionPetWindow.isDestroyed() ? companionPetWindow : createCompanionPetWindow();
  showCompanionPetWindow(targetWindow);
  targetWindow.webContents.send('companion-pet:reminder', { ...reminder, at: Date.now() });
}

function scheduleCompanionPetReminders() {
  for (const timer of companionPetReminderTimers.values()) clearInterval(timer);
  companionPetReminderTimers.clear();
  if (!companionPetSettings?.enabled) return;

  const reminders = [
    ['water', companionPetSettings.waterReminderEnabled, companionPetSettings.waterReminderMinutes],
    ['stand', companionPetSettings.standReminderEnabled, companionPetSettings.standReminderMinutes]
  ];
  for (const [type, enabled, minutes] of reminders) {
    if (!enabled) continue;
    const timer = setInterval(() => sendCompanionPetReminder(type), minutes * 60 * 1000);
    timer.unref?.();
    companionPetReminderTimers.set(type, timer);
  }
}

function applyCompanionPetSettings() {
  clearCompanionPetTimers();
  if (!companionPetSettings?.enabled) {
    if (companionPetWindow && !companionPetWindow.isDestroyed()) companionPetWindow.close();
    sendCompanionPetSettings();
    return;
  }
  createCompanionPetWindow();
  scheduleCompanionPetMovement();
  scheduleCompanionPetReminders();
  sendCompanionPetSettings();
}

function startCompanionPetDrag(point = {}) {
  if (!companionPetWindow || companionPetWindow.isDestroyed()) return false;
  if (companionPetAnimationTimer) {
    clearInterval(companionPetAnimationTimer);
    companionPetAnimationTimer = null;
  }
  const bounds = companionPetWindow.getBounds();
  companionPetDragState = {
    offsetX: Math.round(Number(point.x) || 0) - bounds.x,
    offsetY: Math.round(Number(point.y) || 0) - bounds.y
  };
  companionPetWindow.webContents.send('companion-pet:drag-state', { dragging: true });
  return true;
}

function dragCompanionPet(point = {}) {
  if (!companionPetWindow || companionPetWindow.isDestroyed() || !companionPetDragState) return false;
  const bounds = companionPetWindow.getBounds();
  const x = Math.round((Number(point.x) || 0) - companionPetDragState.offsetX);
  const y = Math.round((Number(point.y) || 0) - companionPetDragState.offsetY);
  companionPetWindow.setBounds({ ...bounds, x, y }, false);
  return true;
}

function endCompanionPetDrag() {
  if (!companionPetDragState) return false;
  companionPetDragState = null;
  if (companionPetWindow && !companionPetWindow.isDestroyed()) {
    companionPetWindow.webContents.send('companion-pet:drag-state', { dragging: false });
    companionPetWindow.webContents.send('companion-pet:idle');
  }
  return true;
}

function setupIpc() {
  if (ipcReady) return;
  ipcReady = true;

  ipcMain.on('mobile-mirror:stream-request', (event) => {
    if (!mobileMirrorService) return;
    const { port1, port2 } = new MessageChannelMain();
    mobileMirrorService.attachPort(port1);
    event.senderFrame.postMessage('mobile-mirror:stream-port', null, [port2]);
  });
  ipcMain.handle('mobile-mirror:list-devices', () => mobileMirrorService.listDevices());
  ipcMain.handle('mobile-mirror:start', (_event, configuration) => mobileMirrorService.start(configuration || {}));
  ipcMain.handle('mobile-mirror:stop', () => mobileMirrorService.stop());
  ipcMain.handle('mobile-mirror:get-device-info', (_event, configuration) => mobileMirrorService.getDeviceInfo(configuration || {}));
  ipcMain.handle('mobile-mirror:copy-text', (_event, value) => {
    clipboard.writeText(String(value || '').slice(0, 100000));
    return true;
  });
  ipcMain.handle('mobile-mirror:open-window', () => {
    createMobileMirrorWindow();
    return true;
  });
  ipcMain.handle('mobile-mirror:set-always-on-top', (event, enabled) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!mobileMirrorWindow || senderWindow !== mobileMirrorWindow) return false;
    mobileMirrorWindow.setAlwaysOnTop(Boolean(enabled), isMac ? 'floating' : 'normal');
    return mobileMirrorWindow.isAlwaysOnTop();
  });
  ipcMain.handle('calculator:open-window', () => {
    createCalculatorWindow();
    return true;
  });
  ipcMain.handle('performance-monitor:open-window', () => {
    createPerformanceMonitorWindow();
    return true;
  });
  ipcMain.handle('performance-monitor:list-devices', () => performanceMonitorService.listDevices());
  ipcMain.handle('performance-monitor:start', (_event, configuration) => performanceMonitorService.start(configuration));
  ipcMain.handle('performance-monitor:stop', () => performanceMonitorService.stop());
  ipcMain.handle('performance-monitor:launch-app', (_event, { serial, packageName }) => performanceMonitorService.launchApp(serial, packageName));
  ipcMain.handle('performance-monitor:foreground-app', (_event, serial) => performanceMonitorService.getForegroundApp(serial));
  ipcMain.handle('weak-network:open-window', () => {
    createWeakNetworkWindow();
    return true;
  });
  ipcMain.handle('weak-network:list-devices', () => weakNetworkService.listDevices());
  ipcMain.handle('weak-network:get-presets', () => weakNetworkService.getPresets());
  ipcMain.handle('weak-network:start', (_event, configuration) => weakNetworkService.start(configuration || {}));
  ipcMain.handle('weak-network:stop', () => weakNetworkService.stop());
  ipcMain.handle('file-compare:open-window', () => {
    createFileCompareWindow();
    return true;
  });
  ipcMain.handle('file-compare:select-path', (_event, kind) => fileCompareService.selectPath(kind));
  ipcMain.handle('file-compare:inspect-path', (_event, targetPath) => fileCompareService.inspectPath(targetPath));
  ipcMain.handle('file-compare:read-file', (_event, filePath) => fileCompareService.readFile(filePath));
  ipcMain.handle('file-compare:compare-directories', (_event, payload) => fileCompareService.compareDirectories(payload.leftRoot, payload.rightRoot, payload.options || {}));
  ipcMain.handle('file-compare:sync-entry', (_event, payload) => fileCompareService.syncEntry(payload));
  ipcMain.handle('file-compare:save-text', (_event, payload) => fileCompareService.saveText(payload));
  ipcMain.handle('file-compare:export-report', (_event, payload) => fileCompareService.exportReport(payload));
  ipcMain.handle('log-analysis:open-window', () => {
    createLogAnalysisWindow();
    return true;
  });
  ipcMain.handle('log-analysis:list-devices', () => logAnalysisService.listDevices());
  ipcMain.handle('log-analysis:foreground-app', (_event, serial) => logAnalysisService.getForegroundApp(serial));
  ipcMain.handle('log-analysis:start', (_event, configuration) => logAnalysisService.start(configuration || {}));
  ipcMain.handle('log-analysis:stop', () => logAnalysisService.stop());
  ipcMain.handle('log-analysis:clear', () => logAnalysisService.clearCaptured());
  ipcMain.handle('log-analysis:export', (_event, payload) => logAnalysisService.exportLogs(payload || {}));
  ipcMain.handle('log-analysis:copy-text', (_event, value) => {
    clipboard.writeText(String(value || '').slice(0, 2_000_000));
    return true;
  });
  ipcMain.handle('app-package:open-window', () => {
    createAppPackageWindow();
    return true;
  });
  ipcMain.handle('app-package:select-package', () => appPackageService.selectPackage());
  ipcMain.handle('app-package:inspect-package', (_event, filePath) => appPackageService.inspectPackage(filePath));
  ipcMain.handle('app-package:list-devices', () => appPackageService.listDevices());
  ipcMain.handle('app-package:list-installed', (_event, payload) => appPackageService.listInstalledPackages(payload || {}));
  ipcMain.handle('app-package:install', (_event, payload) => appPackageService.installPackage(payload || {}));
  ipcMain.handle('app-package:uninstall', (_event, payload) => appPackageService.uninstallPackage(payload || {}));
  ipcMain.handle('app-package:clear-data', (_event, payload) => appPackageService.clearData(payload || {}));
  ipcMain.handle('mock-data:open-window', () => {
    createMockDataWindow();
    return true;
  });
  ipcMain.handle('mock-data:copy-text', (_event, value) => {
    clipboard.writeText(String(value || '').slice(0, 2_000_000));
    return true;
  });
  ipcMain.handle('mock-data:export-csv', async (event, payload = {}) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const defaultPath = String(payload.fileName || `mock-data-${Date.now()}.csv`).replace(/[\\/:*?"<>|]/g, '-');
    const result = await dialog.showSaveDialog(senderWindow || mainWindow, {
      title: '导出 Mock 数据 CSV',
      defaultPath,
      filters: [
        { name: 'CSV 文件', extensions: ['csv'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePath) return null;
    const content = String(payload.content || '');
    await fsp.writeFile(result.filePath, content.startsWith('\ufeff') ? content : `\ufeff${content}`, 'utf8');
    return { filePath: result.filePath };
  });
  ipcMain.handle('companion-pet:get-settings', () => companionPetSnapshot());
  ipcMain.handle('companion-pet:save-settings', async (_event, settings = {}) => {
    companionPetSettings = normalizeCompanionPetSettings({ ...companionPetSettings, ...settings });
    await saveCompanionPetSettingsToDisk();
    applyCompanionPetSettings();
    return companionPetSnapshot();
  });
  ipcMain.handle('companion-pet:show-now', async () => {
    companionPetSettings = normalizeCompanionPetSettings({ ...companionPetSettings, enabled: true });
    await saveCompanionPetSettingsToDisk();
    applyCompanionPetSettings();
    return companionPetSnapshot();
  });
  ipcMain.handle('companion-pet:hide-now', async () => {
    companionPetSettings = normalizeCompanionPetSettings({ ...companionPetSettings, enabled: false });
    await saveCompanionPetSettingsToDisk();
    applyCompanionPetSettings();
    return companionPetSnapshot();
  });
  ipcMain.handle('companion-pet:walk-now', () => {
    moveCompanionPet(false, true);
    return true;
  });
  ipcMain.handle('companion-pet:drag-start', (_event, point) => startCompanionPetDrag(point || {}));
  ipcMain.handle('companion-pet:drag-move', (_event, point) => dragCompanionPet(point || {}));
  ipcMain.handle('companion-pet:drag-end', () => endCompanionPetDrag());
  ipcMain.handle('capture:get-settings', () => captureSettingsSnapshot());
  ipcMain.handle('capture:save-settings', async (_event, settings) => {
    captureSettings = normalizeCaptureSettings({ ...captureSettings, ...(settings || {}) });
    await saveCaptureSettingsToDisk();
    const shortcutStatus = registerCaptureShortcuts();
    return { settings: captureSettings, shortcutStatus };
  });
  ipcMain.handle('capture:start-screenshot', async () => {
    await createScreenshotSelection();
    return true;
  });
  ipcMain.handle('capture:open-recorder', async () => {
    await createRecordingSelection();
    return true;
  });
  ipcMain.handle('capture:get-payload', (_event, id) => {
    const payload = capturePayloads.get(String(id || ''));
    if (!payload) throw new Error('采集数据已失效，请重新操作');
    return payload;
  });
  ipcMain.handle('capture:selection-cancel', () => {
    closeSelectionWindows();
    return true;
  });
  ipcMain.handle('capture:selection-complete', async (_event, payload) => {
    closeSelectionWindows();
    if (payload?.action === 'record') {
      const region = payload.region || {};
      if (!region.sourceId || !region.sourceRect?.width || !region.sourceRect?.height) throw new Error('录屏区域无效，请重新框选');
      await createRecorderWindow(region);
      return { action: 'record', message: '已创建区域录屏' };
    }
    const dataUrl = String(payload?.dataUrl || '');
    const action = payload?.action || (captureSettings || DEFAULT_CAPTURE_SETTINGS).screenshotAction;
    imageFromDataUrl(dataUrl);
    if (action === 'toolbar') {
      createCapturePreviewWindow(dataUrl);
      return { action: 'preview', message: '已打开截图预览' };
    }
    if (action === 'copy') {
      clipboard.writeImage(imageFromDataUrl(dataUrl));
      notifyCaptureMessage('截图已复制到剪贴板');
      return { action, message: '截图已复制到剪贴板' };
    }
    if (action === 'save') {
      const result = await saveImageDataUrl(dataUrl, mainWindow);
      if (!result.canceled) notifyCaptureMessage('截图已保存');
      return { action, ...result };
    }
    if (action === 'pin') {
      createPinWindow(dataUrl);
      return { action, message: '截图已贴到屏幕' };
    }
    createCaptureEditorWindow(dataUrl);
    return { action: 'editor', message: '已打开截图编辑器' };
  });
  ipcMain.handle('capture:copy-image', (_event, dataUrl) => {
    clipboard.writeImage(imageFromDataUrl(dataUrl));
    return true;
  });
  ipcMain.handle('capture:save-image', async (event, dataUrl) => {
    return saveImageDataUrl(dataUrl, BrowserWindow.fromWebContents(event.sender) || mainWindow);
  });
  ipcMain.handle('capture:pin-image', (_event, dataUrl) => {
    createPinWindow(dataUrl);
    return true;
  });
  ipcMain.handle('capture:open-editor', (_event, dataUrl) => {
    createCaptureEditorWindow(dataUrl);
    return true;
  });
  ipcMain.handle('capture:list-sources', () => listCaptureSources());
  ipcMain.handle('capture:save-video', async (event, data) => {
    return saveVideoBuffer(data, BrowserWindow.fromWebContents(event.sender) || recorderWindow || mainWindow);
  });
  ipcMain.handle('capture:show-recording-border', (_event, region) => {
    createRecordingBorderWindow(region || {});
    return true;
  });
  ipcMain.handle('capture:hide-recording-border', () => {
    closeRecordingBorderWindow();
    return true;
  });
  ipcMain.handle('capture:show-item', (_event, filePath) => {
    if (filePath) shell.showItemInFolder(filePath);
    return true;
  });
  ipcMain.handle('capture:close-current-window', (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (senderWindow && !senderWindow.isDestroyed()) senderWindow.close();
    return true;
  });
}

function configureWindow(window) {
  window.webContents.on('before-input-event', (event, input) => {
    const key = String(input.key || '').toLowerCase();
    const isDevToolsShortcut = input.key === 'F12'
      || (isMac && input.meta && input.alt && key === 'i')
      || (!isMac && input.control && input.shift && key === 'i');
    if (!isDevToolsShortcut) return;
    event.preventDefault();
    window.webContents.toggleDevTools();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
}

function createApplicationMenu() {
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Test cat', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] }
  ]));
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Test cat',
    icon: path.join(__dirname, '../assets/icon.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow = window;

  window.loadFile(path.join(__dirname, 'renderer/index.html'));
  window.once('ready-to-show', () => {
    window.show();
    if (process.argv.includes('--devtools')) window.webContents.openDevTools({ mode: 'detach' });
  });

  configureWindow(window);
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  return window;
}

function createMobileMirrorWindow() {
  if (mobileMirrorWindow && !mobileMirrorWindow.isDestroyed()) {
    if (mobileMirrorWindow.isMinimized()) mobileMirrorWindow.restore();
    mobileMirrorWindow.show();
    mobileMirrorWindow.focus();
    return mobileMirrorWindow;
  }

  const window = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 820,
    minHeight: 600,
    show: false,
    title: '手机投屏 - Test cat',
    icon: path.join(__dirname, '../assets/modules/mobile-mirror.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#f4f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mobileMirrorWindow = window;
  window.loadFile(path.join(__dirname, 'renderer/mobile-mirror.html'));
  window.once('ready-to-show', () => {
    window.show();
    if (process.argv.includes('--devtools')) window.webContents.openDevTools({ mode: 'detach' });
  });
  configureWindow(window);
  window.on('closed', () => {
    if (mobileMirrorWindow === window) mobileMirrorWindow = null;
    mobileMirrorService?.stop();
  });

  return window;
}

function createCalculatorWindow() {
  if (calculatorWindow && !calculatorWindow.isDestroyed()) {
    if (calculatorWindow.isMinimized()) calculatorWindow.restore();
    calculatorWindow.show();
    calculatorWindow.focus();
    return calculatorWindow;
  }

  const window = new BrowserWindow({
    width: 360,
    height: 540,
    minWidth: 340,
    minHeight: 500,
    maxWidth: 440,
    maxHeight: 680,
    show: false,
    title: '计算器 - Test cat',
    icon: path.join(__dirname, '../assets/modules/calculator.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#f4f6f8',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  calculatorWindow = window;
  window.loadFile(path.join(__dirname, 'renderer/calculator.html'));
  window.once('ready-to-show', () => window.show());
  configureWindow(window);
  window.on('closed', () => {
    if (calculatorWindow === window) calculatorWindow = null;
  });

  return window;
}

function createPerformanceMonitorWindow() {
  if (performanceMonitorWindow && !performanceMonitorWindow.isDestroyed()) {
    if (performanceMonitorWindow.isMinimized()) performanceMonitorWindow.restore();
    performanceMonitorWindow.show();
    performanceMonitorWindow.focus();
    return performanceMonitorWindow;
  }

  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: '性能监控 - Test cat',
    icon: path.join(__dirname, '../assets/modules/performance-monitor.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#10151d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  performanceMonitorWindow = window;
  window.loadFile(path.join(__dirname, 'renderer/performance-monitor.html'));
  window.once('ready-to-show', () => {
    window.show();
    if (process.argv.includes('--devtools')) window.webContents.openDevTools({ mode: 'detach' });
  });
  configureWindow(window);
  window.on('closed', () => {
    if (performanceMonitorWindow === window) performanceMonitorWindow = null;
    performanceMonitorService?.stop(false);
  });
  return window;
}

function createWeakNetworkWindow() {
  if (weakNetworkWindow && !weakNetworkWindow.isDestroyed()) {
    if (weakNetworkWindow.isMinimized()) weakNetworkWindow.restore();
    weakNetworkWindow.show();
    weakNetworkWindow.focus();
    return weakNetworkWindow;
  }

  const window = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 900,
    minHeight: 650,
    show: false,
    title: '弱网测试 - Test cat',
    icon: path.join(__dirname, '../assets/modules/weak-network.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#101720',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  weakNetworkWindow = window;
  window.loadFile(path.join(__dirname, 'renderer/weak-network.html'));
  window.once('ready-to-show', () => {
    window.show();
    if (process.argv.includes('--devtools')) window.webContents.openDevTools({ mode: 'detach' });
  });
  configureWindow(window);
  window.on('closed', () => {
    if (weakNetworkWindow === window) weakNetworkWindow = null;
    weakNetworkService?.stop();
  });
  return window;
}

function createFileCompareWindow() {
  if (fileCompareWindow && !fileCompareWindow.isDestroyed()) {
    if (fileCompareWindow.isMinimized()) fileCompareWindow.restore();
    fileCompareWindow.show();
    fileCompareWindow.focus();
    return fileCompareWindow;
  }

  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: '文件对比 - Test cat',
    icon: path.join(__dirname, '../assets/modules/file-compare.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#101720',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  fileCompareWindow = window;
  window.loadFile(path.join(__dirname, 'renderer/file-compare.html'));
  window.once('ready-to-show', () => {
    window.show();
    if (process.argv.includes('--devtools')) window.webContents.openDevTools({ mode: 'detach' });
  });
  configureWindow(window);
  window.on('closed', () => {
    if (fileCompareWindow === window) fileCompareWindow = null;
  });
  return window;
}

function createLogAnalysisWindow() {
  if (logAnalysisWindow && !logAnalysisWindow.isDestroyed()) {
    if (logAnalysisWindow.isMinimized()) logAnalysisWindow.restore();
    logAnalysisWindow.show();
    logAnalysisWindow.focus();
    return logAnalysisWindow;
  }

  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: '日志分析 - Test cat',
    icon: path.join(__dirname, '../assets/modules/log-analysis.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#0e141d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  logAnalysisWindow = window;
  window.loadFile(path.join(__dirname, 'renderer/log-analysis.html'));
  window.once('ready-to-show', () => {
    window.show();
    if (process.argv.includes('--devtools')) window.webContents.openDevTools({ mode: 'detach' });
  });
  configureWindow(window);
  window.on('closed', () => {
    if (logAnalysisWindow === window) logAnalysisWindow = null;
    logAnalysisService?.stop(false);
  });
  return window;
}

function createAppPackageWindow() {
  if (appPackageWindow && !appPackageWindow.isDestroyed()) {
    if (appPackageWindow.isMinimized()) appPackageWindow.restore();
    appPackageWindow.show();
    appPackageWindow.focus();
    return appPackageWindow;
  }

  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 660,
    show: false,
    title: '安装包管理 - Test cat',
    icon: path.join(__dirname, '../assets/modules/app-package.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#0f151e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  appPackageWindow = window;
  window.loadFile(path.join(__dirname, 'renderer/app-package.html'));
  window.once('ready-to-show', () => {
    window.show();
    if (process.argv.includes('--devtools')) window.webContents.openDevTools({ mode: 'detach' });
  });
  configureWindow(window);
  window.on('closed', () => {
    if (appPackageWindow === window) appPackageWindow = null;
  });
  return window;
}

function createMockDataWindow() {
  if (mockDataWindow && !mockDataWindow.isDestroyed()) {
    if (mockDataWindow.isMinimized()) mockDataWindow.restore();
    mockDataWindow.show();
    mockDataWindow.focus();
    return mockDataWindow;
  }

  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 640,
    show: false,
    title: 'Mock 数据生成器 - Test cat',
    icon: path.join(__dirname, '../assets/modules/mock-data.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#0f151e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mockDataWindow = window;
  window.loadFile(path.join(__dirname, 'renderer/mock-data.html'));
  window.once('ready-to-show', () => {
    window.show();
    if (process.argv.includes('--devtools')) window.webContents.openDevTools({ mode: 'detach' });
  });
  configureWindow(window);
  window.on('closed', () => {
    if (mockDataWindow === window) mockDataWindow = null;
  });
  return window;
}

app.whenReady().then(() => {
  app.setName('Test cat');
  createApplicationMenu();
  captureSettings = loadCaptureSettings();
  companionPetSettings = loadCompanionPetSettings();
  mobileMirrorService = new MobileMirrorService({
    appPath: app.getAppPath(),
    onStatus: (status) => {
      for (const window of [mainWindow, mobileMirrorWindow]) {
        if (window && !window.isDestroyed()) window.webContents.send('mobile-mirror:status', status);
      }
    }
  });
  performanceMonitorService = new PerformanceMonitorService({
    onSample: (sample) => {
      if (performanceMonitorWindow && !performanceMonitorWindow.isDestroyed()) performanceMonitorWindow.webContents.send('performance-monitor:sample', sample);
    },
    onStatus: (status) => {
      if (performanceMonitorWindow && !performanceMonitorWindow.isDestroyed()) performanceMonitorWindow.webContents.send('performance-monitor:status', status);
    }
  });
  weakNetworkService = new WeakNetworkService({
    appPath: app.getAppPath(),
    onStatus: (status) => {
      if (weakNetworkWindow && !weakNetworkWindow.isDestroyed()) weakNetworkWindow.webContents.send('weak-network:status', status);
    },
    onStats: (stats) => {
      if (weakNetworkWindow && !weakNetworkWindow.isDestroyed()) weakNetworkWindow.webContents.send('weak-network:stats', stats);
    }
  });
  fileCompareService = new FileCompareService({
    dialog,
    getWindow: () => fileCompareWindow && !fileCompareWindow.isDestroyed() ? fileCompareWindow : mainWindow
  });
  logAnalysisService = new LogAnalysisService({
    dialog,
    getWindow: () => logAnalysisWindow && !logAnalysisWindow.isDestroyed() ? logAnalysisWindow : mainWindow,
    onLogs: (records) => {
      if (logAnalysisWindow && !logAnalysisWindow.isDestroyed()) logAnalysisWindow.webContents.send('log-analysis:logs', records);
    },
    onStatus: (status) => {
      if (logAnalysisWindow && !logAnalysisWindow.isDestroyed()) logAnalysisWindow.webContents.send('log-analysis:status', status);
    }
  });
  appPackageService = new AppPackageService({
    dialog,
    appPath: app.getAppPath(),
    getWindow: () => appPackageWindow && !appPackageWindow.isDestroyed() ? appPackageWindow : mainWindow
  });
  setupIpc();
  registerCaptureShortcuts();
  createWindow();
  applyCompanionPetSettings();

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

app.on('will-quit', () => {
  unregisterCaptureShortcuts();
});

app.on('before-quit', (event) => {
  if (quitCleanupFinished) return;
  event.preventDefault();
  if (quitCleanupStarted) return;
  quitCleanupStarted = true;
  clearCompanionPetTimers();
  Promise.allSettled([
    mobileMirrorService?.dispose(),
    performanceMonitorService?.dispose(),
    weakNetworkService?.dispose(),
    logAnalysisService?.dispose()
  ]).finally(() => {
    quitCleanupFinished = true;
    app.quit();
  });
});
