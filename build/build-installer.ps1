param([string]$ReleaseTag = 'v1.0.0')

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$serviceRoot = Join-Path $projectRoot 'service'
$workDirectory = Join-Path $PSScriptRoot 'work'
$releaseDirectory = Join-Path $PSScriptRoot 'release'
New-Item -ItemType Directory -Path $workDirectory, $releaseDirectory -Force | Out-Null

if ($ReleaseTag -ne 'v1.0.0') { throw '当前安装器源码仅支持 v1.0.0；发布新版本前请同步修改安装器版本。' }
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$nodeVersion = & $nodePath --version
if ([version]($nodeVersion.TrimStart('v')) -lt [version]'22.16.0') { throw '构建安装包需要 Node.js 22.16 或更高版本。' }
$compiler = @(
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compiler) { throw '未找到 Windows .NET Framework C# 编译器。' }
if (-not (Test-Path -LiteralPath (Join-Path $serviceRoot 'node_modules/electron/dist/electron.exe'))) {
  & npm.cmd ci --prefix $serviceRoot
  if ($LASTEXITCODE -ne 0) { throw '安装构建依赖失败。' }
}

if (-not (Test-Path -LiteralPath (Join-Path $serviceRoot 'native-tray.exe'))) {
  & (Join-Path $serviceRoot 'build-native-tray.ps1')
  if ($LASTEXITCODE -ne 0) { throw '托盘程序构建失败。' }
}
& (Join-Path $serviceRoot 'build-launcher.ps1')
if ($LASTEXITCODE -ne 0) { throw '启动器构建失败。' }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
function New-ZipArchive([string]$target, [array]$sources) {
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
  $archive = [System.IO.Compression.ZipFile]::Open($target, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($source in $sources) {
      if (-not (Test-Path -LiteralPath $source.Path -PathType Leaf)) { throw "缺少打包文件：$($source.Path)" }
      [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $archive, $source.Path, $source.Entry.Replace('\', '/'), [System.IO.Compression.CompressionLevel]::Optimal)
    }
  } finally { $archive.Dispose() }
}

$payload = [System.Collections.Generic.List[object]]::new()
function Add-PayloadFile([string]$file, [string]$entry) {
  $payload.Add([pscustomobject]@{ Path = $file; Entry = $entry })
}
foreach ($name in @('README.md','打开日程.exe','打开日程.bat')) {
  Add-PayloadFile (Join-Path $projectRoot $name) $name
}
Add-PayloadFile $nodePath 'runtime/node.exe'
foreach ($directory in @('dist','service/assets','service/core','service/panel','service/ui','service/node_modules')) {
  $absolute = Join-Path $projectRoot $directory
  Get-ChildItem -LiteralPath $absolute -Recurse -File -Force | ForEach-Object {
    $entry = $_.FullName.Substring($projectRoot.Length + 1).Replace('\', '/')
    Add-PayloadFile $_.FullName $entry
  }
}
foreach ($name in @('package.json','package-lock.json','tray-service.mjs','electron-main.cjs','start-tray.ps1','restore-window.ps1','tray-helper.ps1','native-tray.exe')) {
  Add-PayloadFile (Join-Path $serviceRoot $name) "service/$name"
}
$payloadPath = Join-Path $workDirectory 'core-payload.zip'
New-ZipArchive $payloadPath $payload

$pluginIds = @('calendar-widget','sticker-widget','example-plugin','example-ui-component')
$hashLines = [System.Collections.Generic.List[string]]::new()
foreach ($pluginId in $pluginIds) {
  $pluginDirectory = Join-Path $projectRoot "mod/$pluginId"
  $files = @(Get-ChildItem -LiteralPath $pluginDirectory -Recurse -File -Force | ForEach-Object {
    [pscustomobject]@{ Path = $_.FullName; Entry = $_.FullName.Substring($pluginDirectory.Length + 1).Replace('\', '/') }
  })
  $zipPath = Join-Path $releaseDirectory "$pluginId.zip"
  New-ZipArchive $zipPath $files
  $hashLines.Add("$pluginId|$((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant())")
}
$hashPath = Join-Path $workDirectory 'plugin-hashes.txt'
[System.IO.File]::WriteAllLines($hashPath, $hashLines, [System.Text.Encoding]::UTF8)

$outputPath = Join-Path $releaseDirectory 'ScheduleStudio-Setup-v1.0.0.exe'
& $compiler /nologo /target:winexe /optimize+ /platform:anycpu `
  /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll `
  /reference:System.Windows.Forms.dll /reference:System.IO.Compression.dll `
  /reference:System.IO.Compression.FileSystem.dll /reference:Microsoft.CSharp.dll `
  "/win32icon:$(Join-Path $serviceRoot 'assets/tray.ico')" `
  "/resource:$payloadPath,ScheduleStudio.Payload" `
  "/resource:$hashPath,ScheduleStudio.PluginHashes" `
  "/out:$outputPath" (Join-Path $PSScriptRoot 'installer/Program.cs')
if ($LASTEXITCODE -ne 0) { throw '安装器编译失败。' }
Write-Output "安装包：$outputPath"
Get-FileHash -LiteralPath $outputPath -Algorithm SHA256 | Select-Object Path,Hash
