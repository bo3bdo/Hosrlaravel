import { updateConfig } from "../../core/config.js";
import { syncHostsFile } from "../../core/hosts.js";
import { ensureDeveloperCommandPath } from "../../core/runtimes.js";
import { getDashboardSummary } from "../../core/summary.js";
import { writeNginxConfigs, getNginxStatus, runNginx } from "../../core/nginx.js";
import {
  getLaravelInstallerStatus,
  installOrUpdateLaravelInstaller,
  uninstallLaravelInstaller
} from "../../core/laravelInstaller.js";
import {
  assertGeneralSettings,
  assertHttpUrl,
  assertString,
  openExternalUrl,
  openLocalPath,
  readJson,
  sendJson
} from "../context.js";
import type { RouteDefinition } from "../router.js";

export const setupRoutes: RouteDefinition[] = [
  {
    method: "POST",
    pattern: "/api/setup/complete",
    handler: async ({ response }) => {
      const pathEntries = await ensureDeveloperCommandPath();
      await updateConfig((config) => {
        config.setupComplete = true;
      });
      await sendJson(response, { ok: true, pathEntries, summary: await getDashboardSummary() });
    }
  },
  {
    method: "POST",
    pattern: "/api/settings",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      const settings = assertGeneralSettings(body);
      await updateConfig((config) => {
        if (settings.tld) {
          config.tld = settings.tld;
        }
        if (typeof settings.setupComplete === "boolean") {
          config.setupComplete = settings.setupComplete;
        }
      });
      await writeNginxConfigs();
      if (getNginxStatus().state === "running") {
        await runNginx("restart");
      }
      await sendJson(response, { ok: true, summary: await getDashboardSummary() });
    }
  },
  {
    method: "GET",
    pattern: "/api/laravel-installer/status",
    handler: async ({ url, response }) => {
      await sendJson(response, await getLaravelInstallerStatus({ checkLatest: url.searchParams.get("latest") !== "0" }));
    }
  },
  {
    method: "POST",
    pattern: "/api/laravel-installer/install",
    handler: async ({ response }) => {
      await sendJson(response, { ok: true, status: await installOrUpdateLaravelInstaller() });
    }
  },
  {
    method: "POST",
    pattern: "/api/laravel-installer/uninstall",
    handler: async ({ response }) => {
      await sendJson(response, { ok: true, status: await uninstallLaravelInstaller() });
    }
  },
  {
    method: "POST",
    pattern: "/api/open-url",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      openExternalUrl(assertHttpUrl(body.url));
      await sendJson(response, { ok: true });
    }
  },
  {
    method: "POST",
    pattern: "/api/open-path",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      const openedPath = await openLocalPath(assertString(body.path, "path"), body.reveal === true);
      await sendJson(response, { ok: true, path: openedPath });
    }
  },
  {
    method: "POST",
    pattern: "/api/hosts/sync",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      const next = await syncHostsFile({ dryRun: Boolean(body.dryRun) });
      await sendJson(response, { ok: true, hosts: next });
    }
  }
];
