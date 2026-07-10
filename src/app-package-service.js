const path = require('node:path');
const fs = require('node:fs/promises');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const UTF8_FLAG = 0x00000100;
const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;
const TYPE_INT_BOOLEAN = 0x12;

function normalizeModel(value) {
  return String(value || '').replace(/_/g, ' ').trim();
}

function parseDeviceList(output) {
  return String(output || '').split(/\r?\n/).slice(1).map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split(/\s+/);
    const serial = parts[0] || '';
    const state = parts[1] || 'unknown';
    const model = /model:([^\s]+)/.exec(line)?.[1] || '';
    const product = /product:([^\s]+)/.exec(line)?.[1] || '';
    const transport = /transport_id:([^\s]+)/.exec(line)?.[1] || '';
    return {
      serial,
      state,
      model: normalizeModel(model) || serial,
      product,
      transport,
      label: (normalizeModel(model) || serial) + ' · ' + serial
    };
  });
}

function parseInstalledPackages(output) {
  return String(output || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const versionCode = /\sversionCode:([^\s]+)/i.exec(line)?.[1] || '';
    const clean = line.replace(/\sversionCode:[^\s]+/i, '');
    const payload = clean.replace(/^package:/, '');
    const splitIndex = payload.lastIndexOf('=');
    const apkPath = splitIndex >= 0 ? payload.slice(0, splitIndex) : '';
    const packageName = splitIndex >= 0 ? payload.slice(splitIndex + 1) : payload;
    const system = /^\/(system|product|vendor|apex|odm)\//.test(apkPath);
    return {
      packageName,
      apkPath,
      versionCode,
      system,
      label: packageName
    };
  }).filter((item) => item.packageName);
}

function classifyAdbFailure(error, fallback = 'ADB 操作失败') {
  const raw = String(error?.stdout || error?.stderr || error?.message || error || '');
  const installFailure = classifyInstallFailure(error);
  if (installFailure.code !== 'unknown') return installFailure;
  return { code: 'adb-error', message: raw.trim() || fallback, raw };
}

function classifyClearDataFailure(error) {
  const raw = String(error?.stdout || error?.stderr || error?.message || error || '');
  const rules = [
    [
      /CLEAR_APP_USER_DATA|does not have permission .*clear data|SecurityException[\s\S]*clear data/i,
      'clear-data-permission-denied',
      '清除数据失败：当前设备系统禁止 ADB 清除该应用数据。请在手机「设置 → 应用 → 存储」里手动清除，或先卸载应用后重新安装；如果是测试机/企业管控设备，需要放开 USB 调试清数据权限。'
    ],
    [
      /run-as: package not debuggable|Package .* is not debuggable|run-as:.*not debuggable/i,
      'run-as-not-debuggable',
      '清除数据失败：设备禁止标准清数据，且该应用不是 debuggable 包，无法使用 run-as 兜底清理。请手动清除数据，或卸载后重新安装。'
    ],
    [
      /Unknown package|not installed|Unable to find package|Can't find package/i,
      'package-not-found',
      '清除数据失败：设备上未找到该包名，请重新读取已安装应用列表。'
    ],
    [
      /device unauthorized|unauthorized/i,
      'unauthorized',
      '设备未授权：请在手机上允许 USB 调试。'
    ],
    [
      /device offline|offline/i,
      'offline',
      '设备离线：请重新连接数据线或重启 ADB。'
    ],
    [
      /no devices|device .* not found|more than one device/i,
      'device-missing',
      '没有找到目标设备，请确认设备已连接并选择正确设备。'
    ]
  ];
  const matched = rules.find(([pattern]) => pattern.test(raw));
  if (matched) return { code: matched[1], message: matched[2], raw };
  return classifyAdbFailure(error, '清除数据失败');
}

function classifyInstallFailure(error) {
  const raw = String(error?.stdout || error?.stderr || error?.message || error || '');
  const rules = [
    [/INSTALL_FAILED_VERSION_DOWNGRADE|version downgrade/i, 'version-downgrade', '安装失败：目标设备已有更高版本，请勾选“允许降级”或先卸载旧版本。'],
    [/INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match|UPDATE_INCOMPATIBLE/i, 'signature-mismatch', '安装失败：设备上已有同包名但签名不同的应用，请先卸载旧应用。'],
    [/INSTALL_FAILED_INSUFFICIENT_STORAGE|not enough space|No space left/i, 'insufficient-storage', '安装失败：设备存储空间不足，请清理空间后重试。'],
    [/INSTALL_FAILED_USER_RESTRICTED|USER_RESTRICTED|install canceled by user|用户拒绝|禁止安装/i, 'user-restricted', '安装失败：手机禁止通过 USB 安装，请开启“USB 安装/通过 USB 验证应用”并保持手机解锁。'],
    [/INSTALL_FAILED_NO_MATCHING_ABIS|NO_MATCHING_ABIS/i, 'abi-mismatch', '安装失败：安装包 CPU 架构与设备不匹配。'],
    [/INSTALL_FAILED_OLDER_SDK|OLDER_SDK/i, 'older-sdk', '安装失败：设备 Android 版本低于安装包要求。'],
    [/INSTALL_FAILED_INVALID_APK|invalid apk|ParseException/i, 'invalid-apk', '安装失败：APK 文件无效或已损坏。'],
    [/INSTALL_FAILED_TEST_ONLY|testOnly/i, 'test-only', '安装失败：testOnly 包需要允许测试包安装。'],
    [/INSTALL_FAILED_MISSING_SHARED_LIBRARY|MISSING_SHARED_LIBRARY/i, 'missing-library', '安装失败：设备缺少应用依赖的共享库。'],
    [/INSTALL_FAILED_VERIFICATION_FAILURE|VERIFICATION_FAILURE/i, 'verification-failure', '安装失败：系统安装验证未通过，请检查安全策略或安装包签名。'],
    [/device unauthorized|unauthorized/i, 'unauthorized', '设备未授权：请在手机上允许 USB 调试。'],
    [/device offline|offline/i, 'offline', '设备离线：请重新连接数据线或重启 ADB。'],
    [/no devices|device .* not found|more than one device/i, 'device-missing', '没有找到目标设备，请确认设备已连接并选择正确设备。'],
    [/Permission denied|权限/i, 'permission-denied', '操作被拒绝：请检查设备授权或系统权限。']
  ];
  const matched = rules.find(([pattern]) => pattern.test(raw));
  if (matched) return { code: matched[1], message: matched[2], raw };
  return { code: 'unknown', message: raw.trim() || '安装失败：ADB 未返回明确原因。', raw };
}

function assertSafeAndroidPackageName(packageName) {
  const safe = String(packageName || '').trim();
  if (!/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(safe)) throw new Error('包名格式不正确，已取消清除数据操作。');
  return safe;
}

function readZipEntries(buffer) {
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 66000); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('不是有效的 ZIP/APK/IPA 文件');
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { entries, centralOffset };
}

function readZipEntry(buffer, entry) {
  const offset = entry.localOffset;
  if (buffer.readUInt32LE(offset) !== 0x04034b50) throw new Error('ZIP 条目损坏：' + entry.name);
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataOffset = offset + 30 + nameLength + extraLength;
  const data = buffer.subarray(dataOffset, dataOffset + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error('暂不支持的 ZIP 压缩方式：' + entry.method);
}

function findZipEntry(entries, name) {
  const target = String(name || '').toLowerCase();
  return entries.find((entry) => entry.name.toLowerCase() === target);
}

function readUtf8Length(buffer, offset) {
  let value = buffer[offset];
  if ((value & 0x80) === 0) return { value, size: 1 };
  value = ((value & 0x7f) << 8) | buffer[offset + 1];
  return { value, size: 2 };
}

function readUtf16Length(buffer, offset) {
  let value = buffer.readUInt16LE(offset);
  if ((value & 0x8000) === 0) return { value, size: 2 };
  value = ((value & 0x7fff) << 16) | buffer.readUInt16LE(offset + 2);
  return { value, size: 4 };
}

function parseStringPool(buffer, offset) {
  const chunkSize = buffer.readUInt32LE(offset + 4);
  const stringCount = buffer.readUInt32LE(offset + 8);
  const flags = buffer.readUInt32LE(offset + 16);
  const stringsStart = buffer.readUInt32LE(offset + 20);
  const isUtf8 = Boolean(flags & UTF8_FLAG);
  const strings = [];
  for (let index = 0; index < stringCount; index += 1) {
    const stringOffset = offset + stringsStart + buffer.readUInt32LE(offset + 28 + index * 4);
    if (isUtf8) {
      const first = readUtf8Length(buffer, stringOffset);
      const second = readUtf8Length(buffer, stringOffset + first.size);
      const start = stringOffset + first.size + second.size;
      strings.push(buffer.toString('utf8', start, start + second.value));
    } else {
      const length = readUtf16Length(buffer, stringOffset);
      const start = stringOffset + length.size;
      strings.push(buffer.toString('utf16le', start, start + length.value * 2));
    }
  }
  return { strings, nextOffset: offset + chunkSize };
}

function stringAt(strings, index) {
  return index === 0xffffffff || index < 0 ? '' : strings[index] || '';
}

function typedValue(buffer, attrOffset, strings) {
  const dataType = buffer.readUInt8(attrOffset + 15);
  const data = buffer.readUInt32LE(attrOffset + 16);
  if (dataType === TYPE_STRING) return stringAt(strings, data);
  if (dataType === TYPE_INT_DEC || dataType === TYPE_INT_HEX) return String(data);
  if (dataType === TYPE_INT_BOOLEAN) return data ? 'true' : 'false';
  return '';
}

function parseAndroidBinaryManifest(buffer) {
  if (buffer.readUInt16LE(0) !== 0x0003) throw new Error('AndroidManifest.xml 不是二进制 XML');
  let offset = 8;
  let strings = [];
  const manifest = { usesPermissions: [] };
  while (offset < buffer.length) {
    const type = buffer.readUInt16LE(offset);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (!chunkSize) break;
    if (type === 0x0001) {
      strings = parseStringPool(buffer, offset).strings;
    } else if (type === 0x0102) {
      const elementName = stringAt(strings, buffer.readUInt32LE(offset + 20));
      const attributeStart = buffer.readUInt16LE(offset + 24);
      const attributeSize = buffer.readUInt16LE(offset + 26);
      const attributeCount = buffer.readUInt16LE(offset + 28);
      const attrs = {};
      const attrBase = offset + 16 + attributeStart;
      for (let index = 0; index < attributeCount; index += 1) {
        const attrOffset = attrBase + index * attributeSize;
        const name = stringAt(strings, buffer.readUInt32LE(attrOffset + 4));
        const rawIndex = buffer.readUInt32LE(attrOffset + 8);
        attrs[name] = rawIndex !== 0xffffffff ? stringAt(strings, rawIndex) : typedValue(buffer, attrOffset, strings);
      }
      if (elementName === 'manifest') {
        manifest.packageName = attrs.package || manifest.packageName;
        manifest.versionName = attrs.versionName || manifest.versionName;
        manifest.versionCode = attrs.versionCode || attrs.versionCodeMajor || manifest.versionCode;
      } else if (elementName === 'uses-sdk') {
        manifest.minSdk = attrs.minSdkVersion || manifest.minSdk;
        manifest.targetSdk = attrs.targetSdkVersion || manifest.targetSdk;
      } else if (elementName === 'application') {
        manifest.appLabel = attrs.label || manifest.appLabel;
        manifest.debuggable = attrs.debuggable || manifest.debuggable;
      } else if (elementName === 'uses-permission' && attrs.name) {
        manifest.usesPermissions.push(attrs.name);
      }
    }
    offset += chunkSize;
  }
  if (!manifest.packageName) throw new Error('未能解析 APK 包名');
  return manifest;
}

function parseAndroidManifestXml(text) {
  const pick = (name) => {
    const pattern = new RegExp('(?:android:)?' + name + '=["\\\']([^"\\\']+)["\\\']', 'i');
    return pattern.exec(text)?.[1] || '';
  };
  const packageName = /<manifest[^>]*\spackage=["']([^"']+)["']/i.exec(text)?.[1] || '';
  const permissions = [...text.matchAll(/<uses-permission[^>]*(?:android:)?name=["']([^"']+)["']/gi)].map((item) => item[1]);
  return {
    packageName,
    versionName: pick('versionName'),
    versionCode: pick('versionCode'),
    minSdk: /<uses-sdk[^>]*(?:android:)?minSdkVersion=["']([^"']+)["']/i.exec(text)?.[1] || '',
    targetSdk: /<uses-sdk[^>]*(?:android:)?targetSdkVersion=["']([^"']+)["']/i.exec(text)?.[1] || '',
    appLabel: /<application[^>]*(?:android:)?label=["']([^"']+)["']/i.exec(text)?.[1] || '',
    debuggable: /<application[^>]*(?:android:)?debuggable=["']([^"']+)["']/i.exec(text)?.[1] || '',
    usesPermissions: permissions
  };
}

function parseAndroidManifest(buffer) {
  const textStart = buffer.subarray(0, 80).toString('utf8').trimStart();
  if (textStart.startsWith('<')) return parseAndroidManifestXml(buffer.toString('utf8'));
  return parseAndroidBinaryManifest(buffer);
}

function hasApkSigningBlock(buffer, centralOffset) {
  if (centralOffset < 24) return false;
  return buffer.subarray(centralOffset - 16, centralOffset).toString('utf8') === 'APK Sig Block 42';
}

function hashHex(buffer, algorithm) {
  return crypto.createHash(algorithm).update(buffer).digest('hex');
}

function formatAndroidSdkVersion(value) {
  const sdk = Number.parseInt(value, 10);
  if (!Number.isFinite(sdk)) return String(value || '');
  const names = {
    21: 'Android 5.0 (LOLLIPOP)',
    22: 'Android 5.1 (LOLLIPOP_MR1)',
    23: 'Android 6.0 (MARSHMALLOW)',
    24: 'Android 7.0 (NOUGAT)',
    25: 'Android 7.1 (NOUGAT_MR1)',
    26: 'Android 8.0 (OREO)',
    27: 'Android 8.1 (OREO_MR1)',
    28: 'Android 9 (PIE)',
    29: 'Android 10 (Q)',
    30: 'Android 11 (R)',
    31: 'Android 12 (S)',
    32: 'Android 12L (S_V2)',
    33: 'Android 13 (TIRAMISU)',
    34: 'Android 14 (UPSIDE_DOWN_CAKE)',
    35: 'Android 15 (VANILLA_ICE_CREAM)',
    36: 'Android 16'
  };
  return names[sdk] || `Android API ${sdk}`;
}

function parseApkInfo(buffer, filePath, zip) {
  const manifestEntry = findZipEntry(zip.entries, 'AndroidManifest.xml');
  if (!manifestEntry) throw new Error('APK 中没有 AndroidManifest.xml');
  const manifest = parseAndroidManifest(readZipEntry(buffer, manifestEntry));
  const certEntries = zip.entries.filter((entry) => /^META-INF\/[^/]+\.(RSA|DSA|EC)$/i.test(entry.name));
  const certs = certEntries.map((entry) => {
    const data = readZipEntry(buffer, entry);
    return { name: entry.name, md5: hashHex(data, 'md5'), sha1: hashHex(data, 'sha1'), sha256: hashHex(data, 'sha256') };
  });
  const minSdk = manifest.minSdk || '';
  const targetSdk = manifest.targetSdk || '';
  return {
    type: 'apk',
    filePath,
    fileName: path.basename(filePath),
    fileSize: buffer.length,
    md5: hashHex(buffer, 'md5'),
    sha1: hashHex(buffer, 'sha1'),
    sha256: hashHex(buffer, 'sha256'),
    packageName: manifest.packageName || '',
    appName: manifest.appLabel || '',
    versionName: manifest.versionName || '',
    versionCode: manifest.versionCode || '',
    minSdk,
    minSdkLabel: minSdk ? formatAndroidSdkVersion(minSdk) : '',
    targetSdk,
    targetSdkLabel: targetSdk ? formatAndroidSdkVersion(targetSdk) : '',
    debuggable: manifest.debuggable === 'true',
    permissions: manifest.usesPermissions || [],
    signature: {
      signed: certs.length > 0 || hasApkSigningBlock(buffer, zip.centralOffset),
      schemes: [certs.length ? 'v1/JAR' : '', hasApkSigningBlock(buffer, zip.centralOffset) ? 'v2/v3/v4 签名块' : ''].filter(Boolean),
      certificates: certs
    }
  };
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseXmlPlist(text) {
  const result = {};
  const regex = /<key>([\s\S]*?)<\/key>\s*<(string|integer|real|date|data)(?:\s[^>]*)?>([\s\S]*?)<\/\2>|<key>([\s\S]*?)<\/key>\s*<(true|false)\s*\/>/g;
  let match;
  while ((match = regex.exec(text))) {
    const key = decodeXml(match[1] || match[4]);
    const type = match[2] || match[5];
    const raw = match[3] || '';
    if (type === 'true') result[key] = true;
    else if (type === 'false') result[key] = false;
    else if (type === 'integer') result[key] = Number.parseInt(raw, 10);
    else result[key] = decodeXml(raw.trim());
  }
  return result;
}

function readSizedInt(buffer, offset, size) {
  let value = 0n;
  for (let index = 0; index < size; index += 1) value = (value << 8n) | BigInt(buffer[offset + index]);
  return Number(value);
}

function decodeUtf16Be(buffer, start, byteLength) {
  let result = '';
  for (let offset = start; offset < start + byteLength; offset += 2) {
    result += String.fromCharCode(buffer.readUInt16BE(offset));
  }
  return result;
}

function parseBinaryPlist(buffer) {
  if (buffer.subarray(0, 8).toString('ascii') !== 'bplist00') throw new Error('不是 binary plist');
  const trailer = buffer.subarray(buffer.length - 32);
  const offsetSize = trailer[6];
  const refSize = trailer[7];
  const objectCount = readSizedInt(trailer, 8, 8);
  const topObject = readSizedInt(trailer, 16, 8);
  const offsetTableOffset = readSizedInt(trailer, 24, 8);
  const offsets = Array.from({ length: objectCount }, (_, index) => readSizedInt(buffer, offsetTableOffset + index * offsetSize, offsetSize));
  const cache = new Map();

  function readLength(offset, info) {
    if (info < 0x0f) return { length: info, offset };
    const marker = buffer[offset];
    const type = marker >> 4;
    const size = 2 ** (marker & 0x0f);
    if (type !== 0x1) throw new Error('binary plist 长度字段异常');
    return { length: readSizedInt(buffer, offset + 1, size), offset: offset + 1 + size };
  }

  function parseObject(index) {
    if (cache.has(index)) return cache.get(index);
    let offset = offsets[index];
    const marker = buffer[offset++];
    const type = marker >> 4;
    const info = marker & 0x0f;
    let value = null;
    if (type === 0x0) {
      value = info === 0x9 ? true : info === 0x8 ? false : null;
    } else if (type === 0x1) {
      value = readSizedInt(buffer, offset, 2 ** info);
    } else if (type === 0x5) {
      const length = readLength(offset, info);
      value = buffer.toString('ascii', length.offset, length.offset + length.length);
    } else if (type === 0x6) {
      const length = readLength(offset, info);
      value = decodeUtf16Be(buffer, length.offset, length.length * 2);
    } else if (type === 0xa) {
      const length = readLength(offset, info);
      value = Array.from({ length: length.length }, (_, itemIndex) => parseObject(readSizedInt(buffer, length.offset + itemIndex * refSize, refSize)));
    } else if (type === 0xd) {
      const length = readLength(offset, info);
      value = {};
      const keysOffset = length.offset;
      const valuesOffset = keysOffset + length.length * refSize;
      for (let itemIndex = 0; itemIndex < length.length; itemIndex += 1) {
        const key = parseObject(readSizedInt(buffer, keysOffset + itemIndex * refSize, refSize));
        value[key] = parseObject(readSizedInt(buffer, valuesOffset + itemIndex * refSize, refSize));
      }
    }
    cache.set(index, value);
    return value;
  }

  return parseObject(topObject);
}

function parsePlist(buffer) {
  if (buffer.subarray(0, 8).toString('ascii') === 'bplist00') {
    return parseBinaryPlist(buffer);
  }
  return parseXmlPlist(buffer.toString('utf8'));
}

function parseIpaInfo(buffer, filePath, zip) {
  const infoEntry = zip.entries.find((entry) => /^Payload\/[^/]+\.app\/Info\.plist$/i.test(entry.name));
  if (!infoEntry) throw new Error('IPA 中没有 Payload/*.app/Info.plist');
  const plist = parsePlist(readZipEntry(buffer, infoEntry));
  const signed = zip.entries.some((entry) => /^Payload\/[^/]+\.app\/_CodeSignature\//i.test(entry.name));
  return {
    type: 'ipa',
    filePath,
    fileName: path.basename(filePath),
    fileSize: buffer.length,
    md5: hashHex(buffer, 'md5'),
    sha1: hashHex(buffer, 'sha1'),
    sha256: hashHex(buffer, 'sha256'),
    packageName: plist.CFBundleIdentifier || '',
    appName: plist.CFBundleDisplayName || plist.CFBundleName || '',
    versionName: plist.CFBundleShortVersionString || '',
    versionCode: String(plist.CFBundleVersion || ''),
    minSdk: plist.MinimumOSVersion || '',
    targetSdk: '',
    debuggable: false,
    permissions: [],
    signature: {
      signed,
      schemes: signed ? ['iOS CodeSignature'] : [],
      certificates: []
    }
  };
}

async function inspectPackageFile(filePath) {
  const buffer = await fs.readFile(filePath);
  const zip = readZipEntries(buffer);
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.ipa' ? parseIpaInfo(buffer, filePath, zip) : parseApkInfo(buffer, filePath, zip);
}

function comparePackages(left, right) {
  const keys = [
    ['packageName', '包名'],
    ['appName', '应用名'],
    ['versionName', '版本名'],
    ['versionCode', '版本号'],
    ['minSdk', '最低系统'],
    ['targetSdk', '目标系统'],
    ['md5', '文件 MD5'],
    ['sha256', '文件 SHA256']
  ];
  return keys.map(([key, label]) => ({
    key,
    label,
    left: left?.[key] || '',
    right: right?.[key] || '',
    changed: String(left?.[key] || '') !== String(right?.[key] || '')
  }));
}

function formatBytes(value) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = Number(value) || 0;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return size.toFixed(unit ? 1 : 0) + ' ' + units[unit];
}

class AppPackageService {
  constructor({ dialog, getWindow, appPath } = {}) {
    this.dialog = dialog;
    this.getWindow = getWindow || (() => null);
    this.appPath = appPath || process.cwd();
    this.adbPath = null;
  }

  getAdbCandidates() {
    const executable = process.platform === 'win32' ? 'adb.exe' : 'adb';
    const platformDir = process.platform + '-' + process.arch;
    const resourcesPath = process.resourcesPath || path.dirname(this.appPath);
    const androidHomes = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].filter(Boolean);
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const commonSdkPaths = process.platform === 'win32'
      ? [
          process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
          process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Android', 'Sdk')
        ].filter(Boolean)
      : [
          home && path.join(home, 'Library', 'Android', 'sdk'),
          home && path.join(home, 'Android', 'Sdk')
        ].filter(Boolean);
    const candidates = [
      process.env.ADB_PATH,
      path.join(resourcesPath, 'platform-tools', platformDir, executable),
      path.join(resourcesPath, 'app.asar.unpacked', 'resources', 'platform-tools', platformDir, executable),
      path.join(this.appPath, 'resources', 'platform-tools', platformDir, executable),
      ...androidHomes.map((sdkPath) => path.join(sdkPath, 'platform-tools', executable)),
      ...commonSdkPaths.map((sdkPath) => path.join(sdkPath, 'platform-tools', executable)),
      ...(process.platform === 'darwin' ? ['/opt/homebrew/bin/adb', '/usr/local/bin/adb'] : []),
      executable
    ].filter(Boolean);
    return [...new Set(candidates)];
  }

  async resolveAdbPath() {
    if (this.adbPath) return this.adbPath;
    let lastError = null;
    for (const candidate of this.getAdbCandidates()) {
      try {
        await execFileAsync(candidate, ['version'], { timeout: 8000, windowsHide: true });
        this.adbPath = candidate;
        return candidate;
      } catch (error) {
        lastError = error;
        if (error.code && error.code !== 'ENOENT') break;
      }
    }
    const error = new Error('未找到可用的 ADB。请安装 Android Platform Tools，或在系统环境变量中配置 ADB_PATH。');
    error.cause = lastError;
    throw error;
  }

  async adb(args, timeout = 30000) {
    try {
      const adbPath = await this.resolveAdbPath();
      const { stdout, stderr } = await execFileAsync(adbPath, args, { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
      return stdout || stderr || '';
    } catch (error) {
      throw Object.assign(error, { installFailure: classifyInstallFailure(error) });
    }
  }

  async selectPackage() {
    const result = await this.dialog.showOpenDialog(this.getWindow() || undefined, {
      title: '选择安装包',
      properties: ['openFile'],
      filters: [
        { name: '安装包', extensions: ['apk', 'ipa'] },
        { name: 'Android APK', extensions: ['apk'] },
        { name: 'iOS IPA', extensions: ['ipa'] }
      ]
    });
    if (result.canceled || !result.filePaths?.[0]) return null;
    return this.inspectPackage(result.filePaths[0]);
  }

  async inspectPackage(filePath) {
    if (!filePath) throw new Error('请选择安装包文件');
    const info = await inspectPackageFile(filePath);
    return Object.assign({}, info, {
      fileSizeText: formatBytes(info.fileSize),
      summary: (info.appName || info.packageName || info.fileName) + ' · ' + (info.versionName || '未知版本')
    });
  }

  async listDevices() {
    return parseDeviceList(await this.adb(['devices', '-l'], 15000));
  }

  async listInstalledPackages({ serial, includeSystem = false } = {}) {
    if (!serial) throw new Error('请选择一台 Android 设备');
    const args = ['-s', serial, 'shell', 'cmd', 'package', 'list', 'packages', '-f', '--show-versioncode'];
    if (!includeSystem) args.push('-3');
    try {
      return parseInstalledPackages(await this.adb(args, 30000));
    } catch (error) {
      try {
        const fallbackArgs = ['-s', serial, 'shell', 'pm', 'list', 'packages', '-f'];
        if (!includeSystem) fallbackArgs.push('-3');
        return parseInstalledPackages(await this.adb(fallbackArgs, 30000));
      } catch (fallbackError) {
        const failure = classifyAdbFailure(fallbackError, '读取设备安装包失败');
        throw new Error(failure.message);
      }
    }
  }

  async runForDevices(serials, action, classifyFailure = classifyInstallFailure) {
    const devices = Array.isArray(serials) ? serials.filter(Boolean) : [];
    if (!devices.length) throw new Error('请选择至少一台 Android 设备');
    return Promise.all(devices.map(async (serial) => {
      try {
        const output = await action(serial);
        return { serial, ok: true, output: String(output || '').trim() };
      } catch (error) {
        const failure = classifyFailure(error);
        return { serial, ok: false, code: failure.code, message: failure.message, raw: failure.raw };
      }
    }));
  }

  async installPackage({ serials, filePath, allowDowngrade = true, grantPermissions = true, replace = true } = {}) {
    if (!filePath) throw new Error('请选择 APK 文件');
    if (path.extname(filePath).toLowerCase() !== '.apk') throw new Error('当前只支持通过 ADB 安装 APK，IPA 暂不支持直接安装。');
    const options = [];
    if (replace) options.push('-r');
    if (allowDowngrade) options.push('-d');
    if (grantPermissions) options.push('-g');
    return this.runForDevices(serials, async (serial) => {
      const output = await this.adb(['-s', serial, 'install', ...options, filePath], 180000);
      if (!/Success/i.test(output)) throw Object.assign(new Error(output || 'ADB install failed'), { stdout: output });
      return output;
    }, classifyInstallFailure);
  }

  async uninstallPackage({ serials, packageName, keepData = false } = {}) {
    if (!packageName) throw new Error('缺少应用包名');
    return this.runForDevices(serials, (serial) => this.adb(['-s', serial, 'uninstall', ...(keepData ? ['-k'] : []), packageName], 90000), classifyAdbFailure);
  }

  async clearDataForDevice(serial, packageName) {
    const safePackage = assertSafeAndroidPackageName(packageName);
    const attempts = [
      ['shell', 'pm', 'clear', safePackage],
      ['shell', 'pm', 'clear', '--user', '0', safePackage],
      ['shell', 'cmd', 'package', 'clear', '--user', '0', safePackage]
    ];
    let firstError = null;
    for (const args of attempts) {
      try {
        const output = await this.adb(['-s', serial, ...args], 60000);
        if (/Success/i.test(output)) return '应用数据已清除';
        const error = Object.assign(new Error(output || 'pm clear 未返回 Success'), { stdout: output });
        firstError ||= error;
      } catch (error) {
        firstError ||= error;
        const failure = classifyClearDataFailure(error);
        if (failure.code === 'clear-data-permission-denied') break;
      }
    }

    try {
      await this.adb(['-s', serial, 'shell', 'am', 'force-stop', safePackage], 20000);
    } catch {}

    try {
      await this.adb([
        '-s', serial, 'shell', 'run-as', safePackage, 'sh', '-c',
        'rm -rf cache/* code_cache/* files/* databases/* shared_prefs/* no_backup/* app_webview/*'
      ], 60000);
      await this.adb(['-s', serial, 'shell', 'am', 'force-stop', safePackage], 20000);
      return '系统拦截了 pm clear，已使用 debuggable 包 run-as 兜底清理私有目录并停止应用';
    } catch (fallbackError) {
      if (firstError) throw firstError;
      throw fallbackError;
    }
  }

  async clearData({ serials, packageName } = {}) {
    if (!packageName) throw new Error('缺少应用包名');
    return this.runForDevices(serials, (serial) => this.clearDataForDevice(serial, packageName), classifyClearDataFailure);
  }
}

module.exports = {
  AppPackageService,
  __test: {
    classifyInstallFailure,
    classifyClearDataFailure,
    comparePackages,
    inspectPackageFile,
    parseAndroidManifestXml,
    parseApkInfo,
    parseBinaryPlist,
    parseDeviceList,
    parseInstalledPackages,
    parseXmlPlist,
    readZipEntries,
    readZipEntry
  }
};
