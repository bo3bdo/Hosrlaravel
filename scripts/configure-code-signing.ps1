param(
  [string]$Thumbprint = $env:WINDOWS_CERTIFICATE_THUMBPRINT,
  [string]$TimestampUrl = $env:WINDOWS_TIMESTAMP_URL,
  [string]$TauriConfig = "src-tauri\tauri.conf.json",
  [string]$OverridePath = "src-tauri\tauri.signing.json"
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $repo $TauriConfig
$overrideFile = Join-Path $repo $OverridePath

if (-not $TimestampUrl) {
  $TimestampUrl = "http://timestamp.digicert.com"
}

if (-not $Thumbprint) {
  Write-Host "WINDOWS_CERTIFICATE_THUMBPRINT is not set. Skipping signing configuration."
  if (Test-Path -LiteralPath $overrideFile) {
    Remove-Item -LiteralPath $overrideFile -Force
  }
  exit 0
}

$normalized = ($Thumbprint -replace '\s', '').ToUpperInvariant()
Write-Host "Configuring Windows code signing with certificate $normalized"

$override = [ordered]@{
  bundle = [ordered]@{
    windows = [ordered]@{
      certificateThumbprint = $normalized
      digestAlgorithm = "sha256"
      timestampUrl = $TimestampUrl
    }
  }
}

$override | ConvertTo-Json -Depth 6 | Set-Content -Path $overrideFile -Encoding UTF8
Write-Host "Wrote signing override to $overrideFile"
Write-Host "Run: npm run tauri build -- --config $OverridePath"
