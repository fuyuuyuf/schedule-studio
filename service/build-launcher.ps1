$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$sourceFile = Join-Path $PSScriptRoot 'launcher\Program.cs'
$outputFile = Join-Path $projectRoot ([string]([char]0x6253) + [char]0x5F00 + [char]0x65E5 + [char]0x7A0B + '.exe')
$iconFile = Join-Path $PSScriptRoot 'assets\tray.ico'
$compilerCandidates = @(
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compiler) { throw 'Windows C# compiler was not found.' }

& $compiler /nologo /target:winexe /optimize+ /platform:anycpu `
  /reference:System.Windows.Forms.dll "/win32icon:$iconFile" "/out:$outputFile" $sourceFile
if ($LASTEXITCODE -ne 0) { throw "Launcher compilation failed with exit code $LASTEXITCODE" }
Write-Output "Created: $outputFile"
