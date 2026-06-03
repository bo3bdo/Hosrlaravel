import { randomUUID } from "node:crypto";
import { syncHostsFile } from "../core/hosts.js";
import { createNewSite } from "../core/laravelInstaller.js";
import { getNginxStatus, runNginx, writeNginxConfigs } from "../core/nginx.js";
import type { NewSiteRequest, SiteCreationJob, SiteCreationLogLevel, SiteCreationResult } from "../core/types.js";

const jobs = new Map<string, SiteCreationJob>();

export function startSiteCreationJob(request: NewSiteRequest): SiteCreationJob {
  const now = new Date().toISOString();
  const job: SiteCreationJob = {
    id: randomUUID(),
    status: "queued",
    percent: 0,
    message: "Queued site creation.",
    logs: [{ at: now, level: "info", message: "Queued site creation." }],
    startedAt: now,
    updatedAt: now
  };

  jobs.set(job.id, job);
  void runSiteCreationJob(job.id, request);
  return job;
}

export function getSiteCreationJob(id: string): SiteCreationJob | undefined {
  return jobs.get(id);
}

async function runSiteCreationJob(jobId: string, request: NewSiteRequest): Promise<void> {
  try {
    updateSiteCreationJob(jobId, "running", 3, "Starting site creation.");
    const result = await createNewSite(request, (message, percent, level) => updateSiteCreationJob(jobId, "running", percent, message, level));
    updateSiteCreationJob(jobId, "running", 92, "Writing Nginx site configuration.");
    await writeNginxConfigs();
    updateSiteCreationJob(jobId, "running", 95, "Syncing Windows hosts file.");
    await syncHostsFile();

    if (getNginxStatus().state === "running") {
      updateSiteCreationJob(jobId, "running", 98, "Restarting Nginx.");
      await runNginx("restart");
    }

    completeSiteCreationJob(jobId, result);
  } catch (error) {
    failSiteCreationJob(jobId, error instanceof Error ? error.message : String(error));
  }
}

function updateSiteCreationJob(jobId: string, status: SiteCreationJob["status"], percent: number | undefined, message: string, level: SiteCreationLogLevel = "info"): void {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }

  const now = new Date().toISOString();
  job.status = status;
  job.percent = clampPercent(percent ?? job.percent);
  job.message = message;
  job.logs = [...job.logs, { at: now, level, message }].slice(-80);
  job.updatedAt = now;
}

function completeSiteCreationJob(jobId: string, result: SiteCreationResult): void {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }

  const now = new Date().toISOString();
  job.status = "complete";
  job.percent = 100;
  job.message = `${result.site.domain} is ready.`;
  job.result = result;
  job.logs = [...job.logs, { at: now, level: "success" as const, message: job.message }].slice(-80);
  job.updatedAt = now;
  job.completedAt = now;
}

function failSiteCreationJob(jobId: string, error: string): void {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }

  const now = new Date().toISOString();
  job.status = "failed";
  job.message = error;
  job.error = error;
  job.logs = [...job.logs, { at: now, level: "error" as const, message: error }].slice(-80);
  job.updatedAt = now;
  job.completedAt = now;
}

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(percent)));
}
