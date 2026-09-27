const endpoint = 'http://127.0.0.1:3456/api/v1/plugins/sticker-widget';

async function request(method, route, body) {
  const response = await fetch(`${endpoint}/${route}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || '请求失败');
  return result.data;
}

export function mount({ root }) {
  const danger = root.parentElement?.querySelector('.danger-setting');
  if (danger) danger.before(root);
  const directory = root.querySelector('.sticker-directory');
  const border = root.querySelector('.sticker-white-border');
  const status = root.querySelector('.sticker-settings-status');
  const open = root.querySelector('.sticker-open-directory');

  async function load() {
    try {
      const config = await request('GET', 'config');
      directory.textContent = config.directory;
      border.checked = config.whiteBorder;
    } catch (error) { status.textContent = `读取贴纸设置失败：${error.message}`; }
  }

  async function changeBorder() {
    border.disabled = true;
    try {
      await request('PATCH', 'config', { whiteBorder: border.checked });
      status.textContent = '贴纸白边设置已保存。';
    } catch (error) {
      border.checked = !border.checked;
      status.textContent = `保存失败：${error.message}`;
    } finally { border.disabled = false; }
  }

  async function openDirectory() {
    try {
      await request('POST', 'open-directory');
      status.textContent = '已打开贴纸目录。将图片放入后，重新打开待机页的贴纸列表即可选择。';
    } catch (error) { status.textContent = `打开目录失败：${error.message}`; }
  }

  border.addEventListener('change', changeBorder);
  open.addEventListener('click', openDirectory);
  window.addEventListener('focus', load);
  void load();
  return () => {
    border.removeEventListener('change', changeBorder);
    open.removeEventListener('click', openDirectory);
    window.removeEventListener('focus', load);
  };
}
