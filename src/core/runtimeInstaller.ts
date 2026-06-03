import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import extract from "extract-zip";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { appendLog } from "./logging.js";
import { getPaths } from "./paths.js";
import type { RuntimeInstallStatus } from "./types.js";

export interface DownloadProgress {
  bytesDownloaded: number;
  totalBytes?: number;
  percent?: number;
  etaSeconds?: number;
}

export interface DownloadOptions {
  onProgress?: (progress: DownloadProgress) => void;
  retries?: number;
  retryDelayMs?: number;
  checksumSha256?: string;
  timeoutMs?: number;
}

export async function downloadFile(url: string, destination: string, scope: string, options: DownloadOptions = {}): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  const maxAttempts = Math.max(1, 1 + Math.max(0, options.retries ?? 2));
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await downloadFileAttempt(url, destination, scope, attempt, maxAttempts, options);
      return;
    } catch (error) {
      lastError = error;
      await cleanupPartialDownload(destination);
      if (attempt < maxAttempts) {
        await appendLog(scope, `download retry ${attempt}/${maxAttempts - 1}: ${error instanceof Error ? error.message : String(error)}`);
        await delay((options.retryDelayMs ?? 500) * attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function downloadFileAttempt(
  url: string,
  destination: string,
  scope: string,
  attempt: number,
  maxAttempts: number,
  options: DownloadOptions
): Promise<void> {
  await appendLog(scope, `download started: ${url}${maxAttempts > 1 ? ` (attempt ${attempt}/${maxAttempts})` : ""}`);
  const tempDestination = partialDownloadPath(destination);
  await rm(tempDestination, { force: true });

  const response = await fetchWithRedirects(url, 5, options.timeoutMs);
  const statusCode = response.statusCode ?? 0;
  if (statusCode < 200 || statusCode >= 300) {
    response.resume();
    throw new Error(`Download failed with HTTP ${statusCode}: ${url}`);
  }

  const totalBytes = parseContentLength(response.headers["content-length"]);
  const startedAt = Date.now();
  let bytesDownloaded = 0;

  options.onProgress?.({ bytesDownloaded, totalBytes, percent: totalBytes ? 0 : undefined });

  const progress = new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      bytesDownloaded += Buffer.byteLength(chunk);
      const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
      const bytesPerSecond = bytesDownloaded / elapsedSeconds;
      const remainingBytes = totalBytes ? Math.max(totalBytes - bytesDownloaded, 0) : undefined;
      const etaSeconds = remainingBytes !== undefined && bytesPerSecond > 0 ? remainingBytes / bytesPerSecond : undefined;

      options.onProgress?.({
        bytesDownloaded,
        totalBytes,
        percent: totalBytes ? (bytesDownloaded / totalBytes) * 100 : undefined,
        etaSeconds
      });

      callback(null, chunk);
    }
  });

  await pipeline(response, progress, createWriteStream(tempDestination));
  if (options.checksumSha256) {
    await verifyFileSha256(tempDestination, options.checksumSha256);
  }
  await rm(destination, { force: true });
  await rename(tempDestination, destination);
  options.onProgress?.({ bytesDownloaded, totalBytes, percent: totalBytes ? 100 : undefined, etaSeconds: 0 });
  await appendLog(scope, `download complete: ${destination}`);
}

export async function verifyFileSha256(filePath: string, expectedSha256: string): Promise<void> {
  const actualSha256 = await sha256File(filePath);
  if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(`Checksum mismatch for ${filePath}. Expected ${expectedSha256}, got ${actualSha256}.`);
  }
}

export function partialDownloadPath(destination: string): string {
  return `${destination}.part`;
}

export async function extractZip(zipPath: string, destination: string, scope: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  await appendLog(scope, `extract started: ${zipPath}`);
  await extract(zipPath, { dir: path.resolve(destination) });
  await appendLog(scope, `extract complete: ${destination}`);
}

export async function flattenSingleExtractedFolder(extractRoot: string, finalRoot: string): Promise<void> {
  const entries = await readdir(extractRoot, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  if (directories.length !== 1) {
    return;
  }

  const singleRoot = path.join(extractRoot, directories[0].name);
  await rm(finalRoot, { recursive: true, force: true });
  await rename(singleRoot, finalRoot);
  await rm(extractRoot, { recursive: true, force: true });
}

export async function mergeSingleExtractedFolder(extractRoot: string, finalRoot: string): Promise<void> {
  const entries = await readdir(extractRoot, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  const sourceRoot = directories.length === 1 ? path.join(extractRoot, directories[0].name) : extractRoot;
  await mkdir(finalRoot, { recursive: true });
  await cp(sourceRoot, finalRoot, { recursive: true, force: true });
  await rm(extractRoot, { recursive: true, force: true });
}

export function runtimeStatus(name: string, version: string, root: string, binary: string, downloadUrl?: string): RuntimeInstallStatus {
  return {
    name,
    version,
    root,
    binary,
    installed: existsSync(binary),
    downloadUrl
  };
}

export function downloadsDir(): string {
  return path.join(getPaths().home, "downloads");
}

function fetchWithRedirects(url: string, redirects = 5, timeoutMs = 120000): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const request = client.get(url, (response) => {
      const location = response.headers.location;
      if (location && response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
        response.resume();
        if (redirects <= 0) {
          reject(new Error(`Too many redirects while downloading ${url}`));
          return;
        }
        const nextUrl = new URL(location, url).toString();
        fetchWithRedirects(nextUrl, redirects - 1, timeoutMs).then(resolve, reject);
        return;
      }

      resolve(response);
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Download timed out after ${Math.round(timeoutMs / 1000)}s: ${url}`));
    });
    request.once("error", reject);
  });
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

async function cleanupPartialDownload(destination: string): Promise<void> {
  await rm(partialDownloadPath(destination), { force: true });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseContentLength(value: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
