import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadConfig } from "./config.js";
import { appendLog } from "./logging.js";
import { getPaths, toNginxPath } from "./paths.js";
import { phpFastCgiPort } from "./php.js";
import { discoverSites } from "./sites.js";
import type { CommandSpec, ServiceAction, ServiceStatus, Site } from "./types.js";

export function generateNginxMainConfig(): string {
  const paths = getPaths();
  return [
    "worker_processes  1;",
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
  await mkdir(paths.nginxSites, { recursive: true });

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

  await appendLog("nginx", `wrote ${sites.length} site config(s)`);
}

export function nginxBinaryPath(): string {
  const bundled = path.join(getPaths().nginxRoot, "nginx.exe");
  return existsSync(bundled) ? bundled : "nginx";
}

export function buildNginxCommand(action: ServiceAction): CommandSpec {
  const paths = getPaths();
  const baseArgs = ["-p", paths.nginxRoot, "-c", paths.nginxConfig];

  if (action === "stop") {
    return { command: nginxBinaryPath(), args: ["-p", paths.nginxRoot, "-s", "stop"] };
  }

  if (action === "restart") {
    return { command: nginxBinaryPath(), args: ["-p", paths.nginxRoot, "-s", "reload"] };
  }

  return { command: nginxBinaryPath(), args: baseArgs };
}

export async function runNginx(action: ServiceAction): Promise<ServiceStatus> {
  await writeNginxConfigs();
  const command = buildNginxCommand(action);

  if (command.command === "nginx" && process.platform === "win32" && !existsSync(path.join(getPaths().nginxRoot, "nginx.exe"))) {
    const message = `Nginx binary not found. Place nginx.exe at ${path.join(getPaths().nginxRoot, "nginx.exe")} or add nginx to PATH.`;
    await appendLog("nginx", message);
    return { name: "nginx", state: "unknown", logPath: path.join(getPaths().logs, "nginx-error.log"), message };
  }

  const child = spawn(command.command, command.args, {
    cwd: getPaths().nginxRoot,
    detached: true,
    stdio: "ignore",
    shell: false
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
