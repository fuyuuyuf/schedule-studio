const STORAGE_KEY = 'solarized-schedule-v1';
const HOUR_START = 0;
const HOUR_END = 24;
const HOUR_HEIGHT = 72;
const COLORS = ['#2aa198', '#268bd2', '#6c71c4', '#859900', '#b58900', '#cb4b16', '#d33682', '#dc322f'];
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const $ = selector => document.querySelector(selector);
const pad = number => String(number).padStart(2, '0');
const makeId = () => crypto.randomUUID?.() || `event-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const toKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parseKey = key => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
};
const addDays = (date, amount) => {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
};
const startOfWeek = date => {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  return result;
};
const formatTime = minutes => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const snapMinutes = value => Math.max(HOUR_START * 60, Math.min(HOUR_END * 60, Math.round(value / 15) * 15));
const escapeHtml = text => String(text || '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

const today = new Date();
let monthAnchor = new Date(today.getFullYear(), today.getMonth(), 1);
let centerDate = parseKey(toKey(today));
let horizontalOffset = 0;
let dateRangeAnchor = null;
const CACHE_RADIUS = 27;
const DAY_WIDTH = 128;
let events = loadEvents();
let editing = null;
let editingId = null;
let assistMode = 'time';
let dragging = null;
let edgeScrollTimer = null;
let dragPointer = null;
let suppressCalendarClick = false;
let toastTimer;
let lastClockMinute = '';
let currentMode = 'edit';
let hoverNoteTimer = null;
const DAY_MARK_KEY = 'solarized-day-marks-v1';
let dayMarks = (() => { try { return JSON.parse(localStorage.getItem(DAY_MARK_KEY)) || {}; } catch (_) { return {}; } })();
let reverseWheel = localStorage.getItem('solarized-reverse-wheel-v1') === 'true';

function seedEvents() {
  const todayKey = toKey(today);
  const tomorrowKey = toKey(addDays(today, 1));
  return [
    { id: makeId(), title: '整理本周计划', dates: [todayKey], start: 570, end: 645, color: COLORS[0], notes: '## 今日重点\n- 梳理三件最重要的事\n- 为每件事留出缓冲时间' },
    { id: makeId(), title: '算法复习', dates: [todayKey], start: 840, end: 960, color: COLORS[4], notes: '**主题：** 动态规划\n\n完成两道练习题。' },
    { id: makeId(), title: '晚间散步', dates: [todayKey], start: 1160, end: 1200, color: COLORS[2], notes: '不带耳机，放空一下。' },
    { id: makeId(), title: '项目回顾', dates: [tomorrowKey], start: 630, end: 720, color: COLORS[1], notes: '记录本周的进展与阻塞。' },
  ];
}

function loadEvents() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(saved) ? saved : seedEvents();
  } catch (_) {
    return seedEvents();
  }
}

function persistEvents() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  if (typeof syncBrowserReminders === 'function') syncBrowserReminders();
  void fetch('http://127.0.0.1:3456/api/v1/schedules', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schedules: events, epoch: localStorage.getItem('schedule-studio-data-epoch') || '0' }),
  }).catch(() => {});
}

async function synchronizeSchedulesWithService() {
  try {
    const response = await fetch('http://127.0.0.1:3456/api/v1/schedules/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schedules: events, epoch: localStorage.getItem('schedule-studio-data-epoch') || '0' }),
    });
    const result = await response.json();
    if (!response.ok || !Array.isArray(result.data?.schedules)) return;
    events = result.data.schedules;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    renderStandby(); renderWeek();
  } catch (_) { /* 服务未运行时继续使用浏览器缓存。 */ }
}

async function refreshSchedulesFromService() {
  if (editing || dragging) return;
  try {
    const response = await fetch('http://127.0.0.1:3456/api/v1/schedules');
    const result = await response.json();
    const remote = result.data?.schedules;
    if (!response.ok || !Array.isArray(remote) || JSON.stringify(remote) === JSON.stringify(events)) return;
    events = remote;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    renderStandby(); renderWeek();
  } catch (_) { /* 本地服务暂时不可用时保持当前视图。 */ }
}

function dateText(key, includeWeekday = false) {
  return parseKey(key).toLocaleDateString('zh-CN', {
    month: 'numeric', day: 'numeric', ...(includeWeekday ? { weekday: 'short' } : {}),
  });
}

function rangeDates(startKey, endKey) {
  const start = parseKey(startKey);
  const end = parseKey(endKey);
  const direction = start <= end ? 1 : -1;
  const result = [];
  for (let cursor = start; direction > 0 ? cursor <= end : cursor >= end; cursor = addDays(cursor, direction)) result.push(toKey(cursor));
  return result.sort();
}

function updateClock() {
  const now = new Date();
  const minuteKey = `${toKey(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  $('#clockColon').classList.toggle('off', now.getSeconds() % 2 === 1);
  if (minuteKey === lastClockMinute) return;
  lastClockMinute = minuteKey;
  $('#clockHours').textContent = pad(now.getHours());
  $('#clockMinutes').textContent = pad(now.getMinutes());
  $('#standbyClock').setAttribute('aria-label', `${pad(now.getHours())}时${pad(now.getMinutes())}分`);
  $('#standbyDate').textContent = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  renderStandby();
  updateNowLine();
  refreshExpiredEventStyles();
}

function tickClock() {
  updateClock();
  setTimeout(tickClock, 1000 - new Date().getMilliseconds());
}

function progressFor(event, key) {
  if (event.span) {
    const start = parseKey(event.startDate).getTime() + event.start * 60000;
    const end = parseKey(event.endDate).getTime() + event.end * 60000;
    return Math.max(0, Math.min(100, Math.floor((Date.now() - start) / (end - start) * 100)));
  }
  const now = new Date();
  const currentKey = toKey(now);
  if (key < currentKey) return 100;
  if (key > currentKey) return 0;
  const minute = now.getHours() * 60 + now.getMinutes();
  if (minute <= event.start) return 0;
  if (minute >= event.end) return 100;
  return Math.round(((minute - event.start) / (event.end - event.start)) * 100);
}

function renderStandby() {
  const now = new Date();
  const currentStamp = now.getTime();
  const instances = visibleEvents().flatMap(event => event.span
    ? [{ ...event, key: event.startDate, stamp: parseKey(event.endDate).getTime() + event.end * 60000 }]
    : event.dates.map(key => ({ ...event, key, stamp: parseKey(key).getTime() + event.end * 60000 })));
  const upcoming = instances.filter(item => item.stamp >= currentStamp - 30 * 60000).sort((a, b) => a.stamp - b.stamp);
  const past = instances.filter(item => item.stamp < currentStamp - 30 * 60000).sort((a, b) => b.stamp - a.stamp);
  const selected = [...upcoming.slice(0, 3), ...past.slice(0, Math.max(0, 3 - upcoming.length))];
  $('#nextTasks').innerHTML = selected.length ? selected.map(item => {
    const progress = progressFor(item, item.key);
    const state = progress === 100 ? '已完成' : progress > 0 ? `已进行 ${progress}%` : '尚未开始';
    return `<article class="task-card" data-event-id="${item.id}" style="--task-color:${item.color}">
      <time>${dateText(item.key, true)} · ${formatTime(item.start)}—${item.span && item.endDate !== item.startDate ? dateText(item.endDate) + ' ' : ''}${formatTime(item.end)}</time>
      <h3>${escapeHtml(item.title)}</h3>
      <div><div class="progress-track"><div class="progress-fill" style="--progress:${progress}%"></div></div>
      <div class="task-meta"><span>${state}</span><span>${progress}%</span></div></div>
    </article>`;
  }).join('') : '<div class="empty-state">还没有日程。按 Tab 打开周视图，拖动创建第一项。</div>';
  document.querySelectorAll('.task-card').forEach(card => card.addEventListener('click', () => {
    showView('week');
    if (currentMode === 'edit') openEditor(events.find(event => event.id === card.dataset.eventId));
  }));
}

function dayMarkClasses(key) {
  const color = dayMarks[key];
  if (!color) return '';
  return `day-marked ${dayMarks[toKey(addDays(parseKey(key), -1))] === color ? 'join-left' : ''} ${dayMarks[toKey(addDays(parseKey(key), 1))] === color ? 'join-right' : ''}`;
}

function dayMarkStyle(key) {
  return dayMarks[key] ? `style="--day-mark-color:${dayMarks[key]}"` : '';
}

function renderWeek() {
  hideEventHoverNote();
  const dayCount = CACHE_RADIUS * 2 + 1;
  const days = Array.from({ length: dayCount }, (_, index) => addDays(centerDate, index - CACHE_RADIUS));
  $('#weekTitle').textContent = `${centerDate.getFullYear()}年 ${centerDate.getMonth() + 1}月`;
  $('#weekHeader').style.setProperty('--day-count', dayCount);
  $('#timeline').style.setProperty('--day-count', dayCount);
  $('#weekHeader').innerHTML = '<div class="week-corner">GMT+8</div>' + days.map((date, index) => `
    <div class="day-head ${toKey(date) === toKey(new Date()) ? 'today' : ''} ${dayMarkClasses(toKey(date))}" data-date="${toKey(date)}" ${dayMarkStyle(toKey(date))}>
      <div class="dow">${WEEKDAYS[(date.getDay() + 6) % 7]}</div><div class="day-num">${date.getMonth() + 1}/${date.getDate()}</div>
    </div>`).join('');

  const labels = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, index) => {
    const hour = HOUR_START + index;
    return `<span class="time-label" style="top:${index * HOUR_HEIGHT}px">${pad(hour)}:00</span>`;
  }).join('');

  $('#timeline').innerHTML = `<div class="time-axis">${labels}</div>` + days.map(date => {
    const key = toKey(date);
    const blocks = blocksForDate(key);
    return `<div class="day-column" data-date="${key}">${blocks}<div class="selection-layer"></div></div>`;
  }).join('') + '<div id="spanLayer" class="span-layer"></div>';

  bindCalendarInteractions();
  renderSpanLayer();
  updateNowLine();
  positionDays();
  if (dragging) paintSelection();
}

// 日期缓存仅影响界面，历史日程仍完整保存在本地。
function recurrenceMatches(date, start, recurrence) {
  const days = Math.round((date - start) / 86400000);
  if (days < 0) return false;
  if (recurrence.frequency === 'daily') return days % recurrence.interval === 0;
  if (recurrence.frequency === 'weekly') {
    const weekday = date.getDay() || 7;
    const selected = recurrence.weekdays?.length ? recurrence.weekdays : [start.getDay() || 7];
    return Math.floor(days / 7) % recurrence.interval === 0 && selected.includes(weekday);
  }
  if (recurrence.frequency === 'monthly') return ((date.getFullYear() - start.getFullYear()) * 12 + date.getMonth() - start.getMonth()) % recurrence.interval === 0 && date.getDate() === start.getDate();
  return (date.getFullYear() - start.getFullYear()) % recurrence.interval === 0 && date.getMonth() === start.getMonth() && date.getDate() === start.getDate();
}

function expandEvent(event, rangeStart, rangeEnd) {
  if (!event.recurrence) return [event];
  const recurrence = { interval: 1, weekdays: [], exclusions: [], ...event.recurrence };
  const start = parseKey(event.startDate);
  const duration = Math.round((parseKey(event.endDate) - start) / 86400000);
  const results = [];
  let matched = 0;
  for (let cursor = new Date(start); cursor <= rangeEnd; cursor = addDays(cursor, 1)) {
    if (!recurrenceMatches(cursor, start, recurrence)) continue;
    matched += 1;
    const key = toKey(cursor);
    if (recurrence.count && matched > recurrence.count) break;
    if (recurrence.until && key > recurrence.until) break;
    if (cursor < addDays(rangeStart, -duration) || recurrence.exclusions?.includes(key)) continue;
    const occurrenceEnd = toKey(addDays(cursor, duration));
    results.push({ ...event, seriesId: event.id, occurrenceDate: key, startDate: key, endDate: occurrenceEnd, dates: [key, occurrenceEnd] });
  }
  return results;
}

function visibleEvents() {
  const source = editing ? [...events.filter(event => event.id !== editingId), editing] : events;
  const first = addDays(centerDate, -CACHE_RADIUS);
  const last = addDays(centerDate, CACHE_RADIUS);
  return source.flatMap(event => event === editing ? [event] : expandEvent(event, first, last));
}

function segmentForDate(event, key) {
  if (!event.span) return event.dates.includes(key) ? event : null;
  if (key < event.startDate || key > event.endDate) return null;
  const start = key === event.startDate ? event.start : 0;
  const end = key === event.endDate ? event.end : 1440;
  return end > start ? { ...event, start, end } : null;
}

// 只挖掉指定日期；跨天日程位于中间时拆成前后两段。
function removeDayFromEvent(event, key) {
  if (!segmentForDate(event, key)) return [event];
  if (!event.span) {
    const dates = event.dates.filter(date => date !== key);
    return dates.length ? [{ ...event, dates }] : [];
  }
  const before = key > event.startDate;
  const lastActiveDate = event.end === 0 ? toKey(addDays(parseKey(event.endDate), -1)) : event.endDate;
  const after = key < lastActiveDate;
  const parts = [];
  if (before) {
    const endDate = toKey(addDays(parseKey(key), -1));
    parts.push({ ...event, endDate, end: 1440, dates: [event.startDate, endDate] });
  }
  if (after) {
    const startDate = toKey(addDays(parseKey(key), 1));
    parts.push({ ...event, id: before ? makeId() : event.id, startDate, start: 0,
      displayMinute: 0, dates: [startDate, event.endDate] });
  }
  return parts;
}

function blocksForDate(key) {
  return visibleEvents().filter(event => !event.span || event.startDate === event.endDate)
    .map(event => segmentForDate(event, key)).filter(Boolean)
    .map(event => eventMarkup({ ...event, renderDate: key }, editing && event.id === editing.id)).join('');
}

function eventDeadline(event) {
  const dateKey = event.span ? event.endDate : event.renderDate || event.dates?.[0];
  if (!dateKey) return Number.POSITIVE_INFINITY;
  return parseKey(dateKey).getTime() + Number(event.end || 0) * 60000;
}

function eventIsExpired(event) {
  return eventDeadline(event) < Date.now();
}

function refreshExpiredEventStyles() {
  document.querySelectorAll('.event-block:not(.draft)').forEach(block => {
    const event = events.find(item => item.id === block.dataset.eventId);
    if (!event) return;
    block.classList.toggle('expired', eventIsExpired({ ...event, renderDate: block.dataset.renderDate || undefined }));
  });
}

function spanBounds(event) {
  const first = toKey(addDays(centerDate, -CACHE_RADIUS));
  const last = toKey(addDays(centerDate, CACHE_RADIUS));
  const visibleEnd = event.end === 0 ? toKey(addDays(parseKey(event.endDate), -1)) : event.endDate;
  if (event.startDate > last || visibleEnd < first) return null;
  const startKey = event.startDate < first ? first : event.startDate;
  const endKey = visibleEnd > last ? last : visibleEnd;
  const daysBetween = (a, b) => {
    const left = parseKey(a), right = parseKey(b);
    return Math.round((Date.UTC(right.getFullYear(), right.getMonth(), right.getDate()) - Date.UTC(left.getFullYear(), left.getMonth(), left.getDate())) / 86400000);
  };
  return { left: daysBetween(first, startKey) * DAY_WIDTH + 7,
    width: (daysBetween(startKey, endKey) + 1) * DAY_WIDTH - 14,
    // 横向拖选时沿用按下鼠标的高度，日期和另一端时间变化不移动矩形。
    top: (event.displayMinute ?? event.start) / 60 * HOUR_HEIGHT };
}

function spanMarkup(event, draft = false) {
  const bounds = spanBounds(event);
  if (!bounds) return '';
  const label = `${dateText(event.startDate)} ${formatTime(event.start)} — ${dateText(event.endDate)} ${formatTime(event.end)}`;
  const expiredClass = !draft && eventIsExpired(event) ? 'expired' : '';
  return `<article class="event-block event-span ${draft ? 'draft' : ''} ${event.marked ? 'marked' : ''} ${expiredClass}" data-event-id="${event.id || ''}"
    style="--event-color:${event.color};left:${bounds.left}px;top:${bounds.top}px;width:${bounds.width}px">
    <strong class="event-title">${escapeHtml(event.title || '新日程')}</strong><span class="event-time">${label}</span>
    ${draft && editing ? '<button class="event-resize-handle" type="button" aria-label="拖动调整日程结束日期和时间"></button>' : ''}
  </article>`;
}

function renderSpanLayer() {
  $('#spanLayer').innerHTML = visibleEvents().filter(event => event.span && event.startDate !== event.endDate)
    .map(event => spanMarkup(event, editing && event.id === editing.id)).join('');
}

function refreshLivePreview() {
  document.querySelectorAll('.day-column').forEach(column => {
    column.querySelectorAll('.event-block').forEach(block => block.remove());
    column.insertAdjacentHTML('afterbegin', blocksForDate(column.dataset.date));
  });
  renderSpanLayer();
  renderStandby();
}

function positionDays() {
  const width = $('.calendar-frame').clientWidth;
  const shift = (width - 74 - DAY_WIDTH) / 2 - CACHE_RADIUS * DAY_WIDTH - horizontalOffset;
  $('.calendar-frame').style.setProperty('--days-shift', `${shift}px`);
}

function panDays(delta) {
  horizontalOffset += delta;
  const shift = Math.trunc(horizontalOffset / DAY_WIDTH);
  if (shift) {
    centerDate = addDays(centerDate, shift);
    horizontalOffset -= shift * DAY_WIDTH;
    renderWeek();
  } else positionDays();
}

function eventMarkup(event, isDraft = false) {
  const top = ((event.start - HOUR_START * 60) / 60) * HOUR_HEIGHT;
  const height = Math.max(24, ((event.end - event.start) / 60) * HOUR_HEIGHT);
  const notes = !isDraft && height >= 108 && event.notes?.trim() ? `<div class="event-notes">${markdownToHtml(event.notes)}</div>` : '';
  const expiredClass = !isDraft && eventIsExpired(event) ? 'expired' : '';
  return `<article class="event-block ${isDraft ? 'draft' : ''} ${event.marked ? 'marked' : ''} ${expiredClass}" data-event-id="${event.id || ''}" data-render-date="${event.renderDate || ''}" style="--event-color:${event.color};top:${top}px;height:${height}px">
    <strong class="event-title">${escapeHtml(event.title || '新日程')}</strong>
    <span class="event-time">${formatTime(event.start)}—${formatTime(event.end)}</span>
    ${notes}
    ${isDraft && editing ? '<button class="event-resize-handle" type="button" aria-label="拖动调整日程结束时间"></button>' : ''}
  </article>`;
}

function pointerMinute(column, clientY) {
  const rect = column.getBoundingClientRect();
  return snapMinutes(HOUR_START * 60 + ((clientY - rect.top) / HOUR_HEIGHT) * 60);
}

function bindCalendarInteractions() {
  document.querySelectorAll('.day-column').forEach(column => {
    column.addEventListener('contextmenu', event => {
      if (currentMode !== 'edit' || editing || suppressCalendarClick) { event.preventDefault(); return; }
      if (event.target.closest('.event-block')) return;
      event.preventDefault();
      const start = Math.min(pointerMinute(column, event.clientY), HOUR_END * 60 - 60);
      openEditor({ id: null, title: '', dates: [column.dataset.date], start, end: start + 60, color: COLORS[0], notes: '' }, true);
    });
    column.addEventListener('mousedown', event => {
      if (currentMode !== 'edit' || editing || suppressCalendarClick || event.button !== 0 || event.target.closest('.event-block')) return;
      const start = Math.min(pointerMinute(column, event.clientY), HOUR_END * 60 - 15);
      dragging = { date: column.dataset.date, currentDate: column.dataset.date, anchor: start, current: Math.min(start + 15, HOUR_END * 60) };
      dragPointer = { x: event.clientX, y: event.clientY };
      startEdgeScroll();
      paintSelection();
      event.preventDefault();
    });
    column.addEventListener('mousemove', event => {
      if (!dragging || editing || currentMode !== 'edit') return;
      dragging.currentDate = column.dataset.date;
      dragging.current = pointerMinute(column, event.clientY);
      dragPointer = { x: event.clientX, y: event.clientY };
      paintSelection();
    });
  });
}

['click', 'dblclick'].forEach(type => $('#timeline').addEventListener(type, event => {
  const block = event.target.closest('.event-block');
  if (!block || editing || suppressCalendarClick) return;
  const value = events.find(item => item.id === block.dataset.eventId);
  if (!value) return;
  if (currentMode === 'mark') {
    if (type === 'click' && event.detail === 1) {
      value.marked = !value.marked;
      persistEvents();
      refreshLivePreview();
    }
  } else openEditor(value, type === 'dblclick');
}));

function hideEventHoverNote() {
  clearTimeout(hoverNoteTimer);
  $('#eventHoverNote').hidden = true;
}

$('#timeline').addEventListener('mouseover', event => {
  const block = event.target.closest('.event-block');
  if (!block || block.contains(event.relatedTarget) || editing) return;
  hideEventHoverNote();
  const value = events.find(item => item.id === block.dataset.eventId);
  if (!value?.notes?.trim()) return;
  hoverNoteTimer = setTimeout(() => {
    if (!block.isConnected || editing || dragging) return;
    const tooltip = $('#eventHoverNote');
    tooltip.innerHTML = `<strong>${escapeHtml(value.title)}</strong><div>${markdownToHtml(value.notes)}</div>`;
    tooltip.hidden = false;
    const bounds = block.getBoundingClientRect();
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    const left = bounds.right + width + 12 <= innerWidth ? bounds.right + 12 : Math.max(8, bounds.left - width - 12);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(8, Math.min(bounds.top, innerHeight - height - 8))}px`;
  }, 1000);
});
$('#timeline').addEventListener('mouseout', event => {
  const block = event.target.closest('.event-block');
  if (block && !block.contains(event.relatedTarget)) hideEventHoverNote();
});
$('#timeline').addEventListener('pointerdown', hideEventHoverNote);
window.addEventListener('scroll', hideEventHoverNote, true);

$('#openSoftwareButton').addEventListener('click', async () => {
  try {
    const health = await fetch('http://127.0.0.1:3456/health', { signal: AbortSignal.timeout(1500) });
    if (!health.ok) throw new Error('提醒服务不可用');
    const service = await health.json();
    if (service.build !== '2026-09-26-components-v13') {
      await fetch('http://127.0.0.1:3456/quit', { method: 'POST', signal: AbortSignal.timeout(1500) });
      throw new Error('正在启动新版软件');
    }
    const response = await fetch('http://127.0.0.1:3456/open-main', { method: 'POST', signal: AbortSignal.timeout(1500) });
    if (!response.ok) throw new Error('软件尚未启动');
  } catch (_) {
    // 浏览器不能直接执行本地程序，通过软件启动时注册的协议入口唤起。
    location.href = 'schedule-studio://open-main';
  }
});

// 在按下阶段取消，避免同一次点击又触发拖选或重新打开日程。
document.addEventListener('mousedown', event => {
  if (!event.target.closest('#weekView')) return;
  if (event.button === 1 || event.target.closest('.event-resize-handle')) return;
  suppressCalendarClick = Boolean(editing);
  if (!editing) return;
  // 双击同一日程的第二次按下仍用于聚焦标题，不误判为取消。
  const block = event.target.closest('.event-block');
  if (event.detail > 1 && block && editingId && block.dataset.eventId === editingId) {
    $('#eventTitle').focus();
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  dragging = null;
  closeEditor();
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

['start', 'end'].forEach(field => {
  const input = field === 'start' ? $('#editorStartDate') : $('#editorEndDate');
  input.addEventListener('change', () => {
    if (!editing || !input.value) return;
    editing[`${field}Date`] = input.value;
    ensureEndAfterStart();
    monthAnchor = parseKey(input.value);
    updateEditorFields();
    if (assistMode === 'date') renderDateAssist();
    if (assistMode === 'time') renderTimeAssist();
  });
});

document.addEventListener('mousemove', event => {
  if (dragging) dragPointer = { x: event.clientX, y: event.clientY };
});

function startEdgeScroll() {
  clearInterval(edgeScrollTimer);
  edgeScrollTimer = setInterval(() => {
    if (!dragging || currentMode !== 'edit' || !dragPointer) { clearInterval(edgeScrollTimer); return; }
    const frame = $('.calendar-frame').getBoundingClientRect();
    const x = dragPointer.x;
    if (x < frame.left || x > frame.right || dragPointer.y < frame.top || dragPointer.y > frame.bottom) return;
    const edge = 64;
    const delta = x < frame.left + edge ? -12 : x > frame.right - edge ? 12 : 0;
    if (!delta) return;
    panDays(delta);
    const column = document.elementFromPoint(x, dragPointer.y)?.closest('.day-column');
    if (column) {
      dragging.currentDate = column.dataset.date;
      dragging.current = pointerMinute(column, dragPointer.y);
      paintSelection();
    }
  }, 24);
}
$('#eventTitle').addEventListener('input', event => {
  if (!editing) return;
  editing.title = event.target.value;
  refreshLivePreview();
});

function paintSelection() {
  document.querySelectorAll('.selection-layer').forEach(layer => { layer.innerHTML = ''; });
  const spanLayer = $('#spanLayer');
  if (spanLayer) spanLayer.querySelectorAll('.selection-span').forEach(block => block.remove());
  if (!dragging) return;
  const range = selectedRange(dragging);
  if (range.startDate !== range.endDate) {
    spanLayer.insertAdjacentHTML('beforeend', spanMarkup({ ...range, title: '拖动选择', color: COLORS[0] }, true).replace('event-span draft', 'event-span draft selection-span'));
    return;
  }
  document.querySelectorAll('.day-column').forEach(column => {
    const segment = segmentForDate(range, column.dataset.date);
    if (segment) column.querySelector('.selection-layer').innerHTML = eventMarkup({ ...segment, title: '拖动选择', color: COLORS[0] }, true);
  });
}

function selectedRange(selection) {
  const points = [
    { date: selection.date, minute: selection.anchor },
    { date: selection.currentDate, minute: selection.current },
  ].sort((a, b) => a.date.localeCompare(b.date) || a.minute - b.minute);
  const [first, last] = points;
  return { span: true, startDate: first.date, endDate: last.date,
    start: first.minute, end: first.date === last.date ? Math.max(last.minute, first.minute + 15) : last.minute,
    displayMinute: selection.anchor };
}

document.addEventListener('mouseup', () => {
  if (!dragging) return;
  clearInterval(edgeScrollTimer);
  dragPointer = null;
  const range = selectedRange(dragging);
  const draft = { id: null, title: '', dates: [range.startDate, range.endDate], ...range, color: COLORS[0], notes: '' };
  dragging = null;
  paintSelection();
  openEditor(draft, true);
});

function openEditor(event, focusTitle = false) {
  closeJumpCalendar();
  editingId = event.id || null;
  const dates = [...event.dates].sort();
  editing = { ...event, dates, span: true, startDate: event.startDate || dates[0], endDate: event.endDate || dates.at(-1) };
  editing.reminder = { enabled: false, minutesBefore: 10, daysBefore: 0, ...event.reminder };
  editing.recurrence = event.recurrence ? { interval: 1, weekdays: [], exclusions: [], ...event.recurrence } : null;
  monthAnchor = parseKey(editing.startDate);
  dateRangeAnchor = null;
  assistMode = 'time';
  $('#editorHeading').textContent = editingId ? '修改日程' : '新建日程';
  $('#eventTitle').value = editing.title;
  $('#deleteButton').style.visibility = editingId ? 'visible' : 'hidden';
  renderColorPicker();
  updateEditorFields();
  switchAssist(assistMode || 'time');
  $('#detailPanel').classList.add('open');
  $('#assistPanel').classList.add('open');
  $('#detailPanel').setAttribute('aria-hidden', 'false');
  $('#assistPanel').setAttribute('aria-hidden', 'false');
  if (focusTitle) setTimeout(() => { if (editing) $('#eventTitle').focus(); }, 220);
}

function closeEditor() {
  editing = null;
  editingId = null;
  $('#detailPanel').classList.remove('open');
  $('#assistPanel').classList.remove('open');
  $('#detailPanel').setAttribute('aria-hidden', 'true');
  $('#assistPanel').setAttribute('aria-hidden', 'true');
  renderWeek();
  renderStandby();
}

function renderColorPicker() {
  $('#colorPicker').innerHTML = COLORS.map(color => `<button class="color-swatch ${editing.color === color ? 'selected' : ''}" style="--swatch:${color}" data-color="${color}" type="button" role="radio" aria-checked="${editing.color === color}" aria-label="选择颜色 ${color}"></button>`).join('');
  document.querySelectorAll('.color-swatch').forEach(button => button.addEventListener('click', () => {
    editing.color = button.dataset.color;
    renderColorPicker();
    refreshLivePreview();
  }));
}

function updateEditorFields() {
  $('#editorStartDate').value = editing.startDate;
  $('#editorEndDate').value = editing.endDate;
  $('#dateFieldValue').textContent = editing.startDate === editing.endDate ? dateText(editing.startDate, true) : `${dateText(editing.startDate)}—${dateText(editing.endDate)}`;
  $('#timeFieldValue').textContent = `${formatTime(editing.start)}—${formatTime(editing.end)}`;
  $('#noteSummary').textContent = editing.notes?.trim() ? editing.notes.trim().split('\n')[0].replace(/^#+\s*/, '').slice(0, 34) : '添加 Markdown 备注…';
  const reminder = editing.reminder;
  $('#reminderEnabled').checked = Boolean(reminder.enabled);
  $('#reminderOptions').hidden = !reminder.enabled;
  $('#reminderDaysRow').hidden = editing.startDate === editing.endDate;
  const unit = reminder.minutesBefore > 0 && reminder.minutesBefore % 60 === 0 ? 'hour' : 'minute';
  $('#reminderLeadUnit').value = unit;
  $('#reminderLeadValue').value = unit === 'hour' ? reminder.minutesBefore / 60 : reminder.minutesBefore;
  $('#reminderDays').value = reminder.daysBefore || 0;
  const recurrence = editing.recurrence;
  $('#recurrenceEnabled').checked = Boolean(recurrence);
  $('#recurrenceOptions').hidden = !recurrence;
  $('#recurrenceFrequency').value = recurrence?.frequency || 'weekly';
  $('#recurrenceInterval').value = recurrence?.interval || 1;
  $('#recurrenceUntil').value = recurrence?.until || '';
  $('#recurrenceWeekdays').hidden = recurrence?.frequency !== 'weekly';
  document.querySelectorAll('#recurrenceWeekdays input').forEach(input => { input.checked = recurrence?.weekdays?.includes(Number(input.value)) || false; });
  refreshLivePreview();
}

function switchAssist(mode) {
  assistMode = mode;
  $('#timeAssist').classList.toggle('hidden', mode !== 'time');
  $('#dateAssist').classList.toggle('hidden', mode !== 'date');
  $('#noteAssist').classList.toggle('hidden', mode !== 'note');
  $('#assistHeading').textContent = mode === 'time' ? '选择时间' : mode === 'date' ? '选择日期' : '详细备注';
  if (mode === 'time') renderTimeAssist();
  if (mode === 'date') renderDateAssist();
  if (mode === 'note') renderNoteAssist();
}

function wheelValues(value, min, max, step = 1) {
  return [-2, -1, 0, 1, 2].map(offset => {
    let next = value + offset * step;
    const span = max - min + step;
    while (next < min) next += span;
    while (next > max) next -= span;
    return next;
  });
}

function wheelColumn(label, value, min, max, step, field, part) {
  return `<div class="wheel-column" data-field="${field}" data-part="${part}" data-max="${max}" data-value="${value}"><span class="wheel-label">${label}</span><div class="wheel-window"><div class="wheel-items">${wheelValues(value, min, max, step).map((item, index) => `<button type="button" class="wheel-value ${index === 2 ? 'selected' : ''}" data-field="${field}" data-part="${part}" data-value="${item}">${pad(item)}</button>`).join('')}</div></div></div>`;
}

function renderTimeAssist() {
  const startHour = Math.floor(editing.start / 60);
  const startMinute = editing.start % 60;
  const endHour = Math.floor(editing.end / 60);
  const endMinute = editing.end % 60;
  $('#timeAssist').innerHTML = `
    <div class="time-section"><span class="time-section-title">开始 · ${dateText(editing.startDate)}</span><div class="time-wheel">${wheelColumn('时', startHour, HOUR_START, 23, 1, 'start', 'hour')}${wheelColumn('分', startMinute, 0, 59, 1, 'start', 'minute')}</div></div>
    <div class="time-divider"><span>${formatTime(editing.start)}</span><i></i><span>${formatTime(editing.end)}</span></div>
    <div class="time-section"><span class="time-section-title">结束 · ${dateText(editing.endDate)}</span><div class="time-wheel">${wheelColumn('时', endHour, HOUR_START, 24, 1, 'end', 'hour')}${wheelColumn('分', endMinute, 0, 59, 1, 'end', 'minute')}</div></div>`;
  document.querySelectorAll('.wheel-value').forEach(button => button.addEventListener('click', () => {
    const value = Number(button.dataset.value);
    const field = button.dataset.field;
    const current = editing[field];
    editing[field] = button.dataset.part === 'hour' ? value * 60 + (current % 60) : Math.floor(current / 60) * 60 + value;
    editing.start = Math.max(HOUR_START * 60, Math.min(editing.start, HOUR_END * 60 - 1));
    editing.end = Math.min(editing.end, HOUR_END * 60);
    if (field === 'start') editing.displayMinute = editing.start;
    ensureEndAfterStart();
    updateEditorFields();
    renderTimeAssist();
  }));
  document.querySelectorAll('.wheel-column').forEach(column => {
    column.addEventListener('wheel', event => {
      event.preventDefault();
      event.stopPropagation();
      if (!event.deltaY) return;
      const direction = Math.sign(event.deltaY);
      const field = column.dataset.field;
      const part = column.dataset.part;
      const max = Number(column.dataset.max);
      const value = (Number(column.dataset.value) + direction + max + 1) % (max + 1);
      editing[field] = part === 'hour' ? value * 60 + editing[field] % 60 : Math.floor(editing[field] / 60) * 60 + value;
      editing.end = Math.min(1440, editing.end);
      if (field === 'start') editing.displayMinute = editing.start;
      ensureEndAfterStart();
      updateEditorFields();
      renderTimeAssist();
      const items = document.querySelector(`.wheel-column[data-field="${field}"][data-part="${part}"] .wheel-items`);
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) items.animate([
        { transform: `translateY(${direction * 38}px)`, opacity: .6 },
        { transform: 'translateY(0)', opacity: 1 },
      ], { duration: 160, easing: 'ease-out' });
    }, { passive: false });
  });
}

function ensureEndAfterStart() {
  if (editing.endDate < editing.startDate) editing.endDate = editing.startDate;
  if (editing.endDate === editing.startDate && editing.end <= editing.start) editing.endDate = toKey(addDays(parseKey(editing.startDate), 1));
}

function renderDateAssist() {
  const anchor = monthAnchor;
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(monthStart);
  const cells = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  $('#dateAssist').innerHTML = `
    <div class="date-bounds"><label>开始日期<input id="startDateInput" type="date" value="${editing.startDate}"></label><label>结束日期<input id="endDateInput" type="date" value="${editing.endDate}"></label></div>
    <div class="month-nav"><button type="button" data-month-step="-1" aria-label="上个月">←</button><strong>${anchor.getFullYear()}年 ${anchor.getMonth() + 1}月</strong><button type="button" data-month-step="1" aria-label="下个月">→</button></div>
    <div class="mini-weekdays">${WEEKDAYS.map(day => `<span>${day.slice(1)}</span>`).join('')}</div>
    <div class="mini-calendar">${cells.map(date => {
      const key = toKey(date);
      const outside = date.getMonth() !== anchor.getMonth();
      return `<button type="button" data-date="${key}" class="mini-day ${outside ? 'outside' : ''} ${key >= editing.startDate && key <= editing.endDate ? 'selected' : ''} ${key === toKey(new Date()) ? 'today' : ''}">${date.getDate()}</button>`;
    }).join('')}</div><p class="assist-hint">拖动选择连续日期；跨月可翻页后 Shift 点击结束日期，也可直接填写起止日期。</p>`;
  document.querySelectorAll('[data-month-step]').forEach(button => button.addEventListener('click', () => {
    monthAnchor = new Date(anchor.getFullYear(), anchor.getMonth() + Number(button.dataset.monthStep), 1);
    renderDateAssist();
  }));
  ['start', 'end'].forEach(field => $(`#${field}DateInput`).addEventListener('change', event => {
    if (!event.target.value) return;
    editing[`${field}Date`] = event.target.value;
    ensureEndAfterStart();
    renderDateSelection();
    renderDateAssist();
  }));
  let dateAnchor = null;
  document.querySelectorAll('.mini-day').forEach(button => {
    button.addEventListener('mousedown', event => {
      event.preventDefault();
      if (event.button !== 0) return;
      dateAnchor = event.shiftKey && dateRangeAnchor ? dateRangeAnchor : button.dataset.date;
      dateRangeAnchor = dateAnchor;
      [editing.startDate, editing.endDate] = [dateAnchor, button.dataset.date].sort();
      ensureEndAfterStart();
      renderDateSelection();
    });
    button.addEventListener('mouseenter', event => {
      if (!dateAnchor || event.buttons !== 1) return;
      [editing.startDate, editing.endDate] = [dateAnchor, button.dataset.date].sort();
      ensureEndAfterStart();
      renderDateSelection();
    });
  });
}

function renderDateSelection() {
  document.querySelectorAll('.mini-day').forEach(button => button.classList.toggle('selected', button.dataset.date >= editing.startDate && button.dataset.date <= editing.endDate));
  $('#startDateInput').value = editing.startDate;
  $('#endDateInput').value = editing.endDate;
  updateEditorFields();
}

function markdownToHtml(markdown) {
  let html = escapeHtml(markdown);
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>').replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>').replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  return html.split(/\n{2,}/).map(block => /^<(h\d|ul)/.test(block) ? block : `<p>${block.replace(/\n/g, '<br>')}</p>`).join('');
}

function renderNoteAssist() {
  $('#noteAssist').innerHTML = `<div class="note-tabs"><span>Markdown</span><span>预览</span></div><textarea id="noteEditor" class="note-editor" placeholder="# 标题\n- 列表\n**重点**"></textarea><div id="notePreview" class="markdown-preview"></div>`;
  const editor = $('#noteEditor');
  editor.value = editing.notes || '';
  const refresh = () => {
    editing.notes = editor.value;
    $('#notePreview').innerHTML = editing.notes.trim() ? markdownToHtml(editing.notes) : '<p class="preview-empty">预览会显示在这里</p>';
    updateEditorFields();
  };
  editor.addEventListener('input', refresh);
  refresh();
  setTimeout(() => editor.focus(), 40);
}

function showView(name) {
  closeJumpCalendar();
  const standby = name === 'standby';
  const standbyView = $('#standbyView');
  const weekView = $('#weekView');
  const wasStandby = standbyView.classList.contains('active');
  if (standby === wasStandby) return;
  closeDateContextMenu();
  const animate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const previousScroll = window.scrollY;
  standbyView.classList.remove('leaving', 'entering');
  weekView.classList.remove('fading-out');
  standbyView.classList.toggle('active', standby);
  weekView.classList.toggle('active', !standby);
  if (animate) {
    standbyView.classList.add(standby ? 'entering' : 'leaving');
    if (standby) {
      weekView.style.setProperty('--week-fade-top', `${-previousScroll}px`);
      weekView.classList.add('fading-out');
    }
  }
  window.scrollTo(0, 0);
  if (!standby) {
    renderWeek();
    requestAnimationFrame(scrollToToday);
  }
}

$('#standbyView').addEventListener('animationend', event => {
  if (event.target === $('#standbyView')) $('#standbyView').classList.remove('entering', 'leaving');
});
$('#weekView').addEventListener('animationend', event => {
  if (event.target === $('#weekView')) {
    $('#weekView').classList.remove('fading-out');
    $('#weekView').style.removeProperty('--week-fade-top');
  }
});

function scrollToToday() {
  centerDate = parseKey(toKey(new Date()));
  horizontalOffset = 0;
  renderWeek();
}

let jumpDate = toKey(today);
let jumpMonth = new Date(today.getFullYear(), today.getMonth(), 1);

function renderJumpCalendar() {
  const first = startOfWeek(new Date(jumpMonth.getFullYear(), jumpMonth.getMonth(), 1));
  const days = Array.from({ length: 42 }, (_, index) => addDays(first, index));
  $('#jumpCalendarGrid').innerHTML = `
    <div class="jump-month-nav"><button type="button" data-jump-step="-1" aria-label="上个月">←</button><strong>${jumpMonth.getFullYear()}年 ${jumpMonth.getMonth() + 1}月</strong><button type="button" data-jump-step="1" aria-label="下个月">→</button></div>
    <div class="mini-weekdays">${WEEKDAYS.map(day => `<span>${day.slice(1)}</span>`).join('')}</div>
    <div class="mini-calendar">${days.map(date => {
      const key = toKey(date);
      return `<button type="button" class="jump-day ${date.getMonth() !== jumpMonth.getMonth() ? 'outside' : ''} ${key === jumpDate ? 'selected' : ''} ${key === toKey(new Date()) ? 'today' : ''}" data-jump-date="${key}" aria-label="${key}" aria-pressed="${key === jumpDate}">${date.getDate()}</button>`;
    }).join('')}</div>`;
  $('#jumpCalendarGrid').querySelectorAll('[data-jump-step]').forEach(button => button.addEventListener('click', () => {
    jumpMonth = new Date(jumpMonth.getFullYear(), jumpMonth.getMonth() + Number(button.dataset.jumpStep), 1);
    renderJumpCalendar();
  }));
  $('#jumpCalendarGrid').querySelectorAll('[data-jump-date]').forEach(button => button.addEventListener('click', () => {
    jumpDate = button.dataset.jumpDate;
    jumpMonth = new Date(parseKey(jumpDate).getFullYear(), parseKey(jumpDate).getMonth(), 1);
    renderJumpCalendar();
  }));
}

function openJumpCalendar() {
  if (editing) return;
  jumpDate = toKey(centerDate);
  jumpMonth = new Date(centerDate.getFullYear(), centerDate.getMonth(), 1);
  $('#jumpTime').value = `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
  renderJumpCalendar();
  $('#jumpCalendar').hidden = false;
  $('#weekJumpButton').setAttribute('aria-expanded', 'true');
}

function closeJumpCalendar() {
  $('#jumpCalendar').hidden = true;
  $('#weekJumpButton').setAttribute('aria-expanded', 'false');
}

function jumpToSelectedTime() {
  if (!jumpDate) return;
  const [hour, minute] = ($('#jumpTime').value || '00:00').split(':').map(Number);
  centerDate = parseKey(jumpDate);
  horizontalOffset = 0;
  renderWeek();
  closeJumpCalendar();
  requestAnimationFrame(() => {
    const timelineTop = $('#timeline').getBoundingClientRect().top + window.scrollY;
    const target = timelineTop + (hour * 60 + minute) / 60 * HOUR_HEIGHT - 185;
    window.scrollTo({ top: Math.max(0, target), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
}

$('#weekJumpButton').addEventListener('click', () => $('#jumpCalendar').hidden ? openJumpCalendar() : closeJumpCalendar());
$('#closeJumpCalendar').addEventListener('click', closeJumpCalendar);
$('#confirmJump').addEventListener('click', jumpToSelectedTime);
$('#jumpTime').addEventListener('keydown', event => { if (event.key === 'Enter') jumpToSelectedTime(); });
document.addEventListener('pointerdown', event => {
  if (!$('#jumpCalendar').hidden && !event.target.closest('#jumpCalendar, #weekJumpButton, .week-corner')) closeJumpCalendar();
}, true);

function bindMonthSwipe() {
  const header = $('#weekHeader');
  const frame = document.querySelector('.calendar-frame');
  let swipe = null;
  header.addEventListener('pointerdown', event => {
    if (editing || event.button !== 0) return;
    if (event.target.closest('.week-corner')) return;
    if (event.pointerType === 'touch') return;
    swipe = { x: event.clientX };
    header.classList.add('dragging');
    header.setPointerCapture(event.pointerId);
  });
  header.addEventListener('pointermove', event => {
    if (!swipe) return;
    panDays(swipe.x - event.clientX);
    swipe.x = event.clientX;
  });
  const stop = () => { swipe = null; header.classList.remove('dragging'); };
  header.addEventListener('pointerup', stop);
  header.addEventListener('pointercancel', stop);
  header.addEventListener('wheel', event => {
    event.preventDefault();
    const amount = event.deltaY ? (reverseWheel ? event.deltaY : -event.deltaY) : event.deltaX;
    panDays(event.deltaMode === 1 ? amount * 20 : amount);
  }, { passive: false });
  header.addEventListener('contextmenu', event => {
    const day = event.target.closest('.day-head');
    if (!day) return;
    event.preventDefault();
    openDateContextMenu(day.dataset.date, event.clientX, event.clientY);
  });
  header.addEventListener('click', event => {
    if (event.target.closest('.week-corner')) openJumpCalendar();
  });
  frame.addEventListener('wheel', event => {
    if (header.contains(event.target)) return;
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey) {
      event.preventDefault();
      panDays(event.deltaX || event.deltaY);
    }
  }, { passive: false });
  let readPan = null;
  $('#timeline').addEventListener('pointerdown', event => {
    if (event.target.closest('.event-resize-handle')) return;
    if (currentMode !== 'edit' || event.button !== 1) return;
    readPan = { x: event.clientX, y: event.clientY, id: event.pointerId };
    $('#timeline').setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  $('#timeline').addEventListener('pointermove', event => {
    if (!readPan) return;
    panDays(readPan.x - event.clientX);
    window.scrollBy(0, readPan.y - event.clientY);
    readPan.x = event.clientX;
    readPan.y = event.clientY;
  });
  const stopReadPan = () => { readPan = null; };
  $('#timeline').addEventListener('pointerup', stopReadPan);
  $('#timeline').addEventListener('pointercancel', stopReadPan);
  $('#timeline').addEventListener('auxclick', event => {
    if (event.button === 1) event.preventDefault();
  });
  let resize = null;
  $('#timeline').addEventListener('pointerdown', event => {
    if (currentMode !== 'edit' || !editing || event.button !== 0 || !event.target.closest('.event-resize-handle')) return;
    resize = { x: event.clientX, y: event.clientY, endDate: editing.endDate, end: editing.end, pointerId: event.pointerId };
    $('#timeline').setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  });
  $('#timeline').addEventListener('pointermove', event => {
    if (!resize || !editing) return;
    const dayDelta = Math.round((event.clientX - resize.x) / DAY_WIDTH);
    const endDate = toKey(addDays(parseKey(resize.endDate), dayDelta));
    editing.endDate = endDate < editing.startDate ? editing.startDate : endDate;
    editing.end = snapMinutes(resize.end + (event.clientY - resize.y) * 60 / HOUR_HEIGHT);
    if (editing.endDate === editing.startDate) editing.end = Math.max(editing.start + 15, editing.end);
    editing.dates = [editing.startDate, editing.endDate];
    updateEditorFields();
    if (assistMode === 'time') renderTimeAssist();
    if (assistMode === 'date') renderDateAssist();
  });
  const stopResize = () => { resize = null; };
  $('#timeline').addEventListener('pointerup', stopResize);
  $('#timeline').addEventListener('pointercancel', stopResize);
  let touch = null;
  frame.addEventListener('touchstart', event => { touch = { x: event.touches[0].clientX, y: event.touches[0].clientY }; }, { passive: true });
  frame.addEventListener('touchmove', event => {
    if (!touch) return;
    const point = event.touches[0];
    const dx = touch.x - point.clientX;
    if (Math.abs(dx) > Math.abs(touch.y - point.clientY)) { event.preventDefault(); panDays(dx); }
    touch = { x: point.clientX, y: point.clientY };
  }, { passive: false });
  window.addEventListener('resize', positionDays);
}

let menuDate = null;

function positionContextMenu(menu, x, y) {
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const left = x + width > window.innerWidth && x >= width ? x - width : x;
  menu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
}

function closeDateContextMenu() {
  $('#dateContextMenu').hidden = true;
  menuDate = null;
}

function openDateContextMenu(key, x, y) {
  menuDate = key;
  const count = events.filter(event => segmentForDate(event, key)).length;
  $('#dateMenuLabel').textContent = `${dateText(key, true)} · ${count} 项日程`;
  $('#deleteDayEvents').disabled = count === 0;
  $('#clearDayMark').hidden = !dayMarks[key];
  $('#dayMarkColors').innerHTML = COLORS.map(color => `<button type="button" data-day-color="${color}" style="--swatch:${color}" aria-label="标记为${color}" title="标记日期颜色"></button>`).join('');
  const menu = $('#dateContextMenu');
  menu.hidden = false;
  positionContextMenu(menu, x, y);
}

$('#dayMarkColors').addEventListener('click', event => {
  const button = event.target.closest('[data-day-color]');
  if (!button || !menuDate) return;
  dayMarks[menuDate] = button.dataset.dayColor;
  localStorage.setItem(DAY_MARK_KEY, JSON.stringify(dayMarks));
  closeDateContextMenu();
  renderWeek();
});
$('#clearDayMark').addEventListener('click', () => {
  if (!menuDate) return;
  delete dayMarks[menuDate];
  localStorage.setItem(DAY_MARK_KEY, JSON.stringify(dayMarks));
  closeDateContextMenu();
  renderWeek();
});

function setMode(mode) {
  if (!['mark', 'edit'].includes(mode)) return;
  currentMode = mode;
  dragging = null;
  clearInterval(edgeScrollTimer);
  if (editing) closeEditor();
  closeDateContextMenu();
  hideEventHoverNote();
  document.body.dataset.mode = mode;
  document.querySelectorAll('[data-mode]').forEach(button => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('.gesture-tip').textContent = mode === 'mark' ? '点击日程加粗标注 · 右键日期可标记颜色' : '右键空白添加 · 拖动选择时段 · 右键日期管理';
  renderWeek();
}
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));

document.addEventListener('mousedown', event => {
  if (!event.target.closest('#dateContextMenu')) closeDateContextMenu();
}, true);

$('#deleteDayEvents').addEventListener('click', () => {
  if (!menuDate) return;
  const key = menuDate;
  const count = events.filter(event => segmentForDate(event, key)).length;
  events = events.flatMap(event => removeDayFromEvent(event, key));
  persistEvents();
  closeDateContextMenu();
  renderWeek();
  renderStandby();
  showToast(`已删除 ${dateText(key)} 的 ${count} 项日程`);
});

function toggleView() {
  if (editing) return;
  showView($('#standbyView').classList.contains('active') ? 'week' : 'standby');
}

function showToast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 1800);
}

$('#eventForm').addEventListener('submit', event => {
  event.preventDefault();
  const title = $('#eventTitle').value.trim();
  if (!title) { $('#eventTitle').focus(); showToast('请填写日程内容'); return; }
  const saved = { ...editing, id: editingId || makeId(), title, dates: [editing.startDate, editing.endDate] };
  const isUpdate = Boolean(editingId);
  if (editingId) events = events.map(item => item.id === editingId ? saved : item);
  else events.push(saved);
  persistEvents();
  if (typeof pushBrowserReminder === 'function') pushBrowserReminder(saved);
  closeEditor();
  renderWeek();
  renderStandby();
  showToast(isUpdate ? '日程已更新' : '日程已创建');
});

$('#deleteButton').addEventListener('click', () => {
  if (!editingId) return;
  events = events.filter(item => item.id !== editingId);
  persistEvents();
  closeEditor();
  renderWeek();
  renderStandby();
  showToast('日程已删除');
});

$('#dateField').addEventListener('click', () => switchAssist('date'));
$('#timeField').addEventListener('click', () => switchAssist('time'));
$('#noteProxy').addEventListener('click', () => switchAssist('note'));
$('#reminderEnabled').addEventListener('change', event => {
  if (!editing) return;
  editing.reminder.enabled = event.target.checked;
  updateEditorFields();
});
function updateReminderLead() {
  if (!editing) return;
  const value = Math.max(0, Number($('#reminderLeadValue').value) || 0);
  editing.reminder.minutesBefore = value * ($('#reminderLeadUnit').value === 'hour' ? 60 : 1);
}
$('#reminderLeadValue').addEventListener('input', updateReminderLead);
$('#reminderLeadUnit').addEventListener('change', updateReminderLead);
$('#reminderDays').addEventListener('input', event => {
  if (editing) editing.reminder.daysBefore = Math.max(0, Number(event.target.value) || 0);
});
function updateRecurrenceFromForm() {
  if (!editing?.recurrence) return;
  editing.recurrence.frequency = $('#recurrenceFrequency').value;
  editing.recurrence.interval = Math.max(1, Number($('#recurrenceInterval').value) || 1);
  editing.recurrence.until = $('#recurrenceUntil').value || null;
  editing.recurrence.weekdays = [...document.querySelectorAll('#recurrenceWeekdays input:checked')].map(input => Number(input.value));
  updateEditorFields();
}
$('#recurrenceEnabled').addEventListener('change', event => {
  if (!editing) return;
  editing.recurrence = event.target.checked ? { frequency: 'weekly', interval: 1, until: null, count: null, weekdays: [parseKey(editing.startDate).getDay() || 7], exclusions: [] } : null;
  updateEditorFields();
});
$('#recurrenceFrequency').addEventListener('change', updateRecurrenceFromForm);
$('#recurrenceInterval').addEventListener('input', updateRecurrenceFromForm);
$('#recurrenceUntil').addEventListener('change', updateRecurrenceFromForm);
$('#recurrenceWeekdays').addEventListener('change', updateRecurrenceFromForm);
document.querySelectorAll('[data-close-editor]').forEach(button => button.addEventListener('click', closeEditor));
$('#openWeekButton').addEventListener('click', () => showView('week'));
$('#closeWeekButton').addEventListener('click', () => showView('standby'));
$('#todayButton').addEventListener('click', scrollToToday);
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
    event.preventDefault();
    event.stopPropagation();
    if (editing && !event.repeat) $('#eventForm').requestSubmit();
    return;
  }
  if (event.key === 'Escape' && !$('#dateContextMenu').hidden) { closeDateContextMenu(); return; }
  if (event.key === 'Escape' && !$('#jumpCalendar').hidden) { closeJumpCalendar(); return; }
  if (event.key === 'Escape' && editing) { closeEditor(); return; }
  if (event.key === 'Tab' && !editing && $('#jumpCalendar').hidden && !event.target.closest('#stickyWall textarea')) { event.preventDefault(); toggleView(); }
});

function updateNowLine() {
  document.querySelectorAll('.now-line-local').forEach(line => line.remove());
  const now = new Date();
  const minute = now.getHours() * 60 + now.getMinutes();
  const column = document.querySelector(`.day-column[data-date="${toKey(now)}"]`);
  if (!column || minute < HOUR_START * 60 || minute > HOUR_END * 60) return;
  const line = document.createElement('div');
  line.className = 'now-line-local';
  line.style.top = `${((minute - HOUR_START * 60) / 60) * HOUR_HEIGHT}px`;
  column.appendChild(line);
}

function registerScheduleTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const parseClock = value => {
    if (!/^([01]\d|2[0-4]):[0-5]\d$/.test(value)) throw new Error('时间必须使用 HH:MM 格式');
    const [hour, minute] = value.split(':').map(Number);
    const total = hour * 60 + minute;
    if (total < HOUR_START * 60 || total > HOUR_END * 60) throw new Error('时间必须在 00:00—24:00 之间');
    return total;
  };
  void Promise.resolve(context.registerTool({
    name: 'list_schedule_events',
    title: '读取日程',
    description: '读取本地保存的所有日程，包括连续跨天日程。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute() {
      return { month: `${monthAnchor.getFullYear()}-${pad(monthAnchor.getMonth() + 1)}`, events: events.map(item => ({ ...item })) };
    },
  })).catch(() => {});
  void Promise.resolve(context.registerTool({
    name: 'create_schedule_event',
    title: '创建日程',
    description: '创建一项连续日程，日期数组的首尾为起止日期，并立即更新视图。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1 },
        dates: { type: 'array', minItems: 1, items: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
        start: { type: 'string', pattern: '^([01]\\d|2[0-4]):[0-5]\\d$' },
        end: { type: 'string', pattern: '^([01]\\d|2[0-4]):[0-5]\\d$' },
        notes: { type: 'string' },
        color: { type: 'string', enum: COLORS },
      },
      required: ['title', 'dates', 'start', 'end'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      if (!input || typeof input.title !== 'string' || !input.title.trim() || !Array.isArray(input.dates) || !input.dates.length) throw new Error('缺少有效的标题或日期');
      if (input.dates.some(key => !/^\d{4}-\d{2}-\d{2}$/.test(key) || toKey(parseKey(key)) !== key)) throw new Error('日期无效');
      const start = parseClock(input.start);
      const end = parseClock(input.end);
      const dates = [...new Set(input.dates)].sort();
      if (dates[0] === dates.at(-1) && end <= start) throw new Error('结束时间必须晚于开始时间');
      const item = { id: makeId(), span: true, startDate: dates[0], endDate: dates.at(-1), title: input.title.trim(), dates, start, end, notes: input.notes || '', color: COLORS.includes(input.color) ? input.color : COLORS[0] };
      events.push(item);
      persistEvents();
      renderStandby();
      renderWeek();
      return { id: item.id, status: 'created' };
    },
  })).catch(() => {});
}

renderStandby();
renderWeek();
setMode('edit');
bindMonthSwipe();
registerScheduleTools();
void synchronizeSchedulesWithService();
setInterval(refreshSchedulesFromService, 10000);
tickClock();
