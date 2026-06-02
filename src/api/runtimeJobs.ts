import { randomUUID } from "node:crypto";
import { findRuntimeEntry, installRuntime } from "../core/runtimes.js";
import type { RuntimeInstallJob, RuntimeInstallProgress, RuntimeKind } from "../core/types.js";

const jobs = new Map<string, RuntimeInstallJob>();
const activeRuntimeJobs = new Map<string, string>();

export function startRuntimeInstallJob(kind: RuntimeKind, version?: string, options: { force?: boolean } = {}): RuntimeInstallJob {
  const entry = findRuntimeEntry(kind, version);
  const runtimeKey = `${entry.kind}:${entry.version}`;
  const activeJobId = activeRuntimeJobs.get(runtimeKey);
  const activeJob = activeJobId ? jobs.get(activeJobId) : undefined;

  if (activeJob && isActiveRuntimeJob(activeJob)) {
    return activeJob;
  }

  const now = new Date().toISOString();
  const job: RuntimeInstallJob = {
    id: randomUUID(),
    kind: entry.kind,
    name: entry.name,
    version: entry.version,
    status: "queued",
    percent: 0,
    message: `Queued ${entry.name} ${entry.version}.`,
    startedAt: now,
    updatedAt: now
  };

  jobs.set(job.id, job);
  activeRuntimeJobs.set(runtimeKey, job.id);
  void runRuntimeInstallJob(job.id, runtimeKey, kind, version, options);

  return job;
}

export function getRuntimeInstallJob(id: string): RuntimeInstallJob | undefined {
  return jobs.get(id);
}

export function listRuntimeInstallJobs(): RuntimeInstallJob[] {
  return Array.from(jobs.values()).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function isActiveRuntimeJob(job: RuntimeInstallJob): boolean {
  return job.status !== "complete" && job.status !== "failed";
}

async function runRuntimeInstallJob(jobId: string, runtimeKey: string, kind: RuntimeKind, version?: string, options: { force?: boolean } = {}): Promise<void> {
  try {
    const result = await installRuntime(kind, version, {
      force: options.force,
      onProgress: (progress) => updateRuntimeInstallJob(jobId, progress)
    });
    updateRuntimeInstallJob(jobId, {
      status: "complete",
      percent: 100,
      message: `${result.name} ${result.version} installed.`
    });
    const job = jobs.get(jobId);
    if (job) {
      job.result = result;
    }
  } catch (error) {
    updateRuntimeInstallJob(jobId, {
      status: "failed",
      percent: jobs.get(jobId)?.percent ?? 0,
      message: error instanceof Error ? error.message : String(error)
    });
    const job = jobs.get(jobId);
    if (job) {
      job.error = error instanceof Error ? error.message : String(error);
    }
  } finally {
    const job = jobs.get(jobId);
    if (job) {
      const now = new Date().toISOString();
      job.updatedAt = now;
      job.completedAt = now;
    }
    activeRuntimeJobs.delete(runtimeKey);
  }
}

function updateRuntimeInstallJob(jobId: string, progress: RuntimeInstallProgress): void {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }

  job.status = progress.status;
  job.percent = clampPercent(progress.percent);
  job.message = progress.message;
  job.bytesDownloaded = progress.bytesDownloaded;
  job.totalBytes = progress.totalBytes;
  job.etaSeconds = progress.etaSeconds;
  job.updatedAt = new Date().toISOString();

  if (progress.status === "complete" || progress.status === "failed") {
    job.completedAt = job.updatedAt;
  }
}

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) {
    return 0;
  }
  return Math.min(100, Math.max(0, percent));
}
