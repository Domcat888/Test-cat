const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { AiTestAssistantService, compactText, createXmindBuffer, parseMarkdownTable, rowsFromResult } = require('../src/ai-test-assistant-service');
const { unzipEntries } = require('../src/file-compare-service');

test('parses markdown table result into row objects', () => {
  const rows = parseMarkdownTable([
    '| 模块 | 用例标题 | 操作步骤 | 预期结果 |',
    '| --- | --- | --- | --- |',
    '| 登录 | 正常登录 | 输入账号密码 | 进入首页 |',
    '| 登录 | 密码错误 | 输入错误密码 | 提示错误 |'
  ].join('\n'));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].模块, '登录');
  assert.equal(rows[1].用例标题, '密码错误');
});

test('falls back to line rows when result is plain text', () => {
  const rows = rowsFromResult('用例一\n\n用例二');
  assert.deepEqual(rows, [
    { 序号: 1, 内容: '用例一' },
    { 序号: 2, 内容: '用例二' }
  ]);
});

test('creates xmind zip with expected content files', () => {
  const buffer = createXmindBuffer([
    { 模块: '支付', 用例标题: '金币不足', 操作步骤: '点击购买', 预期结果: '提示余额不足' }
  ], 'AI 测试用例');
  const entries = unzipEntries(buffer);
  assert.ok(entries.has('content.json'));
  assert.ok(entries.has('metadata.json'));
  assert.ok(entries.has('manifest.json'));
  const content = JSON.parse(entries.get('content.json').toString('utf8'));
  assert.equal(content[0].title, 'AI 测试用例');
  assert.equal(content[0].rootTopic.title, 'AI 测试用例');
});

test('compacts requirement text safely', () => {
  const longText = '需求\n\n\n\n'.repeat(80_000);
  const result = compactText(longText);
  assert.ok(result.length <= 220_000);
  assert.ok(!result.includes('\n\n\n\n'));
});

test('extracts direct image requirements as vision attachments', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'test-cat-ai-'));
  const filePath = path.join(directory, 'requirement.png');
  await fs.writeFile(filePath, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64'
  ));
  const service = new AiTestAssistantService({});
  const result = await service.extractRequirementFile(filePath);
  assert.equal(result.imageCount, 1);
  assert.match(result.images[0].dataUrl, /^data:image\/png;base64,/);
  assert.match(result.text, /图片需求/);
});
