const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { androidAdbCandidates, resolveAndroidAdb } = require('../src/android-adb-runtime');

test('builds bundled Android ADB candidates for Windows without requiring a system install', () => {
  const candidates = androidAdbCandidates({
    runtimeRoots: ['C:\\Test cat\\resources\\platform-tools'],
    resourcesPath: '',
    appPath: '',
    environment: {},
    platform: 'win32',
    arch: 'x64',
    includeSdk: false
  });
  assert.equal(candidates[0], path.join('C:\\Test cat\\resources\\platform-tools', 'win32-x64', 'adb.exe'));
  assert.equal(candidates.at(-1), 'adb.exe');
});

test('continues to bundled ADB when configured ADB exists but cannot start', async () => {
  const calls = [];
  const resolved = await resolveAndroidAdb({
    candidates: ['/configured/adb', '/bundled/darwin-arm64/adb', 'adb'],
    run: async (candidate) => {
      calls.push(candidate);
      if (candidate === '/configured/adb') {
        const error = new Error('configured ADB is damaged');
        error.code = 'EACCES';
        throw error;
      }
      return { stdout: '' };
    },
    sourceOptions: {
      environment: { ADB_PATH: '/configured/adb' },
      runtimeRoots: ['/bundled']
    }
  });
  assert.deepEqual(calls, ['/configured/adb', '/bundled/darwin-arm64/adb']);
  assert.equal(resolved.path, '/bundled/darwin-arm64/adb');
  assert.equal(resolved.source, 'bundled');
});

test('reports every failed ADB candidate for diagnostics', async () => {
  await assert.rejects(
    resolveAndroidAdb({
      candidates: ['/bad/one', '/bad/two'],
      run: async (candidate) => {
        const error = new Error(`cannot run ${candidate}`);
        error.code = candidate.endsWith('one') ? 'ENOENT' : 'EACCES';
        throw error;
      },
      errorMessage: 'ADB unavailable'
    }),
    (error) => error.message === 'ADB unavailable' && error.attempts.length === 2 && error.cause.code === 'EACCES'
  );
});
