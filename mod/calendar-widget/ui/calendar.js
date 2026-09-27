const STORAGE_KEY = 'schedule-studio-calendar-widgets-v1';
const MIN_WIDTH = 180;
const MIN_HEIGHT = 200;
const DEFAULT_WIDTH = 326;
const DEFAULT_HEIGHT = 350;
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `calendar-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function localDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function parseMonth(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
  if (!match) return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  return new Date(Number(match[1]), Number(match[2]) - 1, 1);
}

function shiftMonth(value, amount) {
  const date = parseMonth(value);
  date.setMonth(date.getMonth() + amount);
  return monthKey(date);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function calendarScale(width, height) {
  // 常规尺寸保持原字号；空间不足时同步缩小字体和布局间距。
  return clamp(Math.min(width / 270, height / 286), 0.65, 1);
}

function loadWidgets() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!Array.isArray(value)) return [];
    return value.filter(item => item && item.id).map(item => ({
      id: String(item.id),
      x: Number.isFinite(Number(item.x)) ? Number(item.x) : 30,
      y: Number.isFinite(Number(item.y)) ? Number(item.y) : 20,
      width: clamp(Number(item.width) || DEFAULT_WIDTH, MIN_WIDTH, 1200),
      height: clamp(Number(item.height) || DEFAULT_HEIGHT, MIN_HEIGHT, 900),
      month: /^\d{4}-\d{2}$/.test(item.month) ? item.month : monthKey(new Date()),
    }));
  } catch (_) {
    return [];
  }
}

function formatMinutes(value) {
  const minutes = clamp(Number(value) || 0, 0, 1440);
  if (minutes === 1440) return '24:00';
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function eventTimeForDate(event, dateKey) {
  if (event.startDate === event.endDate) return `${formatMinutes(event.start)}–${formatMinutes(event.end)}`;
  if (dateKey === event.startDate) return `${formatMinutes(event.start)} 起`;
  if (dateKey === event.endDate) return `至 ${formatMinutes(event.end)}`;
  return '全天';
}

export function mount({ root, api }) {
  const layer = root.querySelector('.calendar-widget-layer');
  const standby = root.closest('#standbyView') || document.querySelector('#standbyView');
  const menu = document.querySelector('#stickyContextMenu');
  const stickyGroup = menu?.querySelector('.sticky-create-group');
  const stickyButton = menu?.querySelector('#createStickyNote');
  const originalStickyMarkup = stickyButton?.innerHTML || '';
  const originalStickyParent = stickyGroup?.parentNode || null;
  const originalStickyNext = stickyGroup?.nextSibling || null;
  const tooltip = document.createElement('div');
  tooltip.className = 'standby-calendar-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.append(tooltip);

  let widgets = loadWidgets();
  let createPoint = { x: 32, y: 22 };
  let gesture = null;
  let requestToken = 0;
  let refreshTimer = null;
  const eventCache = new Map();
  const disposers = [];

  function saveWidgets() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets));
  }

  function widgetById(id) {
    return widgets.find(item => item.id === id);
  }

  function datesForMonth(value) {
    const first = parseMonth(value);
    const start = new Date(first);
    start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }

  function buildEventIndex(schedules) {
    const index = new Map();
    for (const event of schedules) {
      const start = new Date(`${event.startDate}T00:00:00`);
      const end = new Date(`${event.endDate}T00:00:00`);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
      for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
        const key = localDateKey(cursor);
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(event);
      }
    }
    for (const events of index.values()) events.sort((left, right) => Number(left.start) - Number(right.start));
    return index;
  }

  async function fetchMonth(value, force = false) {
    if (!force && eventCache.has(value)) return eventCache.get(value);
    const first = parseMonth(value);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const result = await api.schedules.list({ startDate: localDateKey(first), endDate: localDateKey(last), expand: 'true' });
    const index = buildEventIndex(result.schedules || []);
    eventCache.set(value, index);
    return index;
  }

  function positionTooltip(target, html) {
    tooltip.innerHTML = html;
    tooltip.hidden = false;
    const rect = target.getBoundingClientRect();
    const tip = tooltip.getBoundingClientRect();
    let left = rect.right + 9;
    if (left + tip.width > window.innerWidth - 8) left = rect.left - tip.width - 9;
    let top = rect.top;
    if (top + tip.height > window.innerHeight - 8) top = window.innerHeight - tip.height - 8;
    tooltip.style.left = `${Math.max(8, left)}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
  }

  function escapeHtml(value) {
    const span = document.createElement('span');
    span.textContent = String(value ?? '');
    return span.innerHTML;
  }

  function showEvents(target, dateKey, events) {
    const date = new Date(`${dateKey}T00:00:00`);
    const title = date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
    const items = events.map(event => `<li style="--event-color:${escapeHtml(event.color || '#2aa198')}"><span>${escapeHtml(event.title || '未命名日程')}</span><time>${escapeHtml(eventTimeForDate(event, dateKey))}</time></li>`).join('');
    positionTooltip(target, `<strong>${escapeHtml(title)} · ${events.length} 项</strong><ul>${items}</ul>`);
  }

  function hideTooltip() {
    tooltip.hidden = true;
  }

  function renderCalendar(widget, card, index) {
    const days = datesForMonth(widget.month);
    const currentMonth = parseMonth(widget.month).getMonth();
    const today = localDateKey(new Date());
    card.querySelector('.standby-calendar-month').value = widget.month;
    card.querySelector('.standby-calendar-status').textContent = '读取日程…';
    card.querySelector('.standby-calendar-grid').innerHTML = days.map(date => {
      const key = localDateKey(date);
      const classes = ['standby-calendar-day'];
      if (date.getMonth() !== currentMonth) classes.push('is-outside');
      if (key === today) classes.push('is-today');
      return `<button class="${classes.join(' ')}" type="button" data-date="${key}" tabindex="-1" aria-label="${date.getDate()}日">${date.getDate()}</button>`;
    }).join('');
    const token = ++requestToken;
    fetchMonth(widget.month).then(eventIndex => {
      if (!card.isConnected || widget.month !== card.querySelector('.standby-calendar-month').value) return;
      let count = 0;
      for (const day of card.querySelectorAll('.standby-calendar-day')) {
        const events = eventIndex.get(day.dataset.date) || [];
        day.classList.toggle('has-events', events.length > 0);
        day.tabIndex = events.length ? 0 : -1;
        day.dataset.eventCount = String(events.length);
        if (events.length) {
          count += events.length;
          day.setAttribute('aria-label', `${day.getAttribute('aria-label')}，${events.length}项日程`);
        }
      }
      if (token <= requestToken) card.querySelector('.standby-calendar-status').textContent = count ? `${count} 项日程` : '本月无日程';
    }).catch(error => {
      if (card.isConnected) card.querySelector('.standby-calendar-status').textContent = `读取失败：${error.message}`;
    });
    card.setAttribute('aria-label', `日历 ${index + 1}，${widget.month}`);
  }

  function render() {
    layer.innerHTML = widgets.map((widget, index) => `<section class="standby-calendar" data-calendar-id="${escapeHtml(widget.id)}" style="left:${widget.x}%;top:${widget.y}%;width:${widget.width}px;height:${widget.height}px;--calendar-scale:${calendarScale(widget.width, widget.height)}" aria-label="日历 ${index + 1}">
      <header class="standby-calendar-head">
        <button type="button" data-calendar-action="previous" aria-label="上个月" title="上个月">‹</button>
        <input class="standby-calendar-month" type="month" min="1900-01" max="2199-12" aria-label="选择月份" />
        <button type="button" data-calendar-action="next" aria-label="下个月" title="下个月">›</button>
        <button type="button" data-calendar-action="remove" aria-label="删除日历" title="删除日历">×</button>
      </header>
      <div class="standby-calendar-body">
        <div class="standby-calendar-weekdays" aria-hidden="true">${WEEKDAYS.map(day => `<span>${day}</span>`).join('')}</div>
        <div class="standby-calendar-grid"></div>
      </div>
      <span class="standby-calendar-status" aria-live="polite"></span>
      <div class="standby-calendar-resize" role="button" aria-label="拖动调整日历大小"></div>
    </section>`).join('');
    widgets.forEach((widget, index) => {
      const card = layer.querySelector(`[data-calendar-id="${CSS.escape(widget.id)}"]`);
      if (card) renderCalendar(widget, card, index);
    });
  }

  function createCalendar() {
    const bounds = layer.getBoundingClientRect();
    const maxX = Math.max(0, 100 - DEFAULT_WIDTH / Math.max(bounds.width, 1) * 100);
    const maxY = Math.max(0, 100 - DEFAULT_HEIGHT / Math.max(bounds.height, 1) * 100);
    widgets.push({
      id: makeId(),
      x: clamp(createPoint.x, 0, maxX),
      y: clamp(createPoint.y, 0, maxY),
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      month: monthKey(new Date()),
    });
    saveWidgets();
    if (menu) menu.hidden = true;
    render();
  }

  function onContextMenu(event) {
    if (event.target.closest('.standby-calendar')) return;
    const bounds = layer.getBoundingClientRect();
    createPoint = {
      x: (event.clientX - bounds.left) / Math.max(bounds.width, 1) * 100,
      y: (event.clientY - bounds.top) / Math.max(bounds.height, 1) * 100,
    };
    orientCreateMenu();
  }

  function orientCreateMenu() {
    const group = menu?.querySelector('.calendar-component-create-group, .sticker-component-create-group');
    const options = group?.querySelector('.calendar-component-create-options, .sticker-component-create-options');
    const colors = options?.querySelector('.sticky-color-options');
    if (!group || !options || !colors || menu.hidden) return;
    group.classList.remove('opens-left', 'opens-below', 'opens-above');
    const rect = menu.getBoundingClientRect();
    const width = parseFloat(getComputedStyle(options).width);
    const nestedWidths = [colors, ...options.querySelectorAll('[data-component-submenu]')]
      .map(element => parseFloat(getComputedStyle(element).width));
    const right = window.innerWidth - rect.right - 8;
    const left = rect.left - 8;
    const cascade = width + Math.max(...nestedWidths);
    if (right >= cascade || (right >= width && left < width)) return;
    if (left >= width) group.classList.add('opens-left');
    else {
      group.classList.add('opens-below');
      if (window.innerHeight - rect.bottom < 100 && rect.top >= 100) group.classList.add('opens-above');
    }
  }

  function orientColorMenu() {
    const group = menu?.querySelector('.calendar-component-create-group, .sticker-component-create-group');
    const colors = stickyGroup?.querySelector('.sticky-color-options');
    if (!group || !colors) return;
    stickyGroup.classList.remove('opens-left', 'opens-below', 'opens-above');
    const rect = stickyGroup.getBoundingClientRect();
    const width = parseFloat(getComputedStyle(colors).width);
    const right = window.innerWidth - rect.right - 8;
    const left = rect.left - 8;
    if (group.classList.contains('opens-below')) stickyGroup.classList.add('opens-below');
    else if (group.classList.contains('opens-left') && left >= width) stickyGroup.classList.add('opens-left');
    else if (right < width && left >= width) stickyGroup.classList.add('opens-left');
    else if (right < width) stickyGroup.classList.add('opens-below');
    if (stickyGroup.classList.contains('opens-below') && window.innerHeight - rect.bottom < 110 && rect.top >= 110) stickyGroup.classList.add('opens-above');
  }

  function onLayerClick(event) {
    const card = event.target.closest('.standby-calendar');
    if (!card) return;
    const widget = widgetById(card.dataset.calendarId);
    if (!widget) return;
    const action = event.target.closest('[data-calendar-action]')?.dataset.calendarAction;
    if (action === 'remove') {
      widgets = widgets.filter(item => item.id !== widget.id);
      saveWidgets();
      hideTooltip();
      render();
      return;
    }
    if (action === 'previous' || action === 'next') {
      widget.month = shiftMonth(widget.month, action === 'previous' ? -1 : 1);
      saveWidgets();
      hideTooltip();
      renderCalendar(widget, card, widgets.indexOf(widget));
    }
  }

  function onMonthChange(event) {
    if (!event.target.matches('.standby-calendar-month') || !/^\d{4}-\d{2}$/.test(event.target.value)) return;
    const card = event.target.closest('.standby-calendar');
    const widget = widgetById(card?.dataset.calendarId);
    if (!widget) return;
    widget.month = event.target.value;
    saveWidgets();
    hideTooltip();
    renderCalendar(widget, card, widgets.indexOf(widget));
  }

  function onPointerOver(event) {
    const day = event.target.closest('.standby-calendar-day.has-events');
    if (!day) return;
    const card = day.closest('.standby-calendar');
    const widget = widgetById(card?.dataset.calendarId);
    const events = eventCache.get(widget?.month)?.get(day.dataset.date) || [];
    if (events.length) showEvents(day, day.dataset.date, events);
  }

  function onPointerOut(event) {
    if (event.target.closest('.standby-calendar-day.has-events')) hideTooltip();
  }

  function onFocusIn(event) {
    if (event.target.matches('.standby-calendar-day.has-events')) onPointerOver(event);
  }

  function onFocusOut(event) {
    if (event.target.matches('.standby-calendar-day.has-events')) hideTooltip();
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    const card = event.target.closest('.standby-calendar');
    if (!card) return;
    const resizing = Boolean(event.target.closest('.standby-calendar-resize'));
    const dragging = Boolean(event.target.closest('.standby-calendar-head')) && !event.target.closest('button, input');
    if (!resizing && !dragging) return;
    const widget = widgetById(card.dataset.calendarId);
    if (!widget) return;
    gesture = {
      id: widget.id,
      pointerId: event.pointerId,
      resizing,
      startX: event.clientX,
      startY: event.clientY,
      originX: widget.x,
      originY: widget.y,
      width: widget.width,
      height: widget.height,
    };
    card.classList.add(resizing ? 'is-resizing' : 'is-dragging');
    card.setPointerCapture(event.pointerId);
    hideTooltip();
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (!gesture) return;
    const widget = widgetById(gesture.id);
    const card = layer.querySelector(`[data-calendar-id="${CSS.escape(gesture.id)}"]`);
    if (!widget || !card) return;
    const bounds = layer.getBoundingClientRect();
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (gesture.resizing) {
      widget.width = clamp(gesture.width + dx, MIN_WIDTH, Math.max(MIN_WIDTH, bounds.width - widget.x / 100 * bounds.width));
      widget.height = clamp(gesture.height + dy, MIN_HEIGHT, Math.max(MIN_HEIGHT, bounds.height - widget.y / 100 * bounds.height));
      card.style.width = `${widget.width}px`;
      card.style.height = `${widget.height}px`;
      card.style.setProperty('--calendar-scale', calendarScale(widget.width, widget.height));
    } else {
      const maxX = Math.max(0, 100 - widget.width / Math.max(bounds.width, 1) * 100);
      const maxY = Math.max(0, 100 - widget.height / Math.max(bounds.height, 1) * 100);
      widget.x = clamp(gesture.originX + dx / Math.max(bounds.width, 1) * 100, 0, maxX);
      widget.y = clamp(gesture.originY + dy / Math.max(bounds.height, 1) * 100, 0, maxY);
      card.style.left = `${widget.x}%`;
      card.style.top = `${widget.y}%`;
    }
  }

  function finishGesture() {
    if (!gesture) return;
    layer.querySelector(`[data-calendar-id="${CSS.escape(gesture.id)}"]`)?.classList.remove('is-dragging', 'is-resizing');
    gesture = null;
    saveWidgets();
  }

  function refreshVisibleMonths() {
    eventCache.clear();
    for (const card of layer.querySelectorAll('.standby-calendar')) {
      const widget = widgetById(card.dataset.calendarId);
      if (widget) renderCalendar(widget, card, widgets.indexOf(widget));
    }
  }

  function installCreateMenu() {
    if (!menu || !stickyGroup || !stickyButton) return;
    let group = menu.querySelector('.sticker-component-create-group');
    const ownsGroup = !group;
    if (ownsGroup) {
      menu.setAttribute('aria-label', '组件操作');
      stickyButton.innerHTML = '便签 <span>›</span>';
      group = document.createElement('div');
      group.className = 'calendar-component-create-group';
      group.innerHTML = '<button class="calendar-component-create-trigger" type="button" aria-haspopup="menu">＋ 创建组件 <span>›</span></button><div class="calendar-component-create-options" role="menu"></div>';
      menu.prepend(group);
    }
    const options = group.querySelector('.calendar-component-create-options, .sticker-component-create-options');
    const calendarButton = document.createElement('button');
    calendarButton.type = 'button';
    calendarButton.className = 'calendar-component-create-calendar';
    calendarButton.setAttribute('role', 'menuitem');
    calendarButton.textContent = '日历';
    if (ownsGroup) options.append(stickyGroup);
    options.insertBefore(calendarButton, options.querySelector('.sticker-create-group'));
    group.addEventListener('pointerenter', orientCreateMenu);
    group.addEventListener('focusin', orientCreateMenu);
    stickyGroup.addEventListener('pointerenter', orientColorMenu);
    stickyGroup.addEventListener('focusin', orientColorMenu);
    calendarButton.addEventListener('click', createCalendar);
    disposers.push(() => calendarButton.removeEventListener('click', createCalendar));
    disposers.push(() => {
      group.removeEventListener('pointerenter', orientCreateMenu);
      group.removeEventListener('focusin', orientCreateMenu);
      stickyGroup.removeEventListener('pointerenter', orientColorMenu);
      stickyGroup.removeEventListener('focusin', orientColorMenu);
      stickyGroup.classList.remove('opens-left', 'opens-below', 'opens-above');
      calendarButton.remove();
      if (ownsGroup) {
        stickyButton.innerHTML = originalStickyMarkup;
        if (originalStickyParent) originalStickyParent.insertBefore(stickyGroup, originalStickyNext);
        group.remove();
        menu.setAttribute('aria-label', '便签操作');
      }
    });
  }

  installCreateMenu();
  standby?.addEventListener('contextmenu', onContextMenu);
  layer.addEventListener('contextmenu', event => {
    if (event.target.closest('.standby-calendar')) event.stopPropagation();
  });
  layer.addEventListener('click', onLayerClick);
  layer.addEventListener('change', onMonthChange);
  layer.addEventListener('pointerover', onPointerOver);
  layer.addEventListener('pointerout', onPointerOut);
  layer.addEventListener('focusin', onFocusIn);
  layer.addEventListener('focusout', onFocusOut);
  layer.addEventListener('pointerdown', onPointerDown);
  layer.addEventListener('pointermove', onPointerMove);
  layer.addEventListener('pointerup', finishGesture);
  layer.addEventListener('pointercancel', finishGesture);
  window.addEventListener('focus', refreshVisibleMonths);
  refreshTimer = window.setInterval(refreshVisibleMonths, 15000);
  render();

  return () => {
    window.clearInterval(refreshTimer);
    standby?.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('focus', refreshVisibleMonths);
    hideTooltip();
    tooltip.remove();
    for (const dispose of disposers.reverse()) dispose();
  };
}
