const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { createSpreadsheetXml, decodeText, parseXlsx, unzipEntries } = require('./file-compare-service');

const MAX_REQUIREMENT_TEXT = 220_000;
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.log', '.json', '.xml', '.csv', '.tsv', '.html', '.htm', '.yaml', '.yml']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const MAX_REQUIREMENT_IMAGES = 6;
const MAX_REQUIREMENT_IMAGE_BYTES = 4 * 1024 * 1024;

function xmlText(xml = '') {
  return String(xml)
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function compactText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, MAX_REQUIREMENT_TEXT);
}

function extractDocxText(entries) {
  const parts = [
    'word/document.xml',
    ...[...entries.keys()].filter((name) => /^word\/(?:header|footer)\d+\.xml$/i.test(name)).sort()
  ];
  const text = parts.map((name) => entries.get(name) ? xmlText(entries.get(name).toString('utf8')) : '').filter(Boolean).join('\n');
  return compactText(text);
}

function extractXlsxText(buffer) {
  const workbook = parseXlsx(buffer);
  const chunks = [];
  for (const sheet of workbook.sheets || []) {
    chunks.push('【工作表】' + sheet.name);
    const rows = Math.min(sheet.rows || 0, 300);
    const columns = Math.min(sheet.columns || 0, 40);
    for (let row = 0; row < rows; row += 1) {
      const cells = [];
      for (let column = 0; column < columns; column += 1) {
        const address = indexToColumnName(column) + String(row + 1);
        const cell = sheet.cells?.[address];
        cells.push(cell?.displayValue || cell?.value || '');
      }
      if (cells.some(Boolean)) chunks.push(cells.join('\t').replace(/\t+$/g, ''));
    }
  }
  const text = chunks.join('\n');
  if (!text.trim()) throw new Error('没有从 Excel 文件中提取到可用文字');
  return compactText(text);
}

function indexToColumnName(index) {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    const mod = (value - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    value = Math.floor((value - mod) / 26);
  }
  return name;
}

function sanitizeFileName(value, fallback = 'AI测试用例') {
  return String(value || fallback).replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) || fallback;
}

function imageMimeFromExtension(extension) {
  const normalized = String(extension || '').toLowerCase();
  if (normalized === '.jpg' || normalized === '.jpeg') return 'image/jpeg';
  if (normalized === '.png') return 'image/png';
  if (normalized === '.webp') return 'image/webp';
  if (normalized === '.gif') return 'image/gif';
  return '';
}

function imagePayloadFromBuffer(name, buffer) {
  const extension = path.extname(name).toLowerCase();
  const mime = imageMimeFromExtension(extension);
  if (!mime || !Buffer.isBuffer(buffer) || !buffer.length) return null;
  if (buffer.length > MAX_REQUIREMENT_IMAGE_BYTES) {
    return { skipped: true, name: path.basename(name), reason: '图片超过 4MB，已跳过' };
  }
  return {
    name: path.basename(name),
    mime,
    size: buffer.length,
    dataUrl: `data:${mime};base64,${buffer.toString('base64')}`
  };
}

function collectEmbeddedImages(entries, directoryPrefix) {
  const images = [];
  let skipped = 0;
  for (const [name, buffer] of entries) {
    if (!String(name).startsWith(directoryPrefix)) continue;
    if (!IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase())) continue;
    const payload = imagePayloadFromBuffer(name, buffer);
    if (!payload) continue;
    if (payload.skipped || images.length >= MAX_REQUIREMENT_IMAGES) {
      skipped += 1;
      continue;
    }
    images.push(payload);
  }
  return { images, skipped };
}

function normalizeImagePayloads(images = []) {
  if (!Array.isArray(images)) return [];
  return images.slice(0, MAX_REQUIREMENT_IMAGES).map((image) => {
    const dataUrl = String(image?.dataUrl || '');
    if (!/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+$/i.test(dataUrl)) return null;
    return { type: 'image_url', image_url: { url: dataUrl } };
  }).filter(Boolean);
}

function endpointFromBaseUrl(baseUrl) {
  const normalized = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!normalized) throw new Error('请先在设置里填写 AI Base URL');
  if (/\/chat\/completions$/i.test(normalized)) return normalized;
  return normalized + '/chat/completions';
}

function buildAssistantMessages(payload = {}) {
  const taskName = String(payload.taskName || 'AI 测试任务').trim().slice(0, 80) || 'AI 测试任务';
  const prompt = String(payload.prompt || '').trim();
  if (!prompt) throw new Error('请先填写 AI 执行提示词');
  const inputText = compactText(payload.inputText ?? payload.requirementText ?? '');
  const extraContext = String(payload.extraContext ?? payload.extraConditions ?? '').trim();
  const outputGuide = String(payload.outputGuide || '').trim();
  const imageContent = normalizeImagePayloads(payload.images);
  if (!inputText && !imageContent.length) throw new Error('请先输入或导入要处理的内容');
  const userText = [
    `【任务】${taskName}`,
    '',
    '【执行提示词】',
    prompt,
    '',
    '【补充说明】',
    extraContext || '无',
    '',
    imageContent.length ? `【图片附件】本次随请求附带 ${imageContent.length} 张图片；如果模型支持视觉，请结合图片内容。` : '',
    imageContent.length ? '' : '',
    '【输入内容】',
    inputText || '内容主要来自图片附件，请先理解图片内容。',
    outputGuide ? '' : '',
    outputGuide ? '【输出格式要求】' : '',
    outputGuide
  ].filter((line) => line !== '').join('\n');
  return [{
    role: 'user',
    content: imageContent.length ? [{ type: 'text', text: userText }, ...imageContent] : userText
  }];
}

function parseMarkdownTable(text) {
  const lines = String(text || '').split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!/^\s*\|.*\|\s*$/.test(lines[index])) continue;
    if (!/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])) continue;
    const headers = splitMarkdownRow(lines[index]).map((item) => item.trim()).filter(Boolean);
    if (!headers.length) continue;
    const rows = [];
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      if (!/^\s*\|.*\|\s*$/.test(lines[rowIndex])) break;
      const cells = splitMarkdownRow(lines[rowIndex]);
      const row = {};
      headers.forEach((header, cellIndex) => { row[header] = (cells[cellIndex] || '').trim(); });
      if (Object.values(row).some(Boolean)) rows.push(row);
    }
    if (rows.length) return rows;
  }
  return [];
}

function splitMarkdownRow(line) {
  const trimmed = String(line || '').trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let current = '';
  let escaped = false;
  for (const char of trimmed) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '|') {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function rowsFromResult(text) {
  const tableRows = parseMarkdownTable(text);
  if (tableRows.length) return tableRows;
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => ({
    序号: index + 1,
    内容: line
  }));
}

function preferredValue(row, keys) {
  for (const key of keys) {
    const found = Object.keys(row).find((item) => item.replace(/\s/g, '').includes(key));
    if (found && row[found]) return row[found];
  }
  return '';
}

function xmindTopic(title, children = []) {
  return {
    id: 'topic-' + Math.random().toString(36).slice(2, 10),
    class: 'topic',
    title: String(title || '未命名').slice(0, 120),
    ...(children.length ? { children: { attached: children } } : {})
  };
}

function xmindContent(rows, rootTitle = 'AI 测试用例') {
  const groups = new Map();
  for (const row of rows) {
    const groupName = preferredValue(row, ['模块', '功能', '需求']) || '测试用例';
    if (!groups.has(groupName)) groups.set(groupName, []);
    const title = preferredValue(row, ['用例标题', '用例名称', '测试点', '标题']) || row.内容 || Object.values(row).find(Boolean) || '测试用例';
    const detailKeys = ['前置条件', '操作步骤', '步骤', '预期结果', '期望结果', '优先级', '类型', '备注'];
    const children = detailKeys.map((key) => {
      const value = preferredValue(row, [key]);
      return value ? xmindTopic(`${key}：${value}`) : null;
    }).filter(Boolean);
    groups.get(groupName).push(xmindTopic(title, children));
  }
  const rootTopic = xmindTopic(rootTitle, [...groups.entries()].map(([name, topics]) => xmindTopic(name, topics)));
  return [{
    id: 'sheet-' + Date.now().toString(36),
    class: 'sheet',
    title: rootTitle,
    rootTopic
  }];
}

const crcTable = (() => {
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0 ^ -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const now = dosDateTime();
  for (const file of files) {
    const nameBuffer = Buffer.from(file.name, 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), 'utf8');
    const compressed = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBuffer.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(now.dosTime, 10);
    local.writeUInt16LE(now.dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    nameBuffer.copy(local, 30);
    localParts.push(local, compressed);

    const central = Buffer.alloc(46 + nameBuffer.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(now.dosTime, 12);
    central.writeUInt16LE(now.dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuffer.copy(central, 46);
    centralParts.push(central);
    offset += local.length + compressed.length;
  }
  const centralSize = centralParts.reduce((sum, item) => sum + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function createXmindBuffer(rows, title) {
  const content = JSON.stringify(xmindContent(rows, title), null, 2);
  const metadata = JSON.stringify({
    creator: { name: 'Test cat', version: '0.8.9' },
    activeSheetId: JSON.parse(content)[0]?.id
  }, null, 2);
  const manifest = JSON.stringify({
    'file-entries': {
      'content.json': {},
      'metadata.json': {},
      'manifest.json': {}
    }
  }, null, 2);
  return createZip([
    { name: 'content.json', data: content },
    { name: 'metadata.json', data: metadata },
    { name: 'manifest.json', data: manifest }
  ]);
}

class AiTestAssistantService {
  constructor({ dialog, getWindow, getSettings }) {
    this.dialog = dialog;
    this.getWindow = getWindow;
    this.getSettings = getSettings;
  }

  async selectRequirementFile() {
    const result = await this.dialog.showOpenDialog(this.getWindow?.(), {
      title: '选择需求文件',
      properties: ['openFile'],
      filters: [
        { name: '需求文件', extensions: ['txt', 'md', 'markdown', 'log', 'json', 'xml', 'csv', 'tsv', 'html', 'htm', 'yaml', 'yml', 'docx', 'xlsx', 'png', 'jpg', 'jpeg', 'webp', 'gif'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePaths?.[0]) return null;
    return this.extractRequirementFile(result.filePaths[0]);
  }

  async extractRequirementFile(filePath) {
    if (!filePath) throw new Error('请选择需求文件');
    const extension = path.extname(filePath).toLowerCase();
    let buffer = null;
    try {
      buffer = await fs.promises.readFile(filePath);
    } catch {
      throw new Error('需求文件读取失败，请确认文件仍存在且有访问权限');
    }
    let text = '';
    let images = [];
    let skippedImages = 0;
    if (TEXT_EXTENSIONS.has(extension)) {
      text = decodeText(buffer);
    } else if (IMAGE_EXTENSIONS.has(extension)) {
      const image = imagePayloadFromBuffer(filePath, buffer);
      if (!image || image.skipped) throw new Error(image?.reason || '图片文件读取失败');
      images = [image];
      text = `【图片需求】已导入图片文件：${path.basename(filePath)}。请结合图片内容提取需求并生成测试用例。`;
    } else if (extension === '.docx') {
      const entries = unzipEntries(buffer);
      text = extractDocxText(entries);
      const embedded = collectEmbeddedImages(entries, 'word/media/');
      images = embedded.images;
      skippedImages = embedded.skipped;
    } else if (extension === '.xlsx') {
      const entries = unzipEntries(buffer);
      const embedded = collectEmbeddedImages(entries, 'xl/media/');
      images = embedded.images;
      skippedImages = embedded.skipped;
      try {
        text = extractXlsxText(buffer);
      } catch (error) {
        if (!images.length) throw error;
        text = `【图片需求】Excel 中未提取到文字，但检测到 ${images.length} 张图片。请结合图片内容提取需求并生成测试用例。`;
      }
    } else {
      throw new Error('暂不支持该文件格式，请先转换为 txt、md、docx、xlsx 或图片文件');
    }
    if (!String(text || '').trim() && !images.length) throw new Error('没有从文件中提取到可用需求内容');
    return {
      fileName: path.basename(filePath),
      extension,
      text: compactText(text),
      truncated: String(text || '').length > MAX_REQUIREMENT_TEXT,
      images,
      imageCount: images.length,
      skippedImages,
      imageWarning: skippedImages ? `有 ${skippedImages} 张图片因数量或大小限制未加入` : ''
    };
  }

  async generateTestCases(payload = {}) {
    const prompt = String(payload.prompt || '').trim();
    if (!prompt) throw new Error('请先填写测试用例生成提示词');
    const requirementText = String(payload.requirementText || '').trim();
    const imageContent = normalizeImagePayloads(payload.images);
    if (!requirementText && !imageContent.length) throw new Error('请先输入或导入需求内容');
    return this.runTask({
      taskName: '测试用例生成',
      prompt,
      inputText: requirementText,
      extraContext: String(payload.extraConditions || '').trim() || '无',
      images: payload.images,
      outputGuide: '优先输出 Markdown 表格，字段建议包含：模块、用例标题、前置条件、操作步骤、预期结果、优先级、备注。'
    });
  }

  async runTask(payload = {}) {
    const settings = this.getSettings?.() || {};
    if (settings.enabled === false) throw new Error('AI 功能已关闭，请先在设置里开启');
    const apiKey = String(settings.apiKey || '').trim();
    const model = String(settings.model || '').trim();
    if (!apiKey) throw new Error('请先在设置里填写 AI API Key');
    if (!model) throw new Error('请先在设置里填写 AI Model');
    const messages = buildAssistantMessages(payload);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    try {
      const response = await fetch(endpointFromBaseUrl(settings.baseUrl), {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: Number.isFinite(Number(settings.temperature)) ? Number(settings.temperature) : 0.2
        })
      });
      const text = await response.text();
      let data = null;
      try { data = JSON.parse(text); } catch {}
      if (!response.ok) {
        const message = data?.error?.message || data?.message || text || `AI 请求失败：${response.status}`;
        throw new Error(message);
      }
      const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || '';
      if (!content.trim()) throw new Error('AI 没有返回内容');
      return { content: content.trim(), usage: data?.usage || null, taskName: String(payload.taskName || '').trim() };
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('AI 请求超时，请检查网络或模型服务');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async testConnection() {
    const settings = this.getSettings?.() || {};
    if (settings.enabled === false) throw new Error('AI 功能已关闭，请先在设置里开启');
    const apiKey = String(settings.apiKey || '').trim();
    const model = String(settings.model || '').trim();
    if (!apiKey) throw new Error('请先填写 AI API Key');
    if (!model) throw new Error('请先填写 AI Model');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(endpointFromBaseUrl(settings.baseUrl), {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'ping' }],
          temperature: 0,
          max_tokens: 8
        })
      });
      const text = await response.text();
      let data = null;
      try { data = JSON.parse(text); } catch {}
      if (!response.ok) {
        const message = data?.error?.message || data?.message || text || `AI 连接失败：${response.status}`;
        throw new Error(message);
      }
      return {
        ok: true,
        model,
        content: (data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || '').trim(),
        usage: data?.usage || null
      };
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('AI 连接超时，请检查网络、Base URL 或代理');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async exportExcel(payload = {}) {
    const rows = rowsFromResult(payload.content || '');
    const exportTitle = sanitizeFileName(payload.title || 'AI结果', 'AI结果');
    const sheetName = sanitizeFileName(payload.sheetName || payload.title || 'AI结果', 'AI结果').replace(/[&']/g, '-').slice(0, 28);
    const defaultPath = exportTitle + '.xls';
    const result = await this.dialog.showSaveDialog(this.getWindow?.(), {
      title: '导出 AI 结果 Excel',
      defaultPath,
      filters: [{ name: 'Excel 工作簿', extensions: ['xls'] }]
    });
    if (result.canceled || !result.filePath) return null;
    const excelXml = createSpreadsheetXml(rows, sheetName)
      .replace('<Worksheet ss:Name="差异报告">', `<Worksheet ss:Name="${sheetName}">`);
    await fs.promises.writeFile(result.filePath, '\ufeff' + excelXml, 'utf8');
    return { filePath: result.filePath, rows: rows.length };
  }

  async exportXmind(payload = {}) {
    const rows = rowsFromResult(payload.content || '');
    const defaultPath = sanitizeFileName(payload.title || 'AI测试用例') + '.xmind';
    const result = await this.dialog.showSaveDialog(this.getWindow?.(), {
      title: '导出测试用例 XMind',
      defaultPath,
      filters: [{ name: 'XMind 文件', extensions: ['xmind'] }]
    });
    if (result.canceled || !result.filePath) return null;
    await fs.promises.writeFile(result.filePath, createXmindBuffer(rows, payload.title || 'AI 测试用例'));
    return { filePath: result.filePath, rows: rows.length };
  }
}

module.exports = {
  AiTestAssistantService,
  buildAssistantMessages,
  compactText,
  createXmindBuffer,
  parseMarkdownTable,
  rowsFromResult
};
