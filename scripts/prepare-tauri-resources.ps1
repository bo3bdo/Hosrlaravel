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

$helperManifest = Join-Path $repo "helper-service\Cargo.toml"
$helperSvcRelease = Join-Path $repo "helper-service\target\release\laraboxs-helper-svc.exe"
if (Test-Path -LiteralPath $helperManifest) {
  Write-Host "Building native helper service binary..."
  cargo build --release --manifest-path $helperManifest
  if ($LASTEXITCODE -ne 0) {
    throw "cargo build for laraboxs-helper-svc failed with exit code $LASTEXITCODE."
  }
}

if (Test-Path -LiteralPath $helperSvcRelease) {
  Copy-Item -Path $helperSvcRelease -Destination (Join-Path $target "laraboxs-helper-svc.exe") -Force
}

# Bundle install/admin scripts so the NSIS installer can wire up the admin helper.
$installScript = Join-Path $repo "scripts\install-admin-helper.ps1"
if (Test-Path -LiteralPath $installScript) {
  Copy-Item -Path $installScript -Destination (Join-Path $app "install-admin-helper.ps1") -Force
}

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
try {
  npm install --prefix $app --omit=dev --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) {
    throw "npm install exited with code $LASTEXITCODE."
  }
} catch {
  Write-Warning "npm install failed for Tauri resources; copying runtime dependencies from local node_modules."
  $sourceNodeModules = Join-Path $repo "node_modules"
  $targetNodeModules = Join-Path $app "node_modules"
  New-Item -ItemType Directory -Path $targetNodeModules -Force | Out-Null

  $runtimeDependencies = @(
    "extract-zip",
    "debug",
    "ms",
    "get-stream",
    "pump",
    "end-of-stream",
    "once",
    "wrappy",
    "yauzl",
    "buffer-crc32",
    "fd-slicer",
    "pend",
    "selfsigned",
    "pkijs",
    "asn1js",
    "pvtsutils",
    "pvutils",
    "bytestreamjs",
    "reflect-metadata",
    "tslib",
    "tsyringe"
  )

  foreach ($dependency in $runtimeDependencies) {
    $source = Join-Path $sourceNodeModules $dependency
    if (-not (Test-Path $source)) {
      throw "Package $dependency was not found in local node_modules."
    }

    $destination = Join-Path $targetNodeModules $dependency
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -Path $source -Destination $destination -Recurse -Force
  }

  $peculiarSource = Join-Path $sourceNodeModules "@peculiar"
  $peculiarTarget = Join-Path $targetNodeModules "@peculiar"
  New-Item -ItemType Directory -Path $peculiarTarget -Force | Out-Null
  Get-ChildItem -Path $peculiarSource -Directory | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination (Join-Path $peculiarTarget $_.Name) -Recurse -Force
  }
}

Get-ChildItem -Path $target -Force | Select-Object FullName, Length, LastWriteTime
