const STORAGE_KEY = 'test-cat-modules-v1';
const THEME_KEY = 'test-cat-theme';
const TOOL_ORDER_KEY = 'test-cat-tool-order-v1';
const PLATFORM_FOLDER_KEY = 'test-cat-platform-folders-v1';
const TODO_KEY = 'test-cat-todos-v1';
const BUILT_IN_TOOL_IDS = ['mobile-mirror', 'ios-mirror', 'ios-performance', 'calculator', 'performance-monitor', 'weak-network', 'file-compare', 'log-analysis', 'app-package', 'mock-data', 'timestamp-converter', 'formula-calculator', 'ai-test-assistant'];
const ANDROID_TOOL_IDS = ['mobile-mirror', 'performance-monitor', 'weak-network', 'log-analysis'];
const IOS_TOOL_IDS = ['ios-mirror', 'ios-performance'];
const PLATFORM_TOOL_IDS = new Set([...ANDROID_TOOL_IDS, ...IOS_TOOL_IDS]);

const state = {
  modules: loadModules(),
  toolOrder: loadJson(TOOL_ORDER_KEY, []),
  todos: loadJson(TODO_KEY, []),
  page: 'home',
  filter: 'all',
  todoFilter: 'all',
  collapsedFolders: new Set(loadJson(PLATFORM_FOLDER_KEY, [])),
  draggingToolId: null,
  dragOccurred: false
};

const pageCopy = {
  home: ['亲爱的列文虎克', '准备好开始今天的测试了吗？'],
  modules: ['我的测试工具', '管理你的测试工具入口'],
  todo: ['测试任务清单', '把今天要验证的事情一项项拿下'],
  settings: ['设置', '调整 Test cat 的使用偏好']
};

const TODO_PRIORITY_WEIGHT = { high: 0, normal: 1, low: 2 };
const TODO_PRIORITY_LABEL = { high: '高优先', normal: '普通', low: '低优先' };
const TODO_REMINDER_OFFSETS = [30, 10, 5];
const THEMES = ['light', 'dark', 'purple'];
const todoReminderTimers = new Map();

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function loadModules() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function loadJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function saveModules() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.modules));
}

function saveToolOrder() {
  localStorage.setItem(TOOL_ORDER_KEY, JSON.stringify(state.toolOrder));
}

function saveTodos() {
  localStorage.setItem(TODO_KEY, JSON.stringify(state.todos));
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

function todoCreatedWeight(todo) {
  const idTime = Number(String(todo.id || '').split('-')[0]);
  if (Number.isFinite(idTime)) return idTime;
  const parsed = Date.parse(todo.createdAt || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortedTodos(todos) {
  return [...todos].sort((left, right) => {
    if (left.done !== right.done) return left.done ? 1 : -1;
    const priorityDelta = (TODO_PRIORITY_WEIGHT[left.priority] ?? TODO_PRIORITY_WEIGHT.normal)
      - (TODO_PRIORITY_WEIGHT[right.priority] ?? TODO_PRIORITY_WEIGHT.normal);
    if (priorityDelta) return priorityDelta;
    return todoCreatedWeight(right) - todoCreatedWeight(left);
  });
}

function todoDateTimeInputValue(date = new Date()) {
  const value = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return value.toISOString().slice(0, 16);
}

function normalizeTodoDueAt(value) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp).toISOString();
}

function formatTodoDueAt(value) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp));
}

function todoDueState(todo) {
  const dueTime = Date.parse(todo?.dueAt || '');
  if (!Number.isFinite(dueTime)) return '';
  const diffMs = dueTime - Date.now();
  if (diffMs <= 0) return '已到时间';
  const minutes = Math.ceil(diffMs / 60000);
  if (minutes < 60) return `还差 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return `还差 ${hours} 小时${rest ? ` ${rest} 分钟` : ''}`;
  const days = Math.floor(hours / 24);
  return `还差 ${days} 天 ${hours % 24} 小时`;
}

function todoMetaHtml(todo) {
  const parts = [];
  if (todo.createdAt) parts.push(`创建 ${escapeHtml(todo.createdAt)}`);
  if (todo.dueAt) {
    const dueText = formatTodoDueAt(todo.dueAt);
    const dueState = todoDueState(todo);
    parts.push(`<b>闹钟 ${escapeHtml(dueText)}${dueState ? ` · ${escapeHtml(dueState)}` : ''}</b>`);
  } else {
    parts.push('未设置闹钟');
  }
  return parts.join(' · ');
}

function clearTodoReminderTimers() {
  for (const timer of todoReminderTimers.values()) clearTimeout(timer);
  todoReminderTimers.clear();
}

function markTodoReminderSent(todo, minutesLeft) {
  const sent = new Set(Array.isArray(todo.remindedOffsets) ? todo.remindedOffsets.map(Number) : []);
  sent.add(Number(minutesLeft));
  todo.remindedOffsets = [...sent].filter(Number.isFinite).sort((left, right) => right - left);
}

async function sendTodoReminder(todoId, minutesLeft) {
  const todo = state.todos.find((item) => item.id === todoId);
  if (!todo || todo.done) return;
  const dueTime = Date.parse(todo.dueAt || '');
  if (!Number.isFinite(dueTime) || dueTime <= Date.now()) return;
  const sent = new Set(Array.isArray(todo.remindedOffsets) ? todo.remindedOffsets.map(Number) : []);
  if (sent.has(minutesLeft)) return;
  markTodoReminderSent(todo, minutesLeft);
  saveTodos();
  renderTodos();
  const dueText = formatTodoDueAt(todo.dueAt);
  const priority = TODO_PRIORITY_LABEL[todo.priority] || TODO_PRIORITY_LABEL.normal;
  const message = `任务「${todo.text}」还差 ${minutesLeft} 分钟到时间（${dueText}）。优先级：${priority}。`;
  try {
    await window.testCat?.companionPet?.remindTodo?.({
      title: `待办提醒 · 还差 ${minutesLeft} 分钟`,
      message,
      todoText: todo.text,
      minutesLeft,
      dueAt: todo.dueAt,
      priority: todo.priority
    });
  } catch (error) {
    toast(error.message || message);
  }
}

function scheduleTodoReminders() {
  clearTodoReminderTimers();
  const now = Date.now();
  for (const todo of state.todos) {
    if (todo.done || !todo.dueAt) continue;
    const dueTime = Date.parse(todo.dueAt);
    if (!Number.isFinite(dueTime) || dueTime <= now) continue;
    const sent = new Set(Array.isArray(todo.remindedOffsets) ? todo.remindedOffsets.map(Number) : []);
    for (const minutesLeft of TODO_REMINDER_OFFSETS) {
      if (sent.has(minutesLeft)) continue;
      const delay = dueTime - minutesLeft * 60 * 1000 - now;
      if (delay < -60_000) continue;
      if (delay > 2_147_483_647) continue;
      const timerKey = `${todo.id}:${minutesLeft}`;
      const timer = setTimeout(() => sendTodoReminder(todo.id, minutesLeft), Math.max(0, delay));
      todoReminderTimers.set(timerKey, timer);
    }
  }
}

function updateTodoDueMin() {
  const input = $('#todo-due');
  if (input) input.min = todoDateTimeInputValue(new Date(Date.now() + 60_000));
}

function moduleCard(module, sortable = false) {
  return `
    <article class="module-card custom-module-card${sortable ? ' sortable-tool' : ''}" data-id="${escapeHtml(module.id)}" data-open="${escapeHtml(module.id)}" role="button" tabindex="0"${sortable ? ` data-tool-id="${escapeHtml(module.id)}" draggable="true"` : ''}>
      <button class="module-menu" data-delete="${escapeHtml(module.id)}" title="删除模块" aria-label="删除 ${escapeHtml(module.name)}">×</button>
      <div class="module-icon ${escapeHtml(module.color)}">${escapeHtml(module.name.slice(0, 1).toUpperCase())}</div>
      <h3>${escapeHtml(module.name)}</h3>
      <p>${escapeHtml(module.description || '尚未连接测试工具，可在后续版本中继续完善。')}</p>
      <div class="module-meta"><span class="module-tag">${escapeHtml(module.category)}</span></div>
    </article>`;
}

function mobileMirrorCard() {
  return `
    <article class="module-card built-in-module sortable-tool" data-open-mobile-mirror data-tool-id="mobile-mirror" draggable="true" role="button" tabindex="0">
      <div class="module-picture"><img src="../../assets/modules/mobile-mirror.png" alt="安卓投屏" /></div>
      <span class="built-in-badge">内置工具</span>
      <h3>安卓投屏</h3>
      <p>连接 Android 手机，直接在 Test cat 中查看并控制手机画面。</p>
      <div class="module-meta"><span class="module-tag">Android</span></div>
    </article>`;
}

function iosMirrorCard() {
  return `
    <article class="module-card built-in-module sortable-tool" data-open-ios-mirror data-tool-id="ios-mirror" draggable="true" role="button" tabindex="0">
      <div class="module-picture"><img src="../../assets/modules/ios-mirror.png" alt="iOS 投屏" /></div>
      <span class="built-in-badge">内置工具</span>
      <h3>iOS 投屏</h3>
      <p>通过 USB 连接 iPhone，在 Test cat 中跨平台查看实时画面。</p>
      <div class="module-meta"><span class="module-tag">iOS</span></div>
    </article>`;
}

function calculatorCard() {
  return `
    <article class="module-card built-in-module sortable-tool" data-open-calculator data-tool-id="calculator" draggable="true" role="button" tabindex="0">
      <div class="module-picture"><img src="../../assets/modules/calculator.png" alt="计算器" /></div>
      <span class="built-in-badge">内置工具</span>
      <h3>计算器</h3>
      <p>独立小窗口计算器，支持键盘输入、四则运算和括号。</p>
      <div class="module-meta"><span class="module-tag">效率工具</span></div>
    </article>`;
}

function performanceMonitorCard() {
  return `
    <article class="module-card built-in-module sortable-tool" data-open-performance-monitor data-tool-id="performance-monitor" draggable="true" role="button" tabindex="0">
      <div class="module-picture"><img src="../../assets/modules/performance-monitor.png" alt="安卓性能监控" /></div>
      <span class="built-in-badge">内置工具</span>
      <h3>安卓性能监控</h3>
      <p>实时采集 Android CPU、内存、GPU、网络、磁盘和应用性能。</p>
      <div class="module-meta"><span class="module-tag">性能测试</span></div>
    </article>`;
}

function iosPerformanceCard() {
  return `
    <article class="module-card built-in-module sortable-tool" data-open-ios-performance data-tool-id="ios-performance" draggable="true" role="button" tabindex="0">
      <div class="module-picture"><img src="../../assets/modules/performance-monitor.png" alt="iOS 性能监控" /></div>
      <span class="built-in-badge">内置工具</span>
      <h3>iOS 性能监控</h3>
      <p>跨 Windows 和 macOS 采集 iPhone CPU、内存、温度、FPS、GPU 与 App 进程指标。</p>
      <div class="module-meta"><span class="module-tag">iOS 性能</span></div>
    </article>`;
}

function weakNetworkCard() {
  return `
    <article class="module-card built-in-module sortable-tool" data-open-weak-network data-tool-id="weak-network" draggable="true" role="button" tabindex="0">
      <div class="module-picture"><img src="../../assets/modules/weak-network.png" alt="弱网测试" /></div>
      <span class="built-in-badge">内置工具</span>
      <h3>弱网测试</h3>
      <p>ADB 一键开启手机弱网，模拟深山、电梯、地铁等真实场景。</p>
      <div class="module-meta"><span class="module-tag">网络测试</span></div>
    </article>`;
}

function fileCompareCard() {
  return `
    <article class="module-card built-in-module sortable-tool" data-open-file-compare data-tool-id="file-compare" draggable="true" role="button" tabindex="0">
      <div class="module-picture"><img src="../../assets/modules/file-compare.png" alt="文件对比" /></div>
      <span class="built-in-badge">内置工具</span>
      <h3>文件对比</h3>
      <p>对比文本、代码、表格、图片、二进制文件与文件夹差异。</p>
      <div class="module-meta"><span class="module-tag">效率工具</span></div>
    </article>`;
}

function logAnalysisCard() {
  return `
    <article class="module-card built-in-module sortable-tool" data-open-log-analysis data-tool-id="log-analysis" draggable="true" role="button" tabindex="0">
      <div class="module-picture"><img src="../../assets/modules/log-analysis.png" alt="日志分析" /></div>
      <span class="built-in-badge">内置工具</span>
      <h3>日志分析</h3>
      <p>实时查看 Android logcat，过滤关键字并自动标记崩溃与异常堆栈。</p>
      <div class="module-meta"><span class="module-tag">日志工具</span></div>
    </article>`;
}

function appPackageCard() {
  return `
    <article class="module-card built-in-module sortable-tool" data-open-app-package data-tool-id="app-package" draggable="true" role="button" tabindex="0">
      <div class="module-picture"><img src="../../assets/modules/app-package.png" alt="安装包管理" /></div>
      <span class="built-in-badge">内置工具</span>
      <h3>安装包管理</h3>
      <p>解析 APK / IPA 信息，连接 Android 或 iPhone 安装、卸载，并解释常见失败原因。</p>
      <div class="module-meta"><span class="module-tag">App 测试</span></div>
    </article>`;
}

function mockDataCard() {
  return `
    <article class="module-card built-in-module sortable-tool" data-open-mock-data data-tool-id="mock-data" draggable="true" role="button" tabindex="0">
      <div class="module-picture"><img src="../../assets/modules/mock-data.png" alt="Mock 数据生成器" /></div>
      <span class="built-in-badge">内置工具</span>
      <h3>Mock 数据生成器</h3>
      <p>批量生成手机号、身份证、邮箱、用户名、地址和 JSON 模板数据。</p>
      <div class="module-meta"><span class="module-tag">测试数据</span></div>
    </article>`;
}

function timestampConverterCard() {
  return `
    <article class="module-card built-in-module sortable-tool" data-open-timestamp-converter data-tool-id="timestamp-converter" draggable="true" role="button" tabindex="0">
      <div class="module-picture"><img src="../../assets/modules/timestamp-converter.png" alt="时间戳转换" /></div>
      <span class="built-in-badge">内置工具</span>
      <h3>时间戳转换</h3>
      <p>支持秒、毫秒、微秒、纳秒时间戳和日期时间互转，一键复制常用格式。</p>
      <div class="module-meta"><span class="module-tag">效率工具</span></div>
    </article>`;
}

function formulaCalculatorCard() {
  return `
    <article class="module-card built-in-module sortable-tool" data-open-formula-calculator data-tool-id="formula-calculator" draggable="true" role="button" tabindex="0">
      <div class="module-picture"><img src="../../assets/modules/formula-calculator.png" alt="公式运算" /></div>
      <span class="built-in-badge">内置工具</span>
      <h3>公式运算</h3>
      <p>先生成变量词，再保存公式模板；输入变量值后自动代入计算并记录历史。</p>
      <div class="module-meta"><span class="module-tag">数值测试</span></div>
    </article>`;
}

function aiTestAssistantCard() {
  return `
    <article class="module-card built-in-module sortable-tool" data-open-ai-test-assistant data-tool-id="ai-test-assistant" draggable="true" role="button" tabindex="0">
      <div class="module-picture"><img src="../../assets/modules/ai-test-assistant.png" alt="AI 测试助手" /></div>
      <span class="built-in-badge">AI 工具箱</span>
      <h3>AI 测试助手</h3>
      <p>测试 AI 能力集合箱，先接入需求提取、附加条件和测试用例生成导出。</p>
      <div class="module-meta"><span class="module-tag">AI 测试</span></div>
    </article>`;
}

function normalizedToolOrder() {
  const available = [...BUILT_IN_TOOL_IDS, ...state.modules.map((module) => module.id)];
  const availableSet = new Set(available);
  const result = state.toolOrder.filter((id, index, order) => availableSet.has(id) && order.indexOf(id) === index);
  for (const id of available) if (!result.includes(id)) result.push(id);
  state.toolOrder = result;
  saveToolOrder();
  return result;
}

function homeToolCard(id) {
  if (id === 'mobile-mirror') return mobileMirrorCard();
  if (id === 'ios-mirror') return iosMirrorCard();
  if (id === 'ios-performance') return iosPerformanceCard();
  if (id === 'calculator') return calculatorCard();
  if (id === 'performance-monitor') return performanceMonitorCard();
  if (id === 'weak-network') return weakNetworkCard();
  if (id === 'file-compare') return fileCompareCard();
  if (id === 'log-analysis') return logAnalysisCard();
  if (id === 'app-package') return appPackageCard();
  if (id === 'mock-data') return mockDataCard();
  if (id === 'timestamp-converter') return timestampConverterCard();
  if (id === 'formula-calculator') return formulaCalculatorCard();
  if (id === 'ai-test-assistant') return aiTestAssistantCard();
  const module = state.modules.find((item) => item.id === id);
  return module ? moduleCard(module, true) : '';
}

function platformFolderHtml({ id, title, description, tools, order }) {
  const collapsed = state.collapsedFolders.has(id);
  const cards = order.filter((toolId) => tools.includes(toolId)).map(homeToolCard).join('');
  return `
    <section class="platform-folder ${id}" data-platform-folder-section="${id}">
      <button class="platform-folder-header" type="button" data-platform-folder="${id}" aria-expanded="${!collapsed}">
        <span class="platform-folder-mark">${id === 'android' ? 'Android' : 'iOS'}</span>
        <span class="platform-folder-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></span>
        <span class="platform-folder-count">${tools.length} 个工具</span>
        <span class="platform-folder-chevron" aria-hidden="true">⌄</span>
      </button>
      <div class="module-grid platform-folder-grid"${collapsed ? ' hidden' : ''}>${cards}</div>
    </section>`;
}

function visibleModules() {
  return state.modules.filter((item) => {
    const categoryMatch = state.filter === 'all' || item.category === state.filter;
    return categoryMatch;
  });
}

function render() {
  const modules = visibleModules();
  const order = normalizedToolOrder();
  const platformCollections = $('#platform-collections');
  const homeGrid = $('#home-module-grid');
  const moduleGrid = $('#module-grid');
  platformCollections.innerHTML = [
    platformFolderHtml({
      id: 'android',
      title: 'Android 工具箱',
      description: '投屏、性能、弱网与日志',
      tools: ANDROID_TOOL_IDS,
      order
    }),
    platformFolderHtml({
      id: 'ios',
      title: 'iOS 工具箱',
      description: 'iPhone 投屏与性能采集',
      tools: IOS_TOOL_IDS,
      order
    })
  ].join('');
  homeGrid.innerHTML = order.filter((id) => !PLATFORM_TOOL_IDS.has(id)).map(homeToolCard).join('');
  moduleGrid.innerHTML = modules.map(moduleCard).join('');
  $('#home-empty').hidden = true;
  homeGrid.hidden = false;
  $('#modules-empty').hidden = modules.length > 0;
  moduleGrid.hidden = modules.length === 0;
  bindCardActions();
}

function moveTool(sourceId, targetId = null) {
  const currentOrder = normalizedToolOrder();
  const sourceIndex = currentOrder.indexOf(sourceId);
  const originalTargetIndex = targetId ? currentOrder.indexOf(targetId) : -1;
  const order = currentOrder.filter((id) => id !== sourceId);
  const targetIndex = targetId ? order.indexOf(targetId) : -1;
  if (targetIndex < 0) order.push(sourceId);
  else order.splice(sourceIndex < originalTargetIndex ? targetIndex + 1 : targetIndex, 0, sourceId);
  state.toolOrder = order;
  state.draggingToolId = null;
  saveToolOrder();
  render();
  toast('工具顺序已保存');
  setTimeout(() => { state.dragOccurred = false; }, 0);
}

function bindToolSorting() {
  const cards = $$('#home-page [data-tool-id]');
  cards.forEach((card) => {
    card.addEventListener('dragstart', (event) => {
      state.draggingToolId = card.dataset.toolId;
      state.dragOccurred = true;
      card.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', state.draggingToolId);
    });
    card.addEventListener('dragover', (event) => {
      if (!state.draggingToolId || state.draggingToolId === card.dataset.toolId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      card.classList.add('drag-target');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag-target'));
    card.addEventListener('drop', (event) => {
      event.preventDefault();
      const sourceId = state.draggingToolId || event.dataTransfer.getData('text/plain');
      card.classList.remove('drag-target');
      if (sourceId && sourceId !== card.dataset.toolId) moveTool(sourceId, card.dataset.toolId);
    });
    card.addEventListener('dragend', () => {
      state.draggingToolId = null;
      cards.forEach((item) => item.classList.remove('dragging', 'drag-target'));
      setTimeout(() => { state.dragOccurred = false; }, 0);
    });
  });

  $$('#home-page .module-grid').forEach((grid) => {
    grid.ondragover = (event) => {
      if (state.draggingToolId && event.target === event.currentTarget) event.preventDefault();
    };
    grid.ondrop = (event) => {
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      if (state.draggingToolId) moveTool(state.draggingToolId);
    };
  });
}

function bindPlatformFolders() {
  $$('[data-platform-folder]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.platformFolder;
    if (state.collapsedFolders.has(id)) state.collapsedFolders.delete(id);
    else state.collapsedFolders.add(id);
    localStorage.setItem(PLATFORM_FOLDER_KEY, JSON.stringify([...state.collapsedFolders]));
    render();
  }));
}

function bindCardActions() {
  bindPlatformFolders();
  $$('[data-delete]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    const module = state.modules.find((item) => item.id === button.dataset.delete);
    if (!module || !confirm(`确定删除“${module.name}”模块吗？`)) return;
    state.modules = state.modules.filter((item) => item.id !== module.id);
    state.toolOrder = state.toolOrder.filter((id) => id !== module.id);
    saveModules();
    saveToolOrder();
    render();
    toast('模块已删除');
  }));
  $$('[data-open]').forEach((card) => card.addEventListener('click', (event) => {
    if (state.dragOccurred || event.target.closest('[data-delete]')) return;
    const module = state.modules.find((item) => item.id === card.dataset.open);
    if (module) toast(`已选择“${module.name}”，等待接入测试工具`);
  }));
  const mobileMirror = $('[data-open-mobile-mirror]');
  mobileMirror?.addEventListener('click', async (event) => {
    if (state.dragOccurred || event.target.closest('.module-menu')) return;
    try {
      if (!window.testCat?.mobileMirror) throw new Error('请通过本地预览入口运行 Test cat');
      await window.testCat.mobileMirror.openWindow();
    } catch (error) {
      toast(error.message || '无法打开手机投屏窗口');
    }
  });
  const iosMirror = $('[data-open-ios-mirror]');
  iosMirror?.addEventListener('click', async (event) => {
    if (state.dragOccurred || event.target.closest('.module-menu')) return;
    try {
      if (!window.testCat?.iosMirror) throw new Error('请通过本地预览入口运行 Test cat');
      await window.testCat.iosMirror.openWindow();
    } catch (error) {
      toast(error.message || '无法打开 iOS 投屏窗口');
    }
  });
  const calculator = $('[data-open-calculator]');
  calculator?.addEventListener('click', async () => {
    if (state.dragOccurred) return;
    try {
      if (!window.testCat?.calculator) throw new Error('请通过本地预览入口运行 Test cat');
      await window.testCat.calculator.openWindow();
    } catch (error) {
      toast(error.message || '无法打开计算器窗口');
    }
  });
  const performanceMonitor = $('[data-open-performance-monitor]');
  performanceMonitor?.addEventListener('click', async () => {
    if (state.dragOccurred) return;
    try {
      if (!window.testCat?.performanceMonitor) throw new Error('请通过本地预览入口运行 Test cat');
      await window.testCat.performanceMonitor.openWindow();
    } catch (error) {
      toast(error.message || '无法打开安卓性能监控窗口');
    }
  });
  const iosPerformance = $('[data-open-ios-performance]');
  iosPerformance?.addEventListener('click', async () => {
    if (state.dragOccurred) return;
    try {
      if (!window.testCat?.iosPerformance) throw new Error('请通过本地预览入口运行 Test cat');
      await window.testCat.iosPerformance.openWindow();
    } catch (error) {
      toast(error.message || '无法打开 iOS 性能监控窗口');
    }
  });
  const weakNetwork = $('[data-open-weak-network]');
  weakNetwork?.addEventListener('click', async () => {
    if (state.dragOccurred) return;
    try {
      if (!window.testCat?.weakNetwork) throw new Error('请通过本地预览入口运行 Test cat');
      await window.testCat.weakNetwork.openWindow();
    } catch (error) {
      toast(error.message || '无法打开弱网测试窗口');
    }
  });
  const fileCompare = $('[data-open-file-compare]');
  fileCompare?.addEventListener('click', async () => {
    if (state.dragOccurred) return;
    try {
      if (!window.testCat?.fileCompare) throw new Error('请通过本地预览入口运行 Test cat');
      await window.testCat.fileCompare.openWindow();
    } catch (error) {
      toast(error.message || '无法打开文件对比窗口');
    }
  });
  const logAnalysis = $('[data-open-log-analysis]');
  logAnalysis?.addEventListener('click', async () => {
    if (state.dragOccurred) return;
    try {
      if (!window.testCat?.logAnalysis) throw new Error('请通过本地预览入口运行 Test cat');
      await window.testCat.logAnalysis.openWindow();
    } catch (error) {
      toast(error.message || '无法打开日志分析窗口');
    }
  });
  const appPackage = $('[data-open-app-package]');
  appPackage?.addEventListener('click', async () => {
    if (state.dragOccurred) return;
    try {
      if (!window.testCat?.appPackage) throw new Error('请通过本地预览入口运行 Test cat');
      await window.testCat.appPackage.openWindow();
    } catch (error) {
      toast(error.message || '无法打开安装包管理窗口');
    }
  });
  const mockData = $('[data-open-mock-data]');
  mockData?.addEventListener('click', async () => {
    if (state.dragOccurred) return;
    try {
      if (!window.testCat?.mockData) throw new Error('请通过本地预览入口运行 Test cat');
      await window.testCat.mockData.openWindow();
    } catch (error) {
      toast(error.message || '无法打开 Mock 数据生成器窗口');
    }
  });
  const timestampConverter = $('[data-open-timestamp-converter]');
  timestampConverter?.addEventListener('click', async () => {
    if (state.dragOccurred) return;
    try {
      if (!window.testCat?.timestampConverter) throw new Error('请通过本地预览入口运行 Test cat');
      await window.testCat.timestampConverter.openWindow();
    } catch (error) {
      toast(error.message || '无法打开时间戳转换窗口');
    }
  });
  const formulaCalculator = $('[data-open-formula-calculator]');
  formulaCalculator?.addEventListener('click', async () => {
    if (state.dragOccurred) return;
    try {
      if (!window.testCat?.formulaCalculator) throw new Error('请通过本地预览入口运行 Test cat');
      await window.testCat.formulaCalculator.openWindow();
    } catch (error) {
      toast(error.message || '无法打开公式运算窗口');
    }
  });
  const aiTestAssistant = $('[data-open-ai-test-assistant]');
  aiTestAssistant?.addEventListener('click', async () => {
    if (state.dragOccurred) return;
    try {
      if (!window.testCat?.aiTestAssistant) throw new Error('请通过本地预览入口运行 Test cat');
      await window.testCat.aiTestAssistant.openWindow();
    } catch (error) {
      toast(error.message || '无法打开 AI 测试助手窗口');
    }
  });
  $$('.module-card[role="button"]').forEach((card) => card.addEventListener('keydown', (event) => {
    if (event.target !== card || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    card.click();
  }));
  bindToolSorting();
}

function renderTodos() {
  const list = $('#todo-list');
  const filtered = sortedTodos(state.todos.filter((todo) => {
    if (state.todoFilter === 'pending') return !todo.done;
    if (state.todoFilter === 'done') return todo.done;
    return true;
  }));
  const pendingCount = state.todos.filter((todo) => !todo.done).length;
  $('#todo-count').textContent = `${pendingCount} 项待完成`;
  $('#todo-empty').hidden = filtered.length > 0;
  list.hidden = filtered.length === 0;
  list.innerHTML = filtered.map((todo) => `
    <li class="todo-item${todo.done ? ' done' : ''}" data-todo-id="${escapeHtml(todo.id)}">
      <label class="todo-check">
        <input type="checkbox" data-todo-toggle="${escapeHtml(todo.id)}"${todo.done ? ' checked' : ''} />
        <span></span>
      </label>
      <div class="todo-content"><strong>${escapeHtml(todo.text)}</strong><small>${todoMetaHtml(todo)}</small></div>
      <span class="todo-priority ${escapeHtml(todo.priority)}">${escapeHtml(TODO_PRIORITY_LABEL[todo.priority] || TODO_PRIORITY_LABEL.normal)}</span>
      <button class="todo-delete" data-todo-delete="${escapeHtml(todo.id)}" aria-label="删除待办">×</button>
    </li>`).join('');

  $$('[data-todo-toggle]').forEach((input) => input.addEventListener('change', () => {
    const todo = state.todos.find((item) => item.id === input.dataset.todoToggle);
    if (!todo) return;
    todo.done = input.checked;
    saveTodos();
    renderTodos();
  }));
  $$('[data-todo-delete]').forEach((button) => button.addEventListener('click', () => {
    state.todos = state.todos.filter((item) => item.id !== button.dataset.todoDelete);
    saveTodos();
    renderTodos();
  }));
  scheduleTodoReminders();
}

function goTo(page) {
  state.page = page;
  const activeNavPage = page === 'modules' ? 'home' : page;
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.page === activeNavPage));
  $$('.page').forEach((item) => item.classList.toggle('active', item.id === `${page}-page`));
  const [title, subtitle] = pageCopy[page];
  $('#page-title').textContent = title;
  $('#page-subtitle').textContent = subtitle;
}

function navigateTo(page) {
  goTo(page);
}

function openModal() {
  $('#module-modal').hidden = false;
  setTimeout(() => $('#module-name').focus(), 0);
}

function closeModal() {
  $('#module-modal').hidden = true;
  $('#module-form').reset();
}

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 2200);
}

function normalizeTheme(theme) {
  return THEMES.includes(theme) ? theme : 'light';
}

function nextTheme(theme) {
  const current = normalizeTheme(theme);
  return THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
}

function setTheme(theme) {
  const normalized = normalizeTheme(theme);
  const isDark = normalized === 'dark';
  const isPurple = normalized === 'purple';
  document.body.classList.toggle('dark', isDark);
  document.body.classList.toggle('purple-eye', isPurple);
  $('#theme-switch').checked = isDark;
  const themeSelect = $('#theme-select');
  if (themeSelect) themeSelect.value = normalized;
  const button = $('#theme-button');
  button.textContent = isPurple ? '✦' : (isDark ? '☾' : '☼');
  button.title = isPurple ? '当前：紫色护眼，点击切换主题' : (isDark ? '当前：深色模式，点击切换主题' : '当前：浅色清爽，点击切换主题');
  button.setAttribute('aria-label', button.title);
  localStorage.setItem(THEME_KEY, normalized);
}

function renderCaptureSettings(snapshot) {
  if (!snapshot?.settings) return;
  const { settings, shortcutStatus } = snapshot;
  $('#capture-enabled').checked = settings.enabled !== false;
  $('#capture-screenshot-shortcut').value = settings.screenshotShortcut || 'Alt+Shift+S';
  $('#capture-recorder-shortcut').value = settings.recorderShortcut || 'Alt+Shift+R';
  $('#capture-screenshot-action').value = settings.screenshotAction || 'toolbar';
  applyCaptureEnabledState(settings.enabled !== false);
  renderCaptureShortcutStatus(shortcutStatus);
}

function applyCaptureEnabledState(enabled) {
  [
    '#capture-screenshot-shortcut',
    '#capture-recorder-shortcut',
    '#capture-screenshot-action',
    '#capture-start-screenshot',
    '#capture-open-recorder'
  ].forEach((selector) => {
    const node = $(selector);
    if (node) node.disabled = !enabled;
  });
}

function renderCaptureShortcutStatus(status) {
  const node = $('#capture-shortcut-status');
  if (!node) return;
  const problems = [];
  if (status?.enabled === false) {
    node.textContent = '截图与录屏已关闭';
    node.className = 'setting-status warn';
    return;
  }
  if (status?.screenshot && !status.screenshot.registered) problems.push('截图未注册');
  if (status?.recorder && !status.recorder.registered) problems.push('录屏未注册');
  if (problems.length) {
    node.textContent = problems.join('，') + '，请换一个组合';
    node.className = 'setting-status warn';
    return;
  }
  node.textContent = '快捷键已生效';
  node.className = 'setting-status ok';
}

function captureSettingsFromForm() {
  return {
    enabled: $('#capture-enabled').checked,
    screenshotShortcut: shortcutValueFromInput($('#capture-screenshot-shortcut'), 'Alt+Shift+S'),
    recorderShortcut: shortcutValueFromInput($('#capture-recorder-shortcut'), 'Alt+Shift+R'),
    screenshotAction: $('#capture-screenshot-action').value
  };
}

function isShortcutCapturePlaceholder(value) {
  return value === '请按下快捷键组合…' || value === '请同时按下 Ctrl / Alt / Shift / Command';
}

function shortcutValueFromInput(input, fallback) {
  const value = input.value.trim();
  if (isShortcutCapturePlaceholder(value)) return input.dataset.previousValue || fallback;
  return value || fallback;
}

function acceleratorFromKeyboardEvent(event) {
  const keyAliases = {
    ' ': 'Space',
    '+': 'Plus',
    Escape: 'Escape',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Enter: 'Return',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete'
  };
  const key = keyAliases[event.key] || event.key;
  if (['Control', 'Shift', 'Alt', 'Meta', 'Command'].includes(key)) return '';
  const parts = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.metaKey) parts.push('Command');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  let normalizedKey = key;
  if (/^[a-z]$/i.test(key)) normalizedKey = key.toUpperCase();
  if (/^F\d{1,2}$/i.test(key)) normalizedKey = key.toUpperCase();
  if (!parts.length) return '';
  parts.push(normalizedKey);
  return parts.join('+');
}

function bindShortcutCapture(input) {
  input.addEventListener('focus', () => {
    if (!isShortcutCapturePlaceholder(input.value)) input.dataset.previousValue = input.value;
    input.classList.add('recording-shortcut');
    input.value = '请按下快捷键组合…';
  });
  input.addEventListener('blur', () => {
    input.classList.remove('recording-shortcut');
    if (isShortcutCapturePlaceholder(input.value)) input.value = input.dataset.previousValue || '';
  });
  input.addEventListener('keydown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      input.value = input.dataset.previousValue || '';
      input.blur();
      return;
    }
    if ((event.key === 'Backspace' || event.key === 'Delete') && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      input.value = input.dataset.previousValue || '';
      input.blur();
      return;
    }
    const accelerator = acceleratorFromKeyboardEvent(event);
    if (!accelerator) {
      input.value = '请同时按下 Ctrl / Alt / Shift / Command';
      return;
    }
    input.value = accelerator;
    input.dataset.previousValue = accelerator;
    input.blur();
  });
}

async function loadCaptureSettings() {
  try {
    if (!window.testCat?.capture) throw new Error('请通过本地预览入口运行 Test cat');
    renderCaptureSettings(await window.testCat.capture.getSettings());
  } catch (error) {
    const node = $('#capture-shortcut-status');
    node.textContent = error.message || '读取失败';
    node.className = 'setting-status warn';
  }
}

async function saveCaptureSettings(showToast = true) {
  try {
    if (!window.testCat?.capture) throw new Error('请通过本地预览入口运行 Test cat');
    const result = await window.testCat.capture.saveSettings(captureSettingsFromForm());
    renderCaptureSettings(result);
    const status = result.shortcutStatus || {};
    const failed = [status.screenshot, status.recorder].filter((item) => item && !item.registered);
    if (showToast) {
      if (result.settings?.enabled === false) toast('截图与录屏已关闭');
      else toast(failed.length ? '配置已保存，但有快捷键被占用' : '截图与录屏快捷键已保存');
    }
  } catch (error) {
    toast(error.message || '保存截图配置失败');
  }
}

function renderAiSettings(snapshot) {
  const settings = snapshot?.settings;
  if (!settings) return;
  $('#ai-enabled').checked = settings.enabled !== false;
  $('#ai-base-url').value = settings.baseUrl || '';
  $('#ai-model').value = settings.model || '';
  $('#ai-api-key').value = settings.apiKey || '';
  $('#ai-temperature').value = settings.temperature ?? 0.2;
  renderAiPromptSummary(settings.testCasePrompt || '');
  applyAiEnabledState(settings.enabled !== false, settings.locked === true);
  renderAiStatus(snapshot);
}

function renderAiPromptSummary(prompt = '') {
  const node = $('#ai-prompt-summary');
  if (!node) return;
  node.dataset.prompt = prompt;
  const value = String(prompt || '').trim();
  if (!value) {
    node.textContent = '还没有配置提示词';
    return;
  }
  node.textContent = value.length > 180 ? `${value.slice(0, 180)}\n……共 ${value.length} 字，点击编辑查看完整内容` : value;
}

function renderAiStatus(snapshot, override = '') {
  const node = $('#ai-settings-status');
  if (!node) return;
  if (override) {
    node.textContent = override;
    node.className = override.includes('成功') ? 'setting-status ok' : (override.includes('失败') || override.includes('请') ? 'setting-status warn' : 'setting-status');
    return;
  }
  if (snapshot?.settings?.enabled === false) {
    node.textContent = snapshot.settings.locked ? '已锁定 · AI 功能已关闭' : 'AI 功能已关闭';
    node.className = 'setting-status warn';
    return;
  }
  if (snapshot?.settings?.locked) {
    node.textContent = snapshot.ready ? '配置已锁定' : '配置已锁定但未填完整';
    node.className = snapshot.ready ? 'setting-status ok' : 'setting-status warn';
    return;
  }
  if (snapshot?.ready) {
    node.textContent = 'AI 配置已就绪';
    node.className = 'setting-status ok';
    return;
  }
  const missing = snapshot?.missing?.join('、') || '配置';
  node.textContent = '待填写：' + missing;
  node.className = 'setting-status warn';
}

function applyAiEnabledState(enabled, locked = false) {
  const card = document.querySelector('.ai-settings-card');
  card?.classList.toggle('locked', locked);
  const lockButton = $('#ai-lock-settings');
  if (lockButton) {
    lockButton.textContent = locked ? '解锁配置' : '锁定配置';
    lockButton.dataset.locked = locked ? 'true' : 'false';
    lockButton.classList.toggle('danger-button', locked);
    lockButton.classList.toggle('secondary-button', !locked);
  }
  const disabled = !enabled || locked;
  [
    '#ai-base-url',
    '#ai-model',
    '#ai-api-key',
    '#ai-temperature',
    '#ai-save-settings',
    '#ai-open-prompt-editor'
  ].forEach((selector) => {
    const node = $(selector);
    if (node) node.disabled = disabled;
  });
  const enabledSwitch = $('#ai-enabled');
  if (enabledSwitch) enabledSwitch.disabled = locked;
  const testButton = $('#ai-test-connection');
  if (testButton) testButton.disabled = !enabled;
}

function aiSettingsFromForm() {
  return {
    enabled: $('#ai-enabled').checked,
    baseUrl: $('#ai-base-url').value,
    model: $('#ai-model').value,
    apiKey: $('#ai-api-key').value,
    temperature: $('#ai-temperature').value,
    testCasePrompt: $('#ai-prompt-summary')?.dataset.prompt || '',
    locked: $('#ai-lock-settings')?.dataset.locked === 'true'
  };
}

async function loadAiSettings() {
  try {
    if (!window.testCat?.aiTestAssistant) throw new Error('请通过本地预览入口运行 Test cat');
    renderAiSettings(await window.testCat.aiTestAssistant.getSettings());
  } catch (error) {
    const node = $('#ai-settings-status');
    node.textContent = error.message || '读取失败';
    node.className = 'setting-status warn';
  }
}

async function saveAiSettings(showToast = true) {
  try {
    if (!window.testCat?.aiTestAssistant) throw new Error('请通过本地预览入口运行 Test cat');
    const result = await window.testCat.aiTestAssistant.saveSettings(aiSettingsFromForm());
    renderAiSettings(result);
    if (showToast) toast(result.settings.enabled ? 'AI 设置已保存' : 'AI 功能已关闭');
    return result;
  } catch (error) {
    toast(error.message || '保存 AI 设置失败');
    throw error;
  }
}

async function testAiConnection() {
  const button = $('#ai-test-connection');
  try {
    button.disabled = true;
    if ($('#ai-lock-settings')?.dataset.locked !== 'true') await saveAiSettings(false);
    renderAiStatus(null, '正在测试连接…');
    if (!window.testCat?.aiTestAssistant) throw new Error('请通过本地预览入口运行 Test cat');
    await window.testCat.aiTestAssistant.testConnection();
    renderAiStatus(null, 'AI 连接成功');
    toast('AI 连接成功');
  } catch (error) {
    const message = error.message || 'AI 连接失败';
    renderAiStatus(null, 'AI 连接失败：' + message.slice(0, 40));
    toast(message);
  } finally {
    button.disabled = !$('#ai-enabled').checked;
  }
}

function openAiPromptEditor() {
  if ($('#ai-lock-settings')?.dataset.locked === 'true') return toast('配置已锁定，请先解锁');
  const editor = $('#ai-prompt-editor');
  editor.value = $('#ai-prompt-summary')?.dataset.prompt || '';
  updateAiPromptEditorCount();
  $('#ai-prompt-modal').hidden = false;
  setTimeout(() => editor.focus(), 0);
}

function updateAiPromptEditorCount() {
  const editor = $('#ai-prompt-editor');
  const count = $('#ai-prompt-count');
  if (count) count.textContent = `${editor.value.length} 字`;
}

async function closeAiPromptEditor() {
  const modal = $('#ai-prompt-modal');
  if (modal.hidden) return;
  modal.hidden = true;
  if ($('#ai-lock-settings')?.dataset.locked === 'true') return;
  try {
    if (!window.testCat?.aiTestAssistant) throw new Error('请通过本地预览入口运行 Test cat');
    const result = await window.testCat.aiTestAssistant.saveSettings({
      testCasePrompt: $('#ai-prompt-editor').value
    });
    renderAiSettings(result);
    toast('提示词已自动保存');
  } catch (error) {
    toast(error.message || '提示词自动保存失败');
  }
}

async function toggleAiLockSettings() {
  try {
    if (!window.testCat?.aiTestAssistant) throw new Error('请通过本地预览入口运行 Test cat');
    const locked = $('#ai-lock-settings')?.dataset.locked === 'true';
    const payload = locked ? { locked: false } : { ...aiSettingsFromForm(), locked: true };
    const result = await window.testCat.aiTestAssistant.saveSettings(payload);
    renderAiSettings(result);
    toast(result.settings.locked ? 'AI 配置已锁定' : 'AI 配置已解锁');
  } catch (error) {
    toast(error.message || '锁定配置失败');
  }
}

function renderCompanionPetSettings(snapshot) {
  const settings = snapshot?.settings;
  if (!settings) return;
  const pet = snapshot.activePet || { name: '陪伴宠物', description: '会在桌面随机移动，并提醒你喝水、站起来活动。' };
  const petName = pet.name || '陪伴宠物';
  const titleNode = $('#companion-pet-title');
  const descriptionNode = $('#companion-pet-description');
  const enabledTitleNode = $('#companion-pet-enabled-title');
  const enabledDescriptionNode = $('#companion-pet-enabled-description');
  const movementDescriptionNode = $('#companion-pet-movement-description');
  const walkButton = $('#companion-pet-walk-now');
  const hideButton = $('#companion-pet-hide-now');
  const petSelect = $('#companion-pet-active');
  if (titleNode) titleNode.textContent = '陪伴宠物 · ' + petName;
  if (descriptionNode) descriptionNode.textContent = pet.description || '';
  if (enabledTitleNode) enabledTitleNode.textContent = '让' + petName + '出现在桌面';
  if (enabledDescriptionNode) enabledDescriptionNode.textContent = '关闭后' + petName + '会回窝，不再显示或提醒。';
  if (movementDescriptionNode) movementDescriptionNode.textContent = petName + '会在桌面范围内散步，移动时播放动作帧。';
  if (walkButton) walkButton.textContent = '让' + petName + '扭两步';
  if (hideButton) hideButton.textContent = '让' + petName + '回窝';
  if (petSelect && Array.isArray(snapshot.pets)) {
    petSelect.innerHTML = snapshot.pets.map((item) => {
      return `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`;
    }).join('');
    petSelect.value = settings.activePetId || pet.id || 'yuexinmiao';
  }
  $('#companion-pet-enabled').checked = settings.enabled !== false;
  $('#companion-pet-movement').checked = settings.movementEnabled !== false;
  $('#companion-pet-walk-interval').value = settings.walkIntervalSeconds || 24;
  $('#companion-pet-water-enabled').checked = settings.waterReminderEnabled !== false;
  $('#companion-pet-water-minutes').value = settings.waterReminderMinutes || 30;
  $('#companion-pet-stand-enabled').checked = settings.standReminderEnabled !== false;
  $('#companion-pet-stand-minutes').value = settings.standReminderMinutes || 45;

  const node = $('#companion-pet-status');
  if (!settings.enabled) {
    node.textContent = petName + '正在窝里睡觉';
    node.className = 'setting-status warn';
  } else if (snapshot.visible) {
    node.textContent = petName + '正在桌面陪伴';
    node.className = 'setting-status ok';
  } else {
    node.textContent = petName + '准备出门中';
    node.className = 'setting-status';
  }
}

function companionPetSettingsFromForm() {
  return {
    activePetId: $('#companion-pet-active')?.value || undefined,
    enabled: $('#companion-pet-enabled').checked,
    movementEnabled: $('#companion-pet-movement').checked,
    walkIntervalSeconds: $('#companion-pet-walk-interval').value,
    waterReminderEnabled: $('#companion-pet-water-enabled').checked,
    waterReminderMinutes: $('#companion-pet-water-minutes').value,
    standReminderEnabled: $('#companion-pet-stand-enabled').checked,
    standReminderMinutes: $('#companion-pet-stand-minutes').value
  };
}

async function loadCompanionPetSettings() {
  try {
    if (!window.testCat?.companionPet) throw new Error('请通过本地预览入口运行 Test cat');
    renderCompanionPetSettings(await window.testCat.companionPet.getSettings());
  } catch (error) {
    const node = $('#companion-pet-status');
    node.textContent = error.message || '读取失败';
    node.className = 'setting-status warn';
  }
}

async function saveCompanionPetSettings(showSavedToast = true) {
  try {
    if (!window.testCat?.companionPet) throw new Error('请通过本地预览入口运行 Test cat');
    const result = await window.testCat.companionPet.saveSettings(companionPetSettingsFromForm());
    renderCompanionPetSettings(result);
    const petName = result.activePet?.name || '陪伴宠物';
    if (showSavedToast) toast(result.settings.enabled ? petName + '设置已自动保存' : petName + '已回窝');
  } catch (error) {
    toast(error.message || '自动保存陪伴宠物设置失败');
  }
}

function scheduleCompanionPetAutoSave(delay = 450) {
  clearTimeout(scheduleCompanionPetAutoSave.timer);
  scheduleCompanionPetAutoSave.timer = setTimeout(() => saveCompanionPetSettings(false), delay);
}

$$('.nav-item').forEach((item) => item.addEventListener('click', () => navigateTo(item.dataset.page)));
$$('[data-add]').forEach((item) => item.addEventListener('click', openModal));
$$('[data-close]').forEach((item) => item.addEventListener('click', closeModal));

$('#module-modal').addEventListener('click', (event) => {
  if (event.target === $('#module-modal')) closeModal();
});

$('#ai-prompt-modal').addEventListener('click', (event) => {
  if (event.target === $('#ai-prompt-modal')) closeAiPromptEditor();
});

$('#module-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('#module-name').value.trim();
  if (!name) return;
  const module = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    category: $('#module-category').value,
    description: $('#module-description').value.trim(),
    color: new FormData(event.currentTarget).get('color') || 'blue',
    createdAt: new Date().toISOString()
  };
  state.modules.unshift(module);
  state.toolOrder.push(module.id);
  saveModules();
  saveToolOrder();
  closeModal();
  render();
  toast('模块已添加');
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('#ai-prompt-modal').hidden) closeAiPromptEditor();
  if (event.key === 'Escape' && !$('#module-modal').hidden) closeModal();
});

$$('[data-filter]').forEach((button) => button.addEventListener('click', () => {
  state.filter = button.dataset.filter;
  $$('[data-filter]').forEach((item) => item.classList.toggle('active', item === button));
  render();
}));

$('#todo-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $('#todo-input');
  const dueInput = $('#todo-due');
  const text = input.value.trim();
  if (!text) return;
  const dueAt = normalizeTodoDueAt(dueInput.value);
  if (dueInput.value && (!dueAt || Date.parse(dueAt) <= Date.now())) {
    toast('提醒时间需要晚于现在');
    dueInput.focus();
    return;
  }
  state.todos.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    text: text.slice(0, 100),
    priority: $('#todo-priority').value,
    done: false,
    dueAt,
    remindedOffsets: [],
    createdAt: new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date())
  });
  saveTodos();
  input.value = '';
  dueInput.value = '';
  updateTodoDueMin();
  renderTodos();
  input.focus();
});

$$('[data-todo-filter]').forEach((button) => button.addEventListener('click', () => {
  state.todoFilter = button.dataset.todoFilter;
  $$('[data-todo-filter]').forEach((item) => item.classList.toggle('active', item === button));
  renderTodos();
}));

$('#todo-clear-completed').addEventListener('click', () => {
  const completed = state.todos.filter((todo) => todo.done).length;
  if (!completed) return toast('当前没有已完成任务');
  state.todos = state.todos.filter((todo) => !todo.done);
  saveTodos();
  renderTodos();
  toast(`已清理 ${completed} 项已完成任务`);
});

$('#theme-button').addEventListener('click', () => setTheme(nextTheme(localStorage.getItem(THEME_KEY))));
$('#theme-select').addEventListener('change', (event) => setTheme(event.target.value));
$('#theme-switch').addEventListener('change', (event) => setTheme(event.target.checked ? 'dark' : 'light'));
$('#ai-enabled').addEventListener('change', (event) => {
  applyAiEnabledState(event.target.checked);
  saveAiSettings();
});
$('#ai-save-settings').addEventListener('click', () => saveAiSettings());
$('#ai-test-connection').addEventListener('click', testAiConnection);
$('#ai-lock-settings').addEventListener('click', toggleAiLockSettings);
$('#ai-open-prompt-editor').addEventListener('click', openAiPromptEditor);
$('#ai-close-prompt-editor').addEventListener('click', closeAiPromptEditor);
$('#ai-done-prompt-editor').addEventListener('click', closeAiPromptEditor);
$('#ai-prompt-editor').addEventListener('input', updateAiPromptEditorCount);
$('#companion-pet-active')?.addEventListener('change', () => saveCompanionPetSettings(false));
$('#companion-pet-enabled').addEventListener('change', () => saveCompanionPetSettings(false));
$('#companion-pet-movement').addEventListener('change', () => saveCompanionPetSettings(false));
$('#companion-pet-water-enabled').addEventListener('change', () => saveCompanionPetSettings(false));
$('#companion-pet-stand-enabled').addEventListener('change', () => saveCompanionPetSettings(false));
['#companion-pet-walk-interval', '#companion-pet-water-minutes', '#companion-pet-stand-minutes'].forEach((selector) => {
  const input = $(selector);
  input?.addEventListener('input', () => scheduleCompanionPetAutoSave());
  input?.addEventListener('change', () => scheduleCompanionPetAutoSave(0));
});
$('#companion-pet-hide-now').addEventListener('click', async () => {
  try {
    if (!window.testCat?.companionPet) throw new Error('请通过本地预览入口运行 Test cat');
    const result = await window.testCat.companionPet.hideNow();
    renderCompanionPetSettings(result);
    toast((result.activePet?.name || '陪伴宠物') + '已回窝');
  } catch (error) {
    toast(error.message || '无法让陪伴宠物回窝');
  }
});
$('#companion-pet-walk-now').addEventListener('click', async () => {
  try {
    if (!window.testCat?.companionPet) throw new Error('请通过本地预览入口运行 Test cat');
    if (!$('#companion-pet-enabled').checked) {
      $('#companion-pet-enabled').checked = true;
      await saveCompanionPetSettings(false);
    }
    await window.testCat.companionPet.walkNow();
    toast(($('#companion-pet-active')?.selectedOptions?.[0]?.textContent || '陪伴宠物') + '出门扭扭了');
  } catch (error) {
    toast(error.message || '无法让陪伴宠物散步');
  }
});
window.testCat?.companionPet?.onSettingsChanged((snapshot) => renderCompanionPetSettings(snapshot));
bindShortcutCapture($('#capture-screenshot-shortcut'));
bindShortcutCapture($('#capture-recorder-shortcut'));
$('#capture-enabled').addEventListener('change', (event) => {
  applyCaptureEnabledState(event.target.checked);
  saveCaptureSettings();
});
$('#capture-save-settings').addEventListener('click', saveCaptureSettings);
$('#capture-start-screenshot').addEventListener('click', async () => {
  try {
    if (!$('#capture-enabled').checked) throw new Error('请先开启截图与录屏功能');
    if (!window.testCat?.capture) throw new Error('请通过本地预览入口运行 Test cat');
    await window.testCat.capture.startScreenshot();
  } catch (error) {
    toast(error.message || '无法启动截图');
  }
});
$('#capture-open-recorder').addEventListener('click', async () => {
  try {
    if (!$('#capture-enabled').checked) throw new Error('请先开启截图与录屏功能');
    if (!window.testCat?.capture) throw new Error('请通过本地预览入口运行 Test cat');
    await window.testCat.capture.openRecorder();
  } catch (error) {
    toast(error.message || '无法启动录屏');
  }
});
window.testCat?.capture?.onNotice((message) => toast(message));
$('#import-button').addEventListener('click', () => $('#import-input').click());
$('#import-input').addEventListener('change', async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const modules = Array.isArray(data) ? data : data.modules;
    if (!Array.isArray(modules)) throw new Error('Invalid modules');
    state.modules = modules.map((item) => ({
      id: String(item.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
      name: String(item.name || '未命名模块').slice(0, 28),
      category: ['接口测试', 'Web 测试', '性能测试', '其他'].includes(item.category) ? item.category : '其他',
      description: String(item.description || '').slice(0, 100),
      color: ['blue', 'purple', 'green', 'orange'].includes(item.color) ? item.color : 'blue',
      createdAt: item.createdAt || new Date().toISOString()
    }));
    saveModules();
    render();
    toast(`已导入 ${state.modules.length} 个模块`);
  } catch {
    toast('导入失败：请选择正确的 JSON 配置');
  } finally {
    event.target.value = '';
  }
});

setTheme(localStorage.getItem(THEME_KEY) || 'light');
loadAiSettings();
loadCaptureSettings();
loadCompanionPetSettings();
updateTodoDueMin();
setInterval(updateTodoDueMin, 60_000);
render();
renderTodos();
