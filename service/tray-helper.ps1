param(
  [Parameter(Mandatory = $true)][string]$IconPath,
  [int]$Port = 3456,
  [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TrayDpi {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
try {
  if (-not [TrayDpi]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))) {
    [void][TrayDpi]::SetProcessDPIAware()
  }
} catch { }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies 'System.Windows.Forms','System.Drawing' -TypeDefinition @'
using System.Drawing;
using System.Windows.Forms;
public class SolarizedMenuColors : ProfessionalColorTable {
  private readonly Color background;
  private readonly Color selection;
  private readonly Color border;
  public SolarizedMenuColors(Color background, Color selection, Color border) {
    this.background = background; this.selection = selection; this.border = border;
  }
  public override Color ToolStripDropDownBackground { get { return background; } }
  public override Color ImageMarginGradientBegin { get { return background; } }
  public override Color ImageMarginGradientMiddle { get { return background; } }
  public override Color ImageMarginGradientEnd { get { return background; } }
  public override Color MenuBorder { get { return border; } }
  public override Color MenuItemBorder { get { return selection; } }
  public override Color MenuItemSelected { get { return selection; } }
  public override Color MenuItemSelectedGradientBegin { get { return selection; } }
  public override Color MenuItemSelectedGradientEnd { get { return selection; } }
  public override Color MenuItemPressedGradientBegin { get { return selection; } }
  public override Color MenuItemPressedGradientMiddle { get { return selection; } }
  public override Color MenuItemPressedGradientEnd { get { return selection; } }
  public override Color SeparatorDark { get { return border; } }
  public override Color SeparatorLight { get { return background; } }
}
'@
[System.Windows.Forms.Application]::EnableVisualStyles()

$baseUrl = "http://127.0.0.1:$Port"
$icon = [System.Drawing.Icon]::new($IconPath)
$menu = [System.Windows.Forms.ContextMenuStrip]::new()
$notify = [System.Windows.Forms.NotifyIcon]::new()
$notify.Icon = $icon
$notify.Text = 'Schedule Studio'
$notify.ContextMenuStrip = $menu
$menu.ShowImageMargin = $false
$menu.ShowCheckMargin = $false
$menu.Font = [System.Drawing.Font]::new('Microsoft YaHei UI', 10, [System.Drawing.FontStyle]::Regular)
$menu.Padding = [System.Windows.Forms.Padding]::new(7)
$watchdog = [System.Windows.Forms.Timer]::new()
$watchdog.Interval = 5000

function Invoke-TrayAction([string]$id) {
  $route = switch ($id) {
    'open' { '/open-web' }
    'main' { '/open-main' }
    'planned' { '/open-main' }
    'quit' { '/quit' }
    default { $null }
  }
  if (-not $route) { return }
  try { Invoke-RestMethod -Uri "$baseUrl$route" -Method Post -TimeoutSec 2 | Out-Null } catch { }
  if ($id -eq 'quit') { [System.Windows.Forms.Application]::Exit() }
}

function Set-RoundedRegion($strip) {
  if ($strip.Width -lt 20 -or $strip.Height -lt 20) { return }
  $radius = 11
  $diameter = $radius * 2
  $right = $strip.Width - $diameter - 1
  $bottom = $strip.Height - $diameter - 1
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddArc(0, 0, $diameter, $diameter, 180, 90)
  $path.AddArc($right, 0, $diameter, $diameter, 270, 90)
  $path.AddArc($right, $bottom, $diameter, $diameter, 0, 90)
  $path.AddArc(0, $bottom, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  $previous = $strip.Region
  $strip.Region = [System.Drawing.Region]::new($path)
  if ($previous) { $previous.Dispose() }
  $path.Dispose()
}

function Update-MenuTheme {
  $saved = Invoke-RestMethod -Uri "$baseUrl/settings" -TimeoutSec 2
  $dark = $saved.appearance -eq 'dark'
  if ($saved.appearance -eq 'system') {
    $system = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -ErrorAction SilentlyContinue
    $dark = $system.AppsUseLightTheme -eq 0
  }
  $background = if ($dark) { '#073642' } else { '#fdf6e3' }
  $foreground = if ($dark) { '#eee8d5' } else { '#073642' }
  $selection = if ($dark) { '#145362' } else { '#eee8d5' }
  $border = if ($dark) { '#586e75' } else { '#93a1a1' }
  $script:menuBackground = [System.Drawing.ColorTranslator]::FromHtml($background)
  $script:menuForeground = [System.Drawing.ColorTranslator]::FromHtml($foreground)
  $table = [SolarizedMenuColors]::new($script:menuBackground, [System.Drawing.ColorTranslator]::FromHtml($selection), [System.Drawing.ColorTranslator]::FromHtml($border))
  $script:menuRenderer = [System.Windows.Forms.ToolStripProfessionalRenderer]::new($table)
  $script:menuRenderer.RoundedEdges = $true
  $menu.BackColor = $script:menuBackground
  $menu.ForeColor = $script:menuForeground
  $menu.Renderer = $script:menuRenderer
}

function Add-TrayItems($collection, $specs) {
  foreach ($spec in $specs) {
    if ($spec.separator) {
      [void]$collection.Add([System.Windows.Forms.ToolStripSeparator]::new())
      continue
    }
    $item = [System.Windows.Forms.ToolStripMenuItem]::new([string]$spec.title)
    $item.Enabled = $spec.enabled -ne $false
    $item.Tag = [string]$spec.id
    $item.BackColor = $script:menuBackground
    $item.ForeColor = $script:menuForeground
    $item.Padding = [System.Windows.Forms.Padding]::new(9, 5, 9, 5)
    if ($spec.items) {
      $item.DropDown.BackColor = $script:menuBackground
      $item.DropDown.ForeColor = $script:menuForeground
      $item.DropDown.Renderer = $script:menuRenderer
      $item.DropDown.Padding = [System.Windows.Forms.Padding]::new(7)
      $item.DropDown.add_Opened({ param($sender, $eventArgs) Set-RoundedRegion $sender })
      Add-TrayItems $item.DropDownItems $spec.items
    } else {
      $item.add_Click({ param($sender, $eventArgs) Invoke-TrayAction ([string]$sender.Tag) })
    }
    [void]$collection.Add($item)
  }
}

if ($SelfTest) {
  Update-MenuTheme
  $data = Invoke-RestMethod -Uri "$baseUrl/tray-menu" -TimeoutSec 2
  Add-TrayItems $menu.Items $data.items
  $menu.Size = $menu.GetPreferredSize([System.Drawing.Size]::Empty)
  Set-RoundedRegion $menu
  Write-Output "Menu items: $($menu.Items.Count); rounded: $([bool]$menu.Region)"
  $notify.Dispose()
  $menu.Dispose()
  $icon.Dispose()
  $watchdog.Dispose()
  exit 0
}

$menu.add_Opening({
  try {
    Update-MenuTheme
    $data = Invoke-RestMethod -Uri "$baseUrl/tray-menu" -TimeoutSec 2
    $menu.Items.Clear()
    Add-TrayItems $menu.Items $data.items
    $notify.Text = [string]$data.tooltip
  } catch {
    $menu.Items.Clear()
    [void]$menu.Items.Add([System.Windows.Forms.ToolStripMenuItem]::new('Schedule Studio'))
  }
})
$menu.add_Opened({ param($sender, $eventArgs) Set-RoundedRegion $sender })
$notify.add_DoubleClick({ Invoke-TrayAction 'main' })
$watchdog.add_Tick({
  try { Invoke-RestMethod -Uri "$baseUrl/health" -TimeoutSec 1 | Out-Null }
  catch { [System.Windows.Forms.Application]::Exit() }
})

try {
  $notify.Visible = $true
  Invoke-RestMethod -Uri "$baseUrl/tray-ready" -Method Post -TimeoutSec 2 | Out-Null
  $watchdog.Start()
  [System.Windows.Forms.Application]::Run()
} finally {
  $watchdog.Stop()
  $watchdog.Dispose()
  $notify.Visible = $false
  $notify.Dispose()
  $menu.Dispose()
  $icon.Dispose()
}
