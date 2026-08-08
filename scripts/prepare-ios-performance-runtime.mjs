import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const PYTHON_VERSION = '3.10.11';
const PYMOBILEDEVICE3_VERSION = '10.3.1';
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function option(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function normalizeArch(value) {
  if (value === 'aarch64') return 'arm64';
  if (value === 'amd64' || value === 'x86_64') return 'x64';
  return value;
}

async function download(url, destination) {
  const curl = process.platform === 'win32' ? 'curl.exe' : 'curl';
  try {
    await run(curl, ['-fL', '--retry', '3', '--connect-timeout', '15', '-A', 'Test-cat-runtime-builder', '-o', destination, url], 20 * 60 * 1000);
    return;
  } catch {}
  const response = await fetch(url, { headers: { 'user-agent': 'Test-cat-runtime-builder' }, redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`下载失败（${response.status}）：${url}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

async function downloadText(url) {
  const curl = process.platform === 'win32' ? 'curl.exe' : 'curl';
  try {
    const result = await run(curl, ['-fL', '--retry', '3', '--connect-timeout', '15', '-A', 'Test-cat-runtime-builder', url], 60000);
    return result.stdout;
  } catch {}
  const response = await fetch(url, { headers: { 'user-agent': 'Test-cat-runtime-builder' }, redirect: 'follow' });
  if (!response.ok) throw new Error(`读取下载信息失败（${response.status}）：${url}`);
  return response.text();
}

async function run(executable, args, timeout = 10 * 60 * 1000) {
  return execFileAsync(executable, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
}

async function validate(python) {
  try {
    await run(python, ['-c', `import pymobiledevice3; print('${PYMOBILEDEVICE3_VERSION}')`], 30000);
    return true;
  } catch {
    return false;
  }
}

async function prepareWindows(tempRoot, targetRoot, arch) {
  if (arch !== 'x64') throw new Error('当前 Windows 内置运行时仅支持 x64。');
  const archive = path.join(tempRoot, 'python-embed.zip');
  const getPip = path.join(tempRoot, 'get-pip.py');
  await download(`https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`, archive);
  await download('https://bootstrap.pypa.io/get-pip.py', getPip);
  await fs.mkdir(targetRoot, { recursive: true });
  await run('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${targetRoot.replaceAll("'", "''")}' -Force`]);

  const pthPath = path.join(targetRoot, 'python310._pth');
  const lines = (await fs.readFile(pthPath, 'utf8')).split(/\r?\n/).filter((line) => !/^#?import site$/.test(line) && line !== 'Lib\\site-packages');
  await fs.writeFile(pthPath, `${lines.filter(Boolean).join('\r\n')}\r\nLib\\site-packages\r\nimport site\r\n`, 'ascii');
  const python = path.join(targetRoot, 'python.exe');
  await run(python, [getPip, '--no-warn-script-location', '--disable-pip-version-check']);
  await run(python, ['-m', 'pip', 'install', '--no-cache-dir', '--disable-pip-version-check', `pymobiledevice3==${PYMOBILEDEVICE3_VERSION}`]);
  const postInstall = path.join(targetRoot, 'Scripts', 'pywin32_postinstall.py');
  try { await fs.access(postInstall); await run(python, [postInstall, '-install']); } catch {}
  return python;
}

async function latestMacPythonAsset(arch) {
  const release = JSON.parse(await downloadText('https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest'));
  const machine = arch === 'arm64' ? 'aarch64' : 'x86_64';
  const pattern = new RegExp(`^cpython-3\\.10\\.\\d+\\+.+-${machine}-apple-darwin-install_only\\.tar\\.gz$`);
  const asset = release.assets?.find((item) => pattern.test(item.name));
  if (!asset) throw new Error(`最新 Python standalone 发布中没有 macOS ${arch} 的 Python 3.10 运行时。`);
  return asset.browser_download_url;
}

async function prepareMac(tempRoot, targetRoot, arch) {
  if (!['arm64', 'x64'].includes(arch)) throw new Error(`不支持的 macOS 架构：${arch}`);
  const archive = path.join(tempRoot, 'python-standalone.tar.gz');
  await download(await latestMacPythonAsset(arch), archive);
  await fs.mkdir(targetRoot, { recursive: true });
  await run('/usr/bin/tar', ['-xzf', archive, '-C', targetRoot, '--strip-components=1']);
  const python = path.join(targetRoot, 'bin', 'python3');
  await run(python, ['-m', 'ensurepip', '--upgrade']);
  await run(python, ['-m', 'pip', 'install', '--no-cache-dir', '--disable-pip-version-check', `pymobiledevice3==${PYMOBILEDEVICE3_VERSION}`]);
  return python;
}

async function main() {
  const platform = option('platform', process.platform);
  const arch = normalizeArch(option('arch', process.arch));
  if (!['darwin', 'win32'].includes(platform)) throw new Error('iOS 性能运行时只能为 Windows 或 macOS 构建。');
  if (platform !== process.platform) throw new Error(`请在目标系统上构建运行时：当前 ${process.platform}，目标 ${platform}。`);

  const runtimeRoot = path.join(projectRoot, 'resources', 'ios-performance-runtime');
  const targetRoot = path.join(runtimeRoot, `${platform}-${arch}`);
  const python = platform === 'win32' ? path.join(targetRoot, 'python.exe') : path.join(targetRoot, 'bin', 'python3');
  if (await validate(python)) {
    process.stdout.write(`iOS performance runtime is ready: ${targetRoot}\n`);
    return;
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'test-cat-ios-runtime-'));
  const stagingRoot = `${targetRoot}.staging-${process.pid}`;
  try {
    await fs.rm(stagingRoot, { recursive: true, force: true });
    const preparedPython = platform === 'win32'
      ? await prepareWindows(tempRoot, stagingRoot, arch)
      : await prepareMac(tempRoot, stagingRoot, arch);
    if (!await validate(preparedPython)) throw new Error('内置 iOS 采集引擎校验失败。');
    await fs.writeFile(path.join(stagingRoot, 'test-cat-runtime.json'), JSON.stringify({ platform, arch, pythonVersion: PYTHON_VERSION, pymobiledevice3Version: PYMOBILEDEVICE3_VERSION, createdAt: new Date().toISOString() }, null, 2));
    await fs.rm(targetRoot, { recursive: true, force: true });
    await fs.mkdir(runtimeRoot, { recursive: true });
    await fs.rename(stagingRoot, targetRoot);
    process.stdout.write(`Prepared iOS performance runtime: ${targetRoot}\n`);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.rm(stagingRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message || error}\n`);
  process.exitCode = 1;
});
