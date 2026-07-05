#requires -Version 5.1
<#
  Installs the laraboxs admin helper as a scheduled task running at logon
  with HIGHEST privileges (no per-action UAC prompts after install).
  Idempotent. Intended to run elevated during NSIS install.

  Usage: powershell -File install-admin-helper.ps1 -InstallDir "C:\Program Files\laraboxs"
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InstallDir
)

$ErrorActionPreference = "Stop"

$homeDir = Join-Path $env:USERPROFILE ".config\laraboxs"
$tokenFile = Join-Path $homeDir "admin-helper.token"
$nodeExe = Join-Path $InstallDir "node.exe"
$adminScript = Join-Path $InstallDir "app\dist\admin-helper\server.js"

if (-not (Test-Path -LiteralPath $nodeExe)) {
  Write-Host "install-admin-helper: node.exe not found at $nodeExe; skipping admin helper install."
  exit 0
}
if (-not (Test-Path -LiteralPath $adminScript)) {
  Write-Host "install-admin-helper: admin helper server not found at $adminScript; skipping."
  exit 0
}

New-Item -ItemType Directory -Force -Path $homeDir | Out-Null

# Generate a shared token if missing (read by both the admin helper and the main helper).
if (-not (Test-Path -LiteralPath $tokenFile)) {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $token = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
  [System.IO.File]::WriteAllText($tokenFile, $token)
  Write-Host "install-admin-helper: generated admin helper token."
}

# Add a Defender exclusion for the data dir so runtimes/sites are not scanned (silent, elevated).
try {
  if (Get-Command Add-MpPreference -ErrorAction SilentlyContinue) {
    Add-MpPreference -ExclusionPath $homeDir -ErrorAction SilentlyContinue
  }
} catch {
  Write-Host "install-admin-helper: could not add Defender exclusion (non-fatal)."
}

$taskName = "LaraboxsAdminHelper"
$action = New-ScheduledTaskAction -Execute $nodeExe -Argument "`"$adminScript`"" -WorkingDirectory $InstallDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERDOMAIN\$env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERDOMAIN\$env:USERNAME -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Hours 0)

try {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
} catch {
  # not present
}

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "install-admin-helper: registered scheduled task '$taskName' (RunLevel Highest, AtLogon)."

# Start it immediately so the first-run setup can use it without waiting for next logon.
try {
  Start-ScheduledTask -TaskName $taskName
  Write-Host "install-admin-helper: started scheduled task."
} catch {
  Write-Host "install-admin-helper: could not start task immediately (will run at next logon)."
}

exit 0
