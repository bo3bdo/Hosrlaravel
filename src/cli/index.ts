#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { addParkedFolder, discoverSites, findSiteForCwd, isolateSite, resetSiteEntryPath, setGlobalPhpVersion, setSiteEntryPath, unisolateSite } from "../core/sites.js";
import { syncHostsFile } from "../core/hosts.js";
import { getPhpFastCgiStatus, getPhpSettings, runPhp, runPhpFastCgi, selectedPhpVersionForCwd, phpBinaryPath, updatePhpSettings } from "../core/php.js";
import { getNginxStatus, runNginx, writeNginxConfigs } from "../core/nginx.js";
import {
  buildMysqlCommand,
  changeMysqlRootPassword,
  findAvailableMysqlPort,
  getMysqlRootPassword,
  ensureMysqlConfigured,
  getMysqlStatus,
  initializeMysqlDataDir,
  laravelEnv,
  mysqlShellCommand,
  resetMysqlRootPassword,
  runCreateDatabase,
  runMysql,
  setMysqlVersion
} from "../core/mysql.js";
import { findAvailableRedisPort, getRedisStatus, redisCliCommand, runRedis, setRedisPort } from "../core/redis.js";
import { loadConfig } from "../core/config.js";
import { getPaths } from "../core/paths.js";
import { getRuntimeStatus, installRuntime, uninstallRuntime } from "../core/runtimes.js";
import { getPhpMyAdminStatus, installPhpMyAdmin } from "../core/phpmyadmin.js";
import { installConfiguredPhpExtensions } from "../core/phpExtensions.js";
import { getLocalCaStatus, secureSite, trustLocalCa, unsecureSite } from "../core/ssl.js";
import { readRecentLogs } from "../core/logging.js";
import type { PhpConfig, RuntimeKind } from "../core/types.js";

const args = process.argv.slice(2);
const command = args.shift() ?? "help";

try {
  const exitCode = await main(command, args);
  process.exit(exitCode);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function main(commandName: string, commandArgs: string[]): Promise<number> {
  switch (commandName) {
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return 0;

    case "sites":
      return printSites();

    case "park":
      return park(commandArgs);

    case "paths":
      console.log(JSON.stringify(getPaths(), null, 2));
      return 0;

    case "open":
      return openSite(commandArgs[0]);

    case "site:entry":
      return setSiteEntryFromCli(commandArgs);

    case "site:entry:reset":
      return resetSiteEntryFromCli(commandArgs);

    case "secure":
      await secureSite(requiredArg(commandArgs[0], "domain or site name"));
      await writeNginxConfigs();
      if (getNginxStatus().state === "running") {
        await runNginx("restart");
      }
      console.log(`Secured ${commandArgs[0]}.`);
      return 0;

    case "unsecure":
      await unsecureSite(requiredArg(commandArgs[0], "domain or site name"));
      await writeNginxConfigs();
      if (getNginxStatus().state === "running") {
        await runNginx("restart");
      }
      console.log(`Unsecured ${commandArgs[0]}.`);
      return 0;

    case "secured":
      console.log((await loadConfig()).securedDomains.join("\n"));
      return 0;

    case "ssl:status":
      console.log(JSON.stringify(await getLocalCaStatus(), null, 2));
      return 0;

    case "ssl:trust":
      console.log(JSON.stringify(await trustLocalCa({ wait: commandArgs.includes("--wait") }), null, 2));
      return 0;

    case "use":
      await setGlobalPhpVersion(requiredArg(commandArgs[0], "PHP version"));
      console.log(`Global PHP version set to ${commandArgs[0]}.`);
      return 0;

    case "isolate":
      return isolate(commandArgs);

    case "unisolate":
      return unisolate(commandArgs);

    case "which-php": {
      const version = await selectedPhpVersionForCwd();
      console.log(phpBinaryPath(version));
      return 0;
    }

    case "php":
      return runPhp(commandArgs);

    case "php-fcgi:start":
      console.log(JSON.stringify(await runPhpFastCgi("start"), null, 2));
      return 0;

    case "php-fcgi:stop":
      console.log(JSON.stringify(await runPhpFastCgi("stop"), null, 2));
      return 0;

    case "php-fcgi:restart":
      console.log(JSON.stringify(await runPhpFastCgi("restart"), null, 2));
      return 0;

    case "php-fcgi:status":
      console.log(JSON.stringify(await getPhpFastCgiStatus(), null, 2));
      return 0;

    case "php:settings":
      console.log(JSON.stringify(await getPhpSettings(commandArgs[0]), null, 2));
      return 0;

    case "php:settings:set": {
      const wasRunning = (await getPhpFastCgiStatus()).state === "running";
      const settings = await updatePhpSettings(parsePhpSettings(commandArgs));
      if (wasRunning) {
        await runPhpFastCgi("restart");
      }
      console.log(JSON.stringify(settings, null, 2));
      return 0;
    }

    case "php:extensions:install":
      console.log(JSON.stringify(await installConfiguredPhpExtensions(commandArgs[0]), null, 2));
      return 0;

    case "start":
      console.log(JSON.stringify(await runNginx("start"), null, 2));
      return 0;

    case "stop":
      console.log(JSON.stringify(await runNginx("stop"), null, 2));
      return 0;

    case "restart":
      console.log(JSON.stringify(await runNginx("restart"), null, 2));
      return 0;

    case "logs":
      console.log((await readRecentLogs()).join("\n"));
      return 0;

    case "mysql:start":
      console.log(JSON.stringify(await runMysql("start"), null, 2));
      return 0;

    case "mysql:stop":
      console.log(JSON.stringify(await runMysql("stop"), null, 2));
      return 0;

    case "mysql:restart":
      console.log(JSON.stringify(await runMysql("restart"), null, 2));
      return 0;

    case "mysql:status":
      await ensureMysqlConfigured();
      console.log(JSON.stringify(await getMysqlStatus(), null, 2));
      return 0;

    case "mysql:init":
      console.log(JSON.stringify(await initializeMysqlDataDir(), null, 2));
      return 0;

    case "mysql:port": {
      const requested = commandArgs[0] === "--auto" ? await findAvailableMysqlPort() : Number(requiredArg(commandArgs[0], "port or --auto"));
      const { setMysqlPort } = await import("../core/mysql.js");
      await setMysqlPort(requested);
      console.log(`MySQL port set to ${requested}.`);
      return 0;
    }

    case "mysql:use":
      await setMysqlVersion(requiredArg(commandArgs[0], "MySQL version"));
      console.log(`MySQL version set to ${commandArgs[0]}.`);
      return 0;

    case "mysql:logs":
      console.log((await readRecentLogs()).filter((line) => line.includes("[mysql]")).join("\n"));
      return 0;

    case "mysql:create-db": {
      const status = await runCreateDatabase(requiredArg(commandArgs[0], "database name"));
      console.log(JSON.stringify(status, null, 2));
      console.log(await laravelEnv(commandArgs[0]));
      return 0;
    }

    case "mysql:shell": {
      const spec = await mysqlShellCommand();
      const child = spawn(spec.command, spec.args, { env: { ...process.env, ...(spec.env ?? {}) }, stdio: "inherit", shell: false });
      return new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
    }

    case "mysql:reset-password":
      console.log(await resetMysqlRootPassword());
      return 0;

    case "mysql:change-password":
      console.log(await changeMysqlRootPassword(requiredArg(commandArgs[0], "new root password")));
      return 0;

    case "mysql:password":
      console.log(await getMysqlRootPassword());
      return 0;

    case "mysql:env":
      console.log(await laravelEnv(requiredArg(commandArgs[0], "database name")));
      return 0;

    case "redis:start":
      console.log(JSON.stringify(await runRedis("start"), null, 2));
      return 0;

    case "redis:stop":
      console.log(JSON.stringify(await runRedis("stop"), null, 2));
      return 0;

    case "redis:restart":
      console.log(JSON.stringify(await runRedis("restart"), null, 2));
      return 0;

    case "redis:status":
      console.log(JSON.stringify(await getRedisStatus(), null, 2));
      return 0;

    case "redis:port": {
      const requested = commandArgs[0] === "--auto" ? await findAvailableRedisPort() : Number(requiredArg(commandArgs[0], "port or --auto"));
      await setRedisPort(requested);
      console.log(`Redis port set to ${requested}.`);
      return 0;
    }

    case "redis:shell": {
      const spec = await redisCliCommand();
      const child = spawn(spec.command, spec.args, { stdio: "inherit", shell: false, windowsHide: true });
      return new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
    }

    case "phpmyadmin:status":
      console.log(JSON.stringify(getPhpMyAdminStatus(), null, 2));
      return 0;

    case "phpmyadmin:install":
      return installPhpMyAdminFromCli(commandArgs);

    case "phpmyadmin:open":
      return openPhpMyAdmin();

    case "install": {
      const runtime = parseRuntimeCommandArgs(commandArgs);
      console.log(JSON.stringify(await installRuntime(runtime.kind, runtime.version, { force: runtime.force }), null, 2));
      return 0;
    }

    case "uninstall": {
      const runtime = parseRuntimeCommandArgs(commandArgs);
      console.log(JSON.stringify(await uninstallRuntime(runtime.kind, runtime.version), null, 2));
      return 0;
    }

    case "runtimes":
      console.log(JSON.stringify(getRuntimeStatus(), null, 2));
      return 0;

    case "mysql:command":
      console.log(JSON.stringify(await buildMysqlCommand((commandArgs[0] as "start" | "stop" | "restart") ?? "start"), null, 2));
      return 0;

    default:
      console.error(`Unknown command: ${commandName}`);
      printHelp();
      return 1;
  }
}

async function printSites(): Promise<number> {
  const sites = await discoverSites();
  if (sites.length === 0) {
    console.log("No sites found. Run laraboxs park <folder>.");
    return 0;
  }

  console.table(
    sites.map((site) => ({
      name: site.name,
      url: site.url,
      path: site.path,
      ssl: site.secured ? "yes" : "no",
      php: site.phpVersion,
      framework: site.framework,
      entry: site.entryPath
    }))
  );
  return 0;
}

async function park(commandArgs: string[]): Promise<number> {
  const dryRunHosts = commandArgs.includes("--dry-run-hosts");
  const folderArg = commandArgs.find((arg) => !arg.startsWith("--"));
  const folder = path.resolve(folderArg ?? process.cwd());
  await addParkedFolder(folder);
  await writeNginxConfigs();
  const hosts = await syncHostsFile({ dryRun: dryRunHosts });
  console.log(`Parked ${folder}.`);
  if (dryRunHosts) {
    console.log(hosts);
  } else {
    console.log("Hosts file synced.");
  }
  return 0;
}

async function openSite(identifier?: string): Promise<number> {
  const site = identifier ? (await discoverSites()).find((candidate) => candidate.name === identifier || candidate.domain === identifier) : await findSiteForCwd();
  if (!site) {
    throw new Error(`No site found for ${identifier ?? process.cwd()}.`);
  }

  openUrl(site.url);
  console.log(site.url);
  return 0;
}

async function setSiteEntryFromCli(commandArgs: string[]): Promise<number> {
  const { site, entry } = await parseSiteEntryArgs(commandArgs);
  await setSiteEntryPath(site, entry);
  await writeNginxConfigs();
  if (getNginxStatus().state === "running") {
    await runNginx("restart");
  }
  console.log(`${site} Nginx entry set to ${entry}.`);
  return 0;
}

async function resetSiteEntryFromCli(commandArgs: string[]): Promise<number> {
  const site = commandArgs[0] ?? (await findSiteForCwd()).domain;
  await resetSiteEntryPath(site);
  await writeNginxConfigs();
  if (getNginxStatus().state === "running") {
    await runNginx("restart");
  }
  console.log(`${site} Nginx entry reset to default.`);
  return 0;
}

async function installPhpMyAdminFromCli(commandArgs: string[]): Promise<number> {
  const dryRunHosts = commandArgs.includes("--dry-run-hosts");
  const skipHosts = commandArgs.includes("--no-hosts");
  const status = await installPhpMyAdmin();
  await writeNginxConfigs();

  const hosts = skipHosts ? undefined : await syncHostsFile({ dryRun: dryRunHosts });
  if (getNginxStatus().state === "running") {
    await runNginx("restart");
  }

  console.log(JSON.stringify(status, null, 2));
  if (skipHosts) {
    console.log("Hosts file sync skipped.");
  } else if (dryRunHosts) {
    console.log(hosts);
  } else {
    console.log("Hosts file synced.");
  }
  return 0;
}

async function openPhpMyAdmin(): Promise<number> {
  const status = getPhpMyAdminStatus();
  if (!status.installed) {
    throw new Error("phpMyAdmin is not installed. Run laraboxs phpmyadmin:install first.");
  }

  openUrl(status.url);
  console.log(status.url);
  return 0;
}

function openUrl(url: string): void {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", shell: false, windowsHide: true }).unref();
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore", shell: false }).unref();
  }
}

async function isolate(commandArgs: string[]): Promise<number> {
  const version = requiredArg(commandArgs[0], "PHP version");
  const site = commandArgs[1] ?? (await findSiteForCwd()).domain;
  await isolateSite(site, version);
  await writeNginxConfigs();
  console.log(`${site} now uses PHP ${version}.`);
  return 0;
}

async function unisolate(commandArgs: string[]): Promise<number> {
  const site = commandArgs[0] ?? (await findSiteForCwd()).domain;
  await unisolateSite(site);
  await writeNginxConfigs();
  console.log(`${site} now uses the global PHP version.`);
  return 0;
}

async function parseSiteEntryArgs(commandArgs: string[]): Promise<{ site: string; entry: string }> {
  if (commandArgs.length >= 2) {
    return { site: commandArgs[0], entry: commandArgs[1] };
  }

  const entry = requiredArg(commandArgs[0], "entry");
  return { site: (await findSiteForCwd()).domain, entry };
}

function requiredArg(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}

function parseRuntimeCommandArgs(commandArgs: string[]): { kind: RuntimeKind; version?: string; force: boolean } {
  const positional = commandArgs.filter((arg) => !arg.startsWith("--"));
  const kind = assertRuntimeKind(requiredArg(positional[0], "runtime"));
  return {
    kind,
    version: positional[1],
    force: commandArgs.includes("--force")
  };
}

function assertRuntimeKind(value: string): RuntimeKind {
  if (value === "php" || value === "mysql" || value === "nginx" || value === "redis" || value === "node" || value === "composer") {
    return value;
  }
  throw new Error("Runtime must be one of: php, mysql, nginx, redis, node, composer.");
}

function parsePhpSettings(commandArgs: string[]): Partial<PhpConfig> {
  if (commandArgs.length === 0) {
    throw new Error("Missing PHP settings. Use key=value pairs, for example memory_limit=512M extensions=curl,mbstring.");
  }

  const settings: Partial<PhpConfig> = {};
  for (const arg of commandArgs) {
    const separator = arg.indexOf("=");
    if (separator < 1) {
      throw new Error(`Invalid PHP setting: ${arg}. Use key=value.`);
    }

    const key = normalizePhpSettingKey(arg.slice(0, separator));
    const value = arg.slice(separator + 1);
    if (value === "") {
      throw new Error(`Missing value for PHP setting: ${arg.slice(0, separator)}.`);
    }

    switch (key) {
      case "memorylimit":
        settings.memoryLimit = value;
        break;
      case "uploadmaxfilesize":
        settings.uploadMaxFilesize = value;
        break;
      case "postmaxsize":
        settings.postMaxSize = value;
        break;
      case "maxexecutiontime":
        settings.maxExecutionTime = Number(value);
        break;
      case "maxinputvars":
        settings.maxInputVars = Number(value);
        break;
      case "extensions":
      case "enabledextensions":
        settings.enabledExtensions = value
          .split(",")
          .map((extension) => extension.trim())
          .filter(Boolean);
        break;
      default:
        throw new Error(`Unsupported PHP setting: ${arg.slice(0, separator)}.`);
    }
  }

  return settings;
}

function normalizePhpSettingKey(key: string): string {
  return key.replace(/[-_]/g, "").toLowerCase();
}

function printHelp(): void {
  console.log(`laraboxs

Usage:
  laraboxs sites
  laraboxs park [folder] [--dry-run-hosts]
  laraboxs paths
  laraboxs open [site]
  laraboxs site:entry <site> <entry>
  laraboxs site:entry <entry>
  laraboxs site:entry:reset [site]
  laraboxs secure <site>
  laraboxs unsecure <site>
  laraboxs secured
  laraboxs ssl:status
  laraboxs ssl:trust [--wait]
  laraboxs use <php-version>
  laraboxs isolate <php-version> [site]
  laraboxs unisolate [site]
  laraboxs which-php
  laraboxs php [...args]
  laraboxs php-fcgi:start|php-fcgi:stop|php-fcgi:restart|php-fcgi:status
  laraboxs php:settings [php-version]
  laraboxs php:settings:set memory_limit=512M upload_max_filesize=128M post_max_size=128M max_execution_time=60 max_input_vars=3000 extensions=curl,mbstring,openssl,pdo_mysql
  laraboxs php:extensions:install [php-version]
  laraboxs start|stop|restart
  laraboxs logs
  laraboxs runtimes
  laraboxs install [--force] php <8.4|8.5>
  laraboxs install [--force] mysql <9.7|8.4|8.0|mariadb-11.8.6>
  laraboxs install nginx
  laraboxs install redis
  laraboxs install node
  laraboxs install composer
  laraboxs uninstall php <8.4|8.5>
  laraboxs uninstall mysql <9.7|8.4|8.0|mariadb-11.8.6>
  laraboxs uninstall nginx|redis|node|composer
  laraboxs mysql:start|mysql:stop|mysql:restart|mysql:status
  laraboxs mysql:init
  laraboxs mysql:use <9.7|8.4|8.0|mariadb-11.8.6>
  laraboxs mysql:port <port|--auto>
  laraboxs mysql:logs
  laraboxs mysql:create-db <database_name>
  laraboxs mysql:shell
  laraboxs mysql:reset-password
  laraboxs mysql:change-password <new_password>
  laraboxs mysql:password
  laraboxs mysql:env <database_name>
  laraboxs redis:start|redis:stop|redis:restart|redis:status
  laraboxs redis:port <port|--auto>
  laraboxs redis:shell
  laraboxs phpmyadmin:status
  laraboxs phpmyadmin:install [--dry-run-hosts|--no-hosts]
  laraboxs phpmyadmin:open
`);
}
