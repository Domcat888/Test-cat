const api = window.testCat?.capture;
const query = new URLSearchParams(location.search);
const payloadId = query.get('id');

const root = document.getElementById('selection-root');
const image = document.getElementById('screen-image');
const box = document.getElementById('selection-box');
const sizeLabel = document.getElementById('selection-size');
const toolbar = document.getElementById('selection-toolbar');
const tip = document.getElementById('selection-tip');
const crosshairX = document.getElementById('crosshair-x');
const crosshairY = document.getElementById('selection-crosshair-y') || document.getElementById('crosshair-y');
const doneButton = document.getElementById('selection-done-button');
const editorButton = document.getElementById('selection-editor-button');
const copyButton = toolbar.querySelector('button[data-action="copy"]');
const pinButton = toolbar.querySelector('button[data-action="pin"]');
const saveButton = toolbar.querySelector('button[data-action="save"]');
const cancelButton = toolbar.querySelector('button[data-action="cancel"]');

const MIN_SELECTION_SIZE = 8;
const RECORD_AUTO_START_MS = 1100;

let payload = null;
let interaction = null;
let selection = null;
let sourceImage = null;
let autoRecordTimer = null;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pointFromEvent(event) {
  return { x: event.clientX, y: event.clientY };
}

function normalizeRect(a, b) {
  const left = clamp(Math.min(a.x, b.x), 0, window.innerWidth);
  const top = clamp(Math.min(a.y, b.y), 0, window.innerHeight);
  const right = clamp(Math.max(a.x, b.x), 0, window.innerWidth);
  const bottom = clamp(Math.max(a.y, b.y), 0, window.innerHeight);
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  };
}

function rectIsValid(rect) {
  return Boolean(rect && rect.width >= MIN_SELECTION_SIZE && rect.height >= MIN_SELECTION_SIZE);
}

function isRecordingMode() {
  return payload?.selectionMode === 'recording';
}

function defaultScreenshotAction() {
  return payload?.defaultAction || 'toolbar';
}

function storageKey() {
  return `test-cat.capture.selection.${payload?.selectionMode || 'screenshot'}.${payload?.displayId || payloadId || 'display'}`;
}

function rememberSelection(rect = selection) {
  if (!rectIsValid(rect)) return;
  try {
    localStorage.setItem(storageKey(), JSON.stringify({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }));
  } catch {}
}

function restoreSelection() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey()) || 'null');
    if (!parsed) return;
    const restored = {
      x: clamp(Number(parsed.x) || 0, 0, window.innerWidth - MIN_SELECTION_SIZE),
      y: clamp(Number(parsed.y) || 0, 0, window.innerHeight - MIN_SELECTION_SIZE),
      width: clamp(Number(parsed.width) || 0, MIN_SELECTION_SIZE, window.innerWidth),
      height: clamp(Number(parsed.height) || 0, MIN_SELECTION_SIZE, window.innerHeight)
    };
    restored.width = Math.min(restored.width, window.innerWidth - restored.x);
    restored.height = Math.min(restored.height, window.innerHeight - restored.y);
    if (!rectIsValid(restored)) return;
    updateBox(restored);
    showToolbar(restored, { autoRecord: false });
    tip.querySelector('span').textContent = isRecordingMode()
      ? '已带出上次区域：拖边可调整，Enter 或双击开始录制。'
      : '已带出上次区域：拖边可调整，Enter 或双击完成截图。';
  } catch {}
}

function clearAutoRecordTimer() {
  if (autoRecordTimer) {
    clearTimeout(autoRecordTimer);
    autoRecordTimer = null;
  }
  if (isRecordingMode() && doneButton) doneButton.textContent = '开始录制';
}

function scheduleAutoRecord() {
  if (!isRecordingMode()) return;
  clearAutoRecordTimer();
  doneButton.textContent = '开始录制 · 自动';
  autoRecordTimer = setTimeout(() => {
    autoRecordTimer = null;
    finish('record').catch(() => api?.selectionCancel());
  }, RECORD_AUTO_START_MS);
}

function updateBox(rect) {
  selection = rect;
  const visible = rectIsValid(rect);
  box.classList.toggle('visible', visible);
  if (!visible) {
    toolbar.classList.remove('visible');
    return;
  }
  box.style.left = rect.x + 'px';
  box.style.top = rect.y + 'px';
  box.style.width = rect.width + 'px';
  box.style.height = rect.height + 'px';
  const scaleX = sourceImage ? sourceImage.naturalWidth / window.innerWidth : (payload?.scaleFactor || window.devicePixelRatio || 1);
  const scaleY = sourceImage ? sourceImage.naturalHeight / window.innerHeight : (payload?.scaleFactor || window.devicePixelRatio || 1);
  sizeLabel.textContent = Math.round(rect.width * scaleX) + ' × ' + Math.round(rect.height * scaleY);
}

function configureToolbar() {
  if (isRecordingMode()) {
    doneButton.dataset.action = 'record';
    doneButton.textContent = '开始录制';
    editorButton.hidden = true;
    copyButton.hidden = false;
    copyButton.dataset.action = 'reset';
    copyButton.textContent = '重选';
    pinButton.hidden = true;
    saveButton.hidden = true;
    cancelButton.textContent = '取消';
    return;
  }
  doneButton.dataset.action = 'toolbar';
  doneButton.textContent = '完成';
  editorButton.hidden = false;
  copyButton.hidden = false;
  copyButton.dataset.action = 'copy';
  copyButton.textContent = '复制';
  pinButton.hidden = false;
  saveButton.hidden = false;
  cancelButton.textContent = '取消';
}

function showToolbar(rect, options = {}) {
  if (!rectIsValid(rect)) return;
  configureToolbar();
  const toolbarWidth = Math.min(420, toolbar.offsetWidth || 380);
  let left = rect.x;
  let top = rect.y + rect.height + 8;
  if (left + toolbarWidth > window.innerWidth - 8) left = window.innerWidth - toolbarWidth - 8;
  if (top + 46 > window.innerHeight) top = rect.y - 48;
  toolbar.style.left = Math.max(8, left) + 'px';
  toolbar.style.top = Math.max(8, top) + 'px';
  toolbar.classList.add('visible');
  if (options.autoRecord) scheduleAutoRecord();
}

function hideToolbar() {
  clearAutoRecordTimer();
  toolbar.classList.remove('visible');
}

function updateCrosshair(event) {
  crosshairX.style.top = event.clientY + 'px';
  crosshairY.style.left = event.clientX + 'px';
}

async function loadPayload() {
  if (!api) throw new Error('截图能力未初始化');
  payload = await api.getPayload(payloadId);
  document.body.dataset.platform = window.testCat?.platform || '';
  if (isRecordingMode()) {
    tip.querySelector('strong').textContent = '框选录屏区域';
    tip.querySelector('span').textContent = '拖拽选择要录制的区域，松手后可调整，Esc 取消。';
  }
  image.src = payload.imageDataUrl;
  sourceImage = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = payload.imageDataUrl;
  });
  restoreSelection();
}

function cropSelection(rect) {
  if (!sourceImage || !rectIsValid(rect)) return '';
  const scaleX = sourceImage.naturalWidth / window.innerWidth;
  const scaleY = sourceImage.naturalHeight / window.innerHeight;
  const sx = Math.round(rect.x * scaleX);
  const sy = Math.round(rect.y * scaleY);
  const sw = Math.max(1, Math.round(rect.width * scaleX));
  const sh = Math.max(1, Math.round(rect.height * scaleY));
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const context = canvas.getContext('2d');
  context.drawImage(sourceImage, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL('image/png');
}

function recordingRegion(rect) {
  if (!sourceImage || !rectIsValid(rect)) return null;
  const scaleX = sourceImage.naturalWidth / window.innerWidth;
  const scaleY = sourceImage.naturalHeight / window.innerHeight;
  const sourceRect = {
    x: Math.round(rect.x * scaleX),
    y: Math.round(rect.y * scaleY),
    width: Math.max(1, Math.round(rect.width * scaleX)),
    height: Math.max(1, Math.round(rect.height * scaleY))
  };
  return {
    sourceId: payload.sourceId,
    sourceName: payload.sourceName || payload.displayName || '屏幕',
    displayId: payload.displayId,
    displayName: payload.displayName || payload.sourceName || '屏幕',
    bounds: payload.bounds,
    scaleFactor: payload.scaleFactor || window.devicePixelRatio || 1,
    screenPixelSize: payload.screenPixelSize || { width: sourceImage.naturalWidth, height: sourceImage.naturalHeight },
    dipRect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    },
    sourceRect
  };
}

async function finish(action = 'editor') {
  clearAutoRecordTimer();
  if (action === 'record') {
    const region = recordingRegion(selection);
    if (!region) return;
    rememberSelection();
    await api.selectionComplete({ action: 'record', region });
    return;
  }
  const dataUrl = cropSelection(selection);
  if (!dataUrl) return;
  rememberSelection();
  await api.selectionComplete({ dataUrl, action });
}

function moveRect(startRect, startPoint, currentPoint) {
  const dx = currentPoint.x - startPoint.x;
  const dy = currentPoint.y - startPoint.y;
  return {
    x: clamp(startRect.x + dx, 0, window.innerWidth - startRect.width),
    y: clamp(startRect.y + dy, 0, window.innerHeight - startRect.height),
    width: startRect.width,
    height: startRect.height
  };
}

function resizeRect(startRect, handle, currentPoint) {
  let left = startRect.x;
  let top = startRect.y;
  let right = startRect.x + startRect.width;
  let bottom = startRect.y + startRect.height;

  if (handle.includes('w')) left = clamp(currentPoint.x, 0, right - MIN_SELECTION_SIZE);
  if (handle.includes('e')) right = clamp(currentPoint.x, left + MIN_SELECTION_SIZE, window.innerWidth);
  if (handle.includes('n')) top = clamp(currentPoint.y, 0, bottom - MIN_SELECTION_SIZE);
  if (handle.includes('s')) bottom = clamp(currentPoint.y, top + MIN_SELECTION_SIZE, window.innerHeight);

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

function resetSelection() {
  clearAutoRecordTimer();
  selection = null;
  box.classList.remove('visible');
  toolbar.classList.remove('visible');
  tip.style.display = '';
}

root.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || event.target.closest('.selection-toolbar')) return;
  const point = pointFromEvent(event);
  const handle = event.target.closest('.selection-handle')?.dataset.handle;
  const isInsideBox = Boolean(event.target.closest('#selection-box') && rectIsValid(selection));

  hideToolbar();
  tip.style.display = 'none';

  if (handle && rectIsValid(selection)) {
    interaction = { type: 'resize', handle, startPoint: point, startRect: { ...selection } };
  } else if (isInsideBox) {
    interaction = { type: 'move', startPoint: point, startRect: { ...selection } };
  } else {
    interaction = { type: 'new', startPoint: point };
    updateBox({ x: point.x, y: point.y, width: 0, height: 0 });
  }

  root.setPointerCapture(event.pointerId);
});

root.addEventListener('pointermove', (event) => {
  updateCrosshair(event);
  if (!interaction) return;
  const point = pointFromEvent(event);
  if (interaction.type === 'new') updateBox(normalizeRect(interaction.startPoint, point));
  if (interaction.type === 'move') updateBox(moveRect(interaction.startRect, interaction.startPoint, point));
  if (interaction.type === 'resize') updateBox(resizeRect(interaction.startRect, interaction.handle, point));
});

root.addEventListener('pointerup', (event) => {
  if (!interaction) return;
  const completedInteraction = interaction;
  interaction = null;
  try { root.releasePointerCapture(event.pointerId); } catch {}

  if (!rectIsValid(selection)) {
    resetSelection();
    return;
  }

  rememberSelection();
  if (isRecordingMode()) {
    showToolbar(selection, { autoRecord: completedInteraction.type === 'new' });
    return;
  }

  const action = defaultScreenshotAction();
  if (action && action !== 'toolbar' && completedInteraction.type === 'new') {
    finish(action).catch(() => api?.selectionCancel());
    return;
  }
  showToolbar(selection);
});

root.addEventListener('dblclick', (event) => {
  if (event.target.closest('.selection-toolbar') || !rectIsValid(selection)) return;
  const action = isRecordingMode() ? 'record' : defaultScreenshotAction();
  finish(action).catch(() => api?.selectionCancel());
});

toolbar.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'cancel') return api.selectionCancel();
  if (action === 'reset') return resetSelection();
  try {
    await finish(action);
  } catch {
    await api.selectionCancel();
  }
});

document.addEventListener('keydown', async (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    clearAutoRecordTimer();
    await api.selectionCancel();
  }
  if (event.key === 'Enter' && rectIsValid(selection)) {
    event.preventDefault();
    if (isRecordingMode()) {
      await finish('record');
      return;
    }
    await finish(defaultScreenshotAction());
  }
});

loadPayload().catch(() => api?.selectionCancel());
