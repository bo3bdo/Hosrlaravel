import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { appendLog } from "../core/logging.js";
import { findSite } from "../core/sites.js";
import { developerToolEnv, phpBinaryForDeveloperTools } from "../core/developerTools.js";
import type { SiteCommandLogEntry, SiteWorkerKind, SiteWorkerStatus } from "../core/types.js";

interface ActiveWorker {
  child: ChildProcessWithoutNullStreams;
  status: SiteWorkerStatus;
}

const workers = new Map<string, ActiveWorker>();
const stoppedStatuses = new Map<string, SiteWorkerStatus>();

export function listSiteWorkers(site?: string): SiteWorkerStatus[] {
  const active = Array.from(workers.values()).map((worker) => worker.status);
  const stopped = Array.from(stoppedStatuses.values()).filter((status) => !workers.has(workerKey(status.site, status.kind)));
  return [...active, ...stopped]
    .filter((status) => !site || status.site === site)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function startSiteWorker(siteIdentifier: string, kind: SiteWorkerKind): Promise<SiteWorkerStatus> {
  const site = await findSite(siteIdentifier);
  const key = workerKey(site.domain, kind);
  const current = workers.get(key);
  if (current) {
    return current.status;
  }
  if (!existsSync(path.join(site.path, "artisan"))) {
    throw new Error(`${workerLabel(kind)} requires a Laravel project with an artisan file.`);
  }

  const now = new Date().toISOString();
  const status: SiteWorkerStatus = {
    id: randomUUID(),
    site: site.domain,
    kind,
    label: workerLabel(kind),
    state: "running",
    startedAt: now,
    updatedAt: now,
    message: `${workerLabel(kind)} started.`,
    logs: [{ at: now, level: "info", message: `${workerLabel(kind)} started.` }]
  };
  const child = spawn(await phpBinaryForDeveloperTools(), ["artisan", workerArtisanCommand(kind), "--no-interaction"], {
    cwd: site.path,
    env: { ...process.env, ...(await developerToolEnv()) },
    shell: false,
    windowsHide: true
  });
  status.pid = child.pid;

  const handleOutput = (chunk: string) => {
    for (const rawLine of chunk.replace(/\r/g, "\n").split("\n")) {
      const line = cleanCommandLine(rawLine);
      if (line) {
        pushWorkerLog(key, line);
      }
    }
  };

  child.stdout.on("data", (chunk) => handleOutput(String(chunk)));
  child.stderr.on("data", (chunk) => handleOutput(String(chunk)));
  child.once("error", (error) => {
    failWorker(key, error.message);
  });
  child.once("close", (code) => {
    const message = code === 0 ? `${workerLabel(kind)} stopped.` : `${workerLabel(kind)} exited with code ${code ?? "unknown"}.`;
    stopWorkerStatus(key, code === 0 ? "stopped" : "failed", message);
  });

  workers.set(key, { child, status });
  stoppedStatuses.delete(key);
  await appendLog("site", `${status.label} started for ${site.domain}`);
  return status;
}

export async function stopSiteWorker(siteIdentifier: string, kind: SiteWorkerKind): Promise<SiteWorkerStatus> {
  const site = await findSite(siteIdentifier);
  const key = workerKey(site.domain, kind);
  const worker = workers.get(key);
  if (!worker) {
    return (
      stoppedStatuses.get(key) ?? {
        id: randomUUID(),
        site: site.domain,
        kind,
        label: workerLabel(kind),
        state: "stopped",
        updatedAt: new Date().toISOString(),
        message: `${workerLabel(kind)} is stopped.`,
        logs: []
      }
    );
  }

  worker.child.kill();
  return stopWorkerStatus(key, "stopped", `${worker.status.label} stop requested.`);
}

export async function stopSiteWorkers(siteIdentifier: string): Promise<SiteWorkerStatus[]> {
  const site = await findSite(siteIdentifier);
  const active = Array.from(workers.keys()).filter((key) => key.startsWith(`${site.domain}:`));
  return active.map((key) => stopWorkerByKey(key));
}

export async function stopAllSiteWorkers(): Promise<SiteWorkerStatus[]> {
  return Array.from(workers.keys()).map((key) => stopWorkerByKey(key));
}

function pushWorkerLog(key: string, message: string): void {
  const worker = workers.get(key);
  if (!worker) {
    return;
  }
  const now = new Date().toISOString();
  worker.status.updatedAt = now;
  worker.status.message = message;
  worker.status.logs = [...worker.status.logs, { at: now, level: "info" as const, message }].slice(-120);
}

function failWorker(key: string, message: string): void {
  stopWorkerStatus(key, "failed", message);
}

function stopWorkerStatus(key: string, state: SiteWorkerStatus["state"], message: string): SiteWorkerStatus {
  const worker = workers.get(key);
  const existing = worker?.status ?? stoppedStatuses.get(key);
  const now = new Date().toISOString();
  const status: SiteWorkerStatus = {
    ...(existing ?? {
      id: randomUUID(),
      site: key.split(":")[0],
      kind: key.split(":")[1] as SiteWorkerKind,
      label: workerLabel(key.split(":")[1] as SiteWorkerKind),
      logs: []
    }),
    state,
    pid: undefined,
    updatedAt: now,
    message,
    logs: [...(existing?.logs ?? []), { at: now, level: state === "failed" ? "error" : "info", message } as SiteCommandLogEntry].slice(-120)
  };
  workers.delete(key);
  stoppedStatuses.set(key, status);
  void appendLog("site", `${status.label} ${state} for ${status.site}: ${message}`);
  return status;
}

function stopWorkerByKey(key: string): SiteWorkerStatus {
  const worker = workers.get(key);
  if (worker) {
    worker.child.kill();
    return stopWorkerStatus(key, "stopped", `${worker.status.label} stop requested.`);
  }

  return stopWorkerStatus(key, "stopped", `${workerLabel(key.split(":")[1] as SiteWorkerKind)} is stopped.`);
}

function workerKey(site: string, kind: SiteWorkerKind): string {
  return `${site}:${kind}`;
}

function workerLabel(kind: SiteWorkerKind): string {
  return kind === "queue" ? "Queue Worker" : "Scheduler";
}

function workerArtisanCommand(kind: SiteWorkerKind): string {
  return kind === "queue" ? "queue:work" : "schedule:work";
}

function cleanCommandLine(line: string): string {
  return line.replace(/\u001b\[[0-9;]*m/g, "").trim();
}
