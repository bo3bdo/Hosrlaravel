import { randomUUID } from "node:crypto";
import { buildSiteCommand, runSiteCommandProcess, siteCommandDefinition } from "../core/siteCommands.js";
import type { SiteCommandJob, SiteCommandKind, SiteCommandLogLevel } from "../core/types.js";

const jobs = new Map<string, SiteCommandJob>();

export function startSiteCommandJob(site: string, command: SiteCommandKind): SiteCommandJob {
  const definition = siteCommandDefinition(command);
  const now = new Date().toISOString();
  const job: SiteCommandJob = {
    id: randomUUID(),
    site,
    command,
    label: definition.label,
    status: "queued",
    percent: 0,
    message: `Queued ${definition.label}.`,
    logs: [{ at: now, level: "info", message: `Queued ${definition.detail}.` }],
    startedAt: now,
    updatedAt: now
  };

  jobs.set(job.id, job);
  void runJob(job.id);
  return job;
}

export function getSiteCommandJob(id: string): SiteCommandJob | undefined {
  return jobs.get(id);
}

export function listSiteCommandJobs(site?: string): SiteCommandJob[] {
  return Array.from(jobs.values())
    .filter((job) => !site || job.site === site)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

async function runJob(jobId: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }

  try {
    updateJob(jobId, "running", 8, "Preparing command.");
    const spec = await buildSiteCommand(job.site, job.command);
    updateJob(jobId, "running", 18, `${job.label} started.`);
    const code = await runSiteCommandProcess(spec, {
      scope: `${job.site} ${job.command}`,
      timeoutMs: timeoutForCommand(job.command),
      onOutput: (line) => updateJob(jobId, "running", undefined, line)
    });

    if (code !== 0) {
      failJob(jobId, `${job.label} exited with code ${code}.`, code);
      return;
    }

    completeJob(jobId, `${job.label} completed.`);
  } catch (error) {
    failJob(jobId, error instanceof Error ? error.message : String(error));
  }
}

function updateJob(
  jobId: string,
  status: SiteCommandJob["status"],
  percent: number | undefined,
  message: string,
  level: SiteCommandLogLevel = "info"
): void {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }

  const now = new Date().toISOString();
  job.status = status;
  job.percent = clampPercent(percent ?? Math.min(92, job.percent + 2));
  job.message = message;
  job.logs = [...job.logs, { at: now, level, message }].slice(-120);
  job.updatedAt = now;
}

function completeJob(jobId: string, message: string): void {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }
  const now = new Date().toISOString();
  job.status = "complete";
  job.percent = 100;
  job.message = message;
  job.completedAt = now;
  job.updatedAt = now;
  job.logs = [...job.logs, { at: now, level: "success" as const, message }].slice(-120);
}

function failJob(jobId: string, error: string, exitCode?: number): void {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }
  const now = new Date().toISOString();
  job.status = "failed";
  job.message = error;
  job.error = error;
  job.exitCode = exitCode;
  job.completedAt = now;
  job.updatedAt = now;
  job.logs = [...job.logs, { at: now, level: "error" as const, message: error }].slice(-120);
}

function timeoutForCommand(command: SiteCommandKind): number {
  switch (command) {
    case "composer:install":
    case "npm:install":
      return 20 * 60 * 1000;
    case "npm:build":
      return 10 * 60 * 1000;
    default:
      return 5 * 60 * 1000;
  }
}

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(percent)));
}
