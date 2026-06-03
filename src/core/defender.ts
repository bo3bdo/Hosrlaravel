import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { appendLog } from "./logging.js";
import { getPaths } from "./paths.js";

export interface DefenderExclusionStatus {
  path: string;
  platform: NodeJS.Platform;
  supported: boolean;
  excluded: boolean;
  changed: boolean;
  skipped?: boolean;
  message: string;
}

const elevatedAlreadyCoveredExitCode = 10;
const defenderUnavailableExitCode = 2;

export async function tryEnsureWindowsDefenderExclusion(targetPath: string): Promise<DefenderExclusionStatus> {
  const resolved = path.resolve(targetPath);

  try {
    return await ensureWindowsDefenderExclusion(resolved);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendLog("defender", `failed to add Windows Defender exclusion for ${resolved}: ${message}`);
    return {
      path: resolved,
      platform: process.platform,
      supported: process.platform === "win32",
      excluded: false,
      changed: false,
      message: `Windows Defender exclusion was not added: ${message}`
    };
  }
}

export async function ensureWindowsDefenderExclusion(targetPath: string): Promise<DefenderExclusionStatus> {
  const resolved = path.resolve(targetPath);

  if (process.platform !== "win32") {
    return {
      path: resolved,
      platform: process.platform,
      supported: false,
      excluded: false,
      changed: false,
      skipped: true,
      message: "Windows Defender exclusions are only supported on Windows."
    };
  }

  if (shouldSkipDefenderAutomation()) {
    return {
      path: resolved,
      platform: process.platform,
      supported: true,
      excluded: false,
      changed: false,
      skipped: true,
      message: "Windows Defender exclusion automation skipped."
    };
  }

  let existing: string[] | undefined;
  try {
    const preference = await readDefenderExclusionPaths();
    if (!preference.supported) {
      await appendLog("defender", preference.message);
      return {
        path: resolved,
        platform: process.platform,
        supported: false,
        excluded: false,
        changed: false,
        skipped: true,
        message: preference.message
      };
    }
    existing = preference.paths;
  } catch (error) {
    await appendLog("defender", `could not read Windows Defender exclusions before update: ${errorMessage(error)}`);
  }

  if (existing?.some((exclusionPath) => isPathCoveredByExclusion(resolved, exclusionPath))) {
    await appendLog("defender", `Windows Defender exclusion already covers ${resolved}`);
    return {
      path: resolved,
      platform: process.platform,
      supported: true,
      excluded: true,
      changed: false,
      message: "Windows Defender exclusion already exists."
    };
  }

  const scriptPath = await writeDefenderExclusionScript(resolved);
  await appendLog("defender", `requesting Windows Defender exclusion for ${resolved}`);
  const code = await runElevatedPowerShell(scriptPath);

  if (code === 0) {
    await appendLog("defender", `Windows Defender exclusion added for ${resolved}`);
    return {
      path: resolved,
      platform: process.platform,
      supported: true,
      excluded: true,
      changed: true,
      message: "Windows Defender exclusion added."
    };
  }

  if (code === elevatedAlreadyCoveredExitCode) {
    await appendLog("defender", `Windows Defender exclusion already covers ${resolved}`);
    return {
      path: resolved,
      platform: process.platform,
      supported: true,
      excluded: true,
      changed: false,
      message: "Windows Defender exclusion already exists."
    };
  }

  if (code === defenderUnavailableExitCode) {
    const message = "Windows Defender PowerShell cmdlets are not available on this system.";
    await appendLog("defender", message);
    return {
      path: resolved,
      platform: process.platform,
      supported: false,
      excluded: false,
      changed: false,
      skipped: true,
      message
    };
  }

  throw new Error("Administrator approval is required to add Windows Defender exclusions.");
}

export function isPathCoveredByExclusion(targetPath: string, exclusionPath: string): boolean {
  const target = normalizePathForDefenderCompare(targetPath);
  const exclusion = normalizePathForDefenderCompare(exclusionPath);
  return target === exclusion || target.startsWith(`${exclusion}${path.sep}`);
}

export function renderDefenderExclusionScript(targetPath: string): string {
  return [
    '$ErrorActionPreference = "Stop"',
    "if (-not (Get-Command Get-MpPreference -ErrorAction SilentlyContinue)) { exit 2 }",
    `$target = [System.IO.Path]::GetFullPath('${escapePowerShellString(targetPath)}')`,
    "function Normalize-LaraboxsPath([string]$value) {",
    "  try {",
    "    $resolved = [System.IO.Path]::GetFullPath($value)",
    "    $root = [System.IO.Path]::GetPathRoot($resolved)",
    "    while ($resolved.Length -gt $root.Length -and ($resolved.EndsWith('\\') -or $resolved.EndsWith('/'))) {",
    "      $resolved = $resolved.Substring(0, $resolved.Length - 1)",
    "    }",
    "    return $resolved",
    "  } catch {",
    "    return $null",
    "  }",
    "}",
    "function Test-LaraboxsPathCovered([string]$targetPath, [string]$exclusionPath) {",
    "  $targetNorm = Normalize-LaraboxsPath $targetPath",
    "  $exclusionNorm = Normalize-LaraboxsPath $exclusionPath",
    "  if (-not $targetNorm -or -not $exclusionNorm) { return $false }",
    "  if ([string]::Equals($targetNorm, $exclusionNorm, [StringComparison]::OrdinalIgnoreCase)) { return $true }",
    "  $prefix = $exclusionNorm",
    "  if (-not $prefix.EndsWith('\\') -and -not $prefix.EndsWith('/')) { $prefix = $prefix + '\\' }",
    "  return $targetNorm.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)",
    "}",
    "$existing = @((Get-MpPreference).ExclusionPath) | Where-Object { $_ }",
    "foreach ($item in $existing) {",
    "  if (Test-LaraboxsPathCovered $target ([string]$item)) { exit 10 }",
    "}",
    "Add-MpPreference -ExclusionPath $target -ErrorAction Stop",
    "exit 0"
  ].join("\n");
}

async function readDefenderExclusionPaths(): Promise<{ supported: boolean; paths: string[]; message: string }> {
  const result = await runHiddenPowerShell(
    [
      '$ErrorActionPreference = "Stop"',
      "if (-not (Get-Command Get-MpPreference -ErrorAction SilentlyContinue)) { exit 2 }",
      "$paths = @((Get-MpPreference).ExclusionPath | Where-Object { $_ })",
      "ConvertTo-Json -InputObject $paths -Compress"
    ].join("; "),
    5_000
  );

  if (result.code === defenderUnavailableExitCode) {
    return {
      supported: false,
      paths: [],
      message: "Windows Defender PowerShell cmdlets are not available on this system."
    };
  }

  if (result.code !== 0) {
    throw new Error((result.stderr || result.stdout || `PowerShell exited with ${result.code}`).trim());
  }

  const raw = result.stdout.trim();
  if (!raw) {
    return { supported: true, paths: [], message: "Windows Defender exclusions loaded." };
  }

  const parsed = JSON.parse(raw) as unknown;
  return {
    supported: true,
    paths: Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : typeof parsed === "string" ? [parsed] : [],
    message: "Windows Defender exclusions loaded."
  };
}

async function writeDefenderExclusionScript(targetPath: string): Promise<string> {
  const paths = getPaths();
  const scriptPath = path.join(paths.home, "add-defender-exclusion-elevated.ps1");
  await mkdir(paths.home, { recursive: true });
  await writeFile(scriptPath, renderDefenderExclusionScript(targetPath), "utf8");
  return scriptPath;
}

function runElevatedPowerShell(scriptPath: string): Promise<number> {
  const command = [
    `$script = '${escapePowerShellString(scriptPath)}'`,
    "$process = Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$script) -Verb RunAs -Wait -PassThru -WindowStyle Hidden",
    "exit $process.ExitCode"
  ].join("; ");

  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    stdio: "ignore",
    shell: false,
    windowsHide: true
  });

  return new Promise((resolve) => {
    child.once("error", () => resolve(1));
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

function runHiddenPowerShell(command: string, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true
  });

  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        resolve({ code: 1, stdout, stderr: stderr || "PowerShell timed out." });
      }
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ code: 1, stdout, stderr: error.message });
      }
    });
    child.once("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ code: code ?? 1, stdout, stderr });
      }
    });
  });
}

function normalizePathForDefenderCompare(value: string): string {
  const resolved = path.resolve(value);
  const root = path.parse(resolved).root;
  let normalized = resolved;
  while (normalized.length > root.length && /[\\/]$/.test(normalized)) {
    normalized = normalized.slice(0, -1);
  }
  return normalized.toLowerCase();
}

function shouldSkipDefenderAutomation(): boolean {
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test" || process.env.LARABOXS_SKIP_DEFENDER_EXCLUSION === "1";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapePowerShellString(value: string): string {
  return value.replace(/'/g, "''");
}
