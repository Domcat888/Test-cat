const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const TASKS = {
  testcases: {
    id: 'testcases',
    taskName: '测试用例生成',
    title: '测试用例生成',
    inputTitle: '需求内容',
    inputSubtitle: '支持拖入文件或手动粘贴，先提取再生成。',
    sourceDefault: '拖入 txt / md / docx / xlsx / 图片文件',
    dropHint: 'Word / Excel 里的图片会作为图片附件交给支持视觉的模型。',
    previewTitle: '需求预览',
    emptyText: '还没有需求内容。点击“打开大编辑器”粘贴需求，或直接拖入需求文件。',
    extraLabel: '附加条件',
    extraPlaceholder: '例如：只关注登录注册；埋点部分不用看；暂不考虑兼容低版本系统。',
    promptPanelTitle: '生成设置',
    promptPanelSubtitle: '提示词优先读取设置；没配置时自动使用推荐模板。',
    promptTitle: '测试用例生成提示词',
    promptEditorTitle: '测试用例提示词设置',
    promptEditorSubtitle: '保存后写入设置，后续生成测试用例会优先读取这里。',
    promptEmpty: '当前使用内置推荐提示词。你也可以点击“编辑提示词”保存自己的用例格式。',
    tip: '为了导出 Excel / XMind 更整齐，建议让 AI 输出 Markdown 表格。',
    actionLabel: '生成测试用例',
    resultTitle: '生成结果',
    resultSubtitle: '结果可复制，也可以导出为 Excel 或 XMind。',
    resultPlaceholder: '生成后的测试用例会显示在这里。',
    outputFilePrefix: 'AI测试用例',
    exportXmind: true,
    outputGuide: '优先输出 Markdown 表格，字段建议包含：模块、用例标题、前置条件、操作步骤、预期结果、优先级、备注。',
    defaultPrompt: [
      '你是资深测试工程师。请根据输入的需求生成测试用例。',
      '要求：',
      '1. 面向真实测试执行，步骤清晰，小白测试同学也能照着做。',
      '2. 覆盖正常流程、异常流程、边界值、兼容性、数据校验和必要的安全/权限场景。',
      '3. 输出 Markdown 表格，字段固定为：模块、用例标题、前置条件、操作步骤、预期结果、优先级、备注。',
      '4. 操作步骤和预期结果要具体，不要只写“验证正常”。'
    ].join('\n'),
    quickTemplates: [
      { label: '功能需求', text: '【功能背景】\n\n【用户入口】\n\n【主要流程】\n1. \n2. \n3. \n\n【验收标准】\n\n【特殊说明】' },
      { label: '接口需求', text: '【接口名称】\n\n【请求方式/路径】\n\n【入参】\n\n【返回字段】\n\n【业务规则】\n\n【异常码】' },
      { label: '活动需求', text: '【活动名称】\n\n【活动时间】\n\n【参与条件】\n\n【奖励规则】\n\n【边界限制】\n\n【后台配置】' }
    ]
  },
  'error-explain': {
    id: 'error-explain',
    taskName: '报错解释',
    title: '报错解释',
    inputTitle: '报错 / 异常内容',
    inputSubtitle: '粘贴安装失败、ADB 报错、logcat 片段、接口异常或截图。',
    sourceDefault: '拖入 log / txt / 截图，或手动粘贴报错',
    dropHint: '支持日志文本和截图；如果是截图，模型支持视觉时会一起分析。',
    previewTitle: '报错预览',
    emptyText: '还没有报错内容。粘贴完整错误、堆栈、接口返回或拖入日志文件。',
    extraLabel: '你想重点知道什么',
    extraPlaceholder: '例如：帮我判断是不是包版本不兼容；告诉我下一步怎么排查；输出小白能看懂的解释。',
    promptPanelTitle: '解释设置',
    promptPanelSubtitle: '默认按“原因 → 影响 → 处理方案”的结构输出。',
    promptTitle: '报错解释提示词',
    promptEditorTitle: '报错解释提示词',
    promptEditorSubtitle: '这里只影响本次 AI 助手窗口，不会覆盖全局测试用例提示词。',
    promptEmpty: '当前使用内置报错解释提示词。',
    tip: '建议粘贴完整报错，不要只截最后一行；完整上下文越多，解释越准。',
    actionLabel: '解释这个报错',
    resultTitle: '解释结果',
    resultSubtitle: '结果可复制，也可以导出 Excel 留档。',
    resultPlaceholder: 'AI 会把报错翻译成原因、影响、排查步骤和建议处理方案。',
    outputFilePrefix: 'AI报错解释',
    exportXmind: false,
    outputGuide: '请按以下结构输出：结论一句话、可能原因、影响范围、给小白的排查步骤、建议修复/处理方案、需要补充的信息。',
    defaultPrompt: [
      '你是测试团队里的报错排查助手。请把输入的错误信息解释成小白也能看懂的内容。',
      '要求：',
      '1. 先用一句话给出最可能结论，不确定时明确写“推测”。',
      '2. 提取关键错误、异常类、错误码、包名、接口名、设备信息等线索。',
      '3. 说明可能原因、影响范围、是否阻塞测试。',
      '4. 给出按顺序执行的排查步骤，尽量可复制、可操作。',
      '5. 不要凭空编造日志里没有的信息。'
    ].join('\n'),
    quickTemplates: [
      { label: '安装失败', text: '【场景】安装包安装失败\n【设备/系统】\n【安装方式】ADB / 工具 / 应用商店\n【完整报错】\n\n【我想知道】失败原因和下一步处理方式' },
      { label: 'ADB 报错', text: '【场景】执行 ADB 命令失败\n【设备状态】adb devices 显示：\n【执行命令】\n【完整报错】\n\n【我想知道】这是什么原因，怎么继续排查' },
      { label: '崩溃堆栈', text: '【场景】App 崩溃 / 闪退\n【复现动作】\n【logcat 堆栈】\n\n【我想知道】关键异常、可能模块、是否可以提 bug' }
    ]
  },
  'bug-report': {
    id: 'bug-report',
    taskName: 'Bug 单生成',
    title: 'Bug 单生成',
    inputTitle: '现象 / 证据材料',
    inputSubtitle: '把你看到的现象、操作步骤、截图、日志、设备信息贴进来。',
    sourceDefault: '拖入截图 / 日志，或手动粘贴现象',
    dropHint: '信息不完整也可以先生成，AI 会标记缺失项。',
    previewTitle: 'Bug 素材预览',
    emptyText: '还没有 Bug 素材。可以先写：我做了什么、看到了什么、期望是什么。',
    extraLabel: '提单偏好',
    extraPlaceholder: '例如：输出禅道风格；标题短一点；严重程度帮我判断；缺少信息请列出来。',
    promptPanelTitle: 'Bug 单设置',
    promptPanelSubtitle: '默认生成“标题、环境、前置条件、步骤、实际/期望、附件、初步定位”。',
    promptTitle: 'Bug 单生成提示词',
    promptEditorTitle: 'Bug 单提示词',
    promptEditorSubtitle: '这里只影响本次 AI 助手窗口，不会覆盖全局测试用例提示词。',
    promptEmpty: '当前使用内置 Bug 单提示词。',
    tip: '如果你贴了设备信息、版本号、logcat，AI 会自动整理进 Bug 单，减少来回追问。',
    actionLabel: '生成 Bug 单',
    resultTitle: 'Bug 单草稿',
    resultSubtitle: '可直接复制到禅道、Tapd、Jira 或企业微信。',
    resultPlaceholder: 'AI 会输出一份可直接提单的 Bug 文案。',
    outputFilePrefix: 'AIBug单',
    exportXmind: false,
    outputGuide: '请输出正式 Bug 单文案，包含：标题、严重程度建议、优先级建议、测试环境、前置条件、复现步骤、实际结果、预期结果、附件/日志、初步定位、缺失信息。',
    defaultPrompt: [
      '你是资深 QA，请把输入材料整理成一份可以直接提交的 Bug 单。',
      '要求：',
      '1. 标题清晰，包含模块、动作和异常结果。',
      '2. 复现步骤要按 1/2/3 编号，小白也能照着复现。',
      '3. 实际结果和预期结果分开写，不要混在一起。',
      '4. 自动提取设备、系统版本、包名、版本号、日志关键错误。',
      '5. 如果材料不足，请在“缺失信息”里列出，不要编造。'
    ].join('\n'),
    quickTemplates: [
      { label: '闪退问题', text: '【问题现象】App 闪退\n【测试环境】\n【版本号】\n【复现步骤】\n1. \n2. \n3. \n【实际结果】\n【预期结果】\n【日志/截图】' },
      { label: '显示异常', text: '【问题现象】页面显示异常\n【页面/入口】\n【设备分辨率】\n【复现步骤】\n1. \n2. \n【实际结果】\n【预期结果】\n【截图说明】' },
      { label: '接口异常', text: '【问题现象】接口异常\n【接口名/路径】\n【触发操作】\n【请求参数】\n【返回结果】\n【预期结果】\n【日志】' }
    ]
  },
  'log-summary': {
    id: 'log-summary',
    taskName: '日志总结',
    title: '日志总结',
    inputTitle: '日志内容',
    inputSubtitle: '粘贴 logcat、服务端日志或业务埋点日志，AI 帮你找重点。',
    sourceDefault: '拖入 .log / .txt，或手动粘贴日志',
    dropHint: '建议至少保留问题发生前后 30 秒日志，分析会更稳。',
    previewTitle: '日志预览',
    emptyText: '还没有日志内容。可以从日志分析模块导出后拖进来，或直接粘贴片段。',
    extraLabel: '关注点',
    extraPlaceholder: '例如：重点看 crash；帮我找接口失败；关注玩家 ID 10086；只总结异常和风险。',
    promptPanelTitle: '总结设置',
    promptPanelSubtitle: '默认输出关键异常、时间线、怀疑原因和下一步排查建议。',
    promptTitle: '日志总结提示词',
    promptEditorTitle: '日志总结提示词',
    promptEditorSubtitle: '这里只影响本次 AI 助手窗口，不会覆盖全局测试用例提示词。',
    promptEmpty: '当前使用内置日志总结提示词。',
    tip: '日志很长也可以先贴关键时间段；如有玩家 ID、接口名、包名，写在关注点里。',
    actionLabel: '总结这段日志',
    resultTitle: '日志总结',
    resultSubtitle: '可复制给开发或保存为排查记录。',
    resultPlaceholder: 'AI 会输出异常摘要、时间线、关键日志和排查建议。',
    outputFilePrefix: 'AI日志总结',
    exportXmind: false,
    outputGuide: '请输出：整体结论、关键时间线、异常/错误列表、疑似根因、影响范围、建议排查动作、可直接转给开发的摘要。',
    defaultPrompt: [
      '你是 Android / 服务端日志分析助手，请从输入日志中提炼测试排查重点。',
      '要求：',
      '1. 先给整体结论，说明是否发现 crash、ANR、接口失败、权限问题或其他风险。',
      '2. 按时间线整理关键事件。',
      '3. 摘出最关键的日志行，不要整段复读。',
      '4. 给出疑似根因和下一步排查建议。',
      '5. 如果日志不足以判断，请明确需要补哪些日志。'
    ].join('\n'),
    quickTemplates: [
      { label: 'Crash 日志', text: '【日志范围】App 崩溃前后 logcat\n【关注包名】\n【复现动作】\n【日志内容】\n' },
      { label: '接口失败', text: '【日志范围】接口请求前后日志\n【接口名/路径】\n【玩家 ID】\n【现象】\n【日志内容】\n' },
      { label: '启动异常', text: '【日志范围】启动 App 前后日志\n【设备/版本】\n【现象】启动慢 / 黑屏 / 闪退 / 卡死\n【日志内容】\n' }
    ]
  }
};

const state = {
  activeTask: 'testcases',
  settingsSnapshot: null,
  requirementText: '',
  requirementImages: [],
  result: '',
  lastFileName: '',
  customPrompts: {}
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

function currentTask() {
  return TASKS[state.activeTask] || TASKS.testcases;
}

function currentPrompt() {
  const task = currentTask();
  if (typeof state.customPrompts[task.id] === 'string') return state.customPrompts[task.id];
  if (task.id === 'testcases') {
    const savedPrompt = String(state.settingsSnapshot?.settings?.testCasePrompt || '').trim();
    return savedPrompt || task.defaultPrompt;
  }
  return task.defaultPrompt;
}

function isUsingBuiltInPrompt() {
  const task = currentTask();
  if (typeof state.customPrompts[task.id] === 'string') return false;
  if (task.id !== 'testcases') return true;
  return !String(state.settingsSnapshot?.settings?.testCasePrompt || '').trim();
}

function renderTaskTabs() {
  $$('.tool-card[data-task]').forEach((card) => {
    card.classList.toggle('active', card.dataset.task === state.activeTask);
  });
}

function renderQuickTemplates() {
  const task = currentTask();
  const container = $('#quick-buttons');
  container.innerHTML = '';
  for (const item of task.quickTemplates || []) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = item.label;
    button.addEventListener('click', () => insertTemplate(item.text));
    container.appendChild(button);
  }
}

function renderTaskChrome() {
  const task = currentTask();
  $('#input-title').textContent = task.inputTitle;
  $('#input-subtitle').textContent = task.inputSubtitle;
  $('#drop-hint').textContent = task.dropHint;
  $('#preview-title').textContent = task.previewTitle;
  $('#extra-label').textContent = task.extraLabel;
  $('#extra-conditions').placeholder = task.extraPlaceholder;
  $('#prompt-panel-title').textContent = task.promptPanelTitle;
  $('#prompt-panel-subtitle').textContent = task.promptPanelSubtitle;
  $('#prompt-title').textContent = task.promptTitle;
  $('#task-tip').textContent = task.tip;
  $('#generate-testcases').textContent = task.actionLabel;
  $('#result-title').textContent = task.resultTitle;
  $('#result-subtitle').textContent = task.resultSubtitle;
  $('#result-text').placeholder = task.resultPlaceholder;
  $('#export-excel').textContent = task.id === 'testcases' ? '导出 Excel' : '导出 Excel';
  $('#export-xmind').classList.toggle('is-hidden', !task.exportXmind);
  if (!state.requirementText.trim() && !state.lastFileName) {
    $('#requirement-source').textContent = task.sourceDefault;
  }
  renderQuickTemplates();
  renderTaskTabs();
  renderRequirementView();
  renderPromptView();
  updateResultButtons();
}

function setActiveTask(taskId) {
  if (!TASKS[taskId]) return;
  state.activeTask = taskId;
  clearResult();
  renderTaskChrome();
  setStatus(state.settingsSnapshot?.ready ? `${currentTask().title}已就绪` : '请先在设置里补齐 AI 配置', state.settingsSnapshot?.ready ? 'done' : 'error');
}

function insertTemplate(text) {
  const template = String(text || '').trim();
  if (!template) return;
  state.requirementText = state.requirementText.trim()
    ? `${state.requirementText.trim()}\n\n---\n${template}`
    : template;
  if (!state.lastFileName) $('#requirement-source').textContent = '已套用快速模板';
  $('#file-status').textContent = '模板已插入';
  renderRequirementView();
  toast('模板已插入，补几处内容就能生成');
}

function renderRequirementView() {
  const task = currentTask();
  const text = state.requirementText || '';
  const hasText = Boolean(text.trim());
  const previewCard = $('.requirement-preview-card');
  previewCard.classList.toggle('empty', !hasText);
  $('#requirement-preview').textContent = hasText ? shortPreview(text) : task.emptyText;
  $('#stat-chars').textContent = formatCount(text.length);
  $('#stat-file').textContent = state.lastFileName || '手动输入';
  $('#stat-images').textContent = formatCount(state.requirementImages.length);
  $('#requirement-image-status').textContent = state.requirementImages.length
    ? `图片附件 ${state.requirementImages.length} 张 · 生成时会随请求发送`
    : '图片附件 0 张';
}

function renderPromptView() {
  const task = currentTask();
  const prompt = currentPrompt();
  const hasPrompt = Boolean(prompt.trim());
  const card = $('.prompt-summary-card');
  card.classList.toggle('empty', !hasPrompt);
  const source = isUsingBuiltInPrompt() ? ' · 内置推荐' : '';
  $('#prompt-length').textContent = `${formatCount(prompt.length)} 字${source}`;
  $('#prompt-preview').textContent = hasPrompt ? shortPreview(prompt, 950) : task.promptEmpty;
  $('#prompt-editor-title').textContent = task.promptEditorTitle;
  $('#prompt-editor-subtitle').textContent = task.promptEditorSubtitle;
}

function updateResultButtons() {
  const task = currentTask();
  const hasResult = Boolean(state.result.trim());
  $('#copy-result').disabled = !hasResult;
  $('#export-excel').disabled = !hasResult;
  $('#export-xmind').disabled = !hasResult || !task.exportXmind;
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
    setStatus('正在提取文件内容…', 'working');
    if (!window.testCat?.aiTestAssistant) throw new Error('请通过本地预览入口运行 Test cat');
    const fileInfo = await window.testCat.aiTestAssistant.selectRequirementFile();
    if (fileInfo) applyRequirementFile(fileInfo);
    setStatus(state.settingsSnapshot?.ready ? 'AI 配置已就绪' : '文件已提取', state.settingsSnapshot?.ready ? 'done' : '');
  } catch (error) {
    setStatus(error.message || '文件提取失败', 'error');
    toast(error.message || '文件提取失败');
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
    setStatus(state.settingsSnapshot?.ready ? 'AI 配置已就绪' : '文件已提取', state.settingsSnapshot?.ready ? 'done' : '');
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
  if (!state.lastFileName) $('#requirement-source').textContent = '手动输入内容';
  $('#file-status').textContent = state.requirementImages.length ? `手动编辑 · 图片 ${state.requirementImages.length} 张` : '手动编辑';
  renderRequirementView();
  closeRequirementEditor();
  toast('内容已更新');
}

function clearRequirement() {
  const task = currentTask();
  state.requirementText = '';
  state.requirementImages = [];
  state.lastFileName = '';
  $('#requirement-source').textContent = task.sourceDefault;
  $('#file-status').textContent = '未选择文件';
  renderRequirementView();
  toast('内容已清空');
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
  const task = currentTask();
  try {
    button.disabled = true;
    const value = $('#prompt-editor-text').value.trim() || task.defaultPrompt;
    if (task.id === 'testcases') {
      if (!window.testCat?.aiTestAssistant) throw new Error('请通过本地预览入口运行 Test cat');
      state.settingsSnapshot = await window.testCat.aiTestAssistant.saveSettings({ testCasePrompt: value });
      delete state.customPrompts[task.id];
      renderConfigPill();
      toast('测试用例提示词已保存到设置');
    } else {
      state.customPrompts[task.id] = value;
      renderPromptView();
      toast(`${task.title}提示词已更新`);
    }
    closePromptEditor();
  } catch (error) {
    toast(error.message || '保存提示词失败');
  } finally {
    button.disabled = false;
  }
}

async function generateCurrentTask() {
  const task = currentTask();
  const button = $('#generate-testcases');
  try {
    if (!window.testCat?.aiTestAssistant) throw new Error('请通过本地预览入口运行 Test cat');
    await loadSettings();
    const inputText = state.requirementText.trim();
    const extraContext = $('#extra-conditions').value.trim();
    const prompt = currentPrompt().trim();
    if (!inputText && !state.requirementImages.length) throw new Error(`请先输入或导入${task.inputTitle}`);
    if (!prompt) throw new Error('请先填写提示词');
    if (state.settingsSnapshot?.settings?.enabled === false) throw new Error('AI 功能已关闭，请先到设置里开启');
    if (!state.settingsSnapshot?.ready) throw new Error('请先到设置里补齐 API Key、Base URL 和 Model');

    button.disabled = true;
    setStatus(`AI 正在处理：${task.title}…`, 'working');
    $('#usage-info').textContent = '生成中，请稍等…';
    const runTask = window.testCat.aiTestAssistant.runTask || window.testCat.aiTestAssistant.generateTestCases;
    const result = await runTask({
      taskName: task.taskName,
      prompt,
      inputText,
      requirementText: inputText,
      extraContext,
      extraConditions: extraContext,
      images: state.requirementImages,
      outputGuide: task.outputGuide
    });
    state.result = result.content || '';
    $('#result-text').value = state.result;
    const usage = result.usage;
    $('#usage-info').textContent = usage?.total_tokens
      ? `生成完成 · Token ${formatCount(usage.total_tokens)}`
      : `生成完成 · ${formatCount(state.result.length)} 字`;
    updateResultButtons();
    setStatus(`${task.title}已完成`, 'done');
    toast(`${task.title}已完成`);
  } catch (error) {
    setStatus(error.message || `${task.title}失败`, 'error');
    $('#usage-info').textContent = error.message || '生成失败';
    toast(error.message || `${task.title}失败`);
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
  const task = currentTask();
  try {
    if (!state.result.trim()) return;
    if (kind === 'xmind' && !task.exportXmind) return toast('当前模块不需要导出 XMind');
    const payload = {
      content: state.result,
      title: state.lastFileName ? `${task.outputFilePrefix}-${state.lastFileName}` : task.outputFilePrefix,
      sheetName: task.title
    };
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

function bindTaskTabs() {
  $$('.tool-card[data-task]').forEach((card) => {
    card.addEventListener('click', () => setActiveTask(card.dataset.task));
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      setActiveTask(card.dataset.task);
    });
  });
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
bindTaskTabs();
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
$('#generate-testcases').addEventListener('click', generateCurrentTask);
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
renderTaskChrome();
loadSettings();
