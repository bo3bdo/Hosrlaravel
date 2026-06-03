import type { RuntimeInstallJob } from "./types.js";

type JsonBody = Record<string, unknown>;

declare global {
  interface Window {
    __LARABOXS_HELPER_TOKEN__?: string;
  }
}

export function apiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const isLocalBrowser = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";

  if ((window.location.protocol === "http:" || window.location.protocol === "https:") && isLocalBrowser) {
    return normalizedPath;
  }

  return `http://127.0.0.1:47899${normalizedPath}`;
}

export async function getJson<T>(path: string): Promise<T> {
  return requestJson<T>(path, { method: "GET" });
}

export async function postJson<T>(path: string, body: JsonBody = {}): Promise<T> {
  return requestJson<T>(path, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(body)
  });
}

export async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), withHelperHeaders(init));
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const raw = await response.text();
  return raw ? (JSON.parse(raw) as T) : (undefined as T);
}

export async function openExternalUrl(url: string): Promise<void> {
  try {
    await postJson<{ ok: boolean }>("/api/open-url", { url });
    return;
  } catch {
    // Fall back for older helpers that do not expose /api/open-url yet.
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

export async function copyTextToClipboard(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const fallback = document.createElement("textarea");
    fallback.value = value;
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    document.body.appendChild(fallback);
    fallback.select();
    document.execCommand("copy");
    document.body.removeChild(fallback);
  }
}

export async function fetchRuntimeInstallJob(id: string): Promise<RuntimeInstallJob> {
  const payload = await getJson<{ job: RuntimeInstallJob }>(`/api/runtimes/jobs/${encodeURIComponent(id)}`);
  return payload.job;
}

export async function responseErrorMessage(response: Response): Promise<string> {
  const raw = await response.text();
  if (!raw) {
    return `${response.status} ${response.statusText}`;
  }

  try {
    const payload = JSON.parse(raw) as { error?: unknown };
    if (typeof payload.error === "string") {
      return payload.error;
    }
  } catch {
    // Keep the raw response below when it is not JSON.
  }

  return raw;
}

function withHelperHeaders(init: RequestInit): RequestInit {
  const token = window.__LARABOXS_HELPER_TOKEN__;
  if (!token) {
    return init;
  }

  return {
    ...init,
    headers: {
      ...headersToRecord(init.headers),
      "X-Laraboxs-Token": token
    }
  };
}

function jsonHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...helperTokenHeader()
  };
}

function helperTokenHeader(): Record<string, string> {
  const token = window.__LARABOXS_HELPER_TOKEN__;
  return token ? { "X-Laraboxs-Token": token } : {};
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return headers;
}
