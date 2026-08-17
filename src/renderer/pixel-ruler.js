const api = window.testCat?.pixelRuler;
const $ = (selector) => document.querySelector(selector);
let referenceDataUrl = '';
let referenceName = '';

function message(text, error = false) {
  const node = $('#status-message');
  node.textContent = text;
  node.style.color = error ? '#ff7b87' : '';
}

function settingsFromForm() {
  return {
    shortcut: $('#shortcut-input').value.trim(),
    showRulers: $('#show-rulers').checked,
    showGuides: $('#show-guides').checked,
    showMagnifier: $('#show-magnifier').checked
  };
}

function renderSettings(snapshot) {
  const settings = snapshot?.settings || {};
  $('#shortcut-input').value = settings.shortcut || '';
  $('#show-rulers').checked = settings.showRulers !== false;
  $('#show-guides').checked = settings.showGuides !== false;
  $('#show-magnifier').checked = settings.showMagnifier !== false;
  $('#shortcut-message').textContent = snapshot?.shortcutStatus?.message || '未设置快捷键，可使用开始按钮。';
  $('#shortcut-message').style.color = snapshot?.shortcutStatus?.registered ? '#65d8a3' : '';
}

function shortcutFromEvent(event) {
  if (['Backspace', 'Delete', 'Escape'].includes(event.key)) return '';
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return null;
  const modifiers = [];
  if (event.metaKey) modifiers.push(window.testCat?.platform === 'darwin' ? 'Command' : 'Super');
  if (event.ctrlKey) modifiers.push('Ctrl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (!modifiers.length) return null;
  let key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (key === ' ') key = 'Space';
  if (key === 'Enter') key = 'Return';
  return [...modifiers, key].join('+');
}

async function saveSettings() {
  if (!api) throw new Error('屏幕像素尺只能在 Test cat 桌面版中使用。');
  const result = await api.saveSettings(settingsFromForm());
  renderSettings(result);
  return result;
}

$('#shortcut-input').addEventListener('keydown', (event) => {
  event.preventDefault();
  const value = shortcutFromEvent(event);
  if (value === null) return;
  event.currentTarget.value = value;
  $('#shortcut-message').textContent = value ? `待保存：${value}` : '快捷键已清空，保存后只使用开始按钮。';
});

$('#save-shortcut-button').addEventListener('click', async () => {
  try { await saveSettings(); message('设置已保存。'); }
  catch (error) { message(error.message || '设置保存失败。', true); }
});

$('#choose-reference-button').addEventListener('click', () => $('#reference-input').click());
$('#reference-box').addEventListener('dblclick', () => $('#reference-input').click());
$('#reference-input').addEventListener('change', () => {
  const file = $('#reference-input').files?.[0];
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) return message('参考图不能超过 20MB。', true);
  const reader = new FileReader();
  reader.onload = () => {
    referenceDataUrl = String(reader.result || '');
    referenceName = file.name;
    $('#reference-name').textContent = file.name;
    $('#reference-preview').innerHTML = `<img src="${referenceDataUrl}" alt="" />`;
    $('#clear-reference-button').hidden = false;
    message('参考图已载入，开始测量后可调整透明度、位置和大小。');
  };
  reader.onerror = () => message('参考图读取失败。', true);
  reader.readAsDataURL(file);
});

$('#clear-reference-button').addEventListener('click', () => {
  referenceDataUrl = '';
  referenceName = '';
  $('#reference-input').value = '';
  $('#reference-name').textContent = '透明叠加参考图';
  $('#reference-preview').innerHTML = '<span>＋</span>';
  $('#clear-reference-button').hidden = true;
});

$('#start-button').addEventListener('click', async () => {
  const button = $('#start-button');
  button.disabled = true;
  message('正在读取当前屏幕…');
  try {
    const saved = await saveSettings();
    await api.start({ referenceDataUrl, referenceName, settings: saved.settings });
  } catch (error) {
    button.disabled = false;
    message(error.message || '屏幕测量启动失败。', true);
  }
});

api?.onNotice?.((text) => {
  $('#start-button').disabled = false;
  message(text || '可以继续开始新的检测。');
});

(async () => {
  if (!api) return message('请通过 Test cat 本地运行入口打开此模块。', true);
  try { renderSettings(await api.getSettings()); }
  catch (error) { message(error.message || '设置读取失败。', true); }
})();
