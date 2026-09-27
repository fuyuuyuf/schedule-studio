using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Security.Principal;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace ScheduleStudio.NativeTray
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            string iconPath = ReadArgument(args, "--icon") ?? Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "assets", "tray.ico");
            int port;
            if (!int.TryParse(ReadArgument(args, "--port"), out port)) port = 3456;
            Application.Run(new TrayApplicationContext(iconPath, port));
        }

        private static string ReadArgument(string[] args, string name)
        {
            for (int index = 0; index < args.Length - 1; index++) if (args[index] == name) return args[index + 1];
            return null;
        }
    }

    internal sealed class TrayApplicationContext : ApplicationContext
    {
        private readonly NotifyIcon trayIcon;
        private readonly ContextMenuStrip menu;
        private readonly JavaScriptSerializer json = new JavaScriptSerializer();
        private readonly string baseUrl;
        private readonly Timer refreshTimer;

        public TrayApplicationContext(string iconPath, int port)
        {
            baseUrl = "http://127.0.0.1:" + port;
            menu = new RoundedMenu();
            menu.Renderer = new SolidMenuRenderer();
            // 菜单必须在右键前就有内容；Opening 事件不能等待网络请求。
            AddFallbackItems();
            menu.Opening += (sender, eventArgs) => { if (menu.Items.Count == 0) AddFallbackItems(); };
            trayIcon = new NotifyIcon
            {
                Icon = new Icon(iconPath),
                Text = "本地日程提醒",
                Visible = true,
                ContextMenuStrip = menu
            };
            trayIcon.DoubleClick += async (sender, eventArgs) => await PostAsync("/open-main");
            refreshTimer = new Timer { Interval = 30000 };
            refreshTimer.Tick += async (sender, eventArgs) => { await PingAsync(); await RefreshMenuAsync(); };
            refreshTimer.Start();
            NotifyReadyAsync();
        }

        private void AddFallbackItems()
        {
            menu.Items.Add(new ToolStripMenuItem("显示主界面", null, async (sender, eventArgs) => await ExecuteAsync("main")));
            menu.Items.Add(new ToolStripMenuItem("打开日程网页", null, async (sender, eventArgs) => await ExecuteAsync("open")));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(new ToolStripMenuItem("退出", null, async (sender, eventArgs) => await ExecuteAsync("quit")));
        }

        private async Task<string> GetAsync(string route)
        {
            // WebClient 不允许并发请求；每次调用独立实例，避免心跳占用菜单请求。
            using (var client = new WebClient { Encoding = Encoding.UTF8 })
                return await client.DownloadStringTaskAsync(baseUrl + route);
        }

        private async Task NotifyReadyAsync()
        {
            await PostAsync("/tray-ready");
            await RefreshMenuAsync();
        }

        private async Task PingAsync()
        {
            try
            {
                string payload = await GetAsync("/health");
                var health = json.DeserializeObject(payload) as Dictionary<string, object>;
                string serviceSid = health != null ? GetString(health, "ownerSid") : "";
                string ownSid = WindowsIdentity.GetCurrent().User.Value;
                if (serviceSid != ownSid) ExitThread();
            }
            catch { ExitThread(); }
        }

        private async Task RefreshMenuAsync()
        {
            try
            {
                string payload = await GetAsync("/tray-menu");
                var root = json.DeserializeObject(payload) as Dictionary<string, object>;
                var items = root != null && root.ContainsKey("items") ? root["items"] as ArrayList : null;
                if (items == null || menu.Visible) return;
                menu.SuspendLayout();
                menu.Items.Clear();
                AddItems(menu.Items, items);
                menu.ResumeLayout();
            }
            catch { /* 服务重启期间保留上一次菜单。 */ }
        }

        private void AddItems(ToolStripItemCollection target, ArrayList definitions)
        {
            foreach (object value in definitions)
            {
                var definition = value as Dictionary<string, object>;
                if (definition == null) continue;
                if (GetBoolean(definition, "separator", false)) { target.Add(new ToolStripSeparator()); continue; }
                string id = GetString(definition, "id");
                var item = new ToolStripMenuItem(GetString(definition, "title"))
                {
                    Enabled = GetBoolean(definition, "enabled", true),
                    AutoSize = true,
                    Padding = new Padding(10, 5, 10, 5),
                    Tag = id
                };
                var children = definition.ContainsKey("items") ? definition["items"] as ArrayList : null;
                if (children != null) AddItems(item.DropDownItems, children);
                else item.Click += async (sender, eventArgs) => await ExecuteAsync(id);
                target.Add(item);
            }
        }

        private async Task ExecuteAsync(string id)
        {
            if (id == "quit") { await PostAsync("/quit"); ExitThread(); return; }
            if (id == "open") await PostAsync("/open-web");
            else if (id == "main" || id == "planned") await PostAsync("/open-main");
        }

        private async Task PostAsync(string route)
        {
            try
            {
                using (var client = new WebClient { Encoding = Encoding.UTF8 })
                    await client.UploadStringTaskAsync(baseUrl + route, "POST", "{}");
            }
            catch { }
        }

        protected override void ExitThreadCore()
        {
            refreshTimer.Stop();
            trayIcon.Visible = false;
            trayIcon.Dispose();
            menu.Dispose();
            base.ExitThreadCore();
        }

        private static string GetString(Dictionary<string, object> value, string key) { return value.ContainsKey(key) ? Convert.ToString(value[key]) : ""; }
        private static bool GetBoolean(Dictionary<string, object> value, string key, bool fallback) { return value.ContainsKey(key) ? Convert.ToBoolean(value[key]) : fallback; }
    }

    internal sealed class RoundedMenu : ContextMenuStrip
    {
        protected override void OnSizeChanged(EventArgs eventArgs)
        {
            base.OnSizeChanged(eventArgs);
            if (Width <= 0 || Height <= 0) return;
            using (var path = new GraphicsPath())
            {
                const int radius = 14;
                path.AddArc(0, 0, radius, radius, 180, 90);
                path.AddArc(Width - radius, 0, radius, radius, 270, 90);
                path.AddArc(Width - radius, Height - radius, radius, radius, 0, 90);
                path.AddArc(0, Height - radius, radius, radius, 90, 90);
                path.CloseFigure();
                Region = new Region(path);
            }
        }
    }

    internal sealed class SolidMenuRenderer : ToolStripProfessionalRenderer
    {
        public SolidMenuRenderer() : base(new MenuColors()) { RoundedEdges = false; }
    }

    internal sealed class MenuColors : ProfessionalColorTable
    {
        private readonly Color background = Color.FromArgb(253, 246, 227);
        public override Color ToolStripDropDownBackground { get { return background; } }
        public override Color ImageMarginGradientBegin { get { return background; } }
        public override Color ImageMarginGradientMiddle { get { return background; } }
        public override Color ImageMarginGradientEnd { get { return background; } }
        public override Color MenuItemSelected { get { return Color.FromArgb(238, 232, 213); } }
        public override Color MenuItemBorder { get { return Color.FromArgb(147, 161, 161); } }
        public override Color SeparatorDark { get { return Color.FromArgb(219, 213, 195); } }
        public override Color SeparatorLight { get { return background; } }
    }
}
