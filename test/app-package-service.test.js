const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const { AppPackageService, __test } = require('../src/app-package-service');

function dosTimeDate() {
  return { time: 0, date: 0 };
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data));
    const compressed = entry.store ? raw : zlib.deflateRawSync(raw);
    const method = entry.store ? 0 : 8;
    const crc = crc32(raw);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTimeDate().time, 10);
    local.writeUInt16LE(dosTimeDate().date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, compressed);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + compressed.length;
  }
  const centralOffset = offset;
  const central = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...locals, central, eocd]);
}

test('parseDeviceList extracts Android model and states', () => {
  const devices = __test.parseDeviceList('List of devices attached\nABC123 device product:p model:Pixel_8 device:x transport_id:1\nXYZ unauthorized usb:1-2\n');
  assert.equal(devices[0].serial, 'ABC123');
  assert.equal(devices[0].model, 'Pixel 8');
  assert.equal(devices[1].state, 'unauthorized');
});

test('parseInstalledPackages extracts package path, code and app type', () => {
  const packages = __test.parseInstalledPackages('package:/data/app/~~abc/base.apk=com.example.demo versionCode:42\npackage:/system/app/Settings/Settings.apk=com.android.settings versionCode:35\n');
  assert.deepEqual(packages[0], {
    packageName: 'com.example.demo',
    apkPath: '/data/app/~~abc/base.apk',
    versionCode: '42',
    system: false,
    label: 'com.example.demo'
  });
  assert.equal(packages[1].system, true);
});

test('parseInstalledPackages supports pm fallback without version code', () => {
  const packages = __test.parseInstalledPackages('package:/data/app/base.apk=com.demo\n');
  assert.equal(packages[0].packageName, 'com.demo');
  assert.equal(packages[0].versionCode, '');
});

test('AppPackageService resolves bundled and system ADB candidates', () => {
  const executable = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const platformDir = process.platform + '-' + process.arch;
  const service = new AppPackageService({ dialog: {}, getWindow: () => null, appPath: path.join('/tmp', 'Test cat.app', 'Contents', 'Resources', 'app.asar') });
  const candidates = service.getAdbCandidates();
  assert.ok(candidates.includes(executable));
  assert.ok(candidates.some((candidate) => candidate.includes(path.join('platform-tools', platformDir, executable))));
  assert.equal(new Set(candidates).size, candidates.length);
});


test('classifyInstallFailure explains common adb install failures', () => {
  assert.equal(__test.classifyInstallFailure(new Error('INSTALL_FAILED_VERSION_DOWNGRADE')).code, 'version-downgrade');
  assert.match(__test.classifyInstallFailure({ stderr: 'INSTALL_FAILED_UPDATE_INCOMPATIBLE signatures do not match' }).message, /签名不同/);
  assert.equal(__test.classifyInstallFailure(new Error('INSTALL_FAILED_NO_MATCHING_ABIS')).code, 'abi-mismatch');
});

test('reads deflated zip entries and parses XML Android manifest', () => {
  const manifest = '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.test.cat" android:versionName="1.2.3" android:versionCode="42"><uses-sdk android:minSdkVersion="23" android:targetSdkVersion="35"/><uses-permission android:name="android.permission.INTERNET"/><application android:label="Test Cat" android:debuggable="true"/></manifest>';
  const buffer = zip([{ name: 'AndroidManifest.xml', data: manifest }]);
  const parsed = __test.readZipEntries(buffer);
  const entry = parsed.entries[0];
  assert.equal(__test.readZipEntry(buffer, entry).toString(), manifest);
  assert.equal(__test.parseAndroidManifestXml(manifest).packageName, 'com.test.cat');
  assert.equal(__test.parseAndroidManifestXml(manifest).versionCode, '42');
});

test('parseXmlPlist extracts IPA bundle metadata', () => {
  const plist = '<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>com.test.ios</string><key>CFBundleDisplayName</key><string>Test iOS</string><key>CFBundleShortVersionString</key><string>2.0</string><key>CFBundleVersion</key><string>200</string><key>MinimumOSVersion</key><string>14.0</string></dict></plist>';
  const info = __test.parseXmlPlist(plist);
  assert.equal(info.CFBundleIdentifier, 'com.test.ios');
  assert.equal(info.CFBundleVersion, '200');
});

test('inspects a real binary-manifest APK from bundled resources', async () => {
  const service = new AppPackageService({ dialog: {}, getWindow: () => null });
  const info = await service.inspectPackage(path.join(__dirname, '../resources/weak-network/sockstun-agent.apk'));
  assert.equal(info.type, 'apk');
  assert.equal(info.packageName, 'hev.sockstun');
  assert.equal(info.versionName, '7.0');
  assert.equal(info.versionCode, '11');
  assert.equal(info.minSdk, '24');
  assert.equal(info.targetSdk, '34');
  assert.ok(info.permissions.includes('android.permission.INTERNET'));
});
