import { loadConfig } from "../../core/config.js";
import {
  findAvailableMysqlPort,
  getMysqlRootPassword,
  ensureMysqlConfigured,
  initializeMysqlDataDir,
  laravelEnv,
  mysqlConfigPath,
  openMysqlShell,
  runCreateDatabase,
  runMysql,
  resetMysqlRootPassword,
  changeMysqlRootPassword,
  setMysqlPort,
  setMysqlVersion
} from "../../core/mysql.js";
import { getNginxStatus, runNginx, updateNginxSettings, writeNginxConfigs } from "../../core/nginx.js";
import { syncHostsFile } from "../../core/hosts.js";
import {
  ensurePhpIni,
  getPhpFastCgiStatus,
  getPhpSettings,
  runPhpFastCgi,
  updatePhpSettings
} from "../../core/php.js";
import { getPhpMyAdminStatus, installPhpMyAdmin, writePhpMyAdminConfig } from "../../core/phpmyadmin.js";
import { findAvailableRedisPort, openRedisCli, runRedis, setRedisPort } from "../../core/redis.js";
import {
  isolateSite,
  setConfiguredPhpVersions,
  setGlobalPhpVersion,
  unisolateSite
} from "../../core/sites.js";
import { getDashboardSummary } from "../../core/summary.js";
import {
  assertNginxSettings,
  assertPhpSettings,
  assertString,
  openLocalPath,
  optionalStringArray,
  readJson,
  sendJson,
  serviceAction
} from "../context.js";
import { ApiHttpError } from "../httpSecurity.js";
import type { RouteDefinition } from "../router.js";

export const serviceRoutes: RouteDefinition[] = [
  {
    method: "GET",
    pattern: "/api/phpmyadmin/status",
    handler: async ({ response }) => {
      await writePhpMyAdminConfig();
      await sendJson(response, getPhpMyAdminStatus());
    }
  },
  {
    method: "POST",
    pattern: "/api/phpmyadmin/install",
    handler: async ({ response }) => {
      const status = await installPhpMyAdmin();
      await writeNginxConfigs();
      await syncHostsFile();
      if (getNginxStatus().state === "running") {
        await runNginx("restart");
      }
      await sendJson(response, { ok: true, status, summary: await getDashboardSummary() });
    }
  },
  {
    method: "POST",
    pattern: "/api/php/use",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      const phpWasRunning = (await getPhpFastCgiStatus()).state !== "stopped";
      await setGlobalPhpVersion(assertString(body.version, "version"));
      await writeNginxConfigs();
      if (phpWasRunning) {
        await runPhpFastCgi("restart");
      }
      if (getNginxStatus().state === "running") {
        await runNginx("restart");
      }
      await sendJson(response, { ok: true, summary: await getDashboardSummary() });
    }
  },
  {
    method: "POST",
    pattern: "/api/php/versions",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      const versions = optionalStringArray(body.versions);
      if (!versions) {
        throw new ApiHttpError(400, "PHP versions are required.");
      }
      await setConfiguredPhpVersions(versions, typeof body.globalVersion === "string" ? body.globalVersion : undefined);
      await sendJson(response, { ok: true, summary: await getDashboardSummary() });
    }
  },
  {
    method: "GET",
    pattern: "/api/php/settings",
    handler: async ({ url, response }) => {
      const version = url.searchParams.get("version") ?? undefined;
      await sendJson(response, await getPhpSettings(version));
    }
  },
  {
    method: "POST",
    pattern: "/api/php/settings",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      const wasRunning = (await getPhpFastCgiStatus()).state === "running";
      const settings = await updatePhpSettings(assertPhpSettings(body.settings ?? body));
      const php = wasRunning ? await runPhpFastCgi("restart") : await getPhpFastCgiStatus();
      await sendJson(response, { ok: true, settings, php, summary: await getDashboardSummary() });
    }
  },
  {
    method: "POST",
    pattern: "/api/php-fcgi/:action",
    handler: async ({ response }, params) => {
      const action = serviceAction(params.action);
      await sendJson(response, await runPhpFastCgi(action));
    }
  },
  {
    method: "POST",
    pattern: "/api/php/ini/open",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      const config = await loadConfig();
      const version = typeof body.version === "string" ? body.version : config.globalPhpVersion;
      const iniPath = await ensurePhpIni(version);
      await openLocalPath(iniPath, body.reveal === true);
      await sendJson(response, { ok: true, path: iniPath });
    }
  },
  {
    method: "POST",
    pattern: "/api/php/isolate",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      await isolateSite(assertString(body.site, "site"), assertString(body.version, "version"));
      await sendJson(response, { ok: true, summary: await getDashboardSummary() });
    }
  },
  {
    method: "POST",
    pattern: "/api/php/unisolate",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      await unisolateSite(assertString(body.site, "site"));
      await sendJson(response, { ok: true, summary: await getDashboardSummary() });
    }
  },
  {
    method: "POST",
    pattern: "/api/nginx/settings",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      const settings = await updateNginxSettings(assertNginxSettings(body.settings ?? body));
      await writeNginxConfigs();
      if (getNginxStatus().state === "running") {
        await runNginx("restart");
      }
      await sendJson(response, { ok: true, settings, summary: await getDashboardSummary() });
    }
  },
  {
    method: "POST",
    pattern: "/api/nginx/:action",
    handler: async ({ response }, params) => {
      const action = serviceAction(params.action);
      await sendJson(response, await runNginx(action));
    }
  },
  {
    method: "POST",
    pattern: "/api/mysql/port",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      const mysqlPort = body.port === "auto" ? await findAvailableMysqlPort() : Number(body.port);
      await setMysqlPort(mysqlPort);
      await sendJson(response, { ok: true, summary: await getDashboardSummary() });
    }
  },
  {
    method: "POST",
    pattern: "/api/mysql/version",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      await setMysqlVersion(assertString(body.version, "version"));
      await sendJson(response, { ok: true, summary: await getDashboardSummary() });
    }
  },
  {
    method: "POST",
    pattern: "/api/mysql/init",
    handler: async ({ response }) => {
      const status = await initializeMysqlDataDir();
      await sendJson(response, { ok: true, status, summary: await getDashboardSummary() });
    }
  },
  {
    method: "POST",
    pattern: "/api/mysql/create-db",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      const status = await runCreateDatabase(assertString(body.name, "name"));
      await sendJson(response, { ok: true, status });
    }
  },
  {
    method: "POST",
    pattern: "/api/mysql/shell",
    handler: async ({ response }) => {
      await openMysqlShell();
      await sendJson(response, { ok: true });
    }
  },
  {
    method: "POST",
    pattern: "/api/mysql/ini",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      const config = await loadConfig();
      await ensureMysqlConfigured();
      const iniPath = mysqlConfigPath(config.mysql.version);
      await openLocalPath(iniPath, body.reveal === true);
      await sendJson(response, { ok: true, path: iniPath });
    }
  },
  {
    method: "POST",
    pattern: "/api/mysql/env",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      await sendJson(response, { env: await laravelEnv(assertString(body.name, "name")) });
    }
  },
  {
    method: "POST",
    pattern: "/api/mysql/password",
    handler: async ({ response }) => {
      await sendJson(response, { password: await getMysqlRootPassword() });
    }
  },
  {
    method: "POST",
    pattern: "/api/mysql/reset-password",
    handler: async ({ response }) => {
      await sendJson(response, { password: await resetMysqlRootPassword(), summary: await getDashboardSummary() });
    }
  },
  {
    method: "POST",
    pattern: "/api/mysql/change-password",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      await sendJson(response, { password: await changeMysqlRootPassword(assertString(body.password, "password")), summary: await getDashboardSummary() });
    }
  },
  {
    method: "POST",
    pattern: "/api/mysql/:action",
    handler: async ({ response }, params) => {
      await sendJson(response, await runMysql(serviceAction(params.action)));
    }
  },
  {
    method: "POST",
    pattern: "/api/redis/port",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      const redisPort = body.port === "auto" ? await findAvailableRedisPort() : Number(body.port);
      await setRedisPort(redisPort);
      await sendJson(response, { ok: true, summary: await getDashboardSummary() });
    }
  },
  {
    method: "POST",
    pattern: "/api/redis/shell",
    handler: async ({ response }) => {
      await openRedisCli();
      await sendJson(response, { ok: true });
    }
  },
  {
    method: "POST",
    pattern: "/api/redis/:action",
    handler: async ({ response }, params) => {
      await sendJson(response, await runRedis(serviceAction(params.action)));
    }
  }
];
