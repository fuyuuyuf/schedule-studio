export function mount({ root, api }) {
  const list = root.querySelector('.example-list');
  const openButton = root.querySelector('.example-open');
  const openWeb = () => window.open('http://127.0.0.1:4173/', '_blank');
  openButton.addEventListener('click', openWeb);

  async function refresh() {
    try {
      const { reminders } = await api.reminders.list();
      list.replaceChildren();
      if (!reminders.length) { list.textContent = '目前没有待提醒日程。'; return; }
      for (const reminder of reminders) {
        const item = document.createElement('div');
        item.className = 'example-item';
        item.textContent = `${reminder.title} · ${new Date(reminder.at).toLocaleString('zh-CN')}`;
        list.append(item);
      }
    } catch (error) { list.textContent = `读取失败：${error.message}`; }
  }

  const timer = setInterval(refresh, 15000);
  void refresh();
  return () => { clearInterval(timer); openButton.removeEventListener('click', openWeb); };
}
