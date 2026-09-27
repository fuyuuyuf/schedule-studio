using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("本地日程")]
[assembly: AssemblyProduct("本地日程")]
[assembly: AssemblyDescription("本地日程管理与提醒服务启动器")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace ScheduleStudioLauncher
{
    internal static class Program
    {
        [STAThread]
        private static int Main()
        {
            string applicationDirectory = AppDomain.CurrentDomain.BaseDirectory;
            string startupScript = Path.Combine(applicationDirectory, "service", "start-tray.ps1");
            if (!File.Exists(startupScript))
            {
                MessageBox.Show("未找到软件启动脚本，请保持 EXE 与 service 文件夹位于同一目录。",
                    "本地日程", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }

            try
            {
                // 启动器只负责静默拉起后台服务；主界面的单实例由 Electron 保证。
                var startInfo = new ProcessStartInfo
                {
                    FileName = Path.Combine(Environment.SystemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe"),
                    Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"" + startupScript + "\"",
                    WorkingDirectory = Path.GetDirectoryName(startupScript),
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                using (Process process = Process.Start(startInfo))
                {
                    if (process == null) throw new InvalidOperationException("无法创建启动进程。");
                    if (process.WaitForExit(20000) && process.ExitCode != 0)
                    {
                        string logDirectory = File.Exists(Path.Combine(applicationDirectory, "runtime", "node.exe"))
                            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ScheduleStudio")
                            : Path.Combine(applicationDirectory, "service");
                        MessageBox.Show("软件启动失败，请查看 " + Path.Combine(logDirectory, "startup.log") + "。",
                            "本地日程", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        return process.ExitCode;
                    }
                }
                return 0;
            }
            catch (Exception error)
            {
                MessageBox.Show("软件启动失败：" + error.Message,
                    "本地日程", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }
    }
}
