import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { builtUiRoot, dashboardCsp } from "../context.js";
import type { RouteDefinition } from "../router.js";

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function safeUiPath(urlPath: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }

  const normalized = path.normalize(decoded.replace(/^\/+/, "") || "index.html");
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    return undefined;
  }
  return normalized;
}

async function builtUiFilePath(urlPath: string): Promise<string | undefined> {
  const requestedPath = safeUiPath(urlPath);
  if (!requestedPath) {
    return undefined;
  }

  const directPath = path.join(builtUiRoot, requestedPath);
  if (await isFile(directPath)) {
    return directPath;
  }

  const indexPath = path.join(builtUiRoot, "index.html");
  return (await isFile(indexPath)) ? indexPath : undefined;
}

function contentTypeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}

export async function serveBuiltUi(ctx: { request: import("node:http").IncomingMessage; response: import("node:http").ServerResponse; url: URL }): Promise<boolean> {
  const { request, response, url } = ctx;

  if (url.pathname.startsWith("/api/")) {
    return false;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }

  const filePath = await builtUiFilePath(url.pathname);
  if (!filePath) {
    return false;
  }

  const body = request.method === "HEAD" ? undefined : await readFile(filePath);
  response.writeHead(200, {
    "Content-Type": contentTypeFor(filePath),
    "Cache-Control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
    "Content-Security-Policy": dashboardCsp
  });
  response.end(body);
  return true;
}

export const staticRoutes: RouteDefinition[] = [];
