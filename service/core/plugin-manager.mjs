import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BUILTIN_COMPONENTS, ComponentKind } from './component-registry.mjs';

const ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const ALLOWED_PERMISSIONS = new Set(['schedules:read', 'schedules:write', 'settings:read', 'settings:write', 'reminders:read', 'events:subscribe', 'events:emit', 'storage', 'http:route', 'ui:components']);
const UI_SLOTS = new Map(BUILTIN_COMPONENTS.map(component => [component.id, component.surface]));

function resolvePluginFile(directory, relativePath, extension) {
  if (!relativePath) return null;
  const file = path.resolve(directory, String(relativePath));
  if (!file.startsWith(`${directory}${path.sep}`) || path.extname(file).toLowerCase() !== extension || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`组件文件无效：${relativePath}`);
  }
  if (fs.statSync(file).size > 1024 * 1024) throw new Error(`组件文件超过 1 MB：${relativePath}`);
  return file;
}

function validateUiComponents(manifest, directory, permissions) {
  const definitions = manifest.uiComponents || [];
  if (!Array.isArray(definitions) || definitions.length > 20) throw new Error('uiComponents 必须是最多 20 项的数组');
  if (definitions.length && !permissions.has('ui:components')) throw new Error('UI 组件需要 ui:components 权限');
  const ids = new Set();
  return definitions.map(definition => {
    if (!ID_PATTERN.test(definition.id || '') || ids.has(definition.id)) throw new Error('组件 id 无效或重复');
    ids.add(definition.id);
    const kind = definition.kind || definition.replaces || BUILTIN_COMPONENTS.find(item => item.id === definition.slot)?.kind;
    const slot = ComponentKind[kind];
    if (!slot || (definition.slot && definition.slot !== slot) || UI_SLOTS.get(slot) !== definition.surface) throw new Error(`组件类型或插槽无效：${kind}`);
    if (!['append', 'replace'].includes(definition.mode)) throw new Error('组件 mode 只能是 append 或 replace');
    const files = {
      html: resolvePluginFile(directory, definition.html, '.html'),
      css: resolvePluginFile(directory, definition.css, '.css'),
      module: resolvePluginFile(directory, definition.module, '.js'),
    };
    if (!files.html && !files.module && !files.css) throw new Error('组件至少需要一个 HTML、CSS 或 JS 文件');
    return { id: definition.id, name: String(definition.name || definition.id).slice(0, 100), surface: definition.surface,
      slot, kind, mode: definition.mode, description: String(definition.description || '').slice(0, 300), files };
  });
}

function ensurePermission(plugin, permission) {
  if (!plugin.permissions.has(permission)) throw new Error(`插件 ${plugin.id} 缺少权限 ${permission}`);
}

export class PluginManager {
  constructor({ directory, database, eventBus, getSettings = () => ({}), updateSettings = () => ({}), listReminders = () => [], logger = console }) {
    this.directory = directory;
    this.database = database;
    this.eventBus = eventBus;
    this.getSettings = getSettings;
    this.updateSettings = updateSettings;
    this.listReminders = listReminders;
    this.logger = logger;
    this.plugins = new Map();
    this.catalog = new Map();
    this.routes = new Map();
    this.watcher = null;
    this.reloadTimer = null;
  }

  async loadAll() {
    fs.mkdirSync(this.directory, { recursive: true });
    this.catalog.clear();
    const entries = fs.readdirSync(this.directory, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));
    for (const entry of entries) {
      try { await this.load(entry.name); }
      catch (error) {
        const item = this.catalog.get(entry.name) || { id: entry.name, name: entry.name, version: '', description: '', permissions: [], folder: entry.name };
        this.catalog.set(entry.name, { ...item, status: 'failed', error: error.message });
        this.logger.error(`[插件:${entry.name}] ${error.stack || error.message}`);
      }
    }
    return this.list();
  }

  async load(folderName) {
    const pluginDirectory = path.resolve(this.directory, folderName);
    const manifestPath = path.join(pluginDirectory, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return null;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!ID_PATTERN.test(manifest.id || '')) throw new Error('manifest.id 必须使用小写字母、数字和连字符');
    if (manifest.apiVersion !== '1') throw new Error(`不支持的 apiVersion：${manifest.apiVersion}`);
    if ([...this.catalog.values()].some(item => item.id === manifest.id && item.folder !== folderName)) throw new Error(`插件 id 重复：${manifest.id}`);
    const permissions = new Set(manifest.permissions || []);
    for (const permission of permissions) if (!ALLOWED_PERMISSIONS.has(permission)) throw new Error(`未知权限：${permission}`);
    const uiComponents = validateUiComponents(manifest, pluginDirectory, permissions);
    const enabledOverride = this.database.getSetting(`plugin.enabled:${manifest.id}`, null);
    const enabled = enabledOverride === null ? manifest.enabled !== false : enabledOverride === true;
    const summary = { id: manifest.id, name: manifest.name || manifest.id, version: manifest.version || '0.0.0',
      description: manifest.description || '', permissions: [...permissions], folder: folderName, enabled,
      status: enabled ? 'loading' : 'disabled', error: '', uiComponentCount: uiComponents.length };
    this.catalog.set(folderName, summary);
    if (!enabled) { await this.unload(manifest.id); return null; }
    const entryPath = path.resolve(pluginDirectory, manifest.main || 'index.mjs');
    if (!entryPath.startsWith(`${pluginDirectory}${path.sep}`) || (!fs.existsSync(entryPath) && (manifest.main || !uiComponents.length))) throw new Error('插件入口不存在或越过插件目录');
    await this.unload(manifest.id);
    const plugin = { id: manifest.id, manifest, permissions, directory: pluginDirectory, uiComponents, disposers: [], status: 'loading', error: '' };
    this.plugins.set(plugin.id, plugin);
    try {
      if (fs.existsSync(entryPath)) {
        const moduleUrl = `${pathToFileURL(entryPath).href}?updated=${fs.statSync(entryPath).mtimeMs}`;
        const module = await import(moduleUrl);
        if (typeof module.activate !== 'function' && typeof module.default !== 'function') throw new Error('入口必须导出 activate(context) 或默认函数');
        const deactivate = await (module.activate || module.default)(this.createContext(plugin));
        if (typeof deactivate === 'function') plugin.disposers.push(deactivate);
        if (typeof module.deactivate === 'function') plugin.disposers.push(module.deactivate);
      }
      plugin.status = 'active';
      summary.status = 'active';
      this.logger.info(`[插件:${plugin.id}] 已加载 ${manifest.version || '0.0.0'}`);
      this.eventBus.emit('plugin.loaded', { id: plugin.id, version: manifest.version || '0.0.0' });
      return plugin;
    } catch (error) {
      plugin.status = 'failed'; plugin.error = error.message;
      summary.status = 'failed'; summary.error = error.message;
      throw error;
    }
  }

  async unload(pluginId) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;
    for (const dispose of plugin.disposers.reverse()) {
      try { await dispose(); } catch (error) { this.logger.error(`[插件:${pluginId}] 卸载失败：${error.message}`); }
    }
    for (const key of [...this.routes.keys()]) if (key.startsWith(`${pluginId}:`)) this.routes.delete(key);
    this.plugins.delete(pluginId);
  }

  async setEnabled(pluginId, enabled) {
    if (typeof enabled !== 'boolean') throw new Error('enabled 必须是布尔值');
    const item = [...this.catalog.values()].find(candidate => candidate.id === pluginId);
    if (!item) throw new Error('插件不存在');
    this.database.setSetting(`plugin.enabled:${pluginId}`, enabled);
    if (enabled) await this.load(item.folder);
    else {
      await this.unload(pluginId);
      item.enabled = false; item.status = 'disabled'; item.error = '';
    }
    this.eventBus.emit('plugin.stateChanged', { id: pluginId, enabled });
    return this.list();
  }

  listUiComponents() {
    return [...this.plugins.values()].filter(plugin => plugin.status === 'active').flatMap(plugin => plugin.uiComponents.map(component => ({
      id: `${plugin.id}:${component.id}`, pluginId: plugin.id, name: component.name, description: component.description,
      surface: component.surface, slot: component.slot, kind: component.kind, mode: component.mode, type: 'extension',
      assets: Object.fromEntries(Object.entries(component.files).map(([kind, file]) => [kind, file ? `/api/v1/components/assets/${plugin.id}/${component.id}/${kind}` : null])),
    })));
  }

  getUiAsset(pluginId, componentId, kind) {
    const component = this.plugins.get(pluginId)?.uiComponents.find(item => item.id === componentId);
    return component?.files[kind] || null;
  }

  createContext(plugin) {
    const manager = this;
    const api = {
      plugin: Object.freeze({ id: plugin.id, name: plugin.manifest.name, version: plugin.manifest.version }),
      log: Object.freeze({
        info: (...args) => manager.logger.info(`[插件:${plugin.id}]`, ...args),
        warn: (...args) => manager.logger.warn(`[插件:${plugin.id}]`, ...args),
        error: (...args) => manager.logger.error(`[插件:${plugin.id}]`, ...args),
      }),
      schedules: Object.freeze({
        list(query = {}) { ensurePermission(plugin, 'schedules:read'); return manager.database.listSchedules(query); },
        get(id) { ensurePermission(plugin, 'schedules:read'); return manager.database.getSchedule(String(id)); },
        create(value) { ensurePermission(plugin, 'schedules:write'); const item = manager.database.saveSchedule(value); manager.eventBus.emit('schedule.created', item); return item; },
        update(id, value) { ensurePermission(plugin, 'schedules:write'); const item = manager.database.saveSchedule({ ...value, id: String(id) }); manager.eventBus.emit('schedule.updated', item); return item; },
        remove(id) { ensurePermission(plugin, 'schedules:write'); const removed = manager.database.deleteSchedule(String(id)); if (removed) manager.eventBus.emit('schedule.deleted', { id: String(id) }); return removed; },
      }),
      settings: Object.freeze({
        get() { ensurePermission(plugin, 'settings:read'); return structuredClone(manager.getSettings()); },
        update(change) { ensurePermission(plugin, 'settings:write'); return structuredClone(manager.updateSettings(change)); },
      }),
      reminders: Object.freeze({
        list() { ensurePermission(plugin, 'reminders:read'); return structuredClone(manager.listReminders()); },
      }),
      events: Object.freeze({
        on(name, listener) { ensurePermission(plugin, 'events:subscribe'); const dispose = manager.eventBus.on(String(name), listener); plugin.disposers.push(dispose); return dispose; },
        emit(name, payload) { ensurePermission(plugin, 'events:emit'); if (!String(name).startsWith(`plugin.${plugin.id}.`)) throw new Error('插件只能发出自身命名空间事件'); manager.eventBus.emit(String(name), payload); },
      }),
      storage: Object.freeze({
        get(key, fallback = null) { ensurePermission(plugin, 'storage'); return manager.database.getPluginState(plugin.id, String(key), fallback); },
        set(key, value) { ensurePermission(plugin, 'storage'); manager.database.setPluginState(plugin.id, String(key), value); },
      }),
      http: Object.freeze({
        register(method, route, handler) {
          ensurePermission(plugin, 'http:route');
          const normalizedMethod = String(method).toUpperCase();
          const normalizedRoute = String(route).replace(/^\/+|\/+$/g, '');
          if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(normalizedMethod) || !/^[a-z0-9/_-]*$/.test(normalizedRoute)) throw new Error('插件 HTTP 路由无效');
          const key = `${plugin.id}:${normalizedMethod}:${normalizedRoute}`;
          manager.routes.set(key, handler);
          const dispose = () => manager.routes.delete(key);
          plugin.disposers.push(dispose);
          return `/api/v1/plugins/${plugin.id}/${normalizedRoute}`;
        },
      }),
    };
    return Object.freeze(api);
  }

  async handleHttp(pluginId, method, route, request) {
    const handler = this.routes.get(`${pluginId}:${method}:${route.replace(/^\/+|\/+$/g, '')}`);
    if (!handler) return null;
    return await handler(Object.freeze(request));
  }

  list() {
    return [...this.catalog.values()].map(item => ({ ...item }));
  }

  watch() {
    if (this.watcher) return;
    this.watcher = fs.watch(this.directory, { recursive: true }, () => {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(async () => {
        for (const plugin of [...this.plugins.values()]) await this.unload(plugin.id);
        await this.loadAll();
      }, 500);
    });
  }

  async close() {
    this.watcher?.close();
    for (const plugin of [...this.plugins.values()]) await this.unload(plugin.id);
  }
}
