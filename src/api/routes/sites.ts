import {
  addParkedFolder,
  deleteSite,
  resetSiteEntryPath,
  setPrimaryParkedFolder,
  setSiteEntryPath
} from "../../core/sites.js";
import { syncHostsFile } from "../../core/hosts.js";
import { getNginxStatus, runNginx, writeNginxConfigs } from "../../core/nginx.js";
import { getDashboardSummary } from "../../core/summary.js";
import { readSitePreviewImage } from "../../core/sitePreview.js";
import { checkSiteHealth } from "../../core/siteHealth.js";
import { getSiteDiagnosticReport } from "../../core/siteDiagnostics.js";
import { siteCommandDefinitions } from "../../core/siteCommands.js";
import { applySiteEnvProfile, siteDatabaseInfo, siteEnvProfiles } from "../../core/siteEnv.js";
import { getSiteCreationJob, startSiteCreationJob } from "../siteJobs.js";
import { getSiteCommandJob, listSiteCommandJobs, startSiteCommandJob } from "../siteCommandJobs.js";
import { listSiteWorkers, startSiteWorker, stopSiteWorker, stopSiteWorkers } from "../siteWorkers.js";
import {
  assertNewSiteRequest,
  assertSiteCommandKind,
  assertSiteEnvProfileKind,
  assertSiteWorkerKind,
  assertString,
  readJson,
  sendJson
} from "../context.js";
import type { RouteDefinition } from "../router.js";

export const siteRoutes: RouteDefinition[] = [
  {
    method: "POST",
    pattern: "/api/sites/park",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      const makePrimary = body.primary === true;
      if (makePrimary) {
        await setPrimaryParkedFolder(assertString(body.path, "path"));
      } else {
        await addParkedFolder(assertString(body.path, "path"));
      }
      await writeNginxConfigs();
      await sendJson(response, { ok: true, summary: await getDashboardSummary() });
    }
  },
  {
    method: "POST",
    pattern: "/api/sites/delete",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      const site = assertString(body.site, "site");
      await stopSiteWorkers(site);
      const result = await deleteSite(site, { deleteDatabases: body.deleteDatabases !== false });
      await writeNginxConfigs();
      await syncHostsFile();
      if (getNginxStatus().state === "running") {
        await runNginx("restart");
      }
      await sendJson(response, { ok: true, result, summary: await getDashboardSummary() });
    }
  },
  {
    method: "GET",
    pattern: "/api/sites/create/jobs/:id",
    handler: async ({ response }, params) => {
      const job = getSiteCreationJob(params.id);
      if (!job) {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Site creation job not found." }));
        return;
      }
      await sendJson(response, { job });
    }
  },
  {
    method: "POST",
    pattern: "/api/sites/create",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      const job = startSiteCreationJob(assertNewSiteRequest(body));
      await sendJson(response, { ok: true, job });
    }
  },
  {
    method: "GET",
    pattern: "/api/sites/commands",
    handler: async ({ response }) => {
      await sendJson(response, { commands: siteCommandDefinitions });
    }
  },
  {
    method: "GET",
    pattern: "/api/sites/commands/jobs",
    handler: async ({ url, response }) => {
      const site = url.searchParams.get("site") ?? undefined;
      await sendJson(response, { jobs: listSiteCommandJobs(site) });
    }
  },
  {
    method: "GET",
    pattern: "/api/sites/commands/jobs/:id",
    handler: async ({ response }, params) => {
      const job = getSiteCommandJob(params.id);
      if (!job) {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Site command job not found." }));
        return;
      }
      await sendJson(response, { job });
    }
  },
  {
    method: "POST",
    pattern: "/api/sites/commands/run",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      const job = startSiteCommandJob(assertString(body.site, "site"), assertSiteCommandKind(body.command));
      await sendJson(response, { ok: true, job });
    }
  },
  {
    method: "GET",
    pattern: "/api/sites/env",
    handler: async ({ url, response }) => {
      const site = assertString(url.searchParams.get("site"), "site");
      await sendJson(response, await siteEnvProfiles(site));
    }
  },
  {
    method: "GET",
    pattern: "/api/sites/database",
    handler: async ({ url, response }) => {
      const site = assertString(url.searchParams.get("site"), "site");
      await sendJson(response, await siteDatabaseInfo(site));
    }
  },
  {
    method: "POST",
    pattern: "/api/sites/env/apply",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      const result = await applySiteEnvProfile(assertString(body.site, "site"), assertSiteEnvProfileKind(body.profile), {
        createDatabase: body.createDatabase === true
      });
      await sendJson(response, { ok: true, result });
    }
  },
  {
    method: "GET",
    pattern: "/api/sites/workers",
    handler: async ({ url, response }) => {
      const site = url.searchParams.get("site") ?? undefined;
      await sendJson(response, { workers: listSiteWorkers(site) });
    }
  },
  {
    method: "POST",
    pattern: "/api/sites/workers/start",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      const worker = await startSiteWorker(assertString(body.site, "site"), assertSiteWorkerKind(body.kind));
      await sendJson(response, { ok: true, worker });
    }
  },
  {
    method: "POST",
    pattern: "/api/sites/workers/stop",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      const worker = await stopSiteWorker(assertString(body.site, "site"), assertSiteWorkerKind(body.kind));
      await sendJson(response, { ok: true, worker });
    }
  },
  {
    method: "POST",
    pattern: "/api/sites/entry",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      const site = assertString(body.site, "site");
      if (body.entry === null) {
        await resetSiteEntryPath(site);
      } else {
        await setSiteEntryPath(site, assertString(body.entry, "entry"));
      }
      await writeNginxConfigs();
      if (getNginxStatus().state === "running") {
        await runNginx("restart");
      }
      await sendJson(response, { ok: true, summary: await getDashboardSummary() });
    }
  },
  {
    method: "GET",
    pattern: "/api/sites/preview",
    handler: async ({ url, response }) => {
      const site = assertString(url.searchParams.get("site"), "site");
      const preview = await readSitePreviewImage(site, { refresh: url.searchParams.get("refresh") === "1" });
      response.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "no-cache",
        "Last-Modified": preview.updatedAt.toUTCString()
      });
      response.end(preview.body);
    }
  },
  {
    method: "GET",
    pattern: "/api/sites/health",
    handler: async ({ url, response }) => {
      const site = assertString(url.searchParams.get("site"), "site");
      await sendJson(response, await checkSiteHealth(site));
    }
  },
  {
    method: "GET",
    pattern: "/api/sites/diagnostics",
    handler: async ({ url, response }) => {
      const site = assertString(url.searchParams.get("site"), "site");
      await sendJson(response, await getSiteDiagnosticReport(site));
    }
  }
];
