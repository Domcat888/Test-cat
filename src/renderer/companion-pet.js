const api = window.testCat?.companionPet;

const stage = document.querySelector('.pet-stage');
const pet = document.querySelector('#pet-hitbox');
const sprite = document.querySelector('#salary-cat-sprite');
const speech = document.querySelector('#speech-card');
const speechTitle = document.querySelector('#speech-title');
const speechMessage = document.querySelector('#speech-message');
const hideButton = document.querySelector('#hide-button');

const DEFAULT_PET = Object.freeze({
  id: 'yuexinmiao',
  name: '月薪喵',
  title: '月薪喵 - Test cat',
  frameBase: '../../assets/companion-pet/yuexinmiao/dance-',
  frameCount: 17,
  frameExtension: 'png',
  actions: Object.freeze({
    idle: Object.freeze({ frameBase: '../../assets/companion-pet/yuexinmiao/dance-', frameCount: 17, extension: 'png', fps: 6 }),
    walk: Object.freeze({ frameBase: '../../assets/companion-pet/yuexinmiao/dance-', frameCount: 17, extension: 'png', fps: 5 }),
    touch: Object.freeze({ frameBase: '../../assets/companion-pet/yuexinmiao/dance-', frameCount: 17, extension: 'png', fps: 12 }),
    drag: Object.freeze({ frameBase: '../../assets/companion-pet/yuexinmiao/dance-', frameCount: 17, extension: 'png', fps: 5 }),
    dance: Object.freeze({ frameBase: '../../assets/companion-pet/yuexinmiao/dance-', frameCount: 17, extension: 'png', fps: 14 }),
    reminder: Object.freeze({ frameBase: '../../assets/companion-pet/yuexinmiao/dance-', frameCount: 17, extension: 'png', fps: 12 })
  })
});

const DEFAULT_LINES = Object.freeze({
  idle: Object.freeze([
    '月薪喵今日工位：你的桌面左下角。',
    '老板画饼，我跳舞。',
    '正在假装上班，其实在守护你。',
    '你敲键盘，我负责扭扭。',
    '今天也要一起摸鱼，一起努力。',
    '月薪喵已经把烦恼踢到桌子底下了。'
  ]),
  touch: Object.freeze([
    '摸摸收到，月薪自动加一袋小鱼干。',
    '我真的特别爱你，为什么你会流泪',
    '别难过，月薪喵给你跳一段。',
    '你一摸我，我就觉得今天还能再撑撑。',
    '报告老板：这个人类今天也很可爱。',
    '摸鱼可以，别忘了喝水，不然月薪喵会担心。',
    '加班退退退，快乐进进进。',
    '你负责发光，我负责在旁边喵喵鼓掌。',
    '今天的 KPI：让你笑一下。完成了吗？',
    '如果世界太吵，先看月薪喵扭两秒。'
  ]),
  dance: Object.freeze([
    '月薪喵开始扭扭舞。',
    '左扭右扭，烦恼没有。',
    '工资没涨，舞步先涨。',
    '今日舞蹈 BGM：喵喵喵喵喵。'
  ]),
  drag: Object.freeze([
    '被拎起来了，爪爪离地中。',
    '老板轻点，我只是个小猫员工。',
    '空中办公申请通过。'
  ]),
  online: Object.freeze([
    '月薪喵上线，今天也一起努力。'
  ])
});

let speechTimer = null;
let idleTimer = null;
let happyTimer = null;
let remindingTimer = null;
let actionStopTimer = null;
let frameTimer = null;
let frameIndex = 0;
let pointerState = null;
let suppressNextClick = false;
let dragMovePending = false;
let lastDragPoint = null;
let activePet = DEFAULT_PET;
let currentAction = 'idle';
let currentActionConfig = null;
let currentFramePaths = [];
let actionFrameCache = new Map();

function pick(lines) {
  return lines[Math.floor(Math.random() * lines.length)];
}

function actionConfig(actionName) {
  const actions = activePet.actions || {};
  return actions[actionName] || actions.reminder || actions.dance || actions.idle || {
    frameBase: activePet.frameBase || DEFAULT_PET.frameBase,
    frameCount: activePet.frameCount || DEFAULT_PET.frameCount,
    extension: activePet.frameExtension || DEFAULT_PET.frameExtension
  };
}

function actionVariants(config = {}) {
  return Array.isArray(config.variants) ? config.variants.filter(Boolean) : [];
}

function chooseActionConfig(actionName) {
  const baseConfig = actionConfig(actionName);
  const variants = actionVariants(baseConfig);
  if (!variants.length) return baseConfig;
  return { ...baseConfig, ...pick(variants), variants: undefined };
}

function actionConfigCacheKey(actionName, config = {}) {
  if (config.id) return activePet.id + ':' + actionName + ':' + config.id;
  if (Array.isArray(config.frames)) return activePet.id + ':' + actionName + ':' + config.frames.join('|');
  return [
    activePet.id,
    actionName,
    config.frameBase || activePet.frameBase || DEFAULT_PET.frameBase,
    config.frameCount || activePet.frameCount || DEFAULT_PET.frameCount,
    config.extension || activePet.frameExtension || DEFAULT_PET.frameExtension || 'png',
    config.pad || 2
  ].join(':');
}

function framesFromActionConfig(actionName, config = actionConfig(actionName)) {
  const cacheKey = actionConfigCacheKey(actionName, config);
  if (actionFrameCache.has(cacheKey)) return actionFrameCache.get(cacheKey);

  let frames = [];
  if (Array.isArray(config.frames) && config.frames.length) {
    frames = config.frames.map(String);
  } else {
    const frameBase = config.frameBase || activePet.frameBase || DEFAULT_PET.frameBase;
    const frameCount = Math.max(1, Number(config.frameCount || activePet.frameCount || DEFAULT_PET.frameCount));
    const pad = Math.max(1, Number(config.pad || 2));
    const extension = config.extension || activePet.frameExtension || DEFAULT_PET.frameExtension || 'png';
    frames = Array.from({ length: frameCount }, (_, index) => {
      return frameBase + String(index).padStart(pad, '0') + '.' + extension;
    });
  }

  actionFrameCache.set(cacheKey, frames);
  return frames;
}

function preloadPetFrames() {
  const actionNames = Object.keys(activePet.actions || {});
  const uniqueFrames = new Set();
  for (const actionName of actionNames.length ? actionNames : ['idle', 'walk', 'touch', 'drag', 'dance', 'reminder']) {
    const config = actionConfig(actionName);
    const variants = actionVariants(config);
    const configs = variants.length ? variants : [config];
    configs.forEach((item) => framesFromActionConfig(actionName, item).forEach((src) => uniqueFrames.add(src)));
  }
  uniqueFrames.forEach((src) => {
    const image = new Image();
    image.src = src;
  });
}

function setFrame(index) {
  if (!currentFramePaths.length) currentFramePaths = framesFromActionConfig(currentAction, currentActionConfig || actionConfig(currentAction));
  frameIndex = ((index % currentFramePaths.length) + currentFramePaths.length) % currentFramePaths.length;
  sprite.src = currentFramePaths[frameIndex];
}

function setAction(actionName, index = 0) {
  currentAction = actionName;
  currentActionConfig = chooseActionConfig(actionName);
  currentFramePaths = framesFromActionConfig(actionName, currentActionConfig);
  setFrame(index);
}

function lineSet(kind) {
  const petLines = activePet.lines?.[kind];
  if (Array.isArray(petLines) && petLines.length) return petLines;
  return DEFAULT_LINES[kind] || DEFAULT_LINES.touch;
}

function updatePetLabels() {
  const petName = activePet.name || DEFAULT_PET.name;
  document.title = activePet.title || petName + ' - Test cat';
  stage?.setAttribute('aria-label', '陪伴宠物' + petName);
  pet?.setAttribute('aria-label', '摸摸' + petName);
  hideButton.title = '让' + petName + '回窝';
  hideButton.setAttribute('aria-label', '让' + petName + '回窝');
  sprite.alt = petName;
  pet.dataset.petId = activePet.id || DEFAULT_PET.id;
  document.body.dataset.petId = activePet.id || DEFAULT_PET.id;
}

function applyPetDefinition(petDefinition = DEFAULT_PET) {
  activePet = { ...DEFAULT_PET, ...(petDefinition || {}) };
  actionFrameCache = new Map();
  updatePetLabels();
  preloadPetFrames();
  startIdleAction();
}

function clearActionTimers() {
  clearTimeout(actionStopTimer);
  clearInterval(frameTimer);
  actionStopTimer = null;
  frameTimer = null;
}

function clearMotionClasses() {
  pet.classList.remove('dancing', 'crawling', 'dragging');
}

function startIdleAction() {
  clearActionTimers();
  clearMotionClasses();
  setAction('idle', 0);
  if (currentFramePaths.length > 1) {
    frameTimer = setInterval(() => setFrame(frameIndex + 1), Math.max(120, Math.round(1000 / actionFps('idle', 4))));
  }
}

function stopAction() {
  startIdleAction();
}

function actionFps(actionName, fallback = 8) {
  const baseConfig = actionConfig(actionName);
  const config = currentAction === actionName && currentActionConfig ? currentActionConfig : baseConfig;
  const fps = Number(config.fps || baseConfig.fps);
  return Number.isFinite(fps) && fps > 0 ? fps : fallback;
}

function loopAction(actionName, classNames = [], fallbackFps = 8) {
  clearActionTimers();
  clearMotionClasses();
  setAction(actionName, 0);
  classNames.forEach((className) => pet.classList.add(className));
  if (currentFramePaths.length <= 1) return;
  frameTimer = setInterval(() => setFrame(frameIndex + 1), Math.max(60, Math.round(1000 / actionFps(actionName, fallbackFps))));
}

function playAction(actionName, duration = 3600, classNames = [], fallbackFps = 8) {
  loopAction(actionName, classNames, fallbackFps);
  actionStopTimer = setTimeout(stopAction, duration);
}

function dance(duration = 4200) {
  pet.classList.remove('walking');
  playAction('dance', duration, ['dancing'], 12);
}

function touch(duration = 3000) {
  pet.classList.remove('walking');
  playAction('touch', duration, ['dancing'], 8);
}

function crawl(duration = 4200) {
  playAction('walk', duration, ['crawling'], 5);
}

function say(title, message, duration = 5200) {
  clearTimeout(speechTimer);
  speechTitle.textContent = title || activePet.name || DEFAULT_PET.name;
  speechMessage.textContent = message || '';
  speech.classList.add('show');
  speechTimer = setTimeout(() => speech.classList.remove('show'), duration);
}

function becomeHappy() {
  clearTimeout(happyTimer);
  pet.classList.add('happy');
  happyTimer = setTimeout(() => pet.classList.remove('happy'), 1200);
}

function startIdleChatter() {
  clearInterval(idleTimer);
  idleTimer = setInterval(() => {
    if (Math.random() < 0.55) say(activePet.name, pick(lineSet('idle')), 4200);
  }, 42000);
}

function greetActivePet() {
  const line = pick(lineSet('online')) || (activePet.name + '上线，今天也一起努力。');
  say(activePet.name, line, 5200);
  setTimeout(() => dance(3200), 900);
}

pet.addEventListener('click', () => {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }
  becomeHappy();
  const shouldDance = Math.random() < 0.34;
  if (shouldDance) dance(3600);
  else touch(3000);
  const line = shouldDance ? pick(lineSet('dance')) : pick(lineSet('touch'));
  say(activePet.name, line, line.length > 20 ? 6800 : 4600);
});

function eventPoint(event) {
  return { x: Math.round(event.screenX), y: Math.round(event.screenY) };
}

pet.addEventListener('pointerdown', async (event) => {
  if (event.button !== 0) return;
  pointerState = {
    pointerId: event.pointerId,
    startX: event.screenX,
    startY: event.screenY,
    dragging: false
  };
  pet.setPointerCapture?.(event.pointerId);
});

pet.addEventListener('pointermove', async (event) => {
  if (!pointerState || pointerState.pointerId !== event.pointerId) return;
  const distance = Math.hypot(event.screenX - pointerState.startX, event.screenY - pointerState.startY);
  if (!pointerState.dragging && distance < 5) return;
  if (!pointerState.dragging) {
    pointerState.dragging = true;
    suppressNextClick = true;
    pet.classList.remove('happy', 'reminding', 'walking');
    loopAction('drag', ['dragging'], 3);
    say(activePet.name, pick(lineSet('drag')), 3000);
    await api?.dragStart(eventPoint(event));
  }
  event.preventDefault();
  lastDragPoint = eventPoint(event);
  if (dragMovePending) return;
  dragMovePending = true;
  requestAnimationFrame(async () => {
    dragMovePending = false;
    if (lastDragPoint) await api?.dragMove(lastDragPoint);
  });
});

async function finishPointerDrag(event) {
  if (!pointerState || pointerState.pointerId !== event.pointerId) return;
  pet.releasePointerCapture?.(event.pointerId);
  if (pointerState.dragging) {
    suppressNextClick = true;
    pet.classList.remove('dragging');
    becomeHappy();
    dragMovePending = false;
    lastDragPoint = null;
    await api?.dragEnd();
  }
  pointerState = null;
}

pet.addEventListener('pointerup', finishPointerDrag);
pet.addEventListener('pointercancel', finishPointerDrag);

hideButton.addEventListener('click', async (event) => {
  event.stopPropagation();
  try {
    await api?.hideNow();
  } catch {
    say(activePet.name, '回窝路线堵车了，我再试试看。', 3600);
  }
});

api?.onWalk(({ direction, durationMs } = {}) => {
  pet.classList.toggle('pet-left', direction === 'left');
  pet.classList.add('walking');
  const walkDuration = durationMs > 0 ? durationMs : 3200;
  crawl(walkDuration);
  setTimeout(() => pet.classList.remove('walking'), walkDuration + 120);
});

api?.onIdle(() => {
  pet.classList.remove('walking');
  stopAction();
});

api?.onDragState((state = {}) => {
  if (state.dragging) loopAction('drag', ['dragging'], 3);
  else {
    pet.classList.remove('dragging');
    stopAction();
  }
});

api?.onSettingsChanged((snapshot = {}) => {
  if (snapshot.activePet?.id && snapshot.activePet.id !== activePet.id) {
    applyPetDefinition(snapshot.activePet);
    say(activePet.name, pick(lineSet('online')), 4200);
  }
});

api?.onReminder((reminder = {}) => {
  clearTimeout(remindingTimer);
  pet.classList.remove('walking');
  pet.classList.add('reminding');
  becomeHappy();
  const actionName = reminder.type === 'water' ? 'reminderWater' : reminder.type === 'stand' ? 'reminderStand' : 'reminder';
  playAction(actionName, 5200, ['dancing'], 8);
  say(reminder.title || activePet.name + '提醒', reminder.message || '休息一下吧。', 9000);
  remindingTimer = setTimeout(() => pet.classList.remove('reminding'), 9000);
});

applyPetDefinition(DEFAULT_PET);
api?.getSettings?.().then((snapshot) => {
  if (snapshot?.activePet) applyPetDefinition(snapshot.activePet);
  greetActivePet();
}).catch(() => {
  greetActivePet();
});
startIdleChatter();
