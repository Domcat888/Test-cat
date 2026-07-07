const api = window.testCat?.weakNetwork;
const $ = (selector) => document.querySelector(selector);

const fallbackPresets = [
  { id:'forest',name:'深山老林',icon:'🌲',downKbps:180,upKbps:80,latencyMs:850,jitterMs:420,instability:12,outageEveryMs:24000,outageMs:2600 },
  { id:'elevator',name:'电梯',icon:'🛗',downKbps:96,upKbps:48,latencyMs:1200,jitterMs:700,instability:24,outageEveryMs:12000,outageMs:4200 },
  { id:'subway',name:'地铁',icon:'🚇',downKbps:1200,upKbps:384,latencyMs:260,jitterMs:190,instability:8,outageEveryMs:32000,outageMs:1800 },
  { id:'tunnel',name:'隧道穿行',icon:'🚇',downKbps:384,upKbps:128,latencyMs:650,jitterMs:520,instability:18,outageEveryMs:18000,outageMs:3200 },
  { id:'2g',name:'2G 网络',icon:'📶',downKbps:200,upKbps:80,latencyMs:600,jitterMs:180,instability:6,outageEveryMs:0,outageMs:0 },
  { id:'3g',name:'3G 网络',icon:'📡',downKbps:1500,upKbps:512,latencyMs:180,jitterMs:80,instability:2,outageEveryMs:0,outageMs:0 }
];

const state = { presets:fallbackPresets,selectedId:'subway',basePresetId:'subway',running:false,busy:false,lastStats:null,lastStatsAt:0 };
const fields = { downKbps:$('#down-input'),upKbps:$('#up-input'),latencyMs:$('#latency-input'),jitterMs:$('#jitter-input'),instability:$('#instability-input') };

function toast(message){const node=$('#toast');node.textContent=message;node.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.classList.remove('show'),2600)}
function currentPreset(){return state.presets.find(item=>item.id===(state.selectedId==='custom'?state.basePresetId:state.selectedId))||state.presets[0]}
function currentProfile(){const base=currentPreset();return {...base,id:state.selectedId==='custom'?'custom':base.id,name:state.selectedId==='custom'?'自定义场景':base.name,...Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,Number(input.value)]))}}
function renderPresets(){
  $('#preset-grid').innerHTML=state.presets.map(item=>`<button class="preset-card${item.id===state.selectedId?' active':''}" data-preset="${item.id}"><span>${item.icon}</span><b>${item.name}</b><small>↓ ${item.downKbps}K · ${item.latencyMs}ms</small></button>`).join('');
  document.querySelectorAll('[data-preset]').forEach(button=>button.addEventListener('click',()=>selectPreset(button.dataset.preset)));
}
function selectPreset(id){if(state.running||state.busy)return;state.selectedId=id;state.basePresetId=id;const preset=currentPreset();for(const [key,input] of Object.entries(fields))input.value=preset[key];$('#selected-name').textContent=preset.name;renderPresets()}
function markCustom(){if(state.running||state.busy)return;if(state.selectedId!=='custom')state.basePresetId=state.selectedId;state.selectedId='custom';$('#selected-name').textContent='自定义';renderPresets()}
function setBusy(busy){state.busy=busy;$('#start-button').disabled=busy||state.running;$('#stop-button').disabled=busy||!state.running;$('#refresh-button').disabled=busy||state.running;$('#device-select').disabled=busy||state.running;for(const input of Object.values(fields))input.disabled=busy||state.running;document.querySelectorAll('[data-preset]').forEach(button=>button.disabled=busy||state.running)}
function updateStatus(status){const pill=$('#window-status');pill.dataset.phase=status.phase||'idle';pill.querySelector('span').textContent=status.message||'等待开始';if(status.phase==='running'){state.running=true;$('.run-panel').classList.add('running');$('#run-title').textContent='弱网正在运行';$('#run-copy').textContent=`${status.profile?.name||'当前场景'} · 关闭窗口会自动恢复`;}if(status.phase==='idle'){state.running=false;$('.run-panel').classList.remove('running');$('#run-title').textContent='弱网尚未开启';$('#run-copy').textContent='选好设备与场景后即可开始';}if(status.phase==='error')toast(status.message);setBusy(['deploying','configuring','starting','stopping'].includes(status.phase))}
function formatSpeed(bytes){if(!Number.isFinite(bytes)||bytes<=0)return'0 KB/s';const kb=bytes/1024;return kb>=1024?`${(kb/1024).toFixed(1)} MB/s`:`${kb.toFixed(1)} KB/s`}
function updateStats(stats){const now=Date.now();let up=0,down=0;if(state.lastStats&&state.lastStatsAt){const seconds=Math.max(.2,(now-state.lastStatsAt)/1000);up=(stats.upBytes-state.lastStats.upBytes)/seconds;down=(stats.downBytes-state.lastStats.downBytes)/seconds}state.lastStats=stats;state.lastStatsAt=now;$('#live-up').textContent=formatSpeed(up);$('#live-down').textContent=formatSpeed(down);$('#live-connections').textContent=stats.connections||0;$('#live-interruptions').textContent=stats.interruptions||0}
async function refreshDevices(){if(!api)return toast('请通过本地预览入口运行 Test cat');setBusy(true);const select=$('#device-select');try{const devices=await api.listDevices();select.innerHTML=devices.map(item=>`<option value="${item.serial}">${item.model} · ${item.serial} · ${item.state==='device'?'已就绪':item.state}</option>`).join('')||'<option value="">没有发现设备</option>';const ready=devices.some(item=>item.state==='device');$('.device-tip').classList.toggle('ready',ready);$('#device-tip').textContent=ready?'设备已连接，可以开始弱网测试':'请开启 USB 调试，并在手机上允许此电脑';}catch(error){select.innerHTML='<option value="">ADB 连接失败</option>';toast(error.message||'查找设备失败')}finally{setBusy(false)}}
async function start(){if(!api)return toast('请通过本地预览入口运行 Test cat');const serial=$('#device-select').value;if(!serial)return toast('请先连接并选择 Android 设备');setBusy(true);$('#window-status').dataset.phase='starting';$('#window-status span').textContent='正在开启弱网…';try{const result=await api.start({serial,profile:currentProfile()});state.running=true;toast(result?.needsVpnConfirmation?'请在手机上确认 VPN 请求':'弱网已开启');}catch(error){updateStatus({phase:'error',message:error.message||'弱网开启失败'});state.running=false;}finally{setBusy(false)}}
async function stop(){if(!api)return;setBusy(true);try{await api.stop();state.running=false;state.lastStats=null;updateStats({upBytes:0,downBytes:0,connections:0,interruptions:0});updateStatus({phase:'idle',message:'已恢复正常网络'});toast('手机网络已恢复');}catch(error){toast(error.message||'恢复网络失败')}finally{setBusy(false)}}

document.body.dataset.platform=window.testCat?.platform||'';
Object.values(fields).forEach(input=>input.addEventListener('change',markCustom));
$('#refresh-button').addEventListener('click',refreshDevices);
$('#reset-button').addEventListener('click',()=>selectPreset(state.selectedId==='custom'?state.basePresetId:state.selectedId));
$('#start-button').addEventListener('click',start);
$('#stop-button').addEventListener('click',stop);
api?.onStatus(updateStatus);
api?.onStats(updateStats);
(async()=>{try{state.presets=await api?.getPresets()||fallbackPresets}catch{}renderPresets();selectPreset('subway');refreshDevices()})();
