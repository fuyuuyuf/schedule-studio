using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;

[assembly: AssemblyTitle("本地日程安装向导")]
[assembly: AssemblyProduct("本地日程")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace ScheduleStudioInstaller
{
    internal sealed class PluginChoice
    {
        public string Id;
        public string Name;
        public CheckBox CheckBox;
    }

    internal sealed class InstallResult
    {
        public string Directory;
        public readonly List<string> Warnings = new List<string>();
    }

    internal sealed class InstallerForm : Form
    {
        private const string ReleaseTag = "v1.0.0";
        private const string ReleaseBase = "https://github.com/fuyuuyuf/schedule-studio/releases/download/" + ReleaseTag + "/";
        private readonly TextBox directoryBox = new TextBox();
        private readonly ProgressBar progress = new ProgressBar();
        private readonly Label status = new Label();
        private readonly Button installButton = new Button();
        private readonly Button browseButton = new Button();
        private readonly BackgroundWorker worker = new BackgroundWorker();
        private readonly List<PluginChoice> plugins = new List<PluginChoice>();
        private readonly Dictionary<string, string> pluginHashes = new Dictionary<string, string>();

        public InstallerForm()
        {
            Text = "本地日程 · 安装向导";
            ClientSize = new Size(610, 480);
            MinimumSize = new Size(580, 490);
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Microsoft YaHei UI", 9F);
            BackColor = Color.FromArgb(253, 246, 227);
            ForeColor = Color.FromArgb(7, 54, 66);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            BuildInterface();
            ReadPluginHashes();
            worker.WorkerReportsProgress = true;
            worker.DoWork += Install;
            worker.ProgressChanged += delegate(object sender, ProgressChangedEventArgs eventArgs)
            {
                progress.Value = Math.Max(0, Math.Min(100, eventArgs.ProgressPercentage));
                status.Text = String.Format("{0}% · {1}", progress.Value, eventArgs.UserState ?? "正在安装");
            };
            worker.RunWorkerCompleted += Finished;
        }

        private void BuildInterface()
        {
            Label heading = new Label { Text = "安装本地日程", Font = new Font(Font.FontFamily, 20F, FontStyle.Bold),
                Location = new Point(28, 24), AutoSize = true };
            Label explanation = new Label { Text = "核心程序离线安装；只在勾选额外插件时连接 GitHub 下载。",
                Location = new Point(31, 69), AutoSize = true, ForeColor = Color.FromArgb(88, 110, 117) };
            Label directoryLabel = new Label { Text = "安装目录", Location = new Point(30, 113), AutoSize = true };
            directoryBox.Location = new Point(30, 137);
            directoryBox.Size = new Size(465, 27);
            directoryBox.Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Schedule Studio");
            browseButton.Text = "浏览…";
            browseButton.Location = new Point(505, 136);
            browseButton.Size = new Size(78, 29);
            browseButton.Click += Browse;
            Label pluginLabel = new Label { Text = "额外插件（可选，需要联网下载）", Location = new Point(30, 190), AutoSize = true,
                Font = new Font(Font, FontStyle.Bold) };
            FlowLayoutPanel pluginPanel = new FlowLayoutPanel { Location = new Point(30, 218), Size = new Size(545, 132),
                FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true };
            AddPlugin(pluginPanel, "calendar-widget", "待机日历组件");
            AddPlugin(pluginPanel, "sticker-widget", "待机贴纸组件");
            AddPlugin(pluginPanel, "example-plugin", "插件开发示例（默认停用）");
            AddPlugin(pluginPanel, "example-ui-component", "提醒页替换示例（默认停用）");
            Label dataLabel = new Label { Text = "日程与设置保存在本机用户数据目录，不写入安装目录。",
                Location = new Point(30, 355), AutoSize = true, ForeColor = Color.FromArgb(88, 110, 117) };
            progress.Location = new Point(30, 382);
            progress.Size = new Size(550, 16);
            status.Location = new Point(30, 402);
            status.Size = new Size(550, 23);
            status.Text = "准备就绪";
            installButton.Text = "开始安装";
            installButton.Location = new Point(465, 430);
            installButton.Size = new Size(115, 33);
            installButton.BackColor = Color.FromArgb(42, 161, 152);
            installButton.ForeColor = Color.White;
            installButton.FlatStyle = FlatStyle.Flat;
            installButton.Click += BeginInstall;
            Controls.AddRange(new Control[] { heading, explanation, directoryLabel, directoryBox, browseButton,
                pluginLabel, pluginPanel, dataLabel, progress, status, installButton });
        }

        private void AddPlugin(Control parent, string id, string name)
        {
            CheckBox checkBox = new CheckBox { Text = name, Width = 515, Height = 25, Checked = false };
            parent.Controls.Add(checkBox);
            plugins.Add(new PluginChoice { Id = id, Name = name, CheckBox = checkBox });
        }

        private void Browse(object sender, EventArgs eventArgs)
        {
            using (FolderBrowserDialog dialog = new FolderBrowserDialog())
            {
                dialog.Description = "选择本地日程的安装目录";
                dialog.SelectedPath = Directory.Exists(directoryBox.Text) ? directoryBox.Text :
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                if (dialog.ShowDialog(this) == DialogResult.OK) directoryBox.Text = dialog.SelectedPath;
            }
        }

        private void BeginInstall(object sender, EventArgs eventArgs)
        {
            string destination;
            try
            {
                destination = Path.GetFullPath(Environment.ExpandEnvironmentVariables(directoryBox.Text.Trim()));
                if (destination == Path.GetPathRoot(destination) || destination.Length < 5)
                    throw new InvalidOperationException("不能直接安装到磁盘根目录。");
            }
            catch (Exception error)
            {
                MessageBox.Show(this, "安装目录无效：" + error.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            List<string> selected = new List<string>();
            foreach (PluginChoice item in plugins) if (item.CheckBox.Checked) selected.Add(item.Id);
            installButton.Enabled = false;
            browseButton.Enabled = false;
            directoryBox.Enabled = false;
            foreach (PluginChoice item in plugins) item.CheckBox.Enabled = false;
            worker.RunWorkerAsync(new Tuple<string, List<string>>(destination, selected));
        }

        private void ReadPluginHashes()
        {
            using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("ScheduleStudio.PluginHashes"))
            {
                if (stream == null) throw new InvalidOperationException("安装包缺少插件校验表。");
                using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                {
                    string line;
                    while ((line = reader.ReadLine()) != null)
                    {
                        string[] parts = line.Split('|');
                        if (parts.Length == 2) pluginHashes[parts[0].Trim()] = parts[1].Trim();
                    }
                }
            }
        }

        private void Install(object sender, DoWorkEventArgs eventArgs)
        {
            Tuple<string, List<string>> request = (Tuple<string, List<string>>)eventArgs.Argument;
            InstallResult result = new InstallResult { Directory = request.Item1 };
            Directory.CreateDirectory(result.Directory);
            using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("ScheduleStudio.Payload"))
            {
                if (stream == null) throw new InvalidOperationException("安装包缺少核心程序。");
                Extract(stream, result.Directory, "核心程序", 0, 88);
            }
            int pluginIndex = 0;
            foreach (string pluginId in request.Item2)
            {
                pluginIndex++;
                worker.ReportProgress(88 + pluginIndex * 2, "下载 " + pluginId);
                try
                {
                    string temporary = Path.Combine(Path.GetTempPath(), "schedule-studio-" + Guid.NewGuid().ToString("N") + ".zip");
                    try
                    {
                        ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072;
                        using (WebClient client = new WebClient()) client.DownloadFile(ReleaseBase + pluginId + ".zip", temporary);
                        if (!pluginHashes.ContainsKey(pluginId) || !String.Equals(HashFile(temporary), pluginHashes[pluginId], StringComparison.OrdinalIgnoreCase))
                            throw new InvalidDataException("下载文件的 SHA-256 校验失败。");
                        string pluginDirectory = Path.Combine(result.Directory, "mod", pluginId);
                        Directory.CreateDirectory(pluginDirectory);
                        using (FileStream pluginStream = File.OpenRead(temporary)) Extract(pluginStream, pluginDirectory, pluginId, 88, 100);
                    }
                    finally { if (File.Exists(temporary)) File.Delete(temporary); }
                }
                catch (Exception error) { result.Warnings.Add(pluginId + " 下载失败：" + error.Message); }
            }
            CreateStartMenuShortcut(result.Directory, result.Warnings);
            worker.ReportProgress(100, "安装完成");
            eventArgs.Result = result;
        }

        private void Extract(Stream source, string root, string description, int startPercent, int endPercent)
        {
            string canonicalRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            using (ZipArchive archive = new ZipArchive(source, ZipArchiveMode.Read, true))
            {
                int processed = 0;
                foreach (ZipArchiveEntry entry in archive.Entries)
                {
                    string relative = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                    if (Path.IsPathRooted(relative)) throw new InvalidDataException("压缩包包含绝对路径。");
                    string target = Path.GetFullPath(Path.Combine(root, relative));
                    if (!target.StartsWith(canonicalRoot, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException("压缩包包含越界路径。");
                    if (entry.FullName.EndsWith("/")) Directory.CreateDirectory(target);
                    else
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(target));
                        using (Stream input = entry.Open())
                        using (FileStream output = new FileStream(target, FileMode.Create, FileAccess.Write, FileShare.None)) input.CopyTo(output);
                    }
                    processed++;
                    if (processed % 25 == 0 || processed == archive.Entries.Count)
                        worker.ReportProgress(startPercent + (endPercent - startPercent) * processed / Math.Max(1, archive.Entries.Count), description);
                }
            }
        }

        private static string HashFile(string file)
        {
            using (SHA256 sha = SHA256.Create())
            using (FileStream stream = File.OpenRead(file))
            {
                byte[] hash = sha.ComputeHash(stream);
                return BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
            }
        }

        private static void CreateStartMenuShortcut(string root, List<string> warnings)
        {
            try
            {
                string programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
                string shortcutPath = Path.Combine(programs, "本地日程.lnk");
                dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
                dynamic shortcut = shell.CreateShortcut(shortcutPath);
                shortcut.TargetPath = Path.Combine(root, "打开日程.exe");
                shortcut.WorkingDirectory = root;
                shortcut.IconLocation = Path.Combine(root, "service", "assets", "tray.ico");
                shortcut.Save();
            }
            catch (Exception error) { warnings.Add("开始菜单快捷方式创建失败：" + error.Message); }
        }

        private void Finished(object sender, RunWorkerCompletedEventArgs eventArgs)
        {
            if (eventArgs.Error != null)
            {
                status.Text = "安装失败：" + eventArgs.Error.Message;
                installButton.Enabled = true;
                browseButton.Enabled = true;
                directoryBox.Enabled = true;
                foreach (PluginChoice item in plugins) item.CheckBox.Enabled = true;
                MessageBox.Show(this, status.Text, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            InstallResult result = (InstallResult)eventArgs.Result;
            string message = "核心程序已安装到：\n" + result.Directory;
            if (result.Warnings.Count > 0) message += "\n\n" + String.Join("\n", result.Warnings);
            MessageBox.Show(this, message, Text, MessageBoxButtons.OK,
                result.Warnings.Count == 0 ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
            installButton.Text = "打开软件";
            installButton.Enabled = true;
            installButton.Click -= BeginInstall;
            installButton.Click += delegate { Process.Start(Path.Combine(result.Directory, "打开日程.exe")); Close(); };
            status.Text = result.Warnings.Count == 0 ? "安装完成" : "核心程序已安装，部分可选插件下载失败";
        }
    }

    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            if (args.Length == 1 && args[0] == "--verify")
            {
                try
                {
                    bool hasNode = false, hasService = false, hasWeb = false;
                    using (Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("ScheduleStudio.Payload"))
                    using (ZipArchive archive = new ZipArchive(payload, ZipArchiveMode.Read))
                    {
                        foreach (ZipArchiveEntry entry in archive.Entries)
                        {
                            if (entry.FullName == "runtime/node.exe") hasNode = true;
                            if (entry.FullName == "service/tray-service.mjs") hasService = true;
                            if (entry.FullName == "dist/index.html") hasWeb = true;
                            using (Stream content = entry.Open()) content.CopyTo(Stream.Null);
                        }
                    }
                    return hasNode && hasService && hasWeb ? 0 : 1;
                }
                catch { return 1; }
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new InstallerForm());
            return 0;
        }
    }
}
