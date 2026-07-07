const core = window.FileCompareCore;
const api = window.testCat?.fileCompare;
const HISTORY_KEY = 'test-cat-file-compare-history-v1';

const state = {
  mode: 'file',
  paths: { left: null, right: null },
  payloads: { left: null, right: null },
  leftLines: [],
  rightLines: [],
  lineDiff: null,
  currentDifference: -1,
  workbook: null,
  sheetNames: [],
  tableDifferenceAddresses: [],
  currentTableDifference: -1,
  directoryResult: null,
  directoryFilter: 'all',
  reportRows: [],
  resultTitle: '',
  resultType: '',
  busy: false
};
let spreadsheetScrollSyncing = false;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 2400);
}

function setStatus(message, phase = '') {
  const node = $('#title-status');
  node.className = `title-status ${phase}`.trim();
  node.querySelector('span').textContent = message;
}

function setBusy(busy, message = '') {
  state.busy = busy;
  $('#compare-button').disabled = busy;
  $('#compare-button').textContent = busy ? '正在对比…' : '开始对比';
  if (message) setStatus(message, busy ? 'working' : '');
}

function updatePathUi(side) {
  const info = state.paths[side];
  $(`#${side}-name`).textContent = info?.name || (state.mode === 'directory' ? '选择文件夹' : '选择文件');
  $(`#${side}-path`).textContent = info?.path || '点击选择，也可以拖到这里';
}

function resetResult() {
  state.payloads = { left: null, right: null };
  state.lineDiff = null;
  state.directoryResult = null;
  state.reportRows = [];
  state.resultType = '';
  $('#result-summary').hidden = true;
  $('#empty-state').hidden = false;
  $$('.view').forEach((view) => { view.hidden = true; });
  $('#export-html').disabled = true;
  $('#export-excel').disabled = true;
  $('#previous-button').disabled = true;
  $('#next-button').disabled = true;
}

function setMode(mode) {
  if (state.busy || state.mode === mode) return;
  state.mode = mode;
  $$('.mode-tabs button').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
  $('#file-options').hidden = mode !== 'file';
  $('#directory-options').hidden = mode !== 'directory';
  state.paths = { left: null, right: null };
  updatePathUi('left'); updatePathUi('right');
  resetResult();
  setStatus(mode === 'directory' ? '等待选择两个文件夹' : '等待选择两个文件');
}

async function choosePath(side) {
  if (!api || state.busy) return toast('请通过 Test cat 本地预览入口打开此模块');
  try {
    const info = await api.selectPath(state.mode === 'directory' ? 'directory' : 'file');
    if (!info) return;
    state.paths[side] = info;
    updatePathUi(side);
    resetResult();
    if (state.paths.left && state.paths.right) setStatus('已选择两侧内容，可以开始对比');
  } catch (error) {
    toast(error.message || '选择失败');
  }
}

async function acceptDrop(side, file) {
  if (!api || !file) return;
  try {
    const filePath = api.pathForFile(file);
    const info = await api.inspectPath(filePath);
    const expected = state.mode === 'directory' ? 'directory' : 'file';
    if (info.kind !== expected) throw new Error(expected === 'file' ? '当前模式需要拖入文件' : '当前模式需要拖入文件夹');
    state.paths[side] = info;
    updatePathUi(side);
    resetResult();
  } catch (error) {
    toast(error.message || '无法读取拖入的内容');
  }
}

function showView(id) {
  $('#empty-state').hidden = true;
  $$('.view').forEach((view) => { view.hidden = view.id !== id; });
  $('#result-summary').hidden = false;
  $('#export-html').disabled = false;
  $('#export-excel').disabled = false;
}

function showSummary(title, stats, saveable = false) {
  state.resultTitle = title;
  $('#summary-title').textContent = title;
  $('#summary-stats').innerHTML = stats.map(([label, value]) => `<li>${escapeHtml(label)} <b>${escapeHtml(value)}</b></li>`).join('');
  $('#save-actions').hidden = !saveable;
}

function comparisonOptions() {
  return {
    ignoreSpace: $('#ignore-space').checked,
    ignoreCase: $('#ignore-case').checked,
    ignoreEmpty: $('#ignore-empty').checked,
    sortJson: $('#json-sort').checked
  };
}

function onlyDifferences() {
  return $('#only-differences').checked;
}

async function runCompare({ addToHistory = true } = {}) {
  if (state.busy) return;
  if (!state.paths.left || !state.paths.right) return toast(state.mode === 'directory' ? '请先选择左右两个文件夹' : '请先选择左右两个文件');
  setBusy(true, state.mode === 'directory' ? '正在扫描文件夹…' : '正在读取文件…');
  try {
    if (state.mode === 'directory') await compareDirectories();
    else await compareFiles();
    setStatus('对比完成', 'done');
    if (addToHistory) addHistory();
  } catch (error) {
    setStatus(error.message || '对比失败', 'error');
    toast(error.message || '对比失败');
  } finally {
    setBusy(false);
  }
}

async function compareFiles() {
  const [left, right] = await Promise.all([api.readFile(state.paths.left.path), api.readFile(state.paths.right.path)]);
  state.payloads = { left, right };
  const tableTypes = new Set(['table', 'workbook']);
  if (left.type === 'image' || right.type === 'image') {
    if (left.type !== 'image' || right.type !== 'image') throw new Error('图片需要与另一张图片进行对比');
    await renderImageComparison(left, right);
  } else if (tableTypes.has(left.type) || tableTypes.has(right.type)) {
    if (!tableTypes.has(left.type) || !tableTypes.has(right.type)) throw new Error('CSV/XLSX 需要与另一份表格文件进行对比');
    renderTableComparison(left, right);
  } else if (left.type === 'binary' || right.type === 'binary') {
    if (left.type !== 'binary' || right.type !== 'binary') throw new Error('二进制文件需要与另一份二进制文件进行对比');
    renderBinaryComparison(left, right);
  } else renderTextComparison(left, right);
}

function renderTextComparison(left, right, suppliedLines = null) {
  const options = comparisonOptions();
  const leftText = suppliedLines ? suppliedLines.left.join('\n') : core.prepareText(left.text, left.extension, options);
  const rightText = suppliedLines ? suppliedLines.right.join('\n') : core.prepareText(right.text, right.extension, options);
  state.leftLines = leftText.split('\n');
  state.rightLines = rightText.split('\n');
  state.lineDiff = core.buildLineDiff(state.leftLines, state.rightLines, options);
  state.resultType = 'text';
  state.currentDifference = -1;
  $('#left-column-title').textContent = `${left.name} · ${formatBytes(left.size)}`;
  $('#right-column-title').textContent = `${right.name} · ${formatBytes(right.size)}`;
  renderDiffRows();
  const changed = state.lineDiff.rows.filter((row) => row.type === 'changed').length;
  const added = state.lineDiff.rows.filter((row) => row.type === 'added').length;
  const deleted = state.lineDiff.rows.filter((row) => row.type === 'deleted').length;
  state.reportRows = state.lineDiff.rows.filter((row) => row.type !== 'equal').map((row) => ({
    类型: row.type === 'changed' ? '修改' : row.type === 'added' ? '右侧新增' : '左侧独有',
    左侧行: row.leftLine ?? '', 左侧内容: row.left, 右侧行: row.rightLine ?? '', 右侧内容: row.right
  }));
  showView('text-view');
  showSummary(state.lineDiff.differentLines ? `发现 ${state.lineDiff.hunks.length} 处差异` : '两份文件内容一致', [['修改', changed], ['右侧新增', added], ['左侧独有', deleted]], true);
  updateDiffNavigation();
}

function characterHighlight(left, right) {
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < left.length - prefix && suffix < right.length - prefix && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix += 1;
  const decorate = (value) => {
    const head = value.slice(0, prefix);
    const middle = value.slice(prefix, value.length - suffix || value.length);
    const tail = suffix ? value.slice(-suffix) : '';
    return `${escapeHtml(head)}${middle ? `<mark>${escapeHtml(middle)}</mark>` : ''}${escapeHtml(tail)}`;
  };
  return [decorate(left), decorate(right)];
}

function renderDiffRows() {
  const node = $('#text-diff');
  const rows = core.filterDifferenceRows(
    state.lineDiff.rows.map((row, index) => ({ ...row, originalIndex: index })),
    onlyDifferences(),
    'type'
  );
  node.innerHTML = rows.map((row) => {
    const [leftHtml, rightHtml] = row.type === 'changed' ? characterHighlight(row.left, row.right) : [escapeHtml(row.left), escapeHtml(row.right)];
    const actions = row.firstInHunk ? `<span class="hunk-actions"><button data-merge="left" data-hunk="${row.hunkId}" title="用左侧替换右侧">→</button><button data-merge="right" data-hunk="${row.hunkId}" title="用右侧替换左侧">←</button></span>` : '';
    return `<div class="diff-row ${row.type}" data-diff-index="${row.originalIndex}">${actions}<div class="diff-cell"><span class="line-number">${row.leftLine ?? ''}</span><span class="line-text">${leftHtml || '&nbsp;'}</span></div><div class="diff-cell"><span class="line-number">${row.rightLine ?? ''}</span><span class="line-text">${rightHtml || '&nbsp;'}</span></div></div>`;
  }).join('');
  renderDiffMinimap();
  requestAnimationFrame(updateMinimapViewport);
}

function renderDiffMinimap() {
  const rows = state.lineDiff?.rows || [];
  const total = Math.max(1, rows.length);
  $('#minimap-page').innerHTML = (state.lineDiff?.hunks || []).map((hunk) => {
    const indexes = rows.map((row, index) => row.hunkId === hunk.id ? index : -1).filter((index) => index >= 0);
    if (!indexes.length) return '';
    const types = indexes.map((index) => rows[index].type);
    const type = types.includes('changed') ? 'changed' : types.includes('deleted') && types.includes('added') ? 'changed' : types.includes('deleted') ? 'deleted' : 'added';
    const top = indexes[0] / total * 100;
    const height = Math.max(.9, indexes.length / total * 100);
    return `<button class="minimap-marker ${type}" data-overview-index="${indexes[0]}" style="top:${top.toFixed(3)}%;height:${height.toFixed(3)}%" title="跳转到第 ${hunk.id + 1} 处差异"></button>`;
  }).join('');
}

function updateMinimapViewport() {
  const scroll = $('#text-diff');
  const viewport = $('#minimap-viewport');
  if (!scroll || !viewport) return;
  const scrollable = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
  const height = scroll.scrollHeight ? Math.max(8, Math.min(100, scroll.clientHeight / scroll.scrollHeight * 100)) : 100;
  const top = scrollable ? scroll.scrollTop / scrollable * (100 - height) : 0;
  viewport.style.height = `${height}%`;
  viewport.style.top = `${top}%`;
}

function mergeHunk(hunkId, source) {
  const hunk = state.lineDiff?.hunks[Number(hunkId)];
  if (!hunk) return;
  if (source === 'left') state.rightLines.splice(hunk.rightStart, hunk.rightDelete, ...hunk.leftLines);
  else state.leftLines.splice(hunk.leftStart, hunk.leftDelete, ...hunk.rightLines);
  state.payloads.left.text = state.leftLines.join('\n');
  state.payloads.right.text = state.rightLines.join('\n');
  renderTextComparison(state.payloads.left, state.payloads.right, { left: state.leftLines, right: state.rightLines });
  toast(source === 'left' ? '已将这处左侧内容合并到右侧' : '已将这处右侧内容合并到左侧');
}

function updateDiffNavigation() {
  const available = Boolean(state.lineDiff?.differentLines);
  $('#previous-button').disabled = !available;
  $('#next-button').disabled = !available;
}

function navigateDifference(direction) {
  if (state.resultType === 'table') return navigateTableDifference(direction);
  const indexes = state.lineDiff?.rows.map((row, index) => row.type !== 'equal' ? index : -1).filter((index) => index >= 0) || [];
  if (!indexes.length) return;
  state.currentDifference = (state.currentDifference + direction + indexes.length) % indexes.length;
  scrollToDifference(indexes[state.currentDifference]);
}

function scrollToDifference(index) {
  $$('.diff-row.current').forEach((row) => row.classList.remove('current'));
  const row = $(`.diff-row[data-diff-index="${index}"]`);
  row?.classList.add('current');
  row?.scrollIntoView({ block: 'center' });
}

function payloadWorkbook(payload) {
  if (payload.type === 'workbook') return payload.workbook;
  return core.tableToWorkbook(core.parseDelimited(payload.text, payload.extension === '.tsv' ? '\t' : ','), payload.name);
}

function renderTableComparison(left, right) {
  const leftWorkbook = payloadWorkbook(left);
  const rightWorkbook = payloadWorkbook(right);
  state.workbook = { left: leftWorkbook, right: rightWorkbook };
  state.sheetNames = [...new Set([...leftWorkbook.sheets.map((sheet) => sheet.name), ...rightWorkbook.sheets.map((sheet) => sheet.name)])];
  $('#sheet-picker').innerHTML = state.sheetNames.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  state.resultType = 'table';
  const allRows = [];
  for (const name of state.sheetNames) {
    const leftSheet = leftWorkbook.sheets.find((sheet) => sheet.name === name);
    const rightSheet = rightWorkbook.sheets.find((sheet) => sheet.name === name);
    for (const row of core.compareSheets(leftSheet, rightSheet, comparisonOptions())) if (row.status !== 'same') allRows.push({
      工作表: name,
      单元格: row.address,
      左侧值: row.leftFormula ? `=${row.leftFormula} → ${row.left}` : row.left,
      右侧值: row.rightFormula ? `=${row.rightFormula} → ${row.right}` : row.right,
      结果: statusText(row.status)
    });
  }
  state.reportRows = allRows;
  showView('table-view');
  renderSelectedSheet();
  showSummary(allRows.length ? `发现 ${allRows.length} 个单元格差异` : '两份表格内容一致', [['工作表', state.sheetNames.length], ['差异单元格', allRows.length]]);
}

function renderSelectedSheet() {
  if (!state.workbook) return;
  const name = $('#sheet-picker').value || state.sheetNames[0];
  const leftSheet = state.workbook.left.sheets.find((sheet) => sheet.name === name);
  const rightSheet = state.workbook.right.sheets.find((sheet) => sheet.name === name);
  const allRows = core.compareSheets(leftSheet, rightSheet, comparisonOptions());
  const differences = allRows.filter((row) => row.status !== 'same');
  const axes = core.spreadsheetPreviewAxes(leftSheet, rightSheet, allRows, onlyDifferences(), { maxRows: 2500, maxColumns: 120 });
  const statusMap = new Map(allRows.map((row) => [row.address, row.status]));
  $('#left-sheet-name').textContent = `${state.payloads.left?.name || '左侧文件'} · ${name}`;
  $('#right-sheet-name').textContent = `${state.payloads.right?.name || '右侧文件'} · ${name}`;
  $('#left-sheet-grid').innerHTML = spreadsheetGridHtml(leftSheet, axes, statusMap, 'left');
  $('#right-sheet-grid').innerHTML = spreadsheetGridHtml(rightSheet, axes, statusMap, 'right');
  const visibleRows = new Set(axes.rows);
  const visibleColumns = new Set(axes.columns);
  state.tableDifferenceAddresses = differences.filter((item) => {
    const coordinate = core.parseCellAddress(item.address);
    return coordinate && visibleRows.has(coordinate.row) && visibleColumns.has(coordinate.column);
  }).map((row) => row.address);
  state.currentTableDifference = -1;
  $('#previous-button').disabled = !state.tableDifferenceAddresses.length;
  $('#next-button').disabled = !state.tableDifferenceAddresses.length;
  const modeText = onlyDifferences() ? `仅显示含差异的 ${axes.rows.length} 行、${axes.columns.length} 列` : `预览 ${axes.rows.length} 行、${axes.columns.length} 列`;
  $('#table-note').textContent = `${modeText} · ${differences.length} 个差异${axes.limited ? ' · 文件较大，已限制预览范围' : ''}`;
  $('#left-sheet-scroll').scrollTop = 0; $('#left-sheet-scroll').scrollLeft = 0;
  $('#right-sheet-scroll').scrollTop = 0; $('#right-sheet-scroll').scrollLeft = 0;
}

function spreadsheetGridHtml(sheet, axes, statusMap, side) {
  const cells = sheet?.cells || {};
  const header = `<thead><tr><th class="sheet-corner"></th>${axes.columns.map((column) => `<th>${core.columnLabel(column)}</th>`).join('')}</tr></thead>`;
  const body = axes.rows.map((row) => `<tr><th class="sheet-row-number">${row + 1}</th>${axes.columns.map((column) => {
    const address = `${core.columnLabel(column)}${row + 1}`;
    const cell = cells[address];
    const value = cell?.displayValue ?? cell?.value ?? '';
    const formulaNote = cell?.formula ? ` · 公式：=${cell.formula}` : '';
    const status = statusMap.get(address) || 'same';
    const className = status === 'different' ? 'cell-different' : status === 'left-only' ? 'cell-left-only' : status === 'right-only' ? 'cell-right-only' : '';
    return `<td class="${className}" data-address="${address}" data-side="${side}" title="${escapeHtml(address)} · ${escapeHtml(value)}${escapeHtml(formulaNote)}">${escapeHtml(value) || '&nbsp;'}</td>`;
  }).join('')}</tr>`).join('');
  return `${header}<tbody>${body}</tbody>`;
}

function navigateTableDifference(direction) {
  const addresses = state.tableDifferenceAddresses;
  if (!addresses.length) return;
  state.currentTableDifference = (state.currentTableDifference + direction + addresses.length) % addresses.length;
  selectSpreadsheetCell(addresses[state.currentTableDifference], true);
}

function selectSpreadsheetCell(address, center = false) {
  $$('.spreadsheet-grid td.cell-selected').forEach((cell) => cell.classList.remove('cell-selected'));
  const cells = $$(`.spreadsheet-grid td[data-address="${address}"]`);
  cells.forEach((cell) => cell.classList.add('cell-selected'));
  if (!center || !cells[0]) return;
  const cell = cells[0];
  const scroll = $('#left-sheet-scroll');
  scroll.scrollTop = Math.max(0, cell.offsetTop - scroll.clientHeight / 2);
  scroll.scrollLeft = Math.max(0, cell.offsetLeft - scroll.clientWidth / 2);
}

function syncSpreadsheetScroll(source, target) {
  if (spreadsheetScrollSyncing) return;
  spreadsheetScrollSyncing = true;
  target.scrollTop = source.scrollTop;
  target.scrollLeft = source.scrollLeft;
  requestAnimationFrame(() => { spreadsheetScrollSyncing = false; });
}

async function loadImage(image, dataUrl) {
  await new Promise((resolve, reject) => {
    image.onload = resolve; image.onerror = () => reject(new Error('图片解码失败')); image.src = dataUrl;
    if (image.complete && image.naturalWidth) resolve();
  });
}

async function renderImageComparison(left, right) {
  showView('image-view');
  $('#image-grid').classList.toggle('only-differences', onlyDifferences());
  const leftImage = $('#left-image'); const rightImage = $('#right-image');
  await Promise.all([loadImage(leftImage, left.dataUrl), loadImage(rightImage, right.dataUrl)]);
  const width = Math.max(leftImage.naturalWidth, rightImage.naturalWidth);
  const height = Math.max(leftImage.naturalHeight, rightImage.naturalHeight);
  const scale = Math.min(1, 1800 / Math.max(width, height));
  const canvasWidth = Math.max(1, Math.round(width * scale));
  const canvasHeight = Math.max(1, Math.round(height * scale));
  const leftCanvas = document.createElement('canvas'); const rightCanvas = document.createElement('canvas');
  leftCanvas.width = rightCanvas.width = canvasWidth; leftCanvas.height = rightCanvas.height = canvasHeight;
  leftCanvas.getContext('2d').drawImage(leftImage, 0, 0, leftImage.naturalWidth * scale, leftImage.naturalHeight * scale);
  rightCanvas.getContext('2d').drawImage(rightImage, 0, 0, rightImage.naturalWidth * scale, rightImage.naturalHeight * scale);
  const leftPixels = leftCanvas.getContext('2d').getImageData(0, 0, canvasWidth, canvasHeight);
  const rightPixels = rightCanvas.getContext('2d').getImageData(0, 0, canvasWidth, canvasHeight);
  const output = new ImageData(canvasWidth, canvasHeight);
  let changed = 0;
  for (let index = 0; index < leftPixels.data.length; index += 4) {
    const distance = Math.abs(leftPixels.data[index] - rightPixels.data[index]) + Math.abs(leftPixels.data[index + 1] - rightPixels.data[index + 1]) + Math.abs(leftPixels.data[index + 2] - rightPixels.data[index + 2]) + Math.abs(leftPixels.data[index + 3] - rightPixels.data[index + 3]);
    const different = distance > 35;
    if (different) changed += 1;
    output.data[index] = different ? 255 : leftPixels.data[index] * .22;
    output.data[index + 1] = different ? 55 : leftPixels.data[index + 1] * .22;
    output.data[index + 2] = different ? 70 : leftPixels.data[index + 2] * .22;
    output.data[index + 3] = 255;
  }
  const canvas = $('#difference-canvas'); canvas.width = canvasWidth; canvas.height = canvasHeight; canvas.getContext('2d').putImageData(output, 0, 0);
  const total = canvasWidth * canvasHeight;
  const percentage = total ? changed / total * 100 : 0;
  state.resultType = 'image';
  state.reportRows = [{ 项目: '左侧尺寸', 结果: `${leftImage.naturalWidth} × ${leftImage.naturalHeight}` }, { 项目: '右侧尺寸', 结果: `${rightImage.naturalWidth} × ${rightImage.naturalHeight}` }, { 项目: '差异像素占比', 结果: `${percentage.toFixed(3)}%` }];
  showSummary(changed ? `像素差异 ${percentage.toFixed(3)}%` : '两张图片像素一致', [['对比像素', total.toLocaleString()], ['变化像素', changed.toLocaleString()]]);
}

function decodeBase64(value) {
  const binary = atob(value); const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function renderBinaryComparison(left, right) {
  const leftBytes = decodeBase64(left.data); const rightBytes = decodeBase64(right.data);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let changed = 0;
  const changedOffsets = [];
  for (let index = 0; index < length; index += 1) if (leftBytes[index] !== rightBytes[index]) { changed += 1; if (changedOffsets.length < 20000) changedOffsets.push({ 偏移地址: `0x${index.toString(16).padStart(8, '0')}`, 左侧字节: leftBytes[index] == null ? '' : leftBytes[index].toString(16).padStart(2, '0'), 右侧字节: rightBytes[index] == null ? '' : rightBytes[index].toString(16).padStart(2, '0') }); }
  const displayLength = Math.min(length, 65536);
  let html = '';
  for (let offset = 0; offset < displayLength; offset += 16) {
    const leftSlice = [...leftBytes.slice(offset, offset + 16)]; const rightSlice = [...rightBytes.slice(offset, offset + 16)];
    const rowChanged = leftSlice.length !== rightSlice.length || leftSlice.some((value, index) => value !== rightSlice[index]);
    if (onlyDifferences() && !rowChanged) continue;
    const bytes = (values) => values.map((value) => value.toString(16).padStart(2, '0')).join(' ');
    html += `<div class="binary-row${rowChanged ? ' changed' : ''}"><div class="binary-cell"><span class="binary-offset">${offset.toString(16).padStart(8, '0')}</span><span>${bytes(leftSlice)}</span></div><div class="binary-cell"><span class="binary-offset">${offset.toString(16).padStart(8, '0')}</span><span>${bytes(rightSlice)}</span></div></div>`;
  }
  $('#binary-diff').innerHTML = html;
  state.resultType = 'binary'; state.reportRows = changedOffsets;
  showView('binary-view');
  showSummary(changed ? `发现 ${changed.toLocaleString()} 个字节不同` : '两个二进制文件一致', [['左侧', formatBytes(left.size)], ['右侧', formatBytes(right.size)], ['展示', formatBytes(displayLength)]]);
}

async function compareDirectories() {
  const result = await api.compareDirectories({
    leftRoot: state.paths.left.path,
    rightRoot: state.paths.right.path,
    options: { compareBy: $('#directory-compare-by').value, extensions: $('#directory-extensions').value, exclude: $('#directory-exclude').value }
  });
  state.directoryResult = result;
  state.resultType = 'directory';
  state.reportRows = result.rows.filter((row) => row.status !== 'same').map((row) => ({
    相对路径: row.relativePath, 左侧大小: row.left?.kind === 'file' ? row.left.size : '', 右侧大小: row.right?.kind === 'file' ? row.right.size : '', 结果: statusText(row.status)
  }));
  showView('directory-view');
  renderDirectoryRows();
  const counts = Object.fromEntries(['same', 'different', 'left-only', 'right-only'].map((status) => [status, result.rows.filter((row) => row.status === status).length]));
  showSummary(state.reportRows.length ? `发现 ${state.reportRows.length} 项差异` : '两个文件夹内容一致', [['不同', counts.different], ['仅左侧', counts['left-only']], ['仅右侧', counts['right-only']], ['相同', counts.same]]);
  if (result.limited) toast('目录内容较多，本次最多扫描 20,000 项');
}

function statusText(status) {
  return ({ same: '相同', different: '内容不同', 'left-only': '仅左侧', 'right-only': '仅右侧' })[status] || status;
}

function renderDirectoryRows() {
  if (!state.directoryResult) return;
  let rows = state.directoryResult.rows.filter((row) => state.directoryFilter === 'all' || row.status === state.directoryFilter);
  rows = core.filterDifferenceRows(rows, onlyDifferences());
  $('#directory-body').innerHTML = rows.slice(0, 8000).map((row) => {
    const file = row.left?.kind === 'file' || row.right?.kind === 'file';
    const syncLeft = row.right && row.status !== 'same' ? `<button data-sync="right-left" data-path="${escapeHtml(row.relativePath)}">← 到左侧</button>` : '';
    const syncRight = row.left && row.status !== 'same' ? `<button data-sync="left-right" data-path="${escapeHtml(row.relativePath)}">到右侧 →</button>` : '';
    return `<tr class="row-${row.status}" data-directory-path="${escapeHtml(row.relativePath)}" data-file="${file ? '1' : '0'}"><td title="${escapeHtml(row.relativePath)}">${row.left?.kind === 'directory' || row.right?.kind === 'directory' ? '▸ ' : ''}${escapeHtml(row.relativePath)}</td><td>${row.left ? row.left.kind === 'file' ? formatBytes(row.left.size) : '文件夹' : '—'}</td><td>${row.right ? row.right.kind === 'file' ? formatBytes(row.right.size) : '文件夹' : '—'}</td><td><span class="status-pill ${row.status}">${statusText(row.status)}</span></td><td><span class="sync-buttons">${syncLeft}${syncRight}</span></td></tr>`;
  }).join('');
}

function applyDifferenceVisibility() {
  const sameFilter = $('[data-status="same"]');
  if (sameFilter) sameFilter.disabled = onlyDifferences();
  if (!state.resultType) return;
  if (state.resultType === 'text') renderDiffRows();
  else if (state.resultType === 'table') renderSelectedSheet();
  else if (state.resultType === 'image') $('#image-grid').classList.toggle('only-differences', onlyDifferences());
  else if (state.resultType === 'binary') renderBinaryComparison(state.payloads.left, state.payloads.right);
  else if (state.resultType === 'directory') {
    if (onlyDifferences() && state.directoryFilter === 'same') {
      state.directoryFilter = 'all';
      $$('[data-status]').forEach((item) => item.classList.toggle('active', item.dataset.status === 'all'));
    }
    renderDirectoryRows();
  }
  toast(onlyDifferences() ? '现在只展示不同的地方' : '已恢复展示完整内容');
}

function joinLocal(root, relativePath) {
  const separator = root.includes('\\') ? '\\' : '/';
  return `${root.replace(/[\\/]$/, '')}${separator}${relativePath.replaceAll('/', separator)}`;
}

async function openDirectoryEntry(relativePath) {
  const row = state.directoryResult?.rows.find((item) => item.relativePath === relativePath);
  if (!row || row.left?.kind !== 'file' || row.right?.kind !== 'file') return toast('需要左右两侧都存在文件才能进入详细对比');
  try {
    const leftPath = joinLocal(state.directoryResult.leftRoot, relativePath); const rightPath = joinLocal(state.directoryResult.rightRoot, relativePath);
    state.mode = 'file';
    $$('.mode-tabs button').forEach((button) => button.classList.toggle('active', button.dataset.mode === 'file'));
    $('#file-options').hidden = false; $('#directory-options').hidden = true;
    state.paths.left = await api.inspectPath(leftPath); state.paths.right = await api.inspectPath(rightPath);
    updatePathUi('left'); updatePathUi('right');
    await runCompare();
  } catch (error) {
    toast(error.message || '文件已移动或无法打开');
  }
}

async function syncDirectoryEntry(direction, relativePath) {
  const leftToRight = direction === 'left-right';
  const sourceRoot = leftToRight ? state.directoryResult.leftRoot : state.directoryResult.rightRoot;
  const targetRoot = leftToRight ? state.directoryResult.rightRoot : state.directoryResult.leftRoot;
  const targetName = leftToRight ? '右侧' : '左侧';
  if (!confirm(`确定将“${relativePath}”复制并覆盖到${targetName}吗？\n此操作不会删除其他文件。`)) return;
  try {
    setStatus('正在同步文件…', 'working');
    await api.syncEntry({ sourceRoot, targetRoot, relativePath });
    toast('同步完成，正在重新对比');
    await runCompare({ addToHistory: false });
  } catch (error) {
    setStatus(error.message || '同步失败', 'error'); toast(error.message || '同步失败');
  }
}

async function saveSide(side) {
  const lines = side === 'left' ? state.leftLines : state.rightLines;
  const payload = state.payloads[side];
  try {
    const result = await api.saveText({ content: lines.join('\n'), suggestedName: `合并-${payload.name}` });
    if (result) toast(`已保存到 ${result.path}`);
  } catch (error) { toast(error.message || '保存失败'); }
}

function reportHtml() {
  const rows = state.reportRows.slice(0, 30000);
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const table = headers.length ? `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p>没有差异数据。</p>';
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Test cat 文件对比报告</title><style>body{font:14px system-ui;margin:32px;color:#17212f}h1{margin-bottom:6px}p{color:#657084}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{padding:8px;border:1px solid #d9dee7;text-align:left;white-space:pre-wrap}th{background:#edf4ff}</style><h1>Test cat 文件对比报告</h1><p>${escapeHtml(state.resultTitle)} · ${new Date().toLocaleString('zh-CN')}</p><p>左侧：${escapeHtml(state.paths.left?.path || '')}<br>右侧：${escapeHtml(state.paths.right?.path || '')}</p>${table}</html>`;
}

async function exportReport(format) {
  if (!state.resultType) return;
  try {
    const result = await api.exportReport({ format, html: reportHtml(), rows: state.reportRows.slice(0, 30000), suggestedName: `Test-cat-${state.resultType}-对比报告.${format === 'excel' ? 'xls' : 'html'}` });
    if (result) toast(`报告已导出到 ${result.path}`);
  } catch (error) { toast(error.message || '导出失败'); }
}

function histories() {
  try { const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; }
}

function addHistory() {
  const entry = { id: Date.now(), mode: state.mode, left: state.paths.left, right: state.paths.right, title: state.resultTitle, time: new Date().toISOString() };
  const list = [entry, ...histories().filter((item) => item.left?.path !== entry.left.path || item.right?.path !== entry.right.path || item.mode !== entry.mode)].slice(0, 20);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
}

function renderHistory() {
  const list = histories();
  $('#history-list').innerHTML = list.length ? list.map((item) => `<button class="history-item" data-history="${item.id}"><span>${item.mode === 'directory' ? '文件夹' : '文件'}</span><div><strong>${escapeHtml(item.left?.name || '')} ⇄ ${escapeHtml(item.right?.name || '')}</strong><small>${escapeHtml(item.title || '')}</small></div><time>${new Date(item.time).toLocaleString('zh-CN')}</time></button>`).join('') : '<div class="empty-state" style="min-height:220px"><p>还没有对比记录</p></div>';
}

async function loadHistory(id) {
  const entry = histories().find((item) => item.id === Number(id));
  if (!entry) return;
  try {
    state.mode = entry.mode;
    $$('.mode-tabs button').forEach((button) => button.classList.toggle('active', button.dataset.mode === state.mode));
    $('#file-options').hidden = state.mode !== 'file'; $('#directory-options').hidden = state.mode !== 'directory';
    state.paths.left = await api.inspectPath(entry.left.path); state.paths.right = await api.inspectPath(entry.right.path);
    updatePathUi('left'); updatePathUi('right'); $('#history-modal').hidden = true;
    await runCompare({ addToHistory: false });
  } catch (error) { toast(`历史文件已移动或删除：${error.message || ''}`); }
}

$$('.mode-tabs button').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
$('#left-picker').addEventListener('click', () => choosePath('left'));
$('#right-picker').addEventListener('click', () => choosePath('right'));
$$('.drop-zone').forEach((zone) => {
  zone.addEventListener('dragover', (event) => { event.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (event) => { event.preventDefault(); zone.classList.remove('dragover'); acceptDrop(zone.dataset.side, event.dataTransfer.files[0]); });
});
$('#swap-button').addEventListener('click', () => {
  [state.paths.left, state.paths.right] = [state.paths.right, state.paths.left]; updatePathUi('left'); updatePathUi('right'); resetResult();
});
$('#compare-button').addEventListener('click', () => runCompare());
$('#previous-button').addEventListener('click', () => navigateDifference(-1));
$('#next-button').addEventListener('click', () => navigateDifference(1));
$('#only-differences').addEventListener('change', applyDifferenceVisibility);
$('#text-diff').addEventListener('click', (event) => { const button = event.target.closest('[data-merge]'); if (button) mergeHunk(button.dataset.hunk, button.dataset.merge); });
$('#text-diff').addEventListener('scroll', updateMinimapViewport);
$('#diff-minimap').addEventListener('click', (event) => {
  const marker = event.target.closest('[data-overview-index]');
  if (marker) return scrollToDifference(Number(marker.dataset.overviewIndex));
  const rows = state.lineDiff?.rows || [];
  const differenceIndexes = rows.map((row, index) => row.type !== 'equal' ? index : -1).filter((index) => index >= 0);
  if (!differenceIndexes.length) return;
  const bounds = $('#diff-minimap').getBoundingClientRect();
  const desiredIndex = Math.round(Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) * Math.max(0, rows.length - 1));
  const nearest = differenceIndexes.reduce((best, index) => Math.abs(index - desiredIndex) < Math.abs(best - desiredIndex) ? index : best, differenceIndexes[0]);
  scrollToDifference(nearest);
});
$('#sheet-picker').addEventListener('change', renderSelectedSheet);
$('#left-sheet-scroll').addEventListener('scroll', () => syncSpreadsheetScroll($('#left-sheet-scroll'), $('#right-sheet-scroll')));
$('#right-sheet-scroll').addEventListener('scroll', () => syncSpreadsheetScroll($('#right-sheet-scroll'), $('#left-sheet-scroll')));
$('.spreadsheet-compare').addEventListener('click', (event) => {
  const cell = event.target.closest('td[data-address]');
  if (cell) selectSpreadsheetCell(cell.dataset.address);
});
$('#save-left').addEventListener('click', () => saveSide('left')); $('#save-right').addEventListener('click', () => saveSide('right'));
$('#export-html').addEventListener('click', () => exportReport('html')); $('#export-excel').addEventListener('click', () => exportReport('excel'));
$$('[data-status]').forEach((button) => button.addEventListener('click', () => { state.directoryFilter = button.dataset.status; $$('[data-status]').forEach((item) => item.classList.toggle('active', item === button)); renderDirectoryRows(); }));
$('#directory-body').addEventListener('click', (event) => { const button = event.target.closest('[data-sync]'); if (button) syncDirectoryEntry(button.dataset.sync, button.dataset.path); });
$('#directory-body').addEventListener('dblclick', (event) => { const row = event.target.closest('[data-directory-path]'); if (row?.dataset.file === '1') openDirectoryEntry(row.dataset.directoryPath); });
$('#history-button').addEventListener('click', () => { renderHistory(); $('#history-modal').hidden = false; });
$('#close-history').addEventListener('click', () => { $('#history-modal').hidden = true; });
$('#history-modal').addEventListener('click', (event) => { if (event.target === $('#history-modal')) $('#history-modal').hidden = true; });
$('#history-list').addEventListener('click', (event) => { const item = event.target.closest('[data-history]'); if (item) loadHistory(item.dataset.history); });
$('#clear-history').addEventListener('click', () => { if (confirm('确定清空文件对比历史记录吗？')) { localStorage.removeItem(HISTORY_KEY); renderHistory(); } });
window.addEventListener('resize', updateMinimapViewport);
document.body.classList.add(window.testCat?.platform === 'darwin' ? 'mac' : 'windows');
