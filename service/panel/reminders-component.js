const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

function createCard(reminder) {
  const card = document.createElement('article');
  card.className = `reminder-card ${reminder.kind === 'day' ? 'day' : 'time'}`;
  const top = document.createElement('div');
  top.className = 'reminder-top';
  const title = document.createElement('h2');
  title.className = 'reminder-title';
  title.textContent = reminder.title;
  const type = document.createElement('span');
  type.className = 'reminder-type';
  type.textContent = reminder.kind === 'day' ? '提前天数' : '结束当天';
  top.append(title, type);
  const at = document.createElement('time');
  at.className = 'reminder-at';
  at.dateTime = new Date(reminder.at).toISOString();
  at.textContent = `${dateFormat.format(reminder.at)} 提醒`;
  const deadline = document.createElement('p');
  deadline.className = 'reminder-deadline';
  deadline.textContent = `截止：${dateFormat.format(reminder.deadline)}`;
  const notes = document.createElement('p');
  notes.className = 'reminder-notes';
  notes.textContent = reminder.notes?.trim() || '无备注';
  card.append(top, at, deadline, notes);
  return card;
}

export function createRemindersComponent({ serviceUrl }) {
  const list = document.querySelector('#reminderList');
  const statusLine = document.querySelector('#statusLine');

  async function refresh() {
    try {
      const response = await fetch(serviceUrl('/planned-reminders'), { cache: 'no-store' });
      if (!response.ok) throw new Error('读取失败');
      const { reminders } = await response.json();
      document.querySelector('#totalCount').textContent = reminders.length;
      document.querySelector('#navCount').textContent = reminders.length;
      statusLine.textContent = reminders.length ? `接下来有 ${reminders.length} 项提醒` : '当前没有待触发提醒';
      list.replaceChildren(...reminders.map(createCard));
      if (!reminders.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.innerHTML = '<strong>暂时没有提醒</strong><span>在日程网页中开启提醒后，这里会自动显示。</span>';
        list.append(empty);
      }
    } catch (_) { statusLine.textContent = '无法连接本机提醒服务'; }
  }

  document.querySelector('#refresh').addEventListener('click', refresh);
  const timer = setInterval(refresh, 15000);
  void refresh();
  return { refresh, dispose: () => clearInterval(timer) };
}
