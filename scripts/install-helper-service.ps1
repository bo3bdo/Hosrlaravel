param(
  [string]$ServiceName = "LaraboxsHelper"
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$script = Join-Path $repo "dist\api\server.js"
$node = (Get-Command node -ErrorAction Stop).Source

if (-not (Test-Path $script)) {
  throw "Build first with: npm run build"
}

$command = "`"$node`" `"$script`""
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

if ($existing) {
  sc.exe stop $ServiceName | Out-Null
  sc.exe delete $ServiceName | Out-Null
  Start-Sleep -Seconds 2
}

sc.exe create $ServiceName binPath= $command start= auto DisplayName= "laraboxs Helper" | Out-Null
sc.exe description $ServiceName "Local privileged helper API for laraboxs." | Out-Null
Write-Host "Installed $ServiceName. Start it with: Start-Service $ServiceName"
