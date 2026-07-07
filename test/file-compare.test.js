const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const {
  FileCompareService,
  createSpreadsheetXml,
  parseXlsx
} = require('../src/file-compare-service');
const {
  buildLineDiff,
  compareSheets,
  filterDifferenceRows,
  parseDelimited,
  prepareText,
  spreadsheetPreviewAxes,
  tableToWorkbook
} = require('../src/renderer/file-compare-core');

function createStoredZip(entries, method = 0) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [entryName, entryValue] of Object.entries(entries)) {
    const name = Buffer.from(entryName);
    const data = Buffer.from(entryValue);
    const compressed = method === 8 ? zlib.deflateRawSync(data) : data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

test('buildLineDiff aligns changed, inserted and deleted lines into mergeable hunks', () => {
  const result = buildLineDiff(['alpha', 'old', 'tail'], ['alpha', 'new', 'extra', 'tail']);
  assert.equal(result.hunks.length, 1);
  assert.equal(result.differentLines, 2);
  assert.deepEqual(result.hunks[0].leftLines, ['old']);
  assert.deepEqual(result.hunks[0].rightLines, ['new', 'extra']);
});

test('large text diff keeps a single inserted line aligned', () => {
  const left = Array.from({ length: 2200 }, (_item, index) => `line-${index}`);
  const right = [...left.slice(0, 1100), 'inserted-line', ...left.slice(1100)];
  const result = buildLineDiff(left, right);
  assert.equal(result.hunks.length, 1);
  assert.equal(result.differentLines, 1);
  assert.equal(result.rows.find((row) => row.type === 'added').right, 'inserted-line');
});

test('text preparation supports JSON key sorting and whitespace-insensitive comparison', () => {
  const left = prepareText('{"b":2,"a":1}', '.json', { sortJson: true });
  assert.match(left, /"a": 1[\s\S]*"b": 2/);
  const result = buildLineDiff([' Hello   world '], ['hello world'], { ignoreCase: true, ignoreSpace: true });
  assert.equal(result.differentLines, 0);
});

test('CSV parser preserves quoted commas and table comparison reports changed cells', () => {
  const left = tableToWorkbook(parseDelimited('name,value\n"cat,jerry",1'), 'sheet').sheets[0];
  const right = tableToWorkbook(parseDelimited('name,value\n"cat,jerry",2'), 'sheet').sheets[0];
  const differences = compareSheets(left, right).filter((row) => row.status !== 'same');
  assert.deepEqual(differences.map((row) => row.address), ['B2']);
});

test('only-differences filter removes equal preview rows for text and tables', () => {
  const textRows = [{ type: 'equal' }, { type: 'changed' }, { type: 'added' }];
  assert.deepEqual(filterDifferenceRows(textRows, true, 'type').map((row) => row.type), ['changed', 'added']);
  const tableRows = [{ status: 'same' }, { status: 'different' }, { status: 'right-only' }];
  assert.deepEqual(filterDifferenceRows(tableRows, true).map((row) => row.status), ['different', 'right-only']);
  assert.equal(filterDifferenceRows(tableRows, false).length, 3);
});

test('spreadsheet preview builds a full grid and can collapse to differing rows and columns', () => {
  const left = tableToWorkbook([['name', 'value'], ['cat', '1'], ['mouse', '2']], 'sheet').sheets[0];
  const right = tableToWorkbook([['name', 'value'], ['cat', '9'], ['mouse', '2']], 'sheet').sheets[0];
  const comparison = compareSheets(left, right);
  const full = spreadsheetPreviewAxes(left, right, comparison, false);
  assert.deepEqual(full.rows, [0, 1, 2]);
  assert.deepEqual(full.columns, [0, 1]);
  const differences = spreadsheetPreviewAxes(left, right, comparison, true);
  assert.deepEqual(differences.rows, [1]);
  assert.deepEqual(differences.columns, [1]);
});

test('spreadsheet preview ignores distant style-only blank cells', () => {
  const sheet = tableToWorkbook([['visible']], 'sheet').sheets[0];
  sheet.cells.XFD19 = { address: 'XFD19', row: 18, column: 16383, value: '' };
  const axes = spreadsheetPreviewAxes(sheet, null, compareSheets(sheet, null), false);
  assert.deepEqual(axes.rows, [0]);
  assert.deepEqual(axes.columns, [0]);
  assert.equal(axes.limited, false);
});

test('minimal XLSX reader loads shared strings and numeric cells', () => {
  const workbook = parseXlsx(createStoredZip({
    'xl/workbook.xml': '<workbook xmlns:r="r"><workbookPr date1904="0"/><sheets><sheet name="数据" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si/><si><t>名称</t></si><si><r><t>Test </t></r><rPh><t>PHONETIC</t></rPh><r><t>cat</t></r></si></sst>',
    'xl/styles.xml': '<styleSheet><numFmts count="1"><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="10"/><xf numFmtId="165"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>1</v></c><c r="B1" s="22"/><c r="C1" t="s"><v>2</v></c><c r="D1"><v>42</v></c><c r="E1"><f>D1*2</f><v>84</v></c><c r="F1" s="1"><v>0.012</v></c><c r="G1" s="2"><v>45292</v></c></row></sheetData></worksheet>'
  }, 8));
  assert.equal(workbook.sheets[0].name, '数据');
  assert.equal(workbook.sheets[0].cells.A1.value, '名称');
  assert.equal(workbook.sheets[0].cells.B1.value, '');
  assert.equal(workbook.sheets[0].cells.C1.value, 'Test cat');
  assert.equal(workbook.sheets[0].cells.D1.value, '42');
  assert.equal(workbook.sheets[0].cells.E1.formula, 'D1*2');
  assert.equal(workbook.sheets[0].cells.F1.displayValue, '1.20%');
  assert.equal(workbook.sheets[0].cells.G1.displayValue, '2024-01-01');
});

test('spreadsheet comparison detects different formulas with the same cached value', () => {
  const left = { cells: { A1: { value: '2', formula: '1+1' } } };
  const right = { cells: { A1: { value: '2', formula: '4/2' } } };
  const [difference] = compareSheets(left, right);
  assert.equal(difference.status, 'different');
  assert.equal(difference.leftFormula, '1+1');
  assert.equal(difference.rightFormula, '4/2');
});

test('directory comparison hashes content and safe sync copies a selected entry', async (context) => {
  const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'test-cat-compare-'));
  context.after(() => fs.promises.rm(temp, { recursive: true, force: true }));
  const left = path.join(temp, 'left');
  const right = path.join(temp, 'right');
  await fs.promises.mkdir(left); await fs.promises.mkdir(right);
  await fs.promises.writeFile(path.join(left, 'same.txt'), 'same');
  await fs.promises.writeFile(path.join(right, 'same.txt'), 'same');
  await fs.promises.writeFile(path.join(left, 'changed.txt'), 'left');
  await fs.promises.writeFile(path.join(right, 'changed.txt'), 'right');
  await fs.promises.writeFile(path.join(left, 'only.txt'), 'copy me');
  const service = new FileCompareService({ dialog: {}, getWindow: () => null });
  const result = await service.compareDirectories(left, right, { compareBy: 'content' });
  assert.equal(result.rows.find((row) => row.relativePath === 'same.txt').status, 'same');
  assert.equal(result.rows.find((row) => row.relativePath === 'changed.txt').status, 'different');
  assert.equal(result.rows.find((row) => row.relativePath === 'only.txt').status, 'left-only');
  await service.syncEntry({ sourceRoot: left, targetRoot: right, relativePath: 'only.txt' });
  assert.equal(await fs.promises.readFile(path.join(right, 'only.txt'), 'utf8'), 'copy me');
});

test('Excel-compatible export contains a styled worksheet and escaped data', () => {
  const xml = createSpreadsheetXml([{ 文件: 'a&b.txt', 结果: '不同' }]);
  assert.match(xml, /Worksheet ss:Name="差异报告"/);
  assert.match(xml, /a&amp;b\.txt/);
  assert.match(xml, /ss:StyleID="Header"/);
});
