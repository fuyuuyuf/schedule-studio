param(
  [Parameter(Mandatory = $true)][ValidateSet('main', 'web')][string]$Action,
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][string]$Title,
  [string]$MainTitle = '',
  [string]$BrowserPath = '',
  [switch]$SelfTest,
  [switch]$HasBounds,
  [int]$X = 0,
  [int]$Y = 0,
  [int]$Width = 850,
  [int]$Height = 640
)

$ErrorActionPreference = 'Stop'
$windowDataDirectory = if ($env:SCHEDULE_DATA_DIR) { $env:SCHEDULE_DATA_DIR } else { $PSScriptRoot }
if (-not $SelfTest) {
  Add-Content -LiteralPath (Join-Path $windowDataDirectory 'window-actions.log') -Value "$(Get-Date -Format o) $Action helper started" -Encoding UTF8
}
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class ScheduleWindows {
  private delegate bool EnumCallback(IntPtr handle, IntPtr parameter);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumCallback callback, IntPtr parameter);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr handle, StringBuilder text, int capacity);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowTextLength(IntPtr handle);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
  [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr handle, int command);
  [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr handle);
  [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr handle, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] private static extern bool MoveWindow(IntPtr handle, int x, int y, int width, int height, bool repaint);
  public static IntPtr Find(string title, bool anyBrowser) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((handle, parameter) => {
      if (!IsWindowVisible(handle)) return true;
      int length = GetWindowTextLength(handle);
      if (length == 0) return true;
      var text = new StringBuilder(length + 1);
      GetWindowText(handle, text, text.Capacity);
      string caption = text.ToString();
      if (!anyBrowser && !caption.StartsWith(title, StringComparison.Ordinal)) return true;
      if (anyBrowser && title.Length > 0 && caption.StartsWith(title, StringComparison.Ordinal)) return true;
      uint processId;
      GetWindowThreadProcessId(handle, out processId);
      try {
        string process = Process.GetProcessById((int)processId).ProcessName.ToLowerInvariant();
        if (process != "msedge" && process != "chrome" && process != "firefox" && process != "brave" && process != "opera") return true;
      } catch { return true; }
      found = handle;
      return false;
    }, IntPtr.Zero);
    return found;
  }
  public static bool Place(IntPtr handle, int x, int y, int width, int height) {
    ShowWindow(handle, 9);
    return MoveWindow(handle, x, y, width, height, true);
  }
  public static bool Front(IntPtr handle) {
    ShowWindow(handle, 9);
    const uint flags = 0x0001 | 0x0002 | 0x0040;
    SetWindowPos(handle, new IntPtr(-1), 0, 0, 0, 0, flags);
    SetWindowPos(handle, new IntPtr(-2), 0, 0, 0, 0, flags);
    return SetForegroundWindow(handle);
  }
}
'@

$logPath = Join-Path $windowDataDirectory 'window-actions.log'
function Write-WindowLog([string]$message) {
  Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) $message" -Encoding UTF8
}

if ($SelfTest) {
  $found = [ScheduleWindows]::Find($Title, $false)
  Write-Output "Window enumeration ready; found=$($found -ne [IntPtr]::Zero)"
  exit 0
}

try {
  $existing = [ScheduleWindows]::Find($Title, $false)
  if ($existing -ne [IntPtr]::Zero) {
    $foreground = [ScheduleWindows]::Front($existing)
    Write-WindowLog "$Action existing foreground=$foreground"
    exit 0
  }

  if ($Action -eq 'main' -and $BrowserPath -and (Test-Path -LiteralPath $BrowserPath)) {
    $info = [System.Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $BrowserPath
    $info.Arguments = "--app=$Url --window-size=$Width,$Height"
    if ($HasBounds) { $info.Arguments += " --window-position=$X,$Y" }
    $info.UseShellExecute = $false
    [void][System.Diagnostics.Process]::Start($info)
  } else {
    $info = [System.Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Url
    $info.UseShellExecute = $true
    [void][System.Diagnostics.Process]::Start($info)
  }

  $window = [IntPtr]::Zero
  $maxAttempts = if ($Action -eq 'web') { 20 } else { 48 }
  for ($attempt = 0; $attempt -lt $maxAttempts; $attempt++) {
    Start-Sleep -Milliseconds 200
    $window = [ScheduleWindows]::Find($Title, $false)
    if ($window -ne [IntPtr]::Zero) { break }
  }
  if ($window -eq [IntPtr]::Zero -and $Action -eq 'web') {
    $window = [ScheduleWindows]::Find($MainTitle, $true)
  }
  if ($window -eq [IntPtr]::Zero) {
    Write-WindowLog "$Action no matching window"
    exit 1
  }
  if ($Action -eq 'main' -and $HasBounds) {
    Start-Sleep -Milliseconds 500
    $moved = [ScheduleWindows]::Place($window, $X, $Y, $Width, $Height)
    Start-Sleep -Milliseconds 300
    $moved = [ScheduleWindows]::Place($window, $X, $Y, $Width, $Height) -and $moved
    Write-WindowLog "main restored=$moved x=$X y=$Y width=$Width height=$Height"
  }
  $foreground = [ScheduleWindows]::Front($window)
  Write-WindowLog "$Action new foreground=$foreground"
  exit 0
} catch {
  Write-WindowLog "$Action error=$($_.Exception.Message)"
  exit 1
}
