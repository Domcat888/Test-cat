const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const {
  app,
  BrowserWindow,
  Menu,
  MessageChannelMain,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  shell
} = require('electron');
const { MobileMirrorService } = require('./mobile-mirror-service');
const { IosMirrorService } = require('./ios-mirror-service');
const { IosPerformanceService } = require('./ios-performance-service');
const { IosPerformanceHistory } = require('./ios-performance-history');
const { PerformanceMonitorService } = require('./performance-monitor-service');
const { PerformanceMonitorHistory } = require('./performance-monitor-history');
const { createPerformanceComparisonWorkbook, createPerformanceWorkbook } = require('./android-performance-xlsx');
const { WeakNetworkService } = require('./weak-network-service');
const { FileCompareService } = require('./file-compare-service');
const { LogAnalysisService } = require('./log-analysis-service');
const { AppPackageService } = require('./app-package-service');
const { AiTestAssistantService } = require('./ai-test-assistant-service');

const isMac = process.platform === 'darwin';
let mainWindow = null;
let mobileMirrorWindow = null;
let iosMirrorWindow = null;
let iosPerformanceWindow = null;
let calculatorWindow = null;
let performanceMonitorWindow = null;
let weakNetworkWindow = null;
let fileCompareWindow = null;
let logAnalysisWindow = null;
let appPackageWindow = null;
let mockDataWindow = null;
let timestampConverterWindow = null;
let formulaCalculatorWindow = null;
let aiTestAssistantWindow = null;
let companionPetWindow = null;
let recorderWindow = null;
let recordingBorderWindow = null;
let capturePreviewWindow = null;
let mobileMirrorService = null;
let iosMirrorService = null;
let iosPerformanceService = null;
let iosPerformanceHistory = null;
let performanceMonitorService = null;
let performanceMonitorHistory = null;
let weakNetworkService = null;
let fileCompareService = null;
let logAnalysisService = null;
let appPackageService = null;
let aiTestAssistantService = null;
let ipcReady = false;
let quitCleanupStarted = false;
let quitCleanupFinished = false;
let captureSettings = null;
let captureShortcutStatus = { enabled: true, screenshot: null, recorder: null };
let activeCaptureShortcuts = [];
let companionPetSettings = null;
let aiSettings = null;
let companionPetWalkTimer = null;
let companionPetAnimationTimer = null;
let companionPetDragState = null;
const companionPetReminderTimers = new Map();
const selectionWindows = new Map();
const capturePayloads = new Map();

const DEFAULT_CAPTURE_SETTINGS = Object.freeze({
  enabled: true,
  screenshotShortcut: 'Alt+Shift+S',
  recorderShortcut: 'Alt+Shift+R',
  screenshotAction: 'toolbar'
});

const DEFAULT_COMPANION_PET_SETTINGS = Object.freeze({
  activePetId: 'yuexinmiao',
  enabled: true,
  movementEnabled: true,
  walkIntervalSeconds: 24,
  waterReminderEnabled: true,
  waterReminderMinutes: 30,
  standReminderEnabled: true,
  standReminderMinutes: 45
});

const DEFAULT_AI_SETTINGS = Object.freeze({
  enabled: true,
  baseUrl: '',
  model: '',
  apiKey: '',
  temperature: 0.2,
  testCasePrompt: '',
  locked: false
});

const COMPANION_PETS = Object.freeze({
  yuexinmiao: Object.freeze({
    id: 'yuexinmiao',
    name: '月薪喵',
    description: '从录屏里提取的月薪喵，会在桌面随机移动、跳舞，并提醒你喝水、站起来活动。',
    title: '月薪喵 - Test cat',
    frameBase: '../../assets/companion-pet/yuexinmiao/dance-',
    frameCount: 17,
    actions: Object.freeze({
      idle: Object.freeze({
        fps: 5,
        variants: Object.freeze([
          Object.freeze({ id: 'classic', frameBase: '../../assets/companion-pet/yuexinmiao/dance-', frameCount: 17, extension: 'png' }),
          Object.freeze({ id: 'work', frameBase: '../../assets/companion-pet/yuexinmiao/recording-20260708/work/work-', frameCount: 5, extension: 'png' }),
          Object.freeze({ id: 'shy', frameBase: '../../assets/companion-pet/yuexinmiao/recording-20260708/shy/shy-', frameCount: 2, extension: 'png' }),
          Object.freeze({ id: 'headphones', frameBase: '../../assets/companion-pet/yuexinmiao/recording-20260708/headphones/headphones-', frameCount: 8, extension: 'png' })
        ])
      }),
      walk: Object.freeze({
        fps: 5,
        variants: Object.freeze([
          Object.freeze({ id: 'small-walk', frameBase: '../../assets/companion-pet/yuexinmiao/recording-20260708/walk/walk-', frameCount: 8, extension: 'png' }),
          Object.freeze({ id: 'classic', frameBase: '../../assets/companion-pet/yuexinmiao/dance-', frameCount: 17, extension: 'png' })
        ])
      }),
      touch: Object.freeze({
        fps: 8,
        variants: Object.freeze([
          Object.freeze({ id: 'love', frameBase: '../../assets/companion-pet/yuexinmiao/recording-20260708/love/love-', frameCount: 8, extension: 'png' }),
          Object.freeze({ id: 'loveburst', frameBase: '../../assets/companion-pet/yuexinmiao/recording-20260708/loveburst/loveburst-', frameCount: 9, extension: 'png' }),
          Object.freeze({ id: 'shy', frameBase: '../../assets/companion-pet/yuexinmiao/recording-20260708/shy/shy-', frameCount: 2, extension: 'png' }),
          Object.freeze({ id: 'wave', frameBase: '../../assets/companion-pet/yuexinmiao/recording-20260708/wave/wave-', frameCount: 3, extension: 'png' }),
          Object.freeze({ id: 'classic', frameBase: '../../assets/companion-pet/yuexinmiao/dance-', frameCount: 17, extension: 'png' })
        ])
      }),
      drag: Object.freeze({
        fps: 5,
        variants: Object.freeze([
          Object.freeze({ id: 'angry', frameBase: '../../assets/companion-pet/yuexinmiao/recording-20260708/angry/angry-', frameCount: 4, extension: 'png' }),
          Object.freeze({ id: 'cool', frameBase: '../../assets/companion-pet/yuexinmiao/recording-20260708/cool/cool-', frameCount: 3, extension: 'png' }),
          Object.freeze({ id: 'classic', frameBase: '../../assets/companion-pet/yuexinmiao/dance-', frameCount: 17, extension: 'png' })
        ])
      }),
      dance: Object.freeze({
        fps: 12,
        variants: Object.freeze([
          Object.freeze({ id: 'classic', frameBase: '../../assets/companion-pet/yuexinmiao/dance-', frameCount: 17, extension: 'png' }),
          Object.freeze({ id: 'boss', frameBase: '../../assets/companion-pet/yuexinmiao/recording-20260708/boss/boss-', frameCount: 5, extension: 'png' }),
          Object.freeze({ id: 'stand', frameBase: '../../assets/companion-pet/yuexinmiao/recording-20260708/stand/stand-', frameCount: 3, extension: 'png' }),
          Object.freeze({ id: 'wave', frameBase: '../../assets/companion-pet/yuexinmiao/recording-20260708/wave/wave-', frameCount: 3, extension: 'png' }),
          Object.freeze({ id: 'cool', frameBase: '../../assets/companion-pet/yuexinmiao/recording-20260708/cool/cool-', frameCount: 3, extension: 'png' })
        ])
      }),
      reminder: Object.freeze({
        fps: 8,
        variants: Object.freeze([
          Object.freeze({ id: 'work', frameBase: '../../assets/companion-pet/yuexinmiao/recording-20260708/work/work-', frameCount: 5, extension: 'png' }),
          Object.freeze({ id: 'headphones', frameBase: '../../assets/companion-pet/yuexinmiao/recording-20260708/headphones/headphones-', frameCount: 8, extension: 'png' }),
          Object.freeze({ id: 'stand', frameBase: '../../assets/companion-pet/yuexinmiao/recording-20260708/stand/stand-', frameCount: 3, extension: 'png' })
        ])
      }),
      reminderWater: Object.freeze({
        fps: 7,
        variants: Object.freeze([
          Object.freeze({ id: 'wave', frameBase: '../../assets/companion-pet/yuexinmiao/recording-20260708/wave/wave-', frameCount: 3, extension: 'png' }),
          Object.freeze({ id: 'love', frameBase: '../../assets/companion-pet/yuexinmiao/recording-20260708/love/love-', frameCount: 8, extension: 'png' })
        ])
      }),
      reminderStand: Object.freeze({
        fps: 6,
        variants: Object.freeze([
          Object.freeze({ id: 'stand', frameBase: '../../assets/companion-pet/yuexinmiao/recording-20260708/stand/stand-', frameCount: 3, extension: 'png' }),
          Object.freeze({ id: 'small-walk', frameBase: '../../assets/companion-pet/yuexinmiao/recording-20260708/walk/walk-', frameCount: 8, extension: 'png' })
        ])
      })
    }),
    lines: Object.freeze({
      idle: Object.freeze([
        '月薪喵今日工位：你的桌面左下角。',
        '老板画饼，我跳舞。',
        '正在假装上班，其实在守护你。',
        '你敲键盘，我负责扭扭。',
        '今天也要一起摸鱼，一起努力。',
        '月薪喵已经把烦恼踢到桌子底下了。',
        '我没有偷懒，我是在进行桌面压力测试。',
        '键盘声很安心，像下小鱼干雨。',
        '今天的能量条还没空，先别急着投降。',
        '我在旁边站岗，坏心情禁止入内。',
        '如果你卡住了，先摸一下猫再继续。',
        '月薪喵巡逻中：水杯、肩膀、心情，都要检查。',
        '工位天气：适合慢慢做，适合偷偷笑。',
        '我刚刚把焦虑咬了一口，味道一般。',
        '你认真起来的时候，桌面都会变亮一点。',
        '不要和 bug 生气，bug 没有猫可爱。',
        '月薪喵低电量模式：趴着也要陪你。',
        '今天可以只前进一点点，也算数。',
        '如果没人夸你，我先夸：你真的撑得很好。',
        '我在等你忙完，然后奖励你一个喵喵点头。',
        '别怕，我是桌面小保安。',
        '月薪喵观察报告：这个人类需要一点温柔。',
        '我把自己放在这里，防止你忘记休息。',
        '工作可以慢，饭要好好吃。',
        '老板不在的时候，我就是老板。',
        '正在监听摸摸信号，随时待命。',
        '今天的坏运气已经被我踩扁了。',
        '我陪你熬，但我更想陪你早点收工。',
        '你做你的事，我负责把桌面变可爱。'
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
        '如果世界太吵，先看月薪喵扭两秒。',
        '摸摸可以续命，已为你续上三分钟勇气。',
        '你刚才摸到的是月薪喵的隐藏温柔开关。',
        '喵喵确认：你今天也值得被喜欢。',
        '别皱眉啦，月薪喵会以可爱之名制裁烦恼。',
        '收到摸摸，正在发放精神小鱼干。',
        '你摸我一下，我替你骂一下需求。',
        '好啦好啦，今天辛苦的人类，抱抱。',
        '我不懂绩效，但我懂你已经很努力了。',
        '压力过大时请反复点击本猫。',
        '猫猫电台提示：你不是机器，你可以休息。',
        '我把小爪子放在这里，给你盖一个安心章。',
        '不开心也没关系，不用马上变好。',
        '月薪喵批准你短暂摆烂三十秒。',
        '你是很珍贵的人类，不是待办事项集合。',
        '如果今天没人站你这边，猫站。',
        '摸摸触发彩蛋：你会越来越顺。',
        '我听见你的心里有点累，所以我来了。',
        '把难过给我，我拿去换小鱼干。',
        '你负责活着，我负责可爱地陪着。',
        '别把自己逼太紧，猫猫看了会心疼。',
        '现在开始，坏情绪由月薪喵临时托管。',
        '你已经做得很好啦，真的。',
        '如果你想哭，月薪喵就在这里。',
        '你一摸我，我就想把世界调低音量。',
        '今日份摸摸已入账，利息是好运。',
        '别怕慢，慢慢来也会到。',
        '我在，我在，我真的在。',
        '你不是一个人在和生活对线。',
        '月薪喵给你一个不需要解释的抱抱。',
        '好了，摸完猫，我们再轻轻往前走一点。'
      ]),
      dance: Object.freeze([
        '月薪喵开始扭扭舞。',
        '左扭右扭，烦恼没有。',
        '工资没涨，舞步先涨。',
        '今日舞蹈 BGM：喵喵喵喵喵。',
        '跳一段，给你的努力配个特效。',
        '月薪喵宣布：现在进入快乐加载动画。',
        '别问为什么跳舞，问就是精神股价上涨。',
        '扭两下，今天的晦气就被甩出屏幕。',
        '猫猫热身结束，准备攻击坏心情。',
        '工作暂停，快乐插播。',
        '月薪喵的舞步没有章法，但有真心。',
        '这是给你的胜利小舞，哪怕只是小胜利。',
        '屏幕太严肃了，我来负责荒谬可爱。',
        '扭一扭，肩膀也跟着松一松。',
        '今日舞蹈主题：活着就很了不起。',
        '我跳得越认真，烦恼越站不稳。',
        '这段舞献给还没放弃的你。',
        '老板不涨薪，猫猫涨气氛。',
        '喵喵舞法：把焦虑摇成碎屑。',
        '如果你笑了，那我就赢了。'
      ]),
      drag: Object.freeze([
        '被拎起来了，爪爪离地中。',
        '老板轻点，我只是个小猫员工。',
        '空中办公申请通过。',
        '这是什么新型团建，猫猫疑惑。',
        '我飞起来了，但工资没有。',
        '轻拿轻放，月薪喵易碎但嘴硬。',
        '别晃啦，我的小鱼干要掉了。',
        '拎猫可以，但要负责哄。',
        '人类，你的拖拽手法很像需求变更。',
        '爪爪离地，尊严暂存。',
        '如果这是升职，请把我放在更舒服的位置。',
        '我被移动了，但我的灵魂还在摸鱼。',
        '拖我可以，别拖项目进度。',
        '正在空中巡查你的桌面。',
        '放下我，我还能继续陪你上班。',
        '已进入猫猫悬浮模式。',
        '月薪喵被拎起来，表情管理失败。',
        '轻点嘛，我会自己走的。',
        '这段路没有报销吗？'
      ]),
      online: Object.freeze([
        '月薪喵上线，今天也一起努力。',
        '工位守护猫到岗。',
        '月薪喵开机：先给你一个好运。',
        '今天也请多指教，人类同事。',
        '我来了，把桌面交给我。',
        '月薪喵上线，坏心情下线。',
        '喵喵打卡成功，陪伴模式启动。',
        '今天我们慢慢来，不急。'
      ])
    }),
    reminders: Object.freeze({
      water: Object.freeze({
        title: '喝水时间到',
        message: '月薪喵扭了两下：喝口水吧，身体也要补蓝量。',
        messages: Object.freeze([
          '月薪喵扭了两下：喝口水吧，身体也要补蓝量。',
          '水杯在等你，不要让它变成摆设。',
          '喝水时间到，猫猫监督，不许赖账。',
          '先喝一口水，再和 bug 决斗。',
          '你的身体发来消息：需要一点水。',
          '月薪喵把水杯推到你面前：续命啦。',
          '喝水不是摸鱼，是系统维护。',
          '不喝水会变成干巴巴打工人，猫猫不允许。'
        ])
      }),
      stand: Object.freeze({
        title: '站起来伸展一下',
        message: '月薪喵开始扭扭：站起来走两步，肩膀和尾巴都松一松。',
        messages: Object.freeze([
          '月薪喵开始扭扭：站起来走两步，肩膀和尾巴都松一松。',
          '起来活动一下，椅子不能一直封印你。',
          '肩膀该解冻了，人类。',
          '站起来伸个懒腰，猫猫给你计时。',
          '先离开椅子十秒，回来再继续战斗。',
          '月薪喵巡查：你的脖子需要重启。',
          '久坐警报响了，起来走走吧。',
          '身体也是项目成员，要维护。'
        ])
      })
    })
  }),
  doro: Object.freeze({
    id: 'doro',
    name: 'Doro',
    description: '来自你这次绿幕素材的 Doro，已去掉绿幕并拆成多组动作，会待机、爬、被摸摸、被拎起来和提醒休息。',
    title: 'Doro - Test cat',
    frameBase: '../../assets/companion-pet/doro/recording-20260708113617/stand/stand-',
    frameCount: 8,
    actions: Object.freeze({
      idle: Object.freeze({
        fps: 5,
        variants: Object.freeze([
          Object.freeze({ id: 'stand', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/stand/stand-', frameCount: 8, extension: 'png' }),
          Object.freeze({ id: 'pillow', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/pillow/pillow-', frameCount: 8, extension: 'png' }),
          Object.freeze({ id: 'close', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/close/close-', frameCount: 8, extension: 'png' }),
          Object.freeze({ id: 'tired', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/tired/tired-', frameCount: 8, extension: 'png' })
        ])
      }),
      walk: Object.freeze({
        fps: 6,
        variants: Object.freeze([
          Object.freeze({ id: 'tiny-walk', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/tiny-walk/tiny-walk-', frameCount: 8, extension: 'png' }),
          Object.freeze({ id: 'crawl', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/crawl/crawl-', frameCount: 8, extension: 'png' }),
          Object.freeze({ id: 'ghost-run', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/ghost-run/ghost-run-', frameCount: 8, extension: 'png' }),
          Object.freeze({ id: 'rocket', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/rocket/rocket-', frameCount: 8, extension: 'png' })
        ])
      }),
      touch: Object.freeze({
        fps: 7,
        variants: Object.freeze([
          Object.freeze({ id: 'pinch', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/pinch/pinch-', frameCount: 8, extension: 'png' }),
          Object.freeze({ id: 'peek', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/peek/peek-', frameCount: 8, extension: 'png' }),
          Object.freeze({ id: 'close', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/close/close-', frameCount: 8, extension: 'png' }),
          Object.freeze({ id: 'pillow', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/pillow/pillow-', frameCount: 8, extension: 'png' })
        ])
      }),
      drag: Object.freeze({
        fps: 7,
        variants: Object.freeze([
          Object.freeze({ id: 'lifted', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/lifted/lifted-', frameCount: 8, extension: 'png' }),
          Object.freeze({ id: 'pinch', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/pinch/pinch-', frameCount: 8, extension: 'png' }),
          Object.freeze({ id: 'rocket', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/rocket/rocket-', frameCount: 8, extension: 'png' })
        ])
      }),
      dance: Object.freeze({
        fps: 8,
        variants: Object.freeze([
          Object.freeze({ id: 'spin', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/spin/spin-', frameCount: 8, extension: 'png' }),
          Object.freeze({ id: 'rocket', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/rocket/rocket-', frameCount: 8, extension: 'png' }),
          Object.freeze({ id: 'ghost-run', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/ghost-run/ghost-run-', frameCount: 8, extension: 'png' }),
          Object.freeze({ id: 'tiny-walk', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/tiny-walk/tiny-walk-', frameCount: 8, extension: 'png' })
        ])
      }),
      reminder: Object.freeze({
        fps: 6,
        variants: Object.freeze([
          Object.freeze({ id: 'work', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/work/work-', frameCount: 8, extension: 'png' }),
          Object.freeze({ id: 'box', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/box/box-', frameCount: 8, extension: 'png' }),
          Object.freeze({ id: 'tired', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/tired/tired-', frameCount: 8, extension: 'png' }),
          Object.freeze({ id: 'sleep', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/sleep/sleep-', frameCount: 10, extension: 'png' })
        ])
      }),
      reminderWater: Object.freeze({
        fps: 6,
        variants: Object.freeze([
          Object.freeze({ id: 'work', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/work/work-', frameCount: 8, extension: 'png' }),
          Object.freeze({ id: 'box', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/box/box-', frameCount: 8, extension: 'png' }),
          Object.freeze({ id: 'sleep', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/sleep/sleep-', frameCount: 10, extension: 'png' })
        ])
      }),
      reminderStand: Object.freeze({
        fps: 6,
        variants: Object.freeze([
          Object.freeze({ id: 'tiny-walk', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/tiny-walk/tiny-walk-', frameCount: 8, extension: 'png' }),
          Object.freeze({ id: 'crawl', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/crawl/crawl-', frameCount: 8, extension: 'png' }),
          Object.freeze({ id: 'spin', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/spin/spin-', frameCount: 8, extension: 'png' }),
          Object.freeze({ id: 'box', frameBase: '../../assets/companion-pet/doro/recording-20260708113617/box/box-', frameCount: 8, extension: 'png' })
        ])
      })
    }),
    lines: Object.freeze({
      idle: Object.freeze([
        'Doro 正在桌面上安静待机。',
        'Doro 看起来很乖，其实脑袋里在开派对。',
        '你忙你的，Doro 负责把屏幕变软一点。',
        'Doro 今天也在认真陪班。',
        '如果你卡住了，先看 Doro 发呆两秒。',
        'Doro 没有催你，Doro 只是路过可爱一下。',
        '桌面风平浪静，Doro 小小营业。',
        'Doro 把坏心情藏到角落里了。'
      ]),
      touch: Object.freeze([
        '摸摸收到，Doro 进入开心模式。',
        '我真的特别爱你，为什么你会流泪',
        '再摸一下，Doro 就要得意了。',
        'Doro 被捏住了，但是 Doro 很坚强。',
        '你摸到的是今日份小小安慰。',
        'Doro 贴过来一点，坏情绪退后。',
        '不要皱眉啦，Doro 会替你凶一下烦恼。',
        '摸摸可以，压力不可以。'
      ]),
      dance: Object.freeze([
        'Doro 开始乱晃，快乐也跟着乱晃。',
        '转一圈，晦气散开。',
        'Doro 的舞步没有逻辑，但很有诚意。',
        '今天的小胜利，值得 Doro 扭一下。',
        '快乐加载中，Doro 正在努力渲染。',
        '如果你笑了，Doro 就算赢。'
      ]),
      drag: Object.freeze([
        'Doro 被拎起来了，表情管理失败。',
        '轻一点，Doro 正在空中营业。',
        '这是搬运服务吗？记得给摸摸好评。',
        'Doro 悬浮中，请稍后。',
        '放下以后要补偿一颗糖。',
        'Doro 被移动到新的风水位。'
      ]),
      online: Object.freeze([
        'Doro 回来了，这次用的是新素材。',
        'Doro 上线，桌面陪伴开始。',
        '今天由 Doro 和月薪喵轮流值班。',
        'Doro 已经准备好在桌面发呆了。'
      ])
    }),
    reminders: Object.freeze({
      water: Object.freeze({
        title: '喝水时间到',
        message: 'Doro 敲敲桌子：喝点水吧，身体也要续航。',
        messages: Object.freeze([
          'Doro 敲敲桌子：喝点水吧，身体也要续航。',
          '水杯不是摆设，Doro 正在认真监督。',
          '喝一口水，再继续和任务对线。',
          'Doro 小声提醒：别把自己熬干啦。'
        ])
      }),
      stand: Object.freeze({
        title: '站起来伸展一下',
        message: 'Doro 开始小跑：站起来活动一下，别被椅子封印。',
        messages: Object.freeze([
          'Doro 开始小跑：站起来活动一下，别被椅子封印。',
          '起来走两步，Doro 给你打气。',
          '肩膀该解冻了，Doro 已经看见了。',
          '先伸个懒腰，再回来继续。'
        ])
      })
    })
  })
});

function captureSettingsPath() {
  return path.join(app.getPath('userData'), 'capture-settings.json');
}

function companionPetSettingsPath() {
  return path.join(app.getPath('userData'), 'companion-pet-settings.json');
}

function aiSettingsPath() {
  return path.join(app.getPath('userData'), 'ai-settings.json');
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function clampFloat(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeAiSettings(value = {}) {
  return {
    enabled: value.enabled !== false,
    baseUrl: String(value.baseUrl || '').trim().replace(/\/+$/, ''),
    model: String(value.model || '').trim(),
    apiKey: String(value.apiKey || '').trim(),
    temperature: clampFloat(value.temperature, DEFAULT_AI_SETTINGS.temperature, 0, 2),
    testCasePrompt: String(value.testCasePrompt || ''),
    locked: value.locked === true
  };
}

function loadAiSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(aiSettingsPath(), 'utf8'));
    return normalizeAiSettings({ ...DEFAULT_AI_SETTINGS, ...parsed });
  } catch {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

async function saveAiSettingsToDisk() {
  await fsp.mkdir(path.dirname(aiSettingsPath()), { recursive: true });
  await fsp.writeFile(aiSettingsPath(), JSON.stringify(aiSettings, null, 2));
}

function aiSettingsSnapshot() {
  const settings = normalizeAiSettings(aiSettings || DEFAULT_AI_SETTINGS);
  return {
    settings,
    ready: Boolean(settings.enabled && settings.baseUrl && settings.model && settings.apiKey),
    missing: [
      settings.enabled ? '' : 'AI 功能已关闭',
      settings.baseUrl ? '' : 'Base URL',
      settings.model ? '' : 'Model',
      settings.apiKey ? '' : 'API Key'
    ].filter(Boolean)
  };
}

function pickCompanionPetText(lines, fallback = '') {
  if (!Array.isArray(lines) || !lines.length) return fallback;
  return lines[Math.floor(Math.random() * lines.length)] || fallback;
}

function normalizeCompanionPetSettings(value = {}) {
  const activePetId = COMPANION_PETS[value.activePetId] ? value.activePetId : DEFAULT_COMPANION_PET_SETTINGS.activePetId;
  return {
    activePetId,
    enabled: value.enabled !== false,
    movementEnabled: value.movementEnabled !== false,
    walkIntervalSeconds: clampNumber(value.walkIntervalSeconds, DEFAULT_COMPANION_PET_SETTINGS.walkIntervalSeconds, 8, 300),
    waterReminderEnabled: value.waterReminderEnabled !== false,
    waterReminderMinutes: clampNumber(value.waterReminderMinutes, DEFAULT_COMPANION_PET_SETTINGS.waterReminderMinutes, 1, 480),
    standReminderEnabled: value.standReminderEnabled !== false,
    standReminderMinutes: clampNumber(value.standReminderMinutes, DEFAULT_COMPANION_PET_SETTINGS.standReminderMinutes, 1, 480)
  };
}

function loadCompanionPetSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(companionPetSettingsPath(), 'utf8'));
    return normalizeCompanionPetSettings({ ...DEFAULT_COMPANION_PET_SETTINGS, ...parsed });
  } catch {
    return { ...DEFAULT_COMPANION_PET_SETTINGS };
  }
}

async function saveCompanionPetSettingsToDisk() {
  await fsp.mkdir(path.dirname(companionPetSettingsPath()), { recursive: true });
  await fsp.writeFile(companionPetSettingsPath(), JSON.stringify(companionPetSettings, null, 2));
}

function normalizeAccelerator(value, fallback) {
  const raw = String(value || '').replace(/[＋﹢]/g, '+').trim();
  const tokens = raw.split('+').map((item) => item.trim()).filter(Boolean);
  const modifierMap = {
    cmd: 'Command',
    command: 'Command',
    meta: 'Command',
    control: 'Ctrl',
    ctrl: 'Ctrl',
    cmdorctrl: 'CommandOrControl',
    commandorcontrol: 'CommandOrControl',
    commandorctrl: 'CommandOrControl',
    option: 'Alt',
    alt: 'Alt',
    shift: 'Shift',
    super: 'Super'
  };
  const keyMap = {
    esc: 'Escape',
    escape: 'Escape',
    space: 'Space',
    tab: 'Tab',
    enter: 'Return',
    return: 'Return',
    backspace: 'Backspace',
    delete: 'Delete',
    del: 'Delete',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right'
  };
  const modifiers = [];
  let key = '';
  for (const token of tokens) {
    const normalized = token.toLowerCase().replace(/[\s_-]/g, '');
    const modifier = modifierMap[normalized];
    if (modifier) {
      if (!modifiers.includes(modifier)) modifiers.push(modifier);
      continue;
    }
    if (!key) {
      if (/^f\d{1,2}$/i.test(token)) key = token.toUpperCase();
      else if (/^[a-z]$/i.test(token)) key = token.toUpperCase();
      else if (/^\d$/.test(token)) key = token;
      else key = keyMap[normalized] || token;
    }
  }
  if (!key || modifiers.length === 0) return fallback;
  return [...modifiers, key].join('+');
}

function normalizeCaptureSettings(value = {}) {
  const action = ['toolbar', 'copy', 'editor', 'pin', 'save'].includes(value.screenshotAction)
    ? value.screenshotAction
    : DEFAULT_CAPTURE_SETTINGS.screenshotAction;
  return {
    enabled: value.enabled !== false,
    screenshotShortcut: normalizeAccelerator(value.screenshotShortcut, DEFAULT_CAPTURE_SETTINGS.screenshotShortcut),
    recorderShortcut: normalizeAccelerator(value.recorderShortcut, DEFAULT_CAPTURE_SETTINGS.recorderShortcut),
    screenshotAction: action
  };
}

function loadCaptureSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(captureSettingsPath(), 'utf8'));
    return normalizeCaptureSettings({ ...DEFAULT_CAPTURE_SETTINGS, ...parsed });
  } catch {
    return { ...DEFAULT_CAPTURE_SETTINGS };
  }
}

async function saveCaptureSettingsToDisk() {
  await fsp.mkdir(path.dirname(captureSettingsPath()), { recursive: true });
  await fsp.writeFile(captureSettingsPath(), JSON.stringify(captureSettings, null, 2));
}

function unregisterCaptureShortcuts() {
  for (const accelerator of activeCaptureShortcuts) {
    try { globalShortcut.unregister(accelerator); } catch {}
  }
  activeCaptureShortcuts = [];
}

function notifyCaptureMessage(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('capture:notice', message);
  }
}

function registerCaptureShortcuts() {
  unregisterCaptureShortcuts();
  const settings = captureSettings || DEFAULT_CAPTURE_SETTINGS;
  const status = {
    enabled: settings.enabled,
    screenshot: { accelerator: settings.screenshotShortcut, registered: false, error: '' },
    recorder: { accelerator: settings.recorderShortcut, registered: false, error: '' }
  };
  if (!settings.enabled) {
    captureShortcutStatus = status;
    return status;
  }

  try {
    status.screenshot.registered = globalShortcut.register(settings.screenshotShortcut, () => {
      createScreenshotSelection().catch((error) => notifyCaptureMessage(error.message || '截图启动失败'));
    });
    if (status.screenshot.registered) activeCaptureShortcuts.push(settings.screenshotShortcut);
    else status.screenshot.error = '快捷键可能已被系统或其他软件占用';
  } catch (error) {
    status.screenshot.error = error.message || '快捷键注册失败';
  }

  if (settings.recorderShortcut === settings.screenshotShortcut) {
    status.recorder.error = '录屏快捷键不能和截图快捷键相同';
  } else {
    try {
      status.recorder.registered = globalShortcut.register(settings.recorderShortcut, () => {
        createRecordingSelection().catch((error) => notifyCaptureMessage(error.message || '录屏启动失败'));
      });
      if (status.recorder.registered) activeCaptureShortcuts.push(settings.recorderShortcut);
      else status.recorder.error = '快捷键可能已被系统或其他软件占用';
    } catch (error) {
      status.recorder.error = error.message || '快捷键注册失败';
    }
  }

  captureShortcutStatus = status;
  return status;
}

function captureSettingsSnapshot() {
  return {
    settings: captureSettings || { ...DEFAULT_CAPTURE_SETTINGS },
    shortcutStatus: captureShortcutStatus
  };
}

function isCaptureFeatureEnabled() {
  return (captureSettings || DEFAULT_CAPTURE_SETTINGS).enabled !== false;
}

function ensureCaptureFeatureEnabled() {
  if (!isCaptureFeatureEnabled()) throw new Error('截图与录屏已关闭，请先到设置中开启');
}

function capturePayloadId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function storeCapturePayload(payload) {
  const id = capturePayloadId();
  capturePayloads.set(id, payload);
  const timer = setTimeout(() => capturePayloads.delete(id), 10 * 60 * 1000);
  timer.unref?.();
  return id;
}

function timestampForFile() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function getKnownPath(name, fallback) {
  try { return app.getPath(name); } catch { return app.getPath(fallback); }
}

function imageFromDataUrl(dataUrl) {
  if (!String(dataUrl || '').startsWith('data:image/')) throw new Error('图片数据无效');
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) throw new Error('图片数据为空，无法处理');
  return image;
}

function closeSelectionWindows() {
  for (const window of selectionWindows.values()) {
    if (window && !window.isDestroyed()) window.close();
  }
  selectionWindows.clear();
}

function closeRecordingBorderWindow() {
  if (recordingBorderWindow && !recordingBorderWindow.isDestroyed()) {
    recordingBorderWindow.close();
  }
  recordingBorderWindow = null;
}

async function saveImageDataUrl(dataUrl, ownerWindow = mainWindow) {
  const image = imageFromDataUrl(dataUrl);
  const defaultPath = path.join(getKnownPath('pictures', 'downloads'), `TestCat_截图_${timestampForFile()}.png`);
  const result = await dialog.showSaveDialog(ownerWindow || undefined, {
    title: '保存截图',
    defaultPath,
    filters: [{ name: 'PNG 图片', extensions: ['png'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const filePath = result.filePath.toLowerCase().endsWith('.png') ? result.filePath : `${result.filePath}.png`;
  await fsp.writeFile(filePath, image.toPNG());
  return { canceled: false, filePath };
}

function normalizeVideoSaveOptions(options = {}) {
  const mimeType = String(options.mimeType || '').toLowerCase();
  const extension = String(options.extension || '').toLowerCase().replace(/^\./, '');
  const inferred = extension || (mimeType.includes('mp4') ? 'mp4' : 'webm');
  const normalizedExtension = inferred === 'mp4' ? 'mp4' : 'webm';
  return {
    extension: normalizedExtension,
    mimeType: normalizedExtension === 'mp4' ? 'video/mp4' : 'video/webm',
    label: normalizedExtension === 'mp4' ? 'MP4 视频' : 'WebM 视频'
  };
}

function withVideoExtension(filePath, extension) {
  const current = path.extname(filePath).toLowerCase();
  if (['.mp4', '.webm'].includes(current)) return filePath;
  return `${filePath}.${extension}`;
}

async function saveVideoBuffer(data, options = {}, ownerWindow = recorderWindow || mainWindow) {
  const bytes = data instanceof ArrayBuffer ? Buffer.from(new Uint8Array(data)) : Buffer.from(data || []);
  if (!bytes.length) throw new Error('录屏数据为空，无法保存');
  const format = normalizeVideoSaveOptions(options);
  const defaultPath = path.join(getKnownPath('videos', 'downloads'), `TestCat_录屏_${timestampForFile()}.${format.extension}`);
  const primaryFilter = { name: format.label, extensions: [format.extension] };
  const secondaryFilter = format.extension === 'mp4'
    ? { name: 'WebM 视频', extensions: ['webm'] }
    : { name: 'MP4 视频', extensions: ['mp4'] };
  const result = await dialog.showSaveDialog(ownerWindow || undefined, {
    title: '保存录屏',
    defaultPath,
    filters: [primaryFilter, secondaryFilter, { name: '所有文件', extensions: ['*'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const filePath = withVideoExtension(result.filePath, format.extension);
  await fsp.writeFile(filePath, bytes);
  return { canceled: false, filePath, format: format.extension, mimeType: format.mimeType };
}

function createPinWindow(dataUrl) {
  const image = imageFromDataUrl(dataUrl);
  const imageSize = image.getSize();
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const scale = Math.min(1, (workArea.width * 0.56) / imageSize.width, (workArea.height * 0.72) / imageSize.height);
  const width = Math.max(260, Math.round(imageSize.width * scale));
  const height = Math.max(180, Math.round(imageSize.height * scale) + 42);
  const payloadId = storeCapturePayload({ type: 'pin', imageDataUrl: dataUrl });
  const window = new BrowserWindow({
    width,
    height,
    minWidth: 180,
    minHeight: 120,
    frame: false,
    resizable: true,
    show: false,
    title: '贴屏截图 - Test cat',
    icon: path.join(__dirname, '../assets/icon.png'),
    alwaysOnTop: true,
    backgroundColor: '#111923',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.setAlwaysOnTop(true, isMac ? 'floating' : 'normal');
  window.loadFile(path.join(__dirname, 'renderer/capture-pin.html'), { query: { id: payloadId } });
  window.once('ready-to-show', () => window.show());
  configureWindow(window);
  return window;
}

function createCaptureEditorWindow(dataUrl) {
  imageFromDataUrl(dataUrl);
  const payloadId = storeCapturePayload({ type: 'editor', imageDataUrl: dataUrl });
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    show: false,
    title: '截图编辑 - Test cat',
    icon: path.join(__dirname, '../assets/icon.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#101720',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.loadFile(path.join(__dirname, 'renderer/capture-editor.html'), { query: { id: payloadId } });
  window.once('ready-to-show', () => {
    window.show();
    if (process.argv.includes('--devtools')) window.webContents.openDevTools({ mode: 'detach' });
  });
  configureWindow(window);
  return window;
}

function createCapturePreviewWindow(dataUrl) {
  imageFromDataUrl(dataUrl);
  if (capturePreviewWindow && !capturePreviewWindow.isDestroyed()) {
    capturePreviewWindow.close();
    capturePreviewWindow = null;
  }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  const width = 372;
  const height = 138;
  const payloadId = storeCapturePayload({ type: 'preview', imageDataUrl: dataUrl });
  const window = new BrowserWindow({
    width,
    height,
    x: Math.round(area.x + area.width - width - 18),
    y: Math.round(area.y + area.height - height - 18),
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    title: '截图预览 - Test cat',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  capturePreviewWindow = window;
  window.setAlwaysOnTop(true, isMac ? 'floating' : 'pop-up-menu');
  window.loadFile(path.join(__dirname, 'renderer/capture-preview.html'), { query: { id: payloadId } });
  window.once('ready-to-show', () => {
    if (typeof window.showInactive === 'function') window.showInactive();
    else window.show();
  });
  configureWindow(window);
  window.on('closed', () => {
    if (capturePreviewWindow === window) capturePreviewWindow = null;
  });
  return window;
}

function recordingRegionGlobalRect(region = {}) {
  const display = screen.getAllDisplays().find((item) => String(item.id) === String(region.displayId))
    || screen.getPrimaryDisplay();
  const bounds = region.bounds || display.bounds;
  const rect = region.dipRect || {};
  return {
    x: Math.round((Number(bounds.x) || 0) + (Number(rect.x) || 0)),
    y: Math.round((Number(bounds.y) || 0) + (Number(rect.y) || 0)),
    width: Math.max(8, Math.round(Number(rect.width) || 0)),
    height: Math.max(8, Math.round(Number(rect.height) || 0))
  };
}

function clampToWorkArea(value, min, max) {
  if (max < min) return Math.round(min);
  return Math.round(Math.min(max, Math.max(min, value)));
}

function floatingBoundsNearRegion(region, width, height) {
  const rect = recordingRegionGlobalRect(region);
  const display = screen.getDisplayMatching(rect);
  const area = display.workArea;
  const gap = 10;
  const candidates = [
    { x: rect.x + (rect.width - width) / 2, y: rect.y + rect.height + gap },
    { x: rect.x + (rect.width - width) / 2, y: rect.y - height - gap },
    { x: rect.x + rect.width + gap, y: rect.y + (rect.height - height) / 2 },
    { x: rect.x - width - gap, y: rect.y + (rect.height - height) / 2 },
    { x: area.x + area.width - width - 16, y: area.y + area.height - height - 16 }
  ];
  const fits = (item) => item.x >= area.x
    && item.y >= area.y
    && item.x + width <= area.x + area.width
    && item.y + height <= area.y + area.height;
  const chosen = candidates.find(fits) || candidates[candidates.length - 1];
  return {
    width,
    height,
    x: clampToWorkArea(chosen.x, area.x + 8, area.x + area.width - width - 8),
    y: clampToWorkArea(chosen.y, area.y + 8, area.y + area.height - height - 8)
  };
}

function createRecordingBorderWindow(region = {}) {
  const rect = recordingRegionGlobalRect(region);
  if (!rect.width || !rect.height) throw new Error('录屏区域无效，请重新框选');
  closeRecordingBorderWindow();
  const padding = 8;
  const window = new BrowserWindow({
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    title: '录制区域边框 - Test cat',
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  recordingBorderWindow = window;
  window.setAlwaysOnTop(true, isMac ? 'screen-saver' : 'pop-up-menu');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setIgnoreMouseEvents(true, { forward: true });
  window.loadFile(path.join(__dirname, 'renderer/recording-border.html'));
  window.once('ready-to-show', () => {
    if (typeof window.showInactive === 'function') window.showInactive();
    else window.show();
  });
  window.on('closed', () => {
    if (recordingBorderWindow === window) recordingBorderWindow = null;
  });
  return window;
}

async function listCaptureSources() {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 360, height: 220 },
    fetchWindowIcons: true
  });
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    displayId: source.display_id || '',
    type: source.id.startsWith('screen') ? 'screen' : 'window',
    thumbnail: source.thumbnail?.isEmpty() ? '' : source.thumbnail.toDataURL(),
    appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : ''
  }));
}

async function createRecorderWindow(region = null) {
  if (!region) return createRecordingSelection();
  if (recorderWindow && !recorderWindow.isDestroyed()) {
    recorderWindow.close();
    recorderWindow = null;
  }
  closeRecordingBorderWindow();
  const payloadId = storeCapturePayload({ type: 'recording', region });
  const controlBounds = floatingBoundsNearRegion(region, 392, 108);
  const window = new BrowserWindow({
    ...controlBounds,
    minWidth: 392,
    minHeight: 108,
    maxWidth: 392,
    maxHeight: 108,
    frame: false,
    resizable: false,
    show: false,
    title: '录屏 - Test cat',
    icon: path.join(__dirname, '../assets/icon.png'),
    alwaysOnTop: true,
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  recorderWindow = window;
  window.setAlwaysOnTop(true, isMac ? 'floating' : 'normal');
  window.loadFile(path.join(__dirname, 'renderer/screen-recorder.html'), { query: { id: payloadId } });
  window.once('ready-to-show', () => {
    window.show();
    if (process.argv.includes('--devtools')) window.webContents.openDevTools({ mode: 'detach' });
  });
  configureWindow(window);
  window.on('closed', () => {
    if (recorderWindow === window) recorderWindow = null;
    closeRecordingBorderWindow();
  });
  return window;
}

function matchDisplaySource(display, sources, index, displayCount) {
  const exact = sources.find((source) => String(source.display_id || '') === String(display.id));
  if (exact) return exact;
  if (sources.length === displayCount) return sources[index] || sources[0];
  return sources[0];
}

async function createCaptureSelection(mode = 'screenshot') {
  ensureCaptureFeatureEnabled();
  closeSelectionWindows();
  const displays = screen.getAllDisplays();
  const maxWidth = Math.max(...displays.map((display) => Math.round(display.bounds.width * display.scaleFactor)), 1280);
  const maxHeight = Math.max(...displays.map((display) => Math.round(display.bounds.height * display.scaleFactor)), 720);
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: maxWidth, height: maxHeight }
  });
  if (!sources.length) throw new Error('没有获取到屏幕画面，请检查系统屏幕录制权限');

  displays.forEach((display, index) => {
    const source = matchDisplaySource(display, sources, index, displays.length);
    if (!source || !source.thumbnail || source.thumbnail.isEmpty()) return;
    const bounds = display.bounds;
    const thumbnailSize = source.thumbnail.getSize();
    const payloadId = storeCapturePayload({
      type: 'selection',
      selectionMode: mode,
      imageDataUrl: source.thumbnail.toDataURL(),
      sourceId: source.id,
      sourceName: source.name,
      displayId: display.id,
      displayName: source.name,
      bounds,
      scaleFactor: display.scaleFactor,
      screenPixelSize: thumbnailSize,
      defaultAction: mode === 'recording' ? 'record' : (captureSettings || DEFAULT_CAPTURE_SETTINGS).screenshotAction,
      platform: process.platform
    });
    const window = new BrowserWindow({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      transparent: true,
      hasShadow: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      title: mode === 'recording' ? '录屏区域选择 - Test cat' : '截图选择 - Test cat',
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    selectionWindows.set(payloadId, window);
    window.setAlwaysOnTop(true, isMac ? 'screen-saver' : 'pop-up-menu');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.loadFile(path.join(__dirname, 'renderer/capture-select.html'), { query: { id: payloadId } });
    window.once('ready-to-show', () => {
      window.show();
      window.focus();
    });
    window.on('closed', () => selectionWindows.delete(payloadId));
  });

  if (!selectionWindows.size) throw new Error('屏幕画面为空，请检查系统屏幕录制权限');
}

async function createScreenshotSelection() {
  ensureCaptureFeatureEnabled();
  return createCaptureSelection('screenshot');
}

async function createRecordingSelection() {
  ensureCaptureFeatureEnabled();
  if (recorderWindow && !recorderWindow.isDestroyed()) {
    if (recorderWindow.isMinimized()) recorderWindow.restore();
    recorderWindow.show();
    recorderWindow.focus();
    return recorderWindow;
  }
  return createCaptureSelection('recording');
}

function companionPetSnapshot() {
  const settings = companionPetSettings || { ...DEFAULT_COMPANION_PET_SETTINGS };
  const activePet = COMPANION_PETS[settings.activePetId] || COMPANION_PETS[DEFAULT_COMPANION_PET_SETTINGS.activePetId];
  return {
    activePet,
    pets: Object.values(COMPANION_PETS),
    settings,
    visible: Boolean(companionPetWindow && !companionPetWindow.isDestroyed() && companionPetWindow.isVisible())
  };
}

function sendCompanionPetSettings() {
  const snapshot = companionPetSnapshot();
  for (const targetWindow of [mainWindow, companionPetWindow]) {
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.webContents.send('companion-pet:settings-changed', snapshot);
    }
  }
}

function clearCompanionPetTimers() {
  if (companionPetWalkTimer) clearInterval(companionPetWalkTimer);
  if (companionPetAnimationTimer) clearInterval(companionPetAnimationTimer);
  companionPetWalkTimer = null;
  companionPetAnimationTimer = null;
  companionPetDragState = null;
  for (const timer of companionPetReminderTimers.values()) clearInterval(timer);
  companionPetReminderTimers.clear();
}

function initialCompanionPetBounds(width = 260, height = 320) {
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  return {
    width,
    height,
    x: Math.max(area.x + 12, area.x + area.width - width - 42),
    y: Math.max(area.y + 12, area.y + area.height - height - 34)
  };
}

function randomCompanionPetBounds(width = 260, height = 320) {
  const displays = screen.getAllDisplays();
  const display = displays[Math.floor(Math.random() * displays.length)] || screen.getPrimaryDisplay();
  const area = display.workArea;
  const maxX = Math.max(area.x + 12, area.x + area.width - width - 12);
  const maxY = Math.max(area.y + 12, area.y + area.height - height - 12);
  return {
    width,
    height,
    x: Math.round(area.x + 12 + Math.random() * Math.max(0, maxX - area.x - 12)),
    y: Math.round(area.y + 12 + Math.random() * Math.max(0, maxY - area.y - 12))
  };
}

function showCompanionPetWindow(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) return;
  targetWindow.setAlwaysOnTop(true, isMac ? 'floating' : 'pop-up-menu');
  try { targetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
  if (typeof targetWindow.showInactive === 'function') targetWindow.showInactive();
  else targetWindow.show();
}

function createCompanionPetWindow() {
  if (companionPetWindow && !companionPetWindow.isDestroyed()) {
    showCompanionPetWindow(companionPetWindow);
    return companionPetWindow;
  }

  const activePet = COMPANION_PETS[companionPetSettings?.activePetId] || COMPANION_PETS[DEFAULT_COMPANION_PET_SETTINGS.activePetId];
  const targetWindow = new BrowserWindow({
    ...initialCompanionPetBounds(),
    minWidth: 240,
    minHeight: 300,
    maxWidth: 300,
    maxHeight: 360,
    resizable: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    title: activePet.title,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  companionPetWindow = targetWindow;
  targetWindow.loadFile(path.join(__dirname, 'renderer/companion-pet.html'));
  targetWindow.once('ready-to-show', () => {
    showCompanionPetWindow(targetWindow);
    sendCompanionPetSettings();
    if (process.argv.includes('--devtools')) targetWindow.webContents.openDevTools({ mode: 'detach' });
  });
  configureWindow(targetWindow);
  targetWindow.on('closed', () => {
    if (companionPetWindow === targetWindow) companionPetWindow = null;
    if (companionPetAnimationTimer) clearInterval(companionPetAnimationTimer);
    companionPetAnimationTimer = null;
    sendCompanionPetSettings();
  });

  return targetWindow;
}

function moveCompanionPet(immediate = false, force = false) {
  if (!companionPetSettings?.enabled || (!force && !companionPetSettings?.movementEnabled)) return;
  const targetWindow = companionPetWindow && !companionPetWindow.isDestroyed() ? companionPetWindow : createCompanionPetWindow();
  if (!targetWindow || targetWindow.isDestroyed()) return;
  if (companionPetDragState) return;
  const start = targetWindow.getBounds();
  const target = randomCompanionPetBounds(start.width, start.height);
  const distance = Math.hypot(target.x - start.x, target.y - start.y);
  const direction = target.x >= start.x ? 'right' : 'left';

  if (distance < 24 || immediate) {
    targetWindow.setBounds(target, false);
    targetWindow.webContents.send('companion-pet:walk', { direction, durationMs: 0 });
    return;
  }

  if (companionPetAnimationTimer) clearInterval(companionPetAnimationTimer);
  const durationMs = Math.min(11000, Math.max(3600, distance * 16));
  const startedAt = Date.now();
  targetWindow.webContents.send('companion-pet:walk', { direction, durationMs });
  companionPetAnimationTimer = setInterval(() => {
    if (!targetWindow || targetWindow.isDestroyed()) {
      clearInterval(companionPetAnimationTimer);
      companionPetAnimationTimer = null;
      return;
    }
    const progress = Math.min(1, (Date.now() - startedAt) / durationMs);
    const eased = 0.5 - Math.cos(progress * Math.PI) / 2;
    targetWindow.setBounds({
      ...start,
      x: Math.round(start.x + (target.x - start.x) * eased),
      y: Math.round(start.y + (target.y - start.y) * eased)
    }, false);
    if (progress >= 1) {
      clearInterval(companionPetAnimationTimer);
      companionPetAnimationTimer = null;
      targetWindow.webContents.send('companion-pet:idle');
    }
  }, 50);
  companionPetAnimationTimer.unref?.();
}

function scheduleCompanionPetMovement() {
  if (companionPetWalkTimer) clearInterval(companionPetWalkTimer);
  companionPetWalkTimer = null;
  if (!companionPetSettings?.enabled || !companionPetSettings?.movementEnabled) return;
  companionPetWalkTimer = setInterval(() => moveCompanionPet(false), companionPetSettings.walkIntervalSeconds * 1000);
  companionPetWalkTimer.unref?.();
}

function deliverCompanionPetReminder(targetWindow, reminder) {
  if (!targetWindow || targetWindow.isDestroyed()) return;
  const payload = { ...reminder, at: Date.now() };
  const send = () => {
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.webContents.send('companion-pet:reminder', payload);
    }
  };
  if (targetWindow.webContents.isLoading()) {
    targetWindow.webContents.once('did-finish-load', () => setTimeout(send, 80));
  } else {
    send();
  }
}

function sendCompanionPetReminder(type) {
  if (!companionPetSettings?.enabled) return;
  const activePet = COMPANION_PETS[companionPetSettings.activePetId] || COMPANION_PETS[DEFAULT_COMPANION_PET_SETTINGS.activePetId];
  const petName = activePet.name;
  const fallbackReminders = {
    water: {
      type: 'water',
      title: '喝水时间到',
      message: petName + '扭了两下：喝口水吧，身体也要补蓝量。'
    },
    stand: {
      type: 'stand',
      title: '站起来伸展一下',
      message: petName + '开始扭扭：站起来走两步，肩膀和尾巴都松一松。'
    }
  };
  const reminder = {
    type,
    ...(fallbackReminders[type] || {}),
    ...((activePet.reminders && activePet.reminders[type]) || {})
  };
  reminder.message = pickCompanionPetText(reminder.messages, reminder.message);
  if (!reminder) return;
  const targetWindow = companionPetWindow && !companionPetWindow.isDestroyed() ? companionPetWindow : createCompanionPetWindow();
  showCompanionPetWindow(targetWindow);
  deliverCompanionPetReminder(targetWindow, reminder);
}

function sendTodoCompanionPetReminder(payload = {}) {
  const settings = companionPetSettings || { ...DEFAULT_COMPANION_PET_SETTINGS };
  const wasEnabled = settings.enabled !== false;
  const activePet = COMPANION_PETS[settings.activePetId] || COMPANION_PETS[DEFAULT_COMPANION_PET_SETTINGS.activePetId];
  const petName = activePet.name || '陪伴宠物';
  const minutesLeft = Number(payload.minutesLeft);
  const safeMinutes = Number.isFinite(minutesLeft) && minutesLeft > 0 ? Math.round(minutesLeft) : 0;
  const todoText = String(payload.todoText || '').trim().slice(0, 120);
  const title = String(payload.title || (safeMinutes ? `待办提醒 · 还差 ${safeMinutes} 分钟` : '待办提醒')).trim().slice(0, 80);
  const message = String(payload.message || (todoText ? `${petName}提醒你：任务「${todoText}」快到时间啦。` : `${petName}提醒你：有测试任务快到时间啦。`)).trim().slice(0, 260);
  const targetWindow = companionPetWindow && !companionPetWindow.isDestroyed() ? companionPetWindow : createCompanionPetWindow();
  showCompanionPetWindow(targetWindow);
  deliverCompanionPetReminder(targetWindow, {
    type: 'todo',
    title,
    message,
    minutesLeft: safeMinutes,
    todoText,
    temporary: !wasEnabled
  });
  if (!wasEnabled) {
    const hideTimer = setTimeout(() => {
      if (!companionPetSettings?.enabled && companionPetWindow === targetWindow && targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.close();
      }
    }, 12_000);
    hideTimer.unref?.();
  }
  return { ok: true, temporary: !wasEnabled };
}

function scheduleCompanionPetReminders() {
  for (const timer of companionPetReminderTimers.values()) clearInterval(timer);
  companionPetReminderTimers.clear();
  if (!companionPetSettings?.enabled) return;

  const reminders = [
    ['water', companionPetSettings.waterReminderEnabled, companionPetSettings.waterReminderMinutes],
    ['stand', companionPetSettings.standReminderEnabled, companionPetSettings.standReminderMinutes]
  ];
  for (const [type, enabled, minutes] of reminders) {
    if (!enabled) continue;
    const timer = setInterval(() => sendCompanionPetReminder(type), minutes * 60 * 1000);
    timer.unref?.();
    companionPetReminderTimers.set(type, timer);
  }
}

function applyCompanionPetSettings() {
  clearCompanionPetTimers();
  if (!companionPetSettings?.enabled) {
    if (companionPetWindow && !companionPetWindow.isDestroyed()) companionPetWindow.close();
    sendCompanionPetSettings();
    return;
  }
  const targetWindow = createCompanionPetWindow();
  const activePet = COMPANION_PETS[companionPetSettings.activePetId] || COMPANION_PETS[DEFAULT_COMPANION_PET_SETTINGS.activePetId];
  if (targetWindow && !targetWindow.isDestroyed()) targetWindow.setTitle(activePet.title);
  scheduleCompanionPetMovement();
  scheduleCompanionPetReminders();
  sendCompanionPetSettings();
}

function startCompanionPetDrag(point = {}) {
  if (!companionPetWindow || companionPetWindow.isDestroyed()) return false;
  if (companionPetAnimationTimer) {
    clearInterval(companionPetAnimationTimer);
    companionPetAnimationTimer = null;
  }
  const bounds = companionPetWindow.getBounds();
  companionPetDragState = {
    offsetX: Math.round(Number(point.x) || 0) - bounds.x,
    offsetY: Math.round(Number(point.y) || 0) - bounds.y
  };
  companionPetWindow.webContents.send('companion-pet:drag-state', { dragging: true });
  return true;
}

function dragCompanionPet(point = {}) {
  if (!companionPetWindow || companionPetWindow.isDestroyed() || !companionPetDragState) return false;
  const bounds = companionPetWindow.getBounds();
  const x = Math.round((Number(point.x) || 0) - companionPetDragState.offsetX);
  const y = Math.round((Number(point.y) || 0) - companionPetDragState.offsetY);
  companionPetWindow.setBounds({ ...bounds, x, y }, false);
  return true;
}

function endCompanionPetDrag() {
  if (!companionPetDragState) return false;
  companionPetDragState = null;
  if (companionPetWindow && !companionPetWindow.isDestroyed()) {
    companionPetWindow.webContents.send('companion-pet:drag-state', { dragging: false });
    companionPetWindow.webContents.send('companion-pet:idle');
  }
  return true;
}

function setupIpc() {
  if (ipcReady) return;
  ipcReady = true;

  ipcMain.on('mobile-mirror:stream-request', (event) => {
    if (!mobileMirrorService) return;
    const { port1, port2 } = new MessageChannelMain();
    mobileMirrorService.attachPort(port1);
    event.senderFrame.postMessage('mobile-mirror:stream-port', null, [port2]);
  });
  ipcMain.handle('mobile-mirror:list-devices', () => mobileMirrorService.listDevices());
  ipcMain.handle('mobile-mirror:start', (_event, configuration) => mobileMirrorService.start(configuration || {}));
  ipcMain.handle('mobile-mirror:stop', () => mobileMirrorService.stop());
  ipcMain.handle('mobile-mirror:get-device-info', (_event, configuration) => mobileMirrorService.getDeviceInfo(configuration || {}));
  ipcMain.handle('mobile-mirror:copy-text', (_event, value) => {
    clipboard.writeText(String(value || '').slice(0, 100000));
    return true;
  });
  ipcMain.handle('mobile-mirror:open-window', () => {
    createMobileMirrorWindow();
    return true;
  });
  ipcMain.handle('mobile-mirror:set-always-on-top', (event, enabled) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!mobileMirrorWindow || senderWindow !== mobileMirrorWindow) return false;
    mobileMirrorWindow.setAlwaysOnTop(Boolean(enabled), isMac ? 'floating' : 'normal');
    return mobileMirrorWindow.isAlwaysOnTop();
  });
  ipcMain.handle('ios-mirror:open-window', () => {
    createIosMirrorWindow();
    return true;
  });
  ipcMain.handle('ios-mirror:list-devices', () => iosMirrorService.listDevices());
  ipcMain.handle('ios-mirror:start', (_event, configuration) => iosMirrorService.start(configuration || {}));
  ipcMain.handle('ios-mirror:stop', () => iosMirrorService.stop());
  ipcMain.handle('ios-mirror:set-always-on-top', (event, enabled) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!iosMirrorWindow || senderWindow !== iosMirrorWindow) return false;
    iosMirrorWindow.setAlwaysOnTop(Boolean(enabled), isMac ? 'floating' : 'normal');
    return iosMirrorWindow.isAlwaysOnTop();
  });
  ipcMain.handle('calculator:open-window', () => {
    createCalculatorWindow();
    return true;
  });
  ipcMain.handle('performance-monitor:open-window', () => {
    createPerformanceMonitorWindow();
    return true;
  });
  ipcMain.handle('performance-monitor:list-devices', () => performanceMonitorService.listDevices());
  ipcMain.handle('performance-monitor:start', (_event, configuration) => performanceMonitorService.start(configuration));
  ipcMain.handle('performance-monitor:stop', () => performanceMonitorService.stop());
  ipcMain.handle('performance-monitor:launch-app', (_event, { serial, packageName }) => performanceMonitorService.launchApp(serial, packageName));
  ipcMain.handle('performance-monitor:foreground-app', (_event, serial) => performanceMonitorService.getForegroundApp(serial));
  ipcMain.handle('performance-monitor:save-report', (_event, payload, options) => performanceMonitorHistory.saveReport(payload, options || {}));
  ipcMain.handle('performance-monitor:migrate-reports', (_event, reports) => performanceMonitorHistory.migrateReports(reports));
  ipcMain.handle('performance-monitor:list-reports', () => performanceMonitorHistory.listReports());
  ipcMain.handle('performance-monitor:get-report', (_event, id) => performanceMonitorHistory.getReport(String(id || '')));
  ipcMain.handle('performance-monitor:delete-report', (_event, id) => performanceMonitorHistory.deleteReport(String(id || '')));
  ipcMain.handle('performance-monitor:export-xlsx', async (event, id) => {
    const report = await performanceMonitorHistory.getReport(String(id || ''));
    if (!report) throw new Error('报告不存在或已经损坏。');
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const safeName = String(report.name || '安卓性能报告').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
    const result = await dialog.showSaveDialog(senderWindow || performanceMonitorWindow || mainWindow, {
      title: '导出安卓性能 Excel',
      defaultPath: `${safeName}.xlsx`,
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
    });
    if (result.canceled || !result.filePath) return null;
    await fsp.writeFile(result.filePath, createPerformanceWorkbook(report));
    return { path: result.filePath };
  });
  ipcMain.handle('performance-monitor:export-comparison-xlsx', async (event, payload = {}) => {
    const leftId = String(payload.leftId || '');
    const rightId = String(payload.rightId || '');
    if (!leftId || !rightId || leftId === rightId) throw new Error('请选择两份不同的性能报告。');
    const [left, right] = await Promise.all([
      performanceMonitorHistory.getReport(leftId),
      performanceMonitorHistory.getReport(rightId)
    ]);
    if (!left || !right) throw new Error('对比报告不存在或已经损坏。');
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const safeName = `性能对比_${left.name || '基准'}_vs_${right.name || '目标'}`.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
    const result = await dialog.showSaveDialog(senderWindow || performanceMonitorWindow || mainWindow, {
      title: '导出安卓性能对比 Excel',
      defaultPath: `${safeName}.xlsx`,
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
    });
    if (result.canceled || !result.filePath) return null;
    await fsp.writeFile(result.filePath, createPerformanceComparisonWorkbook(left, right));
    return { path: result.filePath };
  });
  ipcMain.handle('ios-performance:open-window', () => {
    createIosPerformanceWindow();
    return true;
  });
  ipcMain.handle('ios-performance:check-environment', () => iosPerformanceService.checkEnvironment());
  ipcMain.handle('ios-performance:list-devices', () => iosPerformanceService.listDevices());
  ipcMain.handle('ios-performance:list-apps', (_event, serial) => iosPerformanceService.getInstalledApps(serial));
  ipcMain.handle('ios-performance:device-status', (_event, serial) => iosPerformanceService.getDeviceStatus(serial));
  ipcMain.handle('ios-performance:start', (_event, configuration) => iosPerformanceService.start(configuration || {}));
  ipcMain.handle('ios-performance:stop', () => iosPerformanceService.stop());
  ipcMain.handle('ios-performance:start-tunnel', () => iosPerformanceService.startTunnel());
  ipcMain.handle('ios-performance:collect-logs', async (_event, serial) => {
    const result = await iosPerformanceService.collectDiagnosticLogs(serial);
    const inserted = await iosPerformanceHistory.saveLogs(result.records);
    return { scanned: result.scanned, selected: result.selected, imported: inserted.length, logs: await iosPerformanceHistory.listLogs({ deviceSerial: serial }) };
  });
  ipcMain.handle('ios-performance:list-logs', (_event, filters) => iosPerformanceHistory.listLogs(filters || {}));
  ipcMain.handle('ios-performance:get-log', (_event, id) => iosPerformanceHistory.getLog(String(id || '')));
  ipcMain.handle('ios-performance:save-report', (_event, payload, options) => iosPerformanceHistory.saveReport(payload, options || {}));
  ipcMain.handle('ios-performance:list-reports', () => iosPerformanceHistory.listReports());
  ipcMain.handle('ios-performance:get-report', (_event, id) => iosPerformanceHistory.getReport(String(id || '')));
  ipcMain.handle('ios-performance:delete-report', (_event, id) => iosPerformanceHistory.deleteReport(String(id || '')));
  ipcMain.handle('weak-network:open-window', () => {
    createWeakNetworkWindow();
    return true;
  });
  ipcMain.handle('weak-network:list-devices', () => weakNetworkService.listDevices());
  ipcMain.handle('weak-network:get-presets', () => weakNetworkService.getPresets());
  ipcMain.handle('weak-network:start', (_event, configuration) => weakNetworkService.start(configuration || {}));
  ipcMain.handle('weak-network:stop', () => weakNetworkService.stop());
  ipcMain.handle('file-compare:open-window', () => {
    createFileCompareWindow();
    return true;
  });
  ipcMain.handle('file-compare:select-path', (_event, kind) => fileCompareService.selectPath(kind));
  ipcMain.handle('file-compare:inspect-path', (_event, targetPath) => fileCompareService.inspectPath(targetPath));
  ipcMain.handle('file-compare:read-file', (_event, filePath) => fileCompareService.readFile(filePath));
  ipcMain.handle('file-compare:compare-directories', (_event, payload) => fileCompareService.compareDirectories(payload.leftRoot, payload.rightRoot, payload.options || {}));
  ipcMain.handle('file-compare:sync-entry', (_event, payload) => fileCompareService.syncEntry(payload));
  ipcMain.handle('file-compare:save-text', (_event, payload) => fileCompareService.saveText(payload));
  ipcMain.handle('file-compare:export-report', (_event, payload) => fileCompareService.exportReport(payload));
  ipcMain.handle('log-analysis:open-window', () => {
    createLogAnalysisWindow();
    return true;
  });
  ipcMain.handle('log-analysis:list-devices', () => logAnalysisService.listDevices());
  ipcMain.handle('log-analysis:foreground-app', (_event, serial) => logAnalysisService.getForegroundApp(serial));
  ipcMain.handle('log-analysis:start', (_event, configuration) => logAnalysisService.start(configuration || {}));
  ipcMain.handle('log-analysis:stop', () => logAnalysisService.stop());
  ipcMain.handle('log-analysis:clear', () => logAnalysisService.clearCaptured());
  ipcMain.handle('log-analysis:export', (_event, payload) => logAnalysisService.exportLogs(payload || {}));
  ipcMain.handle('log-analysis:copy-text', (_event, value) => {
    clipboard.writeText(String(value || '').slice(0, 2_000_000));
    return true;
  });
  ipcMain.handle('app-package:open-window', () => {
    createAppPackageWindow();
    return true;
  });
  ipcMain.handle('app-package:select-package', () => appPackageService.selectPackage());
  ipcMain.handle('app-package:inspect-package', (_event, filePath) => appPackageService.inspectPackage(filePath));
  ipcMain.handle('app-package:list-devices', (_event, payload) => appPackageService.listDevices(payload || {}));
  ipcMain.handle('app-package:list-installed', (_event, payload) => appPackageService.listInstalledPackages(payload || {}));
  ipcMain.handle('app-package:install', (_event, payload) => appPackageService.installPackage(payload || {}));
  ipcMain.handle('app-package:uninstall', (_event, payload) => appPackageService.uninstallPackage(payload || {}));
  ipcMain.handle('app-package:clear-data', (_event, payload) => appPackageService.clearData(payload || {}));
  ipcMain.handle('mock-data:open-window', () => {
    createMockDataWindow();
    return true;
  });
  ipcMain.handle('mock-data:copy-text', (_event, value) => {
    clipboard.writeText(String(value || '').slice(0, 2_000_000));
    return true;
  });
  ipcMain.handle('timestamp-converter:open-window', () => {
    createTimestampConverterWindow();
    return true;
  });
  ipcMain.handle('timestamp-converter:copy-text', (_event, value) => {
    clipboard.writeText(String(value || '').slice(0, 200_000));
    return true;
  });
  ipcMain.handle('formula-calculator:open-window', () => {
    createFormulaCalculatorWindow();
    return true;
  });
  ipcMain.handle('formula-calculator:copy-text', (_event, value) => {
    clipboard.writeText(String(value || '').slice(0, 200_000));
    return true;
  });
  ipcMain.handle('ai-test-assistant:open-window', () => {
    createAiTestAssistantWindow();
    return true;
  });
  ipcMain.handle('ai-test-assistant:get-settings', () => aiSettingsSnapshot());
  ipcMain.handle('ai-test-assistant:save-settings', async (_event, settings = {}) => {
    const current = normalizeAiSettings(aiSettings || DEFAULT_AI_SETTINGS);
    if (current.locked && settings.locked !== false) return aiSettingsSnapshot();
    if (current.locked && settings.locked === false) aiSettings = normalizeAiSettings({ ...current, locked: false });
    else aiSettings = normalizeAiSettings({ ...current, ...settings });
    await saveAiSettingsToDisk();
    return aiSettingsSnapshot();
  });
  ipcMain.handle('ai-test-assistant:test-connection', () => aiTestAssistantService.testConnection());
  ipcMain.handle('ai-test-assistant:select-requirement-file', () => aiTestAssistantService.selectRequirementFile());
  ipcMain.handle('ai-test-assistant:extract-requirement-file', (_event, filePath) => aiTestAssistantService.extractRequirementFile(filePath));
  ipcMain.handle('ai-test-assistant:run-task', (_event, payload = {}) => aiTestAssistantService.runTask(payload));
  ipcMain.handle('ai-test-assistant:generate-test-cases', (_event, payload = {}) => aiTestAssistantService.generateTestCases(payload));
  ipcMain.handle('ai-test-assistant:export-excel', (_event, payload = {}) => aiTestAssistantService.exportExcel(payload));
  ipcMain.handle('ai-test-assistant:export-xmind', (_event, payload = {}) => aiTestAssistantService.exportXmind(payload));
  ipcMain.handle('ai-test-assistant:copy-text', (_event, value) => {
    clipboard.writeText(String(value || '').slice(0, 2_000_000));
    return true;
  });
  ipcMain.handle('formula-calculator:export-data', async (event, payload = {}) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const defaultPath = String(payload.fileName || `test-cat-formulas-${Date.now()}.json`).replace(/[\\/:*?"<>|]/g, '-');
    const result = await dialog.showSaveDialog(senderWindow || mainWindow, {
      title: '导出公式和变量词',
      defaultPath,
      filters: [
        { name: 'JSON 文件', extensions: ['json'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePath) return null;
    const content = typeof payload.content === 'string' ? payload.content : JSON.stringify(payload.data || {}, null, 2);
    await fsp.writeFile(result.filePath, content, 'utf8');
    return { filePath: result.filePath };
  });
  ipcMain.handle('formula-calculator:import-data', async (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(senderWindow || mainWindow, {
      title: '导入公式和变量词',
      properties: ['openFile'],
      filters: [
        { name: 'JSON 文件', extensions: ['json'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePaths?.[0]) return null;
    const filePath = result.filePaths[0];
    const content = await fsp.readFile(filePath, 'utf8');
    return { filePath, content };
  });
  ipcMain.handle('mock-data:export-csv', async (event, payload = {}) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const defaultPath = String(payload.fileName || `mock-data-${Date.now()}.csv`).replace(/[\\/:*?"<>|]/g, '-');
    const result = await dialog.showSaveDialog(senderWindow || mainWindow, {
      title: '导出 Mock 数据 CSV',
      defaultPath,
      filters: [
        { name: 'CSV 文件', extensions: ['csv'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePath) return null;
    const content = String(payload.content || '');
    await fsp.writeFile(result.filePath, content.startsWith('\ufeff') ? content : `\ufeff${content}`, 'utf8');
    return { filePath: result.filePath };
  });
  ipcMain.handle('companion-pet:get-settings', () => companionPetSnapshot());
  ipcMain.handle('companion-pet:save-settings', async (_event, settings = {}) => {
    companionPetSettings = normalizeCompanionPetSettings({ ...companionPetSettings, ...settings });
    await saveCompanionPetSettingsToDisk();
    applyCompanionPetSettings();
    return companionPetSnapshot();
  });
  ipcMain.handle('companion-pet:show-now', async () => {
    companionPetSettings = normalizeCompanionPetSettings({ ...companionPetSettings, enabled: true });
    await saveCompanionPetSettingsToDisk();
    applyCompanionPetSettings();
    return companionPetSnapshot();
  });
  ipcMain.handle('companion-pet:hide-now', async () => {
    companionPetSettings = normalizeCompanionPetSettings({ ...companionPetSettings, enabled: false });
    await saveCompanionPetSettingsToDisk();
    applyCompanionPetSettings();
    return companionPetSnapshot();
  });
  ipcMain.handle('companion-pet:walk-now', () => {
    moveCompanionPet(false, true);
    return true;
  });
  ipcMain.handle('companion-pet:todo-reminder', (_event, payload = {}) => sendTodoCompanionPetReminder(payload));
  ipcMain.handle('companion-pet:drag-start', (_event, point) => startCompanionPetDrag(point || {}));
  ipcMain.handle('companion-pet:drag-move', (_event, point) => dragCompanionPet(point || {}));
  ipcMain.handle('companion-pet:drag-end', () => endCompanionPetDrag());
  ipcMain.handle('capture:get-settings', () => captureSettingsSnapshot());
  ipcMain.handle('capture:save-settings', async (_event, settings) => {
    captureSettings = normalizeCaptureSettings({ ...captureSettings, ...(settings || {}) });
    await saveCaptureSettingsToDisk();
    const shortcutStatus = registerCaptureShortcuts();
    if (!captureSettings.enabled) {
      closeSelectionWindows();
      if (capturePreviewWindow && !capturePreviewWindow.isDestroyed()) capturePreviewWindow.close();
      closeRecordingBorderWindow();
    }
    return { settings: captureSettings, shortcutStatus };
  });
  ipcMain.handle('capture:start-screenshot', async () => {
    ensureCaptureFeatureEnabled();
    await createScreenshotSelection();
    return true;
  });
  ipcMain.handle('capture:open-recorder', async () => {
    ensureCaptureFeatureEnabled();
    await createRecordingSelection();
    return true;
  });
  ipcMain.handle('capture:get-payload', (_event, id) => {
    const payload = capturePayloads.get(String(id || ''));
    if (!payload) throw new Error('采集数据已失效，请重新操作');
    return payload;
  });
  ipcMain.handle('capture:selection-cancel', () => {
    closeSelectionWindows();
    return true;
  });
  ipcMain.handle('capture:selection-complete', async (_event, payload) => {
    closeSelectionWindows();
    ensureCaptureFeatureEnabled();
    if (payload?.action === 'record') {
      const region = payload.region || {};
      if (!region.sourceId || !region.sourceRect?.width || !region.sourceRect?.height) throw new Error('录屏区域无效，请重新框选');
      await createRecorderWindow(region);
      return { action: 'record', message: '已创建区域录屏' };
    }
    const dataUrl = String(payload?.dataUrl || '');
    const action = payload?.action || (captureSettings || DEFAULT_CAPTURE_SETTINGS).screenshotAction;
    imageFromDataUrl(dataUrl);
    if (action === 'toolbar') {
      createCapturePreviewWindow(dataUrl);
      return { action: 'preview', message: '已打开截图预览' };
    }
    if (action === 'copy') {
      clipboard.writeImage(imageFromDataUrl(dataUrl));
      notifyCaptureMessage('截图已复制到剪贴板');
      return { action, message: '截图已复制到剪贴板' };
    }
    if (action === 'save') {
      const result = await saveImageDataUrl(dataUrl, mainWindow);
      if (!result.canceled) notifyCaptureMessage('截图已保存');
      return { action, ...result };
    }
    if (action === 'pin') {
      createPinWindow(dataUrl);
      return { action, message: '截图已贴到屏幕' };
    }
    createCaptureEditorWindow(dataUrl);
    return { action: 'editor', message: '已打开截图编辑器' };
  });
  ipcMain.handle('capture:copy-image', (_event, dataUrl) => {
    clipboard.writeImage(imageFromDataUrl(dataUrl));
    return true;
  });
  ipcMain.handle('capture:save-image', async (event, dataUrl) => {
    return saveImageDataUrl(dataUrl, BrowserWindow.fromWebContents(event.sender) || mainWindow);
  });
  ipcMain.handle('capture:pin-image', (_event, dataUrl) => {
    createPinWindow(dataUrl);
    return true;
  });
  ipcMain.handle('capture:open-editor', (_event, dataUrl) => {
    createCaptureEditorWindow(dataUrl);
    return true;
  });
  ipcMain.handle('capture:list-sources', () => {
    ensureCaptureFeatureEnabled();
    return listCaptureSources();
  });
  ipcMain.handle('capture:save-video', async (event, data, options = {}) => {
    return saveVideoBuffer(data, options, BrowserWindow.fromWebContents(event.sender) || recorderWindow || mainWindow);
  });
  ipcMain.handle('capture:show-recording-border', (_event, region) => {
    createRecordingBorderWindow(region || {});
    return true;
  });
  ipcMain.handle('capture:hide-recording-border', () => {
    closeRecordingBorderWindow();
    return true;
  });
  ipcMain.handle('capture:show-item', (_event, filePath) => {
    if (filePath) shell.showItemInFolder(filePath);
    return true;
  });
  ipcMain.handle('capture:close-current-window', (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (senderWindow && !senderWindow.isDestroyed()) senderWindow.close();
    return true;
  });
}

function configureWindow(window) {
  window.webContents.on('before-input-event', (event, input) => {
    const key = String(input.key || '').toLowerCase();
    const isDevToolsShortcut = input.key === 'F12'
      || (isMac && input.meta && input.alt && key === 'i')
      || (!isMac && input.control && input.shift && key === 'i');
    if (!isDevToolsShortcut) return;
    event.preventDefault();
    window.webContents.toggleDevTools();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
}

function createApplicationMenu() {
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Test cat', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] }
  ]));
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Test cat',
    icon: path.join(__dirname, '../assets/icon.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow = window;

  window.loadFile(path.join(__dirname, 'renderer/index.html'));
  window.once('ready-to-show', () => {
    window.show();
    if (process.argv.includes('--devtools')) window.webContents.openDevTools({ mode: 'detach' });
  });

  configureWindow(window);
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  return window;
}

function createMobileMirrorWindow() {
  if (mobileMirrorWindow && !mobileMirrorWindow.isDestroyed()) {
    if (mobileMirrorWindow.isMinimized()) mobileMirrorWindow.restore();
    mobileMirrorWindow.show();
    mobileMirrorWindow.focus();
    return mobileMirrorWindow;
  }

  const window = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 820,
    minHeight: 600,
    show: false,
    title: '安卓投屏 - Test cat',
    icon: path.join(__dirname, '../assets/modules/mobile-mirror.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#f4f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mobileMirrorWindow = window;
  window.loadFile(path.join(__dirname, 'renderer/mobile-mirror.html'));
  window.once('ready-to-show', () => {
    window.show();
    if (process.argv.includes('--devtools')) window.webContents.openDevTools({ mode: 'detach' });
  });
  configureWindow(window);
  window.on('closed', () => {
    if (mobileMirrorWindow === window) mobileMirrorWindow = null;
    mobileMirrorService?.stop();
  });

  return window;
}

function createIosMirrorWindow() {
  if (iosMirrorWindow && !iosMirrorWindow.isDestroyed()) {
    if (iosMirrorWindow.isMinimized()) iosMirrorWindow.restore();
    iosMirrorWindow.show();
    iosMirrorWindow.focus();
    return iosMirrorWindow;
  }

  const window = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 820,
    minHeight: 600,
    show: false,
    title: 'iOS 投屏 - Test cat',
    icon: path.join(__dirname, '../assets/modules/ios-mirror.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#f4f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  iosMirrorWindow = window;
  window.loadFile(path.join(__dirname, 'renderer/ios-mirror.html'));
  window.once('ready-to-show', () => {
    window.show();
    if (process.argv.includes('--devtools')) window.webContents.openDevTools({ mode: 'detach' });
  });
  configureWindow(window);
  window.on('closed', () => {
    if (iosMirrorWindow === window) iosMirrorWindow = null;
    iosMirrorService?.stop(false);
  });
  return window;
}

function createCalculatorWindow() {
  if (calculatorWindow && !calculatorWindow.isDestroyed()) {
    if (calculatorWindow.isMinimized()) calculatorWindow.restore();
    calculatorWindow.show();
    calculatorWindow.focus();
    return calculatorWindow;
  }

  const window = new BrowserWindow({
    width: 360,
    height: 540,
    minWidth: 340,
    minHeight: 500,
    maxWidth: 440,
    maxHeight: 680,
    show: false,
    title: '计算器 - Test cat',
    icon: path.join(__dirname, '../assets/modules/calculator.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#f4f6f8',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  calculatorWindow = window;
  window.loadFile(path.join(__dirname, 'renderer/calculator.html'));
  window.once('ready-to-show', () => window.show());
  configureWindow(window);
  window.on('closed', () => {
    if (calculatorWindow === window) calculatorWindow = null;
  });

  return window;
}

function createPerformanceMonitorWindow() {
  if (performanceMonitorWindow && !performanceMonitorWindow.isDestroyed()) {
    if (performanceMonitorWindow.isMinimized()) performanceMonitorWindow.restore();
    performanceMonitorWindow.show();
    performanceMonitorWindow.focus();
    return performanceMonitorWindow;
  }

  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: '安卓性能监控 - Test cat',
    icon: path.join(__dirname, '../assets/modules/performance-monitor.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#10151d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  performanceMonitorWindow = window;
  window.loadFile(path.join(__dirname, 'renderer/performance-monitor.html'));
  window.once('ready-to-show', () => {
    window.show();
    if (process.argv.includes('--devtools')) window.webContents.openDevTools({ mode: 'detach' });
  });
  configureWindow(window);
  window.on('closed', () => {
    if (performanceMonitorWindow === window) performanceMonitorWindow = null;
    performanceMonitorService?.stop(false);
  });
  return window;
}

function createIosPerformanceWindow() {
  if (iosPerformanceWindow && !iosPerformanceWindow.isDestroyed()) {
    if (iosPerformanceWindow.isMinimized()) iosPerformanceWindow.restore();
    iosPerformanceWindow.show();
    iosPerformanceWindow.focus();
    return iosPerformanceWindow;
  }

  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 920,
    minHeight: 680,
    show: false,
    title: 'iOS 性能监控 - Test cat',
    icon: path.join(__dirname, '../assets/modules/performance-monitor.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#10151d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  iosPerformanceWindow = window;
  window.loadFile(path.join(__dirname, 'renderer/ios-performance.html'));
  window.once('ready-to-show', () => {
    window.show();
    if (process.argv.includes('--devtools')) window.webContents.openDevTools({ mode: 'detach' });
  });
  configureWindow(window);
  window.on('closed', () => {
    if (iosPerformanceWindow === window) iosPerformanceWindow = null;
    iosPerformanceService?.stop(false);
  });
  return window;
}

function createWeakNetworkWindow() {
  if (weakNetworkWindow && !weakNetworkWindow.isDestroyed()) {
    if (weakNetworkWindow.isMinimized()) weakNetworkWindow.restore();
    weakNetworkWindow.show();
    weakNetworkWindow.focus();
    return weakNetworkWindow;
  }

  const window = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 900,
    minHeight: 650,
    show: false,
    title: '弱网测试 - Test cat',
    icon: path.join(__dirname, '../assets/modules/weak-network.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#101720',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  weakNetworkWindow = window;
  window.loadFile(path.join(__dirname, 'renderer/weak-network.html'));
  window.once('ready-to-show', () => {
    window.show();
    if (process.argv.includes('--devtools')) window.webContents.openDevTools({ mode: 'detach' });
  });
  configureWindow(window);
  window.on('closed', () => {
    if (weakNetworkWindow === window) weakNetworkWindow = null;
    weakNetworkService?.stop();
  });
  return window;
}

function createFileCompareWindow() {
  if (fileCompareWindow && !fileCompareWindow.isDestroyed()) {
    if (fileCompareWindow.isMinimized()) fileCompareWindow.restore();
    fileCompareWindow.show();
    fileCompareWindow.focus();
    return fileCompareWindow;
  }

  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: '文件对比 - Test cat',
    icon: path.join(__dirname, '../assets/modules/file-compare.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#101720',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  fileCompareWindow = window;
  window.loadFile(path.join(__dirname, 'renderer/file-compare.html'));
  window.once('ready-to-show', () => {
    window.show();
    if (process.argv.includes('--devtools')) window.webContents.openDevTools({ mode: 'detach' });
  });
  configureWindow(window);
  window.on('closed', () => {
    if (fileCompareWindow === window) fileCompareWindow = null;
  });
  return window;
}

function createLogAnalysisWindow() {
  if (logAnalysisWindow && !logAnalysisWindow.isDestroyed()) {
    if (logAnalysisWindow.isMinimized()) logAnalysisWindow.restore();
    logAnalysisWindow.show();
    logAnalysisWindow.focus();
    return logAnalysisWindow;
  }

  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: '日志分析 - Test cat',
    icon: path.join(__dirname, '../assets/modules/log-analysis.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#0e141d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  logAnalysisWindow = window;
  window.loadFile(path.join(__dirname, 'renderer/log-analysis.html'));
  window.once('ready-to-show', () => {
    window.show();
    if (process.argv.includes('--devtools')) window.webContents.openDevTools({ mode: 'detach' });
  });
  configureWindow(window);
  window.on('closed', () => {
    if (logAnalysisWindow === window) logAnalysisWindow = null;
    logAnalysisService?.stop(false);
  });
  return window;
}

function createAppPackageWindow() {
  if (appPackageWindow && !appPackageWindow.isDestroyed()) {
    if (appPackageWindow.isMinimized()) appPackageWindow.restore();
    appPackageWindow.show();
    appPackageWindow.focus();
    return appPackageWindow;
  }

  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 660,
    show: false,
    title: '安装包管理 - Test cat',
    icon: path.join(__dirname, '../assets/modules/app-package.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#0f151e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  appPackageWindow = window;
  window.loadFile(path.join(__dirname, 'renderer/app-package.html'));
  window.once('ready-to-show', () => {
    window.show();
    if (process.argv.includes('--devtools')) window.webContents.openDevTools({ mode: 'detach' });
  });
  configureWindow(window);
  window.on('closed', () => {
    if (appPackageWindow === window) appPackageWindow = null;
  });
  return window;
}

function createMockDataWindow() {
  if (mockDataWindow && !mockDataWindow.isDestroyed()) {
    if (mockDataWindow.isMinimized()) mockDataWindow.restore();
    mockDataWindow.show();
    mockDataWindow.focus();
    return mockDataWindow;
  }

  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 640,
    show: false,
    title: 'Mock 数据生成器 - Test cat',
    icon: path.join(__dirname, '../assets/modules/mock-data.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#0f151e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mockDataWindow = window;
  window.loadFile(path.join(__dirname, 'renderer/mock-data.html'));
  window.once('ready-to-show', () => {
    window.show();
    if (process.argv.includes('--devtools')) window.webContents.openDevTools({ mode: 'detach' });
  });
  configureWindow(window);
  window.on('closed', () => {
    if (mockDataWindow === window) mockDataWindow = null;
  });
  return window;
}

function createTimestampConverterWindow() {
  if (timestampConverterWindow && !timestampConverterWindow.isDestroyed()) {
    if (timestampConverterWindow.isMinimized()) timestampConverterWindow.restore();
    timestampConverterWindow.show();
    timestampConverterWindow.focus();
    return timestampConverterWindow;
  }

  const window = new BrowserWindow({
    width: 1080,
    height: 740,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: '时间戳转换 - Test cat',
    icon: path.join(__dirname, '../assets/modules/timestamp-converter.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#0f151e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  timestampConverterWindow = window;
  window.loadFile(path.join(__dirname, 'renderer/timestamp-converter.html'));
  window.once('ready-to-show', () => {
    window.show();
    if (process.argv.includes('--devtools')) window.webContents.openDevTools({ mode: 'detach' });
  });
  configureWindow(window);
  window.on('closed', () => {
    if (timestampConverterWindow === window) timestampConverterWindow = null;
  });
  return window;
}

function createFormulaCalculatorWindow() {
  if (formulaCalculatorWindow && !formulaCalculatorWindow.isDestroyed()) {
    if (formulaCalculatorWindow.isMinimized()) formulaCalculatorWindow.restore();
    formulaCalculatorWindow.show();
    formulaCalculatorWindow.focus();
    return formulaCalculatorWindow;
  }

  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: '公式运算 - Test cat',
    icon: path.join(__dirname, '../assets/modules/formula-calculator.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#0f151e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  formulaCalculatorWindow = window;
  window.loadFile(path.join(__dirname, 'renderer/formula-calculator.html'));
  window.once('ready-to-show', () => {
    window.show();
    if (process.argv.includes('--devtools')) window.webContents.openDevTools({ mode: 'detach' });
  });
  configureWindow(window);
  window.on('closed', () => {
    if (formulaCalculatorWindow === window) formulaCalculatorWindow = null;
  });
  return window;
}

function createAiTestAssistantWindow() {
  if (aiTestAssistantWindow && !aiTestAssistantWindow.isDestroyed()) {
    if (aiTestAssistantWindow.isMinimized()) aiTestAssistantWindow.restore();
    aiTestAssistantWindow.show();
    aiTestAssistantWindow.focus();
    return aiTestAssistantWindow;
  }

  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: 'AI 测试助手 - Test cat',
    icon: path.join(__dirname, '../assets/modules/ai-test-assistant.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: '#0f151e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  aiTestAssistantWindow = window;
  window.loadFile(path.join(__dirname, 'renderer/ai-test-assistant.html'));
  window.once('ready-to-show', () => {
    window.show();
    if (process.argv.includes('--devtools')) window.webContents.openDevTools({ mode: 'detach' });
  });
  configureWindow(window);
  window.on('closed', () => {
    if (aiTestAssistantWindow === window) aiTestAssistantWindow = null;
  });
  return window;
}

app.whenReady().then(() => {
  app.setName('Test cat');
  createApplicationMenu();
  captureSettings = loadCaptureSettings();
  companionPetSettings = loadCompanionPetSettings();
  aiSettings = loadAiSettings();
  const androidRuntimeRoots = [
    path.join(process.resourcesPath, 'platform-tools'),
    path.join(app.getAppPath(), 'resources', 'platform-tools')
  ];
  const iosRuntimeRoots = [
    path.join(process.resourcesPath, 'ios-performance-runtime'),
    path.join(app.getAppPath(), 'resources', 'ios-performance-runtime')
  ];
  mobileMirrorService = new MobileMirrorService({
    appPath: app.getAppPath(),
    runtimeRoots: androidRuntimeRoots,
    packaged: app.isPackaged,
    onStatus: (status) => {
      for (const window of [mainWindow, mobileMirrorWindow]) {
        if (window && !window.isDestroyed()) window.webContents.send('mobile-mirror:status', status);
      }
    }
  });
  iosMirrorService = new IosMirrorService({
    runtimeRoots: iosRuntimeRoots,
    packaged: app.isPackaged,
    ensureTunnel: async () => {
      if (!iosPerformanceService) throw new Error('iOS 性能桥接尚未初始化。');
      await iosPerformanceService.startTunnel();
      if (!await iosPerformanceService.waitForTunnel(15000)) throw new Error('iOS 性能桥接未就绪。');
    },
    onFrame: (frame) => {
      if (iosMirrorWindow && !iosMirrorWindow.isDestroyed()) iosMirrorWindow.webContents.send('ios-mirror:frame', frame);
    },
    onStatus: (status) => {
      if (iosMirrorWindow && !iosMirrorWindow.isDestroyed()) iosMirrorWindow.webContents.send('ios-mirror:status', status);
    }
  });
  iosPerformanceService = new IosPerformanceService({
    listDevices: () => iosMirrorService.listDevices(),
    runtimeRoots: iosRuntimeRoots,
    packaged: app.isPackaged,
    onSample: (sample) => {
      if (iosPerformanceWindow && !iosPerformanceWindow.isDestroyed()) iosPerformanceWindow.webContents.send('ios-performance:sample', sample);
    },
    onStatus: (status) => {
      if (iosPerformanceWindow && !iosPerformanceWindow.isDestroyed()) iosPerformanceWindow.webContents.send('ios-performance:status', status);
    }
  });
  iosPerformanceHistory = new IosPerformanceHistory(path.join(app.getPath('userData'), 'ios-performance'));
  performanceMonitorService = new PerformanceMonitorService({
    runtimeRoots: androidRuntimeRoots,
    packaged: app.isPackaged,
    onSample: (sample) => {
      if (performanceMonitorWindow && !performanceMonitorWindow.isDestroyed()) performanceMonitorWindow.webContents.send('performance-monitor:sample', sample);
    },
    onStatus: (status) => {
      if (performanceMonitorWindow && !performanceMonitorWindow.isDestroyed()) performanceMonitorWindow.webContents.send('performance-monitor:status', status);
    }
  });
  performanceMonitorHistory = new PerformanceMonitorHistory(path.join(app.getPath('userData'), 'android-performance'));
  weakNetworkService = new WeakNetworkService({
    appPath: app.getAppPath(),
    runtimeRoots: androidRuntimeRoots,
    packaged: app.isPackaged,
    onStatus: (status) => {
      if (weakNetworkWindow && !weakNetworkWindow.isDestroyed()) weakNetworkWindow.webContents.send('weak-network:status', status);
    },
    onStats: (stats) => {
      if (weakNetworkWindow && !weakNetworkWindow.isDestroyed()) weakNetworkWindow.webContents.send('weak-network:stats', stats);
    }
  });
  fileCompareService = new FileCompareService({
    dialog,
    getWindow: () => fileCompareWindow && !fileCompareWindow.isDestroyed() ? fileCompareWindow : mainWindow
  });
  logAnalysisService = new LogAnalysisService({
    dialog,
    appPath: app.getAppPath(),
    runtimeRoots: androidRuntimeRoots,
    packaged: app.isPackaged,
    getWindow: () => logAnalysisWindow && !logAnalysisWindow.isDestroyed() ? logAnalysisWindow : mainWindow,
    onLogs: (records) => {
      if (logAnalysisWindow && !logAnalysisWindow.isDestroyed()) logAnalysisWindow.webContents.send('log-analysis:logs', records);
    },
    onStatus: (status) => {
      if (logAnalysisWindow && !logAnalysisWindow.isDestroyed()) logAnalysisWindow.webContents.send('log-analysis:status', status);
    }
  });
  appPackageService = new AppPackageService({
    dialog,
    appPath: app.getAppPath(),
    runtimeRoots: androidRuntimeRoots,
    iosRuntimeRoots,
    packaged: app.isPackaged,
    getWindow: () => appPackageWindow && !appPackageWindow.isDestroyed() ? appPackageWindow : mainWindow
  });
  aiTestAssistantService = new AiTestAssistantService({
    dialog,
    getWindow: () => aiTestAssistantWindow && !aiTestAssistantWindow.isDestroyed() ? aiTestAssistantWindow : mainWindow,
    getSettings: () => aiSettings || DEFAULT_AI_SETTINGS
  });
  setupIpc();
  registerCaptureShortcuts();
  createWindow();
  applyCompanionPetSettings();

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

app.on('will-quit', () => {
  unregisterCaptureShortcuts();
});

app.on('before-quit', (event) => {
  if (quitCleanupFinished) return;
  event.preventDefault();
  if (quitCleanupStarted) return;
  quitCleanupStarted = true;
  clearCompanionPetTimers();
  Promise.allSettled([
    mobileMirrorService?.dispose(),
    iosMirrorService?.dispose(),
    iosPerformanceService?.dispose(),
    performanceMonitorService?.dispose(),
    weakNetworkService?.dispose(),
    logAnalysisService?.dispose()
  ]).finally(() => {
    quitCleanupFinished = true;
    app.quit();
  });
});
