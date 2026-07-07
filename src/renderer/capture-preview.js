const api = window.testCat?.capture;
const query = new URLSearchParams(location.search);
const payloadId = query.get('id');
const image = document.getElementById('preview-image');
const note = document.getElementById('preview-note');

let dataUrl = '';

function setNote(message) {
  note.textContent = message;
}

async function closePreview(delay = 180) {
  setTimeout(() => api?.closeCurrentWindow(), delay);
}

async function runAction(action) {
  if (!dataUrl || !api) return;
  try {
    if (action === 'copy') {
      await api.copyImage(dataUrl);
      setNote('已复制到剪贴板');
      await closePreview();
      return;
    }
    if (action === 'pin') {
      await api.pinImage(dataUrl);
      setNote('已贴到屏幕');
      await closePreview();
      return;
    }
    if (action === 'editor') {
      await api.openEditor(dataUrl);
      setNote('已打开编辑器');
      await closePreview();
      return;
    }
    if (action === 'save') {
      const result = await api.saveImage(dataUrl);
      if (result?.canceled) {
        setNote('已取消保存');
        return;
      }
      setNote('截图已保存');
      await closePreview();
    }
  } catch (error) {
    setNote(error?.message || '操作失败');
  }
}

document.querySelector('.capture-preview-actions').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  runAction(button.dataset.action);
});

document.getElementById('close-button').addEventListener('click', () => api?.closeCurrentWindow());

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') api?.closeCurrentWindow();
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') runAction('copy');
});

(async () => {
  try {
    if (!api) throw new Error('截图能力未初始化');
    const payload = await api.getPayload(payloadId);
    dataUrl = payload?.imageDataUrl || '';
    if (!dataUrl) throw new Error('截图数据已失效');
    image.src = dataUrl;
    document.body.dataset.platform = window.testCat?.platform || '';
  } catch (error) {
    setNote(error?.message || '无法打开截图预览');
  }
})();
