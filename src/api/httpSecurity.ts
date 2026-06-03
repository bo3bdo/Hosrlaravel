import type http from "node:http";

const defaultApiPort = 47899;
const devUiPort = 5173;
export const maxJsonBodyBytes = 1024 * 1024;

export class ApiHttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "ApiHttpError";
  }
}

export function corsOrigin(origin: string | undefined, apiPort = defaultApiPort): string {
  if (origin && isTrustedOrigin(origin, apiPort)) {
    return origin;
  }
  return `http://127.0.0.1:${devUiPort}`;
}

export function assertTrustedApiRequest(request: http.IncomingMessage, apiPort = defaultApiPort): void {
  if (!isTrustedHost(request.headers.host, apiPort)) {
    throw new ApiHttpError(403, "Blocked request with an untrusted Host header.");
  }

  const origin = request.headers.origin;
  if (origin && !isTrustedOrigin(origin, apiPort)) {
    throw new ApiHttpError(403, "Blocked request from an untrusted Origin.");
  }

  const helperToken = process.env.LARABOXS_HELPER_TOKEN;
  if (helperToken && request.headers["x-laraboxs-token"] !== helperToken) {
    throw new ApiHttpError(403, "Blocked request with a missing or invalid helper token.");
  }
}

export function isTrustedOrigin(origin: string, apiPort = defaultApiPort): boolean {
  if (origin.startsWith("tauri://")) {
    return true;
  }
  if (origin === "null") {
    return false;
  }

  try {
    const parsed = new URL(origin);
    if (parsed.hostname === "tauri.localhost") {
      return true;
    }
    if (!isLoopbackHostname(parsed.hostname)) {
      return false;
    }
    const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
    return port === apiPort || port === devUiPort;
  } catch {
    return false;
  }
}

export function isTrustedHost(hostHeader: string | undefined, apiPort = defaultApiPort): boolean {
  if (!hostHeader) {
    return true;
  }

  try {
    const parsed = new URL(`http://${hostHeader}`);
    if (!isLoopbackHostname(parsed.hostname) && parsed.hostname !== "tauri.localhost") {
      return false;
    }
    const port = parsed.port ? Number(parsed.port) : apiPort;
    return port === apiPort || port === devUiPort;
  } catch {
    return false;
  }
}

export function apiSecurityHeaders(): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY"
  };
}

export function statusForError(error: unknown): number {
  if (error instanceof ApiHttpError) {
    return error.statusCode;
  }
  if (error instanceof SyntaxError) {
    return 400;
  }
  return 500;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}
