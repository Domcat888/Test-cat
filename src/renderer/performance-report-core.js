(function initializePerformanceReportCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PerformanceReportCore = api;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  const DEFAULT_RULES = [
    { key: 'cpuUsage', direction: 'min', threshold: 85, streak: 3, label: '整机 CPU 持续高于 85%' },
    { key: 'cpuTemperature', direction: 'min', threshold: 85, streak: 2, label: 'CPU/SOC 温度持续高于 85℃' },
    { key: 'fps', direction: 'max', threshold: 45, streak: 3, label: '前台画面 FPS 持续低于 45' },
    { key: 'jankCount', direction: 'min', threshold: 3, streak: 2, label: '连续采样出现多帧卡顿' },
    { key: 'packetLoss', direction: 'min', threshold: 10, streak: 2, label: '网络丢包率持续高于 10%' },
    { key: 'deviceTemperature', direction: 'min', threshold: 42, streak: 2, label: '电池温度持续高于 42℃' },
    { key: 'memoryLeakTrend', direction: 'min', threshold: 5, streak: 3, label: 'App PSS 增长超过 5 MB/分钟' }
  ];

  function percentile(values, ratio) {
    const sorted = (Array.isArray(values) ? values : []).filter(Number.isFinite).sort((left, right) => left - right);
    if (!sorted.length) return null;
    const position = Math.max(0, Math.min(1, Number(ratio) || 0)) * (sorted.length - 1);
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  }

  function summarizeValues(values) {
    const valid = (Array.isArray(values) ? values : []).filter(Number.isFinite);
    if (!valid.length) return null;
    const sum = valid.reduce((total, value) => total + value, 0);
    return {
      count: valid.length,
      avg: sum / valid.length,
      min: Math.min(...valid),
      max: Math.max(...valid),
      p50: percentile(valid, 0.5),
      p90: percentile(valid, 0.9),
      p95: percentile(valid, 0.95),
      p99: percentile(valid, 0.99)
    };
  }

  function evaluateAnomalies(sample, tracker = {}, rules = DEFAULT_RULES, cooldownMs = 60000) {
    const events = [];
    const now = Number(sample?.timestamp) || Date.now();
    for (const rule of rules) {
      const value = Number(sample?.[rule.key]);
      const quality = sample?.quality?.[rule.key];
      const usable = Number.isFinite(value) && quality?.state !== 'unavailable';
      const foregroundRequired = rule.key === 'fps' || rule.key === 'jankCount';
      const active = usable
        && (!foregroundRequired || sample?.appState?.foreground !== false)
        && (rule.direction === 'max' ? value < rule.threshold : value > rule.threshold);
      const state = tracker[rule.key] || { streak: 0, lastEventAt: 0 };
      state.streak = active ? state.streak + 1 : 0;
      if (active && state.streak >= rule.streak && now - state.lastEventAt >= cooldownMs) {
        state.lastEventAt = now;
        events.push({
          timestamp: now,
          elapsed: Number(sample?.elapsed) || 0,
          type: 'performance-warning',
          level: 'warning',
          metric: rule.key,
          label: rule.label,
          value,
          threshold: rule.threshold,
          packageName: sample?.packageName || ''
        });
      }
      tracker[rule.key] = state;
    }
    return events;
  }

  function minMaxDownsample(samples, key, maxPoints = 600) {
    const values = (Array.isArray(samples) ? samples : [])
      .map((sample, index) => ({ index, timestamp: Number(sample.timestamp) || index, elapsed: Number(sample.elapsed) || 0, value: Number(sample[key]) }))
      .filter((point) => Number.isFinite(point.value));
    if (values.length <= maxPoints) return values;
    const bucketCount = Math.max(1, Math.floor(maxPoints / 2));
    const bucketSize = values.length / bucketCount;
    const result = [];
    for (let bucket = 0; bucket < bucketCount; bucket += 1) {
      const start = Math.floor(bucket * bucketSize);
      const end = Math.min(values.length, Math.floor((bucket + 1) * bucketSize));
      const slice = values.slice(start, Math.max(start + 1, end));
      let minimum = slice[0];
      let maximum = slice[0];
      for (const point of slice) {
        if (point.value < minimum.value) minimum = point;
        if (point.value > maximum.value) maximum = point;
      }
      result.push(...(minimum.index <= maximum.index ? [minimum, maximum] : [maximum, minimum]));
    }
    return result;
  }

  return { DEFAULT_RULES, evaluateAnomalies, minMaxDownsample, percentile, summarizeValues };
});
