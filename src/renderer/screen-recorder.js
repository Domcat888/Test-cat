const api = window.testCat?.capture;
const query = new URLSearchParams(location.search);
const payloadId = query.get('id');

const previewVideo = document.getElementById('preview-video');
const recordCanvas = document.getElementById('record-canvas');
const startButton = document.getElementById('start-button');
const stopButton = document.getElementById('stop-button');
const statusText = document.getElementById('record-status-text');
const recordDot = document.getElementById('record-dot');
const timerNode = document.getElementById('timer');
const saveNote = document.getElementById('save-note');
const openLastButton = document.getElementById('open-last-button');
const regionSize = document.getElementById('region-size');
const regionName = document.getElementById('region-name');

let payload = null;
let region = null;
let rawStream = null;
let recordStream = null;
let recorder = null;
let chunks = [];
let startedAt = 0;
let timer = null;
let lastFilePath = '';
let drawTimer = null;
let crop = null;
let recordingFormat = { mimeType: 'video/webm', extension: 'webm', label: 'WebM' };
let stopping = false;
let streamEndedUnexpectedly = false;

const RECORDING_FPS = 30;
const MIN_RECORDING_MS = 1200;

function toast(message) {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 2200);
}

function friendlyError(error, fallback = '操作失败') {
  const raw = String(error?.message || error || fallback);
  const message = raw.replace(/^Error invoking remote method '[^']+':\s*/i, '').trim();
  if (/Failed to get sources|Permission denied|NotAllowedError/i.test(message)) {
    if (window.testCat?.platform === 'darwin') {
      return '没有屏幕录制权限。请到 macOS 系统设置 → 隐私与安全性 → 屏幕与系统音频录制/屏幕录制，允许 Test cat 或 Electron，然后重启应用。';
    }
    return '没有屏幕录制权限。请确认系统允许 Test cat 录制屏幕，或检查安全软件是否拦截。';
  }
  return message || fallback;
}

function setStatus(text, phase = '') {
  statusText.textContent = text;
  recordDot.dataset.phase = phase;
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(total / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return minutes + ':' + seconds;
}

function recorderFormats() {
  const candidates = [
    { mimeType: 'video/mp4; codecs="avc1.42E01E"', extension: 'mp4', label: 'MP4' },
    { mimeType: 'video/mp4; codecs=avc1.42E01E', extension: 'mp4', label: 'MP4' },
    { mimeType: 'video/mp4; codecs=h264', extension: 'mp4', label: 'MP4' },
    { mimeType: 'video/mp4', extension: 'mp4', label: 'MP4' },
    'video/webm; codecs=vp9',
    'video/webm; codecs=vp8',
    'video/webm'
  ].map((item) => typeof item === 'string' ? { mimeType: item, extension: 'webm', label: 'WebM' } : item);
  return candidates;
}

function formatFromMimeType(mimeType = '') {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('mp4')) return { mimeType, extension: 'mp4', label: 'MP4' };
  return { mimeType: mimeType || 'video/webm', extension: 'webm', label: 'WebM' };
}

function selectRecorderFormat() {
  const supported = recorderFormats().find((item) => MediaRecorder.isTypeSupported(item.mimeType));
  return supported || { mimeType: '', extension: 'webm', label: 'WebM' };
}

function recorderOptions(format) {
  return format?.mimeType ? { mimeType: format.mimeType } : undefined;
}

function updateTimer() {
  timerNode.textContent = formatDuration(Date.now() - startedAt);
}

function setRecordingUi(recording) {
  startButton.disabled = recording || !region;
  stopButton.disabled = !recording;
  document.body.classList.toggle('is-recording', recording);
}

function showRecordingBorder() {
  return api?.showRecordingBorder?.(region).catch(() => {});
}

function hideRecordingBorder() {
  return api?.hideRecordingBorder?.().catch(() => {});
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function computeCrop(videoWidth, videoHeight) {
  const sourceSize = region.screenPixelSize || {};
  const baseWidth = Math.max(1, Number(sourceSize.width) || videoWidth);
  const baseHeight = Math.max(1, Number(sourceSize.height) || videoHeight);
  const sourceRect = region.sourceRect || {};
  const scaleX = videoWidth / baseWidth;
  const scaleY = videoHeight / baseHeight;
  const sx = clamp(Math.round((Number(sourceRect.x) || 0) * scaleX), 0, Math.max(0, videoWidth - 2));
  const sy = clamp(Math.round((Number(sourceRect.y) || 0) * scaleY), 0, Math.max(0, videoHeight - 2));
  const sw = clamp(Math.round((Number(sourceRect.width) || baseWidth) * scaleX), 2, Math.max(2, videoWidth - sx));
  const sh = clamp(Math.round((Number(sourceRect.height) || baseHeight) * scaleY), 2, Math.max(2, videoHeight - sy));
  return { sx, sy, sw, sh };
}

function drawFrame() {
  if (!rawStream || !crop) return;
  const context = recordCanvas.getContext('2d', { alpha: false });
  context.drawImage(previewVideo, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, recordCanvas.width, recordCanvas.height);
}

function startDrawLoop() {
  stopDrawLoop();
  drawFrame();
  drawTimer = setInterval(drawFrame, Math.round(1000 / RECORDING_FPS));
}

function stopDrawLoop() {
  if (drawTimer) clearInterval(drawTimer);
  drawTimer = null;
}

async function waitForVideoReady() {
  if (previewVideo.readyState >= 2 && previewVideo.videoWidth && previewVideo.videoHeight) return;
  await new Promise((resolve, reject) => {
    const timerId = setTimeout(() => reject(new Error('屏幕流启动超时')), 8000);
    previewVideo.onloadedmetadata = () => {
      clearTimeout(timerId);
      resolve();
    };
  });
}

async function startRecording() {
  if (!region || recorder) return;
  try {
    const snapshot = await api.getSettings?.();
    if (snapshot?.settings?.enabled === false) throw new Error('截图与录屏已关闭，请先到设置中开启');
    rawStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: region.sourceId,
          maxFrameRate: 60
        }
      }
    });
    previewVideo.srcObject = rawStream;
    await previewVideo.play().catch(() => {});
    await waitForVideoReady();

    crop = computeCrop(previewVideo.videoWidth, previewVideo.videoHeight);
    recordCanvas.width = crop.sw;
    recordCanvas.height = crop.sh;
    recordStream = recordCanvas.captureStream(RECORDING_FPS);
    startDrawLoop();

    chunks = [];
    stopping = false;
    streamEndedUnexpectedly = false;
    recordingFormat = selectRecorderFormat();
    recorder = new MediaRecorder(recordStream, recorderOptions(recordingFormat));
    recordingFormat = formatFromMimeType(recorder.mimeType || recordingFormat.mimeType);
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size) chunks.push(event.data);
    };
    recorder.onstop = handleRecorderStop;
    recorder.onerror = (event) => {
      streamEndedUnexpectedly = true;
      toast(friendlyError(event.error, '录屏编码异常，已尝试保存已录内容'));
    };
    for (const track of [...rawStream.getVideoTracks(), ...recordStream.getVideoTracks()]) {
      track.addEventListener('ended', () => {
        if (recorder && recorder.state !== 'inactive' && !stopping) {
          streamEndedUnexpectedly = true;
          stopRecording(true);
        }
      }, { once: true });
    }
    recorder.start();
    await showRecordingBorder();

    startedAt = Date.now();
    timer = setInterval(updateTimer, 500);
    updateTimer();
    setRecordingUi(true);
    setStatus('正在录制', 'recording');
    regionSize.textContent = crop.sw + ' × ' + crop.sh;
    const fallbackText = recordingFormat.extension === 'mp4' ? '' : '，当前环境不支持 MP4 编码，已自动回退 WebM';
    saveNote.textContent = '正在录制框选区域：' + crop.sw + ' × ' + crop.sh + ' · ' + recordingFormat.label + fallbackText;
  } catch (error) {
    const message = friendlyError(error, '录制启动失败，请检查屏幕录制权限');
    await hideRecordingBorder();
    stopTracks();
    setRecordingUi(false);
    setStatus('录制启动失败', 'error');
    saveNote.textContent = message;
    toast(message);
  }
}

function stopTracks() {
  stopDrawLoop();
  for (const activeStream of [recordStream, rawStream]) {
    if (activeStream) activeStream.getTracks().forEach((track) => track.stop());
  }
  recordStream = null;
  rawStream = null;
  previewVideo.srcObject = null;
}

async function handleRecorderStop() {
  clearInterval(timer);
  timer = null;
  await hideRecordingBorder();
  stopTracks();
  const blob = new Blob(chunks, { type: recordingFormat.mimeType || (recordingFormat.extension === 'mp4' ? 'video/mp4' : 'video/webm') });
  chunks = [];
  recorder = null;
  stopping = false;
  setRecordingUi(false);
  setStatus('录制已结束');
  if (!blob.size) {
    saveNote.textContent = '录制数据为空，请重试。';
    return toast('录制数据为空');
  }
  try {
    const result = await api.saveVideo(await blob.arrayBuffer(), {
      mimeType: blob.type || recordingFormat.mimeType,
      extension: recordingFormat.extension
    });
    if (result?.canceled) {
      saveNote.textContent = '录制已结束，但没有保存文件。';
      return;
    }
    lastFilePath = result.filePath;
    openLastButton.disabled = false;
    document.body.classList.add('has-saved-video');
    saveNote.textContent = (streamEndedUnexpectedly ? '录屏来源提前结束，已保存现有内容：' : '录屏已保存：') + result.filePath;
    toast('录屏已保存');
  } catch (error) {
    const message = friendlyError(error, '保存录屏失败');
    saveNote.textContent = '保存录屏失败：' + message;
    toast(message);
  }
}

function stopRecording(force = false) {
  if (!recorder || stopping) return;
  const elapsed = startedAt ? Date.now() - startedAt : 0;
  if (!force && elapsed < MIN_RECORDING_MS) {
    stopping = true;
    setStatus('正在完成首段录制', 'pending');
    stopButton.disabled = true;
    setTimeout(() => {
      stopping = false;
      stopRecording();
    }, MIN_RECORDING_MS - elapsed);
    return;
  }
  stopping = true;
  hideRecordingBorder();
  try { if (recorder.state === 'recording') recorder.requestData(); } catch {}
  recorder.stop();
  setStatus('正在保存录屏', 'pending');
  stopButton.disabled = true;
}

async function loadRegion() {
  if (!api) throw new Error('录屏能力未初始化');
  payload = await api.getPayload(payloadId);
  region = payload?.region || null;
  if (!region?.sourceId || !region?.sourceRect?.width || !region?.sourceRect?.height) {
    throw new Error('录屏区域无效，请重新框选');
  }
  const rect = region.sourceRect;
  regionSize.textContent = rect.width + ' × ' + rect.height;
  regionName.textContent = region.displayName || region.sourceName || '当前屏幕区域';
  setStatus('区域已选择');
  saveNote.textContent = '即将自动开始录制，录制时红色边框会保持可见。';
  setRecordingUi(false);
  setTimeout(startRecording, 450);
}

startButton.addEventListener('click', startRecording);
stopButton.addEventListener('click', () => stopRecording());
openLastButton.addEventListener('click', () => lastFilePath && api.showItem(lastFilePath));
document.getElementById('close-button').addEventListener('click', () => {
  if (recorder) stopRecording();
  else {
    hideRecordingBorder();
    api.closeCurrentWindow();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && recorder) stopRecording();
  else if (event.key === 'Escape') api.closeCurrentWindow();
});

window.addEventListener('beforeunload', () => {
  hideRecordingBorder();
  try {
    if (recorder && recorder.state !== 'inactive') {
      try { if (recorder.state === 'recording') recorder.requestData(); } catch {}
      recorder.stop();
    }
    else stopTracks();
  } catch {
    stopTracks();
  }
});

document.body.dataset.platform = window.testCat?.platform || '';
loadRegion().catch((error) => {
  const message = friendlyError(error, '录屏启动失败');
  setStatus('录屏启动失败', 'error');
  saveNote.textContent = message;
  toast(message);
});
