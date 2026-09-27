const epochKey = 'schedule-studio-data-epoch';
const cacheKeys = ['solarized-schedule-v1', 'solarized-day-marks-v1', 'solarized-sticky-notes-v1', 'schedule-studio-stickers-v1',
  'solarized-appearance-v1', 'solarized-theme-v1', 'solarized-reverse-wheel-v1', 'solarized-reminder-client-v1'];

async function readEpoch() {
  const response = await fetch('http://127.0.0.1:3456/api/v1/data/status', { cache: 'no-store' });
  if (!response.ok) throw new Error('无法读取数据版本');
  return (await response.json()).data.epoch;
}

async function syncEpoch() {
  const epoch = await readEpoch();
  const previous = localStorage.getItem(epochKey);
  if (previous && previous !== epoch) {
    for (const key of cacheKeys) localStorage.removeItem(key);
    localStorage.setItem('solarized-schedule-v1', '[]');
  }
  // 首次升级到数据版本机制时保留旧版浏览器缓存，以便迁移到 SQLite。
  if (!previous && epoch !== '0') {
    for (const key of cacheKeys) localStorage.removeItem(key);
    localStorage.setItem('solarized-schedule-v1', '[]');
  }
  localStorage.setItem(epochKey, epoch);
  return previous && previous !== epoch;
}

try { await syncEpoch(); } catch (_) { /* 离线时继续读取已有网页缓存。 */ }
for (const source of ['./app.js', './features.js', './reminders.js']) {
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = source;
    script.onload = resolve;
    script.onerror = reject;
    document.body.append(script);
  });
}
void import('http://127.0.0.1:3456/components-runtime.js').catch(() => {});
setInterval(async () => {
  try { if (await syncEpoch()) location.reload(); } catch (_) { /* 本地服务暂不可用。 */ }
}, 5000);
