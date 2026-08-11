const { contextBridge, ipcRenderer, webUtils } = require('electron');

let streamPort = null;
const streamListeners = new Set();
const statusListeners = new Set();
const performanceSampleListeners = new Set();
const performanceStatusListeners = new Set();
const iosMirrorFrameListeners = new Set();
const iosMirrorStatusListeners = new Set();
const iosPerformanceSampleListeners = new Set();
const iosPerformanceStatusListeners = new Set();
const weakNetworkStatusListeners = new Set();
const weakNetworkStatsListeners = new Set();
const logAnalysisLogListeners = new Set();
const logAnalysisStatusListeners = new Set();
const captureNoticeListeners = new Set();
const companionPetSettingsListeners = new Set();
const companionPetReminderListeners = new Set();
const companionPetWalkListeners = new Set();
const companionPetIdleListeners = new Set();
const companionPetDragListeners = new Set();

ipcRenderer.on('mobile-mirror:stream-port', (event) => {
  try { streamPort?.close(); } catch {}
  streamPort = event.ports[0];
  streamPort.onmessage = (message) => {
    for (const listener of streamListeners) listener(message.data);
  };
  streamPort.start();
});

ipcRenderer.on('mobile-mirror:status', (_event, status) => {
  for (const listener of statusListeners) listener(status);
});

ipcRenderer.on('performance-monitor:sample', (_event, sample) => {
  for (const listener of performanceSampleListeners) listener(sample);
});
ipcRenderer.on('performance-monitor:status', (_event, status) => {
  for (const listener of performanceStatusListeners) listener(status);
});
ipcRenderer.on('ios-mirror:frame', (_event, frame) => {
  for (const listener of iosMirrorFrameListeners) listener(frame);
});
ipcRenderer.on('ios-mirror:status', (_event, status) => {
  for (const listener of iosMirrorStatusListeners) listener(status);
});
ipcRenderer.on('ios-performance:sample', (_event, sample) => {
  for (const listener of iosPerformanceSampleListeners) listener(sample);
});
ipcRenderer.on('ios-performance:status', (_event, status) => {
  for (const listener of iosPerformanceStatusListeners) listener(status);
});
ipcRenderer.on('weak-network:status', (_event, status) => {
  for (const listener of weakNetworkStatusListeners) listener(status);
});
ipcRenderer.on('weak-network:stats', (_event, stats) => {
  for (const listener of weakNetworkStatsListeners) listener(stats);
});
ipcRenderer.on('log-analysis:logs', (_event, records) => {
  for (const listener of logAnalysisLogListeners) listener(records);
});
ipcRenderer.on('log-analysis:status', (_event, status) => {
  for (const listener of logAnalysisStatusListeners) listener(status);
});
ipcRenderer.on('capture:notice', (_event, message) => {
  for (const listener of captureNoticeListeners) listener(message);
});
ipcRenderer.on('companion-pet:settings-changed', (_event, snapshot) => {
  for (const listener of companionPetSettingsListeners) listener(snapshot);
});
ipcRenderer.on('companion-pet:reminder', (_event, reminder) => {
  for (const listener of companionPetReminderListeners) listener(reminder);
});
ipcRenderer.on('companion-pet:walk', (_event, movement) => {
  for (const listener of companionPetWalkListeners) listener(movement);
});
ipcRenderer.on('companion-pet:idle', () => {
  for (const listener of companionPetIdleListeners) listener();
});
ipcRenderer.on('companion-pet:drag-state', (_event, state) => {
  for (const listener of companionPetDragListeners) listener(state);
});

contextBridge.exposeInMainWorld('testCat', {
  platform: process.platform,
  capture: {
    getSettings: () => ipcRenderer.invoke('capture:get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('capture:save-settings', settings),
    startScreenshot: () => ipcRenderer.invoke('capture:start-screenshot'),
    openRecorder: () => ipcRenderer.invoke('capture:open-recorder'),
    getPayload: (id) => ipcRenderer.invoke('capture:get-payload', id),
    selectionComplete: (payload) => ipcRenderer.invoke('capture:selection-complete', payload),
    selectionCancel: () => ipcRenderer.invoke('capture:selection-cancel'),
    copyImage: (dataUrl) => ipcRenderer.invoke('capture:copy-image', dataUrl),
    saveImage: (dataUrl) => ipcRenderer.invoke('capture:save-image', dataUrl),
    pinImage: (dataUrl) => ipcRenderer.invoke('capture:pin-image', dataUrl),
    openEditor: (dataUrl) => ipcRenderer.invoke('capture:open-editor', dataUrl),
    listSources: () => ipcRenderer.invoke('capture:list-sources'),
    saveVideo: (arrayBuffer, options) => ipcRenderer.invoke('capture:save-video', arrayBuffer, options),
    showRecordingBorder: (region) => ipcRenderer.invoke('capture:show-recording-border', region),
    hideRecordingBorder: () => ipcRenderer.invoke('capture:hide-recording-border'),
    showItem: (filePath) => ipcRenderer.invoke('capture:show-item', filePath),
    closeCurrentWindow: () => ipcRenderer.invoke('capture:close-current-window'),
    onNotice: (listener) => {
      captureNoticeListeners.add(listener);
      return () => captureNoticeListeners.delete(listener);
    }
  },
  appPackage: {
    openWindow: () => ipcRenderer.invoke('app-package:open-window'),
    selectPackage: () => ipcRenderer.invoke('app-package:select-package'),
    inspectPackage: (filePath) => ipcRenderer.invoke('app-package:inspect-package', filePath),
    pathForFile: (file) => webUtils.getPathForFile(file),
    listDevices: (payload) => ipcRenderer.invoke('app-package:list-devices', payload),
    listInstalled: (payload) => ipcRenderer.invoke('app-package:list-installed', payload),
    install: (payload) => ipcRenderer.invoke('app-package:install', payload),
    uninstall: (payload) => ipcRenderer.invoke('app-package:uninstall', payload),
    clearData: (payload) => ipcRenderer.invoke('app-package:clear-data', payload)
  },
  mockData: {
    openWindow: () => ipcRenderer.invoke('mock-data:open-window'),
    copyText: (value) => ipcRenderer.invoke('mock-data:copy-text', value),
    exportCsv: (payload) => ipcRenderer.invoke('mock-data:export-csv', payload)
  },
  timestampConverter: {
    openWindow: () => ipcRenderer.invoke('timestamp-converter:open-window'),
    copyText: (value) => ipcRenderer.invoke('timestamp-converter:copy-text', value)
  },
  formulaCalculator: {
    openWindow: () => ipcRenderer.invoke('formula-calculator:open-window'),
    copyText: (value) => ipcRenderer.invoke('formula-calculator:copy-text', value),
    exportData: (payload) => ipcRenderer.invoke('formula-calculator:export-data', payload),
    importData: () => ipcRenderer.invoke('formula-calculator:import-data')
  },
  aiTestAssistant: {
    openWindow: () => ipcRenderer.invoke('ai-test-assistant:open-window'),
    getSettings: () => ipcRenderer.invoke('ai-test-assistant:get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('ai-test-assistant:save-settings', settings),
    testConnection: () => ipcRenderer.invoke('ai-test-assistant:test-connection'),
    selectRequirementFile: () => ipcRenderer.invoke('ai-test-assistant:select-requirement-file'),
    extractRequirementFile: (filePath) => ipcRenderer.invoke('ai-test-assistant:extract-requirement-file', filePath),
    pathForFile: (file) => webUtils.getPathForFile(file),
    runTask: (payload) => ipcRenderer.invoke('ai-test-assistant:run-task', payload),
    generateTestCases: (payload) => ipcRenderer.invoke('ai-test-assistant:generate-test-cases', payload),
    exportExcel: (payload) => ipcRenderer.invoke('ai-test-assistant:export-excel', payload),
    exportXmind: (payload) => ipcRenderer.invoke('ai-test-assistant:export-xmind', payload),
    copyText: (value) => ipcRenderer.invoke('ai-test-assistant:copy-text', value)
  },
  companionPet: {
    getSettings: () => ipcRenderer.invoke('companion-pet:get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('companion-pet:save-settings', settings),
    showNow: () => ipcRenderer.invoke('companion-pet:show-now'),
    hideNow: () => ipcRenderer.invoke('companion-pet:hide-now'),
    walkNow: () => ipcRenderer.invoke('companion-pet:walk-now'),
    remindTodo: (payload) => ipcRenderer.invoke('companion-pet:todo-reminder', payload),
    dragStart: (point) => ipcRenderer.invoke('companion-pet:drag-start', point),
    dragMove: (point) => ipcRenderer.invoke('companion-pet:drag-move', point),
    dragEnd: () => ipcRenderer.invoke('companion-pet:drag-end'),
    onSettingsChanged: (listener) => {
      companionPetSettingsListeners.add(listener);
      return () => companionPetSettingsListeners.delete(listener);
    },
    onReminder: (listener) => {
      companionPetReminderListeners.add(listener);
      return () => companionPetReminderListeners.delete(listener);
    },
    onWalk: (listener) => {
      companionPetWalkListeners.add(listener);
      return () => companionPetWalkListeners.delete(listener);
    },
    onIdle: (listener) => {
      companionPetIdleListeners.add(listener);
      return () => companionPetIdleListeners.delete(listener);
    },
    onDragState: (listener) => {
      companionPetDragListeners.add(listener);
      return () => companionPetDragListeners.delete(listener);
    }
  },
  calculator: {
    openWindow: () => ipcRenderer.invoke('calculator:open-window')
  },
  performanceMonitor: {
    openWindow: () => ipcRenderer.invoke('performance-monitor:open-window'),
    listDevices: () => ipcRenderer.invoke('performance-monitor:list-devices'),
    start: (configuration) => ipcRenderer.invoke('performance-monitor:start', configuration),
    stop: () => ipcRenderer.invoke('performance-monitor:stop'),
    launchApp: (serial, packageName) => ipcRenderer.invoke('performance-monitor:launch-app', { serial, packageName }),
    getForegroundApp: (serial) => ipcRenderer.invoke('performance-monitor:foreground-app', serial),
    saveReport: (payload, options) => ipcRenderer.invoke('performance-monitor:save-report', payload, options),
    migrateReports: (reports) => ipcRenderer.invoke('performance-monitor:migrate-reports', reports),
    listReports: () => ipcRenderer.invoke('performance-monitor:list-reports'),
    getReport: (id) => ipcRenderer.invoke('performance-monitor:get-report', id),
    deleteReport: (id) => ipcRenderer.invoke('performance-monitor:delete-report', id),
    exportXlsx: (id) => ipcRenderer.invoke('performance-monitor:export-xlsx', id),
    exportComparisonXlsx: (leftId, rightId) => ipcRenderer.invoke('performance-monitor:export-comparison-xlsx', { leftId, rightId }),
    onSample: (listener) => {
      performanceSampleListeners.add(listener);
      return () => performanceSampleListeners.delete(listener);
    },
    onStatus: (listener) => {
      performanceStatusListeners.add(listener);
      return () => performanceStatusListeners.delete(listener);
    }
  },
  iosPerformance: {
    openWindow: () => ipcRenderer.invoke('ios-performance:open-window'),
    checkEnvironment: () => ipcRenderer.invoke('ios-performance:check-environment'),
    listDevices: () => ipcRenderer.invoke('ios-performance:list-devices'),
    listApps: (serial) => ipcRenderer.invoke('ios-performance:list-apps', serial),
    getDeviceStatus: (serial) => ipcRenderer.invoke('ios-performance:device-status', serial),
    start: (configuration) => ipcRenderer.invoke('ios-performance:start', configuration),
    stop: () => ipcRenderer.invoke('ios-performance:stop'),
    startTunnel: () => ipcRenderer.invoke('ios-performance:start-tunnel'),
    collectLogs: (serial) => ipcRenderer.invoke('ios-performance:collect-logs', serial),
    listLogs: (filters) => ipcRenderer.invoke('ios-performance:list-logs', filters),
    getLog: (id) => ipcRenderer.invoke('ios-performance:get-log', id),
    saveReport: (payload, options) => ipcRenderer.invoke('ios-performance:save-report', payload, options),
    listReports: () => ipcRenderer.invoke('ios-performance:list-reports'),
    getReport: (id) => ipcRenderer.invoke('ios-performance:get-report', id),
    deleteReport: (id) => ipcRenderer.invoke('ios-performance:delete-report', id),
    onSample: (listener) => {
      iosPerformanceSampleListeners.add(listener);
      return () => iosPerformanceSampleListeners.delete(listener);
    },
    onStatus: (listener) => {
      iosPerformanceStatusListeners.add(listener);
      return () => iosPerformanceStatusListeners.delete(listener);
    }
  },
  weakNetwork: {
    openWindow: () => ipcRenderer.invoke('weak-network:open-window'),
    listDevices: () => ipcRenderer.invoke('weak-network:list-devices'),
    getPresets: () => ipcRenderer.invoke('weak-network:get-presets'),
    start: (configuration) => ipcRenderer.invoke('weak-network:start', configuration),
    stop: () => ipcRenderer.invoke('weak-network:stop'),
    onStatus: (listener) => {
      weakNetworkStatusListeners.add(listener);
      return () => weakNetworkStatusListeners.delete(listener);
    },
    onStats: (listener) => {
      weakNetworkStatsListeners.add(listener);
      return () => weakNetworkStatsListeners.delete(listener);
    }
  },
  fileCompare: {
    openWindow: () => ipcRenderer.invoke('file-compare:open-window'),
    selectPath: (kind) => ipcRenderer.invoke('file-compare:select-path', kind),
    inspectPath: (targetPath) => ipcRenderer.invoke('file-compare:inspect-path', targetPath),
    pathForFile: (file) => webUtils.getPathForFile(file),
    readFile: (filePath) => ipcRenderer.invoke('file-compare:read-file', filePath),
    compareDirectories: (payload) => ipcRenderer.invoke('file-compare:compare-directories', payload),
    syncEntry: (payload) => ipcRenderer.invoke('file-compare:sync-entry', payload),
    saveText: (payload) => ipcRenderer.invoke('file-compare:save-text', payload),
    exportReport: (payload) => ipcRenderer.invoke('file-compare:export-report', payload)
  },
  logAnalysis: {
    openWindow: () => ipcRenderer.invoke('log-analysis:open-window'),
    listDevices: () => ipcRenderer.invoke('log-analysis:list-devices'),
    getForegroundApp: (serial) => ipcRenderer.invoke('log-analysis:foreground-app', serial),
    start: (configuration) => ipcRenderer.invoke('log-analysis:start', configuration),
    stop: () => ipcRenderer.invoke('log-analysis:stop'),
    clear: () => ipcRenderer.invoke('log-analysis:clear'),
    exportLogs: (payload) => ipcRenderer.invoke('log-analysis:export', payload),
    copyText: (value) => ipcRenderer.invoke('log-analysis:copy-text', value),
    onLogs: (listener) => {
      logAnalysisLogListeners.add(listener);
      return () => logAnalysisLogListeners.delete(listener);
    },
    onStatus: (listener) => {
      logAnalysisStatusListeners.add(listener);
      return () => logAnalysisStatusListeners.delete(listener);
    }
  },
  mobileMirror: {
    openWindow: () => ipcRenderer.invoke('mobile-mirror:open-window'),
    setAlwaysOnTop: (enabled) => ipcRenderer.invoke('mobile-mirror:set-always-on-top', Boolean(enabled)),
    requestStream: () => ipcRenderer.send('mobile-mirror:stream-request'),
    listDevices: () => ipcRenderer.invoke('mobile-mirror:list-devices'),
    getDeviceInfo: (configuration) => ipcRenderer.invoke('mobile-mirror:get-device-info', configuration),
    copyText: (value) => ipcRenderer.invoke('mobile-mirror:copy-text', value),
    start: (configuration) => ipcRenderer.invoke('mobile-mirror:start', configuration),
    stop: () => ipcRenderer.invoke('mobile-mirror:stop'),
    sendControl: (payload) => streamPort?.postMessage({ type: 'control', payload }),
    onStream: (listener) => {
      streamListeners.add(listener);
      return () => streamListeners.delete(listener);
    },
    onStatus: (listener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    }
  },
  iosMirror: {
    openWindow: () => ipcRenderer.invoke('ios-mirror:open-window'),
    setAlwaysOnTop: (enabled) => ipcRenderer.invoke('ios-mirror:set-always-on-top', Boolean(enabled)),
    listDevices: () => ipcRenderer.invoke('ios-mirror:list-devices'),
    start: (configuration) => ipcRenderer.invoke('ios-mirror:start', configuration),
    stop: () => ipcRenderer.invoke('ios-mirror:stop'),
    onFrame: (listener) => {
      iosMirrorFrameListeners.add(listener);
      return () => iosMirrorFrameListeners.delete(listener);
    },
    onStatus: (listener) => {
      iosMirrorStatusListeners.add(listener);
      return () => iosMirrorStatusListeners.delete(listener);
    }
  }
});
