param(
  [string]$ServiceName = "LaraboxsHelper"
)

$ErrorActionPreference = "Stop"
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

if (-not $existing) {
  Write-Host "$ServiceName is not installed."
  exit 0
}

Stop-Service -Name $ServiceName -ErrorAction SilentlyContinue
sc.exe delete $ServiceName | Out-Null
Write-Host "Uninstalled $ServiceName."
