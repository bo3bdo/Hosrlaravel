param(
  [string]$ServiceName = "LaraboxsHelper"
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$helperSvc = Join-Path $repo "helper-service\target\release\laraboxs-helper-svc.exe"

if (Test-Path -LiteralPath $helperSvc) {
  & $helperSvc --uninstall
  Write-Host "Removed native $ServiceName service."
  exit 0
}

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  sc.exe stop $ServiceName | Out-Null
  sc.exe delete $ServiceName | Out-Null
  Write-Host "Removed legacy $ServiceName service."
  exit 0
}

Write-Host "No $ServiceName service was installed."
