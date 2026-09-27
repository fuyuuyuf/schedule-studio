// 网页提醒与托盘服务使用相同的任务数据，浏览器关闭后由托盘接管。
const REMINDER_API = 'http://127.0.0.1:3456';
const REMINDER_CLIENT_KEY = 'solarized-reminder-client-v1';
let reminderClientId = localStorage.getItem(REMINDER_CLIENT_KEY);
if (!reminderClientId) {
  reminderClientId = crypto.randomUUID?.() || `client-${Date.now()}`;
  localStorage.setItem(REMINDER_CLIENT_KEY, reminderClientId);
}
let browserReminderTimer = null;
let reminderToastTimer = null;
const firedBrowserJobs = new Set();

function reminderJobs(event) {
  if (!event.reminder?.enabled || !event.endDate) return [];
  const start = addDays(new Date(), -2);
  const end = addDays(new Date(), 400);
  const instances = event.recurrence ? expandEvent(event, start, end) : [event];
  return instances.flatMap(instance => {
    const [year, month, day] = instance.endDate.split('-').map(Number);
    const deadline = new Date(year, month - 1, day, 0, instance.end).getTime();
    const jobs = [{ key: `${event.id}:time:${deadline - event.reminder.minutesBefore * 60000}`, at: deadline - event.reminder.minutesBefore * 60000, kind: '时间提醒', deadline }];
    if (instance.startDate !== instance.endDate && event.reminder.daysBefore > 0) {
      const at = deadline - event.reminder.daysBefore * 86400000;
      jobs.push({ key: `${event.id}:day:${at}`, at, kind: '提前天数提醒', deadline });
    }
    return jobs;
  });
}

function showReminderToast(event, job) {
  const toast = document.querySelector('#reminderToast');
  const deadline = new Date(job.deadline).toLocaleString('zh-CN', { hour12: false });
  toast.textContent = `${event.title}\n${event.notes?.trim() || '无备注'}\n截止：${deadline}`;
  toast.hidden = false;
  clearTimeout(reminderToastTimer);
  reminderToastTimer = setTimeout(() => { toast.hidden = true; }, 3000);
}
document.querySelector('#reminderToast').addEventListener('click', event => { event.currentTarget.hidden = true; clearTimeout(reminderToastTimer); });

function scheduleBrowserReminder() {
  clearTimeout(browserReminderTimer);
  const now = Date.now();
  const upcoming = events.flatMap(event => reminderJobs(event).map(job => ({ event, job })))
    .filter(item => !firedBrowserJobs.has(item.job.key) && item.job.at > now - 3000)
    .sort((a, b) => a.job.at - b.job.at);
  if (!upcoming.length) return;
  const next = upcoming[0];
  browserReminderTimer = setTimeout(() => {
    if (Date.now() >= next.job.at && !firedBrowserJobs.has(next.job.key)) {
      firedBrowserJobs.add(next.job.key);
      showReminderToast(next.event, next.job);
    }
    scheduleBrowserReminder();
  }, Math.max(0, Math.min(next.job.at - now, 2147483647)));
}

async function syncBrowserReminders() {
  scheduleBrowserReminder();
  try {
    await fetch(`${REMINDER_API}/sync-reminders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: reminderClientId, events: events.filter(event => event.reminder?.enabled), epoch: localStorage.getItem('schedule-studio-data-epoch') || '0' }),
    });
  } catch (_) {
    // 未启动托盘时仍保留页面内提醒；下次打开网页会重新同步。
  }
}

async function pushBrowserReminder(event) {
  if (!event.reminder?.enabled) return;
  try {
    await fetch(`${REMINDER_API}/add-reminder`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: reminderClientId, event, epoch: localStorage.getItem('schedule-studio-data-epoch') || '0' }),
    });
  } catch (_) { /* 服务未启动时保留浏览器内提醒。 */ }
}

syncBrowserReminders();
