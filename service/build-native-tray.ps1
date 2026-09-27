$ErrorActionPreference = 'Stop'
$sourceFile = Join-Path $PSScriptRoot 'native-tray\Program.cs'
$outputFile = Join-Path $PSScriptRoot 'native-tray.exe'
$iconFile = Join-Path $PSScriptRoot 'assets\tray.ico'
$compiler = @(
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compiler) { throw 'Windows C# compiler was not found.' }

& $compiler /nologo /target:winexe /optimize+ /platform:anycpu `
  /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll `
  /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll `
  "/win32icon:$iconFile" "/out:$outputFile" $sourceFile
if ($LASTEXITCODE -ne 0) { throw "Native tray compilation failed with exit code $LASTEXITCODE" }
Write-Output "Created: $outputFile"
