param(
  [string]$Version = "150.0.4078.48",
  [string]$Architecture = "x64"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$repo = Split-Path -Parent $PSScriptRoot
$runtimeName = "Microsoft.WebView2.FixedVersionRuntime.$Version.$Architecture"
$runtimeRoot = Join-Path $repo "src-tauri\webview2-fixed-runtime"
$runtimePath = Join-Path $runtimeRoot $runtimeName
$runtimeExe = Join-Path $runtimePath "msedgewebview2.exe"
$downloadDir = Join-Path $repo "src-tauri\downloads"
$cabPath = Join-Path $downloadDir "$runtimeName.cab"

$downloads = @{
  "150.0.4078.48-x64" = "https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/60926d99-f201-46bb-91a0-d868dc06b275/Microsoft.WebView2.FixedVersionRuntime.150.0.4078.48.x64.cab"
}

$key = "$Version-$Architecture"
if (-not $downloads.ContainsKey($key)) {
  throw "No WebView2 fixed runtime download is configured for $key."
}

if (Test-Path -LiteralPath $runtimeExe) {
  Write-Host "WebView2 fixed runtime is ready at $runtimePath"
  exit 0
}

New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null

if (-not (Test-Path -LiteralPath $cabPath)) {
  Write-Host "Downloading WebView2 fixed runtime $Version $Architecture..."
  Invoke-WebRequest -UseBasicParsing -Uri $downloads[$key] -OutFile $cabPath
}

if (Test-Path -LiteralPath $runtimePath) {
  Remove-Item -LiteralPath $runtimePath -Recurse -Force
}

Write-Host "Extracting WebView2 fixed runtime..."
& expand.exe $cabPath -F:* $runtimeRoot | Out-Host

if (-not (Test-Path -LiteralPath $runtimeExe)) {
  throw "WebView2 fixed runtime extraction did not create $runtimeExe."
}

Write-Host "WebView2 fixed runtime is ready at $runtimePath"
