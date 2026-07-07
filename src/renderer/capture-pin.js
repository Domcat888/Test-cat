const api = window.testCat?.capture;
const query = new URLSearchParams(location.search);
const payloadId = query.get('id');
const image = document.getElementById('pin-image');
const shell = document.getElementById('pin-shell');

let dataUrl = '';

async function init() {
  document.body.dataset.platform = window.testCat?.platform || '';
  const payload = await api.getPayload(payloadId);
  dataUrl = payload.imageDataUrl;
  image.src = dataUrl;
}

document.getElementById('opacity-input').addEventListener('input', (event) => {
  shell.style.opacity = String(Number(event.target.value) / 100);
});

document.getElementById('copy-button').addEventListener('click', async () => {
  await api.copyImage(dataUrl);
});

document.getElementById('save-button').addEventListener('click', async () => {
  await api.saveImage(dataUrl);
});

document.getElementById('edit-button').addEventListener('click', async () => {
  await api.openEditor(dataUrl);
});

document.getElementById('close-button').addEventListener('click', () => api.closeCurrentWindow());

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') api.closeCurrentWindow();
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') api.copyImage(dataUrl);
});

init().catch(() => api?.closeCurrentWindow());
