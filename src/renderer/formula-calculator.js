const api = window.testCat?.formulaCalculator;
const core = window.FormulaCalculatorCore;
document.body.dataset.platform = window.testCat?.platform || 'browser';

const STORAGE_KEY = 'test-cat-formula-calculator-v1';
const MAX_HISTORY = 80;
const EXPORT_SCHEMA_VERSION = 1;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const exampleFormulaId = 'formula-final-coins-example';
const legacyExampleWords = Object.freeze([
  { name: '鱼', defaultValue: '0' },
  { name: '炮倍', defaultValue: '1' },
  { name: '加成', defaultValue: '1' },
  { name: '最终金币数', defaultValue: '' }
]);
const defaultState = Object.freeze({
  words: [],
  formulas: [],
  selectedFormulaId: null,
  selectedWord: '',
  editingFormulaId: null,
  lastValues: {},
  history: []
});

const state = loadState();

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(defaultState));
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!parsed || !Array.isArray(parsed.words) || !Array.isArray(parsed.formulas)) return cloneDefaultState();
    const next = {
      ...cloneDefaultState(),
      ...parsed,
      words: parsed.words.filter((item) => item && core.isIdentifierName(item.name)).map((item) => ({
        id: String(item.id || makeId('word')),
        name: core.normalizeIdentifier(item.name),
        defaultValue: String(item.defaultValue ?? '')
      })),
      formulas: parsed.formulas.map(normalizeFormula).filter(Boolean),
      history: Array.isArray(parsed.history) ? parsed.history.slice(0, MAX_HISTORY) : [],
      lastValues: parsed.lastValues && typeof parsed.lastValues === 'object' ? parsed.lastValues : {}
    };
    migrateLegacyExample(next);
    if (!next.formulas.some((item) => item.id === next.selectedFormulaId)) next.selectedFormulaId = next.formulas[0]?.id || null;
    if (!next.selectedWord || !next.words.some((item) => item.name === next.selectedWord)) next.selectedWord = next.words[0]?.name || '';
    next.editingFormulaId = null;
    return next;
  } catch {
    return cloneDefaultState();
  }
}

function isLegacyExampleFormula(formula) {
  return formula?.id === exampleFormulaId
    && formula.name === '最终金币数'
    && formula.expression === '(炮倍 * 加成) + 鱼'
    && (!formula.updatedAt || formula.updatedAt === '内置示例');
}

function hasOnlyLegacyExampleWords(words) {
  if (words.length !== legacyExampleWords.length) return false;
  return legacyExampleWords.every((expected) => words.some((word) => (
    word.name === expected.name && String(word.defaultValue ?? '') === expected.defaultValue
  )));
}

function migrateLegacyExample(next) {
  if (!next.formulas.some(isLegacyExampleFormula)) return;
  next.formulas = next.formulas.filter((formula) => !isLegacyExampleFormula(formula));
  delete next.lastValues[exampleFormulaId];
  if (!next.formulas.length && hasOnlyLegacyExampleWords(next.words)) next.words = [];
  if (next.selectedFormulaId === exampleFormulaId) next.selectedFormulaId = next.formulas[0]?.id || null;
}

function normalizeFormula(item) {
  try {
    const parsed = core.parseFormulaDefinition(item.name, item.expression);
    return {
      id: String(item.id || makeId('formula')),
      name: parsed.name,
      expression: parsed.expression,
      variables: parsed.variables,
      updatedAt: item.updatedAt || new Date().toLocaleString('zh-CN', { hour12: false })
    };
  } catch {
    return null;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    words: state.words,
    formulas: state.formulas,
    selectedFormulaId: state.selectedFormulaId,
    selectedWord: state.selectedWord,
    lastValues: state.lastValues,
    history: state.history
  }));
}

function makeId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 2200);
}

function setStatus(text, phase = 'done') {
  const node = $('#title-status');
  node.classList.toggle('working', phase === 'working');
  node.classList.toggle('done', phase === 'done');
  node.classList.toggle('error', phase === 'error');
  node.querySelector('span').textContent = text;
}

function nowText() {
  return new Date().toLocaleString('zh-CN', { hour12: false });
}

function wordByName(name) {
  return state.words.find((word) => word.name === name);
}

function ensureWord(name, defaultValue = '') {
  const normalized = core.assertIdentifier(name, '词名');
  const existed = wordByName(normalized);
  if (existed) return existed;
  const word = { id: makeId('word'), name: normalized, defaultValue: String(defaultValue ?? '') };
  state.words.push(word);
  state.selectedWord = word.name;
  return word;
}

function renderWords() {
  const node = $('#word-list');
  if (!state.words.length) {
    node.innerHTML = '<div class="empty">还没有词，先生成一个变量词。</div>';
    return;
  }
  node.innerHTML = state.words.map((word) => `
    <article class="word-chip${word.name === state.selectedWord ? ' selected' : ''}" data-select-word="${escapeHtml(word.name)}" title="${escapeHtml(word.defaultValue ? word.name + '，默认值：' + word.defaultValue : word.name)}">
      <span>${escapeHtml(word.name)}</span>
      <button type="button" data-delete-word="${escapeHtml(word.name)}" aria-label="删除 ${escapeHtml(word.name)}">×</button>
    </article>
  `).join('');
}

function formulaVariablesHtml(formula) {
  const variables = formula.variables || [];
  return [
    `<span class="pill result">${escapeHtml(formula.name)}</span>`,
    ...variables.map((name) => `<span class="pill">${escapeHtml(name)}</span>`)
  ].join('');
}

function renderFormulas() {
  const node = $('#formula-list');
  if (!state.formulas.length) {
    node.innerHTML = '<div class="empty">还没有公式，先保存一个公式模板。</div>';
    return;
  }
  node.innerHTML = state.formulas.map((formula) => `
    <article class="formula-item${formula.id === state.selectedFormulaId ? ' selected' : ''}" data-select-formula="${escapeHtml(formula.id)}">
      <div class="formula-item-head">
        <strong>${escapeHtml(formula.name)}</strong>
        <div class="formula-actions">
          <button type="button" data-edit-formula="${escapeHtml(formula.id)}">编辑</button>
          <button type="button" class="danger" data-delete-formula="${escapeHtml(formula.id)}">删除</button>
        </div>
      </div>
      <div class="formula-expression">${escapeHtml(formula.name)} = ${escapeHtml(formula.expression)}</div>
      <div class="formula-vars">${formulaVariablesHtml(formula)}</div>
    </article>
  `).join('');
}

function selectedFormula() {
  return state.formulas.find((formula) => formula.id === state.selectedFormulaId) || state.formulas[0] || null;
}

function inputValueFor(formula, variable) {
  const saved = state.lastValues?.[formula.id]?.[variable];
  if (saved !== undefined) return String(saved);
  return wordByName(variable)?.defaultValue || '';
}

function exampleValueFor(variable) {
  return wordByName(variable)?.defaultValue || '100';
}

function renderCalculator() {
  const formula = selectedFormula();
  const selected = $('#selected-formula');
  const form = $('#calculate-form');
  if (!formula) {
    selected.innerHTML = '<div class="empty">暂无公式。</div>';
    form.innerHTML = '';
    renderResult(null);
    return;
  }
  state.selectedFormulaId = formula.id;
  selected.innerHTML = `
    <strong>${escapeHtml(formula.name)}</strong>
    <code>${escapeHtml(formula.name)} = ${escapeHtml(formula.expression)}</code>
  `;
  const rows = formula.variables.map((variable) => `
    <div class="input-row">
      <label title="${escapeHtml(variable)}">${escapeHtml(variable)}</label>
      <input data-variable-input="${escapeHtml(variable)}" value="${escapeHtml(inputValueFor(formula, variable))}" placeholder="例如：${escapeHtml(exampleValueFor(variable))}" />
    </div>
  `).join('');
  form.innerHTML = rows + '<button class="primary" type="submit">代入计算</button>';
}

function resultText(result) {
  if (!result) return '';
  const values = Object.entries(result.values || {}).map(([key, value]) => `${key}=${value}`).join('，');
  return [
    `${result.name} = ${result.formattedResult}`,
    `公式：${result.name} = ${result.expression}`,
    values ? `代入：${values}` : ''
  ].filter(Boolean).join('\n');
}

function renderResult(result, error = '') {
  const node = $('#result-card');
  $('#copy-result').disabled = !result || Boolean(error);
  if (error) {
    state.lastResult = null;
    node.classList.add('error');
    node.innerHTML = `<span>计算失败</span><strong>${escapeHtml(error)}</strong><p>检查变量是否都填了数字，除数也不能为 0。</p>`;
    return;
  }
  node.classList.remove('error');
  if (!result) {
    state.lastResult = null;
    node.innerHTML = '<span>计算结果</span><strong>等待输入</strong><p>选中公式并填写变量后，结果会显示在这里。</p>';
    return;
  }
  state.lastResult = result;
  node.innerHTML = `
    <span>${escapeHtml(result.name)}</span>
    <strong>${escapeHtml(result.formattedResult)}</strong>
    <p>${escapeHtml(result.name)} = ${escapeHtml(result.expression)}</p>
  `;
}

function renderHistory() {
  $('#copy-history').disabled = !state.history.length;
  const node = $('#history-list');
  if (!state.history.length) {
    node.innerHTML = '<div class="empty">还没有计算历史。</div>';
    return;
  }
  node.innerHTML = state.history.map((item) => `
    <article class="history-item">
      <div>
        <strong>${escapeHtml(item.name)} = ${escapeHtml(item.formattedResult)}</strong>
        <code>${escapeHtml(item.expressionText)}</code>
        <small>${escapeHtml(item.valuesText)} · ${escapeHtml(item.time)}</small>
      </div>
      <div class="history-actions"><button type="button" data-copy-history-item="${escapeHtml(item.id)}">复制</button></div>
    </article>
  `).join('');
}

function renderAll() {
  renderWords();
  renderFormulas();
  renderCalculator();
  renderHistory();
  saveState();
}

function addWordFromForm(name, defaultValue = '') {
  try {
    if (defaultValue) core.parseNumberValue(defaultValue, '默认值');
    const word = ensureWord(name, defaultValue);
    state.selectedWord = word.name;
    renderAll();
    setStatus('词已生成：' + word.name, 'done');
    toast('词已生成：' + word.name);
  } catch (error) {
    setStatus('生成词失败', 'error');
    toast(error.message || '生成词失败');
  }
}

function addWordsFromFormula(formula) {
  ensureWord(formula.name);
  for (const variable of formula.variables) ensureWord(variable);
}

function resetFormulaForm() {
  state.editingFormulaId = null;
  $('#formula-name').value = '';
  $('#formula-expression').value = '';
  $('#save-formula').textContent = '保存公式';
  $('#cancel-edit').hidden = true;
}

function saveFormulaFromForm() {
  try {
    const parsed = core.parseFormulaDefinition($('#formula-name').value, $('#formula-expression').value);
    addWordsFromFormula(parsed);
    const formula = {
      id: state.editingFormulaId || makeId('formula'),
      name: parsed.name,
      expression: parsed.expression,
      variables: parsed.variables,
      updatedAt: nowText()
    };
    const index = state.formulas.findIndex((item) => item.id === formula.id);
    if (index >= 0) state.formulas.splice(index, 1, formula);
    else state.formulas.unshift(formula);
    state.selectedFormulaId = formula.id;
    state.editingFormulaId = null;
    setStatus('公式已保存', 'done');
    resetFormulaForm();
    renderAll();
    previewSelectedFormula();
    toast('公式已保存：' + formula.name);
  } catch (error) {
    setStatus('公式保存失败', 'error');
    toast(error.message || '公式保存失败');
  }
}

function editFormula(id) {
  const formula = state.formulas.find((item) => item.id === id);
  if (!formula) return;
  state.editingFormulaId = formula.id;
  $('#formula-name').value = formula.name;
  $('#formula-expression').value = formula.name + ' = ' + formula.expression;
  $('#save-formula').textContent = '保存修改';
  $('#cancel-edit').hidden = false;
  $('#formula-expression').focus();
}

function deleteFormula(id) {
  const formula = state.formulas.find((item) => item.id === id);
  if (!formula || !confirm('确定删除公式“' + formula.name + '”吗？')) return;
  state.formulas = state.formulas.filter((item) => item.id !== id);
  delete state.lastValues[id];
  if (state.selectedFormulaId === id) state.selectedFormulaId = state.formulas[0]?.id || null;
  if (state.editingFormulaId === id) resetFormulaForm();
  renderAll();
  renderResult(null);
  toast('公式已删除');
}

function collectInputValues(formula) {
  const values = {};
  $$('[data-variable-input]').forEach((input) => {
    values[input.dataset.variableInput] = input.value.trim();
  });
  state.lastValues[formula.id] = values;
  return values;
}

function addHistory(result) {
  const valuesText = Object.entries(result.values || {}).map(([key, value]) => `${key}=${value}`).join('，') || '无变量';
  state.history.unshift({
    id: makeId('history'),
    name: result.name,
    formattedResult: result.formattedResult,
    expressionText: result.name + ' = ' + result.expression,
    valuesText,
    copyText: resultText(result),
    time: nowText()
  });
  state.history = state.history.slice(0, MAX_HISTORY);
}

function calculateSelectedFormula(writeHistory = true) {
  const formula = selectedFormula();
  if (!formula) return;
  setStatus('正在计算公式', 'working');
  try {
    const result = core.calculateFormula(formula, collectInputValues(formula));
    renderResult(result);
    if (writeHistory) addHistory(result);
    renderHistory();
    saveState();
    setStatus('计算完成', 'done');
  } catch (error) {
    renderResult(null, error.message || '计算失败');
    setStatus('计算失败', 'error');
  }
}

function hasValuesForFormula(formula) {
  return !formula?.variables?.length || formula.variables.every((variable) => String(inputValueFor(formula, variable)).trim() !== '');
}

function previewSelectedFormula() {
  const formula = selectedFormula();
  if (!formula) {
    renderResult(null);
    return;
  }
  if (hasValuesForFormula(formula)) calculateSelectedFormula(false);
  else renderResult(null);
}

function insertSelectedWord() {
  if (!state.selectedWord) {
    toast('先在左侧选中一个词');
    return;
  }
  const input = $('#formula-expression');
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  const insert = state.selectedWord;
  input.value = before + insert + after;
  input.focus();
  input.setSelectionRange(start + insert.length, start + insert.length);
}

async function copyText(text, message = '已复制') {
  if (!text) return;
  try {
    if (api?.copyText) await api.copyText(text);
    else await navigator.clipboard.writeText(text);
    toast(message);
  } catch (error) {
    toast(error.message || '复制失败，请手动复制');
  }
}

function historyText() {
  return state.history.map((item, index) => [
    '#' + (index + 1),
    `${item.name} = ${item.formattedResult}`,
    item.expressionText,
    item.valuesText,
    item.time
  ].join('\n')).join('\n\n');
}

function exportPayload() {
  return {
    version: EXPORT_SCHEMA_VERSION,
    tool: 'test-cat-formula-calculator',
    exportedAt: new Date().toISOString(),
    words: state.words.map((word) => ({
      name: word.name,
      defaultValue: word.defaultValue || ''
    })),
    formulas: state.formulas.map((formula) => ({
      name: formula.name,
      expression: formula.expression
    }))
  };
}

async function exportData() {
  const payload = exportPayload();
  const content = JSON.stringify(payload, null, 2);
  const fileName = `test-cat-formulas-${new Date().toISOString().slice(0, 10)}.json`;
  setStatus('正在导出公式和词', 'working');
  try {
    if (api?.exportData) {
      const result = await api.exportData({ fileName, content });
      if (!result) {
        setStatus('已取消导出', 'done');
        return;
      }
      setStatus('导出完成', 'done');
      toast('公式和变量词已导出');
      return;
    }

    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
    setStatus('导出完成', 'done');
    toast('公式和变量词已导出');
  } catch (error) {
    setStatus('导出失败', 'error');
    toast(error.message || '导出失败');
  }
}

function parseImportContent(content) {
  const text = String(content || '').replace(/^\ufeff/, '').trim();
  if (!text) throw new Error('导入文件是空的');
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('导入文件不是有效 JSON');
  }
  if (!data || typeof data !== 'object') throw new Error('导入文件格式不正确');
  return data;
}

function importedWordItems(data) {
  if (Array.isArray(data.words)) return data.words;
  if (Array.isArray(data.variables)) return data.variables;
  if (Array.isArray(data.variableWords)) return data.variableWords;
  return [];
}

function importedFormulaItems(data) {
  if (Array.isArray(data.formulas)) return data.formulas;
  if (Array.isArray(data.templates)) return data.templates;
  return [];
}

function normalizeImportedWord(item) {
  const rawName = typeof item === 'string' ? item : item?.name;
  const name = core.assertIdentifier(rawName, '词名');
  const defaultValue = typeof item === 'string' ? '' : String(item?.defaultValue ?? '').trim();
  if (defaultValue) core.parseNumberValue(defaultValue, name + ' 的默认值');
  return { id: makeId('word'), name, defaultValue };
}

function normalizeImportedFormula(item) {
  const name = typeof item === 'string' ? '' : item?.name || '';
  const expression = typeof item === 'string' ? item : item?.expression || item?.formula || item?.text || '';
  const parsed = core.parseFormulaDefinition(name, expression);
  return {
    id: makeId('formula'),
    name: parsed.name,
    expression: parsed.expression,
    variables: parsed.variables,
    updatedAt: '导入 ' + nowText()
  };
}

function formulaKey(formula) {
  return `${formula.name}\n${formula.expression}`;
}

function importFormulaData(content) {
  const data = parseImportContent(content);
  const wordItems = importedWordItems(data);
  const formulaItems = importedFormulaItems(data);
  if (!wordItems.length && !formulaItems.length) throw new Error('文件里没有可导入的变量词或公式');

  const beforeWordCount = state.words.length;
  let updatedWords = 0;
  let invalidWords = 0;
  let invalidFormulas = 0;
  let skippedWords = 0;
  let skippedFormulas = 0;

  const incomingWordNames = new Set();
  for (const item of wordItems) {
    try {
      const word = normalizeImportedWord(item);
      if (incomingWordNames.has(word.name)) {
        skippedWords += 1;
        continue;
      }
      incomingWordNames.add(word.name);
      const existed = wordByName(word.name);
      if (existed) {
        if (!existed.defaultValue && word.defaultValue) {
          existed.defaultValue = word.defaultValue;
          updatedWords += 1;
        } else {
          skippedWords += 1;
        }
      } else {
        state.words.push(word);
        state.selectedWord = word.name;
      }
    } catch {
      invalidWords += 1;
    }
  }

  const existingFormulaKeys = new Set(state.formulas.map(formulaKey));
  const incomingFormulaKeys = new Set();
  const importedFormulas = [];
  for (const item of formulaItems) {
    try {
      const formula = normalizeImportedFormula(item);
      const key = formulaKey(formula);
      if (existingFormulaKeys.has(key) || incomingFormulaKeys.has(key)) {
        skippedFormulas += 1;
        continue;
      }
      incomingFormulaKeys.add(key);
      importedFormulas.push(formula);
    } catch {
      invalidFormulas += 1;
    }
  }

  for (const formula of importedFormulas) addWordsFromFormula(formula);
  if (importedFormulas.length) {
    state.formulas = [...importedFormulas, ...state.formulas];
    state.selectedFormulaId = importedFormulas[0].id;
  }

  if (!state.selectedWord || !state.words.some((word) => word.name === state.selectedWord)) {
    state.selectedWord = state.words[0]?.name || '';
  }
  resetFormulaForm();
  renderAll();
  if (importedFormulas.length) previewSelectedFormula();

  return {
    words: state.words.length - beforeWordCount,
    formulas: importedFormulas.length,
    updatedWords,
    invalidWords,
    invalidFormulas,
    skippedWords,
    skippedFormulas
  };
}

function importSummary(result) {
  const parts = [
    `新增 ${result.words} 个词`,
    `新增 ${result.formulas} 个公式`
  ];
  if (result.updatedWords) parts.push(`补默认值 ${result.updatedWords} 个`);
  if (result.skippedWords || result.skippedFormulas) parts.push(`跳过重复 ${result.skippedWords + result.skippedFormulas} 个`);
  if (result.invalidWords || result.invalidFormulas) parts.push(`忽略无效 ${result.invalidWords + result.invalidFormulas} 个`);
  return parts.join('，');
}

async function importData() {
  if (!api?.importData) {
    toast('当前环境不支持文件导入');
    return;
  }
  setStatus('正在导入公式和词', 'working');
  try {
    const result = await api.importData();
    if (!result) {
      setStatus('已取消导入', 'done');
      return;
    }
    const imported = importFormulaData(result.content);
    const hasChange = imported.words || imported.formulas || imported.updatedWords;
    if (hasChange) {
      setStatus('导入完成', 'done');
      toast(importSummary(imported));
    } else if (imported.invalidWords || imported.invalidFormulas) {
      setStatus('没有可导入的有效内容', 'error');
      toast('导入文件里没有可用的公式或变量词');
    } else {
      setStatus('没有新增内容', 'done');
      toast('导入内容和现有数据重复');
    }
  } catch (error) {
    setStatus('导入失败', 'error');
    toast(error.message || '导入失败');
  }
}

$('#word-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('#word-name').value.trim();
  const defaultValue = $('#word-default').value.trim();
  addWordFromForm(name, defaultValue);
  $('#word-name').value = '';
  $('#word-default').value = '';
});

document.addEventListener('click', (event) => {
  const selectWord = event.target.closest('[data-select-word]');
  if (selectWord && !event.target.closest('[data-delete-word]')) {
    state.selectedWord = selectWord.dataset.selectWord;
    renderWords();
    saveState();
    insertSelectedWord();
    setStatus('已插入词：' + state.selectedWord, 'done');
    return;
  }

  const deleteWord = event.target.closest('[data-delete-word]');
  if (deleteWord) {
    const name = deleteWord.dataset.deleteWord;
    state.words = state.words.filter((word) => word.name !== name);
    if (state.selectedWord === name) state.selectedWord = state.words[0]?.name || '';
    renderAll();
    toast('词已删除');
    return;
  }

  const selectFormula = event.target.closest('[data-select-formula]');
  if (selectFormula && !event.target.closest('[data-edit-formula], [data-delete-formula]')) {
    state.selectedFormulaId = selectFormula.dataset.selectFormula;
    renderAll();
    previewSelectedFormula();
    return;
  }

  const editButton = event.target.closest('[data-edit-formula]');
  if (editButton) {
    editFormula(editButton.dataset.editFormula);
    return;
  }

  const deleteButton = event.target.closest('[data-delete-formula]');
  if (deleteButton) {
    deleteFormula(deleteButton.dataset.deleteFormula);
    return;
  }

  const copyHistoryItem = event.target.closest('[data-copy-history-item]');
  if (copyHistoryItem) {
    const item = state.history.find((history) => history.id === copyHistoryItem.dataset.copyHistoryItem);
    if (item) copyText(item.copyText, '这条历史已复制');
  }
});

$('#formula-form').addEventListener('submit', (event) => {
  event.preventDefault();
  saveFormulaFromForm();
});
$('#new-formula').addEventListener('click', () => {
  resetFormulaForm();
  $('#formula-name').focus();
});
$('#cancel-edit').addEventListener('click', resetFormulaForm);
$('#calculate-form').addEventListener('submit', (event) => {
  event.preventDefault();
  calculateSelectedFormula(true);
});
$('#calculate-form').addEventListener('input', (event) => {
  if (!event.target.matches('[data-variable-input]')) return;
  const formula = selectedFormula();
  if (!formula) return;
  state.lastValues[formula.id] = state.lastValues[formula.id] || {};
  state.lastValues[formula.id][event.target.dataset.variableInput] = event.target.value;
  saveState();
});
$('#copy-result').addEventListener('click', () => copyText(resultText(state.lastResult), '结果已复制'));
$('#copy-history').addEventListener('click', () => copyText(historyText(), '历史已复制'));
$('#import-data').addEventListener('click', importData);
$('#export-data').addEventListener('click', exportData);
$('#clear-history').addEventListener('click', () => {
  if (!state.history.length) return;
  if (!confirm('确定清空计算历史吗？')) return;
  state.history = [];
  renderHistory();
  saveState();
  toast('历史已清空');
});

renderAll();
previewSelectedFormula();
