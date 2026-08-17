const api = window.testCat?.pixelRuler;
const query = new URLSearchParams(location.search);
const payloadId = query.get('id');
const $ = (selector) => document.querySelector(selector);
const canvas = $('#measure-canvas');
const context = canvas.getContext('2d');
const screenImage = $('#screen-image');
const referenceImage = $('#reference-image');
const sourceCanvas = document.createElement('canvas');
const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
const magnifierCanvas = $('#magnifier canvas');
const magnifierContext = magnifierCanvas.getContext('2d');

let payload;
let sourceImage;
let selections = [];
let dragStart = null;
let draft = null;
let cursor = { x: 0, y: 0 };
let mode = 'measure';
let showRulers = true;
let showGuides = true;
let showMagnifier = true;
let referenceVisible = false;
let referenceOpacity = .45;
let referenceScale = 1;
let referenceRect = null;
let referenceDrag = null;
let blinkTimer = null;
let toastTimer = null;

const colors = ['#ff4f9a', '#43d7ff'];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const normalizedRect = (a, b) => ({ x: Math.min(a.x,b.x), y: Math.min(a.y,b.y), width: Math.abs(a.x-b.x), height: Math.abs(a.y-b.y) });
const validRect = (rect) => rect && rect.width >= 3 && rect.height >= 3;

function scaleX() { return sourceImage ? sourceImage.naturalWidth / innerWidth : devicePixelRatio; }
function scaleY() { return sourceImage ? sourceImage.naturalHeight / innerHeight : devicePixelRatio; }
function sourceRect(rect) { return { x: Math.round(rect.x*scaleX()), y: Math.round(rect.y*scaleY()), width: Math.round(rect.width*scaleX()), height: Math.round(rect.height*scaleY()) }; }
function sourcePoint(point) { return { x: clamp(Math.floor(point.x*scaleX()),0,sourceCanvas.width-1), y: clamp(Math.floor(point.y*scaleY()),0,sourceCanvas.height-1) }; }

function resizeCanvas() {
  const ratio = devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * ratio);
  canvas.height = Math.round(innerHeight * ratio);
  context.setTransform(ratio,0,0,ratio,0,0);
  draw();
}

function toast(text) {
  const node = $('#toast');
  node.textContent = text;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 1800);
}

function pixelAt(point) {
  const source = sourcePoint(point);
  const data = sourceContext.getImageData(source.x,source.y,1,1).data;
  const hex = `#${[data[0],data[1],data[2]].map((v)=>v.toString(16).padStart(2,'0')).join('').toUpperCase()}`;
  return { source, rgb: [data[0],data[1],data[2]], hex };
}

function drawArrow(ctx, x1, y1, x2, y2, label, color = '#ffd65a', multiplier = 1) {
  ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.5*multiplier;
  ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
  const angle = Math.atan2(y2-y1,x2-x1), size = 5*multiplier;
  for (const [x,y,a] of [[x1,y1,angle],[x2,y2,angle+Math.PI]]) { ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+Math.cos(a+.55)*size,y+Math.sin(a+.55)*size); ctx.moveTo(x,y); ctx.lineTo(x+Math.cos(a-.55)*size,y+Math.sin(a-.55)*size); ctx.stroke(); }
  ctx.font = `${10*multiplier}px system-ui`; const width = ctx.measureText(label).width+8*multiplier; const cx=(x1+x2)/2,cy=(y1+y2)/2;
  ctx.fillStyle='rgba(10,15,22,.9)';ctx.fillRect(cx-width/2,cy-8*multiplier,width,16*multiplier);ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,cx,cy);ctx.restore();
}

function gapInfo() {
  if (selections.length < 2) return null;
  const [a,b]=selections;
  const ar=sourceRect(a),br=sourceRect(b);
  const horizontal = ar.x+ar.width < br.x ? br.x-(ar.x+ar.width) : br.x+br.width < ar.x ? ar.x-(br.x+br.width) : 0;
  const vertical = ar.y+ar.height < br.y ? br.y-(ar.y+ar.height) : br.y+br.height < ar.y ? ar.y-(br.y+br.height) : 0;
  const centerDx = Math.round(Math.abs((ar.x+ar.width/2)-(br.x+br.width/2)));
  const centerDy = Math.round(Math.abs((ar.y+ar.height/2)-(br.y+br.height/2)));
  const alignment=[];
  if (Math.abs(ar.x-br.x)<=2) alignment.push('左对齐');
  if (Math.abs(ar.x+ar.width-br.x-br.width)<=2) alignment.push('右对齐');
  if (centerDx<=2) alignment.push('水平居中');
  if (Math.abs(ar.y-br.y)<=2) alignment.push('顶对齐');
  if (Math.abs(ar.y+ar.height-br.y-br.height)<=2) alignment.push('底对齐');
  if (centerDy<=2) alignment.push('垂直居中');
  return { horizontal, vertical, centerDx, centerDy, alignment };
}

function drawRulers() {
  const top=27,left=27;
  context.fillStyle='rgba(9,15,23,.84)';context.fillRect(0,0,innerWidth,top);context.fillRect(0,0,left,innerHeight);
  context.strokeStyle='rgba(190,215,245,.65)';context.fillStyle='#d7e7f8';context.lineWidth=1;context.font='8px system-ui';
  const sx=scaleX(),sy=scaleY();
  for(let value=0;value<=sourceCanvas.width;value+=10){const x=value/sx;if(x>innerWidth)break;const major=value%50===0;context.beginPath();context.moveTo(x,top);context.lineTo(x,top-(major?10:5));context.stroke();if(major&&x>30)context.fillText(String(value),x+2,9);}
  context.save();context.translate(0,innerHeight);context.rotate(-Math.PI/2);
  for(let value=0;value<=sourceCanvas.height;value+=10){const x=value/sy;if(x>innerHeight)break;const major=value%50===0;context.beginPath();context.moveTo(x,27);context.lineTo(x,27-(major?10:5));context.stroke();if(major&&x>30)context.fillText(String(value),x+2,9);}
  context.restore();
}

function drawSelection(rect,index) {
  const value=sourceRect(rect),color=colors[index%colors.length];
  context.save();context.strokeStyle=color;context.fillStyle=`${color}22`;context.lineWidth=2;context.setLineDash(index===0?[]:[7,4]);context.fillRect(rect.x,rect.y,rect.width,rect.height);context.strokeRect(rect.x+.5,rect.y+.5,rect.width,rect.height);
  const label=`${index+1}  X=${value.x} Y=${value.y}  W=${value.width} H=${value.height}`;context.font='bold 11px system-ui';const width=context.measureText(label).width+12;let y=rect.y-22;if(y<74)y=rect.y+5;context.setLineDash([]);context.fillStyle='rgba(8,13,20,.9)';context.fillRect(rect.x,y,width,18);context.fillStyle=color;context.fillText(label,rect.x+6,y+13);
  if(showGuides){context.globalAlpha=.65;context.setLineDash([4,5]);context.beginPath();context.moveTo(rect.x+rect.width/2,0);context.lineTo(rect.x+rect.width/2,innerHeight);context.moveTo(0,rect.y+rect.height/2);context.lineTo(innerWidth,rect.y+rect.height/2);context.stroke();}
  context.restore();
}

function drawDistances() {
  if(selections.length<2)return;
  const [a,b]=selections,info=gapInfo();
  if(info.horizontal){const left=a.x+a.width<=b.x?a:b,right=left===a?b:a;const y=clamp(Math.max(left.y,right.y)+Math.min(left.height,right.height)/2,80,innerHeight-40);drawArrow(context,left.x+left.width,y,right.x,y,`${info.horizontal} px`);}
  if(info.vertical){const top=a.y+a.height<=b.y?a:b,bottom=top===a?b:a;const x=clamp(Math.max(top.x,bottom.x)+Math.min(top.width,bottom.width)/2,40,innerWidth-40);drawArrow(context,x,top.y+top.height,x,bottom.y,`${info.vertical} px`);}
}

function draw() {
  context.clearRect(0,0,innerWidth,innerHeight);
  if(showRulers)drawRulers();
  if(mode==='measure'){
    context.save();context.strokeStyle='rgba(255,70,144,.72)';context.lineWidth=1;context.setLineDash([5,5]);context.beginPath();context.moveTo(0,cursor.y+.5);context.lineTo(innerWidth,cursor.y+.5);context.moveTo(cursor.x+.5,0);context.lineTo(cursor.x+.5,innerHeight);context.stroke();context.restore();
  }
  selections.forEach(drawSelection);if(validRect(draft))drawSelection(draft,selections.length);drawDistances();
}

function renderMagnifier(point) {
  if(!showMagnifier){$('#magnifier').hidden=true;return;}$('#magnifier').hidden=false;
  const source=sourcePoint(point),size=11,half=Math.floor(size/2),sx=clamp(source.x-half,0,Math.max(0,sourceCanvas.width-size)),sy=clamp(source.y-half,0,Math.max(0,sourceCanvas.height-size));
  magnifierContext.imageSmoothingEnabled=false;magnifierContext.clearRect(0,0,132,132);magnifierContext.drawImage(sourceCanvas,sx,sy,size,size,0,0,132,132);magnifierContext.strokeStyle='rgba(255,255,255,.35)';magnifierContext.lineWidth=1;
  for(let i=0;i<=size;i++){const p=i*12;magnifierContext.beginPath();magnifierContext.moveTo(p,0);magnifierContext.lineTo(p,132);magnifierContext.moveTo(0,p);magnifierContext.lineTo(132,p);magnifierContext.stroke();}
  magnifierContext.strokeStyle='#ff3f8f';magnifierContext.lineWidth=2;magnifierContext.strokeRect(60,60,12,12);$('#magnifier-label').textContent=`X=${source.x} · Y=${source.y}`;
}

function updateInfo() {
  if(!sourceImage||!sourceCanvas.width||!sourceCanvas.height)return;
  const pixel=pixelAt(cursor);const selected=draft||selections.at(-1);const rect=selected?sourceRect(selected):null;
  $('#coordinate-value').textContent=rect?`X=${rect.x} · Y=${rect.y}`:`X=${pixel.source.x} · Y=${pixel.source.y}`;
  $('#size-value').textContent=rect?`W=${rect.width} · H=${rect.height}`:'W=0 · H=0';
  $('#color-value').innerHTML=`<i style="background:${pixel.hex}"></i>${pixel.hex}`;$('#color-value').title=`RGB(${pixel.rgb.join(', ')})`;
  const info=gapInfo();$('#distance-value').textContent=info?`水平间距 ${info.horizontal} px · 垂直间距 ${info.vertical} px · 中心偏移 X ${info.centerDx} / Y ${info.centerDy} px${info.alignment.length?` · ${info.alignment.join('、')}`:''}`:'拖拽框选一个 UI 元素；再框选第二个元素可测量间距和对齐。';
  renderMagnifier(cursor);
}

function applyReference() {
  if(!referenceVisible||!referenceRect){referenceImage.hidden=true;return;}referenceImage.hidden=false;referenceImage.style.left=`${referenceRect.x}px`;referenceImage.style.top=`${referenceRect.y}px`;referenceImage.style.width=`${referenceRect.width*referenceScale}px`;referenceImage.style.height=`${referenceRect.height*referenceScale}px`;referenceImage.style.opacity=String(referenceOpacity);
}

function setMode(next) { mode=next;document.body.classList.toggle('reference-adjust',mode==='reference');$('#measure-mode').classList.toggle('active',mode==='measure');$('#reference-mode').classList.toggle('active',mode==='reference');draw(); }

function reportText() {
  if(!sourceImage)return '屏幕测量画面正在载入。';
  const lines=['【屏幕像素尺检测结果】',`显示器：${payload.displayName}`,`屏幕分辨率：${sourceCanvas.width} × ${sourceCanvas.height} px`];
  selections.forEach((rect,index)=>{const r=sourceRect(rect);lines.push(`区域 ${index+1}：X=${r.x}，Y=${r.y}，W=${r.width}，H=${r.height}`);});
  const info=gapInfo();if(info){lines.push(`水平间距：${info.horizontal} px`,`垂直间距：${info.vertical} px`,`中心点偏移：X=${info.centerDx} px，Y=${info.centerDy} px`);if(info.alignment.length)lines.push(`对齐关系：${info.alignment.join('、')}`);}
  const pixel=pixelAt(cursor);lines.push(`当前取色：${pixel.hex}（RGB ${pixel.rgb.join(', ')}）`,`取色坐标：X=${pixel.source.x}，Y=${pixel.source.y}`,'信息来源：Test cat 屏幕像素尺。');return lines.join('\n');
}

function annotatedImage() {
  if(!sourceImage)throw new Error('屏幕测量画面正在载入。');
  const output=document.createElement('canvas');output.width=sourceCanvas.width;output.height=sourceCanvas.height;const ctx=output.getContext('2d');ctx.drawImage(sourceImage,0,0);
  if(referenceVisible&&referenceRect&&!referenceImage.hidden){ctx.save();ctx.globalAlpha=referenceOpacity;ctx.drawImage(referenceImage,referenceRect.x*scaleX(),referenceRect.y*scaleY(),referenceRect.width*referenceScale*scaleX(),referenceRect.height*referenceScale*scaleY());ctx.restore();}
  selections.forEach((rect,index)=>{const r=sourceRect(rect),color=colors[index%colors.length];ctx.strokeStyle=color;ctx.fillStyle=`${color}22`;ctx.lineWidth=3;ctx.fillRect(r.x,r.y,r.width,r.height);ctx.strokeRect(r.x,r.y,r.width,r.height);const label=`${index+1}  X=${r.x} Y=${r.y}  W=${r.width} H=${r.height}`;ctx.font='bold 22px system-ui';const width=ctx.measureText(label).width+20;const y=Math.max(0,r.y-34);ctx.fillStyle='rgba(8,13,20,.9)';ctx.fillRect(r.x,y,width,30);ctx.fillStyle=color;ctx.fillText(label,r.x+10,y+22);});
  return output.toDataURL('image/png');
}

canvas.addEventListener('pointerdown',(event)=>{cursor={x:event.clientX,y:event.clientY};if(mode==='reference'&&referenceVisible){referenceDrag={x:event.clientX,y:event.clientY,startX:referenceRect.x,startY:referenceRect.y};canvas.setPointerCapture(event.pointerId);return;}if(event.clientY<78)return;if(selections.length>=2)selections=[];dragStart={...cursor};draft={x:cursor.x,y:cursor.y,width:0,height:0};canvas.setPointerCapture(event.pointerId);draw();});
canvas.addEventListener('pointermove',(event)=>{cursor={x:event.clientX,y:event.clientY};if(referenceDrag){referenceRect.x=referenceDrag.startX+event.clientX-referenceDrag.x;referenceRect.y=referenceDrag.startY+event.clientY-referenceDrag.y;applyReference();return;}if(dragStart)draft=normalizedRect(dragStart,cursor);updateInfo();draw();});
canvas.addEventListener('pointerup',(event)=>{if(referenceDrag){referenceDrag=null;return;}if(!dragStart)return;dragStart=null;if(validRect(draft))selections.push(draft);draft=null;updateInfo();draw();try{canvas.releasePointerCapture(event.pointerId);}catch{}});
canvas.addEventListener('wheel',(event)=>{if(mode!=='reference'||!referenceVisible)return;event.preventDefault();referenceScale=clamp(referenceScale*(event.deltaY>0?.94:1.06),.1,5);applyReference();toast(`参考图缩放 ${Math.round(referenceScale*100)}%`);},{passive:false});

$('#measure-mode').onclick=()=>setMode('measure');$('#reference-mode').onclick=()=>setMode('reference');
$('#opacity-range').oninput=(event)=>{referenceOpacity=Number(event.target.value)/100;$('#opacity-value').textContent=`${event.target.value}%`;applyReference();};
$('#ruler-toggle').onclick=(event)=>{showRulers=!showRulers;event.currentTarget.classList.toggle('active',showRulers);draw();};
$('#guide-toggle').onclick=(event)=>{showGuides=!showGuides;event.currentTarget.classList.toggle('active',showGuides);draw();};
$('#magnifier-toggle').onclick=(event)=>{showMagnifier=!showMagnifier;event.currentTarget.classList.toggle('active',showMagnifier);updateInfo();};
$('#clear-button').onclick=()=>{selections=[];draft=null;draw();updateInfo();};
$('#copy-button').onclick=async()=>{await api.copyText(reportText());toast('检测结果已复制');};
$('#copy-image-button').onclick=async()=>{await api.copyImage(annotatedImage());toast('标注截图已复制');};
$('#save-button').onclick=async()=>{const result=await api.saveImage(annotatedImage());if(!result?.canceled)toast('标注截图已保存');};
$('#exit-button').onclick=()=>api.stop();
$('#blink-button').onclick=(event)=>{if(blinkTimer){clearInterval(blinkTimer);blinkTimer=null;referenceImage.style.opacity=String(referenceOpacity);event.currentTarget.classList.remove('active');return;}event.currentTarget.classList.add('active');let visible=true;blinkTimer=setInterval(()=>{visible=!visible;referenceImage.style.opacity=visible?String(referenceOpacity):'0';},420);};
addEventListener('keydown',(event)=>{if(event.key==='Escape')api.stop();if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='c'){event.preventDefault();api.copyText(reportText()).then(()=>toast('检测结果已复制'));}});
addEventListener('resize',resizeCanvas);

(async()=>{
  if(!api)return;
  payload=await api.getPayload(payloadId);$('#display-name').textContent=`${payload.displayName} · ${payload.screenPixelSize.width} × ${payload.screenPixelSize.height}`;
  showRulers=payload.settings?.showRulers!==false;showGuides=payload.settings?.showGuides!==false;showMagnifier=payload.settings?.showMagnifier!==false;referenceOpacity=(payload.settings?.overlayOpacity??45)/100;
  $('#ruler-toggle').classList.toggle('active',showRulers);$('#guide-toggle').classList.toggle('active',showGuides);$('#magnifier-toggle').classList.toggle('active',showMagnifier);$('#opacity-range').value=String(Math.round(referenceOpacity*100));$('#opacity-value').textContent=`${Math.round(referenceOpacity*100)}%`;
  sourceImage=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=payload.imageDataUrl;});screenImage.src=payload.imageDataUrl;sourceCanvas.width=sourceImage.naturalWidth;sourceCanvas.height=sourceImage.naturalHeight;sourceContext.drawImage(sourceImage,0,0);
  if(payload.referenceDataUrl){await new Promise((resolve,reject)=>{referenceImage.onload=resolve;referenceImage.onerror=reject;referenceImage.src=payload.referenceDataUrl;});const fit=Math.min(innerWidth*.82/referenceImage.naturalWidth,innerHeight*.78/referenceImage.naturalHeight,1);referenceRect={width:referenceImage.naturalWidth*fit,height:referenceImage.naturalHeight*fit,x:(innerWidth-referenceImage.naturalWidth*fit)/2,y:(innerHeight-referenceImage.naturalHeight*fit)/2};referenceVisible=true;referenceImage.hidden=false;$('#reference-mode').disabled=false;$('#blink-button').disabled=false;$('#opacity-range').disabled=false;applyReference();}
  resizeCanvas();updateInfo();
})().catch((error)=>{
  const message=error?.message||'屏幕测量初始化失败';
  console.error('[pixel-ruler] initialization failed',error);
  toast(message);
  $('#display-name').textContent=`初始化失败：${message}`;
});
