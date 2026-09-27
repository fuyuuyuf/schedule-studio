$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$bundledNode = Join-Path $projectRoot 'runtime\node.exe'
$installedMode = Test-Path -LiteralPath $bundledNode
if ($installedMode) {
  $env:SCHEDULE_DATA_DIR = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'ScheduleStudio'
  New-Item -ItemType Directory -Path $env:SCHEDULE_DATA_DIR -Force | Out-Null
}
$runtimeDataDirectory = if ($env:SCHEDULE_DATA_DIR) { $env:SCHEDULE_DATA_DIR } else { $PSScriptRoot }
$startupLog = Join-Path $runtimeDataDirectory 'startup.log'
function Write-StartupLog([string]$message) {
  Add-Content -LiteralPath $startupLog -Value "$(Get-Date -Format o) $message" -Encoding UTF8
}
trap {
  Write-StartupLog "launch failed: $($_.Exception.Message)"
  throw $_
}
Write-StartupLog 'launcher started'

$protocolKey = 'HKCU:\Software\Classes\schedule-studio'
$commandKey = Join-Path $protocolKey 'shell\open\command'
$launcher = Join-Path $PSScriptRoot 'start-tray.ps1'
$powerShellExecutable = Join-Path $PSHOME 'powershell.exe'
try {
  New-Item -Path $protocolKey -Force | Out-Null
  Set-Item -Path $protocolKey -Value 'URL:Schedule Studio'
  New-ItemProperty -Path $protocolKey -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
  New-Item -Path $commandKey -Force | Out-Null
  Set-Item -Path $commandKey -Value "`"$powerShellExecutable`" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`" `"%1`""
  Write-StartupLog 'protocol registered'
} catch {
  Write-StartupLog "protocol registration skipped: $($_.Exception.Message)"
}
$running = $false
$staleService = $false
$expectedBuild = '2026-09-26-components-v13'
$currentOwnerSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$currentSessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
Write-StartupLog "launch identity sid=$currentOwnerSid session=$currentSessionId"
try {
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3456/health' -TimeoutSec 1
  # 端口可被另一个登录身份占用；仅复用同一用户、同一会话的实例。
  $sameIdentity = $health.ownerSid -eq $currentOwnerSid -and $health.sessionId -eq $currentSessionId
  $running = [bool]$health.ok -and $health.build -eq $expectedBuild -and $sameIdentity
  $staleService = [bool]$health.ok -and -not $running
  Write-StartupLog "health match ok=$($health.ok) buildMatch=$($health.build -eq $expectedBuild) identityMatch=$sameIdentity running=$running"
  if ($staleService) {
    Write-StartupLog "foreign or old service found build=$($health.build) sid=$($health.ownerSid) session=$($health.sessionId)"
  }
} catch {
}

if ($staleService) {
  Write-StartupLog 'stale service found; requesting shutdown'
  Invoke-RestMethod -Uri 'http://127.0.0.1:3456/quit' -Method Post -TimeoutSec 2 | Out-Null
  $stopped = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 200
    try { Invoke-RestMethod -Uri 'http://127.0.0.1:3456/health' -TimeoutSec 1 | Out-Null }
    catch { $stopped = $true; break }
  }
  if (-not $stopped) { throw 'Old Schedule Studio service did not stop.' }
}

if (-not $running) {
  $node = if ($installedMode) { $bundledNode } else { (Get-Command node.exe -ErrorAction Stop).Source }
  $service = Join-Path $PSScriptRoot 'tray-service.mjs'
  $env:SCHEDULE_OWNER_SID = $currentOwnerSid
  $env:SCHEDULE_SESSION_ID = [string]$currentSessionId
  # 提醒服务只维护轻量队列，限制 V8 堆上限，避免长期后台运行时无界增长。
  $stdoutPath = Join-Path $runtimeDataDirectory 'service.stdout.log'
  $stderrPath = Join-Path $runtimeDataDirectory 'service.stderr.log'
  Write-StartupLog "starting node=$node service=$service"
  $serviceProcess = Start-Process -FilePath $node -ArgumentList @('--max-old-space-size=64', "`"$service`"") `
    -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath -PassThru
  if (-not $serviceProcess -or -not $serviceProcess.Id) { throw 'Node service process was not created.' }
  Write-StartupLog "service started pid=$($serviceProcess.Id)"
} else {
  Write-StartupLog 'current service already running'
}

for ($attempt = 0; $attempt -lt 12; $attempt++) {
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3456/health' -TimeoutSec 1
    if ($health.ok -and $health.build -eq $expectedBuild -and
        $health.ownerSid -eq $currentOwnerSid -and $health.sessionId -eq $currentSessionId) {
      Write-StartupLog 'service healthy; opening main window'
      Invoke-RestMethod -Uri 'http://127.0.0.1:3456/open-main' -Method Post -TimeoutSec 2 | Out-Null
      Write-StartupLog 'open-main accepted'
      exit 0
    }
  } catch {
    Start-Sleep -Milliseconds 400
  }
}
if ($serviceProcess -and $serviceProcess.HasExited) {
  $errorDetail = (Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue).Trim()
  Write-StartupLog "service exited code=$($serviceProcess.ExitCode) error=$errorDetail"
} else {
  Write-StartupLog 'startup timed out while process was still running'
}
throw 'Schedule Studio could not start.'
