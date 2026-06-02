import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { ensureBaseDirs, getPaths } from "./paths.js";

export async function appendLog(scope: string, message: string): Promise<void> {
  await ensureBaseDirs();
  const stamp = new Date().toISOString();
  const logPath = path.join(getPaths().logs, "laraboxs.log");
  await appendFile(logPath, `[${stamp}] [${scope}] ${message}\n`, "utf8");
}

export async function readRecentLogs(limit = 80): Promise<string[]> {
  await ensureBaseDirs();
  const logPath = path.join(getPaths().logs, "laraboxs.log");

  try {
    const lines = (await readFile(logPath, "utf8")).trimEnd().split(/\r?\n/);
    return lines.slice(Math.max(lines.length - limit, 0));
  } catch {
    return [];
  }
}
