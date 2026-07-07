param(
  [string]$ResourceDir = "",
  [string]$ServiceName = "LaraboxsHelper"
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot

if (-not $ResourceDir) {
  $ResourceDir = Join-Path $repo "src-tauri\resources"
}

$helperSvc = Join-Path $ResourceDir "laraboxs-helper-svc.exe"
if (-not (Test-Path -LiteralPath $helperSvc)) {
  $releaseSvc = Join-Path $repo "src-tauri\target\release\laraboxs-helper-svc.exe"
  if (Test-Path -LiteralPath $releaseSvc) {
    Copy-Item -LiteralPath $releaseSvc -Destination $helperSvc -Force
  }
}

if (-not (Test-Path -LiteralPath $helperSvc)) {
  throw "Build laraboxs-helper-svc first: cargo build --release --manifest-path helper-service/Cargo.toml"
}

& $helperSvc --install --resource-dir $ResourceDir
Write-Host "Installed native $ServiceName service from $helperSvc"
