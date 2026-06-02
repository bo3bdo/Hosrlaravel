import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { loadConfig } from "./config.js";
import { getNginxStatus } from "./nginx.js";
import { getPhpFastCgiStatus, runPhpFastCgi } from "./php.js";
import { appendLog } from "./logging.js";
import { getPaths, mongodbRootForVersion, mysqlRootForVersion, redisRootForVersion } from "./paths.js";
import { downloadFile, downloadsDir, extractZip, mergeSingleExtractedFolder, runtimeStatus } from "./runtimeInstaller.js";
import type { RuntimeInstallProgress, RuntimeInstallStatus, RuntimeKind, RuntimeManifestEntry } from "./types.js";

const mysqlVersions = [
  {
    version: "9.7",
    packageVersion: "9.7.0",
    downloadPath: "MySQL-9.7"
  },
  {
    version: "8.4",
    packageVersion: "8.4.9",
    downloadPath: "MySQL-8.4"
  },
  {
    version: "8.0",
    packageVersion: "8.0.46",
    downloadPath: "MySQL-8.0"
  }
];
const nginxVersion = "1.31.1";
const redisVersion = "8.8";
const redisPackageVersion = "8.8.0";
const mongodbVersion = "8.2";
const mongodbPackageVersion = "8.2.0";
const nodeVersion = "24.16.0";
const runtimeMarkerFile = ".laraboxs-runtime.json";

interface RuntimeInstallMarker {
  schemaVersion: 1;
  kind: RuntimeKind;
  name: string;
  version: string;
  packageVersion?: string;
  downloadUrl: string;
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
    ...mysqlVersions.map((mysql) => {
      const root = mysqlRootForVersion(mysql.version);
      return {
        kind: "mysql" as const,
        name: "MySQL",
        version: mysql.version,
        packageVersion: mysql.packageVersion,
        downloadUrl: `https://cdn.mysql.com/Downloads/${mysql.downloadPath}/mysql-${mysql.packageVersion}-winx64.zip`,
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
      kind: "mongodb",
      name: "MongoDB",
      version: mongodbVersion,
      packageVersion: mongodbPackageVersion,
      downloadUrl: `https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-${mongodbPackageVersion}.zip`,
      archiveType: "zip",
      root: mongodbRootForVersion(mongodbVersion),
      binary: path.join(mongodbRootForVersion(mongodbVersion), "bin", "mongod.exe")
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
  mongodb: RuntimeInstallStatus;
  php: RuntimeInstallStatus[];
  node: RuntimeInstallStatus;
  composer: RuntimeInstallStatus;
} {
  const entries = runtimeManifest();
  const mysql = entries.filter((entry) => entry.kind === "mysql").map(statusFor);
  const nginx = statusFor(requiredEntry(entries, "nginx"));
  const redis = statusFor(requiredEntry(entries, "redis"));
  const mongodb = statusFor(requiredEntry(entries, "mongodb"));
  const php = phpRuntimeStatuses(entries);
  const node = statusFor(requiredEntry(entries, "node"));
  const composer = statusFor(requiredEntry(entries, "composer"));

  return { mysql, nginx, redis, mongodb, php, node, composer };
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

  if (entry.kind === "mongodb" && options.force && (await isActiveMongoDbRuntime(entry)) && (await isMongoDbReachable())) {
    throw new Error("Stop MongoDB before updating the installed runtime.");
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

  report({
    status: "downloading",
    percent: 5,
    message: `Downloading ${entry.name} ${entry.version}.`
  });
  await downloadFile(entry.downloadUrl, downloadPath, "runtime", {
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
    const extractRoot = path.join(downloadsDir(), `${entry.kind}-${entry.version}-extract`);
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

  await writeRuntimeMarker(entry);
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

  if (entry.kind === "mongodb" && (await isActiveMongoDbRuntime(entry)) && (await isMongoDbReachable())) {
    throw new Error("Stop MongoDB before removing the installed runtime.");
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
      (marker.packageVersion !== undefined && typeof marker.packageVersion !== "string")
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

    if (entry.kind === "mongodb") {
      return firstVersion(execRuntimeVersion(entry.binary, ["--version"]), /db version v(\d+(?:\.\d+){1,2})/);
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

async function isMongoDbReachable(): Promise<boolean> {
  const config = await loadConfig();
  return canConnect("127.0.0.1", config.mongodb.port, 250);
}

async function isActiveMysqlRuntime(entry: RuntimeManifestEntry): Promise<boolean> {
  const config = await loadConfig();
  return config.mysql.version === entry.version;
}

async function isActiveRedisRuntime(entry: RuntimeManifestEntry): Promise<boolean> {
  const config = await loadConfig();
  return config.redis.version === entry.version;
}

async function isActiveMongoDbRuntime(entry: RuntimeManifestEntry): Promise<boolean> {
  const config = await loadConfig();
  return config.mongodb.version === entry.version;
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
