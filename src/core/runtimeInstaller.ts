import { createWriteStream, existsSync } from "node:fs";
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
}

export async function downloadFile(url: string, destination: string, scope: string, options: DownloadOptions = {}): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  await appendLog(scope, `download started: ${url}`);

  const response = await fetchWithRedirects(url);
  const statusCode = response.statusCode ?? 0;
  if (statusCode < 200 || statusCode >= 300) {
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

  await pipeline(response, progress, createWriteStream(destination));
  options.onProgress?.({ bytesDownloaded, totalBytes, percent: totalBytes ? 100 : undefined, etaSeconds: 0 });
  await appendLog(scope, `download complete: ${destination}`);
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

function fetchWithRedirects(url: string, redirects = 5): Promise<http.IncomingMessage> {
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
        fetchWithRedirects(nextUrl, redirects - 1).then(resolve, reject);
        return;
      }

      resolve(response);
    });
    request.once("error", reject);
  });
}

function parseContentLength(value: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
