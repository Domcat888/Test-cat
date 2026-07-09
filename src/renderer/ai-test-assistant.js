const $ = (selector) => document.querySelector(selector);

const state = {
  settingsSnapshot: null,
  requirementText: '',
  requirementImages: [],
  result: '',
  lastFileName: ''
};

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 2200);
}

function setStatus(message, phase = '') {
  const node = $('#title-status');
  node.className = `title-status${phase ? ` ${phase}` : ''}`;
  node.querySelector('span').textContent = message;
}

function formatCount(value) {
  return new Intl.NumberFormat('zh-CN').format(Number(value) || 0);
}

function shortPreview(text = '', max = 1300) {
  const value = String(text || '').trim();
  if (!value) return '';
  return value.length > max ? value.slice(0, max) + `\n\n……已省略 ${formatCount(value.length - max)} 字，点击“大编辑器”查看完整内容。` : value;
}

function currentPrompt() {
  return String(state.settingsSnapshot?.settings?.testCasePrompt || '');
}

function renderRequirementView() {
  const text = state.requirementText || '';
  const hasText = Boolean(text.trim());
  const previewCard = $('.requirement-preview-card');
  previewCard.classList.toggle('empty', !hasText);
  $('#requirement-preview').textContent = hasText
    ? shortPreview(text)
    : '还没有需求内容。点击“打开大编辑器”粘贴需求，或直接拖入需求文件。';
  $('#stat-chars').textContent = formatCount(text.length);
  $('#stat-file').textContent = state.lastFileName || '手动输入';
  $('#stat-images').textContent = formatCount(state.requirementImages.length);
  $('#requirement-image-status').textContent = state.requirementImages.length
    ? `图片附件 ${state.requirementImages.length} 张 · 生成时会随请求发送`
    : '图片附件 0 张';
}

function renderPromptView() {
  const prompt = currentPrompt();
  const hasPrompt = Boolean(prompt.trim());
  const card = $('.prompt-summary-card');
  card.classList.toggle('empty', !hasPrompt);
  $('#prompt-length').textContent = `${formatCount(prompt.length)} 字`;
  $('#prompt-preview').textContent = hasPrompt
    ? shortPreview(prompt, 950)
    : '设置内还没有测试用例提示词，点击“编辑提示词”配置。';
}

function updateResultButtons() {
  const hasResult = Boolean(state.result.trim());
  $('#copy-result').disabled = !hasResult;
  $('#export-excel').disabled = !hasResult;
  $('#export-xmind').disabled = !hasResult;
  $('#clear-result').disabled = !hasResult;
}

function renderConfigPill(snapshot = state.settingsSnapshot) {
  const node = $('#config-pill');
  if (!snapshot?.settings) {
    node.className = 'config-pill';
    node.textContent = '未配置';
    renderPromptView();
    return;
  }
  if (snapshot.settings.enabled === false) {
    node.className = 'config-pill off';
    node.textContent = 'AI 已关闭';
    renderPromptView();
    return;
  }
  if (snapshot.ready) {
    node.className = 'config-pill ready';
    node.textContent = snapshot.settings.model || '已就绪';
    renderPromptView();
    return;
  }
  node.className = 'config-pill';
  node.textContent = '缺少 ' + (snapshot.missing || []).join(' / ');
  renderPromptView();
}

async function loadSettings() {
  try {
    if (!window.testCat?.aiTestAssistant) throw new Error('请通过本地预览入口运行 Test cat');
    state.settingsSnapshot = await window.testCat.aiTestAssistant.getSettings();
    renderConfigPill();
    if (state.settingsSnapshot.ready) setStatus('AI 配置已就绪', 'done');
    else if (state.settingsSnapshot.settings?.enabled === false) setStatus('AI 功能已关闭', 'error');
    else setStatus('请先在设置里补齐 AI 配置', 'error');
  } catch (error) {
    setStatus(error.message || 'AI 配置读取失败', 'error');
    renderConfigPill(null);
  }
}

function applyRequirementFile(fileInfo) {
  if (!fileInfo) return;
  state.lastFileName = fileInfo.fileName || '';
  state.requirementText = fileInfo.text || '';
  state.requirementImages = Array.isArray(fileInfo.images) ? fileInfo.images : [];
  $('#requirement-source').textContent = fileInfo.fileName || '已提取文件';
  const imageText = state.requirementImages.length ? `图片 ${state.requirementImages.length} 张` : '无图片';
  $('#file-status').textContent = fileInfo.truncated ? `文字已截断 · ${imageText}` : `已提取 · ${imageText}`;
  renderRequirementView();
  if (fileInfo.imageWarning) toast(fileInfo.imageWarning);
  else toast(state.requirementImages.length ? `文件已提取，包含 ${state.requirementImages.length} 张图片` : '文件已提取');
}

async function selectRequirementFile() {
  const button = $('#select-file');
  try {
    button.disabled = true;
    setStatus('正在提取需求文件…', 'working');
    if (!window.testCat?.aiTestAssistant) throw new Error('请通过本地预览入口运行 Test cat');
    const fileInfo = await window.testCat.aiTestAssistant.selectRequirementFile();
    if (fileInfo) applyRequirementFile(fileInfo);
    setStatus(state.settingsSnapshot?.ready ? 'AI 配置已就绪' : '需求文件已提取', state.settingsSnapshot?.ready ? 'done' : '');
  } catch (error) {
    setStatus(error.message || '需求文件提取失败', 'error');
    toast(error.message || '需求文件提取失败');
  } finally {
    button.disabled = false;
  }
}

async function extractDroppedFile(file) {
  if (!file) return;
  try {
    const filePath = window.testCat?.aiTestAssistant?.pathForFile?.(file);
    if (!filePath) throw new Error('无法读取拖入文件路径，请使用“选择需求文件”');
    setStatus('正在提取拖入文件…', 'working');
    const fileInfo = await window.testCat.aiTestAssistant.extractRequirementFile(filePath);
    applyRequirementFile(fileInfo);
    setStatus(state.settingsSnapshot?.ready ? 'AI 配置已就绪' : '需求文件已提取', state.settingsSnapshot?.ready ? 'done' : '');
  } catch (error) {
    setStatus(error.message || '拖入文件提取失败', 'error');
    toast(error.message || '拖入文件提取失败');
  }
}

function openRequirementEditor() {
  $('#requirement-editor-text').value = state.requirementText || '';
  updateRequirementEditorCount();
  $('#requirement-modal').hidden = false;
  setTimeout(() => $('#requirement-editor-text').focus(), 0);
}

function closeRequirementEditor() {
  $('#requirement-modal').hidden = true;
}

function updateRequirementEditorCount() {
  $('#requirement-editor-count').textContent = `${formatCount($('#requirement-editor-text').value.length)} 字`;
}

function applyRequirementEditor() {
  state.requirementText = $('#requirement-editor-text').value;
  if (!state.lastFileName) $('#requirement-source').textContent = '手动输入需求';
  $('#file-status').textContent = state.requirementImages.length ? `手动编辑 · 图片 ${state.requirementImages.length} 张` : '手动编辑';
  renderRequirementView();
  closeRequirementEditor();
  toast('需求内容已更新');
}

function clearRequirement() {
  state.requirementText = '';
  state.requirementImages = [];
  state.lastFileName = '';
  $('#requirement-source').textContent = '拖入 txt / md / docx / xlsx / 图片文件';
  $('#file-status').textContent = '未选择文件';
  renderRequirementView();
  toast('需求已清空');
}

function openPromptEditor() {
  $('#prompt-editor-text').value = currentPrompt();
  updatePromptEditorCount();
  $('#prompt-modal').hidden = false;
  setTimeout(() => $('#prompt-editor-text').focus(), 0);
}

function closePromptEditor() {
  $('#prompt-modal').hidden = true;
}

function updatePromptEditorCount() {
  $('#prompt-editor-count').textContent = `${formatCount($('#prompt-editor-text').value.length)} 字`;
}

async function savePromptEditor() {
  const button = $('#save-prompt-editor');
  try {
    button.disabled = true;
    if (!window.testCat?.aiTestAssistant) throw new Error('请通过本地预览入口运行 Test cat');
    state.settingsSnapshot = await window.testCat.aiTestAssistant.saveSettings({
      testCasePrompt: $('#prompt-editor-text').value
    });
    renderConfigPill();
    closePromptEditor();
    toast('提示词已保存到设置');
  } catch (error) {
    toast(error.message || '保存提示词失败');
  } finally {
    button.disabled = false;
  }
}

async function generateTestCases() {
  const button = $('#generate-testcases');
  try {
    if (!window.testCat?.aiTestAssistant) throw new Error('请通过本地预览入口运行 Test cat');
    await loadSettings();
    const requirementText = state.requirementText.trim();
    const extraConditions = $('#extra-conditions').value.trim();
    const prompt = currentPrompt().trim();
    if (!requirementText && !state.requirementImages.length) throw new Error('请先输入或导入需求内容');
    if (!prompt) throw new Error('请先在设置里填写测试用例生成提示词');
    if (state.settingsSnapshot?.settings?.enabled === false) throw new Error('AI 功能已关闭，请先到设置里开启');
    if (!state.settingsSnapshot?.ready) throw new Error('请先到设置里补齐 API Key、Base URL 和 Model');

    button.disabled = true;
    setStatus(state.requirementImages.length ? 'AI 正在结合文字和图片生成测试用例…' : 'AI 正在生成测试用例…', 'working');
    $('#usage-info').textContent = '生成中，请稍等…';
    const result = await window.testCat.aiTestAssistant.generateTestCases({
      requirementText,
      extraConditions,
      prompt,
      images: state.requirementImages
    });
    state.result = result.content || '';
    $('#result-text').value = state.result;
    const usage = result.usage;
    $('#usage-info').textContent = usage?.total_tokens
      ? `生成完成 · Token ${formatCount(usage.total_tokens)}`
      : `生成完成 · ${formatCount(state.result.length)} 字`;
    updateResultButtons();
    setStatus('测试用例已生成', 'done');
    toast('测试用例已生成');
  } catch (error) {
    setStatus(error.message || '测试用例生成失败', 'error');
    $('#usage-info').textContent = error.message || '生成失败';
    toast(error.message || '测试用例生成失败');
  } finally {
    button.disabled = false;
  }
}

async function copyResult() {
  try {
    if (!state.result.trim()) return;
    await window.testCat.aiTestAssistant.copyText(state.result);
    toast('结果已复制');
  } catch (error) {
    toast(error.message || '复制失败');
  }
}

async function exportResult(kind) {
  try {
    if (!state.result.trim()) return;
    const payload = { content: state.result, title: state.lastFileName ? `AI测试用例-${state.lastFileName}` : 'AI测试用例' };
    const result = kind === 'excel'
      ? await window.testCat.aiTestAssistant.exportExcel(payload)
      : await window.testCat.aiTestAssistant.exportXmind(payload);
    if (!result) return toast('已取消导出');
    toast(`已导出 ${result.rows || 0} 条`);
  } catch (error) {
    toast(error.message || '导出失败');
  }
}

function clearResult() {
  state.result = '';
  $('#result-text').value = '';
  $('#usage-info').textContent = '等待生成';
  updateResultButtons();
}

function bindDropZone() {
  const zone = $('#drop-zone');
  ['dragenter', 'dragover'].forEach((type) => {
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      zone.classList.add('dragging');
    });
  });
  ['dragleave', 'drop'].forEach((type) => {
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      if (type === 'drop') extractDroppedFile(event.dataTransfer.files?.[0]);
      zone.classList.remove('dragging');
    });
  });
}

function bindModalBackdrop(id, close) {
  const node = $(id);
  node.addEventListener('click', (event) => {
    if (event.target === node) close();
  });
}

document.body.dataset.platform = window.testCat?.platform || '';
$('#select-file').addEventListener('click', selectRequirementFile);
$('#refresh-settings').addEventListener('click', loadSettings);
$('#open-requirement-editor').addEventListener('click', openRequirementEditor);
$('#close-requirement-editor').addEventListener('click', closeRequirementEditor);
$('#cancel-requirement-editor').addEventListener('click', closeRequirementEditor);
$('#apply-requirement-editor').addEventListener('click', applyRequirementEditor);
$('#clear-requirement').addEventListener('click', clearRequirement);
$('#requirement-editor-text').addEventListener('input', updateRequirementEditorCount);
$('#open-prompt-editor').addEventListener('click', openPromptEditor);
$('#close-prompt-editor').addEventListener('click', closePromptEditor);
$('#cancel-prompt-editor').addEventListener('click', closePromptEditor);
$('#save-prompt-editor').addEventListener('click', savePromptEditor);
$('#prompt-editor-text').addEventListener('input', updatePromptEditorCount);
$('#generate-testcases').addEventListener('click', generateTestCases);
$('#copy-result').addEventListener('click', copyResult);
$('#export-excel').addEventListener('click', () => exportResult('excel'));
$('#export-xmind').addEventListener('click', () => exportResult('xmind'));
$('#clear-result').addEventListener('click', clearResult);
$('#extra-conditions').addEventListener('input', renderRequirementView);
$('#result-text').addEventListener('input', () => {
  state.result = $('#result-text').value;
  updateResultButtons();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!$('#prompt-modal').hidden) closePromptEditor();
  if (!$('#requirement-modal').hidden) closeRequirementEditor();
});
bindModalBackdrop('#requirement-modal', closeRequirementEditor);
bindModalBackdrop('#prompt-modal', closePromptEditor);
bindDropZone();
loadSettings();
renderRequirementView();
renderPromptView();
updateResultButtons();
