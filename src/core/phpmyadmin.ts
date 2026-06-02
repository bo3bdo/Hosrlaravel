import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";
import { appendLog } from "./logging.js";
import { getPaths, toNginxPath } from "./paths.js";
import { phpFastCgiPort } from "./php.js";
import { downloadFile, downloadsDir, extractZip, mergeSingleExtractedFolder } from "./runtimeInstaller.js";
import { ensureSecret } from "./secretStore.js";
import type { PhpMyAdminStatus, Site } from "./types.js";

export const phpMyAdminVersion = "5.2.3";
export const phpMyAdminDomain = "phpmyadmin.test";
export const phpMyAdminDownloadUrl = `https://files.phpmyadmin.net/phpMyAdmin/${phpMyAdminVersion}/phpMyAdmin-${phpMyAdminVersion}-all-languages.zip`;

const blowfishSecretKey = "phpmyadmin-blowfish-secret";

export function phpMyAdminRoot(): string {
  return path.join(getPaths().home, "tools", "phpmyadmin", phpMyAdminVersion);
}

export function phpMyAdminConfigPath(): string {
  return path.join(phpMyAdminRoot(), "config.inc.php");
}

export function getPhpMyAdminStatus(): PhpMyAdminStatus {
  const root = phpMyAdminRoot();
  return {
    name: "phpMyAdmin",
    version: phpMyAdminVersion,
    installed: existsSync(path.join(root, "index.php")),
    root,
    url: `http://${phpMyAdminDomain}`,
    configPath: phpMyAdminConfigPath(),
    downloadUrl: phpMyAdminDownloadUrl
  };
}

export async function installPhpMyAdmin(): Promise<PhpMyAdminStatus> {
  const status = getPhpMyAdminStatus();
  if (!status.installed) {
    await mkdir(downloadsDir(), { recursive: true });
    const downloadPath = path.join(downloadsDir(), `phpmyadmin-${phpMyAdminVersion}.zip`);
    const extractRoot = path.join(downloadsDir(), `phpmyadmin-${phpMyAdminVersion}-extract`);
    await downloadFile(phpMyAdminDownloadUrl, downloadPath, "phpmyadmin");
    await extractZip(downloadPath, extractRoot, "phpmyadmin");
    await mergeSingleExtractedFolder(extractRoot, phpMyAdminRoot());
    await appendLog("phpmyadmin", `installed phpMyAdmin ${phpMyAdminVersion} at ${phpMyAdminRoot()}`);
  }

  await writePhpMyAdminConfig();
  return getPhpMyAdminStatus();
}

export async function writePhpMyAdminConfig(): Promise<void> {
  if (!getPhpMyAdminStatus().installed) {
    return;
  }

  const config = await loadConfig();
  const blowfishSecret = await ensureSecret(blowfishSecretKey, generateBlowfishSecret);
  const tempDir = path.join(phpMyAdminRoot(), "tmp");
  await mkdir(tempDir, { recursive: true });
  await writeFile(
    phpMyAdminConfigPath(),
    [
      "<?php",
      "declare(strict_types=1);",
      "",
      `$cfg['blowfish_secret'] = '${escapePhpString(blowfishSecret)}';`,
      "$i = 0;",
      "$i++;",
      "$cfg['Servers'][$i]['auth_type'] = 'cookie';",
      "$cfg['Servers'][$i]['host'] = '127.0.0.1';",
      `$cfg['Servers'][$i]['port'] = '${config.mysql.port}';`,
      "$cfg['Servers'][$i]['compress'] = false;",
      "$cfg['Servers'][$i]['AllowNoPassword'] = false;",
      `$cfg['TempDir'] = '${toNginxPath(tempDir)}';`,
      "$cfg['UploadDir'] = '';",
      "$cfg['SaveDir'] = '';",
      ""
    ].join("\n"),
    "utf8"
  );
  await appendLog("phpmyadmin", `configuration ready at ${phpMyAdminConfigPath()}`);
}

export async function phpMyAdminSiteIfInstalled(): Promise<Site | undefined> {
  const status = getPhpMyAdminStatus();
  if (!status.installed) {
    return undefined;
  }

  const config = await loadConfig();
  return {
    name: "phpmyadmin",
    domain: phpMyAdminDomain,
    url: status.url,
    path: status.root,
    documentRoot: status.root,
    entryPath: ".",
    secured: false,
    phpVersion: config.globalPhpVersion,
    framework: "PHP"
  };
}

export async function generatePhpMyAdminNginxConfig(): Promise<string | undefined> {
  const site = await phpMyAdminSiteIfInstalled();
  if (!site) {
    return undefined;
  }

  const config = await loadConfig();
  const root = toNginxPath(site.documentRoot);
  const fastCgiPort = phpFastCgiPort(site.phpVersion);
  return [
    "server {",
    `    listen 127.0.0.1:${config.nginx.httpPort};`,
    `    server_name ${site.domain};`,
    `    root "${root}";`,
    "    index index.php;",
    "",
    "    location / {",
    "        try_files $uri $uri/ /index.php?$query_string;",
    "    }",
    "",
    "    location ~ \\.php$ {",
    "        include fastcgi_params;",
    `        fastcgi_pass ${config.nginx.fastCgiHost}:${fastCgiPort};`,
    "        fastcgi_index index.php;",
    "        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;",
    "    }",
    "}"
  ].join("\n");
}

function generateBlowfishSecret(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function escapePhpString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
