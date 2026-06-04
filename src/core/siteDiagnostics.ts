import http from "node:http";
import https from "node:https";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";
import { getPaths, hostsFilePath } from "./paths.js";
import { getPhpSettings } from "./php.js";
import { canConnect } from "./ports.js";
import { getLocalCaStatus } from "./ssl.js";
import { findSite } from "./sites.js";
import type { Site, SiteDiagnosticItem, SiteDiagnosticReport, SiteHealthStatus } from "./types.js";

const laravelRequiredExtensions = ["curl", "fileinfo", "mbstring", "openssl", "pdo_mysql", "tokenizer", "xml"];

export async function getSiteHealth(identifier: string): Promise<SiteHealthStatus> {
  const site = await findSite(identifier);
  return probeSiteHealth(site);
}

export async function getSiteDiagnosticReport(identifier: string): Promise<SiteDiagnosticReport> {
  const site = await findSite(identifier);
  const [config, health, hostMapped, documentRootStatus, appUrl, phpSettings, ssl] = await Promise.all([
    loadConfig(),
    probeSiteHealth(site),
    hostsContainsDomain(site.domain),
    stat(site.documentRoot).catch(() => undefined),
    readLaravelAppUrl(site),
    getPhpSettings(site.phpVersion).catch(() => undefined),
    getLocalCaStatus()
  ]);

  const webPort = site.secured ? config.nginx.httpsPort : config.nginx.httpPort;
  const webPortReachable = await canConnect("127.0.0.1", webPort, 200);
  const phpRuntimeInstalled = existsSync(path.join(getPaths().phpRoot, site.phpVersion, "php.exe"));

  const checks: SiteDiagnosticItem[] = [
    {
      id: "document-root",
      label: "Document Root",
      detail: documentRootStatus?.isDirectory() ? site.documentRoot : `Missing folder: ${site.documentRoot}`,
      tone: documentRootStatus?.isDirectory() ? "pass" : "fail",
      fix: "Update the Nginx Entry field to an existing folder."
    },
    {
      id: "hosts",
      label: "Hosts",
      detail: hostMapped ? `${site.domain} maps to 127.0.0.1` : `${site.domain} is not in the hosts file`,
      tone: hostMapped ? "pass" : "warn",
      fix: "Sync Hosts from the Sites or Settings page."
    },
    {
      id: "nginx-port",
      label: "Nginx Port",
      detail: webPortReachable ? `${webPort} is reachable` : `${webPort} is not accepting connections`,
      tone: webPortReachable ? "pass" : "fail",
      fix: "Start or restart Nginx."
    },
    {
      id: "ssl",
      label: "SSL",
      detail: site.secured ? (ssl.trusted ? "Local CA is trusted" : "Local CA is not trusted") : "HTTP site",
      tone: site.secured && !ssl.trusted ? "warn" : "pass",
      fix: "Trust the local CA."
    },
    {
      id: "app-url",
      label: "APP_URL",
      detail: appUrl ? `${appUrl}` : site.framework === "Laravel" ? ".env APP_URL not found" : "Not a Laravel .env check",
      tone: site.framework !== "Laravel" || appUrl === site.url ? "pass" : appUrl ? "warn" : "warn",
      fix: `Set APP_URL=${site.url} in .env.`
    },
    {
      id: "php-runtime",
      label: "PHP Runtime",
      detail: phpRuntimeInstalled ? `PHP ${site.phpVersion} is installed` : `PHP ${site.phpVersion} is not installed`,
      tone: phpRuntimeInstalled ? "pass" : "fail",
      fix: `Install PHP ${site.phpVersion}.`
    }
  ];

  if (site.framework === "Laravel" && phpSettings) {
    const enabled = new Set(phpSettings.settings.enabledExtensions);
    const available = new Set(phpSettings.extensions.filter((extension) => extension.available).map((extension) => extension.name));
    const missing = laravelRequiredExtensions.filter((extension) => !enabled.has(extension) && !available.has(extension));
    checks.push({
      id: "php-extensions",
      label: "PHP Extensions",
      detail: missing.length ? `Missing or disabled: ${missing.join(", ")}` : "Common Laravel extensions are enabled or built in",
      tone: missing.length ? "warn" : "pass",
      fix: "Enable or install the missing PHP extensions."
    });
  }

  checks.push({
    id: "http",
    label: "HTTP Response",
    detail: health.message,
    tone: health.state === "ok" ? "pass" : "fail",
    fix: "Open logs and check Nginx/PHP errors."
  });

  const summary = checks.reduce(
    (current, check) => {
      current[check.tone] += 1;
      return current;
    },
    { pass: 0, warn: 0, fail: 0 }
  );

  return {
    site,
    health,
    checkedAt: new Date().toISOString(),
    summary,
    checks
  };
}

async function probeSiteHealth(site: Site): Promise<SiteHealthStatus> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();

  return new Promise((resolve) => {
    const url = new URL(site.url);
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      url,
      {
        method: "HEAD",
        rejectUnauthorized: false,
        timeout: 3500
      },
      (response) => {
        response.resume();
        const statusCode = response.statusCode ?? 0;
        const state = statusCode >= 200 && statusCode < 400 ? "ok" : "error";
        resolve({
          domain: site.domain,
          url: site.url,
          state,
          statusCode,
          statusMessage: response.statusMessage,
          message: `HTTP ${statusCode}${response.statusMessage ? ` ${response.statusMessage}` : ""}`,
          responseTimeMs: Date.now() - startedAt,
          checkedAt
        });
      }
    );

    request.once("timeout", () => {
      request.destroy(new Error("Site check timed out."));
    });
    request.once("error", (error) => {
      resolve({
        domain: site.domain,
        url: site.url,
        state: "error",
        message: error.message,
        responseTimeMs: Date.now() - startedAt,
        checkedAt
      });
    });
    request.end();
  });
}

async function hostsContainsDomain(domain: string): Promise<boolean> {
  try {
    const hosts = await readFile(hostsFilePath(), "utf8");
    const expression = new RegExp(`^\\s*127\\.0\\.0\\.1\\s+.*\\b${escapeRegExp(domain)}\\b`, "im");
    return expression.test(hosts);
  } catch {
    return false;
  }
}

async function readLaravelAppUrl(site: Site): Promise<string | undefined> {
  if (site.framework !== "Laravel") {
    return undefined;
  }

  try {
    const env = await readFile(path.join(site.path, ".env"), "utf8");
    const match = env.match(/^APP_URL=(.*)$/m);
    return match?.[1]?.trim().replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
