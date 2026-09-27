const $ = selector => document.querySelector(selector);
const systemDark = matchMedia('(prefers-color-scheme: dark)');

export function createSettingsComponent({ serviceUrl }) {
  let settings = { appearance: 'light', reverseWheel: false, themeName: 'Solarized', themeCss: '', sidebarCollapsed: false };
  let firstLoad = true;
  const isDark = () => settings.appearance === 'dark' || (settings.appearance === 'system' && systemDark.matches);

  function apply() {
    document.documentElement.dataset.theme = isDark() ? 'dark' : 'light';
    $('#appearanceSelect').value = settings.appearance;
    $('#reverseWheel').checked = Boolean(settings.reverseWheel);
    $('#themeName').textContent = settings.themeName || 'Solarized';
    $('#uploadedThemeStyle').textContent = settings.themeCss || '';
    $('#appRoot').classList.toggle('collapsed', Boolean(settings.sidebarCollapsed));
    $('#collapseSidebar').setAttribute('aria-label', settings.sidebarCollapsed ? '展开侧栏' : '收起侧栏');
    $('#collapseSidebar').title = settings.sidebarCollapsed ? '展开侧栏' : '收起侧栏';
    $('#themeToggle').title = isDark() ? '当前深色，点击切换到浅色' : '当前浅色，点击切换到深色';
    $('#themeToggle').setAttribute('aria-label', $('#themeToggle').title);
  }

  async function load() {
    try {
      const response = await fetch(serviceUrl('/settings'), { cache: 'no-store' });
      if (!response.ok) throw new Error('读取失败');
      settings = await response.json();
      apply();
      if (firstLoad) {
        firstLoad = false;
        requestAnimationFrame(() => document.documentElement.classList.add('theme-ready'));
      }
    } catch (_) { $('#themeStatus').textContent = '无法读取软件设置。'; }
  }

  async function save(change) {
    settings = { ...settings, ...change };
    apply();
    try {
      const response = await fetch(serviceUrl('/settings'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) });
      if (!response.ok) throw new Error('保存失败');
      settings = await response.json();
      apply();
      $('#themeStatus').textContent = '设置已保存，日程网页会同步更新。';
    } catch (_) { $('#themeStatus').textContent = '设置保存失败，请确认托盘程序正在运行。'; }
  }

  async function importThemeFiles(files) {
    const file = [...files].find(item => /(^|\/)theme\.css$/i.test(item.webkitRelativePath || item.name)) || [...files].find(item => /\.css$/i.test(item.name));
    if (!file) { $('#themeStatus').textContent = '未找到 CSS 文件。'; return; }
    if (file.size > 1024 * 1024) { $('#themeStatus').textContent = '主题文件不能超过 1 MB。'; return; }
    try {
      const themeCss = await file.text();
      const themeName = file.webkitRelativePath?.split('/')[0] || file.name.replace(/\.css$/i, '');
      await save({ themeName, themeCss });
    } catch (_) { $('#themeStatus').textContent = '主题读取失败，请重试。'; }
  }

  systemDark.addEventListener('change', apply);
  $('#themeToggle').addEventListener('click', () => save({ appearance: isDark() ? 'light' : 'dark' }));
  $('#appearanceSelect').addEventListener('change', event => save({ appearance: event.target.value }));
  $('#reverseWheel').addEventListener('change', event => save({ reverseWheel: event.target.checked }));
  $('#collapseSidebar').addEventListener('click', () => save({ sidebarCollapsed: !settings.sidebarCollapsed }));
  $('#chooseThemeFile').addEventListener('click', () => $('#themeFileInput').click());
  $('#chooseThemeFolder').addEventListener('click', () => $('#themeFolderInput').click());
  $('#themeFileInput').addEventListener('change', event => importThemeFiles(event.target.files));
  $('#themeFolderInput').addEventListener('change', event => importThemeFiles(event.target.files));
  $('#resetTheme').addEventListener('click', () => save({ themeName: 'Solarized', themeCss: '' }));
  const clearDialog = $('#clearDataDialog');
  $('#clearAllData').addEventListener('click', () => clearDialog.showModal());
  $('#cancelClearData').addEventListener('click', () => clearDialog.close());
  $('#confirmClearData').addEventListener('click', async () => {
    $('#confirmClearData').disabled = true;
    $('#clearDataStatus').textContent = '正在清空…';
    try {
      const response = await fetch(serviceUrl('/api/v1/data/clear'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: '清空所有数据' }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || '清空失败');
      clearDialog.close();
      $('#themeStatus').textContent = '数据已清空。已打开的日程网页会自动刷新。';
      await load();
    } catch (error) { $('#clearDataStatus').textContent = error.message; }
    finally { $('#confirmClearData').disabled = false; }
  });
  const dropZone = $('#themeDropZone');
  dropZone.addEventListener('dragover', event => { event.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', async event => {
    event.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = [...event.dataTransfer.files];
    if (files.some(file => /\.css$/i.test(file.name))) return importThemeFiles(files);
    const entries = [...event.dataTransfer.items].map(item => item.webkitGetAsEntry?.()).filter(Boolean);
    const found = [];
    async function walk(entry) {
      if (entry.isFile) {
        const file = await new Promise(resolve => entry.file(resolve, () => resolve(null)));
        if (file) found.push(file);
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        for (;;) {
          const children = await new Promise(resolve => reader.readEntries(resolve, () => resolve([])));
          if (!children.length) break;
          await Promise.all(children.map(walk));
        }
      }
    }
    await Promise.all(entries.map(walk));
    importThemeFiles(found);
  });

  const timer = setInterval(load, 10000);
  window.addEventListener('focus', load);
  void load();
  return { load, save, dispose: () => clearInterval(timer) };
}
