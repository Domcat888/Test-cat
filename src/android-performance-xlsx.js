const zlib = require('node:zlib');

const METRICS = {
  cpuUsage: ['整机 CPU 使用率', '%'], appCpuUsage: ['目标 App CPU（单核口径）', '%'], cpuFrequency: ['CPU 平均频率', 'MHz'], cpuTemperature: ['CPU/SOC 温度', '℃'],
  memoryTotal: ['设备内存总量', 'MB'], memoryUsed: ['系统内存已用', 'MB'], appMemory: ['目标 App PSS 内存', 'MB'], memoryLeakTrend: ['App PSS 增长趋势', 'MB/分钟'],
  gpuLoad: ['设备 GPU 负载', '%'], gpuMemory: ['目标 App 图形内存', 'MB'], gpuFrequency: ['GPU 当前频率', 'MHz'], fps: ['前台画面 FPS', 'FPS'], jankCount: ['采样间隔卡顿帧', '帧'],
  downloadSpeed: ['下载速率', 'MB/s'], uploadSpeed: ['上传速率', 'MB/s'], networkLatency: ['网络延迟', 'ms'], packetLoss: ['网络丢包率', '%'],
  diskReadSpeed: ['/data 磁盘读取速率', 'MB/s'], diskWriteSpeed: ['/data 磁盘写入速率', 'MB/s'], ioWait: ['CPU IO Wait', '%'], diskFree: ['/data 剩余空间', 'MB'],
  startupTime: ['App 冷启动耗时', 'ms'], crashCount: ['崩溃/ANR 累计', '次'], power: ['电池侧瞬时功率', 'W'], batteryLevel: ['电池电量', '%'], deviceTemperature: ['电池温度', '℃']
};
const RATE_KEYS = new Set(['downloadSpeed', 'uploadSpeed', 'diskReadSpeed', 'diskWriteSpeed']);

const crcTable = (() => {
  const table = [];
  for (let value = 0; value < 256; value += 1) {
    let checksum = value;
    for (let bit = 0; bit < 8; bit += 1) checksum = checksum & 1 ? 0xedb88320 ^ (checksum >>> 1) : checksum >>> 1;
    table[value] = checksum >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let checksum = -1;
  for (const byte of buffer) checksum = (checksum >>> 8) ^ crcTable[(checksum ^ byte) & 0xff];
  return (checksum ^ -1) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function createZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const stamp = dosDateTime();
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), 'utf8');
    const compressed = zlib.deflateRawSync(data);
    const checksum = crc32(data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(stamp.time, 10); local.writeUInt16LE(stamp.date, 12); local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); name.copy(local, 30);
    locals.push(local, compressed);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(stamp.time, 12); central.writeUInt16LE(stamp.date, 14); central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42); name.copy(central, 46);
    centrals.push(central);
    offset += local.length + compressed.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function xml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;' })[character]);
}

function columnName(index) {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function cell(value, row, column, header = false) {
  const reference = `${columnName(column)}${row}`;
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${reference}"${header ? ' s="1"' : ''}><v>${value}</v></c>`;
  return `<c r="${reference}" t="inlineStr"${header ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function worksheet(rows) {
  const body = rows.map((values, index) => `<row r="${index + 1}">${values.map((value, column) => cell(value, index + 1, column, index === 0)).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData>${body}</sheetData><autoFilter ref="A1:${columnName(Math.max(0, (rows[0]?.length || 1) - 1))}${Math.max(1, rows.length)}"/></worksheet>`;
}

function normalize(key, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return RATE_KEYS.has(key) ? number / 1024 / 1024 : number;
}

function metricKeys(report) {
  const keys = new Set();
  for (const sample of report.samples || []) for (const key of Object.keys(sample)) if (METRICS[key]) keys.add(key);
  if (Number.isFinite(report.startupTime)) keys.add('startupTime');
  return [...keys];
}

function percentile(values, ratio) {
  if (!values.length) return '';
  const sorted = [...values].sort((left, right) => left - right);
  const position = ratio * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function summarize(values) {
  if (!values.length) return {};
  return {
    count: values.length,
    avg: values.reduce((sum, value) => sum + value, 0) / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    p50: percentile(values, 0.5),
    p90: percentile(values, 0.9),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99)
  };
}

function summaryRows(report, keys) {
  const analysis = report.analysis?.metrics || {};
  const rows = [['指标', '单位', '有效样本', '平均值', '最小值', '最大值', 'P50', 'P90', 'P95', 'P99']];
  for (const key of keys) {
    const values = key === 'startupTime' ? [report.startupTime] : (report.samples || []).map((sample) => normalize(key, sample[key])).filter(Number.isFinite);
    const stats = analysis[key] || summarize(values);
    rows.push([METRICS[key][0], METRICS[key][1], stats.count ?? values.length, stats.avg ?? '', stats.min ?? '', stats.max ?? '', stats.p50 ?? '', stats.p90 ?? '', stats.p95 ?? '', stats.p99 ?? '']);
  }
  return rows;
}

function isoTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function sampleRows(report, keys = metricKeys(report)) {
  const samples = [['时间戳', '测试秒数', 'App 包名', ...keys.map((key) => `${METRICS[key][0]} (${METRICS[key][1]})`)]];
  for (const sample of report.samples || []) samples.push([isoTimestamp(sample.timestamp), sample.elapsed, sample.packageName || '', ...keys.map((key) => key === 'startupTime' ? report.startupTime ?? '' : normalize(key, sample[key]))]);
  return samples;
}

function eventRows(report) {
  const events = [['时间', '等级', '类型', '事件', 'App', '指标', '数值', '阈值']];
  for (const event of report.events || []) events.push([isoTimestamp(event.timestamp), event.level || 'info', event.type || 'event', event.label || '', event.packageName || '', event.metric ? METRICS[event.metric]?.[0] || event.metric : '', event.value ?? '', event.threshold ?? '']);
  return events;
}

function createWorkbook(sheets) {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_sheet, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF245FAE"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`;
  return createZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    { name: 'xl/styles.xml', data: styles },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: worksheet(sheet.rows) }))
  ]);
}

function createPerformanceWorkbook(report) {
  if (!report || !Array.isArray(report.samples)) throw new Error('安卓性能报告格式不正确。');
  const keys = metricKeys(report);
  return createWorkbook([
    { name: '指标摘要', rows: summaryRows(report, keys) },
    { name: '原始采样', rows: sampleRows(report, keys) },
    { name: '测试事件', rows: eventRows(report) }
  ]);
}

function metricStats(report, key) {
  const values = key === 'startupTime'
    ? [Number(report.startupTime)].filter(Number.isFinite)
    : (report.samples || []).map((sample) => normalize(key, sample[key])).filter(Number.isFinite);
  return report.analysis?.metrics?.[key] || summarize(values);
}

function comparisonRows(left, right) {
  const keys = [...new Set([...metricKeys(left), ...metricKeys(right)])];
  const rows = [['指标', '单位', '基准平均', '目标平均', '变化 (%)', '基准最小', '目标最小', '基准最大', '目标最大', '基准样本', '目标样本']];
  for (const key of keys) {
    const leftStats = metricStats(left, key);
    const rightStats = metricStats(right, key);
    const leftAverage = Number(leftStats.avg);
    const rightAverage = Number(rightStats.avg);
    const delta = Number.isFinite(leftAverage) && leftAverage !== 0 && Number.isFinite(rightAverage)
      ? (rightAverage - leftAverage) / Math.abs(leftAverage) * 100
      : '';
    rows.push([
      METRICS[key][0], METRICS[key][1],
      leftStats.avg ?? '', rightStats.avg ?? '', delta,
      leftStats.min ?? '', rightStats.min ?? '', leftStats.max ?? '', rightStats.max ?? '',
      leftStats.count ?? '', rightStats.count ?? ''
    ]);
  }
  return rows;
}

function createPerformanceComparisonWorkbook(left, right) {
  if (!left || !right || !Array.isArray(left.samples) || !Array.isArray(right.samples)) throw new Error('安卓性能对比报告格式不正确。');
  return createWorkbook([
    { name: '对比摘要', rows: comparisonRows(left, right) },
    { name: '基准原始采样', rows: sampleRows(left) },
    { name: '目标原始采样', rows: sampleRows(right) }
  ]);
}

module.exports = {
  createPerformanceComparisonWorkbook,
  createPerformanceWorkbook,
  __test: { comparisonRows, createZip, metricKeys, worksheet }
};
