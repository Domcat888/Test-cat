const expressionNode = document.querySelector('#calculator-expression');
const resultNode = document.querySelector('#calculator-result');

let expression = '';
let finished = false;

document.body.dataset.platform = /Mac/i.test(navigator.platform) ? 'darwin' : 'other';

function applyTheme() {
  document.body.classList.toggle('dark', localStorage.getItem('test-cat-theme') === 'dark');
}

function displayExpression(value) {
  return (value || '0').replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
}

function updateDisplay(preview = '') {
  expressionNode.textContent = displayExpression(expression);
  resultNode.textContent = preview || (expression ? displayExpression(expression) : '0');
}

function tokenize(value) {
  const compact = value.replace(/\s+/g, '');
  const tokens = compact.match(/\d*\.?\d+|[()+\-*/%]/g) || [];
  if (tokens.join('') !== compact) throw new Error('表达式无效');
  return tokens;
}

function calculate(value) {
  const tokens = tokenize(value);
  let index = 0;

  function parseExpression() {
    let result = parseTerm();
    while (tokens[index] === '+' || tokens[index] === '-') {
      const operator = tokens[index++];
      const right = parseTerm();
      result = operator === '+' ? result + right : result - right;
    }
    return result;
  }

  function parseTerm() {
    let result = parseUnary();
    while (['*', '/', '%'].includes(tokens[index])) {
      const operator = tokens[index++];
      const right = parseUnary();
      if ((operator === '/' || operator === '%') && right === 0) throw new Error('不能除以 0');
      if (operator === '*') result *= right;
      if (operator === '/') result /= right;
      if (operator === '%') result %= right;
    }
    return result;
  }

  function parseUnary() {
    if (tokens[index] === '+') { index += 1; return parseUnary(); }
    if (tokens[index] === '-') { index += 1; return -parseUnary(); }
    return parsePrimary();
  }

  function parsePrimary() {
    if (tokens[index] === '(') {
      index += 1;
      const result = parseExpression();
      if (tokens[index] !== ')') throw new Error('括号不完整');
      index += 1;
      return result;
    }
    const value = Number(tokens[index++]);
    if (!Number.isFinite(value)) throw new Error('表达式不完整');
    return value;
  }

  const result = parseExpression();
  if (index !== tokens.length || !Number.isFinite(result)) throw new Error('表达式无效');
  return Number(result.toPrecision(12)).toString();
}

function append(value) {
  if (finished && /[\d.(]/.test(value)) expression = '';
  finished = false;
  if (expression.length >= 80) return;
  expression += value;
  updateDisplay();
}

function clear() {
  expression = '';
  finished = false;
  updateDisplay();
}

function backspace() {
  expression = expression.slice(0, -1);
  finished = false;
  updateDisplay();
}

function equals() {
  if (!expression) return;
  try {
    const result = calculate(expression);
    resultNode.textContent = result;
    finished = true;
  } catch (error) {
    resultNode.textContent = error.message || '计算错误';
    finished = true;
  }
}

document.querySelectorAll('[data-value]').forEach((button) => {
  button.addEventListener('click', () => append(button.dataset.value));
});
document.querySelector('[data-action="clear"]').addEventListener('click', clear);
document.querySelector('[data-action="equals"]').addEventListener('click', equals);
document.querySelector('#calculator-backspace').addEventListener('click', backspace);

document.addEventListener('keydown', (event) => {
  if (/^[\d()+\-*/%.]$/.test(event.key)) append(event.key);
  else if (event.key === 'Enter' || event.key === '=') equals();
  else if (event.key === 'Backspace') backspace();
  else if (event.key === 'Escape' || event.key === 'Delete') clear();
  else return;
  event.preventDefault();
});

applyTheme();
window.addEventListener('storage', (event) => {
  if (event.key === 'test-cat-theme') applyTheme();
});
updateDisplay();
