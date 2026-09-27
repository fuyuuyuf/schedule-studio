const fs = require('node:fs');
const path = require('node:path');

const serviceDirectory = __dirname;
const dataDirectory = process.env.SCHEDULE_DATA_DIR || serviceDirectory;
fs.mkdirSync(dataDirectory, { recursive: true });
const logPath = path.join(dataDirectory, 'electron-window.log');
try { fs.appendFileSync(logPath, `${new Date().toISOString()} bootstrap pid=${process.pid}\n`); } catch (_) {}
const { app, BrowserWindow, screen, shell, session } = require('electron');
const settingsPath = process.env.SCHEDULE_SETTINGS_PATH || path.join(dataDirectory, 'settings.json');
const mainUrl = process.env.SCHEDULE_MAIN_URL || 'http://127.0.0.1:3456/planned';
const healthUrl = process.env.SCHEDULE_HEALTH_URL || 'http://127.0.0.1:3456/health';
const windowStateUrl = process.env.SCHEDULE_WINDOW_STATE_URL || 'http://127.0.0.1:3456/window-state';
const iconPath = path.join(serviceDirectory, 'assets', 'tray.ico');
const localPanelPath = path.join(serviceDirectory, 'panel', 'index.html');
function log(message) {
  try { fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`); } catch (_) { /* 日志失败不阻断窗口。 */ }
}

app.setName('本地日程');
const ownerIdentity = (process.env.SCHEDULE_OWNER_SID || 'local').replace(/[^a-zA-Z0-9-]/g, '');
const userDataDirectory = path.join(dataDirectory, '.electron-data', ownerIdentity);
fs.mkdirSync(userDataDirectory, { recursive: true });
app.setPath('userData', userDataDirectory);
log(`owner sid=${ownerIdentity} userData=${userDataDirectory}`);
// Windows 拼写检查曾在服务目录生成乱码名的空缓存目录；本软件的输入框不需要系统拼写检查。
app.whenReady().then(() => session.defaultSession.setSpellCheckerEnabled(false));
// 黑屏环境下禁用硬件加速；不强制 GPU 与渲染器同进程，以免页面已加载却无法绘制。
app.disableHardwareAcceleration();
const hasLock = app.requestSingleInstanceLock();
let mainWindow = null;
let saveTimer = null;
let healthFailures = 0;
let pageLoaded = false;

function readSavedBounds() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const value = saved.window || {};
    const bounds = {
      x: Math.round(Number(value.x)), y: Math.round(Number(value.y)),
      width: Math.round(Number(value.width)), height: Math.round(Number(value.height)),
    };
    if ([bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
      && bounds.width >= 500 && bounds.height >= 380) return bounds;
  } catch (_) { /* 首次打开使用默认大小。 */ }
  return { width: 850, height: 640 };
}

function visibleBounds(saved) {
  const width = Math.max(500, Math.min(saved.width, 3000));
  const height = Math.max(380, Math.min(saved.height, 2000));
  if (!Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return { width, height };
  const sufficientlyVisible = screen.getAllDisplays().some(({ workArea: area }) => {
    const overlapWidth = Math.max(0, Math.min(saved.x + width, area.x + area.width) - Math.max(saved.x, area.x));
    const overlapHeight = Math.max(0, Math.min(saved.y + height, area.y + area.height) - Math.max(saved.y, area.y));
    return overlapWidth >= 120 && overlapHeight >= 80;
  });
  if (sufficientlyVisible) return { x: saved.x, y: saved.y, width, height };
  const area = screen.getPrimaryDisplay().workArea;
  const safeWidth = Math.min(width, area.width);
  const safeHeight = Math.min(height, area.height);
  return {
    x: area.x + Math.round((area.width - safeWidth) / 2),
    y: area.y + Math.round((area.height - safeHeight) / 2),
    width: safeWidth, height: safeHeight,
  };
}

function saveBounds() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized() || mainWindow.isMaximized()) return;
  const bounds = mainWindow.getNormalBounds();
  log(`save bounds=${JSON.stringify(bounds)}`);
  fetch(windowStateUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ window: bounds }),
  }).catch(() => {});
}

function scheduleBoundsSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveBounds, 250);
}

function bringToFront() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.focus();
  log('show and focus');
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setAlwaysOnTop(false);
    mainWindow.focus();
  }, 180);
}

async function loadMainPage(attempt = 1) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    await mainWindow.loadURL(mainUrl);
    pageLoaded = true;
    log(`load main panel success attempt=${attempt}`);
    bringToFront();
  } catch (error) {
    log(`load failed attempt=${attempt} error=${error.message}`);
    if (attempt >= 12) return;
    setTimeout(() => loadMainPage(attempt + 1), Math.min(1500, attempt * 200));
  }
}

function createWindow() {
  const bounds = visibleBounds(readSavedBounds());
  log(`create bounds=${JSON.stringify(bounds)}`);
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 500,
    minHeight: 380,
    title: '本地日程 · 提醒中心',
    icon: iconPath,
    backgroundColor: '#fdf6e3',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      spellcheck: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      shell.openExternal(url).then(() => {
        log(`external browser opened url=${url}`);
        if (url === 'http://127.0.0.1:4173/' && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.minimize();
        }
      }).catch(error => log(`external browser failed=${error.message}`));
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    pageLoaded = false;
    log(`did-fail-load code=${code} description=${description} url=${url}`);
  });
  mainWindow.webContents.on('did-finish-load', async () => {
    pageLoaded = true;
    try {
      const state = await mainWindow.webContents.executeJavaScript('({ title: document.title, bodyLength: document.body?.innerText.length || 0, readyState: document.readyState })');
      log(`renderer ready=${JSON.stringify(state)}`);
    } catch (error) { log(`renderer inspection failed=${error.message}`); }
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => log(`render-process-gone reason=${details.reason} code=${details.exitCode}`));
  mainWindow.webContents.on('unresponsive', () => log('renderer unresponsive'));
  mainWindow.webContents.on('console-message', (details) => {
    if (details.level === 'error' || details.level === 'warning') {
      log(`renderer console level=${details.level} message=${details.message} source=${details.sourceId}:${details.lineNumber}`);
    }
  });
  mainWindow.once('ready-to-show', bringToFront);
  mainWindow.on('move', scheduleBoundsSave);
  mainWindow.on('resize', scheduleBoundsSave);
  mainWindow.on('close', saveBounds);
  mainWindow.on('closed', () => { mainWindow = null; });
  loadMainPage();
}

if (!hasLock) {
  log('secondary instance; notifying primary');
  app.quit();
} else {
  log('primary instance acquired');
  app.on('second-instance', () => {
    log('second-instance event');
    if (!pageLoaded) loadMainPage();
    bringToFront();
  });
  app.whenReady().then(() => {
    createWindow();
    setInterval(async () => {
      try {
        const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1500) });
        if (!response.ok) throw new Error('服务不可用');
        healthFailures = 0;
      } catch (_) {
        healthFailures += 1;
        if (healthFailures >= 3) {
          log('service unavailable; quitting');
          app.quit();
        }
      }
    }, 5000);
  });
  app.on('activate', () => {
    if (mainWindow) bringToFront();
    else createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}

process.on('uncaughtException', error => log(`uncaught=${error.stack || error.message}`));
process.on('unhandledRejection', error => log(`rejection=${error?.stack || error}`));
