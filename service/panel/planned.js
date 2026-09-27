import { createRemindersComponent } from './reminders-component.js';
import { createSettingsComponent } from './settings-component.js';
import { createComponentsPage } from './components-page.js';

const $ = selector => document.querySelector(selector);
const serviceUrl = route => `${location.protocol === 'file:' ? 'http://127.0.0.1:3456' : location.origin}${route}`;

// 主窗口只负责导航；具体页面拥有各自的数据读取、事件和渲染。
const reminders = createRemindersComponent({ serviceUrl });
createSettingsComponent({ serviceUrl });
const components = createComponentsPage({ serviceUrl });
const pageTitles = new Map([['reminders', '已规划提醒'], ['components', '组件'], ['settings', '设置']]);

// 导航项集中放在流式容器中；后续组件可注册页面，不需要调整其它按钮的位置。
function registerPage(name, title, button, panel) {
  if (!/^[a-z][a-z0-9-]*$/.test(name) || pageTitles.has(name)) throw new Error('页面名称无效或已存在');
  button.dataset.page = name;
  panel.id = `${name}Page`;
  panel.classList.add('page');
  panel.hidden = true;
  $('#sidebarNavigation').append(button);
  $('.workspace').insertBefore(panel, $('.workspace footer'));
  pageTitles.set(name, title);
}
window.ScheduleStudioRegisterPage = registerPage;

function showPage(name) {
  if (!pageTitles.has(name)) return;
  for (const page of pageTitles.keys()) {
    $(`#${page}Page`).hidden = page !== name;
    const replacement = document.querySelector(`[data-component-slot="desktop.${page}"]`);
    if (replacement) replacement.hidden = page !== name;
  }
  $('#pageTitle').textContent = pageTitles.get(name);
  document.querySelectorAll('[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === name));
  sessionStorage.setItem('schedule-studio-panel-page', name);
  if (name === 'reminders') void reminders.refresh();
  if (name === 'components') void components.refresh();
}

$('#sidebarNavigation').addEventListener('click', event => {
  const button = event.target.closest('[data-page]');
  if (button) showPage(button.dataset.page);
});

function openSchedule() {
  // 保留点击手势，直接交由 Electron 打开浏览器并切换到网页。
  window.open('http://127.0.0.1:4173/', '_blank');
}
$('#logoButton').addEventListener('click', openSchedule);
$('#openSchedule').addEventListener('click', openSchedule);
$('#hideWindow').addEventListener('click', () => window.close());

const requestedPage = new URLSearchParams(location.search).get('page');
showPage(requestedPage || sessionStorage.getItem('schedule-studio-panel-page') || 'reminders');
