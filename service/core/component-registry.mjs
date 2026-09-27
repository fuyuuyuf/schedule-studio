// 稳定的 UI 插槽清单。插件只依赖插槽 ID，不依赖页面内部的 DOM 层级。
export const ComponentKind = Object.freeze({
  DESKTOP_SIDEBAR: 'desktop.sidebar', DESKTOP_REMINDERS: 'desktop.reminders',
  DESKTOP_SETTINGS: 'desktop.settings', DESKTOP_COMPONENTS: 'desktop.components',
  WEB_STANDBY: 'web.standby', WEB_TIMELINE: 'web.timeline',
  WEB_EDITOR: 'web.editor', WEB_STICKY_WALL: 'web.sticky-wall',
});
export const BUILTIN_COMPONENTS = Object.freeze([
  { id: 'desktop.sidebar', kind: 'DESKTOP_SIDEBAR', name: '软件侧栏', surface: 'desktop', selector: '#sidebar', required: true, description: '导航、主题切换和窗口操作。' },
  { id: 'desktop.reminders', kind: 'DESKTOP_REMINDERS', name: '提醒列表', surface: 'desktop', selector: '#remindersPage', required: true, description: '已规划提醒与网页入口。' },
  { id: 'desktop.settings', kind: 'DESKTOP_SETTINGS', name: '设置页面', surface: 'desktop', selector: '#settingsPage', required: true, description: '外观、主题和日期滚轮设置。' },
  { id: 'desktop.components', kind: 'DESKTOP_COMPONENTS', name: '组件管理', surface: 'desktop', selector: '#componentsPage', required: true, description: '管理内置组件和额外插件。' },
  { id: 'web.standby', kind: 'WEB_STANDBY', name: '待机页', surface: 'web', selector: '#standbyView', required: true, description: '时钟、最近任务与便签墙。' },
  { id: 'web.timeline', kind: 'WEB_TIMELINE', name: '日程时间轴', surface: 'web', selector: '#weekView', required: true, description: '日期、日程矩形和交互模式。' },
  { id: 'web.editor', kind: 'WEB_EDITOR', name: '日程编辑器', surface: 'web', selector: '#detailPanel', required: true, description: '日程内容、日期时间和提醒。' },
  { id: 'web.sticky-wall', kind: 'WEB_STICKY_WALL', name: '便签墙', surface: 'web', selector: '#stickyWall', required: false, description: '待机页上的 Markdown 便签。' },
]);

const BUILTIN_BY_ID = new Map(BUILTIN_COMPONENTS.map(component => [component.id, component]));

export class ComponentRegistry {
  constructor({ database, pluginManager, eventBus = null }) {
    this.database = database;
    this.pluginManager = pluginManager;
    this.eventBus = eventBus;
  }

  list() {
    const candidates = this.pluginManager.listUiComponents();
    const builtins = BUILTIN_COMPONENTS.map(component => {
      const state = this.database.getSetting(`component.builtin:${component.id}`, {});
      const replacement = candidates.find(candidate => candidate.id === state.replacement && candidate.slot === component.id && candidate.mode === 'replace');
      return { ...component, type: 'builtin', enabled: component.required ? true : state.enabled !== false, replacement: replacement?.id || null };
    });
    const extensions = candidates.map(component => {
      const owner = builtins.find(item => item.id === component.slot);
      const enabled = component.mode === 'replace' ? owner?.replacement === component.id
        : this.database.getSetting(`component.enabled:${component.id}`, true) !== false;
      return { ...component, enabled, replacesName: owner?.name || null,
        blockedBy: component.mode === 'replace' && owner?.replacement && !enabled ? owner.replacement : null };
    });
    return { builtins, extensions };
  }

  updateBuiltin(id, patch) {
    const component = BUILTIN_BY_ID.get(id);
    if (!component) throw new Error('内置组件不存在');
    const current = this.database.getSetting(`component.builtin:${id}`, {});
    const next = { ...current };
    if (Object.hasOwn(patch, 'enabled')) {
      if (typeof patch.enabled !== 'boolean') throw new Error('enabled 必须是布尔值');
      if (component.required && !patch.enabled) throw new Error('核心组件不能直接关闭，请先选择替换组件');
      next.enabled = patch.enabled;
    }
    if (Object.hasOwn(patch, 'replacement')) {
      if (patch.replacement !== null && typeof patch.replacement !== 'string') throw new Error('replacement 格式无效');
      if (patch.replacement) {
        const candidate = this.pluginManager.listUiComponents().find(item => item.id === patch.replacement && item.slot === id && item.mode === 'replace');
        if (!candidate) throw new Error('替换组件未加载或类型不匹配');
      }
      if (patch.replacement === null && current.replacement) this.database.setSetting(`component.enabled:${current.replacement}`, false);
      if (patch.replacement) this.database.setSetting(`component.enabled:${patch.replacement}`, true);
      next.replacement = patch.replacement;
    }
    this.database.setSetting(`component.builtin:${id}`, next);
    this.eventBus?.emit('component.changed', { id, type: 'builtin' });
    return this.list();
  }

  updateExtension(id, enabled) {
    if (typeof enabled !== 'boolean') throw new Error('enabled 必须是布尔值');
    const component = this.pluginManager.listUiComponents().find(item => item.id === id);
    if (!component) throw new Error('扩展组件不存在');
    if (component.mode === 'replace') {
      const key = `component.builtin:${component.slot}`;
      const state = this.database.getSetting(key, {});
      if (enabled && state.replacement && state.replacement !== id && this.pluginManager.listUiComponents().some(item => item.id === state.replacement)) {
        throw new Error('该类型已有启用的替换组件，请先关闭它');
      }
      if (enabled || state.replacement === id) this.database.setSetting(key, { ...state, replacement: enabled ? id : null });
      this.database.setSetting(`component.enabled:${id}`, enabled);
    } else this.database.setSetting(`component.enabled:${id}`, enabled);
    this.eventBus?.emit('component.changed', { id, type: 'extension', enabled });
    return this.list();
  }

  activatePluginDefaults(pluginId) {
    for (const component of this.pluginManager.listUiComponents().filter(item => item.pluginId === pluginId && item.mode === 'replace')) {
      if (this.database.getSetting(`component.enabled:${component.id}`, true) === false) continue;
      const key = `component.builtin:${component.slot}`;
      const state = this.database.getSetting(key, {});
      // 保留用户先前选中的组件，即便它尚未按加载顺序出现。
      if (!state.replacement) {
        this.database.setSetting(key, { ...state, replacement: component.id });
      }
    }
  }
}
