const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
const TEXT_EXTENSIONS = new Set([
  '.txt', '.log', '.md', '.json', '.xml', '.csv', '.tsv', '.html', '.htm', '.css', '.scss', '.less',
  '.js', '.jsx', '.ts', '.tsx', '.vue', '.java', '.kt', '.kts', '.swift', '.m', '.mm', '.c', '.h', '.cpp',
  '.hpp', '.cs', '.go', '.rs', '.py', '.rb', '.php', '.sh', '.zsh', '.bash', '.bat', '.cmd', '.ps1', '.sql',
  '.yaml', '.yml', '.ini', '.conf', '.properties', '.gradle', '.toml', '.env'
]);
const MAX_FILE_BYTES = 80 * 1024 * 1024;
const MAX_TEXT_BYTES = 20 * 1024 * 1024;
const MAX_BINARY_BYTES = 4 * 1024 * 1024;
const MAX_DIRECTORY_ENTRIES = 20000;

function xmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[char]);
}

function decodeXml(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function decodeText(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.allocUnsafe(buffer.length - 2);
    for (let index = 2; index + 1 < buffer.length; index += 2) {
      swapped[index - 2] = buffer[index + 1];
      swapped[index - 1] = buffer[index];
    }
    return swapped.toString('utf16le');
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return buffer.subarray(3).toString('utf8');
  const utf8 = buffer.toString('utf8');
  const utf8Errors = (utf8.match(/\uFFFD/g) || []).length;
  if (!utf8Errors) return utf8;
  try {
    const legacy = new TextDecoder('gb18030').decode(buffer);
    const legacyErrors = (legacy.match(/\uFFFD/g) || []).length;
    return legacyErrors < utf8Errors ? legacy : utf8;
  } catch {
    return utf8;
  }
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  let controls = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 7 || (byte > 13 && byte < 32)) controls += 1;
  }
  return sample.length > 0 && controls / sample.length > 0.08;
}

function columnNameToIndex(name) {
  let result = 0;
  for (const char of name) result = result * 26 + char.charCodeAt(0) - 64;
  return result - 1;
}

function unzipEntries(buffer) {
  let eocd = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65557); index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
  }
  if (eocd < 0) throw new Error('无法读取 Excel 文件：ZIP 目录损坏');
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  const result = new Map();
  let expandedBytes = 0;
  let offset = directoryOffset;
  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('无法读取 Excel 文件：目录项损坏');
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    if (flags & 1) throw new Error('无法读取加密的 Excel 文件，请先解除密码保护');
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) throw new Error('暂不支持 ZIP64 格式的超大 Excel 文件');
    expandedBytes += uncompressedSize;
    if (uncompressedSize > 200 * 1024 * 1024 || expandedBytes > 300 * 1024 * 1024) throw new Error('Excel 文件解压后过大，已停止读取');
    const name = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8').replaceAll('\\', '/');
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('无法读取 Excel 文件：数据项损坏');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    if (!name.endsWith('/')) {
      if (method === 0) result.set(name, Buffer.from(compressed));
      else if (method === 8) result.set(name, zlib.inflateRawSync(compressed));
      else throw new Error(`无法读取 Excel 文件：不支持的压缩方式 ${method}`);
    }
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return result;
}

function parseRelationships(xml = '') {
  const relations = new Map();
  for (const tag of xml.match(/<Relationship\b[^>]*>/g) || []) {
    const id = /\bId="([^"]+)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
    if (id && target) relations.set(id, decodeXml(target));
  }
  return relations;
}

function parseSharedStrings(xml = '') {
  return (xml.match(/<si\b[^>]*\/>|<si\b[\s\S]*?<\/si>/g) || []).map((item) => {
    if (/^<si\b[^>]*\/>$/.test(item)) return '';
    const visibleRuns = item.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    const values = [...visibleRuns.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)].map((match) => decodeXml(match[1] || ''));
    return values.join('');
  });
}

const BUILT_IN_NUMBER_FORMATS = new Map([
  [0, 'General'], [1, '0'], [2, '0.00'], [3, '#,##0'], [4, '#,##0.00'],
  [9, '0%'], [10, '0.00%'], [11, '0.00E+00'], [14, 'mm-dd-yy'],
  [15, 'd-mmm-yy'], [16, 'd-mmm'], [17, 'mmm-yy'], [18, 'h:mm AM/PM'],
  [19, 'h:mm:ss AM/PM'], [20, 'h:mm'], [21, 'h:mm:ss'], [22, 'm/d/yy h:mm'],
  [37, '#,##0 ;(#,##0)'], [38, '#,##0 ;[Red](#,##0)'], [39, '#,##0.00;(#,##0.00)'],
  [40, '#,##0.00;[Red](#,##0.00)'], [49, '@']
]);

function parseStyles(xml = '') {
  const customFormats = new Map();
  for (const tag of xml.match(/<numFmt\b[^>]*\/>|<numFmt\b[^>]*>[\s\S]*?<\/numFmt>/g) || []) {
    const id = Number(/\bnumFmtId="(\d+)"/.exec(tag)?.[1]);
    const code = decodeXml(/\bformatCode="([^"]*)"/.exec(tag)?.[1] || '');
    if (Number.isFinite(id) && code) customFormats.set(id, code);
  }
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] || '';
  const formatsByStyle = (cellXfs.match(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g) || []).map((tag) => {
    const id = Number(/\bnumFmtId="(\d+)"/.exec(tag)?.[1] || 0);
    return customFormats.get(id) || BUILT_IN_NUMBER_FORMATS.get(id) || 'General';
  });
  return { formatsByStyle };
}

function formatExcelValue(rawValue, type, styleIndex, styles, date1904 = false) {
  const raw = String(rawValue ?? '');
  if (!raw || ['s', 'str', 'inlineStr', 'b', 'e'].includes(type)) return raw;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return raw;
  const format = styles?.formatsByStyle?.[Number(styleIndex)] || 'General';
  if (!format || format === 'General' || format === '@') return raw;
  const visibleFormat = format.split(';')[numeric < 0 ? 1 : 0] || format.split(';')[0];
  const normalized = visibleFormat
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\(.)/g, '$1')
    .replace(/_.|\*./g, '')
    .toLowerCase();
  if (normalized.includes('%')) {
    const decimals = /\.(0+)/.exec(normalized)?.[1]?.length || 0;
    return `${(numeric * 100).toFixed(decimals)}%`;
  }
  const isDate = /[ydhs]/.test(normalized) || /^(m{1,4})[\-/](d{1,4})/.test(normalized);
  if (isDate) {
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    const date = new Date(epoch + numeric * 86400000);
    if (!Number.isNaN(date.getTime())) {
      const pad = (value) => String(value).padStart(2, '0');
      const datePart = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
      const timePart = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}${normalized.includes('s') ? `:${pad(date.getUTCSeconds())}` : ''}`;
      const hasDate = /[yd]/.test(normalized);
      const hasTime = /[hs]/.test(normalized);
      return hasDate && hasTime ? `${datePart} ${timePart}` : hasTime ? timePart : datePart;
    }
  }
  if (/e[+\-]0+/i.test(normalized)) {
    const decimals = /\.(0+)/.exec(normalized)?.[1]?.length || 0;
    return numeric.toExponential(decimals).replace('e', 'E');
  }
  const decimals = /\.(0+)/.exec(normalized)?.[1]?.length;
  if (decimals != null || normalized.includes(',')) {
    return numeric.toLocaleString('en-US', { useGrouping: normalized.includes(','), minimumFractionDigits: decimals || 0, maximumFractionDigits: decimals || 0 });
  }
  return raw;
}

function parseSheet(xml, sharedStrings, styles = { formatsByStyle: [] }, date1904 = false) {
  const cells = {};
  let cellCount = 0;
  let maxRow = 0;
  let maxColumn = 0;
  for (const match of xml.matchAll(/<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const attrs = match[1] || match[2] || '';
    const body = match[3] || '';
    const reference = /\br="([A-Z]+)(\d+)"/i.exec(attrs);
    if (!reference) continue;
    const address = `${reference[1].toUpperCase()}${reference[2]}`;
    const row = Number(reference[2]) - 1;
    const column = columnNameToIndex(reference[1].toUpperCase());
    const type = /\bt="([^"]+)"/.exec(attrs)?.[1] || '';
    const styleIndex = /\bs="(\d+)"/.exec(attrs)?.[1] || '0';
    const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
    const inlineBody = body.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    const inline = [...inlineBody.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)].map((item) => decodeXml(item[1] || '')).join('');
    const formula = decodeXml(/<f\b[^>]*>([\s\S]*?)<\/f>/.exec(body)?.[1] || '');
    let value = inline || decodeXml(raw);
    if (type === 's') value = sharedStrings[Number(raw)] ?? '';
    if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
    const displayValue = formatExcelValue(value, type, styleIndex, styles, date1904);
    cells[address] = { address, row, column, value, displayValue, formula };
    cellCount += 1;
    maxRow = Math.max(maxRow, row + 1);
    maxColumn = Math.max(maxColumn, column + 1);
    if (cellCount > 100000) throw new Error('Excel 工作表超过 100,000 个单元格，请缩小文件后再试');
  }
  return { cells, rows: maxRow, columns: maxColumn };
}

function parseXlsx(buffer) {
  const entries = unzipEntries(buffer);
  const workbookXml = entries.get('xl/workbook.xml')?.toString('utf8');
  if (!workbookXml) throw new Error('Excel 文件缺少工作簿信息');
  const relations = parseRelationships(entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8'));
  const sharedStrings = parseSharedStrings(entries.get('xl/sharedStrings.xml')?.toString('utf8'));
  const styles = parseStyles(entries.get('xl/styles.xml')?.toString('utf8'));
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(?:1|true)"/i.test(workbookXml);
  const sheets = [];
  for (const tag of workbookXml.match(/<sheet\b[^>]*>/g) || []) {
    const name = decodeXml(/\bname="([^"]+)"/.exec(tag)?.[1] || '工作表');
    const relationId = /\br:id="([^"]+)"/.exec(tag)?.[1];
    const target = relations.get(relationId);
    if (!target) continue;
    const normalizedTarget = path.posix.normalize(target.startsWith('/')
      ? target.slice(1)
      : target.startsWith('xl/') ? target : path.posix.join('xl', target)).replace(/^\.\//, '');
    const sheetXml = entries.get(normalizedTarget)?.toString('utf8');
    if (sheetXml) sheets.push({ name, ...parseSheet(sheetXml, sharedStrings, styles, date1904) });
  }
  return { sheets };
}

function createSpreadsheetXml(rows, title = 'Test cat 文件对比报告') {
  const safeRows = Array.isArray(rows) ? rows : [];
  const headers = [...new Set(safeRows.flatMap((row) => Object.keys(row || {})))];
  const allRows = headers.length ? [headers, ...safeRows.map((row) => headers.map((header) => row?.[header] ?? ''))] : [['结果'], ['没有差异数据']];
  const body = allRows.map((row, rowIndex) => `<Row>${row.map((cell) => {
    const numeric = typeof cell === 'number' && Number.isFinite(cell);
    return `<Cell${rowIndex === 0 ? ' ss:StyleID="Header"' : ''}><Data ss:Type="${numeric ? 'Number' : 'String'}">${xmlEscape(cell)}</Data></Cell>`;
  }).join('')}</Row>`).join('');
  return `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#D9E8FF" ss:Pattern="Solid"/></Style></Styles><Worksheet ss:Name="差异报告"><Table>${body}</Table></Worksheet><Worksheet ss:Name="说明"><Table><Row><Cell><Data ss:Type="String">${xmlEscape(title)}</Data></Cell></Row><Row><Cell><Data ss:Type="String">由 Test cat 生成</Data></Cell></Row></Table></Worksheet></Workbook>`;
}

async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function safeChild(root, relativePath) {
  const normalizedRoot = path.resolve(root);
  const candidate = path.resolve(normalizedRoot, relativePath);
  const relative = path.relative(normalizedRoot, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    if (!relative) return candidate;
    throw new Error('检测到不安全的文件路径');
  }
  return candidate;
}

class FileCompareService {
  constructor({ dialog, getWindow }) {
    this.dialog = dialog;
    this.getWindow = getWindow;
  }

  async selectPath(kind = 'file') {
    const directory = kind === 'directory';
    const result = await this.dialog.showOpenDialog(this.getWindow?.(), {
      title: directory ? '选择要对比的文件夹' : '选择要对比的文件',
      properties: [directory ? 'openDirectory' : 'openFile', 'showHiddenFiles'],
      filters: directory ? undefined : [
        { name: '常用文件', extensions: ['txt', 'log', 'json', 'xml', 'csv', 'tsv', 'xlsx', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'js', 'ts', 'py', 'java', 'html', 'css', 'md'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return this.inspectPath(result.filePaths[0]);
  }

  async inspectPath(targetPath) {
    const stats = await fs.promises.stat(targetPath);
    return {
      path: targetPath,
      name: path.basename(targetPath),
      kind: stats.isDirectory() ? 'directory' : 'file',
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      extension: stats.isDirectory() ? '' : path.extname(targetPath).toLowerCase()
    };
  }

  async readFile(filePath) {
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) throw new Error('请选择文件进行对比');
    if (stats.size > MAX_FILE_BYTES) throw new Error('单个文件暂时不能超过 80 MB');
    const extension = path.extname(filePath).toLowerCase();
    const buffer = await fs.promises.readFile(filePath);
    const base = { path: filePath, name: path.basename(filePath), size: stats.size, mtimeMs: stats.mtimeMs, extension };
    if (extension === '.xlsx') return { ...base, type: 'workbook', workbook: parseXlsx(buffer) };
    if (IMAGE_EXTENSIONS.has(extension)) {
      const mime = extension === '.svg' ? 'image/svg+xml' : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : `image/${extension.slice(1)}`;
      return { ...base, type: 'image', dataUrl: `data:${mime};base64,${buffer.toString('base64')}` };
    }
    if (!TEXT_EXTENSIONS.has(extension) && looksBinary(buffer)) {
      const clipped = buffer.subarray(0, MAX_BINARY_BYTES);
      return { ...base, type: 'binary', clipped: buffer.length > clipped.length, data: clipped.toString('base64') };
    }
    if (buffer.length > MAX_TEXT_BYTES) throw new Error('文本文件暂时不能超过 20 MB');
    return { ...base, type: extension === '.csv' || extension === '.tsv' ? 'table' : 'text', text: decodeText(buffer) };
  }

  async compareDirectories(leftRoot, rightRoot, options = {}) {
    const [leftInfo, rightInfo] = await Promise.all([this.inspectPath(leftRoot), this.inspectPath(rightRoot)]);
    if (leftInfo.kind !== 'directory' || rightInfo.kind !== 'directory') throw new Error('文件夹对比需要选择两个文件夹');
    const [leftEntries, rightEntries] = await Promise.all([
      this.scanDirectory(leftRoot, options), this.scanDirectory(rightRoot, options)
    ]);
    const leftMap = new Map(leftEntries.map((entry) => [entry.relativePath, entry]));
    const rightMap = new Map(rightEntries.map((entry) => [entry.relativePath, entry]));
    const allPaths = [...new Set([...leftMap.keys(), ...rightMap.keys()])].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const rows = allPaths.map((relativePath) => {
      const left = leftMap.get(relativePath) || null;
      const right = rightMap.get(relativePath) || null;
      let status = 'same';
      if (!left) status = 'right-only';
      else if (!right) status = 'left-only';
      else if (left.kind !== right.kind) status = 'different';
      else if (left.kind === 'file') {
        if (options.compareBy === 'content') status = left.hash === right.hash ? 'same' : 'different';
        else if (left.size !== right.size || Math.abs(left.mtimeMs - right.mtimeMs) > 1500) status = 'different';
      }
      return { relativePath, left, right, status };
    });
    return { leftRoot, rightRoot, rows, limited: leftEntries.limited || rightEntries.limited };
  }

  async scanDirectory(root, options) {
    const entries = [];
    const extensions = String(options.extensions || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean).map((item) => item.startsWith('.') ? item : `.${item}`);
    const excluded = String(options.exclude || '').split(',').map((item) => item.trim()).filter(Boolean);
    const walk = async (directory, relativeDirectory = '') => {
      if (entries.length >= MAX_DIRECTORY_ENTRIES) return;
      const children = await fs.promises.readdir(directory, { withFileTypes: true });
      for (const child of children) {
        if (entries.length >= MAX_DIRECTORY_ENTRIES) break;
        const relativePath = path.join(relativeDirectory, child.name).split(path.sep).join('/');
        if (excluded.some((pattern) => child.name === pattern || relativePath.includes(pattern))) continue;
        const fullPath = path.join(directory, child.name);
        if (child.isSymbolicLink()) continue;
        if (child.isDirectory()) {
          entries.push({ relativePath, kind: 'directory', size: 0, mtimeMs: 0 });
          await walk(fullPath, relativePath);
        } else if (child.isFile()) {
          if (extensions.length && !extensions.includes(path.extname(child.name).toLowerCase())) continue;
          const stats = await fs.promises.stat(fullPath);
          const entry = { relativePath, kind: 'file', size: stats.size, mtimeMs: stats.mtimeMs };
          if (options.compareBy === 'content') entry.hash = await hashFile(fullPath);
          entries.push(entry);
        }
      }
    };
    await walk(root);
    entries.limited = entries.length >= MAX_DIRECTORY_ENTRIES;
    return entries;
  }

  async syncEntry({ sourceRoot, targetRoot, relativePath }) {
    const source = safeChild(sourceRoot, relativePath);
    const target = safeChild(targetRoot, relativePath);
    const sourceStats = await fs.promises.stat(source);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    if (sourceStats.isDirectory()) await fs.promises.cp(source, target, { recursive: true, force: true, errorOnExist: false });
    else await fs.promises.copyFile(source, target);
    return { path: target };
  }

  async saveText({ content, suggestedName = '合并结果.txt', targetPath = '' }) {
    let destination = targetPath;
    if (!destination) {
      const result = await this.dialog.showSaveDialog(this.getWindow?.(), { title: '保存合并结果', defaultPath: suggestedName });
      if (result.canceled || !result.filePath) return null;
      destination = result.filePath;
    }
    await fs.promises.writeFile(destination, String(content ?? ''), 'utf8');
    return { path: destination };
  }

  async exportReport({ format, html, rows, suggestedName }) {
    const excel = format === 'excel';
    const result = await this.dialog.showSaveDialog(this.getWindow?.(), {
      title: '导出对比报告',
      defaultPath: suggestedName || `Test-cat-文件对比报告.${excel ? 'xls' : 'html'}`,
      filters: excel ? [{ name: 'Excel 工作簿', extensions: ['xls'] }] : [{ name: 'HTML 报告', extensions: ['html'] }]
    });
    if (result.canceled || !result.filePath) return null;
    const content = excel ? createSpreadsheetXml(rows) : String(html || '');
    await fs.promises.writeFile(result.filePath, content, 'utf8');
    return { path: result.filePath };
  }
}

module.exports = {
  FileCompareService,
  createSpreadsheetXml,
  decodeText,
  looksBinary,
  parseXlsx,
  parseStyles,
  formatExcelValue,
  unzipEntries
};
