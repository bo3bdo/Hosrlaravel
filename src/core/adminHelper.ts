import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { appendLog } from "./logging.js";
import { laraboxsHome } from "./paths.js";

const adminHost = "127.0.0.1";
const adminPort = Number(process.env.LARABOXS_ADMIN_PORT ?? 47890);
const healthTimeoutMs = 600;

function adminTokenFile(): string {
  return path.join(laraboxsHome(), "admin-helper.token");
}

async function readAdminToken(): Promise<string | undefined> {
  const fromEnv = process.env.LARABOXS_ADMIN_TOKEN;
  if (fromEnv && fromEnv !== "undefined") {
    return fromEnv;
  }
  const tokenPath = adminTokenFile();
  if (!existsSync(tokenPath)) {
    return undefined;
  }
  try {
    return (await readFile(tokenPath, "utf8")).trim();
  } catch {
    return undefined;
  }
}

async function adminHelperAvailable(): Promise<boolean> {
  if (process.env.LARABOXS_SKIP_ADMIN_HELPER === "1") {
    return false;
  }
  const token = await readAdminToken();
  if (!token) {
    return false;
  }

  return new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      resolve(false);
    }, healthTimeoutMs);

    fetch(`http://${adminHost}:${adminPort}/admin/health`, {
      method: "GET",
      headers: { "x-laraboxs-admin-token": token },
      signal: controller.signal
    })
      .then((response) => resolve(response.ok))
      .catch(() => resolve(false))
      .finally(() => clearTimeout(timer));
  });
}

async function postAdmin(endpoint: string, body: Record<string, unknown>): Promise<boolean> {
  const token = await readAdminToken();
  if (!token) {
    return false;
  }

  try {
    const response = await fetch(`http://${adminHost}:${adminPort}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-laraboxs-admin-token": token
      },
      body: JSON.stringify(body)
    });
    return response.ok;
  } catch {
    return false;
  }
}

export interface AdminHelperResult {
  handled: boolean;
}

export async function adminHelperSyncHosts(content: string): Promise<AdminHelperResult> {
  if (!(await adminHelperAvailable())) {
    return { handled: false };
  }
  const handled = await postAdmin("/admin/hosts", { content });
  if (handled) {
    await appendLog("admin-helper", "hosts synced via admin helper (silent)");
  }
  return { handled };
}

export async function adminHelperTrustCa(certPath: string): Promise<AdminHelperResult> {
  if (!(await adminHelperAvailable())) {
    return { handled: false };
  }
  const handled = await postAdmin("/admin/ca-trust", { certPath });
  if (handled) {
    await appendLog("admin-helper", "local CA trusted via admin helper (silent)");
  }
  return { handled };
}

export async function adminHelperDefenderExclude(targetPath: string): Promise<AdminHelperResult> {
  if (!(await adminHelperAvailable())) {
    return { handled: false };
  }
  const handled = await postAdmin("/admin/defender", { path: targetPath });
  if (handled) {
    await appendLog("admin-helper", `defender exclusion added via admin helper (silent): ${targetPath}`);
  }
  return { handled };
}

export async function isAdminHelperAvailable(): Promise<boolean> {
  return adminHelperAvailable();
}
