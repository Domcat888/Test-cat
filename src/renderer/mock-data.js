const api = window.testCat?.mockData;
document.body.dataset.platform = window.testCat?.platform || 'browser';

const $ = (selector) => document.querySelector(selector);

const TYPE_LABELS = {
  phone: '手机号',
  idCard: '身份证号',
  email: '邮箱',
  username: '用户名',
  address: '地址',
  json: 'JSON 模板'
};

const DEFAULT_JSON_TEMPLATE = [
  '{',
  '  "id": {{index}},',
  '  "index": {{index}},',
  '  "user": {',
  '    "name": "{{name}}",',
  '    "username": "{{username}}",',
  '    "age": {{age}},',
  '    "phone": "{{phone}}",',
  '    "idCard": "{{idCard}}",',
  '    "email": "{{email}}",',
  '    "address": "{{address}}"',
  '  }',
  '}'
].join('\n');

const state = {
  rows: []
};

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

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(list) {
  return list[randomInt(0, list.length - 1)];
}

function pad(value, length = 2) {
  return String(value).padStart(length, '0');
}

const phonePrefixes = ['130','131','132','133','135','136','137','138','139','150','151','152','157','158','159','166','172','176','177','178','180','181','182','183','185','186','187','188','189','191','193','195','196','198','199'];
const familyNames = ['赵','钱','孙','李','周','吴','郑','王','冯','陈','刘','杨','黄','张','林','何','郭','马','罗','梁'];
const givenNames = ['一诺','子涵','梓晨','浩然','雨桐','思源','可欣','明轩','嘉怡','俊杰','沐辰','若溪','星辰','承宇','亦凡','安然'];
const usernameWords = ['tester','mock','qa','alpha','beta','demo','pixel','nova','orbit','river','cat','mouse'];
const emailDomains = ['example.com','testcat.dev','qa.local','mail.test','demo.cn','mock.io'];
const provinces = ['北京市','上海市','广东省','浙江省','江苏省','四川省','湖北省','福建省','陕西省','重庆市'];
const cities = ['朝阳区','浦东新区','深圳市','杭州市','南京市','成都市','武汉市','厦门市','西安市','渝中区'];
const districts = ['高新区','软件园','测试路','开发区','科技城','创新港','滨江区','天府新区'];
const roads = ['望京街','科苑路','云栖路','星河路','麓山大道','长安北路','湖滨路','海风街'];
const addressCodes = ['110101','110105','310101','310115','440305','440306','330106','320102','510104','420106','350203','610102','500103'];

function phone() {
  return pick(phonePrefixes) + String(randomInt(0, 99999999)).padStart(8, '0');
}

function name() {
  return pick(familyNames) + pick(givenNames);
}

function username() {
  return [pick(usernameWords), pick(usernameWords), randomInt(100, 9999)].join('_');
}

function email(local = username()) {
  return local.replace(/[^a-z0-9_.-]/gi, '').toLowerCase() + '@' + pick(emailDomains);
}

function address() {
  return pick(provinces) + pick(cities) + pick(districts) + pick(roads) + randomInt(1, 288) + '号' + randomInt(1, 18) + '栋' + randomInt(101, 2808) + '室';
}

function randomBirthDate() {
  const year = randomInt(1965, 2010);
  const month = randomInt(1, 12);
  const maxDay = new Date(year, month, 0).getDate();
  return String(year) + pad(month) + pad(randomInt(1, maxDay));
}

function idCard() {
  const body = pick(addressCodes) + randomBirthDate() + String(randomInt(1, 999)).padStart(3, '0');
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checks = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  const sum = body.split('').reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
  return body + checks[sum % 11];
}

function jsonFill(template, index) {
  const user = username();
  const values = {
    index,
    phone: phone(),
    idCard: idCard(),
    email: email(user),
    username: user,
    address: address(),
    name: name(),
    age: randomInt(18, 65)
  };
  return Object.entries(values).reduce((text, [key, value]) => text.split('{{' + key + '}}').join(String(value)), template);
}

function clampCount() {
  const input = $('#mock-count');
  const value = Math.max(1, Math.min(500, Number(input.value) || 1));
  input.value = value;
  return value;
}

function makeRow(type, index) {
  if (type === 'phone') return { type: TYPE_LABELS[type], value: phone(), note: '中国大陆 11 位手机号' };
  if (type === 'idCard') return { type: TYPE_LABELS[type], value: idCard(), note: '含合法校验位，适合格式校验' };
  if (type === 'email') return { type: TYPE_LABELS[type], value: email(), note: '常见邮箱格式' };
  if (type === 'username') return { type: TYPE_LABELS[type], value: username(), note: '英文测试用户名' };
  if (type === 'address') return { type: TYPE_LABELS[type], value: address(), note: '中文地址样例' };
  if (type === 'json') {
    const template = $('#json-template').value.trim() || DEFAULT_JSON_TEMPLATE;
    const filled = jsonFill(template, index);
    try {
      return { type: TYPE_LABELS[type], value: JSON.stringify(JSON.parse(filled)), note: '模板渲染成功' };
    } catch (error) {
      return { type: TYPE_LABELS[type], value: filled, note: '模板已替换，但不是合法 JSON：' + error.message };
    }
  }
  return { type: TYPE_LABELS[type], value: '', note: '' };
}

function generateRows() {
  setStatus('正在生成测试数据', 'working');
  const type = $('#mock-type').value;
  const count = clampCount();
  state.rows = Array.from({ length: count }, (_, index) => makeRow(type, index + 1));
  render();
  setStatus('生成完成', 'done');
  toast('已生成 ' + state.rows.length + ' 条测试数据');
}

function previewText() {
  const type = $('#mock-type').value;
  if (!state.rows.length) return '';
  if (type === 'json') {
    const values = state.rows.map((row) => {
      try { return JSON.parse(row.value); } catch { return row.value; }
    });
    return JSON.stringify(values, null, 2);
  }
  return state.rows.map((row) => row.value).join('\n');
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function csvText() {
  const header = ['序号', '类型', '值', '说明'];
  const lines = state.rows.map((row, index) => [index + 1, row.type, row.value, row.note].map(csvEscape).join(','));
  return [header.map(csvEscape).join(','), ...lines].join('\n');
}

function render() {
  const type = $('#mock-type').value;
  $('#stat-type').textContent = TYPE_LABELS[type] || 'Mock 数据';
  $('#stat-count').textContent = String(state.rows.length);
  $('#stat-format').textContent = type === 'json' ? 'JSON 数组' : '按行复制';
  $('#stat-time').textContent = state.rows.length ? new Date().toLocaleTimeString('zh-CN', { hour12: false }) : '未生成';
  $('#preview-text').value = previewText();
  $('#copy-button').disabled = !state.rows.length;
  $('#export-button').disabled = !state.rows.length;
  $('#empty-state').hidden = state.rows.length > 0;
  $('#result-body').innerHTML = state.rows.map((row, index) => (
    '<tr>' +
      '<td>' + (index + 1) + '</td>' +
      '<td><span class="type-pill">' + escapeHtml(row.type) + '</span></td>' +
      '<td><div class="value-cell" title="' + escapeHtml(row.value) + '"><code>' + escapeHtml(row.value) + '</code></div></td>' +
      '<td>' + escapeHtml(row.note || '—') + '</td>' +
    '</tr>'
  )).join('');
}

function updateOptions() {
  const type = $('#mock-type').value;
  $('#json-options').hidden = type !== 'json';
  $('#stat-type').textContent = TYPE_LABELS[type] || 'Mock 数据';
}

async function copyResult() {
  if (!state.rows.length) return;
  const text = previewText();
  try {
    if (api?.copyText) await api.copyText(text);
    else await navigator.clipboard.writeText(text);
    toast('结果已复制');
  } catch (error) {
    toast(error.message || '复制失败，请手动复制预览区内容');
  }
}

async function exportCsv() {
  if (!state.rows.length) return;
  const type = $('#mock-type').value;
  const fileName = 'mock-data-' + type + '-' + Date.now() + '.csv';
  try {
    if (api?.exportCsv) {
      const result = await api.exportCsv({ fileName, content: csvText() });
      if (result?.filePath) toast('CSV 已导出');
      else toast('已取消导出');
      return;
    }
    const blob = new Blob(['\ufeff' + csvText()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    toast('CSV 已导出');
  } catch (error) {
    toast(error.message || 'CSV 导出失败');
  }
}

function clearRows() {
  state.rows = [];
  render();
  setStatus('已清空结果', 'done');
}

$('#json-template').value = DEFAULT_JSON_TEMPLATE;
$('#mock-type').addEventListener('change', () => {
  updateOptions();
  clearRows();
});
$('#generate-button').addEventListener('click', generateRows);
$('#copy-button').addEventListener('click', copyResult);
$('#export-button').addEventListener('click', exportCsv);
$('#clear-button').addEventListener('click', clearRows);
$('#reset-template').addEventListener('click', () => {
  $('#json-template').value = DEFAULT_JSON_TEMPLATE;
  if ($('#mock-type').value === 'json' && state.rows.length) generateRows();
});

updateOptions();
generateRows();
