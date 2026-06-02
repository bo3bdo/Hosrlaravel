import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { appendLog } from "./logging.js";
import { getPaths } from "./paths.js";
import { phpMyAdminSiteIfInstalled } from "./phpmyadmin.js";
import { discoverSites } from "./sites.js";
import type { Site } from "./types.js";

const startMarker = "# LARABOXS MANAGED START";
const endMarker = "# LARABOXS MANAGED END";

export function renderHostsBlock(sites: Site[]): string {
  const entries = Array.from(new Set(sites.map((site) => site.domain)))
    .sort()
    .map((domain) => `127.0.0.1 ${domain}`);

  return [startMarker, ...entries, endMarker].join("\n");
}

export function mergeHostsFile(current: string, sites: Site[]): string {
  const block = renderHostsBlock(sites);
  const normalizedCurrent = current.replace(/\r\n/g, "\n").trimEnd();
  const expression = new RegExp(`${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}`, "m");

  if (expression.test(normalizedCurrent)) {
    return `${normalizedCurrent.replace(expression, block)}\n`;
  }

  return `${normalizedCurrent}${normalizedCurrent ? "\n\n" : ""}${block}\n`;
}

export async function syncHostsFile(options: { dryRun?: boolean } = {}): Promise<string> {
  const paths = getPaths();
  const phpMyAdminSite = await phpMyAdminSiteIfInstalled();
  const sites = [...(await discoverSites()), ...(phpMyAdminSite ? [phpMyAdminSite] : [])];
  let current = "";

  try {
    current = await readFile(paths.hostsFile, "utf8");
  } catch {
    current = "";
  }

  const next = mergeHostsFile(current, sites);
  if (!options.dryRun) {
    await writeHostsFile(paths.hostsFile, next);
  }

  return next;
}

async function writeHostsFile(hostsFile: string, content: string): Promise<void> {
  try {
    await writeFile(hostsFile, content, "utf8");
  } catch (error) {
    if (!needsElevatedHostsWrite(error)) {
      throw error;
    }

    await writeHostsFileElevated(hostsFile, content);
  }
}

async function writeHostsFileElevated(hostsFile: string, content: string): Promise<void> {
  const paths = getPaths();
  const pendingHostsFile = path.join(paths.home, "hosts.pending");
  const scriptPath = path.join(paths.home, "sync-hosts-elevated.ps1");

  await mkdir(paths.home, { recursive: true });
  await writeFile(pendingHostsFile, content, "utf8");
  await writeFile(
    scriptPath,
    [
      '$ErrorActionPreference = "Stop"',
      `$source = '${escapePowerShellString(pendingHostsFile)}'`,
      `$destination = '${escapePowerShellString(hostsFile)}'`,
      "Copy-Item -LiteralPath $source -Destination $destination -Force"
    ].join("\n"),
    "utf8"
  );

  await appendLog("hosts", "requesting elevated hosts sync");
  const code = await runElevatedPowerShell(scriptPath);
  if (code !== 0) {
    throw new Error("Hosts sync needs Administrator approval. Please approve the Windows prompt and try again.");
  }
  await appendLog("hosts", "hosts file synced with elevated permissions");
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

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

function needsElevatedHostsWrite(error: unknown): boolean {
  return process.platform === "win32" && error instanceof Error && "code" in error && (error.code === "EPERM" || error.code === "EACCES");
}

function escapePowerShellString(value: string): string {
  return value.replace(/'/g, "''");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
