(function exposeFormulaCalculatorCore(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FormulaCalculatorCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : window, function createFormulaCalculatorCore() {
  'use strict';

  const OPERATOR_TEXT_MAP = Object.freeze({
    '＋': '+',
    '－': '-',
    '−': '-',
    '＊': '*',
    '×': '*',
    '✕': '*',
    '／': '/',
    '÷': '/',
    '％': '%',
    '（': '(',
    '）': ')',
    '，': ',',
    '＝': '='
  });

  const FUNCTION_DEFINITIONS = Object.freeze({
    abs: { min: 1, max: 1, run: ([value]) => Math.abs(value) },
    ceil: { min: 1, max: 1, run: ([value]) => Math.ceil(value) },
    floor: { min: 1, max: 1, run: ([value]) => Math.floor(value) },
    max: { min: 1, max: Infinity, run: (values) => Math.max(...values) },
    min: { min: 1, max: Infinity, run: (values) => Math.min(...values) },
    pow: { min: 2, max: 2, run: ([base, power]) => Math.pow(base, power) },
    round: {
      min: 1,
      max: 2,
      run: ([value, digits = 0]) => {
        const precision = Math.max(0, Math.min(12, Math.trunc(digits)));
        const factor = Math.pow(10, precision);
        return Math.round(value * factor) / factor;
      }
    },
    sqrt: { min: 1, max: 1, run: ([value]) => Math.sqrt(value) }
  });

  function normalizeFormulaText(value = '') {
    return String(value).replace(/[＋－−＊×✕／÷％（），＝]/g, (char) => OPERATOR_TEXT_MAP[char] || char).trim();
  }

  function normalizeIdentifier(value = '') {
    return String(value).trim();
  }

  function isIdentifierName(value) {
    const name = normalizeIdentifier(value);
    return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name);
  }

  function assertIdentifier(value, label = '变量') {
    const name = normalizeIdentifier(value);
    if (!name) throw new Error(label + '不能为空');
    if (name.length > 32) throw new Error(label + '不能超过 32 个字符');
    if (!isIdentifierName(name)) throw new Error(label + '只能使用中文、字母、数字和下划线，且不能以数字开头');
    if (Object.prototype.hasOwnProperty.call(FUNCTION_DEFINITIONS, name.toLowerCase())) {
      throw new Error(label + '不能和函数名重名：' + name);
    }
    return name;
  }

  function tokenize(input) {
    const source = normalizeFormulaText(input);
    const tokens = [];
    let index = 0;

    while (index < source.length) {
      const rest = source.slice(index);
      const char = source[index];
      if (/\s/.test(char)) {
        index += 1;
        continue;
      }

      const numberMatch = rest.match(/^((?:\d+(?:\.\d*)?)|(?:\.\d+))(?:e[+-]?\d+)?/i);
      if (numberMatch) {
        tokens.push({ type: 'number', value: Number(numberMatch[0]), raw: numberMatch[0] });
        index += numberMatch[0].length;
        continue;
      }

      const identifierMatch = rest.match(/^[\p{L}_][\p{L}\p{N}_]*/u);
      if (identifierMatch) {
        tokens.push({ type: 'identifier', value: identifierMatch[0] });
        index += identifierMatch[0].length;
        continue;
      }

      if ('+-*/%^(),'.includes(char)) {
        tokens.push({ type: char, value: char });
        index += 1;
        continue;
      }

      throw new Error('公式里有不支持的字符：' + char);
    }

    tokens.push({ type: 'eof', value: '' });
    return tokens;
  }

  class Parser {
    constructor(tokens) {
      this.tokens = tokens;
      this.index = 0;
      this.variables = new Set();
    }

    peek(offset = 0) {
      return this.tokens[this.index + offset] || { type: 'eof', value: '' };
    }

    consume(type = null) {
      const token = this.peek();
      if (type && token.type !== type) throw new Error('公式格式不完整，缺少：' + type);
      this.index += 1;
      return token;
    }

    parse() {
      const expression = this.parseAdditive();
      if (this.peek().type !== 'eof') throw new Error('公式结尾附近有无法识别的内容');
      return expression;
    }

    parseAdditive() {
      let node = this.parseMultiplicative();
      while (this.peek().type === '+' || this.peek().type === '-') {
        const operator = this.consume().type;
        node = { type: 'binary', operator, left: node, right: this.parseMultiplicative() };
      }
      return node;
    }

    parseMultiplicative() {
      let node = this.parsePower();
      while (['*', '/', '%'].includes(this.peek().type)) {
        const operator = this.consume().type;
        node = { type: 'binary', operator, left: node, right: this.parsePower() };
      }
      return node;
    }

    parsePower() {
      let node = this.parseUnary();
      if (this.peek().type === '^') {
        const operator = this.consume().type;
        node = { type: 'binary', operator, left: node, right: this.parsePower() };
      }
      return node;
    }

    parseUnary() {
      if (this.peek().type === '+' || this.peek().type === '-') {
        const operator = this.consume().type;
        return { type: 'unary', operator, argument: this.parseUnary() };
      }
      return this.parsePrimary();
    }

    parsePrimary() {
      const token = this.peek();
      if (token.type === 'number') {
        this.consume('number');
        return { type: 'number', value: token.value };
      }

      if (token.type === 'identifier') {
        const name = this.consume('identifier').value;
        if (this.peek().type === '(') {
          return this.parseFunctionCall(name);
        }
        if (Object.prototype.hasOwnProperty.call(FUNCTION_DEFINITIONS, name.toLowerCase())) {
          throw new Error('变量名不能和函数名重名：' + name);
        }
        this.variables.add(name);
        return { type: 'variable', name };
      }

      if (token.type === '(') {
        this.consume('(');
        const expression = this.parseAdditive();
        this.consume(')');
        return expression;
      }

      throw new Error('公式格式不完整，请检查数字、变量或括号');
    }

    parseFunctionCall(rawName) {
      const name = rawName.toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(FUNCTION_DEFINITIONS, name)) {
        throw new Error('不支持的函数：' + rawName);
      }
      this.consume('(');
      const args = [];
      if (this.peek().type !== ')') {
        do {
          args.push(this.parseAdditive());
          if (this.peek().type !== ',') break;
          this.consume(',');
        } while (this.peek().type !== 'eof');
      }
      this.consume(')');
      const definition = FUNCTION_DEFINITIONS[name];
      if (args.length < definition.min || args.length > definition.max) {
        const range = definition.max === Infinity ? '至少 ' + definition.min : definition.min === definition.max ? String(definition.min) : definition.min + ' 到 ' + definition.max;
        throw new Error(rawName + '() 需要 ' + range + ' 个参数');
      }
      return { type: 'call', name, args };
    }
  }

  function parseExpression(expression) {
    const tokens = tokenize(expression);
    const parser = new Parser(tokens);
    const ast = parser.parse();
    return { ast, variables: [...parser.variables], expression: normalizeFormulaText(expression) };
  }

  function ensureFinite(value, label = '计算结果') {
    if (!Number.isFinite(value)) throw new Error(label + '不是有效数字');
    return value;
  }

  function evaluateAst(node, values) {
    if (node.type === 'number') return node.value;
    if (node.type === 'variable') {
      if (!Object.prototype.hasOwnProperty.call(values, node.name)) throw new Error('缺少变量：' + node.name);
      return parseNumberValue(values[node.name], node.name);
    }
    if (node.type === 'unary') {
      const value = evaluateAst(node.argument, values);
      return node.operator === '-' ? -value : value;
    }
    if (node.type === 'binary') {
      const left = evaluateAst(node.left, values);
      const right = evaluateAst(node.right, values);
      if (node.operator === '+') return ensureFinite(left + right);
      if (node.operator === '-') return ensureFinite(left - right);
      if (node.operator === '*') return ensureFinite(left * right);
      if (node.operator === '/') {
        if (right === 0) throw new Error('除数不能为 0');
        return ensureFinite(left / right);
      }
      if (node.operator === '%') {
        if (right === 0) throw new Error('取模的除数不能为 0');
        return ensureFinite(left % right);
      }
      if (node.operator === '^') return ensureFinite(Math.pow(left, right));
    }
    if (node.type === 'call') {
      const definition = FUNCTION_DEFINITIONS[node.name];
      const result = definition.run(node.args.map((arg) => evaluateAst(arg, values)));
      return ensureFinite(result, node.name + '() 的结果');
    }
    throw new Error('未知公式节点');
  }

  function parseNumberValue(value, label = '输入值') {
    if (typeof value === 'number') return ensureFinite(value, label);
    const raw = String(value ?? '').trim();
    if (!raw) throw new Error(label + '不能为空');
    const isPercent = raw.endsWith('%');
    const normalized = raw.replace(/[，,]/g, '').replace(/%$/, '').trim();
    if (!/^[-+]?((?:\d+(?:\.\d*)?)|(?:\.\d+))(?:e[+-]?\d+)?$/i.test(normalized)) {
      throw new Error(label + '不是有效数字');
    }
    const number = Number(normalized);
    return ensureFinite(isPercent ? number / 100 : number, label);
  }

  function splitFormulaByEquals(text) {
    const normalized = normalizeFormulaText(text);
    const parts = normalized.split('=');
    if (parts.length > 2) throw new Error('一个公式里只能有一个等号');
    return parts.length === 2 ? parts.map((part) => part.trim()) : null;
  }

  function parseFormulaDefinition(resultName, formulaText) {
    const rawName = normalizeIdentifier(resultName);
    const text = normalizeFormulaText(formulaText);
    if (!text) throw new Error('公式不能为空');

    let name = rawName;
    let expression = text;
    const parts = splitFormulaByEquals(text);
    if (parts) {
      const [left, right] = parts;
      if (!left || !right) throw new Error('等号左右都需要内容');
      const leftIsName = isIdentifierName(left);
      const rightIsName = isIdentifierName(right);
      if (leftIsName && !rightIsName) {
        name = left;
        expression = right;
      } else if (rightIsName && !leftIsName) {
        name = right;
        expression = left;
      } else if (leftIsName && rightIsName) {
        if (rawName && rawName !== left && rawName !== right) {
          throw new Error('公式等号两侧都是词时，结果词必须和其中一侧一致');
        }
        name = rawName || left;
        expression = name === left ? right : left;
      } else {
        throw new Error('等号一侧必须是结果词，例如：最终金币数 = (炮倍 * 加成) + 鱼');
      }
    }

    const result = assertIdentifier(name || '计算结果', '结果词');
    const parsed = parseExpression(expression);
    if (parsed.variables.includes(result)) throw new Error('公式不能直接引用自己的结果词：' + result);
    return {
      name: result,
      expression: parsed.expression,
      variables: parsed.variables
    };
  }

  function calculateFormula(formula, inputValues = {}) {
    if (!formula || !formula.expression) throw new Error('请选择一个公式');
    const parsed = parseExpression(formula.expression);
    const valueMap = {};
    for (const variable of parsed.variables) {
      if (Object.prototype.hasOwnProperty.call(inputValues, variable)) valueMap[variable] = inputValues[variable];
    }
    const result = evaluateAst(parsed.ast, valueMap);
    return {
      name: formula.name || '计算结果',
      expression: parsed.expression,
      variables: parsed.variables,
      values: valueMap,
      result,
      formattedResult: formatNumber(result)
    };
  }

  function formatNumber(value) {
    const number = ensureFinite(Number(value));
    if (Object.is(number, -0) || number === 0) return '0';
    const abs = Math.abs(number);
    if (abs >= 1e12 || abs < 1e-6) return number.toPrecision(12).replace(/\.?0+(e|$)/, '$1');
    return number.toFixed(10).replace(/\.?0+$/, '');
  }

  return {
    FUNCTION_NAMES: Object.freeze(Object.keys(FUNCTION_DEFINITIONS)),
    assertIdentifier,
    calculateFormula,
    formatNumber,
    isIdentifierName,
    normalizeFormulaText,
    normalizeIdentifier,
    parseExpression,
    parseFormulaDefinition,
    parseNumberValue
  };
});
