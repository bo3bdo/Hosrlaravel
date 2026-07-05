import http from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { appendLog } from "../core/logging.js";
import { getPaths, hostsFilePath, laraboxsHome } from "../core/paths.js";

const host = "127.0.0.1";
const port = Number(process.env.LARABOXS_ADMIN_PORT ?? 47890);
const maxJsonBodyBytes = 1024 * 1024;

function adminTokenFile(): string {
  return path.join(laraboxsHome(), "admin-helper.token");
}

async function resolveAdminToken(): Promise<string> {
  const fromEnv = process.env.LARABOXS_ADMIN_TOKEN;
  if (fromEnv && fromEnv !== "undefined") {
    return fromEnv;
  }

  const tokenPath = adminTokenFile();
  try {
    if (existsSync(tokenPath)) {
      return (await readFile(tokenPath, "utf8")).trim();
    }
  } catch {
    // fall through to generation
  }

  const generated = randomBytes(32).toString("hex");
  await mkdir(laraboxsHome(), { recursive: true });
  await writeFile(tokenPath, generated, "utf8");
  return generated;
}

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function trustedHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return true;
  try {
    const parsed = new URL(`http://${hostHeader}`);
    if (!isLoopback(parsed.hostname)) return false;
    const portValue = parsed.port ? Number(parsed.port) : port;
    return portValue === port;
  } catch {
    return false;
  }
}

class ApiAdminError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = "ApiAdminError";
  }
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const total = chunks.reduce((sum, buffer) => sum + buffer.length, 0);
    if (total > maxJsonBodyBytes) {
      throw new ApiAdminError(413, "Request body too large.");
    }
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiAdminError(400, "Invalid JSON body.");
  }
}

function sendJson(response: http.ServerResponse, value: unknown): void {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

function sendError(response: http.ServerResponse, error: unknown): void {
  const statusCode = error instanceof ApiAdminError ? error.statusCode : 500;
  const message = error instanceof Error ? error.message : String(error);
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: message }));
}

function runPowerShell(script: string, timeoutMs = 15_000): Promise<{ code: number; stderr: string }> {
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    stdio: ["ignore", "ignore", "pipe"],
    shell: false,
    windowsHide: true
  });

  return new Promise((resolve) => {
    let settled = false;
    let stderr = "";
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        resolve({ code: 1, stderr: stderr || "PowerShell timed out." });
      }
    }, timeoutMs);

    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ code: 1, stderr: "Failed to start PowerShell." });
      }
    });
    child.once("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ code: code ?? 1, stderr });
      }
    });
  });
}

function escapePs(value: string): string {
  return value.replace(/'/g, "''");
}

async function adminSyncHosts(content: string): Promise<void> {
  const hostsFile = hostsFilePath();
  await writeFile(hostsFile, content, "utf8");
  await appendLog("admin-helper", `synced hosts file via admin helper (${content.length} bytes)`);
}

async function adminTrustCa(certPath: string): Promise<void> {
  const resolved = path.resolve(certPath);
  const script = [
    '$ErrorActionPreference = "Stop"',
    `$certPath = '${escapePs(resolved)}'`,
    "if (-not (Test-Path -LiteralPath $certPath)) { exit 3 }",
    "$cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2($certPath)",
    "$store = New-Object Security.Cryptography.X509Certificates.X509Store('Root', [Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine)",
    "try {",
    "  $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)",
    "  $alreadyTrusted = $false",
    "  foreach ($item in $store.Certificates) { if ($item.Thumbprint -eq $cert.Thumbprint) { $alreadyTrusted = $true; break } }",
    "  if (-not $alreadyTrusted) { $store.Add($cert) }",
    "} finally { $store.Close() }",
    "exit 0"
  ].join("\n");

  const result = await runPowerShell(script, 20_000);
  if (result.code !== 0) {
    throw new Error(`CA trust failed with exit code ${result.code}. ${result.stderr}`.trim());
  }
  await appendLog("admin-helper", `trusted local CA via admin helper: ${resolved}`);
}

async function adminDefenderExclude(targetPath: string): Promise<void> {
  const resolved = path.resolve(targetPath);
  const script = [
    '$ErrorActionPreference = "Stop"',
    "if (-not (Get-Command Get-MpPreference -ErrorAction SilentlyContinue)) { exit 2 }",
    `$target = [System.IO.Path]::GetFullPath('${escapePs(resolved)}')`,
    "$existing = @((Get-MpPreference).ExclusionPath) | Where-Object { $_ }",
    "foreach ($item in $existing) {",
    "  $normTarget = [System.IO.Path]::GetFullPath($target)",
    "  $normItem = [System.IO.Path]::GetFullPath([string]$item)",
    "  if ([string]::Equals($normTarget, $normItem, [StringComparison]::OrdinalIgnoreCase)) { exit 10 }",
    "  $prefix = $normItem",
    "  if (-not $prefix.EndsWith('\\') -and -not $prefix.EndsWith('/')) { $prefix = $prefix + '\\' }",
    "  if ($normTarget.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { exit 10 }",
    "}",
    "Add-MpPreference -ExclusionPath $target -ErrorAction Stop",
    "exit 0"
  ].join("\n");

  const result = await runPowerShell(script, 15_000);
  if (result.code === 2) {
    await appendLog("admin-helper", "Windows Defender cmdlets unavailable; defender exclusion skipped");
    return;
  }
  if (result.code === 10) {
    await appendLog("admin-helper", `defender exclusion already covers ${resolved}`);
    return;
  }
  if (result.code !== 0) {
    throw new Error(`Defender exclusion failed with exit code ${result.code}. ${result.stderr}`.trim());
  }
  await appendLog("admin-helper", `added defender exclusion via admin helper: ${resolved}`);
}

async function main(): Promise<void> {
  const token = await resolveAdminToken();
  const paths = getPaths();
  await mkdir(paths.logs, { recursive: true });
  await appendLog("admin-helper", `admin helper starting on http://${host}:${port}`);

  const server = http.createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");

    try {
      const url = new URL(request.url ?? "/", `http://${host}:${port}`);

      if (!url.pathname.startsWith("/admin/")) {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Not found" }));
        return;
      }

      if (!trustedHost(request.headers.host)) {
        response.writeHead(403, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Blocked untrusted host." }));
        return;
      }

      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }

      const providedToken = request.headers["x-laraboxs-admin-token"];
      if (providedToken !== token) {
        response.writeHead(403, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Blocked request with a missing or invalid admin token." }));
        return;
      }

      if (request.method === "GET" && url.pathname === "/admin/health") {
        sendJson(response, { ok: true, name: "laraboxs-admin-helper", pid: process.pid, platform: process.platform });
        return;
      }

      if (request.method === "POST" && url.pathname === "/admin/hosts") {
        const body = (await readJsonBody(request)) as { content?: string };
        if (typeof body.content !== "string") {
          throw new ApiAdminError(400, "Missing 'content' field.");
        }
        await adminSyncHosts(body.content);
        sendJson(response, { ok: true });
        return;
      }

      if (request.method === "POST" && url.pathname === "/admin/ca-trust") {
        const body = (await readJsonBody(request)) as { certPath?: string };
        if (typeof body.certPath !== "string") {
          throw new ApiAdminError(400, "Missing 'certPath' field.");
        }
        await adminTrustCa(body.certPath);
        sendJson(response, { ok: true });
        return;
      }

      if (request.method === "POST" && url.pathname === "/admin/defender") {
        const body = (await readJsonBody(request)) as { path?: string };
        if (typeof body.path !== "string") {
          throw new ApiAdminError(400, "Missing 'path' field.");
        }
        await adminDefenderExclude(body.path);
        sendJson(response, { ok: true });
        return;
      }

      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Not found" }));
    } catch (error) {
      sendError(response, error);
    }
  });

  server.listen(port, host, () => {
    console.log(`laraboxs admin helper listening on http://${host}:${port}`);
  });

  const shutdown = (signal: string) => {
    void appendLog("admin-helper", `admin helper received ${signal}`);
    server.closeAllConnections?.();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 4000);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

void main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  await appendLog("admin-helper", `admin helper failed to start: ${message}`).catch(() => undefined);
  console.error(`admin helper failed: ${message}`);
  process.exit(1);
});

export {};
