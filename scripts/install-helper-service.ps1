param(
  [string]$ServiceName = "LaraboxsHelper",
  [string]$ResourceDir = ""
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot

if (-not $ResourceDir) {
  $ResourceDir = Join-Path $repo "src-tauri\resources"
}

$nativeHelper = Join-Path $ResourceDir "laraboxs-helper-svc.exe"
if (Test-Path -LiteralPath $nativeHelper) {
  & $nativeHelper --install --resource-dir $ResourceDir
  Write-Host "Installed native $ServiceName service."
  exit 0
}

$releaseHelper = Join-Path $repo "helper-service\target\release\laraboxs-helper-svc.exe"
if (Test-Path -LiteralPath $releaseHelper) {
  & $releaseHelper --install --resource-dir $ResourceDir
  Write-Host "Installed native $ServiceName service from release build."
  exit 0
}

$script = Join-Path $repo "dist\api\server.js"
$node = (Get-Command node -ErrorAction Stop).Source

if (-not (Test-Path $script)) {
  throw "Build first with: npm run build"
}

Write-Warning "Native helper service binary was not found. Falling back to legacy Node service wrapper."

$command = "`"$node`" `"$script`""
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

if ($existing) {
  sc.exe stop $ServiceName | Out-Null
  sc.exe delete $ServiceName | Out-Null
  Start-Sleep -Seconds 2
}

sc.exe create $ServiceName binPath= $command start= auto DisplayName= "laraboxs Helper" | Out-Null
sc.exe description $ServiceName "Local privileged helper API for laraboxs." | Out-Null
Write-Host "Installed legacy $ServiceName service. Start it with: Start-Service $ServiceName"
