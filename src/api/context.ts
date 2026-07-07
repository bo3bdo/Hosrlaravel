import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NewSiteRequest, RuntimeKind, ServiceAction, SiteCommandKind, SiteEnvProfileKind, SiteWorkerKind } from "../core/types.js";
import { ApiHttpError, maxJsonBodyBytes, statusForError } from "./httpSecurity.js";

export const host = "127.0.0.1";
export const port = Number(process.env.LARABOXS_API_PORT ?? 47899);
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const builtUiRoot = path.join(projectRoot, "dist-ui");
export const dashboardCsp =
  "default-src 'self'; connect-src 'self' http://127.0.0.1:47899 http://localhost:47899; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

export type ApiContext = {
  request: http.IncomingMessage;
  response: http.ServerResponse;
  url: URL;
};

export async function sendJson(response: http.ServerResponse, value: unknown): Promise<void> {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value, null, 2));
}

export function sendError(response: http.ServerResponse, error: unknown): void {
  const statusCode = statusForError(error);
  const message = error instanceof Error ? error.message : String(error);
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: message }, null, 2));
}

export function readJson(request: http.IncomingMessage): Promise<Record<string, unknown>> {
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

export function assertString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiHttpError(400, `${name} is required.`);
  }
  return value;
}

export function assertHttpUrl(value: unknown): string {
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

export function openExternalUrl(url: string): void {
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

export async function openLocalPath(target: string, reveal: boolean): Promise<string> {
  const { stat } = await import("node:fs/promises");
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

export function assertGeneralSettings(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiHttpError(400, "Settings are required.");
  }

  const input = value as Record<string, unknown>;
  return {
    tld: typeof input.tld === "string" ? assertLocalTld(input.tld) : undefined,
    setupComplete: typeof input.setupComplete === "boolean" ? input.setupComplete : undefined
  };
}

export function assertStartupSettings(value: unknown) {
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

export function assertPhpSettings(value: unknown) {
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

export function assertNginxSettings(value: unknown) {
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

export function assertNewSiteRequest(value: unknown): NewSiteRequest {
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
  const portValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(portValue)) {
    throw new ApiHttpError(400, `${name} is required.`);
  }
  return portValue;
}

export function optionalStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

export function serviceAction(value: string | undefined): ServiceAction {
  if (value === "start" || value === "stop" || value === "restart") {
    return value;
  }
  throw new ApiHttpError(400, `Unsupported service action: ${value ?? ""}`);
}

export function assertRuntimeKind(value: unknown): RuntimeKind {
  if (value === "php" || value === "mysql" || value === "nginx" || value === "redis" || value === "node" || value === "composer") {
    return value;
  }
  throw new ApiHttpError(400, `Unsupported runtime: ${String(value)}`);
}

export function assertSiteCommandKind(value: unknown): SiteCommandKind {
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

export function assertSiteEnvProfileKind(value: unknown): SiteEnvProfileKind {
  if (value === "app" || value === "database" || value === "redis" || value === "queue-redis" || value === "full") {
    return value;
  }
  throw new ApiHttpError(400, `Unsupported .env profile: ${String(value)}`);
}

export function assertSiteWorkerKind(value: unknown): SiteWorkerKind {
  if (value === "queue" || value === "schedule") {
    return value;
  }
  throw new ApiHttpError(400, `Unsupported worker: ${String(value)}`);
}
