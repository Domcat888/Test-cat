const api = window.testCat?.performanceMonitor;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const REPORT_KEY = 'test-cat-performance-reports-v1';

document.body.dataset.platform = window.testCat?.platform || 'browser';

const groups = {
  cpu: { name: 'CPU', series: ['cpuUsage', 'appCpuUsage', 'cpuFrequency', 'cpuTemperature'] },
  memory: { name: '内存', series: ['memoryTotal', 'memoryUsed', 'appMemory', 'memoryLeakTrend'] },
  gpu: { name: 'GPU / 渲染', series: ['gpuLoad', 'gpuMemory', 'gpuFrequency', 'fps', 'jankCount'] },
  network: { name: '网络', series: ['downloadSpeed', 'uploadSpeed', 'networkLatency', 'packetLoss'] },
  disk: { name: '磁盘', series: ['diskReadSpeed', 'diskWriteSpeed', 'ioWait', 'diskFree'] },
  app: { name: '应用', series: ['startupTime', 'fps', 'jankCount', 'crashCount'] },
  device: { name: '设备', series: ['power', 'batteryLevel', 'deviceTemperature'] }
};

const metricDetails = {
  cpuUsage: { label: '整机 CPU 使用率', unit: '%', cardUnit: '设备瞬时 · %', reportUnit: '%', color: '#4b8cff', help: '整机 CPU 使用率，按所有 CPU 核心总时间归一化，范围 0–100%。' },
  appCpuUsage: { label: '目标 App CPU（单核口径）', unit: '%', cardUnit: 'App瞬时 · 单核%', reportUnit: '单核口径 %', color: '#42d392', help: 'Android/top 常用 App CPU 口径：单核满载=100%，多线程可超过100%；卡片会同时显示等效核心数。' },
  cpuFrequency: { label: 'CPU 平均频率', unit: 'MHz', cardUnit: '在线核心均值 · MHz', reportUnit: 'MHz', color: '#a982ff', help: '读取在线 CPU 核心 scaling_cur_freq 后求平均；不同厂商可能限制读取。' },
  cpuTemperature: { label: 'CPU/SOC 温度', unit: '℃', cardUnit: 'CPU/SOC · ℃', reportUnit: '℃', color: '#ff6b72', help: '优先选择 CPU/SOC thermal_zone，排除电池、GPU、外壳等温度传感器。' },
  memoryTotal: { label: '设备内存总量', unit: 'MB', cardUnit: '设备 · MB', reportUnit: 'MB', color: '#6c7f98', help: '设备物理内存总量，来自 /proc/meminfo MemTotal。' },
  memoryUsed: { label: '系统内存已用', unit: 'MB', cardUnit: '设备 · MB', reportUnit: 'MB', color: '#4b8cff', help: '系统内存已用量，优先按 MemTotal - MemAvailable 计算。' },
  appMemory: { label: '目标 App PSS 内存', unit: 'MB', cardUnit: 'App PSS · MB', reportUnit: 'PSS MB', color: '#42d392', help: 'App 按比例分摊后的物理内存 PSS，来自 dumpsys meminfo；App 未运行时显示不可用。' },
  memoryLeakTrend: { label: 'App PSS 增长趋势', unit: 'MB/分钟', cardUnit: 'App PSS趋势 · MB/分', reportUnit: 'MB/分钟', color: '#ffad57', help: '最近 5 分钟内 App PSS 的线性增长斜率，至少需要 60 秒有效数据。' },
  gpuLoad: { label: '设备 GPU 负载', unit: '%', cardUnit: '设备GPU瞬时 · %', reportUnit: '%', color: '#a982ff', help: 'GPU 驱动公开的 busy/utilization 计数器，不是 App 单独占用。' },
  gpuMemory: { label: '目标 App 图形内存', unit: 'MB', cardUnit: 'App图形 · MB', reportUnit: 'MB', color: '#ffad57', help: 'App 图形共享内存，来自 dumpsys meminfo 的 GL mtrack/Gfx dev。' },
  gpuFrequency: { label: 'GPU 当前频率', unit: 'MHz', cardUnit: '设备GPU · MHz', reportUnit: 'MHz', color: '#4b8cff', help: 'GPU devfreq 当前频率；厂商未开放节点时显示不可用。' },
  fps: { label: '前台画面 FPS', unit: 'FPS', cardUnit: '前台App · FPS', reportUnit: 'FPS', color: '#42d392', help: '优先使用 SurfaceFlinger 实际呈现帧时间；App 在后台或未运行时不可用。' },
  jankCount: { label: '采样间隔卡顿帧', unit: '帧', cardUnit: '本采样间隔 · 帧', reportUnit: '帧/采样', color: '#ff6b72', help: '当前采样间隔内估算的丢帧/卡顿帧数量，不是会话累计值。' },
  downloadSpeed: { label: '下载速率', unit: 'MB/s', cardUnit: '瞬时速率 · MB/s', reportUnit: 'MB/s', color: '#4b8cff', help: '优先使用 App UID 流量计数；取不到 UID 时回退为整机网卡流量，卡片悬停可看来源。' },
  uploadSpeed: { label: '上传速率', unit: 'MB/s', cardUnit: '瞬时速率 · MB/s', reportUnit: 'MB/s', color: '#42d392', help: '优先使用 App UID 流量计数；取不到 UID 时回退为整机网卡流量，卡片悬停可看来源。' },
  networkLatency: { label: '网络延迟', unit: 'ms', cardUnit: 'ping 4包 · ms', reportUnit: 'ms', color: '#ffad57', help: '对设置的探测目标执行 4 包 ping 后取平均 RTT。' },
  packetLoss: { label: '网络丢包率', unit: '%', cardUnit: 'ping 4包 · %', reportUnit: '%', color: '#ff6b72', help: '对设置的探测目标执行 4 包 ping 后得到的丢包率。' },
  diskReadSpeed: { label: '/data 磁盘读取速率', unit: 'MB/s', cardUnit: '/data瞬时 · MB/s', reportUnit: 'MB/s', color: '#4b8cff', help: '设备 /data 后端块设备读速率，来自块设备 stat 增量。' },
  diskWriteSpeed: { label: '/data 磁盘写入速率', unit: 'MB/s', cardUnit: '/data瞬时 · MB/s', reportUnit: 'MB/s', color: '#a982ff', help: '设备 /data 后端块设备写速率，来自块设备 stat 增量。' },
  ioWait: { label: 'CPU IO Wait', unit: '%', cardUnit: '设备瞬时 · %', reportUnit: '%', color: '#ffad57', help: '整机 CPU 时间中等待 I/O 的比例，来自 /proc/stat iowait 增量。' },
  diskFree: { label: '/data 剩余空间', unit: 'MB', cardUnit: '/data · MB', reportUnit: 'MB', color: '#42d392', help: '设备 /data 分区剩余空间，来自 df /data。' },
  startupTime: { label: 'App 冷启动耗时', unit: 'ms', cardUnit: 'ActivityManager · ms', reportUnit: 'ms', color: '#ffad57', help: '点击“启动应用并计时”后 force-stop 再启动，读取 ActivityManager TotalTime。' },
  crashCount: { label: '崩溃/ANR 累计', unit: '次', cardUnit: '本次会话累计 · 次', reportUnit: '次', color: '#ff6b72', help: '本次监控会话中新出现的 Crash 和 ANR 去重累计。' },
  power: { label: '电池侧瞬时功率', unit: 'W', cardUnit: '计算值 · W', reportUnit: 'W', color: '#a982ff', help: '由电池 current_now × voltage_now 计算，代表电池侧功率，不等同整机墙上功耗。' },
  batteryLevel: { label: '电池电量', unit: '%', cardUnit: '设备 · %', reportUnit: '%', color: '#42d392', help: '设备当前电池电量，来自 dumpsys battery level。' },
  deviceTemperature: { label: '电池温度', unit: '℃', cardUnit: '电池 · ℃', reportUnit: '℃', color: '#ff6b72', help: '设备电池温度，来自 dumpsys battery temperature，不代表 CPU/GPU 温度。' }
};

const metrics = Object.fromEntries(Object.entries(metricDetails).map(([key, value]) => [key, [value.label, value.unit, value.color]]));
const qualityLabels = { measured: '实测', derived: '计算值', background: '后台', unavailable: '不可用' };
const state = { reports: loadReports(), samples: [], running: false, config: null, stopMeta: null, startupTime: null, startupQuality: null, comparison: null };

function metricDetail(key) {
  return metricDetails[key] || { label: key, unit: '', cardUnit: '', reportUnit: '', color: '#fff', help: '未登记指标说明。' };
}

function metricLabel(key) { return metricDetail(key).label; }
function metricUnit(key) { return metricDetail(key).unit || ''; }
function metricCardUnit(key) { return metricDetail(key).cardUnit || metricUnit(key); }
function metricReportUnit(key) { return metricDetail(key).reportUnit || metricUnit(key); }
function metricColor(key) { return metricDetail(key).color || '#fff'; }
function withUnit(value, unit) { return unit ? `${value} ${unit}` : value; }
function metricLegendLabel(key) {
  const unit = metricUnit(key);
  return unit ? `${metricLabel(key)} · ${unit}` : metricLabel(key);
}
function groupUnits(id) {
  const units = [...new Set((groups[id]?.series || []).map((key) => metricUnit(key)).filter(Boolean))];
  return units.length > 1 ? `多单位：${units.join(' / ')}` : (units[0] ? `单位：${units[0]}` : '实时曲线');
}

function loadReports() { try { const value = JSON.parse(localStorage.getItem(REPORT_KEY) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } }
function saveReports() {
  state.reports = state.reports.slice(0, 20);
  while (state.reports.length) {
    try { localStorage.setItem(REPORT_KEY, JSON.stringify(state.reports)); return; }
    catch { state.reports.pop(); }
  }
  localStorage.removeItem(REPORT_KEY);
}
function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[char]); }
function toast(message) { const node = $('#performance-toast'); node.textContent = message; node.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 2200); }
function selectedGroups() { return $$('.metric-options input:checked').map((input) => input.value); }
function activeSeries(groupIds = state.config?.metrics || selectedGroups()) { return [...new Set(groupIds.flatMap((id) => groups[id]?.series || []))]; }

function normalizeValue(key, value) {
  if (!Number.isFinite(value)) return null;
  if (['downloadSpeed','uploadSpeed','diskReadSpeed','diskWriteSpeed'].includes(key)) return value / 1024 / 1024;
  return value;
}
function formatValue(key, value) {
  const normalized = normalizeValue(key, value);
  if (!Number.isFinite(normalized)) return '不可用';
  if (key === 'appCpuUsage') {
    const digits = Math.abs(normalized) >= 100 ? 0 : Math.abs(normalized) >= 10 ? 1 : 2;
    const cores = normalized / 100;
    return `${normalized.toFixed(digits)}% · ${cores.toFixed(2)}核`;
  }
  const digits = Math.abs(normalized) >= 100 ? 0 : Math.abs(normalized) >= 10 ? 1 : 2;
  return withUnit(normalized.toFixed(digits), metricUnit(key));
}

async function refreshDevices() {
  const select = $('#performance-device'); select.innerHTML = '<option value="">正在检测…</option>'; select.disabled = true;
  try {
    const devices = await api.listDevices(); select.innerHTML = '';
    if (!devices.length) select.innerHTML = '<option value="">未发现 Android 设备</option>';
    for (const device of devices) {
      const option = document.createElement('option'); option.value = device.serial; option.disabled = device.state !== 'device';
      option.textContent = `${device.model} · ${device.serial} · ${device.state === 'device' ? '已就绪' : device.state === 'unauthorized' ? '等待授权' : '离线'}`; select.append(option);
    }
    select.value = devices.find((item) => item.state === 'device')?.serial || '';
  } catch (error) { select.innerHTML = '<option value="">设备检测失败</option>'; toast(error.message || String(error)); }
  finally { select.disabled = false; updateActionState(); }
}

function updateActionState() {
  const hasDevice = Boolean($('#performance-device').value);
  $('#performance-start').disabled = state.running || !hasDevice || !selectedGroups().length;
  $('#performance-stop').disabled = !state.running;
  $('#performance-launch').disabled = state.running || !hasDevice || !$('#performance-package').value.trim();
  $('#performance-detect-app').disabled = state.running || !hasDevice;
  $$('.metric-options input,#performance-device,#performance-package,#performance-interval,#performance-follow-app,#performance-network-target').forEach((node) => { node.disabled = state.running; });
}

function calculateLeakTrend(samples) {
  const cutoff = Date.now() - 5 * 60 * 1000;
  const values = samples.filter((sample) => sample.timestamp >= cutoff && Number.isFinite(sample.appMemory));
  if (values.length < 10 || values.at(-1).timestamp - values[0].timestamp < 60000) return null;
  const origin = values[0].timestamp;
  const points = values.map((sample) => ({ x: (sample.timestamp - origin) / 60000, y: sample.appMemory }));
  const xMean = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const yMean = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const numerator = points.reduce((sum, point) => sum + (point.x - xMean) * (point.y - yMean), 0);
  const denominator = points.reduce((sum, point) => sum + (point.x - xMean) ** 2, 0);
  return denominator > 0 ? numerator / denominator : null;
}

function setupDashboard() {
  const series = activeSeries();
  $('#performance-kpis').innerHTML = series.map((key) => `<div class="performance-kpi" id="kpi-card-${key}"><span>${metricLabel(key)}</span><strong id="kpi-${key}">—</strong><div><small>${metricCardUnit(key)}</small><em id="kpi-quality-${key}">等待采样</em></div></div>`).join('');
  $('#performance-charts').innerHTML = state.config.metrics.map((id) => `<article class="chart-card"><header><h3>${groups[id].name}趋势</h3><span>${groupUnits(id)}</span></header><canvas id="chart-${id}"></canvas></article>`).join('');
  $('#performance-dashboard').hidden = false;
}

function drawChart(canvas, samples, keys, labels = null) {
  if (!canvas) return; const rect = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr)); canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr); const width = rect.width; const height = rect.height; ctx.clearRect(0,0,width,height);
  ctx.strokeStyle = '#283545'; ctx.lineWidth = 1; for (let i=1;i<4;i+=1){const y=height*i/4;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke();}
  const usable = samples.slice(-120); const values = keys.flatMap((key) => usable.map((sample) => normalizeValue(key, sample[key])).filter(Number.isFinite));
  if (!values.length) { ctx.fillStyle='#637187';ctx.font='10px system-ui';ctx.textAlign='center';ctx.fillText('等待设备返回数据',width/2,height/2);return; }
  let min = Math.min(...values), max = Math.max(...values); if (min === max) { min -= 1; max += 1; } const padding=(max-min)*.12;min-=padding;max+=padding;
  keys.forEach((key,index) => { const color=metricColor(key) || ['#4b8cff','#42d392'][index%2];ctx.strokeStyle=color;ctx.lineWidth=1.8;ctx.beginPath();let started=false;
    usable.forEach((sample,i)=>{const value=normalizeValue(key,sample[key]);if(!Number.isFinite(value))return;const x=usable.length===1?0:i/(usable.length-1)*width;const y=height-(value-min)/(max-min)*height;if(!started){ctx.moveTo(x,y);started=true;}else ctx.lineTo(x,y);});ctx.stroke(); });
  ctx.font='8px system-ui';ctx.textAlign='left';let x=5;keys.forEach((key,index)=>{ctx.fillStyle=metricColor(key)||'#fff';const label=labels?.[index]||metricLegendLabel(key);ctx.fillText(label,x,11);x+=ctx.measureText(label).width+12;});
}

function updateDashboard() {
  const last = state.samples.at(-1); if (!last) return;
  for (const key of activeSeries()) {
    const node=$(`#kpi-${key}`);const qualityNode=$(`#kpi-quality-${key}`);const card=$(`#kpi-card-${key}`);
    const value=key==='startupTime'?state.startupTime:last[key];const quality=key==='startupTime'?state.startupQuality:last.quality?.[key];
    if(node)node.textContent=formatValue(key,value);
    if(qualityNode){qualityNode.textContent=qualityLabels[quality?.state]||'等待采样';qualityNode.dataset.state=quality?.state||'waiting';}
    if(card)card.title=`${metricDetail(key).help}\n状态：${qualityLabels[quality?.state]||'等待采样'}\n来源：${quality?.reason||quality?.source||'等待设备返回数据'}`;
  }
  $('#performance-duration').textContent = `${String(Math.floor(last.elapsed/60)).padStart(2,'0')}:${String(Math.floor(last.elapsed%60)).padStart(2,'0')}`;
  $('#performance-sample-count').textContent = `${state.samples.length} 个采样点`;
  for (const id of state.config.metrics) drawChart($(`#chart-${id}`),state.samples,groups[id].series);
}

async function startTest() {
  const selected=selectedGroups(); if(!selected.length)return toast('请至少选择一类监控数据');
  state.samples=[];state.config={serial:$('#performance-device').value,packageName:$('#performance-package').value.trim(),followForeground:$('#performance-follow-app').checked,networkTarget:$('#performance-network-target').value.trim(),interval:Number($('#performance-interval').value),metrics:selected};
  try { const meta=await api.start(state.config);state.config={...state.config,...meta};if(meta.packageName)$('#performance-package').value=meta.packageName;state.running=true;setupDashboard();updateActionState();$('#performance-session-summary').textContent=`正在监控 ${meta.model} · ${selected.map(id=>groups[id].name).join('、')}`; }
  catch(error){toast(error.message||String(error));}
}

async function stopTest() { if(!state.running)return; try { state.stopMeta=await api.stop();state.running=false;updateActionState();$('#report-name').value=`性能测试 ${new Date().toLocaleString('zh-CN',{hour12:false})}`;$('#report-name-modal').hidden=false;setTimeout(()=>$('#report-name').select(),0); } catch(error){toast(error.message||String(error));} }

function reportSummary(report) { const result={};for(const key of activeSeries(report.config.metrics)){const values=report.samples.map(s=>normalizeValue(key,s[key])).filter(Number.isFinite);if(values.length)result[key]={avg:values.reduce((a,b)=>a+b,0)/values.length,max:Math.max(...values),min:Math.min(...values)};}if(Number.isFinite(report.startupTime))result.startupTime={avg:report.startupTime,max:report.startupTime,min:report.startupTime};return result; }
function reportQuality(report,key){if(key==='startupTime')return report.startupQuality;for(let index=report.samples.length-1;index>=0;index-=1){const quality=report.samples[index].quality?.[key];if(quality?.state!=='unavailable')return quality;}return report.samples.at(-1)?.quality?.[key]||null;}

function createReport(name,note) { return { id:`${Date.now()}-${Math.random().toString(16).slice(2)}`,version:2,accuracyMode:'strict-measured',name,note,createdAt:new Date().toISOString(),config:state.config,meta:state.stopMeta,startupTime:state.startupTime,startupQuality:state.startupQuality,samples:state.samples.slice() }; }

function renderReports() {
  $('#report-count').textContent=state.reports.length;$('#report-empty').hidden=state.reports.length>0;$('#report-list').hidden=!state.reports.length;
  $('#report-list').innerHTML=state.reports.map((report)=>`<article class="report-card"><h3>${escapeHtml(report.name)}</h3><p>${escapeHtml(report.note||'暂无测试备注')}</p><div class="report-meta"><span>${new Date(report.createdAt).toLocaleString('zh-CN',{hour12:false})}</span><span>${report.samples.length} 点</span></div><div class="report-actions"><button data-report-export="${report.id}">导出 Excel</button><button data-report-compare="${report.id}">加入对比</button><button class="delete" data-report-delete="${report.id}">×</button></div></article>`).join('');
  $$('[data-report-export]').forEach(button=>button.onclick=()=>exportReport(state.reports.find(r=>r.id===button.dataset.reportExport)));
  $$('[data-report-delete]').forEach(button=>button.onclick=()=>{if(!confirm('确定删除这份性能报告吗？'))return;state.reports=state.reports.filter(r=>r.id!==button.dataset.reportDelete);saveReports();renderReports();});
  $$('[data-report-compare]').forEach(button=>button.onclick=()=>{const id=button.dataset.reportCompare;$('#compare-left').value=id;switchPage('compare');toast('已选为基准报告，请再选择目标报告');});
  renderCompareOptions();
}

function formatReportNumber(key, value) {
  if (!Number.isFinite(value)) return '';
  const normalized = normalizeValue(key, value);
  return Number.isFinite(normalized) ? normalized : '';
}

function excelHtml(report, comparison=null) {
  const keys=activeSeries(report.config.metrics);const summary=reportSummary(report);const columns=['elapsed',...keys];
  const summaryRows=keys.map(key=>{const quality=reportQuality(report,key);return `<tr><td>${metricLabel(key)}</td><td>${metricReportUnit(key)}</td><td>${qualityLabels[quality?.state]||'未知'}</td><td>${escapeHtml(metricDetail(key).help)}</td><td>${escapeHtml(quality?.source||quality?.reason||'')}</td><td>${formatReportNumber(key,summary[key]?.avg)}</td><td>${formatReportNumber(key,summary[key]?.max)}</td><td>${formatReportNumber(key,summary[key]?.min)}</td></tr>`;}).join('');
  const dataRows=report.samples.map(sample=>`<tr>${columns.map(key=>`<td>${key==='elapsed'?sample.elapsed:(formatReportNumber(key,sample[key])??'')}</td>`).join('')}</tr>`).join('');
  const comparisonTable=comparison?`<h2>性能对比</h2><table><tr><th>指标</th><th>单位</th><th>基准平均</th><th>目标平均</th><th>变化 %</th></tr>${comparison.rows.map(row=>`<tr><td>${metricLabel(row.key)}</td><td>${metricReportUnit(row.key)}</td><td>${formatReportNumber(row.key,row.left)}</td><td>${formatReportNumber(row.key,row.right)}</td><td>${Number.isFinite(row.delta)?row.delta:''}</td></tr>`).join('')}</table>`:'';
  const payload=JSON.stringify({type:'performance-report',report}).replace(/</g,'\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,"Microsoft YaHei";color:#17212f}h1{color:#245fae}table{border-collapse:collapse;margin:12px 0 24px}th{background:#245fae;color:white}th,td{border:1px solid #d7e0ec;padding:7px 10px;text-align:right}th:first-child,td:first-child,td:nth-child(4),td:nth-child(5){text-align:left}.meta td:first-child{font-weight:bold;background:#edf4ff}.note{color:#5c6b7d;font-size:13px;line-height:1.7}</style></head><body><h1>${escapeHtml(report.name)}</h1><p class="note">严格实测模式：设备未公开的数据保持为空，不使用模拟值。App CPU 使用 Android 单核口径，单核满载=100%，多线程可超过100%。速率类指标为采样间隔增量换算，卡顿帧为单次采样间隔内数量。</p><table class="meta"><tr><td>报告时间</td><td>${new Date(report.createdAt).toLocaleString('zh-CN',{hour12:false})}</td></tr><tr><td>设备</td><td>${escapeHtml(report.config.model||report.config.serial)}</td></tr><tr><td>应用包名</td><td>${escapeHtml(report.config.packageName||'未指定')}</td></tr><tr><td>网络探测目标</td><td>${escapeHtml(report.config.networkTarget||'未记录')}</td></tr><tr><td>备注</td><td>${escapeHtml(report.note||'')}</td></tr><tr><td>采样点</td><td>${report.samples.length}</td></tr></table>${comparisonTable}<h2>指标摘要</h2><table><tr><th>指标</th><th>单位</th><th>状态</th><th>口径说明</th><th>数据来源/不可用原因</th><th>平均值</th><th>最大值</th><th>最小值</th></tr>${summaryRows}</table><h2>采样明细</h2><table><tr>${columns.map(key=>`<th>${key==='elapsed'?'时间（秒）':`${metricLabel(key)}（${metricReportUnit(key)}）`}</th>`).join('')}</tr>${dataRows}</table><script id="performance-report-data" type="application/json">${payload}</script></body></html>`;
}
function download(content,name){const blob=new Blob(['\ufeff',content],{type:'application/vnd.ms-excel;charset=utf-8'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=name.replace(/[\\/:*?"<>|]/g,'_');link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}
function exportReport(report){if(!report)return;download(excelHtml(report),`${report.name}.xls`);toast('Excel 报告已导出');}

async function importReport(file){const text=await file.text();let report;if(file.name.endsWith('.json'))report=JSON.parse(text);else{const doc=new DOMParser().parseFromString(text,'text/html');const node=doc.querySelector('#performance-report-data');if(!node)throw new Error('文件中没有 Test cat 报告数据');report=JSON.parse(node.textContent).report;}if(!report?.samples||!report?.config)throw new Error('报告格式不正确');report.id=`${Date.now()}-${Math.random().toString(16).slice(2)}`;state.reports.unshift(report);saveReports();renderReports();toast('性能报告已导入');}

function renderCompareOptions(){const html='<option value="">选择报告</option>'+state.reports.map(r=>`<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');const left=$('#compare-left').value,right=$('#compare-right').value;$('#compare-left').innerHTML=html;$('#compare-right').innerHTML=html;$('#compare-left').value=left;$('#compare-right').value=right;$('#compare-empty').hidden=state.reports.length>=2;}
function formatNormalized(key,value){if(!Number.isFinite(value))return '—';if(key==='appCpuUsage'){const digits=Math.abs(value)>=100?0:Math.abs(value)>=10?1:2;return `${value.toFixed(digits)}% · ${(value/100).toFixed(2)}核`;}const digits=Math.abs(value)>=100?0:Math.abs(value)>=10?1:2;return withUnit(value.toFixed(digits), metricUnit(key));}
function runComparison(){const left=state.reports.find(r=>r.id===$('#compare-left').value),right=state.reports.find(r=>r.id===$('#compare-right').value);if(!left||!right||left===right)return toast('请选择两份不同的报告');const a=reportSummary(left),b=reportSummary(right);const keys=Object.keys(a).filter(key=>b[key]);const rows=keys.map(key=>({key,left:a[key].avg,right:b[key].avg,delta:a[key].avg===0?null:(b[key].avg-a[key].avg)/Math.abs(a[key].avg)*100}));state.comparison={left,right,rows};$('#compare-result').hidden=false;$('#compare-empty').hidden=true;$('#compare-title').textContent=`${left.name}  vs  ${right.name}`;$('#compare-table-body').innerHTML=rows.map(row=>`<tr title="${escapeHtml(metricDetail(row.key).help)}"><td>${metricLabel(row.key)}</td><td>${formatNormalized(row.key,row.left)}</td><td>${formatNormalized(row.key,row.right)}</td><td class="${row.delta>0?'delta-up':'delta-down'}">${Number.isFinite(row.delta)?`${row.delta>0?'+':''}${row.delta.toFixed(1)}%`:'—'}</td></tr>`).join('');$('#compare-metric').innerHTML=keys.map(key=>`<option value="${key}">${metricLabel(key)}</option>`).join('');drawComparison();}
function drawComparison(){const c=state.comparison;if(!c)return;const key=$('#compare-metric').value;drawChart($('#compare-chart'),c.left.samples.map((sample,i)=>({...sample,left:normalizeValue(key,sample[key]),right:normalizeValue(key,c.right.samples[Math.min(i,c.right.samples.length-1)]?.[key])})),['left','right'],[c.left.name,c.right.name]);}
function exportComparison(){const c=state.comparison;if(!c)return;download(excelHtml(c.left,c),`性能对比_${c.left.name}_vs_${c.right.name}.xls`);toast('对比 Excel 已导出');}

function switchPage(page){$$('[data-performance-page]').forEach(b=>b.classList.toggle('active',b.dataset.performancePage===page));$$('.performance-page').forEach(p=>p.classList.toggle('active',p.id===`performance-${page}-page`));if(page==='history')renderReports();if(page==='compare')renderCompareOptions();}

$$('[data-performance-page]').forEach(button=>button.onclick=()=>switchPage(button.dataset.performancePage));
$$('.metric-options input').forEach(input=>input.onchange=updateActionState);
$('#performance-toggle-all').onclick=()=>{const all=$$('.metric-options input');const checked=all.every(i=>i.checked);all.forEach(i=>i.checked=!checked);$('#performance-toggle-all').textContent=checked?'全选':'取消全选';updateActionState();};
$('#performance-refresh').onclick=refreshDevices;$('#performance-device').onchange=updateActionState;$('#performance-package').oninput=()=>{state.startupTime=null;state.startupQuality=null;updateActionState();};$('#performance-start').onclick=startTest;$('#performance-stop').onclick=stopTest;
$('#performance-detect-app').onclick=async()=>{try{const result=await api.getForegroundApp($('#performance-device').value);$('#performance-package').value=result.packageName;state.startupTime=null;updateActionState();toast(`已读取当前应用：${result.packageName}`);}catch(error){toast(error.message||String(error));}};
$('#performance-launch').onclick=async()=>{try{const result=await api.launchApp($('#performance-device').value,$('#performance-package').value.trim());state.startupTime=result.totalTime;state.startupQuality=Number.isFinite(result.totalTime)?{state:'measured',source:result.source,scope:'app'}:{state:'unavailable',reason:'设备未返回 ActivityManager TotalTime'};toast(result.totalTime?`应用冷启动耗时 ${result.totalTime} ms`:'应用已启动，设备未返回耗时');updateDashboard();}catch(error){toast(error.message||String(error));}};
$('#report-name-form').onsubmit=(event)=>{event.preventDefault();const report=createReport($('#report-name').value.trim(),$('#report-note').value.trim());state.reports.unshift(report);saveReports();$('#report-name-modal').hidden=true;$('#report-note').value='';state.startupTime=null;state.startupQuality=null;renderReports();switchPage('history');toast('性能报告已保存');};
$('#report-discard').onclick=()=>{$('#report-name-modal').hidden=true;state.samples=[];state.startupTime=null;state.startupQuality=null;toast('本次测试未保存');};
$('#report-import').onclick=()=>$('#report-import-input').click();$('#report-import-input').onchange=async(event)=>{const[file]=event.target.files;if(!file)return;try{await importReport(file);}catch(error){toast(`导入失败：${error.message}`);}event.target.value='';};
$('#compare-run').onclick=runComparison;$('#compare-metric').onchange=drawComparison;$('#compare-export').onclick=exportComparison;
window.addEventListener('resize',()=>{if(state.running)updateDashboard();if(state.comparison)drawComparison();});

if(api){api.onSample((sample)=>{const compact={timestamp:sample.timestamp,elapsed:sample.elapsed,packageName:sample.packageName,quality:{}};for(const key of activeSeries()){compact[key]=sample[key];compact.quality[key]=sample.quality?.[key];}compact.memoryLeakTrend=calculateLeakTrend([...state.samples,compact]);compact.quality.memoryLeakTrend=Number.isFinite(compact.memoryLeakTrend)?{state:'derived',source:'最近5分钟应用 PSS 线性回归（至少60秒）',scope:'app'}:{state:'unavailable',reason:'至少需要60秒有效 PSS 数据'};if(Number.isFinite(state.startupTime)){compact.startupTime=state.startupTime;compact.quality.startupTime=state.startupQuality;}state.samples.push(compact);if(state.samples.length>5000)state.samples.shift();updateDashboard();});api.onStatus((status)=>{const node=$('#performance-status');node.dataset.phase=status.phase||'idle';node.querySelector('span').textContent=status.message||'等待开始';if(status.packageName){$('#performance-package').value=status.packageName;if(state.config)state.config.packageName=status.packageName;}});refreshDevices();}else toast('请通过 Test cat 本地预览入口运行性能监控');
renderReports();updateActionState();
