# 本地日程
## n轮对话的结果，调整了一个我相当满意的本地日程管理。比较好的地方是采用组件式的结构，对应ai后续增删功能比较容易，不容易互相影响。也可以直接把readme喂给ai让他生成插件或修改后的默认组件。
主题采用的是obsidian的主题，可以直接替换
#附带插件
- 贴纸插件
- 关键信息日历
## Windows 安装包

下载 GitHub Releases 中的 `ScheduleStudio-Setup-v1.0.0.exe` 后运行，可自选安装目录。核心程序和 Node.js 运行时都包含在安装包内，不需要单独执行 `npm install`。安装向导中的额外插件默认不勾选；勾选后会从同一 Release 下载对应 ZIP，并用安装包内固定的 SHA-256 校验。离线时可只安装核心程序。安装后可从开始菜单或安装目录的 `打开日程.exe` 启动。

安装版的日程数据库、设置和日志位于 `%LOCALAPPDATA%\ScheduleStudio`，与可选安装目录分开；安装或升级不会把本机日程上传到 GitHub。现有源码目录中的 `service/*.sqlite` 不会自动迁移到安装版，请先备份再使用安装版。贴纸组件的用户图片也保存在该数据目录的 `stickers` 下。

开发者在 Windows 上运行 `build/build-installer.ps1` 可重建安装包。脚本输出 `build/release/ScheduleStudio-Setup-v1.0.0.exe` 和四个可选插件 ZIP；发布时必须把这五个文件上传到 `v1.0.0` Release，且不要改名，因为安装器使用固定的版本地址和构建时的文件哈希。仓库中的 Windows CI 工作流会在 `build/release-version.txt` 变更时构建并上传这五个 Release 附件，也可手动运行。`build/work` 是临时构建目录，不应提交到仓库。运行安装包的 `--verify` 参数可检查内置压缩资源。

首次使用先在 `service` 目录运行 `npm install`。之后请从 Windows 资源管理器双击 `打开日程.exe`：它会静默启动托盘程序并打开软件主界面。`打开日程.bat` 仍作为排错备用入口；启动器源码和可重复构建脚本位于 `service/launcher` 与 `service/build-launcher.ps1`。不要从 Codex 终端启动托盘，否则图标会注册到隔离桌面而无法在任务栏看到。启动入口会核对服务版本、Windows 用户 SID 和桌面会话，发现旧版或其他身份的服务时先正常退出再启动；Electron 的单实例数据也按 SID 隔离。若启动失败，先查看 `service/startup.log`，再查看 `service/service.stderr.log` 和 `service/electron-window.log`。`service/start-tray.ps1` 必须保留 UTF-8 BOM，以兼容 Windows PowerShell 5.1 对中文注释的解析。

软件主界面是独立的 Electron 桌面窗口，以“已规划提醒”为首页，显示提醒时间、日程名称、备注和截止时间，每 15 秒自动刷新。左侧边栏可打开日程网页、点击太阳/月亮图标切换深浅色、查看提醒、进入设置、收起侧栏或隐藏窗口。点击“打开日程网页”时由主界面直接请求浏览器，并收起主界面以显示网页；使用软件渲染避免特定显卡环境下窗口黑屏。关闭或隐藏主界面不会退出托盘提醒；托盘图标双击可重新显示主界面。右键菜单有圆角纯色背景，并提供“显示主界面”“已规划提醒”“打开日程网页”和“退出”；菜单在联网刷新前就有备用项，右键时不等待网络请求。

主题 CSS/文件夹、浅暗色或跟随系统、日期滚轮方向等设置现位于软件主界面的“设置”页，不再位于日程网页。设置与主界面上次的位置和大小保存在 `service/settings.json`。Electron 使用单实例锁：已有主界面时直接恢复并置前，否则按保存坐标创建窗口；坐标仍有一部分位于现有屏幕时会原样恢复，仅在显示器已移除时回到主屏中央。窗口过程记录在 `service/electron-window.log`。打开网页时也会把浏览器置前。网页会同步读取外观和滚轮设置。托盘图标由 `tubiao.png` 缩小制作，内外边缘均裁成正圆，并增加等宽白边。启动脚本会为当前用户注册 `schedule-studio://` 本机入口，因此网页右下角的电脑图标可在软件未运行时唤起它；首次使用该图标前须至少从资源管理器运行一次 `打开日程.bat`，浏览器可能弹出外部应用确认。

日程的正式数据源是 `service/schedule-studio.sqlite`。首次打开新版网页时，会把当前网址本地存储中的旧日程导入空数据库；数据库已有内容时不会用浏览器旧副本覆盖。`service/reminders.json` 与 `service/settings.json` 暂时保留为兼容备份。主界面“打开日程网页”会打开 `http://127.0.0.1:4173/`。

- `Tab`：在待机页与连续时间轴之间切换
- 待机时钟冒号随真实秒数每秒亮灭一次
- 切换时待机页向上淡出，返回时向下淡入；开启系统减少动态效果时会跳过动画
- 日期栏上的滚轮：上滚到更晚日期，下滚到更早日期；不限月份，页面仅保留中心日期及左右各 27 天
- 右键日期标题：可选择删除当天日程；跨天日程保留其他日期的部分
- 编辑即时预览，保存后写入本地；取消或 `Esc` 恢复原数据
- 详细页默认编辑模式；可切换标注模式，阅读模式已移除。鼠标停留在有备注的日程上 1 秒会显示备注预览
- 已过期日程使用偏灰配色；跨天日程在整个区间结束后变灰
- 起止日期定义连续跨天区间，可跨月、跨年；时间轴用一条横向矩形覆盖日期跨度
- 时间选择器：鼠标悬停小时或分钟，滚轮上下选择并显示滚动动画
- 左键拖动：可跨多个日期列选择连续时间段，松开后打开编辑器
- 编辑器打开后点击中间时间轴：取消此次编辑，不触发新的拖选
- 编辑器中按 `Ctrl+S`：保存当前日程，并拦截浏览器的“保存网页”动作
- 左侧编辑器直接填写开始日期和结束日期，支持持续多天
- 右键空白处：快速新建一小时日程
- 单击或双击日程块：打开编辑器
- `Esc`：关闭编辑器
- 编辑模式中按住鼠标中键拖动时间轴，可横向、纵向移动；打开编辑器后拖动日程矩形右下角，可调整结束日期和时间
- 编辑器可开启提醒：单日日程设置提前时间；跨天日程可额外设置提前天数。提前时间的提醒只在最后一天触发
- 网页开启时，提醒会在右下角显示 3 秒，也可点击关闭；托盘服务开启时，网页关闭后仍会发送系统通知

提醒和日程保存在 SQLite 中，同时写入 `service/reminders.json` 兼容备份。本地服务仅监听 `127.0.0.1:3456`，按最近提醒动态安排下一次检查；提醒触发后会立即清除。后台 Node 服务使用 64 MB V8 堆上限，Electron 仅在主界面打开期间运行。操作系统通知的实际停留时间由系统设置决定。

数据不会上传到网络。浏览器本地存储只是离线兼容副本，清除站点数据不会删除 SQLite 中的正式日程。

## 运行要求与故障日志

- Node.js 22.16 或更高版本；推荐项目当前使用的 Node.js 24。SQLite 使用 Node 自带的 `node:sqlite`，无需额外安装数据库程序。
- `service/startup.log`：启动器每一步和失败原因。
- `service/service.stderr.log`：Node 服务启动异常的完整错误。
- `service/service.stdout.log`：服务正常输出和插件日志。
- `service/electron-window.log`：主界面单实例、位置恢复与置前记录。

启动器会检查服务构建号，关闭旧服务后再启动新版本。Node 子进程的 PID、退出码和标准错误都会记录，避免只出现无法定位的“启动超时”。原生托盘源码在 `service/native-tray/Program.cs`，运行 `npm run build:tray` 可重新生成 `service/native-tray.exe`；若该文件缺失才会回退到 `tray-helper.ps1`。

部分 Windows 图形环境无法启动 Chromium 独立 GPU 进程（退出码 `0xC0000135`），这正是本次“服务存在但主界面空白/不出现”的原因。主界面现强制使用 Electron 自带的软件渲染器，并关闭只承载本机可信页面的 Chromium 沙箱；外部网页仍由系统浏览器打开，不会在主界面中加载。Electron 标准错误会写入 `service/window-actions.log`，主页面加载失败会自动重试。

## 数据结构与重复规则

日程对象的公共结构如下。日期固定为本地日期 `YYYY-MM-DD`，时间是从当天 00:00 开始的分钟数，允许结束时间为 `1440`。

```json
{
  "id": "UUID 或外部系统的稳定唯一标识",
  "title": "日程名称",
  "startDate": "2026-09-26",
  "endDate": "2026-09-26",
  "start": 600,
  "end": 660,
  "color": "#2aa198",
  "notes": "支持 Markdown",
  "marked": false,
  "reminder": { "enabled": true, "minutesBefore": 10, "daysBefore": 0 },
  "recurrence": {
    "frequency": "weekly",
    "interval": 1,
    "weekdays": [1, 3, 5],
    "until": "2026-12-31",
    "count": null,
    "exclusions": ["2026-10-02"]
  }
}
```

`frequency` 可为 `daily`、`weekly`、`monthly`、`yearly`。星期使用 1=周一至 7=周日。`until`、`count` 可以为 `null`，表示不按该条件结束。`exclusions` 用于跳过个别发生日期。跨天日程重复时，每个实例保持原来的持续天数；编辑界面当前按整个系列修改。

## 本机日程 API

基础地址为 `http://127.0.0.1:3456/api/v1`。所有成功响应为 `{"ok":true,"data":...}`，失败响应为 `{"ok":false,"error":"..."}`。服务仅绑定环回地址，但任何本机程序都可以调用；插件或外部自动化必须自行保留稳定 `id`。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/schedules` | 列出日程；可带 `startDate`、`endDate` |
| `GET` | `/schedules?startDate=...&endDate=...&expand=true` | 在窗口内展开重复日程，返回 `seriesId`、`occurrenceDate` |
| `POST` | `/schedules` | 创建日程，正文为日程对象 |
| `GET` | `/schedules/{id}` | 读取单个系列 |
| `PUT` / `PATCH` | `/schedules/{id}` | 完整替换或局部更新日程 |
| `DELETE` | `/schedules/{id}` | 删除日程系列 |
| `PUT` | `/schedules` | 用 `{"schedules": [...]}` 原子替换全部日程 |
| `POST` | `/schedules/import` | 仅在数据库为空时导入 `{"schedules": [...]}` |
| `GET` | `/plugins` | 查看插件加载状态、版本和错误 |
| `GET` / `PATCH` | `/settings` | 读取或局部更新软件外观、主题等设置 |
| `GET` | `/reminders` | 查看未触发的提醒队列 |
| `GET` | `/data/status` | 查看数据版本 `epoch`，供网页识别清空后的旧缓存 |
| `POST` | `/data/clear` | 正文必须为 `{"confirm":"清空所有数据"}`；不可撤销 |
| `PATCH` | `/plugins/{id}/state` | `{"enabled":true/false}`，启停插件并持久化状态 |
| `GET` | `/components` | 列出内置插槽、当前替换组件与已加载的扩展组件 |
| `PATCH` | `/components/builtin/{id}` | 设置可选组件的 `enabled` 或设置 `replacement` |
| `PATCH` | `/components/extension/{插件id}:{组件id}` | 设置扩展组件的 `enabled` |
| `GET` | `/components/assets/{插件id}/{组件id}/{html|css|module}` | 读取已启用插件声明的 UI 资源 |

示例：

```powershell
$body = @{ title='外部创建'; startDate='2026-09-28'; endDate='2026-09-28'; start=540; end=600 } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:3456/api/v1/schedules -Method Post -ContentType application/json -Body $body
```

对数据库的创建、修改、删除和批量导入都会发出内部事件，并自动重算提醒。插件注册的路由固定在 `/api/v1/plugins/{插件 id}/{插件路由}`，不会覆盖核心接口。

## 插件开发指南

插件放在项目根目录 `mod` 下，一个插件一个文件夹。服务启动时自动扫描，并监视文件变化后重新加载。插件是可信的本机 JavaScript，不是安全沙箱；不要安装来源不明的插件。`mod/example-plugin` 是默认关闭的完整模板。

最小目录：

```text
mod/
  my-plugin/
    manifest.json
    index.mjs
```

`manifest.json` 必须是合法 JSON：

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "apiVersion": "1",
  "description": "一句话说明",
  "main": "index.mjs",
  "enabled": true,
  "permissions": ["schedules:read", "schedules:write", "events:subscribe", "storage", "http:route"]
}
```

清单规则：

- `id` 必须匹配 `^[a-z][a-z0-9-]{1,63}$`，并且在所有插件中唯一。
- `apiVersion` 当前只能是字符串 `"1"`。
- `main` 必须位于插件自己的目录内，默认 `index.mjs`，禁止 `../` 越界。
- `enabled: false` 会默认停用插件；“组件”页面的启停状态持久保存在 SQLite，不改写插件源码。
- 权限只能从 `schedules:read`、`schedules:write`、`settings:read`、`settings:write`、`reminders:read`、`events:subscribe`、`events:emit`、`storage`、`http:route`、`ui:components` 中选择；未声明就无法调用对应能力。

入口必须导出 `activate(context)` 或默认函数，可以返回清理函数；也可以额外导出 `deactivate()`。热重载和服务退出时会按逆序调用清理函数。

```js
export async function activate(context) {
  context.log.info('插件启动');

  const unsubscribe = context.events.on('schedule.created', schedule => {
    context.storage.set('lastScheduleId', schedule.id);
  });

  context.http.register('GET', 'status', request => ({
    ok: true,
    query: request.query,
    scheduleCount: context.schedules.list().length
  }));

  return () => unsubscribe();
}
```

### `context` 接口（插件 API v1）

- `context.plugin`：只读的 `{ id, name, version }`。
- `context.log.info/warn/error(...values)`：写入带插件 id 前缀的服务日志。
- `context.schedules.list({startDate?, endDate?})`：读取日程数组，需要 `schedules:read`。
- `context.schedules.get(id)`：按 id 读取，找不到返回 `null`。
- `context.schedules.create(schedule)`：创建并返回规范化对象，需要 `schedules:write`。
- `context.schedules.update(id, patch)`：更新并返回对象；它会触发 `schedule.updated`。
- `context.schedules.remove(id)`：删除系列并返回布尔值。
- `context.settings.get()` / `update(change)`：读取、更新软件设置，分别需要 `settings:read`、`settings:write`。
- `context.reminders.list()`：读取待触发提醒，需 `reminders:read`。
- `context.events.on(name, listener)`：订阅事件并返回取消函数，需要 `events:subscribe`。
- `context.events.emit(name, payload)`：只能发送 `plugin.{自己的 id}.*` 事件，需要 `events:emit`。
- `context.storage.get(key, fallback)` / `set(key, value)`：插件私有 JSON 存储，需要 `storage`。
- `context.http.register(method, route, handler)`：注册插件路由，需要 `http:route`。`handler` 收到 `{method,path,query,body}`，返回可 JSON 序列化的数据。

核心事件：`schedule.created`、`schedule.updated`、`schedule.deleted`、`schedule.replaced`、`schedule.imported`、`settings.updated`、`component.changed`、`plugin.loaded`、`plugin.stateChanged`。事件数据会复制后再交给监听器，插件不应依赖修改事件对象来改变核心状态。

给后续 AI 的插件生成检查表：先确定所需最少权限；生成上述两个文件；所有日期使用 `YYYY-MM-DD`，时间使用分钟数；不要直接读取 SQLite 或修改 `service` 文件；持久化数据只用 `context.storage`；日程变更只用 `context.schedules`；后台监听、定时器和文件监视器必须在返回的清理函数中关闭。完成后访问 `/api/v1/plugins` 确认 `status` 为 `active`，再测试插件专属路由。

## 组件与界面替换

软件侧栏中“设置”上方的扳手图标打开“组件”页。侧栏导航使用流式容器，新增页签可以通过 `window.ScheduleStudioRegisterPage(name, title, button, panel)` 注册，不必修改其它按钮的坐标。内置组件默认折叠，仅在点开“显示内置组件”时列出；它们仍在界面中正常运行。额外组件会显示可替换的内置区域。启用替换组件会自动取代内置组件；同一枚举类型只能有一个启用的替换组件，其他候选项会变灰，需要先停用当前项。额外插件也可整包启停。修改后软件窗口自动重载；已经打开的日程网页需要刷新才能加载新组件。

内置插槽：

| 组件枚举 `kind` | 插槽 ID | 内置区域 |
| --- | --- | --- |
| `DESKTOP_SIDEBAR` | `desktop.sidebar` | 软件左侧导航 |
| `DESKTOP_REMINDERS` | `desktop.reminders` | 提醒列表 |
| `DESKTOP_COMPONENTS` | `desktop.components` | 组件管理 |
| `DESKTOP_SETTINGS` | `desktop.settings` | 设置 |
| `WEB_STANDBY` | `web.standby` | 网页待机页 |
| `WEB_TIMELINE` | `web.timeline` | 日程时间轴 |
| `WEB_EDITOR` | `web.editor` | 日程编辑器 |
| `WEB_STICKY_WALL` | `web.sticky-wall` | 便签墙，可关闭 |

每个插件最多声明 20 个 UI 组件，完整可运行示例见 `mod/example-ui-component`。纯 UI 插件无需 `main` 或 `index.mjs`；如需后台能力，照上一节导出 `activate(context)`。清单增加 `ui:components` 权限和 `uiComponents`：

```json
{
  "id": "my-reminder-ui",
  "name": "我的提醒界面",
  "version": "1.0.0",
  "apiVersion": "1",
  "permissions": ["ui:components"],
  "uiComponents": [{
    "id": "reminder-view",
    "name": "自定义提醒列表",
    "surface": "desktop",
    "kind": "DESKTOP_REMINDERS",
    "mode": "replace",
    "html": "ui/reminder.html",
    "css": "ui/reminder.css",
    "module": "ui/reminder.js"
  }]
}
```

`kind` 必须是上表的枚举值；`surface` 必须与其匹配：`desktop` 或 `web`。旧插件的 `slot` 仍可使用，服务会自动映射到枚举；新插件建议直接使用 `kind`，也接受同值的 `replaces`。`mode` 为 `replace`（启用时自动替换内置区域）或 `append`（追加到内置区域，启用即显示）。一个类型只能启用一个替换组件。`html/css/module` 可省略，但至少提供一个；替换模式应提供 HTML 或 JS 以免空白。文件路径必须留在插件目录内，扩展名分别为 `.html/.css/.js`，每个文件不超过 1 MB。模块导出 `mount(context)` 或默认函数：

设置页的“清空所有数据”需要再次确认。它清除 SQLite 中的日程、提醒、设置和插件状态，以及本地兼容缓存；网页会根据数据版本自动清掉便签、日期标记和旧日程缓存。`mod` 目录中的插件代码不会删除。此操作不可撤销，请先自行备份需要保留的日程。

```js
export function mount({ root, api, component, slot, surface }) {
  root.querySelector('button').addEventListener('click', async () => {
    const { schedules } = await api.schedules.list();
    console.log(schedules.length);
  });
  return () => { /* 页面卸载时清理监听器和定时器。 */ };
}
```

`root` 是组件专属容器，`component` 与 `slot` 为只读描述，`surface` 为当前界面。`api.schedules` 提供 `list/get/create/update/remove`；`list()` 返回 `{schedules}`，单项方法返回日程对象。`api.settings.get/update` 返回设置对象，`api.reminders.list()` 返回 `{reminders}`。`api.events.on(name, handler)` 与 `emit(name, detail)` 在当前网页内发出 `schedule-studio:{name}` 自定义事件。也可直接调用上表的本机 HTTP API。UI 文件会在用户浏览器/Electron 中执行，后台 `activate` 在 Node 服务中执行；两者不是安全沙箱，只安装可信插件。

现有软件内置页代码已拆成 `service/panel/reminders-component.js`、`settings-component.js`、`components-page.js`，导航壳在 `planned.js`；扩展加载与插槽装配在 `service/ui/components-runtime.js`，插槽定义在 `service/core/component-registry.mjs`。网页原有时间轴逻辑仍在 `dist/app.js`，但其外层插槽可以被替换或追加；开发复杂时间轴替代品时建议只依赖上述 API，不读取其内部全局变量。

### 待机页贴纸

随项目提供的 `mod/sticker-widget` 插件在待机页右键菜单的“创建组件 → 贴纸”中列出已有图片，选择后放置。新贴纸可拖动右下角调整大小；再次点击待机页空白处会完成创建并锁定尺寸，之后仍可拖动贴纸位置，右键贴纸可删除。软件主界面的“设置 → 组件设置”可打开贴纸目录，并切换白边。默认目录为 `mod/sticker-widget/texture`；支持 PNG、JPG、WebP 和 GIF，单张不超过 5 MB。`tubiao.png` 是随插件附带的示例贴纸。新增图片后重新打开贴纸列表即可选择。

已放置贴纸的位置保存在当前网页的本地存储中，白边选项保存在插件私有数据中。清空所有数据会移除已放置贴纸并重置白边选项，但保留 `texture` 目录中的图片。

## 开发校验

在 `service` 目录运行：

```powershell
npm run check
npm test
npm run build:tray
```

核心测试使用临时 SQLite 数据库，覆盖日程 CRUD、重复展开、插件加载、插件私有存储和插件 HTTP 路由，不会改动正式数据。
