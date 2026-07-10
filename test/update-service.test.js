const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildUpdateResult,
  compareVersions,
  isCatalinaMac,
  selectUpdateAsset
} = require('../src/update-service');

const assets = [
  { name: 'Test cat-0.9.0-universal.dmg', browser_download_url: 'https://github.com/Domcat888/Test-cat/releases/download/v0.9.0/Test%20cat-0.9.0-universal.dmg', size: 240 },
  { name: 'Test cat-0.9.0-universal-mac.zip', browser_download_url: 'https://github.com/Domcat888/Test-cat/releases/download/v0.9.0/Test%20cat-0.9.0-universal-mac.zip', size: 237 },
  { name: 'Test cat-0.9.0-catalina-x64.dmg', browser_download_url: 'https://github.com/Domcat888/Test-cat/releases/download/v0.9.0/Test%20cat-0.9.0-catalina-x64.dmg', size: 131 },
  { name: 'Test cat Setup 0.9.0.exe', browser_download_url: 'https://github.com/Domcat888/Test-cat/releases/download/v0.9.0/Test%20cat%20Setup%200.9.0.exe', size: 129 },
  { name: 'Test cat 0.9.0.exe', browser_download_url: 'https://github.com/Domcat888/Test-cat/releases/download/v0.9.0/Test%20cat%200.9.0.exe', size: 128 }
];

test('compares semantic versions with v prefix support', () => {
  assert.equal(compareVersions('v0.9.0', '0.8.9'), 1);
  assert.equal(compareVersions('0.9.0', '0.9'), 0);
  assert.equal(compareVersions('0.8.9', '0.9.0'), -1);
});

test('detects Catalina Intel runtime for compatibility package', () => {
  assert.equal(isCatalinaMac({ platform: 'darwin', arch: 'x64', macVersion: '10.15.7' }), true);
  assert.equal(isCatalinaMac({ platform: 'darwin', arch: 'arm64', macVersion: '14.5.0' }), false);
});

test('selects matching update asset for each supported platform', () => {
  assert.equal(selectUpdateAsset(assets, { platform: 'darwin', arch: 'arm64', macVersion: '14.5.0' }).asset.name, 'Test cat-0.9.0-universal.dmg');
  assert.equal(selectUpdateAsset(assets, { platform: 'darwin', arch: 'x64', macVersion: '10.15.7' }).asset.name, 'Test cat-0.9.0-catalina-x64.dmg');
  assert.equal(selectUpdateAsset(assets, { platform: 'win32', arch: 'x64' }).asset.name, 'Test cat Setup 0.9.0.exe');
});

test('builds update result from GitHub release metadata', () => {
  const result = buildUpdateResult({
    currentVersion: '0.8.9',
    platform: 'darwin',
    arch: 'arm64',
    macVersion: '14.5',
    release: {
      tag_name: 'v0.9.0',
      body: '- 新增检查更新',
      assets
    }
  });
  assert.equal(result.hasUpdate, true);
  assert.equal(result.latestVersion, '0.9.0');
  assert.equal(result.asset.name, 'Test cat-0.9.0-universal.dmg');
});
