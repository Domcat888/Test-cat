import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const checks = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function exists(relativePath, label = relativePath) {
  const present = fs.existsSync(path.join(root, relativePath));
  checks.push({ label, present });
  if (!present) failures.push(label);
  return present;
}

function requireCondition(condition, label) {
  checks.push({ label, present: Boolean(condition) });
  if (!condition) failures.push(label);
}

const packageJson = JSON.parse(read('package.json'));
const windowsConfig = JSON.parse(read('electron-builder.win.json'));
const catalinaConfig = JSON.parse(read('electron-builder.catalina.json'));
const appSource = read('src/renderer/app.js');
const preloadSource = read('src/preload.js');
const mainSource = read('src/main.js');

const registry = appSource.match(/const BUILT_IN_TOOL_IDS = \[([^\]]+)]/)?.[1] || '';
const moduleIds = [...registry.matchAll(/'([^']+)'/g)].map((match) => match[1]);
const modules = {
  'mobile-mirror': ['src/renderer/mobile-mirror.html', 'assets/modules/mobile-mirror.png'],
  'ios-mirror': ['src/renderer/ios-mirror.html', 'assets/modules/mobile-mirror.png'],
  'ios-performance': ['src/renderer/ios-performance.html', 'assets/modules/performance-monitor.png'],
  'ios-app-manager': ['src/renderer/app-package.html', 'assets/modules/app-package.png'],
  calculator: ['src/renderer/calculator.html', 'assets/modules/calculator.png'],
  'performance-monitor': ['src/renderer/performance-monitor.html', 'assets/modules/performance-monitor.png'],
  'weak-network': ['src/renderer/weak-network.html', 'assets/modules/weak-network.png'],
  'file-compare': ['src/renderer/file-compare.html', 'assets/modules/file-compare.png'],
  'log-analysis': ['src/renderer/log-analysis.html', 'assets/modules/log-analysis.png'],
  'app-package': ['src/renderer/app-package.html', 'assets/modules/app-package.png'],
  'mock-data': ['src/renderer/mock-data.html', 'assets/modules/mock-data.png'],
  'timestamp-converter': ['src/renderer/timestamp-converter.html', 'assets/modules/timestamp-converter.png'],
  'formula-calculator': ['src/renderer/formula-calculator.html', 'assets/modules/formula-calculator.png'],
  'pixel-ruler': ['src/renderer/pixel-ruler.html', 'src/renderer/pixel-ruler-overlay.html', 'assets/modules/pixel-ruler.png']
};

requireCondition(moduleIds.length === Object.keys(modules).length, '功能模块注册表完整');
for (const id of moduleIds) {
  requireCondition(Boolean(modules[id]), `模块 ${id} 已纳入跨平台检查`);
  for (const file of modules[id] || []) exists(file, `模块 ${id} 资源：${file}`);
}

const invokedChannels = new Set([...preloadSource.matchAll(/ipcRenderer\.invoke\(['"]([^'"]+)/g)].map((match) => match[1]));
const handledChannels = new Set([...mainSource.matchAll(/ipcMain\.handle\(['"]([^'"]+)/g)].map((match) => match[1]));
requireCondition([...invokedChannels].every((channel) => handledChannels.has(channel)), 'Preload IPC 均有主进程处理器');
requireCondition([...handledChannels].every((channel) => invokedChannels.has(channel)), '主进程 IPC 均已暴露给页面');

const commonResources = [
  'resources/scrcpy/scrcpy-server-v3.3.1',
  'resources/weak-network/sockstun-agent.apk',
  'src/ios-performance-helper.py',
  'src/ios-mirror-helper.py',
  'src/ios-valeria-helper.py'
];
for (const file of commonResources) exists(file, `公共运行资源：${file}`);

const platformResources = {
  'macOS Apple Silicon': [
    'resources/platform-tools/darwin-arm64/adb',
    'resources/ios-performance-runtime/darwin-arm64/bin/python3',
    'resources/ios-performance-runtime/darwin-arm64/lib/python3.10/site-packages/pymobiledevice3'
  ],
  'macOS Intel': [
    'resources/platform-tools/darwin-x64/adb',
    'resources/ios-performance-runtime/darwin-x64/bin/python3',
    'resources/ios-performance-runtime/darwin-x64/lib/python3.10/site-packages/pymobiledevice3'
  ],
  'Windows x64': [
    'resources/platform-tools/win32-x64/adb.exe',
    'resources/platform-tools/win32-x64/AdbWinApi.dll',
    'resources/platform-tools/win32-x64/AdbWinUsbApi.dll',
    'resources/ios-performance-runtime/win32-x64/python.exe',
    'resources/ios-performance-runtime/win32-x64/Lib/site-packages/pymobiledevice3',
    'resources/ios-performance-runtime/win32-x64/Lib/site-packages/win32'
  ]
};
for (const [platform, files] of Object.entries(platformResources)) {
  for (const file of files) exists(file, `${platform}：${file}`);
}

const windowsExtraResources = JSON.stringify(windowsConfig.extraResources || []);
requireCondition(windowsExtraResources.includes('win32-x64'), 'Windows 构建包含 x64 ADB 与 iOS 运行时');
requireCondition(catalinaConfig.mac?.minimumSystemVersion === '10.15.0', 'Catalina 构建最低系统版本为 10.15');
requireCondition(catalinaConfig.electronVersion === '28.3.3', 'Catalina 构建使用兼容 Electron 28');
requireCondition(Boolean(packageJson.build?.mac?.extendInfo?.NSScreenCaptureUsageDescription), 'macOS 构建声明屏幕录制权限用途');
requireCondition(Boolean(catalinaConfig.mac?.extendInfo?.NSScreenCaptureUsageDescription), 'Catalina 构建声明屏幕录制权限用途');

if (failures.length) {
  process.stderr.write(`跨平台检查失败（${failures.length} 项）：\n- ${failures.join('\n- ')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`跨平台静态检查通过：${moduleIds.length} 个功能模块，${checks.length} 项资源与配置。\n`);
  process.stdout.write('目标：macOS Apple Silicon、macOS Intel/Catalina、Windows x64。\n');
}
