const UPDATE_REPOSITORY = 'Domcat888/Test-cat';
const UPDATE_API_URL = `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`;

function normalizeVersion(value = '') {
  const match = String(value || '').trim().match(/\d+(?:\.\d+){0,3}/);
  return match ? match[0] : '0.0.0';
}

function compareVersions(left, right) {
  const leftParts = normalizeVersion(left).split('.').map((item) => Number.parseInt(item, 10) || 0);
  const rightParts = normalizeVersion(right).split('.').map((item) => Number.parseInt(item, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length, 3);
  for (let index = 0; index < length; index += 1) {
    const delta = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (delta) return delta > 0 ? 1 : -1;
  }
  return 0;
}

function isCatalinaMac({ platform, arch, macVersion } = {}) {
  return platform === 'darwin' && arch === 'x64' && /^10\.15(?:\.|$)/.test(String(macVersion || ''));
}

function packageProfile(info = {}) {
  if (info.platform === 'win32') return { key: 'windowsX64', label: 'Windows x64 安装包' };
  if (isCatalinaMac(info)) return { key: 'macCatalinaX64', label: 'macOS Catalina Intel 兼容包' };
  if (info.platform === 'darwin') return { key: 'macUniversal', label: 'mac universal 通用包' };
  return { key: 'unsupported', label: '当前系统暂不支持自动选择安装包' };
}

function assetUrl(asset = {}) {
  return String(asset.browser_download_url || asset.downloadUrl || asset.url || '');
}

function normalizedAsset(asset = {}) {
  return {
    name: String(asset.name || '').trim(),
    downloadUrl: assetUrl(asset),
    size: Number(asset.size || 0) || 0
  };
}

function scoreAssetForProfile(asset, profileKey) {
  const name = String(asset.name || '').toLowerCase();
  if (!name || name.endsWith('.blockmap') || name.endsWith('.yml')) return -1;
  if (!asset.downloadUrl) return -1;

  if (profileKey === 'macCatalinaX64') {
    if (!name.includes('catalina') || !name.includes('x64')) return -1;
    if (name.endsWith('.dmg')) return 100;
    if (name.endsWith('.zip')) return 80;
    return -1;
  }

  if (profileKey === 'macUniversal') {
    if (name.includes('catalina')) return -1;
    if (name.includes('universal') && name.endsWith('.dmg')) return 100;
    if (name.includes('universal') && name.endsWith('.zip')) return 80;
    if (name.endsWith('.dmg')) return 60;
    return -1;
  }

  if (profileKey === 'windowsX64') {
    if (!name.endsWith('.exe')) return -1;
    if (name.includes('setup')) return 100;
    if (name.includes('portable')) return 70;
    return 50;
  }

  return -1;
}

function selectUpdateAsset(assets = [], info = {}) {
  const profile = packageProfile(info);
  if (profile.key === 'unsupported') return { profile, asset: null };
  const candidates = (Array.isArray(assets) ? assets : [])
    .map(normalizedAsset)
    .map((asset) => ({ asset, score: scoreAssetForProfile(asset, profile.key) }))
    .filter((item) => item.score >= 0)
    .sort((left, right) => right.score - left.score || right.asset.size - left.asset.size);
  return { profile, asset: candidates[0]?.asset || null };
}

function normalizeGithubRelease(payload = {}) {
  const tag = String(payload.tag_name || payload.name || '').trim();
  return {
    version: normalizeVersion(tag),
    tag,
    name: String(payload.name || tag || '').trim(),
    notes: String(payload.body || '').trim(),
    htmlUrl: String(payload.html_url || '').trim(),
    publishedAt: String(payload.published_at || '').trim(),
    assets: Array.isArray(payload.assets) ? payload.assets.map(normalizedAsset) : []
  };
}

function buildUpdateResult({ currentVersion, release, platform, arch, macVersion } = {}) {
  const safeRelease = release?.version ? release : normalizeGithubRelease(release || {});
  const comparison = compareVersions(safeRelease.version, currentVersion);
  const { profile, asset } = selectUpdateAsset(safeRelease.assets, { platform, arch, macVersion });
  return {
    currentVersion: normalizeVersion(currentVersion),
    latestVersion: safeRelease.version,
    hasUpdate: comparison > 0,
    isNewerCurrent: comparison < 0,
    release: safeRelease,
    profile,
    asset,
    repository: UPDATE_REPOSITORY,
    sourceUrl: UPDATE_API_URL
  };
}

module.exports = {
  UPDATE_API_URL,
  UPDATE_REPOSITORY,
  buildUpdateResult,
  compareVersions,
  isCatalinaMac,
  normalizeGithubRelease,
  normalizeVersion,
  packageProfile,
  selectUpdateAsset
};
