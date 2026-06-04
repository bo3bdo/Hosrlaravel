import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { loadConfig } from "./config.js";
import { getNginxStatus } from "./nginx.js";
import { getPhpFastCgiStatus, runPhpFastCgi } from "./php.js";
import { appendLog } from "./logging.js";
import { getPaths, mysqlRootForVersion, redisRootForVersion } from "./paths.js";
import { downloadFile, downloadsDir, extractZip, mergeSingleExtractedFolder, runtimeStatus } from "./runtimeInstaller.js";
import type { RuntimeInstallProgress, RuntimeInstallStatus, RuntimeKind, RuntimeManifestEntry } from "./types.js";

const mysqlVersions = [
  {
    name: "MySQL",
    version: "9.7",
    packageVersion: "9.7.0",
    downloadUrl: "https://cdn.mysql.com/Downloads/MySQL-9.7/mysql-9.7.0-winx64.zip"
  },
  {
    name: "MySQL",
    version: "8.4",
    packageVersion: "8.4.9",
    downloadUrl: "https://cdn.mysql.com/Downloads/MySQL-8.4/mysql-8.4.9-winx64.zip"
  },
  {
    name: "MySQL",
    version: "8.0",
    packageVersion: "8.0.46",
    downloadUrl: "https://cdn.mysql.com/Downloads/MySQL-8.0/mysql-8.0.46-winx64.zip"
  },
  {
    name: "MariaDB",
    version: "mariadb-11.8.6",
    packageVersion: "11.8.6",
    downloadUrl: "https://archive.mariadb.org/mariadb-11.8.6/winx64-packages/mariadb-11.8.6-winx64.zip"
  }
];
const nginxVersion = "1.31.1";
const redisVersion = "8.8";
const redisPackageVersion = "8.8.0";
const nodeVersion = "24.16.0";
const runtimeMarkerFile = ".laraboxs-runtime.json";

interface RuntimeInstallMarker {
  schemaVersion: 1;
  kind: RuntimeKind;
  name: string;
  version: string;
  packageVersion?: string;
  downloadUrl: string;
  checksumSha256?: string;
  installedAt: string;
}

export function runtimeManifest(): RuntimeManifestEntry[] {
  const paths = getPaths();
  const nodeRoot = path.join(paths.home, "runtimes", "node", nodeVersion);
  const composerRoot = path.join(paths.home, "runtimes", "composer");

  return [
    {
      kind: "php",
      name: "PHP",
      version: "8.4",
      packageVersion: "8.4.21",
      downloadUrl: "https://downloads.php.net/~windows/releases/latest/php-8.4-nts-Win32-vs17-x64-latest.zip",
      archiveType: "zip",
      root: path.join(paths.phpRoot, "8.4"),
      binary: path.join(paths.phpRoot, "8.4", "php.exe")
    },
    {
      kind: "php",
      name: "PHP",
      version: "8.5",
      packageVersion: "8.5.6",
      downloadUrl: "https://downloads.php.net/~windows/releases/latest/php-8.5-nts-Win32-vs17-x64-latest.zip",
      archiveType: "zip",
      root: path.join(paths.phpRoot, "8.5"),
      binary: path.join(paths.phpRoot, "8.5", "php.exe")
    },
    ...mysqlVersions.map((database) => {
      const root = mysqlRootForVersion(database.version);
      return {
        kind: "mysql" as const,
        name: database.name,
        version: database.version,
        packageVersion: database.packageVersion,
        downloadUrl: database.downloadUrl,
        archiveType: "zip" as const,
        root,
        binary: path.join(root, "bin", "mysqld.exe")
      };
    }),
    {
      kind: "nginx",
      name: "Nginx",
      version: nginxVersion,
      packageVersion: nginxVersion,
      downloadUrl: `https://nginx.org/download/nginx-${nginxVersion}.zip`,
      archiveType: "zip",
      root: paths.nginxRoot,
      binary: path.join(paths.nginxRoot, "nginx.exe")
    },
    {
      kind: "redis",
      name: "Redis",
      version: redisVersion,
      packageVersion: redisPackageVersion,
      downloadUrl: `https://github.com/redis-windows/redis-windows/releases/download/${redisPackageVersion}/Redis-${redisPackageVersion}-Windows-x64-msys2.zip`,
      archiveType: "zip",
      root: redisRootForVersion(redisVersion),
      binary: path.join(redisRootForVersion(redisVersion), "redis-server.exe")
    },
    {
      kind: "node",
      name: "Node.js",
      version: "24",
      packageVersion: nodeVersion,
      downloadUrl: `https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-win-x64.zip`,
      archiveType: "zip",
      root: nodeRoot,
      binary: path.join(nodeRoot, "node.exe")
    },
    {
      kind: "composer",
      name: "Composer",
      version: "stable",
      packageVersion: "2.10.0",
      downloadUrl: "https://getcomposer.org/composer-stable.phar",
      archiveType: "file",
      root: composerRoot,
      binary: path.join(composerRoot, "composer.phar")
    }
  ];
}

export function getRuntimeStatus(): {
  mysql: RuntimeInstallStatus[];
  nginx: RuntimeInstallStatus;
  redis: RuntimeInstallStatus;
  php: RuntimeInstallStatus[];
  node: RuntimeInstallStatus;
  composer: RuntimeInstallStatus;
} {
  const entries = runtimeManifest();
  const mysql = entries.filter((entry) => entry.kind === "mysql").map(statusFor);
  const nginx = statusFor(requiredEntry(entries, "nginx"));
  const redis = statusFor(requiredEntry(entries, "redis"));
  const php = phpRuntimeStatuses(entries);
  const node = statusFor(requiredEntry(entries, "node"));
  const composer = statusFor(requiredEntry(entries, "composer"));

  return { mysql, nginx, redis, php, node, composer };
}

export interface InstallRuntimeOptions {
  force?: boolean;
  onProgress?: (progress: RuntimeInstallProgress) => void;
}

export async function installRuntime(kind: RuntimeKind, version?: string, options: InstallRuntimeOptions = {}): Promise<RuntimeInstallStatus> {
  const entry = findRuntimeEntry(kind, version);
  const currentStatus = statusFor(entry);
  const report = (progress: RuntimeInstallProgress) => {
    options.onProgress?.({ ...progress, percent: clampPercent(progress.percent) });
  };

  if (currentStatus.installed && !options.force) {
    await appendLog("runtime", `${entry.name} ${entry.version} already installed at ${entry.root}`);
    report({
      status: "complete",
      percent: 100,
      message: currentStatus.updateAvailable
        ? `${entry.name} ${entry.version} has an update available.`
        : `${entry.name} ${entry.version} is already installed.`
    });
    return currentStatus;
  }

  if (entry.kind === "mysql" && options.force && (await isActiveMysqlRuntime(entry)) && (await isMysqlReachable())) {
    throw new Error("Stop MySQL before updating the installed runtime.");
  }

  if (entry.kind === "nginx" && options.force && isNginxRunning()) {
    throw new Error("Stop Nginx before updating the installed runtime.");
  }

  if (entry.kind === "redis" && options.force && (await isActiveRedisRuntime(entry)) && (await isRedisReachable())) {
    throw new Error("Stop Redis before updating the installed runtime.");
  }

  if (entry.kind === "php" && options.force && (await getPhpFastCgiStatus()).state !== "stopped") {
    await runPhpFastCgi("stop");
  }

  report({
    status: "queued",
    percent: 0,
    message: `Preparing ${entry.name} ${entry.version}.`
  });
  await mkdir(entry.root, { recursive: true });
  await mkdir(downloadsDir(), { recursive: true });
  const downloadName = `${entry.kind}-${entry.version}.${entry.archiveType === "zip" ? "zip" : "download"}`;
  const downloadPath = path.join(downloadsDir(), downloadName);
  const downloadEndPercent = entry.archiveType === "zip" ? 78 : 90;
  let extractRoot: string | undefined;

  try {
    report({
      status: "downloading",
      percent: 5,
      message: `Downloading ${entry.name} ${entry.version}.`
    });
    await downloadFile(entry.downloadUrl, downloadPath, "runtime", {
      checksumSha256: entry.checksumSha256,
      retries: 2,
      onProgress: (progress) => {
        report({
          status: "downloading",
          percent: scalePercent(progress.percent ?? 0, 5, downloadEndPercent),
          message: `Downloading ${entry.name} ${entry.version}.`,
          bytesDownloaded: progress.bytesDownloaded,
          totalBytes: progress.totalBytes,
          etaSeconds: progress.etaSeconds
        });
      }
    });

    if (entry.archiveType === "zip") {
      extractRoot = path.join(downloadsDir(), `${entry.kind}-${entry.version}-extract`);
      await rm(extractRoot, { recursive: true, force: true });
      report({
        status: "extracting",
        percent: 82,
        message: `Extracting ${entry.name} ${entry.version}.`
      });
      await extractZip(downloadPath, extractRoot, "runtime");
      report({
        status: "installing",
        percent: 95,
        message: `Finalizing ${entry.name} ${entry.version}.`
      });
      await mergeSingleExtractedFolder(extractRoot, entry.root);
    } else {
      await mkdir(entry.root, { recursive: true });
      const { copyFile } = await import("node:fs/promises");
      report({
        status: "installing",
        percent: 95,
        message: `Finalizing ${entry.name} ${entry.version}.`
      });
      await copyFile(downloadPath, entry.binary);
    }
  } catch (error) {
    if (extractRoot) {
      await rm(extractRoot, { recursive: true, force: true }).catch(() => undefined);
    }
    throw error;
  }

  await writeRuntimeMarker(entry);
  if (entry.kind === "php") {
    report({
      status: "installing",
      percent: 97,
      message: `Installing default PHP extensions for ${entry.name} ${entry.version}.`
    });
    const { installDefaultPhpExtensions } = await import("./phpExtensions.js");
    const statuses = await installDefaultPhpExtensions(entry.version);
    const failed = statuses.find((status) => !status.installed || !/loaded by PHP/i.test(status.message ?? ""));
    if (failed) {
      throw new Error(failed.message ?? `Could not install PHP ${entry.version} extension ${failed.extension}.`);
    }
  }
  if (entry.kind === "node" || entry.kind === "composer") {
    await ensureDeveloperCommandPath();
  }
  await appendLog("runtime", `${entry.name} ${entry.version} installed at ${entry.root}`);
  report({
    status: "complete",
    percent: 100,
    message: `${entry.name} ${entry.version} installed.`
  });
  return statusFor(entry);
}

export async function uninstallRuntime(kind: RuntimeKind, version?: string): Promise<RuntimeInstallStatus> {
  const entry = findRuntimeEntry(kind, version);

  if (entry.kind === "mysql" && (await isActiveMysqlRuntime(entry)) && (await isMysqlReachable())) {
    throw new Error("Stop MySQL before removing the installed runtime.");
  }

  if (entry.kind === "nginx" && isNginxRunning()) {
    throw new Error("Stop Nginx before removing the installed runtime.");
  }

  if (entry.kind === "redis" && (await isActiveRedisRuntime(entry)) && (await isRedisReachable())) {
    throw new Error("Stop Redis before removing the installed runtime.");
  }

  if (entry.kind === "php" && (await getPhpFastCgiStatus()).state !== "stopped") {
    await runPhpFastCgi("stop");
  }

  assertAppLocalRuntimeRoot(entry.root);
  await rm(entry.root, { recursive: true, force: true });
  await rm(runtimeDownloadPath(entry), { force: true });
  await appendLog("runtime", `${entry.name} ${entry.version} removed from ${entry.root}`);
  return statusFor(entry);
}

export async function ensureDeveloperCommandPath(): Promise<string[]> {
  const entries = developerCommandPathEntries();

  try {
    await ensureComposerCommandShims();
    if (process.platform !== "win32" || shouldSkipPathUpdate()) {
      return entries;
    }

    const currentUserPath = readWindowsUserPath();
    const nextUserPath = mergePathEntries(currentUserPath, entries);
    if (nextUserPath !== currentUserPath) {
      writeWindowsUserPath(nextUserPath);
      appendProcessPath(entries);
      await appendLog("runtime", `added developer tools to user PATH: ${entries.join("; ")}`);
    }
  } catch (error) {
    await appendLog("runtime", `failed to update developer PATH: ${error instanceof Error ? error.message : String(error)}`);
  }

  return entries;
}

export function developerCommandPathEntries(): string[] {
  const entries = runtimeManifest();
  const node = requiredEntry(entries, "node");
  const composer = requiredEntry(entries, "composer");
  return [node, composer].filter((entry) => existsSync(entry.binary)).map((entry) => entry.root);
}

export async function ensureComposerCommandShims(): Promise<void> {
  const composer = findRuntimeEntry("composer");
  if (!existsSync(composer.binary)) {
    return;
  }

  await mkdir(composer.root, { recursive: true });
  const shim = composerCommandShim();
  await Promise.all([
    writeFile(path.join(composer.root, "composer.bat"), shim, "utf8"),
    writeFile(path.join(composer.root, "composer.cmd"), shim, "utf8")
  ]);
}

export function mergePathEntries(currentPath: string, entries: string[]): string {
  const parts = currentPath
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  const preferredEntries = Array.from(new Map(entries.map((entry) => [normalizePathForComparison(entry), entry])).values());
  const preferred = new Set(preferredEntries.map((entry) => normalizePathForComparison(entry)));
  const remaining = parts.filter((part) => !preferred.has(normalizePathForComparison(part)));
  return [...preferredEntries, ...remaining].join(";");
}

function composerCommandShim(): string {
  return [
    "@echo off",
    "setlocal",
    "set \"LARABOXS_RUNTIME_HOME=%~dp0..\\..\"",
    "set \"LARABOXS_PHP=\"",
    "for /f \"delims=\" %%P in ('dir /b /ad \"%LARABOXS_RUNTIME_HOME%\\runtimes\\php\" 2^>nul ^| sort /r') do (",
    "  if exist \"%LARABOXS_RUNTIME_HOME%\\runtimes\\php\\%%P\\php.exe\" (",
    "    set \"LARABOXS_PHP=%LARABOXS_RUNTIME_HOME%\\runtimes\\php\\%%P\\php.exe\"",
    "    goto laraboxs_php_found",
    "  )",
    ")",
    ":laraboxs_php_found",
    "if not defined LARABOXS_PHP set \"LARABOXS_PHP=php\"",
    "\"%LARABOXS_PHP%\" \"%~dp0composer.phar\" %*",
    "exit /b %ERRORLEVEL%",
    ""
  ].join("\r\n");
}

function readWindowsUserPath(): string {
  const result = spawnPowerShell("[Environment]::GetEnvironmentVariable('Path', 'User')");
  return result.stdout.trim();
}

function writeWindowsUserPath(nextPath: string): void {
  const script = [
    "[Environment]::SetEnvironmentVariable('Path', $env:LARABOXS_USER_PATH, 'User')",
    "$signature = '[DllImport(\"user32.dll\", SetLastError=true, CharSet=CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);'",
    "Add-Type -MemberDefinition $signature -Name NativeMethods -Namespace Win32 -ErrorAction SilentlyContinue",
    "$result = [UIntPtr]::Zero",
    "[void][Win32.NativeMethods]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)"
  ].join("; ");
  spawnPowerShell(script, { LARABOXS_USER_PATH: nextPath });
}

function spawnPowerShell(command: string, env: Record<string, string> = {}): { stdout: string } {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ...env }
  });
  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `PowerShell exited with ${result.status}`).trim());
  }
  return { stdout: result.stdout ?? "" };
}

function appendProcessPath(entries: string[]): void {
  const key = process.platform === "win32" ? "Path" : "PATH";
  const current = process.env[key] ?? process.env.PATH ?? "";
  process.env[key] = mergePathEntries(current, entries);
}

function shouldSkipPathUpdate(): boolean {
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test" || process.env.LARABOXS_SKIP_PATH_UPDATE === "1";
}

function normalizePathForComparison(value: string): string {
  return path.resolve(value).replace(/[\\/]+$/g, "").toLowerCase();
}

export function findRuntimeEntry(kind: RuntimeKind, version?: string): RuntimeManifestEntry {
  const entry = runtimeManifest().find((candidate) => {
    return candidate.kind === kind && (version ? candidate.version === version : true);
  });

  if (!entry) {
    throw new Error(`Unsupported runtime: ${kind}${version ? ` ${version}` : ""}`);
  }

  return entry;
}

function requiredEntry(entries: RuntimeManifestEntry[], kind: RuntimeKind): RuntimeManifestEntry {
  const entry = entries.find((candidate) => candidate.kind === kind);
  if (!entry) {
    throw new Error(`Missing runtime manifest entry: ${kind}`);
  }
  return entry;
}

function statusFor(entry: RuntimeManifestEntry): RuntimeInstallStatus {
  const status = runtimeStatus(entry.name, entry.version, entry.root, entry.binary, entry.downloadUrl);
  const marker = status.installed ? runtimeMarkerForInstalledEntry(entry) : undefined;
  return {
    ...status,
    installedDownloadUrl: marker?.downloadUrl,
    installedPackageVersion: marker?.packageVersion,
    installedAt: marker?.installedAt,
    updateAvailable: status.installed && marker ? runtimeNeedsUpdate(entry, marker) : false
  };
}

function phpRuntimeStatuses(entries: RuntimeManifestEntry[]): RuntimeInstallStatus[] {
  const manifestPhp = entries.filter((entry) => entry.kind === "php");
  const byVersion = new Map<string, RuntimeInstallStatus>();

  for (const entry of manifestPhp) {
    byVersion.set(entry.version, statusFor(entry));
  }

  for (const entry of discoverInstalledPhpRuntimeEntries(manifestPhp)) {
    if (!byVersion.has(entry.version)) {
      byVersion.set(entry.version, statusForDiscoveredPhpRuntime(entry));
    }
  }

  return Array.from(byVersion.values()).sort((left, right) => compareRuntimeVersions(left.version, right.version));
}

function discoverInstalledPhpRuntimeEntries(knownEntries: RuntimeManifestEntry[]): RuntimeManifestEntry[] {
  const paths = getPaths();
  const knownRoots = new Set(knownEntries.map((entry) => path.resolve(entry.root).toLowerCase()));

  try {
    return readdirSync(paths.phpRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => {
        const root = path.join(paths.phpRoot, entry.name);
        return {
          kind: "php" as const,
          name: "PHP",
          version: entry.name,
          downloadUrl: "",
          archiveType: "zip" as const,
          root,
          binary: path.join(root, "php.exe")
        };
      })
      .filter((entry) => !knownRoots.has(path.resolve(entry.root).toLowerCase()) && existsSync(entry.binary));
  } catch {
    return [];
  }
}

function statusForDiscoveredPhpRuntime(entry: RuntimeManifestEntry): RuntimeInstallStatus {
  const status = runtimeStatus(entry.name, entry.version, entry.root, entry.binary);
  return {
    ...status,
    installedPackageVersion: status.installed ? detectInstalledPackageVersion(entry) : undefined,
    updateAvailable: false
  };
}

function runtimeDownloadPath(entry: RuntimeManifestEntry): string {
  const downloadName = `${entry.kind}-${entry.version}.${entry.archiveType === "zip" ? "zip" : "download"}`;
  return path.join(downloadsDir(), downloadName);
}

function runtimeMarkerPath(entry: RuntimeManifestEntry): string {
  return path.join(entry.root, runtimeMarkerFile);
}

async function writeRuntimeMarker(entry: RuntimeManifestEntry): Promise<void> {
  const marker = runtimeMarker(entry);
  await mkdir(entry.root, { recursive: true });
  await writeFile(runtimeMarkerPath(entry), `${JSON.stringify(marker, null, 2)}\n`, "utf8");
}

function runtimeMarker(entry: RuntimeManifestEntry, packageVersion = entry.packageVersion): RuntimeInstallMarker {
  const marker: RuntimeInstallMarker = {
    schemaVersion: 1,
    kind: entry.kind,
    name: entry.name,
    version: entry.version,
    downloadUrl: entry.downloadUrl,
    installedAt: new Date().toISOString()
  };
  if (packageVersion) {
    marker.packageVersion = packageVersion;
  }
  if (entry.checksumSha256) {
    marker.checksumSha256 = entry.checksumSha256;
  }
  return marker;
}

function readRuntimeMarker(entry: RuntimeManifestEntry): RuntimeInstallMarker | undefined {
  try {
    const marker = JSON.parse(readFileSync(runtimeMarkerPath(entry), "utf8")) as Partial<RuntimeInstallMarker>;
    if (
      marker.schemaVersion !== 1 ||
      marker.kind !== entry.kind ||
      marker.version !== entry.version ||
      typeof marker.downloadUrl !== "string" ||
      typeof marker.installedAt !== "string" ||
      (marker.packageVersion !== undefined && typeof marker.packageVersion !== "string") ||
      (marker.checksumSha256 !== undefined && typeof marker.checksumSha256 !== "string")
    ) {
      return undefined;
    }
    return marker as RuntimeInstallMarker;
  } catch {
    return undefined;
  }
}

function runtimeMarkerForInstalledEntry(entry: RuntimeManifestEntry): RuntimeInstallMarker {
  const marker = readRuntimeMarker(entry);
  if (!marker) {
    return writeRuntimeMarkerSyncBestEffort(entry, runtimeMarker(entry, detectInstalledPackageVersion(entry) ?? entry.packageVersion));
  }

  if (!marker.packageVersion) {
    const detectedPackageVersion = detectInstalledPackageVersion(entry);
    if (detectedPackageVersion) {
      return writeRuntimeMarkerSyncBestEffort(entry, { ...marker, packageVersion: detectedPackageVersion });
    }
  }

  return marker;
}

function writeRuntimeMarkerSyncBestEffort(entry: RuntimeManifestEntry, marker: RuntimeInstallMarker): RuntimeInstallMarker {
  try {
    mkdirSync(entry.root, { recursive: true });
    writeFileSync(runtimeMarkerPath(entry), `${JSON.stringify(marker, null, 2)}\n`, "utf8");
    return marker;
  } catch {
    return marker;
  }
}

function runtimeNeedsUpdate(entry: RuntimeManifestEntry, marker: RuntimeInstallMarker): boolean {
  if (entry.checksumSha256 && marker.checksumSha256 !== entry.checksumSha256) {
    return true;
  }

  if (entry.packageVersion && marker.packageVersion) {
    const comparison = compareDottedVersions(marker.packageVersion, entry.packageVersion);
    return comparison === undefined ? marker.packageVersion !== entry.packageVersion : comparison < 0;
  }

  return marker.downloadUrl !== entry.downloadUrl;
}

function detectInstalledPackageVersion(entry: RuntimeManifestEntry): string | undefined {
  try {
    if (entry.kind === "php") {
      return firstVersion(execRuntimeVersion(entry.binary, ["-v"]), /^PHP\s+(\d+(?:\.\d+){1,2})/);
    }

    if (entry.kind === "mysql") {
      return firstVersion(execRuntimeVersion(entry.binary, ["--version"]), /\bVer\s+(\d+(?:\.\d+){1,2})\b/);
    }

    if (entry.kind === "nginx") {
      return firstVersion(execRuntimeVersion(entry.binary, ["-v"]), /nginx\/(\d+(?:\.\d+){1,2})/);
    }

    if (entry.kind === "redis") {
      return firstVersion(execRuntimeVersion(entry.binary, ["--version"]), /v=(\d+(?:\.\d+){1,2})/);
    }

    if (entry.kind === "node") {
      return firstVersion(execRuntimeVersion(entry.binary, ["--version"]), /^v?(\d+(?:\.\d+){1,2})/);
    }

    if (entry.kind === "composer") {
      return firstVersion(execComposerVersion(entry), /Composer(?:\s+version)?\s+(\d+(?:\.\d+){1,2}(?:[-\w.]+)?)/i);
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function execRuntimeVersion(binary: string, args: string[]): string {
  const result = spawnSync(binary, args, { encoding: "utf8", timeout: 2500, windowsHide: true });
  if (result.error) {
    throw result.error;
  }
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function execComposerVersion(entry: RuntimeManifestEntry): string {
  for (const phpBinary of composerPhpCandidates()) {
    if (!existsSync(phpBinary)) {
      continue;
    }

    const result = spawnSync(phpBinary, [entry.binary, "--version", "--no-ansi"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      env: runtimeVersionEnv()
    });
    if (!result.error && result.status === 0) {
      return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    }
  }

  try {
    return readFileSync(entry.binary, "utf8");
  } catch {
    return "";
  }
}

function composerPhpCandidates(): string[] {
  const paths = getPaths();
  return [path.join(paths.phpRoot, "8.5", "php.exe"), path.join(paths.phpRoot, "8.4", "php.exe")];
}

function runtimeVersionEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  return env;
}

function firstVersion(output: string, pattern: RegExp): string | undefined {
  return output.match(pattern)?.[1];
}

function compareDottedVersions(left: string, right: string): number | undefined {
  const leftParts = numericVersionParts(left);
  const rightParts = numericVersionParts(right);
  if (!leftParts || !rightParts) {
    return undefined;
  }

  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function compareRuntimeVersions(left: string, right: string): number {
  return compareDottedVersions(left, right) ?? left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function numericVersionParts(version: string): number[] | undefined {
  const match = version.match(/^\d+(?:\.\d+)*$/);
  if (!match) {
    return undefined;
  }
  return version.split(".").map((part) => Number(part));
}

function assertAppLocalRuntimeRoot(root: string): void {
  const home = path.resolve(getPaths().home);
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(home, resolvedRoot);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative === "") {
    throw new Error(`Refusing to remove a runtime outside laraboxs app data: ${root}`);
  }
}

async function isMysqlReachable(): Promise<boolean> {
  const config = await loadConfig();
  return canConnect("127.0.0.1", config.mysql.port, 250);
}

async function isRedisReachable(): Promise<boolean> {
  const config = await loadConfig();
  return canConnect("127.0.0.1", config.redis.port, 250);
}

async function isActiveMysqlRuntime(entry: RuntimeManifestEntry): Promise<boolean> {
  const config = await loadConfig();
  return config.mysql.version === entry.version;
}

async function isActiveRedisRuntime(entry: RuntimeManifestEntry): Promise<boolean> {
  const config = await loadConfig();
  return config.redis.version === entry.version;
}

function isNginxRunning(): boolean {
  return getNginxStatus().state === "running";
}

function canConnect(host: string, port: number, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function scalePercent(percent: number, start: number, end: number): number {
  return start + (clampPercent(percent) / 100) * (end - start);
}

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) {
    return 0;
  }
  return Math.min(100, Math.max(0, percent));
}
