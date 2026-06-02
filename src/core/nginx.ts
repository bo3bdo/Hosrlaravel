import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadConfig, updateConfig } from "./config.js";
import { appendLog } from "./logging.js";
import { getPaths, toNginxPath } from "./paths.js";
import { ensurePhpFastCgiWorkers, phpFastCgiPort } from "./php.js";
import { generatePhpMyAdminNginxConfig } from "./phpmyadmin.js";
import { discoverSites } from "./sites.js";
import type { CommandSpec, NginxConfig, ServiceAction, ServiceStatus, Site } from "./types.js";

export function generateNginxMainConfig(): string {
  const paths = getPaths();
  return [
    "worker_processes  1;",
    `pid "${toNginxPath(path.join(paths.logs, "nginx.pid"))}";`,
    "",
    "events {",
    "    worker_connections  1024;",
    "}",
    "",
    "http {",
    "    include       mime.types;",
    "    default_type  application/octet-stream;",
    `    access_log    "${toNginxPath(path.join(paths.logs, "nginx-access.log"))}";`,
    `    error_log     "${toNginxPath(path.join(paths.logs, "nginx-error.log"))}";`,
    "    sendfile      on;",
    "    keepalive_timeout  65;",
    `    include       "${toNginxPath(path.join(paths.nginxSites, "*.conf"))}";`,
    "}"
  ].join("\n");
}

export async function generateNginxSiteConfig(site: Site): Promise<string> {
  const config = await loadConfig();
  const root = toNginxPath(site.documentRoot);
  const fastCgiPort = phpFastCgiPort(site.phpVersion);
  const certificate = toNginxPath(path.join(getPaths().certs, `${site.domain}.crt`));
  const key = toNginxPath(path.join(getPaths().certs, `${site.domain}.key`));
  const phpLocation = [
    "    location ~ \\.php$ {",
    "        include fastcgi_params;",
    `        fastcgi_pass ${config.nginx.fastCgiHost}:${fastCgiPort};`,
    "        fastcgi_index index.php;",
    "        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;",
    "    }"
  ].join("\n");

  const appServer = [
    `    server_name ${site.domain};`,
    `    root "${root}";`,
    "    index index.php index.html index.htm;",
    "",
    "    location / {",
    "        try_files $uri $uri/ /index.php?$query_string;",
    "    }",
    "",
    phpLocation
  ].join("\n");

  if (!site.secured) {
    return [
      "server {",
      `    listen 127.0.0.1:${config.nginx.httpPort};`,
      appServer,
      "}"
    ].join("\n");
  }

  return [
    "server {",
    `    listen 127.0.0.1:${config.nginx.httpPort};`,
    `    server_name ${site.domain};`,
    "    return 301 https://$host$request_uri;",
    "}",
    "",
    "server {",
    `    listen 127.0.0.1:${config.nginx.httpsPort} ssl;`,
    `    ssl_certificate "${certificate}";`,
    `    ssl_certificate_key "${key}";`,
    appServer,
    "}"
  ].join("\n");
}

export async function writeNginxConfigs(): Promise<void> {
  const paths = getPaths();
  const sites = await discoverSites();
  await mkdir(path.dirname(paths.nginxConfig), { recursive: true });
  await mkdir(paths.nginxSites, { recursive: true });
  await mkdir(paths.logs, { recursive: true });

  for (const entry of await readdir(paths.nginxSites, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".conf")) {
      await rm(path.join(paths.nginxSites, entry.name), { force: true });
    }
  }

  await writeFile(paths.nginxConfig, `${generateNginxMainConfig()}\n`, "utf8");

  await Promise.all(
    sites.map(async (site) => {
      const filePath = path.join(paths.nginxSites, `${site.domain}.conf`);
      await writeFile(filePath, `${await generateNginxSiteConfig(site)}\n`, "utf8");
    })
  );

  const phpMyAdminConfig = await generatePhpMyAdminNginxConfig();
  if (phpMyAdminConfig) {
    await writeFile(path.join(paths.nginxSites, "phpmyadmin.test.conf"), `${phpMyAdminConfig}\n`, "utf8");
  }

  await appendLog("nginx", `wrote ${sites.length + (phpMyAdminConfig ? 1 : 0)} site config(s)`);
}

export async function updateNginxSettings(settings: Partial<NginxConfig>): Promise<NginxConfig> {
  const next: Partial<NginxConfig> = {};

  if (settings.httpPort !== undefined) {
    next.httpPort = validatePort(settings.httpPort, "HTTP port");
  }
  if (settings.httpsPort !== undefined) {
    next.httpsPort = validatePort(settings.httpsPort, "HTTPS port");
  }
  if (settings.fastCgiHost !== undefined) {
    next.fastCgiHost = validateFastCgiHost(settings.fastCgiHost);
  }

  const config = await updateConfig((current) => {
    const merged = { ...current.nginx, ...next };
    if (merged.httpPort === merged.httpsPort) {
      throw new Error("HTTP and HTTPS ports must be different.");
    }
    current.nginx = merged;
  });

  await appendLog("nginx", `updated settings: http=${config.nginx.httpPort}, https=${config.nginx.httpsPort}, fastcgi=${config.nginx.fastCgiHost}`);
  return config.nginx;
}

export function nginxBinaryPath(): string {
  return path.join(getPaths().nginxRoot, "nginx.exe");
}

export function buildNginxCommand(action: ServiceAction): CommandSpec {
  const paths = getPaths();
  const baseArgs = ["-p", paths.nginxRoot, "-c", paths.nginxConfig];

  if (action === "stop") {
    return { command: nginxBinaryPath(), args: [...baseArgs, "-s", "stop"] };
  }

  if (action === "restart") {
    return { command: nginxBinaryPath(), args: [...baseArgs, "-s", "reload"] };
  }

  return { command: nginxBinaryPath(), args: baseArgs };
}

export async function runNginx(action: ServiceAction): Promise<ServiceStatus> {
  await writeNginxConfigs();
  const command = buildNginxCommand(action);

  if (!existsSync(nginxBinaryPath())) {
    const message = `Nginx is not installed. Install it from Setup or the Nginx page.`;
    await appendLog("nginx", message);
    return { name: "nginx", state: "unknown", logPath: path.join(getPaths().logs, "nginx-error.log"), message };
  }

  if (action === "start" || action === "restart") {
    await ensurePhpFastCgiWorkers();
  }

  const child = spawn(command.command, command.args, {
    cwd: getPaths().nginxRoot,
    detached: true,
    stdio: "ignore",
    shell: false,
    windowsHide: true
  });
  child.once("error", (error) => {
    void appendLog("nginx", `${action} failed: ${error.message}`);
  });
  child.unref();
  await appendLog("nginx", `${action} requested`);
  return getNginxStatus(`${action} requested`);
}

export function getNginxStatus(message?: string): ServiceStatus {
  const pidPath = path.join(getPaths().logs, "nginx.pid");
  return {
    name: "nginx",
    state: existsSync(pidPath) ? "running" : "unknown",
    port: 80,
    logPath: path.join(getPaths().logs, "nginx-error.log"),
    message
  };
}

function validatePort(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${label} must be a port between 1 and 65535.`);
  }
  return value;
}

function validateFastCgiHost(value: string): string {
  const host = value.trim();
  if (!host || /[\s;/"']/.test(host)) {
    throw new Error("FastCGI host must be a host name or IP address.");
  }
  return host;
}
