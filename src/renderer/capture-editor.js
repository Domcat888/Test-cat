const api = window.testCat?.capture;
const query = new URLSearchParams(location.search);
const payloadId = query.get('id');

const canvas = document.getElementById('editor-canvas');
const context = canvas.getContext('2d');
const colorInput = document.getElementById('color-input');
const sizeInput = document.getElementById('size-input');
const hint = document.getElementById('editor-hint');

let image = null;
let baseDataUrl = '';
let tool = 'pen';
let drawing = false;
let start = null;
let last = null;
let snapshot = null;
let history = [];

function toast(message) {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 2200);
}

function pushHistory() {
  history.push(canvas.toDataURL('image/png'));
  if (history.length > 40) history.shift();
}

function loadDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function fitCanvas() {
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  context.drawImage(image, 0, 0);
}

function pointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height)
  };
}

function applyStyle() {
  context.lineWidth = Number(sizeInput.value);
  context.strokeStyle = colorInput.value;
  context.fillStyle = colorInput.value;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.font = Math.max(18, Number(sizeInput.value) * 5) + 'px PingFang SC, Microsoft YaHei, sans-serif';
}

function restoreSnapshot() {
  if (!snapshot) return;
  context.putImageData(snapshot, 0, 0);
}

function drawArrow(from, to) {
  applyStyle();
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const headLength = Math.max(16, Number(sizeInput.value) * 4);
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
  context.beginPath();
  context.moveTo(to.x, to.y);
  context.lineTo(to.x - headLength * Math.cos(angle - Math.PI / 6), to.y - headLength * Math.sin(angle - Math.PI / 6));
  context.lineTo(to.x - headLength * Math.cos(angle + Math.PI / 6), to.y - headLength * Math.sin(angle + Math.PI / 6));
  context.closePath();
  context.fill();
}

function drawRect(from, to) {
  applyStyle();
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);
  context.strokeRect(x, y, width, height);
}

function drawMosaic(from, to) {
  const x = Math.round(Math.min(from.x, to.x));
  const y = Math.round(Math.min(from.y, to.y));
  const width = Math.round(Math.abs(to.x - from.x));
  const height = Math.round(Math.abs(to.y - from.y));
  if (width < 6 || height < 6) return;
  const block = Math.max(8, Number(sizeInput.value) * 2);
  const data = context.getImageData(x, y, width, height);
  for (let py = 0; py < height; py += block) {
    for (let px = 0; px < width; px += block) {
      const offset = ((py * width) + px) * 4;
      const r = data.data[offset];
      const g = data.data[offset + 1];
      const b = data.data[offset + 2];
      context.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
      context.fillRect(x + px, y + py, block, block);
    }
  }
}

function drawText(point) {
  const value = window.prompt('请输入标注文字');
  if (!value) return;
  applyStyle();
  context.fillText(value.slice(0, 120), point.x, point.y);
  pushHistory();
}

function exportDataUrl() {
  return canvas.toDataURL('image/png');
}

async function init() {
  document.body.dataset.platform = window.testCat?.platform || '';
  if (!api) throw new Error('截图编辑能力未初始化');
  const payload = await api.getPayload(payloadId);
  baseDataUrl = payload.imageDataUrl;
  image = await loadDataUrl(baseDataUrl);
  fitCanvas();
  pushHistory();
}

canvas.addEventListener('pointerdown', (event) => {
  const point = pointFromEvent(event);
  if (tool === 'text') {
    drawText(point);
    return;
  }
  drawing = true;
  start = point;
  last = point;
  snapshot = context.getImageData(0, 0, canvas.width, canvas.height);
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', (event) => {
  if (!drawing || !start) return;
  const point = pointFromEvent(event);
  if (tool === 'pen') {
    applyStyle();
    context.beginPath();
    context.moveTo(last.x, last.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    last = point;
    return;
  }
  restoreSnapshot();
  if (tool === 'rect') drawRect(start, point);
  if (tool === 'arrow') drawArrow(start, point);
  if (tool === 'mosaic') drawMosaic(start, point);
});

canvas.addEventListener('pointerup', (event) => {
  if (!drawing) return;
  drawing = false;
  canvas.releasePointerCapture(event.pointerId);
  snapshot = null;
  pushHistory();
});

document.querySelectorAll('[data-tool]').forEach((button) => {
  button.addEventListener('click', () => {
    tool = button.dataset.tool;
    document.querySelectorAll('[data-tool]').forEach((item) => item.classList.toggle('active', item === button));
    const copy = {
      pen: '画笔：拖拽自由标注。',
      rect: '矩形：拖拽框出问题区域。',
      arrow: '箭头：拖拽指向关注位置。',
      text: '文字：点击图片后输入说明。',
      mosaic: '马赛克：拖拽遮挡敏感信息。'
    };
    hint.textContent = copy[tool] || '拖拽即可标注。';
  });
});

document.getElementById('undo-button').addEventListener('click', async () => {
  if (history.length <= 1) return toast('没有可撤销的标注');
  history.pop();
  const previous = history[history.length - 1];
  image = await loadDataUrl(previous);
  fitCanvas();
  toast('已撤销');
});

document.getElementById('reset-button').addEventListener('click', async () => {
  image = await loadDataUrl(baseDataUrl);
  fitCanvas();
  history = [];
  pushHistory();
  toast('已清空标注');
});

document.getElementById('copy-button').addEventListener('click', async () => {
  await api.copyImage(exportDataUrl());
  toast('截图已复制到剪贴板');
});

document.getElementById('save-button').addEventListener('click', async () => {
  const result = await api.saveImage(exportDataUrl());
  if (result?.canceled) return;
  toast('截图已保存');
});

document.getElementById('pin-button').addEventListener('click', async () => {
  await api.pinImage(exportDataUrl());
  toast('截图已贴到屏幕');
});

document.addEventListener('keydown', async (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    document.getElementById('undo-button').click();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
    event.preventDefault();
    document.getElementById('copy-button').click();
  }
});

init().catch((error) => toast(error.message || '截图编辑器启动失败'));
