param(
  [string]$Output = "src-tauri\resources"
)

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$target = if ([System.IO.Path]::IsPathRooted($Output)) { $Output } else { Join-Path $repo $Output }
$app = Join-Path $target "app"
$node = (Get-Command node -ErrorAction Stop).Source

if (-not (Test-Path (Join-Path $repo "dist"))) {
  throw "dist was not found. Run npm run build before preparing Tauri resources."
}

if (-not (Test-Path (Join-Path $repo "dist-ui"))) {
  throw "dist-ui was not found. Run npm run build before preparing Tauri resources."
}

Remove-Item $target -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $app -Force | Out-Null

Copy-Item -Path (Join-Path $repo "dist") -Destination (Join-Path $app "dist") -Recurse -Force
Copy-Item -Path (Join-Path $repo "dist-ui") -Destination (Join-Path $app "dist-ui") -Recurse -Force
Copy-Item -Path $node -Destination (Join-Path $target "node.exe") -Force

$rootPackage = Get-Content (Join-Path $repo "package.json") -Raw | ConvertFrom-Json
$payloadPackage = [ordered]@{
  name = "laraboxs-tauri-runtime"
  version = $rootPackage.version
  private = $true
  type = "module"
  dependencies = [ordered]@{
    "extract-zip" = $rootPackage.dependencies."extract-zip"
    "selfsigned" = $rootPackage.dependencies.selfsigned
  }
}

$payloadPackage | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $app "package.json") -Encoding ASCII
npm install --prefix $app --omit=dev --ignore-scripts --no-audit --no-fund

Get-ChildItem -Path $target -Force | Select-Object FullName, Length, LastWriteTime
