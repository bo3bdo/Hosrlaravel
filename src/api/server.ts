import http from "node:http";
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, updateConfig } from "../core/config.js";
import { addParkedFolder, deleteSite, isolateSite, resetSiteEntryPath, setConfiguredPhpVersions, setGlobalPhpVersion, setSiteEntryPath, unisolateSite } from "../core/sites.js";
import { syncHostsFile } from "../core/hosts.js";
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
} from "../core/mysql.js";
import { getNginxStatus, runNginx, updateNginxSettings, writeNginxConfigs } from "../core/nginx.js";
import { appendLog } from "../core/logging.js";
import { ensurePhpIni, getPhpFastCgiStatus, getPhpSettings, runPhpFastCgi, updatePhpSettings } from "../core/php.js";
import { getPhpMyAdminStatus, installPhpMyAdmin, writePhpMyAdminConfig } from "../core/phpmyadmin.js";
import { findAvailableRedisPort, openRedisCli, runRedis, setRedisPort } from "../core/redis.js";
import { ensureDeveloperCommandPath, uninstallRuntime } from "../core/runtimes.js";
import { getRuntimeInstallJob, listRuntimeInstallJobs, startRuntimeInstallJob } from "./runtimeJobs.js";
import { selectFile, selectFolder, sqlFileDialogOptions } from "./dialogs.js";
import { getLocalCaStatus, secureSite, trustLocalCa, unsecureSite } from "../core/ssl.js";
import { tryEnsureWindowsDefenderExclusion } from "../core/defender.js";
import { getDashboardSummary } from "../core/summary.js";
import { readSitePreviewImage } from "../core/sitePreview.js";
import { checkSiteHealth } from "../core/siteHealth.js";
import { getSiteDiagnosticReport } from "../core/siteDiagnostics.js";
import { getLaravelInstallerStatus, installOrUpdateLaravelInstaller, uninstallLaravelInstaller } from "../core/laravelInstaller.js";
import { clearLogs } from "../core/logging.js";
import { getStartupStatus, startConfiguredServicesOnLaunch, updateStartupSettings } from "../core/startup.js";
import { siteCommandDefinitions } from "../core/siteCommands.js";
import { applySiteEnvProfile, siteDatabaseInfo, siteEnvProfiles } from "../core/siteEnv.js";
import { listDatabases, listDatabaseTables, createManagedDatabase, dropManagedDatabase, exportDatabase, importDatabase } from "../core/databaseManager.js";
import { checkLaraboxsPorts } from "../core/portTools.js";
import { getUpdateCenterStatus } from "../core/updateCenter.js";
import type { NewSiteRequest, RuntimeKind, ServiceAction, SiteCommandKind, SiteEnvProfileKind, SiteWorkerKind } from "../core/types.js";
import { getSiteCreationJob, startSiteCreationJob } from "./siteJobs.js";
import { getSiteCommandJob, listSiteCommandJobs, startSiteCommandJob } from "./siteCommandJobs.js";
import { listSiteWorkers, startSiteWorker, stopAllSiteWorkers, stopSiteWorker, stopSiteWorkers } from "./siteWorkers.js";
import { ApiHttpError, apiSecurityHeaders, assertTrustedApiRequest, corsOrigin, maxJsonBodyBytes, statusForError } from "./httpSecurity.js";

const host = "127.0.0.1";
const port = Number(process.env.LARABOXS_API_PORT ?? 47899);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const builtUiRoot = path.join(projectRoot, "dist-ui");
const dashboardCsp =
  "default-src 'self'; connect-src 'self' http://127.0.0.1:47899 http://localhost:47899; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

const server = http.createServer(async (request, response) => {
  for (const [name, value] of Object.entries(apiSecurityHeaders())) {
    response.setHeader(name, value);
  }
  response.setHeader("Access-Control-Allow-Origin", corsOrigin(request.headers.origin, port));
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Laraboxs-Token");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);

    if (url.pathname.startsWith("/api/")) {
      assertTrustedApiRequest(request, port);
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      await sendJson(response, {
        ok: true,
        name: "laraboxs-helper",
        pid: process.pid,
        projectRoot,
        builtUiRoot
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/health.txt") {
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(["laraboxs-helper", projectRoot, String(process.pid)].join("\n"));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/shutdown") {
      await sendJson(response, { ok: true, message: "Shutdown requested." });
      setTimeout(() => void gracefulShutdown("API shutdown"), 50);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/summary") {
      await sendJson(response, await getDashboardSummary());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/updates") {
      await sendJson(response, await getUpdateCenterStatus());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/ports/check") {
      await sendJson(response, { ports: await checkLaraboxsPorts() });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/startup") {
      await sendJson(response, await getStartupStatus());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/startup") {
      const body = await readJson(request);
      const status = await updateStartupSettings(assertStartupSettings(body));
      await sendJson(response, { ok: true, status, summary: await getDashboardSummary() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/logs/clear") {
      const cleared = await clearLogs();
      await sendJson(response, { ok: true, cleared, summary: await getDashboardSummary() });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/phpmyadmin/status") {
      await writePhpMyAdminConfig();
      await sendJson(response, getPhpMyAdminStatus());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/setup/complete") {
      await updateConfig((config) => {
        config.setupComplete = true;
      });
      await sendJson(response, { ok: true, summary: await getDashboardSummary() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/settings") {
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
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/sites/park") {
      const body = await readJson(request);
      await addParkedFolder(assertString(body.path, "path"));
      await writeNginxConfigs();
      await sendJson(response, { ok: true, summary: await getDashboardSummary() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/sites/delete") {
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
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/sites/create/jobs/")) {
      const jobId = decodeURIComponent(url.pathname.slice("/api/sites/create/jobs/".length));
      const job = getSiteCreationJob(jobId);
      if (!job) {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Site creation job not found." }));
        return;
      }
      await sendJson(response, { job });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/sites/create") {
      const body = await readJson(request);
      const job = startSiteCreationJob(assertNewSiteRequest(body));
      await sendJson(response, { ok: true, job });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/sites/commands") {
      await sendJson(response, { commands: siteCommandDefinitions });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/sites/commands/jobs") {
      const site = url.searchParams.get("site") ?? undefined;
      await sendJson(response, { jobs: listSiteCommandJobs(site) });
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/sites/commands/jobs/")) {
      const jobId = decodeURIComponent(url.pathname.slice("/api/sites/commands/jobs/".length));
      const job = getSiteCommandJob(jobId);
      if (!job) {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Site command job not found." }));
        return;
      }
      await sendJson(response, { job });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/sites/commands/run") {
      const body = await readJson(request);
      const job = startSiteCommandJob(assertString(body.site, "site"), assertSiteCommandKind(body.command));
      await sendJson(response, { ok: true, job });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/sites/env") {
      const site = assertString(url.searchParams.get("site"), "site");
      await sendJson(response, await siteEnvProfiles(site));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/sites/database") {
      const site = assertString(url.searchParams.get("site"), "site");
      await sendJson(response, await siteDatabaseInfo(site));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/sites/env/apply") {
      const body = await readJson(request);
      const result = await applySiteEnvProfile(assertString(body.site, "site"), assertSiteEnvProfileKind(body.profile), {
        createDatabase: body.createDatabase === true
      });
      await sendJson(response, { ok: true, result });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/sites/workers") {
      const site = url.searchParams.get("site") ?? undefined;
      await sendJson(response, { workers: listSiteWorkers(site) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/sites/workers/start") {
      const body = await readJson(request);
      const worker = await startSiteWorker(assertString(body.site, "site"), assertSiteWorkerKind(body.kind));
      await sendJson(response, { ok: true, worker });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/sites/workers/stop") {
      const body = await readJson(request);
      const worker = await stopSiteWorker(assertString(body.site, "site"), assertSiteWorkerKind(body.kind));
      await sendJson(response, { ok: true, worker });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/laravel-installer/status") {
      await sendJson(response, await getLaravelInstallerStatus({ checkLatest: url.searchParams.get("latest") !== "0" }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/laravel-installer/install") {
      await sendJson(response, { ok: true, status: await installOrUpdateLaravelInstaller() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/laravel-installer/uninstall") {
      await sendJson(response, { ok: true, status: await uninstallLaravelInstaller() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/open-url") {
      const body = await readJson(request);
      openExternalUrl(assertHttpUrl(body.url));
      await sendJson(response, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/open-path") {
      const body = await readJson(request);
      const openedPath = await openLocalPath(assertString(body.path, "path"), body.reveal === true);
      await sendJson(response, { ok: true, path: openedPath });
      return;
    }

    if (request.method === "POST" && (url.pathname === "/api/dialog/folder" || url.pathname === "/api/dialogs/folder")) {
      const body = await readJson(request);
      if (body.probe === true) {
        await sendJson(response, { ok: true, available: true });
        return;
      }
      const selectedPath = await selectFolder({ initialPath: typeof body.initialPath === "string" ? body.initialPath : undefined });
      await sendJson(response, { ok: true, path: selectedPath });
      return;
    }

    if (request.method === "POST" && (url.pathname === "/api/dialog/sql-file" || url.pathname === "/api/dialogs/sql-file")) {
      const body = await readJson(request);
      if (body.probe === true) {
        await sendJson(response, { ok: true, available: true });
        return;
      }
      const selectedPath = await selectFile(sqlFileDialogOptions(typeof body.initialPath === "string" ? body.initialPath : undefined));
      await sendJson(response, { ok: true, path: selectedPath });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/hosts/sync") {
      const body = await readJson(request);
      const next = await syncHostsFile({ dryRun: Boolean(body.dryRun) });
      await sendJson(response, { ok: true, hosts: next });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/sites/entry") {
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
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/sites/preview") {
      const site = assertString(url.searchParams.get("site"), "site");
      const preview = await readSitePreviewImage(site, { refresh: url.searchParams.get("refresh") === "1" });
      response.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "no-cache",
        "Last-Modified": preview.updatedAt.toUTCString()
      });
      response.end(preview.body);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/sites/health") {
      const site = assertString(url.searchParams.get("site"), "site");
      await sendJson(response, await checkSiteHealth(site));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/sites/diagnostics") {
      const site = assertString(url.searchParams.get("site"), "site");
      await sendJson(response, await getSiteDiagnosticReport(site));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/php/use") {
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
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/php/versions") {
      const body = await readJson(request);
      const versions = optionalStringArray(body.versions);
      if (!versions) {
        throw new ApiHttpError(400, "PHP versions are required.");
      }
      await setConfiguredPhpVersions(versions, typeof body.globalVersion === "string" ? body.globalVersion : undefined);
      await sendJson(response, { ok: true, summary: await getDashboardSummary() });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/php/settings") {
      const version = url.searchParams.get("version") ?? undefined;
      await sendJson(response, await getPhpSettings(version));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/php/settings") {
      const body = await readJson(request);
      const wasRunning = (await getPhpFastCgiStatus()).state === "running";
      const settings = await updatePhpSettings(assertPhpSettings(body.settings ?? body));
      const php = wasRunning ? await runPhpFastCgi("restart") : await getPhpFastCgiStatus();
      await sendJson(response, { ok: true, settings, php, summary: await getDashboardSummary() });
      return;
    }

    if (request.method === "POST" && url.pathname.startsWith("/api/php-fcgi/")) {
      const action = serviceAction(url.pathname.split("/").at(-1));
      await sendJson(response, await runPhpFastCgi(action));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/php/ini/open") {
      const body = await readJson(request);
      const config = await loadConfig();
      const version = typeof body.version === "string" ? body.version : config.globalPhpVersion;
      const iniPath = await ensurePhpIni(version);
      await openLocalPath(iniPath, body.reveal === true);
      await sendJson(response, { ok: true, path: iniPath });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/php/isolate") {
      const body = await readJson(request);
      await isolateSite(assertString(body.site, "site"), assertString(body.version, "version"));
      await sendJson(response, { ok: true, summary: await getDashboardSummary() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/php/unisolate") {
      const body = await readJson(request);
      await unisolateSite(assertString(body.site, "site"));
      await sendJson(response, { ok: true, summary: await getDashboardSummary() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/nginx/settings") {
      const body = await readJson(request);
      const settings = await updateNginxSettings(assertNginxSettings(body.settings ?? body));
      await writeNginxConfigs();
      if (getNginxStatus().state === "running") {
        await runNginx("restart");
      }
      await sendJson(response, { ok: true, settings, summary: await getDashboardSummary() });
      return;
    }

    if (request.method === "POST" && url.pathname.startsWith("/api/nginx/")) {
      const action = serviceAction(url.pathname.split("/").at(-1));
      await sendJson(response, await runNginx(action));
      return;
    }

    if (request.method === "POST" && url.pathname.startsWith("/api/mysql/")) {
      const actionName = url.pathname.split("/").at(-1);

      if (actionName === "port") {
        const body = await readJson(request);
        const port = body.port === "auto" ? await findAvailableMysqlPort() : Number(body.port);
        await setMysqlPort(port);
        await sendJson(response, { ok: true, summary: await getDashboardSummary() });
        return;
      }

      if (actionName === "version") {
        const body = await readJson(request);
        await setMysqlVersion(assertString(body.version, "version"));
        await sendJson(response, { ok: true, summary: await getDashboardSummary() });
        return;
      }

      if (actionName === "init") {
        const status = await initializeMysqlDataDir();
        await sendJson(response, { ok: true, status, summary: await getDashboardSummary() });
        return;
      }

      if (actionName === "create-db") {
        const body = await readJson(request);
        const status = await runCreateDatabase(assertString(body.name, "name"));
        await sendJson(response, { ok: true, status });
        return;
      }

      if (actionName === "shell") {
        await openMysqlShell();
        await sendJson(response, { ok: true });
        return;
      }

      if (actionName === "ini") {
        const body = await readJson(request);
        const config = await loadConfig();
        await ensureMysqlConfigured();
        const iniPath = mysqlConfigPath(config.mysql.version);
        await openLocalPath(iniPath, body.reveal === true);
        await sendJson(response, { ok: true, path: iniPath });
        return;
      }

      if (actionName === "env") {
        const body = await readJson(request);
        await sendJson(response, { env: await laravelEnv(assertString(body.name, "name")) });
        return;
      }

      if (actionName === "password") {
        await sendJson(response, { password: await getMysqlRootPassword() });
        return;
      }

      if (actionName === "reset-password") {
        await sendJson(response, { password: await resetMysqlRootPassword(), summary: await getDashboardSummary() });
        return;
      }

      if (actionName === "change-password") {
        const body = await readJson(request);
        await sendJson(response, { password: await changeMysqlRootPassword(assertString(body.password, "password")), summary: await getDashboardSummary() });
        return;
      }

      await sendJson(response, await runMysql(serviceAction(actionName)));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/databases") {
      await sendJson(response, { databases: await listDatabases() });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/databases/tables") {
      const database = assertString(url.searchParams.get("database"), "database");
      await sendJson(response, { tables: await listDatabaseTables(database) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/databases/create") {
      const body = await readJson(request);
      await sendJson(response, { ok: true, database: await createManagedDatabase(assertString(body.name, "name")) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/databases/drop") {
      const body = await readJson(request);
      await dropManagedDatabase(assertString(body.name, "name"));
      await sendJson(response, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/databases/export") {
      const body = await readJson(request);
      await sendJson(response, { ok: true, export: await exportDatabase(assertString(body.name, "name")) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/databases/import") {
      const body = await readJson(request);
      await importDatabase(assertString(body.name, "name"), assertString(body.path, "path"));
      await sendJson(response, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/phpmyadmin/install") {
      const status = await installPhpMyAdmin();
      await writeNginxConfigs();
      await syncHostsFile();
      if (getNginxStatus().state === "running") {
        await runNginx("restart");
      }
      await sendJson(response, { ok: true, status, summary: await getDashboardSummary() });
      return;
    }

    if (request.method === "POST" && url.pathname.startsWith("/api/redis/")) {
      const actionName = url.pathname.split("/").at(-1);

      if (actionName === "port") {
        const body = await readJson(request);
        const port = body.port === "auto" ? await findAvailableRedisPort() : Number(body.port);
        await setRedisPort(port);
        await sendJson(response, { ok: true, summary: await getDashboardSummary() });
        return;
      }

      if (actionName === "shell") {
        await openRedisCli();
        await sendJson(response, { ok: true });
        return;
      }

      await sendJson(response, await runRedis(serviceAction(actionName)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/defender/exclude") {
      const body = await readJson(request);
      const targetPath = assertString(body.path, "path");
      const status = await tryEnsureWindowsDefenderExclusion(targetPath);
      await sendJson(response, { ok: status.excluded, status });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/runtimes/jobs") {
      await sendJson(response, { jobs: listRuntimeInstallJobs() });
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/runtimes/jobs/")) {
      const jobId = decodeURIComponent(url.pathname.slice("/api/runtimes/jobs/".length));
      const job = getRuntimeInstallJob(jobId);
      if (!job) {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Runtime install job not found." }));
        return;
      }
      await sendJson(response, { job });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runtimes/install") {
      const body = await readJson(request);
      const job = startRuntimeInstallJob(assertRuntimeKind(body.kind), typeof body.version === "string" ? body.version : undefined, { force: body.force === true });
      await sendJson(response, { ok: true, jobId: job.id, job });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runtimes/uninstall") {
      const body = await readJson(request);
      const status = await uninstallRuntime(assertRuntimeKind(body.kind), typeof body.version === "string" ? body.version : undefined);
      await sendJson(response, { ok: true, status, summary: await getDashboardSummary() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/ssl/secure") {
      const body = await readJson(request);
      await secureSite(assertString(body.site, "site"));
      await writeNginxConfigs();
      if (getNginxStatus().state === "running") {
        await runNginx("restart");
      }
      await sendJson(response, { ok: true, summary: await getDashboardSummary() });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/ssl/status") {
      await sendJson(response, await getLocalCaStatus());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/ssl/trust") {
      const status = await trustLocalCa({ wait: true });
      if (status.platform === "win32" && !status.trusted) {
        throw new ApiHttpError(409, status.message ?? "Local CA trust did not complete.");
      }
      await writeNginxConfigs();
      if (getNginxStatus().state === "running") {
        await runNginx("restart");
      }
      await sendJson(response, { ok: true, status, summary: await getDashboardSummary() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/ssl/unsecure") {
      const body = await readJson(request);
      await unsecureSite(assertString(body.site, "site"));
      await writeNginxConfigs();
      if (getNginxStatus().state === "running") {
        await runNginx("restart");
      }
      await sendJson(response, { ok: true, summary: await getDashboardSummary() });
      return;
    }

    if ((request.method === "GET" || request.method === "HEAD") && !url.pathname.startsWith("/api/")) {
      if (await serveBuiltUi(request, response, url)) {
        return;
      }
    }

    sendError(response, new ApiHttpError(404, "Not found"));
  } catch (error) {
    sendError(response, error);
  }
});

server.listen(port, host, () => {
  console.log(`laraboxs helper API listening on http://${host}:${port}`);
  void ensureDeveloperCommandPath();
  void startConfiguredServicesOnLaunch();
});

const shutdownTasks: Array<() => Promise<void> | void> = [];
let shuttingDown = false;

export function registerShutdownTask(task: () => Promise<void> | void): void {
  shutdownTasks.push(task);
}

async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}. Stopping services...`);

  try {
    await stopAllSiteWorkers();
  } catch {
    // Ignore errors during shutdown.
  }

  try {
    console.log("Stopping Nginx...");
    await runNginx("stop");
  } catch {
    // Ignore errors during shutdown.
  }

  try {
    console.log("Stopping PHP FastCGI...");
    await runPhpFastCgi("stop");
  } catch {
    // Ignore errors during shutdown.
  }

  try {
    console.log("Stopping MySQL...");
    await runMysql("stop");
  } catch {
    // Ignore errors during shutdown.
  }

  try {
    console.log("Stopping Redis...");
    await runRedis("stop");
  } catch {
    // Ignore errors during shutdown.
  }

  await Promise.all(shutdownTasks.map(async (task) => { try { await task(); } catch { /* noop */ } }));
  server.closeAllConnections?.();
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("Forced exit after shutdown timeout.");
    process.exit(1);
  }, 8000);
}

function setupGracefulShutdown(): void {
  process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
  process.on("exit", () => {
    console.log("laraboxs helper API exited.");
  });
}

setupGracefulShutdown();

async function sendJson(response: http.ServerResponse, value: unknown): Promise<void> {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value, null, 2));
}

function sendError(response: http.ServerResponse, error: unknown): void {
  const statusCode = statusForError(error);
  const message = error instanceof Error ? error.message : String(error);
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: message }, null, 2));
}

async function serveBuiltUi(request: http.IncomingMessage, response: http.ServerResponse, url: URL): Promise<boolean> {
  const filePath = await builtUiFilePath(url.pathname);
  if (!filePath) {
    return false;
  }

  const body = request.method === "HEAD" ? undefined : await readFile(filePath);
  response.writeHead(200, {
    "Content-Type": contentTypeFor(filePath),
    "Cache-Control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
    "Content-Security-Policy": dashboardCsp
  });
  response.end(body);
  return true;
}

async function builtUiFilePath(urlPath: string): Promise<string | undefined> {
  const requestedPath = safeUiPath(urlPath);
  if (!requestedPath) {
    return undefined;
  }

  const directPath = path.join(builtUiRoot, requestedPath);
  if (await isFile(directPath)) {
    return directPath;
  }

  const indexPath = path.join(builtUiRoot, "index.html");
  return (await isFile(indexPath)) ? indexPath : undefined;
}

function safeUiPath(urlPath: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }

  const normalized = path.normalize(decoded.replace(/^\/+/, "") || "index.html");
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    return undefined;
  }
  return normalized;
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function contentTypeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}

function readJson(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let rejected = false;
    request.on("data", (chunk) => {
      if (rejected) {
        return;
      }
      const buffer = Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > maxJsonBodyBytes) {
        rejected = true;
        reject(new ApiHttpError(413, `JSON request body must be ${maxJsonBodyBytes} bytes or smaller.`));
        return;
      }
      chunks.push(buffer);
    });
    request.on("error", (error) => {
      if (!rejected) {
        reject(error);
      }
    });
    request.on("end", () => {
      if (rejected) {
        return;
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        reject(new ApiHttpError(400, "Request body must be valid JSON."));
      }
    });
  });
}

function assertString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiHttpError(400, `${name} is required.`);
  }
  return value;
}

function assertHttpUrl(value: unknown): string {
  const raw = assertString(value, "url");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ApiHttpError(400, "URL is invalid.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ApiHttpError(400, "Only http and https URLs can be opened.");
  }

  return parsed.toString();
}

function openExternalUrl(url: string): void {
  const command =
    process.platform === "win32"
      ? { file: "cmd.exe", args: ["/d", "/c", "start", "", url] }
      : process.platform === "darwin"
        ? { file: "open", args: [url] }
        : { file: "xdg-open", args: [url] };

  const child = spawn(command.file, command.args, {
    detached: true,
    stdio: "ignore",
    shell: false,
    windowsHide: true
  });
  child.once("error", () => undefined);
  child.unref();
}

async function openLocalPath(target: string, reveal: boolean): Promise<string> {
  const resolved = path.resolve(target);
  const targetStat = await stat(resolved).catch(() => undefined);
  const fallbackFolder = targetStat?.isDirectory() ? resolved : path.dirname(resolved);
  const folderStat = await stat(fallbackFolder).catch(() => undefined);
  const openTarget = targetStat ? resolved : folderStat?.isDirectory() ? fallbackFolder : resolved;

  const command =
    process.platform === "win32"
      ? {
          file: "explorer.exe",
          args: reveal && targetStat && !targetStat.isDirectory() ? ["/select,", resolved] : [openTarget],
          windowsHide: false
        }
      : process.platform === "darwin"
        ? { file: "open", args: reveal && targetStat ? ["-R", resolved] : [openTarget], windowsHide: true }
        : { file: "xdg-open", args: [reveal && targetStat && !targetStat.isDirectory() ? fallbackFolder : openTarget], windowsHide: true };

  const child = spawn(command.file, command.args, {
    detached: true,
    stdio: "ignore",
    shell: false,
    windowsHide: command.windowsHide
  });
  child.once("error", () => undefined);
  child.unref();
  return openTarget;
}

function assertGeneralSettings(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiHttpError(400, "Settings are required.");
  }

  const input = value as Record<string, unknown>;
  return {
    tld: typeof input.tld === "string" ? assertLocalTld(input.tld) : undefined,
    setupComplete: typeof input.setupComplete === "boolean" ? input.setupComplete : undefined
  };
}

function assertStartupSettings(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiHttpError(400, "Startup settings are required.");
  }

  const input = value as Record<string, unknown>;
  return {
    launchAppOnLogin: typeof input.launchAppOnLogin === "boolean" ? input.launchAppOnLogin : undefined,
    startServicesOnLaunch: typeof input.startServicesOnLaunch === "boolean" ? input.startServicesOnLaunch : undefined
  };
}

function assertLocalTld(value: string): string {
  const tld = value.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(tld)) {
    throw new ApiHttpError(400, "Local TLD must use letters, numbers, or hyphens.");
  }
  return tld;
}

function assertPhpSettings(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiHttpError(400, "PHP settings are required.");
  }

  const input = value as Record<string, unknown>;
  return {
    memoryLimit: optionalString(input.memoryLimit),
    uploadMaxFilesize: optionalString(input.uploadMaxFilesize),
    postMaxSize: optionalString(input.postMaxSize),
    maxExecutionTime: optionalNumber(input.maxExecutionTime),
    maxInputVars: optionalNumber(input.maxInputVars),
    enabledExtensions: optionalStringArray(input.enabledExtensions),
    xdebugEnabled: typeof input.xdebugEnabled === "boolean" ? input.xdebugEnabled : undefined,
    xdebugIdeKey: typeof input.xdebugIdeKey === "string" ? input.xdebugIdeKey : undefined
  };
}

function assertNginxSettings(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiHttpError(400, "Nginx settings are required.");
  }

  const input = value as Record<string, unknown>;
  return {
    httpPort: requiredPort(input.httpPort, "HTTP port"),
    httpsPort: requiredPort(input.httpsPort, "HTTPS port"),
    fastCgiHost: assertString(input.fastCgiHost, "FastCGI host")
  };
}

function assertNewSiteRequest(value: unknown): NewSiteRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiHttpError(400, "Site options are required.");
  }

  const input = value as Record<string, unknown>;
  return {
    name: assertString(input.name, "name"),
    parentPath: optionalString(input.parentPath),
    preset: newSitePreset(input.preset),
    starterKit: optionalEnum(input.starterKit, ["none", "react", "vue", "svelte", "livewire"], "starter kit"),
    auth: optionalEnum(input.auth, ["default", "none", "workos"], "authentication"),
    database: optionalEnum(input.database, ["sqlite", "mysql", "mariadb", "pgsql", "sqlsrv"], "database"),
    packageManager: optionalEnum(input.packageManager, ["none", "npm", "pnpm", "bun", "yarn"], "package manager"),
    testing: optionalEnum(input.testing, ["pest", "phpunit"], "testing framework"),
    git: input.git === true,
    boost: input.boost === true
  };
}

function newSitePreset(value: unknown): NewSiteRequest["preset"] {
  if (value === "laravel" || value === "php" || value === "static") {
    return value;
  }
  throw new ApiHttpError(400, "Site preset must be laravel, php, or static.");
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new ApiHttpError(400, `Unsupported ${label}: ${String(value)}`);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function requiredPort(value: unknown, name: string): number {
  const port = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(port)) {
    throw new ApiHttpError(400, `${name} is required.`);
  }
  return port;
}

function optionalStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

function serviceAction(value: string | undefined): ServiceAction {
  if (value === "start" || value === "stop" || value === "restart") {
    return value;
  }
  throw new ApiHttpError(400, `Unsupported service action: ${value ?? ""}`);
}

function assertRuntimeKind(value: unknown): RuntimeKind {
  if (value === "php" || value === "mysql" || value === "nginx" || value === "redis" || value === "node" || value === "composer") {
    return value;
  }
  throw new ApiHttpError(400, `Unsupported runtime: ${String(value)}`);
}

function assertSiteCommandKind(value: unknown): SiteCommandKind {
  if (
    value === "artisan:migrate" ||
    value === "artisan:cache-clear" ||
    value === "artisan:route-list" ||
    value === "composer:install" ||
    value === "npm:install" ||
    value === "npm:build"
  ) {
    return value;
  }
  throw new ApiHttpError(400, `Unsupported site command: ${String(value)}`);
}

function assertSiteEnvProfileKind(value: unknown): SiteEnvProfileKind {
  if (value === "app" || value === "database" || value === "redis" || value === "queue-redis" || value === "full") {
    return value;
  }
  throw new ApiHttpError(400, `Unsupported .env profile: ${String(value)}`);
}

function assertSiteWorkerKind(value: unknown): SiteWorkerKind {
  if (value === "queue" || value === "schedule") {
    return value;
  }
  throw new ApiHttpError(400, `Unsupported worker: ${String(value)}`);
}
