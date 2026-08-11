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

async function run(executable, args, timeout = 10 * 60 * 1000) {
  return execFileAsync(executable, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
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

async function validate(adb) {
  try {
    const result = await run(adb, ['version'], 30000);
    return /Android Debug Bridge/i.test(result.stdout);
  } catch {
    return false;
  }
}

async function validateRuntime(adb, platform) {
  if (platform === process.platform) return validate(adb);
  try {
    const stat = await fs.stat(adb);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

async function pruneRuntime(runtimeRoot, platform) {
  try {
    const entries = await fs.readdir(runtimeRoot, { withFileTypes: true });
    const keep = new Set(['adb', 'adb.exe', 'NOTICE.txt', 'source.properties', 'test-cat-runtime.json']);
    for (const entry of entries) {
      if (keep.has(entry.name) || platform === 'win32' && entry.name.toLowerCase().endsWith('.dll')) continue;
      await fs.rm(path.join(runtimeRoot, entry.name), { recursive: true, force: true });
    }
  } catch {}
}

async function extract(archive, destination) {
  await fs.mkdir(destination, { recursive: true });
  if (process.platform === 'win32') {
    await run('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${destination.replaceAll("'", "''")}' -Force`]);
    return;
  }
  await run('/usr/bin/ditto', ['-x', '-k', archive, destination]);
}

async function main() {
  const platform = option('platform', process.platform);
  const arch = normalizeArch(option('arch', process.arch));
  if (!['darwin', 'win32'].includes(platform)) throw new Error('Android Platform Tools 运行时仅支持 Windows 和 macOS。');
  if (platform === 'win32' && arch !== 'x64') throw new Error('当前 Windows 安装包仅支持 x64。');
  if (platform === 'darwin' && !['arm64', 'x64'].includes(arch)) throw new Error(`不支持的 macOS 架构：${arch}`);

  const runtimeRoot = path.join(projectRoot, 'resources', 'platform-tools');
  const targetRoot = path.join(runtimeRoot, `${platform}-${arch}`);
  const executable = platform === 'win32' ? 'adb.exe' : 'adb';
  const adb = path.join(targetRoot, executable);
  await pruneRuntime(targetRoot, platform);
  if (await validateRuntime(adb, platform)) {
    process.stdout.write(`Android Platform Tools runtime is ready: ${targetRoot}\n`);
    return;
  }

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'test-cat-platform-tools-'));
  const stagingRoot = `${targetRoot}.staging-${process.pid}`;
  const archive = path.join(temporaryRoot, 'platform-tools.zip');
  try {
    const suffix = platform === 'win32' ? 'windows' : 'darwin';
    await download(`https://dl.google.com/android/repository/platform-tools-latest-${suffix}.zip`, archive);
    await extract(archive, temporaryRoot);
    const extractedRoot = path.join(temporaryRoot, 'platform-tools');
    await fs.rm(stagingRoot, { recursive: true, force: true });
    await fs.mkdir(runtimeRoot, { recursive: true });
    await fs.rename(extractedRoot, stagingRoot);
    const stagedAdb = path.join(stagingRoot, executable);
    if (platform !== 'win32') await fs.chmod(stagedAdb, 0o755);
    await pruneRuntime(stagingRoot, platform);
    if (!await validateRuntime(stagedAdb, platform)) throw new Error('内置 Android Platform Tools 校验失败。');
    await fs.writeFile(path.join(stagingRoot, 'test-cat-runtime.json'), JSON.stringify({ platform, arch, source: 'Google Android SDK Platform Tools', createdAt: new Date().toISOString() }, null, 2));
    await fs.rm(targetRoot, { recursive: true, force: true });
    await fs.mkdir(runtimeRoot, { recursive: true });
    await fs.rename(stagingRoot, targetRoot);
    process.stdout.write(`Prepared Android Platform Tools runtime: ${targetRoot}\n`);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    await fs.rm(stagingRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message || error}\n`);
  process.exitCode = 1;
});
