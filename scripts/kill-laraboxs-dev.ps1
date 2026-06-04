# Stops laraboxs and helper Node processes that lock src-tauri/resources during rebuilds.
$ErrorActionPreference = "SilentlyContinue"

$repo = Split-Path -Parent $PSScriptRoot
$resourceNode = Join-Path $repo "src-tauri\resources\node.exe"
$debugNode = Join-Path $repo "src-tauri\target\debug\node.exe"
$releaseNode = Join-Path $repo "src-tauri\target\release\node.exe"

function Stop-IfRunning([string]$processName) {
  Get-Process -Name $processName -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
  }
}

Stop-IfRunning "laraboxs"

Get-Process -Name "node" -ErrorAction SilentlyContinue | ForEach-Object {
  $path = $_.Path
  if (-not $path) {
    return
  }

  $normalized = $path.ToLowerInvariant()
  $shouldStop =
    $normalized -like "*\hosrlaravel\*" -or
    $normalized -like "*\laraboxs\*" -or
    $normalized -eq $resourceNode.ToLowerInvariant() -or
    $normalized -eq $debugNode.ToLowerInvariant() -or
    $normalized -eq $releaseNode.ToLowerInvariant()

  if ($shouldStop) {
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
  }
}

Start-Sleep -Milliseconds 400

Write-Host "Stopped laraboxs helper processes (if any were running)."
