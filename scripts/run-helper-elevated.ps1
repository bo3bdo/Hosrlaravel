param(
  [int]$Port = 47899
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source
$script = Join-Path $repo "dist\api\server.js"

if (-not (Test-Path $script)) {
  throw "Build first with: npm run build"
}

Start-Process -FilePath $node -ArgumentList "`"$script`"" -WorkingDirectory $repo -Verb RunAs -WindowStyle Hidden -Environment @{ LARABOXS_API_PORT = "$Port" }
