import { getLocalCaStatus, secureSite, trustLocalCa, unsecureSite } from "../../core/ssl.js";
import { getNginxStatus, runNginx, writeNginxConfigs } from "../../core/nginx.js";
import { getDashboardSummary } from "../../core/summary.js";
import { ApiHttpError } from "../httpSecurity.js";
import { assertString, readJson, sendJson } from "../context.js";
import type { RouteDefinition } from "../router.js";

export const sslRoutes: RouteDefinition[] = [
  {
    method: "POST",
    pattern: "/api/ssl/secure",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      await secureSite(assertString(body.site, "site"));
      await writeNginxConfigs();
      if (getNginxStatus().state === "running") {
        await runNginx("restart");
      }
      await sendJson(response, { ok: true, summary: await getDashboardSummary() });
    }
  },
  {
    method: "GET",
    pattern: "/api/ssl/status",
    handler: async ({ response }) => {
      await sendJson(response, await getLocalCaStatus());
    }
  },
  {
    method: "POST",
    pattern: "/api/ssl/trust",
    handler: async ({ response }) => {
      const status = await trustLocalCa({ wait: true });
      if (status.platform === "win32" && !status.trusted) {
        throw new ApiHttpError(409, status.message ?? "Local CA trust did not complete.");
      }
      await writeNginxConfigs();
      if (getNginxStatus().state === "running") {
        await runNginx("restart");
      }
      await sendJson(response, { ok: true, status, summary: await getDashboardSummary() });
    }
  },
  {
    method: "POST",
    pattern: "/api/ssl/unsecure",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      await unsecureSite(assertString(body.site, "site"));
      await writeNginxConfigs();
      if (getNginxStatus().state === "running") {
        await runNginx("restart");
      }
      await sendJson(response, { ok: true, summary: await getDashboardSummary() });
    }
  }
];
