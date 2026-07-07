param(
  [string[]]$Files = @(),
  [string]$Thumbprint = $env:WINDOWS_CERTIFICATE_THUMBPRINT,
  [string]$TimestampUrl = $env:WINDOWS_TIMESTAMP_URL,
  [string]$SignToolPath = $env:SIGNTOOL_PATH
)

$ErrorActionPreference = "Stop"

if (-not $Thumbprint) {
  Write-Host "WINDOWS_CERTIFICATE_THUMBPRINT is not set. Skipping artifact signing."
  exit 0
}

if (-not $TimestampUrl) {
  $TimestampUrl = "http://timestamp.digicert.com"
}

if (-not $SignToolPath) {
  $kits = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
  if (Test-Path -LiteralPath $kits) {
    $latest = Get-ChildItem -LiteralPath $kits -Directory | Sort-Object Name -Descending | Select-Object -First 1
    if ($latest) {
      $candidate = Join-Path $latest.FullName "x64\signtool.exe"
      if (Test-Path -LiteralPath $candidate) {
        $SignToolPath = $candidate
      }
    }
  }
}

if (-not $SignToolPath -or -not (Test-Path -LiteralPath $SignToolPath)) {
  throw "signtool.exe was not found. Set SIGNTOOL_PATH or install the Windows SDK."
}

$normalized = ($Thumbprint -replace '\s', '').ToUpperInvariant()

if ($Files.Count -eq 0) {
  $repo = Split-Path -Parent $PSScriptRoot
  $Files = @(
    (Join-Path $repo "src-tauri\target\release\laraboxs.exe"),
    (Join-Path $repo "helper-service\target\release\laraboxs-helper-svc.exe")
  )
  $bundleRoot = Join-Path $repo "src-tauri\target\release\bundle\nsis"
  if (Test-Path -LiteralPath $bundleRoot) {
    $Files += Get-ChildItem -LiteralPath $bundleRoot -Filter "*.exe" -File | ForEach-Object { $_.FullName }
  }
}

foreach ($file in $Files) {
  if (-not (Test-Path -LiteralPath $file)) {
    Write-Warning "Skipping missing file: $file"
    continue
  }

  Write-Host "Signing $file"
  & $SignToolPath sign `
    /fd sha256 `
    /tr $TimestampUrl `
    /td sha256 `
    /sha1 $normalized `
    /a `
    $file

  if ($LASTEXITCODE -ne 0) {
    throw "signtool failed for $file with exit code $LASTEXITCODE"
  }
}

Write-Host "Signing complete."
