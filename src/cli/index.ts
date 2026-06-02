#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { addParkedFolder, discoverSites, findSiteForCwd, isolateSite, setGlobalPhpVersion, unisolateSite } from "../core/sites.js";
import { syncHostsFile } from "../core/hosts.js";
import { runPhp, selectedPhpVersionForCwd, phpBinaryPath } from "../core/php.js";
import { runNginx, writeNginxConfigs } from "../core/nginx.js";
import {
  buildMysqlCommand,
  ensureMysqlConfigured,
  getMysqlStatus,
  laravelEnv,
  mysqlShellCommand,
  resetMysqlRootPassword,
  runCreateDatabase,
  runMysql
} from "../core/mysql.js";
import { loadConfig } from "../core/config.js";
import { getPaths } from "../core/paths.js";
import { secureSite, unsecureSite } from "../core/ssl.js";
import { readRecentLogs } from "../core/logging.js";

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

    case "secure":
      await secureSite(requiredArg(commandArgs[0], "domain or site name"));
      await writeNginxConfigs();
      console.log(`Secured ${commandArgs[0]}.`);
      return 0;

    case "unsecure":
      await unsecureSite(requiredArg(commandArgs[0], "domain or site name"));
      await writeNginxConfigs();
      console.log(`Unsecured ${commandArgs[0]}.`);
      return 0;

    case "secured":
      console.log((await loadConfig()).securedDomains.join("\n"));
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
      const child = spawn(spec.command, spec.args, { stdio: "inherit", shell: false });
      return new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
    }

    case "mysql:reset-password":
      console.log(await resetMysqlRootPassword());
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
      framework: site.framework
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

  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", site.url], { detached: true, stdio: "ignore", shell: false }).unref();
  } else {
    spawn("xdg-open", [site.url], { detached: true, stdio: "ignore", shell: false }).unref();
  }

  console.log(site.url);
  return 0;
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

function requiredArg(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}

function printHelp(): void {
  console.log(`laraboxs MVP

Usage:
  laraboxs sites
  laraboxs park [folder] [--dry-run-hosts]
  laraboxs paths
  laraboxs open [site]
  laraboxs secure <site>
  laraboxs unsecure <site>
  laraboxs secured
  laraboxs use <php-version>
  laraboxs isolate <php-version> [site]
  laraboxs unisolate [site]
  laraboxs which-php
  laraboxs php [...args]
  laraboxs start|stop|restart
  laraboxs logs
  laraboxs mysql:start|mysql:stop|mysql:restart|mysql:status
  laraboxs mysql:logs
  laraboxs mysql:create-db <database_name>
  laraboxs mysql:shell
  laraboxs mysql:reset-password
`);
}
