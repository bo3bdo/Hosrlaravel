param(
  [string]$Output = "",
  [int]$Port = 47899
)

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$artifacts = Join-Path $repo "artifacts"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$staging = Join-Path $artifacts "preview-staging-$stamp"
$payload = Join-Path $staging "payload"
$appZip = Join-Path $staging "app.zip"
$launcher = Join-Path $staging "launch.cmd"
$launcherPs1 = Join-Path $staging "launch.ps1"
$sed = Join-Path $staging "laraboxs-preview.sed"
$targetName = if ($Output) { $Output } else { "artifacts\laraboxs-v0.1.3-preview-$stamp.exe" }
$target = if ([System.IO.Path]::IsPathRooted($targetName)) { $targetName } else { Join-Path $repo $targetName }
$node = (Get-Command node -ErrorAction Stop).Source

New-Item -ItemType Directory -Path $payload -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null

Copy-Item -Path (Join-Path $repo "dist") -Destination (Join-Path $payload "dist") -Recurse -Force
Copy-Item -Path (Join-Path $repo "dist-ui") -Destination (Join-Path $payload "dist-ui") -Recurse -Force
Copy-Item -Path $node -Destination (Join-Path $staging "node.exe") -Force

$rootPackage = Get-Content (Join-Path $repo "package.json") -Raw | ConvertFrom-Json
$payloadPackage = [ordered]@{
  name = "laraboxs-preview-runtime"
  version = $rootPackage.version
  private = $true
  type = "module"
  dependencies = [ordered]@{
    "extract-zip" = $rootPackage.dependencies."extract-zip"
    "selfsigned" = $rootPackage.dependencies.selfsigned
  }
}
$payloadPackage | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $payload "package.json") -Encoding ASCII
npm install --prefix $payload --omit=dev --ignore-scripts --no-audit --no-fund

Compress-Archive -Path (Join-Path $payload "*") -DestinationPath $appZip -Force

$launcherPs1Content = @"
`$ErrorActionPreference = "Stop"

`$port = $Port
`$appRoot = Join-Path `$env:LOCALAPPDATA "laraboxs-preview"
`$payload = Join-Path `$appRoot "app"
`$node = Join-Path `$PSScriptRoot "node.exe"
`$appZip = Join-Path `$PSScriptRoot "app.zip"
`$outLog = Join-Path `$appRoot "server.out.log"
`$errLog = Join-Path `$appRoot "server.err.log"

New-Item -ItemType Directory -Path `$payload -Force | Out-Null
Expand-Archive -LiteralPath `$appZip -DestinationPath `$payload -Force

`$env:LARABOXS_API_PORT = [string]`$port
`$server = Start-Process -FilePath `$node -ArgumentList @((Join-Path `$payload "dist\api\server.js")) -WorkingDirectory `$payload -WindowStyle Hidden -PassThru -RedirectStandardOutput `$outLog -RedirectStandardError `$errLog

try {
  `$ready = `$false
  for (`$i = 0; `$i -lt 60; `$i++) {
    if (`$server.HasExited) {
      throw "laraboxs server exited early. See `$errLog"
    }

    try {
      Invoke-WebRequest -Uri "http://127.0.0.1:`$port/api/summary" -UseBasicParsing -TimeoutSec 2 | Out-Null
      `$ready = `$true
      break
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }

  if (-not `$ready) {
    throw "laraboxs server did not become ready. See `$errLog"
  }

  Start-Process "http://127.0.0.1:`$port/"
  Write-Host "laraboxs preview is running at http://127.0.0.1:`$port/"
  Write-Host "Press Enter in this window to stop the preview server."
  [void][Console]::ReadLine()
} finally {
  if (`$server -and -not `$server.HasExited) {
    Stop-Process -Id `$server.Id -Force
  }
}
"@
Set-Content -Path $launcherPs1 -Value $launcherPs1Content -Encoding ASCII

@"
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1"
if errorlevel 1 pause
"@ | Set-Content -Path $launcher -Encoding ASCII

$stagingEscaped = $staging.Replace("\", "\\")
$targetEscaped = $target.Replace("\", "\\")
@"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$targetEscaped
FriendlyName=laraboxs Preview
AppLaunched=launch.cmd
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles
[Strings]
FILE0="node.exe"
FILE1="app.zip"
FILE2="launch.cmd"
FILE3="launch.ps1"
[SourceFiles]
SourceFiles0=$stagingEscaped
[SourceFiles0]
%FILE0%=
%FILE1%=
%FILE2%=
%FILE3%=
"@ | Set-Content -Path $sed -Encoding ASCII

& "$env:SystemRoot\System32\iexpress.exe" /N /Q $sed

if (-not (Test-Path $target)) {
  throw "IExpress did not create $target"
}

Get-Item $target | Select-Object FullName, Length, LastWriteTime
