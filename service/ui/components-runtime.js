const apiBase = 'http://127.0.0.1:3456';
const surface = document.documentElement.dataset.componentSurface;
const disposers = [];

async function request(method, route, body) {
  const response = await fetch(`${apiBase}${route}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok || result.ok === false) throw new Error(result.error || `请求失败：${response.status}`);
  return result.data;
}

// UI 插件通过统一 SDK 操作数据；不需要依赖现有页面的全局变量。
const api = Object.freeze({
  schedules: Object.freeze({
    list(query = {}) { return request('GET', `/api/v1/schedules?${new URLSearchParams(query)}`); },
    get(id) { return request('GET', `/api/v1/schedules/${encodeURIComponent(id)}`); },
    create(value) { return request('POST', '/api/v1/schedules', value); },
    update(id, patch) { return request('PATCH', `/api/v1/schedules/${encodeURIComponent(id)}`, patch); },
    remove(id) { return request('DELETE', `/api/v1/schedules/${encodeURIComponent(id)}`); },
  }),
  settings: Object.freeze({
    get() { return request('GET', '/api/v1/settings'); },
    update(change) { return request('PATCH', '/api/v1/settings', change); },
  }),
  reminders: Object.freeze({
    list() { return request('GET', '/api/v1/reminders'); },
  }),
  events: Object.freeze({
    on(name, handler) { window.addEventListener(`schedule-studio:${name}`, handler); return () => window.removeEventListener(`schedule-studio:${name}`, handler); },
    emit(name, detail) { window.dispatchEvent(new CustomEvent(`schedule-studio:${name}`, { detail })); },
  }),
});

window.ScheduleStudio = Object.freeze({ api, surface });

async function mountExtension(component, slot) {
  const target = document.querySelector(slot.selector);
  if (!target) throw new Error(`找不到插槽 ${slot.id}`);
  const root = document.createElement('div');
  root.className = `schedule-component schedule-component--${component.mode}`;
  root.dataset.componentId = component.id;
  root.dataset.componentSlot = slot.id;
  if (component.mode === 'replace' && surface === 'desktop') root.hidden = target.hidden;
  if (component.mode === 'replace' && surface === 'desktop' && target.classList.contains('page')) root.classList.add('page');
  if (component.mode === 'replace' && surface === 'web' && target.classList.contains('view')) {
    root.classList.add('view', target.classList.contains('standby-view') ? 'standby-view' : 'week-view');
  }
  if (component.mode === 'replace' && surface === 'web' && target.id === 'detailPanel') root.classList.add('side-panel', 'detail-panel');
  if (component.mode === 'replace') target.before(root);
  else target.append(root);
  try {
    if (component.assets.css) {
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = `${apiBase}${component.assets.css}`;
      document.head.append(style);
    }
    if (component.assets.html) {
      const response = await fetch(`${apiBase}${component.assets.html}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTML 加载失败：${response.status}`);
      root.innerHTML = await response.text();
    }
    if (component.assets.module) {
      const module = await import(`${apiBase}${component.assets.module}`);
      if (typeof module.mount !== 'function' && typeof module.default !== 'function') throw new Error('组件 JS 必须导出 mount(context)');
      const dispose = await (module.mount || module.default)(Object.freeze({ root, api, component, slot, surface }));
      if (typeof dispose === 'function') disposers.push(dispose);
    }
    if (component.mode === 'replace') {
      target.hidden = true;
      if (surface === 'web') target.style.display = 'none';
      if (surface === 'web' && target.classList.contains('view')) {
        const syncView = () => {
          const active = target.classList.contains('active');
          root.classList.toggle('active', active);
          root.hidden = !active;
        };
        new MutationObserver(syncView).observe(target, { attributes: true, attributeFilter: ['class'] });
        syncView();
      }
      if (surface === 'web' && target.id === 'detailPanel') {
        const syncEditor = () => {
          const open = target.getAttribute('aria-hidden') !== 'true';
          root.hidden = !open;
          root.classList.toggle('open', open);
        };
        new MutationObserver(syncEditor).observe(target, { attributes: true, attributeFilter: ['aria-hidden', 'class'] });
        syncEditor();
      }
    }
  } catch (error) {
    root.remove();
    throw error;
  }
}

async function start() {
  try {
    const manifest = await request('GET', '/api/v1/components');
    const slots = manifest.builtins.filter(item => item.surface === surface);
    const extensions = manifest.extensions.filter(item => item.surface === surface && item.enabled);
    for (const slot of slots) {
      if (!slot.enabled) document.querySelector(slot.selector)?.setAttribute('hidden', '');
    }
    for (const component of extensions) {
      const slot = slots.find(item => item.id === component.slot);
      if (!slot || (component.mode === 'replace' && slot.replacement !== component.id)) continue;
      try { await mountExtension(component, slot); }
      catch (error) { console.error(`[组件:${component.id}] ${error.message}`); }
    }
    window.dispatchEvent(new CustomEvent('schedule-studio:components-ready', { detail: manifest }));
  } catch (error) {
    // 后台服务未启动时，内置 UI 仍可独立使用。
    console.warn(`组件清单暂不可用：${error.message}`);
  }
}

void start();
window.addEventListener('beforeunload', () => {
  for (const dispose of disposers.reverse()) {
    try { dispose(); } catch (error) { console.error(error); }
  }
});
