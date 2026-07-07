const api = window.testCat?.companionPet;

const pet = document.querySelector('#pet-hitbox');
const sprite = document.querySelector('#salary-cat-sprite');
const speech = document.querySelector('#speech-card');
const speechTitle = document.querySelector('#speech-title');
const speechMessage = document.querySelector('#speech-message');
const hideButton = document.querySelector('#hide-button');

const DEFAULT_PET = Object.freeze({
  id: 'yuexinmiao',
  name: '月薪喵',
  frameBase: '../../assets/companion-pet/yuexinmiao/dance-',
  frameCount: 17
});

const idleLines = [
  '月薪喵今日工位：你的桌面左下角。',
  '老板画饼，我跳舞。',
  '正在假装上班，其实在守护你。',
  '你敲键盘，我负责扭扭。',
  '今天也要一起摸鱼，一起努力。',
  '月薪喵已经把烦恼踢到桌子底下了。'
];

const petLines = [
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
];

const danceLines = [
  '月薪喵开始扭扭舞。',
  '左扭右扭，烦恼没有。',
  '工资没涨，舞步先涨。',
  '今日舞蹈 BGM：喵喵喵喵喵。'
];

let speechTimer = null;
let idleTimer = null;
let happyTimer = null;
let remindingTimer = null;
let danceStopTimer = null;
let frameTimer = null;
let frameIndex = 0;
let pointerState = null;
let suppressNextClick = false;
let dragMovePending = false;
let lastDragPoint = null;
let activePet = DEFAULT_PET;
let framePaths = [];

function setFrame(index) {
  if (!framePaths.length) buildFramePaths(activePet);
  frameIndex = ((index % framePaths.length) + framePaths.length) % framePaths.length;
  sprite.src = framePaths[frameIndex];
}

function buildFramePaths(petDefinition = DEFAULT_PET) {
  const frameBase = petDefinition.frameBase || DEFAULT_PET.frameBase;
  const frameCount = Math.max(1, Number(petDefinition.frameCount || DEFAULT_PET.frameCount));
  framePaths = Array.from({ length: frameCount }, (_, index) => {
    return frameBase + String(index).padStart(2, '0') + '.png';
  });
  framePaths.forEach((src) => {
    const image = new Image();
    image.src = src;
  });
}

function applyPetDefinition(petDefinition = DEFAULT_PET) {
  activePet = { ...DEFAULT_PET, ...(petDefinition || {}) };
  sprite.alt = activePet.name || DEFAULT_PET.name;
  buildFramePaths(activePet);
  setFrame(0);
}

function stopDance() {
  clearInterval(frameTimer);
  frameTimer = null;
  pet.classList.remove('dancing', 'crawling');
  setFrame(0);
}

function dance(duration = 4200, fps = 14) {
  clearTimeout(danceStopTimer);
  clearInterval(frameTimer);
  pet.classList.remove('crawling');
  pet.classList.add('dancing');
  frameTimer = setInterval(() => setFrame(frameIndex + 1), Math.max(40, Math.round(1000 / fps)));
  danceStopTimer = setTimeout(stopDance, duration);
}

function crawl(duration = 4200) {
  clearTimeout(danceStopTimer);
  clearInterval(frameTimer);
  pet.classList.remove('dancing');
  pet.classList.add('crawling');
  frameTimer = setInterval(() => {
    const nextFrame = frameIndex + (frameIndex % 2 === 0 ? 1 : 2);
    setFrame(nextFrame);
  }, 210);
  danceStopTimer = setTimeout(stopDance, duration);
}

function say(title, message, duration = 5200) {
  clearTimeout(speechTimer);
  speechTitle.textContent = title || activePet.name || DEFAULT_PET.name;
  speechMessage.textContent = message || '';
  speech.classList.add('show');
  speechTimer = setTimeout(() => speech.classList.remove('show'), duration);
}

function pick(lines) {
  return lines[Math.floor(Math.random() * lines.length)];
}

function becomeHappy() {
  clearTimeout(happyTimer);
  pet.classList.add('happy');
  happyTimer = setTimeout(() => pet.classList.remove('happy'), 1200);
}

function startIdleChatter() {
  clearInterval(idleTimer);
  idleTimer = setInterval(() => {
    if (Math.random() < 0.55) say(activePet.name, pick(idleLines), 4200);
  }, 42000);
}

pet.addEventListener('click', () => {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }
  becomeHappy();
  dance(3600);
  const line = Math.random() < 0.24 ? pick(danceLines) : pick(petLines);
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
    stopDance();
    pet.classList.remove('happy', 'reminding', 'walking', 'crawling', 'dancing');
    pet.classList.add('dragging');
    say(activePet.name, '被拎起来了，爪爪离地中。', 3000);
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
  crawl(durationMs > 0 ? durationMs : 3200);
  if (durationMs > 0) {
    setTimeout(() => pet.classList.remove('walking'), durationMs + 120);
  }
});

api?.onIdle(() => {
  pet.classList.remove('walking');
  stopDance();
});

api?.onDragState((state = {}) => {
  pet.classList.toggle('dragging', Boolean(state.dragging));
});

api?.onSettingsChanged((snapshot = {}) => {
  if (snapshot.activePet?.id && snapshot.activePet.id !== activePet.id) {
    applyPetDefinition(snapshot.activePet);
  }
});

api?.onReminder((reminder) => {
  clearTimeout(remindingTimer);
  pet.classList.add('reminding');
  becomeHappy();
  dance(5200);
  say(reminder.title || '月薪喵提醒', reminder.message || '休息一下吧。', 9000);
  remindingTimer = setTimeout(() => pet.classList.remove('reminding'), 9000);
});

applyPetDefinition(DEFAULT_PET);
api?.getSettings?.().then((snapshot) => {
  if (snapshot?.activePet) applyPetDefinition(snapshot.activePet);
}).catch(() => {});
say(activePet.name, activePet.name + '上线，今天也一起努力。', 5200);
setTimeout(() => dance(3200), 900);
startIdleChatter();
