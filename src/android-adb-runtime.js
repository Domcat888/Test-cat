const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function androidAdbCandidates({
  runtimeRoots = [],
  appPath = '',
  resourcesPath = process.resourcesPath || '',
  environment = process.env,
  platform = process.platform,
  arch = process.arch,
  includeSdk = true
} = {}) {
  const executable = platform === 'win32' ? 'adb.exe' : 'adb';
  const platformDir = `${platform}-${arch}`;
  const roots = unique([
    ...runtimeRoots,
    resourcesPath && path.join(resourcesPath, 'platform-tools'),
    resourcesPath && path.join(resourcesPath, 'app.asar.unpacked', 'resources', 'platform-tools'),
    appPath && path.join(appPath, 'resources', 'platform-tools')
  ]);
  const home = environment.HOME || environment.USERPROFILE || '';
  const sdkRoots = includeSdk ? unique([
    environment.ANDROID_HOME,
    environment.ANDROID_SDK_ROOT,
    platform === 'win32' && environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, 'Android', 'Sdk'),
    platform === 'win32' && environment.USERPROFILE && path.join(environment.USERPROFILE, 'AppData', 'Local', 'Android', 'Sdk'),
    platform !== 'win32' && home && path.join(home, 'Library', 'Android', 'sdk'),
    platform !== 'win32' && home && path.join(home, 'Android', 'Sdk')
  ]) : [];

  return unique([
    environment.ADB_PATH,
    ...roots.map((root) => path.join(root, platformDir, executable)),
    ...sdkRoots.map((root) => path.join(root, 'platform-tools', executable)),
    ...(includeSdk && platform === 'darwin' ? ['/opt/homebrew/bin/adb', '/usr/local/bin/adb'] : []),
    executable
  ]);
}

function adbSource(candidate, options = {}) {
  if (candidate === options.environment?.ADB_PATH) return 'configured';
  const runtimeRoots = options.runtimeRoots || [];
  const resourcesPath = options.resourcesPath || '';
  const appPath = options.appPath || '';
  const bundledRoots = unique([
    ...runtimeRoots,
    resourcesPath && path.join(resourcesPath, 'platform-tools'),
    resourcesPath && path.join(resourcesPath, 'app.asar.unpacked', 'resources', 'platform-tools'),
    appPath && path.join(appPath, 'resources', 'platform-tools')
  ]);
  if (bundledRoots.some((root) => candidate === root || candidate.startsWith(`${root}${path.sep}`))) return 'bundled';
  return path.isAbsolute(candidate) ? 'sdk' : 'system';
}

async function resolveAndroidAdb({
  candidates,
  probeArgs = ['start-server'],
  timeout = 15000,
  maxBuffer = 1024 * 1024,
  run = execFileAsync,
  errorMessage = '未找到可用的 Android 调试引擎，请重新安装 Test cat。',
  sourceOptions = {}
}) {
  let lastError = null;
  const attempts = [];
  for (const candidate of unique(candidates || [])) {
    try {
      await run(candidate, probeArgs, { timeout, windowsHide: true, maxBuffer });
      return { path: candidate, source: adbSource(candidate, sourceOptions) };
    } catch (error) {
      lastError = error;
      attempts.push({ candidate, code: error?.code || '', message: error?.message || String(error) });
    }
  }
  const error = new Error(errorMessage);
  error.cause = lastError;
  error.attempts = attempts;
  throw error;
}

module.exports = { adbSource, androidAdbCandidates, resolveAndroidAdb };
