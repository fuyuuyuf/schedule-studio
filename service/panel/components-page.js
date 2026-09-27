const $ = selector => document.querySelector(selector);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createComponentsPage({ serviceUrl }) {
  const builtinList = $('#builtinComponents');
  const extensionList = $('#extensionComponents');
  const pluginList = $('#installedPlugins');
  const status = $('#componentStatus');

  async function request(method, route, body) {
    const response = await fetch(serviceUrl(route), {
      method, cache: 'no-store',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok || result.ok === false) throw new Error(result.error || '操作失败');
    return result.data;
  }

  async function change(route, body) {
    try {
      status.textContent = '正在应用更改…';
      await request('PATCH', route, body);
      sessionStorage.setItem('schedule-studio-panel-page', 'components');
      location.reload();
    } catch (error) { status.textContent = error.message; }
  }

  function renderBuiltin(component, extensions) {
    const card = element('article', 'component-card');
    const text = element('div', 'component-info');
    text.append(element('strong', '', component.name), element('p', '', component.description));
    text.append(element('small', '', `${component.kind} · ${component.id}`));
    const controls = element('div', 'component-controls');
    const candidates = extensions.filter(item => item.slot === component.id && item.mode === 'replace');
    const select = element('select', 'component-select');
    select.setAttribute('aria-label', `替换 ${component.name}`);
    const defaultOption = element('option', '', '使用内置界面');
    defaultOption.value = '';
    select.append(defaultOption);
    for (const candidate of candidates) {
      const option = element('option', '', `${candidate.name} · ${candidate.pluginId}`);
      option.value = candidate.id;
      select.append(option);
    }
    select.value = component.replacement || '';
    select.addEventListener('change', () => change(`/api/v1/components/builtin/${component.id}`, { replacement: select.value || null }));
    controls.append(select);
    if (component.required) controls.append(element('span', 'component-lock', '核心组件'));
    else {
      const toggle = element('input');
      toggle.type = 'checkbox';
      toggle.checked = component.enabled;
      toggle.setAttribute('aria-label', `启用 ${component.name}`);
      toggle.addEventListener('change', () => change(`/api/v1/components/builtin/${component.id}`, { enabled: toggle.checked }));
      controls.append(toggle);
    }
    card.append(text, controls);
    return card;
  }

  function renderPlugin(plugin) {
    const card = element('article', 'component-card');
    const text = element('div', 'component-info');
    text.append(element('strong', '', plugin.name));
    text.append(element('p', '', plugin.description || '无描述'));
    text.append(element('small', '', `${plugin.id} · ${plugin.version} · ${plugin.uiComponentCount} 个 UI 组件 · mod/${plugin.folder}`));
    if (plugin.error) text.append(element('p', 'component-error', plugin.error));
    const controls = element('div', 'component-controls');
    controls.append(element('span', `plugin-status status-${plugin.status}`, plugin.status === 'active' ? '运行中' : plugin.status === 'disabled' ? '已停用' : plugin.status === 'failed' ? '加载失败' : '加载中'));
    const toggle = element('input');
    toggle.type = 'checkbox';
    toggle.checked = plugin.enabled;
    toggle.setAttribute('aria-label', `启用插件 ${plugin.name}`);
    toggle.addEventListener('change', () => change(`/api/v1/plugins/${plugin.id}/state`, { enabled: toggle.checked }));
    controls.append(toggle);
    card.append(text, controls);
    return card;
  }

  function renderExtension(component) {
    const card = element('article', 'component-card');
    const text = element('div', 'component-info');
    text.append(element('strong', '', component.name));
    text.append(element('p', '', component.description || '额外界面组件'));
    text.append(element('small', '', `${component.id} · ${component.kind} · ${component.mode === 'replace' ? `可替换：${component.replacesName}` : `附加到：${component.replacesName}`}`));
    if (component.blockedBy) card.classList.add('component-card--blocked');
    const controls = element('div', 'component-controls');
    const toggle = element('input');
    toggle.type = 'checkbox';
    toggle.checked = component.enabled;
    toggle.disabled = Boolean(component.blockedBy);
    if (component.blockedBy) toggle.title = `请先停用 ${component.blockedBy}`;
    toggle.setAttribute('aria-label', `启用组件 ${component.name}`);
    toggle.addEventListener('change', () => change(`/api/v1/components/extension/${component.id}`, { enabled: toggle.checked }));
    controls.append(toggle);
    card.append(text, controls);
    return card;
  }

  async function refresh() {
    try {
      const [components, plugins] = await Promise.all([
        request('GET', '/api/v1/components'), request('GET', '/api/v1/plugins'),
      ]);
      builtinList.replaceChildren(...components.builtins.map(item => renderBuiltin(item, components.extensions)));
      extensionList.replaceChildren(...components.extensions.map(renderExtension));
      if (!components.extensions.length) extensionList.append(element('p', 'component-empty', '暂无已启用插件提供的 UI 组件。'));
      pluginList.replaceChildren(...plugins.plugins.map(renderPlugin));
      if (!plugins.plugins.length) pluginList.append(element('p', 'component-empty', '尚未安装额外插件。把插件文件夹放入项目根目录 mod 后会自动发现。'));
      status.textContent = `${components.extensions.length} 个扩展组件，${plugins.plugins.length} 个额外插件；内置组件默认折叠。更改后界面会自动重载。`;
    } catch (error) { status.textContent = `无法读取组件：${error.message}`; }
  }

  $('#refreshComponents').addEventListener('click', refresh);
  void refresh();
  return { refresh };
}
