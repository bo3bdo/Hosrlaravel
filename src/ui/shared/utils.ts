import { fetchRuntimeInstallJob, getJson } from "../apiClient.js";
import type {
  DashboardSummary,
  LaravelInstallerStatus,
  RuntimeInstallJob,
  RuntimeInstallStatus,
  RuntimeKind,
  SiteCommandJob
} from "../types.js";
import type { DatabaseEngine, LogSeverity, WizardTaskDefinition, WizardTaskStatus } from "./types.js";

export function logSeverity(line: string): LogSeverity {
  if (/\b(error|failed|denied|refusing|timed out|aborted connection)\b/i.test(line)) {
    return "error";
  }
  if (/\b(warn|warning|untrusted|fallback|reduced|unauthenticated)\b/i.test(line)) {
    return "warning";
  }
  return "info";
}

export function logService(line: string): string {
  const timestamped = line.match(/^\[[^\]]+\]\s+\[([^\]]+)\]/);
  const simple = line.match(/^\[([^\]]+)\]/);
  return (timestamped?.[1] ?? simple?.[1] ?? "app").toLowerCase();
}

export async function runActionWizardTask(
  task: WizardTaskDefinition,
  action: () => Promise<void>,
  updateTask: (id: string, status: WizardTaskStatus, message?: string) => void
) {
  updateTask(task.id, "running", task.detail);
  try {
    await action();
    updateTask(task.id, "complete", "Complete");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateTask(task.id, "failed", message);
    throw error;
  }
}

export async function runRuntimeWizardTask(
  task: WizardTaskDefinition,
  summary: DashboardSummary,
  startRuntimeInstall: (kind: RuntimeKind, version?: string, force?: boolean) => Promise<RuntimeInstallJob | undefined>,
  refresh: () => Promise<void>,
  updateTask: (id: string, status: WizardTaskStatus, message?: string) => void
) {
  const runtime = task.runtime ? selectedRuntimeStatus(summary, task.runtime.kind, task.runtime.version) : undefined;
  if (runtime?.installed && !runtime.updateAvailable) {
    updateTask(task.id, "complete", "Already installed");
    return;
  }

  updateTask(task.id, "running", runtime?.updateAvailable ? "Updating runtime" : "Starting download");
  const job = task.runtime ? await startRuntimeInstall(task.runtime.kind, task.runtime.version, Boolean(runtime?.updateAvailable)) : undefined;
  if (!job) {
    const message = `Could not start ${task.label}.`;
    updateTask(task.id, "failed", message);
    throw new Error(message);
  }

  const finishedJob = await waitForRuntimeJob(job, (currentJob) => {
    updateTask(task.id, "running", currentJob.message ?? statusLabel(currentJob.status));
  });

  if (finishedJob.status === "failed") {
    const message = finishedJob.error ?? finishedJob.message ?? `${task.label} failed.`;
    if (isRecoverableRuntimeInstallFailure(finishedJob)) {
      updateTask(task.id, "complete", message);
      await refresh();
      return;
    }
    updateTask(task.id, "failed", message);
    throw new Error(message);
  }

  updateTask(task.id, "complete", "Installed");
  await refresh();
}

export async function waitForRuntimeJob(job: RuntimeInstallJob, onUpdate: (job: RuntimeInstallJob) => void): Promise<RuntimeInstallJob> {
  let currentJob = job;
  onUpdate(currentJob);

  while (isActiveRuntimeJob(currentJob)) {
    await sleep(900);
    currentJob = await fetchRuntimeInstallJob(currentJob.id);
    onUpdate(currentJob);
  }

  return currentJob;
}

export function isRecoverableRuntimeInstallFailure(job: RuntimeInstallJob): boolean {
  const message = `${job.error ?? ""} ${job.message ?? ""}`;
  return job.kind === "php" && /disabled .+ automatically/i.test(message) && /can continue running/i.test(message);
}

export function firstRunTaskDefinitions(
  summary: DashboardSummary,
  options: {
    phpVersion: string;
    mysqlVersion: string;
    sitesFolder: string;
  }
): WizardTaskDefinition[] {
  const databaseRuntime = selectedMysqlRuntime(summary, options.mysqlVersion);
  const databaseLabel = databaseRuntimeDisplay(databaseRuntime);
  const databaseName = databaseEngineName(databaseRuntime);
  const tasks: WizardTaskDefinition[] = [
    { id: "park", label: "Park sites folder", detail: options.sitesFolder },
    { id: "configure", label: "Apply selected versions", detail: `Use PHP ${options.phpVersion} and ${databaseLabel}` },
    { id: `php-${options.phpVersion}`, label: `Prepare PHP ${options.phpVersion}`, detail: "Download PHP CLI and FastCGI", runtime: { kind: "php", version: options.phpVersion } },
    { id: "nginx", label: "Prepare Nginx", detail: "Download the local web server", runtime: { kind: "nginx", version: summary.runtimes.nginx.version } },
    { id: `mysql-${options.mysqlVersion}`, label: `Prepare ${databaseLabel}`, detail: "Download the database runtime", runtime: { kind: "mysql", version: options.mysqlVersion } },
    { id: "redis", label: "Prepare Redis", detail: "Download the local cache service", runtime: { kind: "redis", version: summary.runtimes.redis.version } },
    { id: "composer", label: "Prepare Composer", detail: "Install Composer for Laravel packages", runtime: { kind: "composer", version: summary.runtimes.composer.version } },
    { id: "node", label: "Prepare Node.js", detail: "Install frontend tooling runtime", runtime: { kind: "node", version: summary.runtimes.node.version } },
    { id: "laravel-installer", label: "Install Laravel Installer", detail: "Install laravel/installer for new Laravel sites" }
  ];

  tasks.push({ id: "mysql-init", label: `Initialize ${databaseName}`, detail: "Create data directory and root password" });
  if (!summary.phpMyAdmin.installed) {
    tasks.push({ id: "phpmyadmin", label: "Install phpMyAdmin", detail: "Create the database admin site", optional: true });
  }
  tasks.push(
    { id: "php-start", label: "Start PHP FastCGI", detail: "Launch the selected PHP worker" },
    { id: "mysql-start", label: `Start ${databaseName}`, detail: "Start the local database service" },
    { id: "redis-start", label: "Start Redis", detail: "Launch the local cache service" }
  );
  tasks.push(
    { id: "nginx-start", label: "Start Nginx", detail: "Serve local sites" },
    { id: "ca-trust", label: "Trust local HTTPS CA", detail: "Enable https:// for local sites without browser warnings", optional: true },
    { id: "hosts-sync", label: "Sync local domains", detail: "Update the Windows hosts file", optional: true },
    { id: "complete", label: "Save setup state", detail: "Open the workspace" }
  );

  return tasks;
}

export function needsFirstRunSetup(summary: DashboardSummary): boolean {
  if (!summary.config.setupComplete) {
    return true;
  }

  return summary.config.parkedFolders.length === 0 || !baseStackInstalled(summary);
}

export function baseStackInstalled(summary: DashboardSummary): boolean {
  return Boolean(
    selectedPhpRuntime(summary, summary.config.globalPhpVersion)?.installed &&
      selectedMysqlRuntime(summary, summary.config.mysql.version)?.installed &&
      summary.runtimes.nginx.installed &&
      summary.runtimes.redis.installed &&
      summary.runtimes.composer.installed
  );
}

export function selectedRuntimeStatus(summary: DashboardSummary, kind: RuntimeKind, version?: string): RuntimeInstallStatus | undefined {
  switch (kind) {
    case "php":
      return selectedPhpRuntime(summary, version ?? summary.config.globalPhpVersion);
    case "mysql":
      return selectedMysqlRuntime(summary, version ?? summary.config.mysql.version);
    case "nginx":
      return summary.runtimes.nginx;
    case "redis":
      return summary.runtimes.redis;
    case "node":
      return summary.runtimes.node;
    case "composer":
      return summary.runtimes.composer;
  }
}

export function selectedPhpRuntime(summary: DashboardSummary, version: string): RuntimeInstallStatus | undefined {
  return summary.runtimes.php.find((runtime) => runtime.version === version) ?? summary.runtimes.php[0];
}

export function selectedMysqlRuntime(summary: DashboardSummary, version: string): RuntimeInstallStatus | undefined {
  return summary.runtimes.mysql.find((runtime) => runtime.version === version) ?? summary.runtimes.mysql[0];
}

export function databaseRuntimeDisplay(runtime?: RuntimeInstallStatus): string {
  return runtime ? `${databaseEngineName(runtime)} ${databaseVersionDisplay(runtime.version)}` : "Database";
}

export function databaseEngineName(runtime?: RuntimeInstallStatus): string {
  return runtime?.name === "MariaDB" ? "MariaDB" : "MySQL";
}

export function databaseEngineKey(runtime?: RuntimeInstallStatus): DatabaseEngine {
  return runtime?.name === "MariaDB" || runtime?.version.toLowerCase().startsWith("mariadb-") ? "mariadb" : "mysql";
}

export function databaseRuntimesForEngine(runtimes: RuntimeInstallStatus[], engine: DatabaseEngine): RuntimeInstallStatus[] {
  return runtimes.filter((runtime) => databaseEngineKey(runtime) === engine);
}

export function preferredDatabaseRuntime(runtimes: RuntimeInstallStatus[]): RuntimeInstallStatus | undefined {
  const installed = runtimes.filter((runtime) => runtime.installed);
  return preferredRuntime(installed.length ? installed : runtimes);
}

export function databaseVersionDisplay(version: string): string {
  return version.toLowerCase().startsWith("mariadb-") ? version.slice("mariadb-".length) : version;
}

export function preferredRuntime(items: RuntimeInstallStatus[]): RuntimeInstallStatus | undefined {
  return [...items].sort((left, right) => compareVersionStrings(right.version, left.version))[0];
}

export function compareVersionStrings(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return left.localeCompare(right);
}

export function versionParts(version: string): number[] {
  return version.match(/\d+/g)?.map((part) => Number(part)) ?? [];
}

export function defaultSitesFolder(summary: DashboardSummary): string {
  const match = summary.paths.home.match(/^(.*)[\\/]\.config[\\/]laraboxs$/i);
  return `${match?.[1] ?? summary.paths.home}\\Sites`;
}

export function pathTail(folder: string): string {
  const trimmed = folder.trim().replace(/[\\/]+$/g, "");
  return trimmed.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
}

export function normalizeSiteName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function joinWindowsPath(parent: string, child: string): string {
  const base = parent.trim().replace(/[\\/]+$/g, "");
  return child ? `${base}\\${child}` : base;
}

export function taskDefinitionsLabel(summary: DashboardSummary, phpVersion: string, mysqlVersion: string): string {
  const count = firstRunTaskDefinitions(summary, { phpVersion, mysqlVersion, sitesFolder: "" }).length;
  return `${count} automatic tasks`;
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export function statusLabelForJob(status: SiteCommandJob["status"]): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "complete":
      return "Complete";
    case "failed":
      return "Failed";
  }
}

export function laravelInstallerBadge(status: LaravelInstallerStatus | null): { label: string; tone: "green" | "amber" | "red" } {
  if (!status) {
    return { label: "checking", tone: "amber" };
  }
  if (!status.installed) {
    return { label: "missing", tone: "red" };
  }
  if (status.updateAvailable) {
    return { label: "update", tone: "amber" };
  }
  return { label: "installed", tone: "green" };
}

export function laravelInstallerDetail(status: LaravelInstallerStatus | null): { title: string; subtitle: string } {
  if (!status) {
    return { title: "Checking Laravel Installer", subtitle: "Reading Composer global status" };
  }
  if (!status.phpInstalled) {
    return { title: "PHP runtime will be installed", subtitle: "Needed before Composer can run the installer" };
  }
  if (!status.composerInstalled) {
    return { title: "Composer will be installed", subtitle: "Install uses composer global require laravel/installer" };
  }
  if (!status.installed) {
    return { title: "Laravel Installer is not installed", subtitle: "Install uses composer global require laravel/installer" };
  }
  if (status.updateAvailable) {
    return { title: `Update available ${status.latestVersion ?? ""}`.trim(), subtitle: `Installed ${status.version ?? "unknown"}` };
  }
  return { title: `Installed ${status.version ?? "ready"}`, subtitle: status.binary ?? status.binDir };
}

export function normalizeLocalTld(value: string): string {
  return value.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

export function isValidLocalTld(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value);
}

export function phpFastCgiEndpoint(version: string): string {
  const digits = version.replace(/\D/g, "");
  const suffix = Number.parseInt(digits || "84", 10);
  return `127.0.0.1:${9000 + suffix}`;
}

export function latestRuntimeJob(jobs: RuntimeInstallJob[], kind: RuntimeKind, version: string): RuntimeInstallJob | undefined {
  return jobs
    .filter((job) => job.kind === kind && job.version === version)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}

export function runtimeActionLabel(item: RuntimeInstallStatus, job?: RuntimeInstallJob, fallback = "Install"): string {
  if (item.installed) {
    if (item.updateAvailable) {
      return "Update";
    }
    return "Ready";
  }

  if (job && isActiveRuntimeJob(job)) {
    return statusLabel(job.status);
  }

  if (job?.status === "failed") {
    return "Retry";
  }

  return fallback;
}

export function runtimeDisplayVersion(item: RuntimeInstallStatus): string {
  if (item.name === "MySQL" || item.name === "MariaDB") {
    return databaseRuntimeDisplay(item);
  }
  if (item.name === "Composer" && item.installedPackageVersion) {
    return item.installedPackageVersion;
  }
  return item.version;
}

export function statusLabel(status: RuntimeInstallJob["status"]): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "downloading":
      return "Downloading";
    case "extracting":
      return "Extracting";
    case "installing":
      return "Installing";
    case "complete":
      return "Complete";
    case "failed":
      return "Failed";
  }
}

export function isActiveRuntimeJob(job: RuntimeInstallJob): boolean {
  return job.status !== "complete" && job.status !== "failed";
}

export async function getJsonWithTimeout<T>(path: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await getJson<T>(path, { signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

export function formatTransfer(job: RuntimeInstallJob): string {
  if (typeof job.bytesDownloaded !== "number") {
    return "";
  }

  if (typeof job.totalBytes === "number") {
    return `${formatBytes(job.bytesDownloaded)} of ${formatBytes(job.totalBytes)}`;
  }

  return formatBytes(job.bytesDownloaded);
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

export function formatDuration(seconds: number): string {
  const rounded = Math.max(1, Math.ceil(seconds));
  if (rounded < 60) {
    return `${rounded}s`;
  }

  const minutes = Math.ceil(rounded / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}
