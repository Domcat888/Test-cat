const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/renderer/formula-calculator-core');

test('calculates formula with Chinese variables', () => {
  const formula = core.parseFormulaDefinition('', '最终金币数 = (炮倍 * 加成) + 鱼');
  assert.deepEqual(formula.variables, ['炮倍', '加成', '鱼']);
  const result = core.calculateFormula(formula, { 鱼: 100, 炮倍: 50, 加成: 1.2 });
  assert.equal(result.result, 160);
  assert.equal(result.formattedResult, '160');
});

test('supports expression before result name', () => {
  const formula = core.parseFormulaDefinition('', '(炮倍 * 加成) + 鱼 = 最终金币数');
  assert.equal(formula.name, '最终金币数');
  assert.equal(formula.expression, '(炮倍 * 加成) + 鱼');
  assert.throws(() => core.parseFormulaDefinition('第三个结果', '鱼 = 炮倍'), /结果词必须和其中一侧一致/);
});

test('normalizes full-width operators and deduplicates variables', () => {
  const formula = core.parseFormulaDefinition('', '最终金币数＝（鱼＋鱼）×加成');
  assert.equal(formula.expression, '(鱼+鱼)*加成');
  assert.deepEqual(formula.variables, ['鱼', '加成']);
  const result = core.calculateFormula(formula, { 鱼: '1,000', 加成: '20%' });
  assert.equal(result.result, 400);
});

test('supports safe math functions and percent input', () => {
  const formula = core.parseFormulaDefinition('奖励', 'round(max(基础, 100) * (1 + 加成), 2)');
  const result = core.calculateFormula(formula, { 基础: '88', 加成: '20%' });
  assert.equal(result.result, 120);
});

test('supports power, modulo and strict argument checks', () => {
  const power = core.parseFormulaDefinition('倍率', '2^3^2');
  assert.equal(core.calculateFormula(power, {}).result, 512);
  const modulo = core.parseFormulaDefinition('余数', '金币 % 7');
  assert.equal(core.calculateFormula(modulo, { 金币: 30 }).result, 2);
  assert.throws(() => core.parseFormulaDefinition('错误', 'round(1, 2, 3)'), /需要 1 到 2 个参数/);
});

test('rejects unsafe or unsupported formulas', () => {
  assert.throws(() => core.parseFormulaDefinition('', '结果 = process.exit()'), /不支持/);
  assert.throws(() => core.parseFormulaDefinition('', 'a + b = c + d'), /等号一侧必须是结果词/);
  assert.throws(() => core.parseFormulaDefinition('结果', 'round + 1'), /变量名不能和函数名重名/);
  assert.throws(() => core.calculateFormula({ name: '结果', expression: '鱼 + 炮倍' }, { 鱼: 1 }), /缺少变量/);
  assert.throws(() => core.calculateFormula({ name: '结果', expression: '10 / 除数' }, { 除数: 0 }), /除数不能为 0/);
});
