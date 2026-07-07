import { uninstallRuntime } from "../../core/runtimes.js";
import { getDashboardSummary } from "../../core/summary.js";
import { getRuntimeInstallJob, listRuntimeInstallJobs, startRuntimeInstallJob } from "../runtimeJobs.js";
import { assertRuntimeKind, readJson, sendJson } from "../context.js";
import type { RouteDefinition } from "../router.js";

export const runtimeRoutes: RouteDefinition[] = [
  {
    method: "GET",
    pattern: "/api/runtimes/jobs",
    handler: async ({ response }) => {
      await sendJson(response, { jobs: listRuntimeInstallJobs() });
    }
  },
  {
    method: "GET",
    pattern: "/api/runtimes/jobs/:id",
    handler: async ({ response }, params) => {
      const job = getRuntimeInstallJob(params.id);
      if (!job) {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Runtime install job not found." }));
        return;
      }
      await sendJson(response, { job });
    }
  },
  {
    method: "POST",
    pattern: "/api/runtimes/install",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      const job = startRuntimeInstallJob(assertRuntimeKind(body.kind), typeof body.version === "string" ? body.version : undefined, { force: body.force === true });
      await sendJson(response, { ok: true, jobId: job.id, job });
    }
  },
  {
    method: "POST",
    pattern: "/api/runtimes/uninstall",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      const status = await uninstallRuntime(assertRuntimeKind(body.kind), typeof body.version === "string" ? body.version : undefined);
      await sendJson(response, { ok: true, status, summary: await getDashboardSummary() });
    }
  }
];
