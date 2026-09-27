import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import notifier from 'node-notifier';
import { ScheduleDatabase } from './core/database.mjs';
import { ApplicationEventBus } from './core/event-bus.mjs';
import { expandRecurringSchedule } from './core/recurrence.mjs';
import { PluginManager } from './core/plugin-manager.mjs';
import { ComponentRegistry } from './core/component-registry.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dist = path.join(root, 'dist');
const dataDirectory = process.env.SCHEDULE_DATA_DIR || here;
fs.mkdirSync(dataDirectory, { recursive: true });
const storePath = process.env.SCHEDULE_STORE_PATH || path.join(dataDirectory, 'reminders.json');
const settingsPath = process.env.SCHEDULE_SETTINGS_PATH || path.join(dataDirectory, 'settings.json');
const databasePath = process.env.SCHEDULE_DATABASE_PATH || path.join(dataDirectory, 'schedule-studio.sqlite');
const iconPng = path.join(here, 'assets', 'tray.png');
const iconIco = path.join(here, 'assets', 'tray.ico');
const panelDirectory = path.join(here, 'panel');
const API_PORT = Number(process.env.SCHEDULE_API_PORT) || 3456;
const WEB_PORT = Number(process.env.SCHEDULE_WEB_PORT) || 4173;
const MAX_DELAY = 2147483647;
const SERVICE_BUILD = '2026-09-26-components-v13';
function readOwnerSid() {
  if (process.env.SCHEDULE_OWNER_SID) return process.env.SCHEDULE_OWNER_SID;
  if (process.platform !== 'win32') return '';
  try {
    const output = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
    return output.match(/S-1-\d+(?:-\d+)+/i)?.[0] || '';
  } catch { return ''; }
}
const OWNER_SID = readOwnerSid();
const SESSION_ID = Number(process.env.SCHEDULE_SESSION_ID) || 0;
const allowedOrigins = new Set([`http://127.0.0.1:${WEB_PORT}`, `http://localhost:${WEB_PORT}`, `http://127.0.0.1:${API_PORT}`, `http://localhost:${API_PORT}`, 'null']);
let scheduledReminders = [];
let reminderTimer = null;
let trayStatus = process.env.SCHEDULE_TRAY_DISABLED === '1' ? 'disabled' : 'starting';
let trayError = '';
let quitting = false;
let suppressWindowStateWrites = false;
const database = new ScheduleDatabase(databasePath);
const eventBus = new ApplicationEventBus();
const pluginManager = new PluginManager({
  directory: path.join(root, 'mod'), database, eventBus,
  getSettings: () => publicSettings(), updateSettings: change => updateSettings(change),
  listReminders: () => remindersByTriggerTime(),
});
const componentRegistry = new ComponentRegistry({ database, pluginManager, eventBus });
eventBus.on('plugin.loaded', ({ id }) => componentRegistry.activatePluginDefaults(id));
const defaultSettings = {
  appearance: 'light', reverseWheel: false, themeName: 'Solarized', themeCss: '',
  sidebarCollapsed: false, configured: false, window: { x: null, y: null, width: 850, height: 640 },
};
let settings = { ...defaultSettings, window: { ...defaultSettings.window } };
let hasSavedSettings = false;
try {
  const storedSettings = database.getSetting('application', null) || JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  settings = { ...settings, ...storedSettings };
  settings.window = { ...defaultSettings.window, ...settings.window };
  hasSavedSettings = Boolean(settings.configured);
} catch (_) { /* 首次启动时使用默认设置。 */ }

function saveSettings() {
  const temporary = `${settingsPath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(settings, null, 2));
  fs.renameSync(temporary, settingsPath);
  database.setSetting('application', settings);
  hasSavedSettings = Boolean(settings.configured);
}

function publicSettings() {
  return { ...settings, hasSavedSettings };
}

function updateSettings(input) {
  if (['light', 'dark', 'system'].includes(input.appearance)) { settings.appearance = input.appearance; settings.configured = true; }
  if (typeof input.reverseWheel === 'boolean') { settings.reverseWheel = input.reverseWheel; settings.configured = true; }
  if (typeof input.sidebarCollapsed === 'boolean') settings.sidebarCollapsed = input.sidebarCollapsed;
  if (typeof input.themeCss === 'string' && input.themeCss.length <= 1024 * 1024) {
    settings.themeCss = input.themeCss.replace(/@import\s+[^;]+;/gi, '').replace(/url\(\s*(['"]?)(?!data:)[^)]*\)/gi, 'none');
    settings.themeName = String(input.themeName || '自定义主题').slice(0, 100);
    settings.configured = true;
  }
  saveSettings();
  eventBus.emit('settings.updated', publicSettings());
  return publicSettings();
}

scheduledReminders = database.listReminders();
if (!scheduledReminders.length) {
  try { scheduledReminders = JSON.parse(fs.readFileSync(storePath, 'utf8')); } catch (_) { scheduledReminders = []; }
}
if (!Array.isArray(scheduledReminders)) scheduledReminders = [];
// 旧版本会保留 fired 项；启动时直接迁移为只保存尚未触发的提醒。
const loadedReminderCount = scheduledReminders.length;
scheduledReminders = scheduledReminders.filter(item => !item.fired);

function saveReminders() {
  const temporary = `${storePath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(scheduledReminders, null, 2));
  fs.renameSync(temporary, storePath);
  database.replaceAllReminders(scheduledReminders);
}
if (scheduledReminders.length !== loadedReminderCount) saveReminders();

function deadlineOf(event) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(event.endDate || '');
  if (!match) return NaN;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, Number(event.end)).getTime();
}

function buildReminderJobs(clientId, event) {
  if (!event?.reminder?.enabled || !event.id || !event.title || !event.startDate || !event.endDate) return [];
  const minutes = Math.max(0, Math.min(10080, Number(event.reminder.minutesBefore) || 0));
  const days = Math.max(0, Math.min(365, Number(event.reminder.daysBefore) || 0));
  const now = new Date();
  const dateKey = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  const horizon = new Date(now); horizon.setDate(horizon.getDate() + 400);
  const rangeStart = new Date(now); rangeStart.setDate(rangeStart.getDate() - 2);
  const instances = event.recurrence ? expandRecurringSchedule(event, dateKey(rangeStart), dateKey(horizon)) : [event];
  return instances.flatMap(instance => {
    const deadline = deadlineOf(instance);
    if (!Number.isFinite(deadline) || instance.startDate > instance.endDate) return [];
    const values = [{ kind: 'time', at: deadline - minutes * 60000 }];
    if (instance.startDate !== instance.endDate && days > 0) values.push({ kind: 'day', at: deadline - days * 86400000 });
    return values.map(({ kind, at }) => ({
      key: `${clientId}:${event.id}:${kind}:${at}`, clientId, eventId: event.id, kind, at, deadline,
      title: String(event.title).slice(0, 120), notes: String(event.notes || '').slice(0, 2000),
    }));
  });
}

function deduplicateReminders(items) {
  const unique = new Map();
  for (const item of items) unique.set(`${item.eventId}:${item.kind}:${item.at}`, item);
  return [...unique.values()];
}

function replaceClientReminders(clientId, events) {
  const incomingReminders = events.flatMap(event => buildReminderJobs(clientId, event));
  scheduledReminders = deduplicateReminders(scheduledReminders.filter(item => item.clientId !== clientId).concat(incomingReminders));
  saveReminders();
  scheduleNextReminder();
}

function refreshDatabaseReminders() {
  const incoming = database.listSchedules().flatMap(event => buildReminderJobs('database', event));
  scheduledReminders = deduplicateReminders(scheduledReminders.filter(item => item.clientId !== 'database').concat(incoming));
  saveReminders();
  scheduleNextReminder();
}

for (const eventName of ['schedule.created', 'schedule.updated', 'schedule.deleted', 'schedule.replaced', 'schedule.imported']) {
  eventBus.on(eventName, refreshDatabaseReminders);
}

function sendNotification(item) {
  const deadline = new Date(item.deadline).toLocaleString('zh-CN', { hour12: false });
  notifier.notify({
    title: item.title,
    message: `${item.notes || '无备注'}\n截止：${deadline}`,
    icon: iconPng,
    timeout: 3,
    wait: false,
  });
}

function remindersByTriggerTime() {
  return [...scheduledReminders].sort((left, right) => left.at - right.at);
}

function scheduleNextReminder() {
  clearTimeout(reminderTimer);
  const now = Date.now();
  const dueReminders = scheduledReminders.filter(item => item.at <= now);
  if (dueReminders.length) {
    // 到期后立即从持久化队列移除；电脑休眠后只补发近五分钟的提醒。
    scheduledReminders = scheduledReminders.filter(item => item.at > now);
    for (const reminder of dueReminders) {
      if (now - reminder.at <= 300000) sendNotification(reminder);
    }
    saveReminders();
  }
  const nextReminder = remindersByTriggerTime()[0];
  if (nextReminder) {
    const delay = Math.max(1, Math.min(nextReminder.at - Date.now(), MAX_DELAY));
    reminderTimer = setTimeout(scheduleNextReminder, delay);
  }
}

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function allowRequest(req, res) {
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.has(origin)) return false;
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return true;
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1258291) throw new Error('请求过大');
  }
  return JSON.parse(body || '{}');
}

function apiResult(res, code, data) {
  return json(res, code, code >= 400 ? { ok: false, error: data.error || String(data) } : { ok: true, data });
}

async function handleScheduleApi(req, res, requestUrl) {
  const route = requestUrl.pathname;
  if (!route.startsWith('/api/v1/')) return false;
  try {
    if (req.method === 'GET' && route === '/api/v1/schedules') {
      const startDate = requestUrl.searchParams.get('startDate') || undefined;
      const endDate = requestUrl.searchParams.get('endDate') || undefined;
      const expand = requestUrl.searchParams.get('expand') === 'true';
      let schedules = database.listSchedules({ startDate, endDate });
      if (expand) {
        if (!startDate || !endDate) throw new Error('展开重复日程时必须提供 startDate 和 endDate');
        schedules = schedules.flatMap(schedule => schedule.recurrence ? expandRecurringSchedule(schedule, startDate, endDate) : [schedule]);
      }
      apiResult(res, 200, { schedules }); return true;
    }
    if (req.method === 'POST' && route === '/api/v1/schedules/import') {
      const input = await readJson(req);
      if (database.getDataEpoch() !== '0' && input.epoch !== database.getDataEpoch()) throw new Error('浏览器缓存已过期，请刷新网页');
      const existing = database.listSchedules();
      const schedules = existing.length ? existing : database.importSchedules(input.schedules || []);
      eventBus.emit('schedule.imported', { count: schedules.length });
      apiResult(res, 200, { schedules, imported: !existing.length }); return true;
    }
    if (req.method === 'PUT' && route === '/api/v1/schedules') {
      const input = await readJson(req);
      if (input.epoch !== undefined && input.epoch !== database.getDataEpoch()) throw new Error('浏览器缓存已过期，请刷新网页');
      const schedules = database.replaceSchedules(input.schedules || []);
      eventBus.emit('schedule.replaced', { count: schedules.length });
      apiResult(res, 200, { schedules }); return true;
    }
    if (req.method === 'POST' && route === '/api/v1/schedules') {
      const item = database.saveSchedule(await readJson(req));
      eventBus.emit('schedule.created', item);
      apiResult(res, 201, item); return true;
    }
    const scheduleMatch = route.match(/^\/api\/v1\/schedules\/([^/]+)$/);
    if (scheduleMatch) {
      const id = decodeURIComponent(scheduleMatch[1]);
      if (req.method === 'GET') {
        const item = database.getSchedule(id);
        apiResult(res, item ? 200 : 404, item || { error: '日程不存在' }); return true;
      }
      if (req.method === 'PUT' || req.method === 'PATCH') {
        const current = database.getSchedule(id);
        if (!current) { apiResult(res, 404, { error: '日程不存在' }); return true; }
        const item = database.saveSchedule({ ...current, ...await readJson(req), id });
        eventBus.emit('schedule.updated', item);
        apiResult(res, 200, item); return true;
      }
      if (req.method === 'DELETE') {
        const removed = database.deleteSchedule(id);
        if (removed) eventBus.emit('schedule.deleted', { id });
        apiResult(res, removed ? 200 : 404, removed ? { id, removed: true } : { error: '日程不存在' }); return true;
      }
    }
    if (req.method === 'GET' && route === '/api/v1/plugins') {
      apiResult(res, 200, { plugins: pluginManager.list() }); return true;
    }
    if (req.method === 'GET' && route === '/api/v1/settings') {
      apiResult(res, 200, publicSettings()); return true;
    }
    if (req.method === 'PATCH' && route === '/api/v1/settings') {
      apiResult(res, 200, updateSettings(await readJson(req))); return true;
    }
    if (req.method === 'GET' && route === '/api/v1/reminders') {
      apiResult(res, 200, { reminders: remindersByTriggerTime() }); return true;
    }
    if (req.method === 'GET' && route === '/api/v1/data/status') {
      apiResult(res, 200, { epoch: database.getDataEpoch() }); return true;
    }
    if (req.method === 'POST' && route === '/api/v1/data/clear') {
      const input = await readJson(req);
      if (input.confirm !== '清空所有数据') throw new Error('需要明确确认清空所有数据');
      const epoch = database.clearAllData();
      scheduledReminders = [];
      suppressWindowStateWrites = true;
      settings = { ...defaultSettings, window: { ...defaultSettings.window } };
      saveReminders(); saveSettings(); scheduleNextReminder();
      await pluginManager.loadAll();
      eventBus.emit('data.cleared', { epoch });
      apiResult(res, 200, { epoch }); return true;
    }
    const pluginStateMatch = route.match(/^\/api\/v1\/plugins\/([a-z][a-z0-9-]{1,63})\/state$/);
    if (req.method === 'PATCH' && pluginStateMatch) {
      const input = await readJson(req);
      const plugins = await pluginManager.setEnabled(pluginStateMatch[1], input.enabled);
      if (input.enabled) componentRegistry.activatePluginDefaults(pluginStateMatch[1]);
      apiResult(res, 200, { plugins }); return true;
    }
    if (req.method === 'GET' && route === '/api/v1/components') {
      apiResult(res, 200, componentRegistry.list()); return true;
    }
    const builtinMatch = route.match(/^\/api\/v1\/components\/builtin\/([a-z][a-z0-9.-]+)$/);
    if (req.method === 'PATCH' && builtinMatch) {
      apiResult(res, 200, componentRegistry.updateBuiltin(builtinMatch[1], await readJson(req))); return true;
    }
    const extensionMatch = route.match(/^\/api\/v1\/components\/extension\/([a-z][a-z0-9-]{1,63}:[a-z][a-z0-9-]{1,63})$/);
    if (req.method === 'PATCH' && extensionMatch) {
      const input = await readJson(req);
      apiResult(res, 200, componentRegistry.updateExtension(extensionMatch[1], input.enabled)); return true;
    }
    const assetMatch = route.match(/^\/api\/v1\/components\/assets\/([a-z][a-z0-9-]{1,63})\/([a-z][a-z0-9-]{1,63})\/(html|css|module)$/);
    if (req.method === 'GET' && assetMatch) {
      const file = pluginManager.getUiAsset(assetMatch[1], assetMatch[2], assetMatch[3]);
      if (!file) { apiResult(res, 404, { error: '组件资源不存在' }); return true; }
      const contentType = assetMatch[3] === 'module' ? 'text/javascript' : assetMatch[3] === 'css' ? 'text/css' : 'text/html';
      res.writeHead(200, { 'Content-Type': `${contentType}; charset=utf-8`, 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(file));
      return true;
    }
    const pluginMatch = route.match(/^\/api\/v1\/plugins\/([a-z][a-z0-9-]{1,63})(?:\/(.*))?$/);
    if (pluginMatch) {
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJson(req) : null;
      const result = await pluginManager.handleHttp(pluginMatch[1], req.method, pluginMatch[2] || '', {
        method: req.method, path: pluginMatch[2] || '', query: Object.fromEntries(requestUrl.searchParams), body,
      });
      if (result != null) { apiResult(res, 200, result); return true; }
    }
    apiResult(res, 404, { error: '未找到 API 接口' }); return true;
  } catch (error) {
    apiResult(res, 400, { error: error.message }); return true;
  }
}

const api = http.createServer(async (req, res) => {
  if (!allowRequest(req, res)) return json(res, 403, { error: '不允许此网页访问提醒服务' });
  const requestUrl = new URL(req.url, `http://127.0.0.1:${API_PORT}`);
  const route = requestUrl.pathname;
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  if (await handleScheduleApi(req, res, requestUrl)) return;
  if (req.method === 'GET' && route === '/health') return json(res, 200, {
    ok: true, build: SERVICE_BUILD, ownerSid: OWNER_SID, sessionId: SESSION_ID,
    tray: trayStatus, trayError, pending: scheduledReminders.length,
  });
  if (req.method === 'GET' && route === '/tray-menu') return json(res, 200, { tooltip: '本地日程提醒', items: trayMenu() });
  if (req.method === 'GET' && route === '/settings') return json(res, 200, publicSettings());
  if (req.method === 'GET' && route === '/planned-reminders') {
    const upcoming = remindersByTriggerTime()
      .map(({ key, title, notes, kind, at, deadline }) => ({ key, title, notes, kind, at, deadline }));
    return json(res, 200, { reminders: upcoming, now: Date.now() });
  }
  if (req.method === 'GET' && ['/planned', '/planned.css', '/planned.js', '/reminders-component.js', '/settings-component.js', '/components-page.js', '/components-page.css', '/components-runtime.js', '/tray.png'].includes(route)) {
    const file = route === '/planned' ? path.join(panelDirectory, 'index.html')
      : route === '/tray.png' ? iconPng
        : route === '/components-runtime.js' ? path.join(here, 'ui', 'components-runtime.js')
          : path.join(panelDirectory, route.slice(1));
    return fs.readFile(file, (error, body) => {
      if (error) return res.writeHead(404).end();
      const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'image/png';
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
      res.end(body);
    });
  }
  if (req.method !== 'POST') return json(res, 404, { error: '未找到接口' });
  if (route === '/tray-ready') { trayStatus = 'ready'; trayError = ''; return json(res, 200, { ok: true }); }
  if (route === '/open-planned' || route === '/open-main') { openMainWindow(); return json(res, 200, { ok: true }); }
  if (route === '/open-web') { openWeb(); return json(res, 200, { ok: true }); }
  if (route === '/quit') {
    quitting = true;
    json(res, 200, { ok: true });
    setTimeout(async () => { await shutdown(); process.exit(0); }, 100);
    return;
  }
  try {
    const input = await readJson(req);
    if (route === '/settings') return json(res, 200, updateSettings(input));
    if (route === '/import-settings') return json(res, 200, hasSavedSettings ? publicSettings() : updateSettings(input));
    if (route === '/window-state') {
      if (suppressWindowStateWrites) return json(res, 200, { ok: true, ignored: true });
      const state = input.window || {};
      const width = Math.round(Number(state.width));
      const height = Math.round(Number(state.height));
      const x = Math.round(Number(state.x));
      const y = Math.round(Number(state.y));
      if (![width, height, x, y].every(Number.isFinite) || width < 500 || width > 3000 || height < 380 || height > 2000 || Math.abs(x) > 10000 || Math.abs(y) > 10000) return json(res, 400, { error: '窗口位置无效' });
      settings.window = { x, y, width, height };
      saveSettings();
      return json(res, 200, { ok: true });
    }
    const clientId = String(input.clientId || '').slice(0, 120);
    if (!clientId) return json(res, 400, { error: '缺少客户端标识' });
    if (input.epoch !== undefined && input.epoch !== database.getDataEpoch()) return json(res, 409, { error: '浏览器缓存已过期，请刷新网页' });
    if (route === '/sync-reminders') {
      if (!Array.isArray(input.events) || input.events.length > 5000) return json(res, 400, { error: '日程格式无效' });
      replaceClientReminders(clientId, input.events);
      return json(res, 200, { ok: true });
    }
    if (route === '/add-reminder') {
      const retainedReminders = scheduledReminders.filter(item => !(item.clientId === clientId && item.eventId === input.event?.id));
      const incomingReminders = buildReminderJobs(clientId, input.event);
      scheduledReminders = retainedReminders.concat(incomingReminders);
      saveReminders(); scheduleNextReminder();
      return json(res, 200, { ok: true, jobs: incomingReminders.length });
    }
    if (route === '/remove-reminder') {
      scheduledReminders = scheduledReminders.filter(item => !(item.clientId === clientId && item.eventId === input.eventId));
      saveReminders(); scheduleNextReminder();
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: '未找到接口' });
  } catch (error) { return json(res, 400, { error: error.message }); }
});
api.listen(API_PORT, '127.0.0.1');

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const web = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, `http://127.0.0.1:${WEB_PORT}`).pathname);
  const target = path.resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!target.startsWith(`${dist}${path.sep}`)) return res.writeHead(403).end();
  fs.readFile(target, (error, body) => {
    if (error) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': `${mime[path.extname(target)] || 'application/octet-stream'}; charset=utf-8` });
    res.end(body);
  });
});
web.on('error', error => { if (error.code !== 'EADDRINUSE') console.error(error); });
web.listen(WEB_PORT, '127.0.0.1');

const windowLogPath = path.join(dataDirectory, 'window-actions.log');
const electronProcesses = new Set();
let trayProcess = null;

function logWindowAction(message) {
  try { fs.appendFileSync(windowLogPath, `${new Date().toISOString()} service ${message}\n`); } catch (_) { /* 日志失败不影响主服务。 */ }
}

function runWindowHelper(args, onExit) {
  logWindowAction(`launch ${args.join(' ')}`);
  const child = spawn('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'restore-window.ps1'), ...args,
  ], { stdio: 'ignore', windowsHide: true });
  child.on('spawn', () => logWindowAction(`helper pid=${child.pid}`));
  child.on('exit', code => {
    logWindowAction(`helper exit=${code}`);
    if (onExit) onExit();
  });
  child.on('error', error => {
    logWindowAction(`helper error=${error.message}`);
    if (onExit) onExit();
  });
}

function openWeb() {
  const url = `http://127.0.0.1:${WEB_PORT}/`;
  if (process.platform === 'win32') {
    runWindowHelper(['-Action', 'web', '-Url', url, '-Title', '日程 · 本地时间管理', '-MainTitle', '本地日程 · 提醒中心']);
    return;
  }
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(command, [url], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

function openMainWindow() {
  const electronExecutable = process.platform === 'win32'
    ? path.join(here, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(here, 'node_modules', '.bin', 'electron');
  if (!fs.existsSync(electronExecutable)) {
    logWindowAction(`electron missing at ${electronExecutable}`);
    return;
  }
  const electronWorkDirectory = path.join(os.tmpdir(), 'schedule-studio-electron-runtime');
  fs.mkdirSync(electronWorkDirectory, { recursive: true });
  const child = spawn(electronExecutable, ['--no-sandbox', here], {
    // Electron/Windows 输入框缓存有时会在工作目录创建乱码名路径，隔离到系统临时目录。
    cwd: electronWorkDirectory,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
    env: {
      ...process.env,
      SCHEDULE_MAIN_URL: `http://127.0.0.1:${API_PORT}/planned`,
      SCHEDULE_HEALTH_URL: `http://127.0.0.1:${API_PORT}/health`,
      SCHEDULE_WINDOW_STATE_URL: `http://127.0.0.1:${API_PORT}/window-state`,
      SCHEDULE_SETTINGS_PATH: settingsPath,
      SCHEDULE_OWNER_SID: OWNER_SID,
    },
  });
  electronProcesses.add(child);
  child.on('exit', () => electronProcesses.delete(child));
  child.stdout.on('data', data => logWindowAction(`electron stdout ${String(data).trim()}`));
  child.stderr.on('data', data => logWindowAction(`electron stderr ${String(data).trim()}`));
  logWindowAction(`electron launch pid=${child.pid || 0}`);
  child.on('error', error => logWindowAction(`electron error=${error.message}`));
  child.unref();
}

function trayMenu() {
  const upcoming = remindersByTriggerTime();
  const preview = upcoming.slice(0, 5).map((item, index) => ({
    id: `preview-${index}`, enabled: false,
    title: `${new Date(item.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })} · ${item.title.slice(0, 18)}`,
  }));
  return [
    { id: 'status', title: `本地日程 · ${upcoming.length} 项待提醒`, enabled: false },
    { separator: true },
    { id: 'main', title: '显示主界面' },
    { id: 'open', title: '打开日程网页' },
    { id: 'planned', title: '已规划提醒', tooltip: '在主界面显示提醒' },
    { id: 'upcoming', title: '接下来', items: preview.length ? preview : [{ id: 'empty', title: '暂无待提醒日程', enabled: false }] },
    { separator: true },
    { id: 'quit', title: '退出' },
  ];
}

function startWindowsTray(attempt = 0) {
  const nativeTray = path.join(here, 'native-tray.exe');
  const executable = fs.existsSync(nativeTray) ? nativeTray : 'powershell.exe';
  const args = fs.existsSync(nativeTray)
    ? ['--icon', iconIco, '--port', String(API_PORT)]
    : ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'tray-helper.ps1'), '-IconPath', iconIco, '-Port', String(API_PORT)];
  const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  trayProcess = child;
  child.stderr.on('data', data => { trayError = `${trayError}${data}`.slice(-2000); });
  child.on('error', error => { trayStatus = 'failed'; trayError = error.message; });
  child.on('exit', code => {
    if (quitting) return;
    trayStatus = 'failed';
    trayError = trayError || `Windows 托盘组件退出，代码 ${code}`;
    if (attempt < 2) setTimeout(() => startWindowsTray(attempt + 1), 1500);
  });
}

if (process.env.SCHEDULE_TRAY_DISABLED !== '1' && process.platform === 'win32') {
  startWindowsTray();
} else if (process.env.SCHEDULE_TRAY_DISABLED !== '1') {
  const { Tray } = await import('@trayjs/trayjs');
  const tray = new Tray({
    tooltip: '本地日程提醒',
    icon: { png: iconPng, ico: iconIco },
    onMenuRequested: trayMenu,
    onClicked: id => { if (id === 'open') openWeb(); if (id === 'planned' || id === 'main') openMainWindow(); if (id === 'quit') process.exit(0); },
  });
  tray.on('ready', () => {
    trayStatus = 'ready';
    tray.setMenu(trayMenu());
  });
  tray.on('close', code => {
    trayStatus = 'closed';
    console.error(`托盘组件已退出：${code}`);
    process.exit(code || 1);
  });
}
refreshDatabaseReminders();
await pluginManager.loadAll();
pluginManager.watch();

async function shutdown() {
  quitting = true;
  clearTimeout(reminderTimer);
  // 服务切换登录身份或版本时同步结束自己启动的桌面进程，避免旧实例持有单实例锁。
  trayProcess?.kill();
  for (const child of electronProcesses) child.kill();
  await pluginManager.close();
  database.close();
}
process.once('SIGINT', async () => { await shutdown(); process.exit(0); });
process.once('SIGTERM', async () => { await shutdown(); process.exit(0); });

console.log(`日程提醒服务已启动：http://127.0.0.1:${API_PORT}`);
