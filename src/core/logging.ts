import { appendFile, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureBaseDirs, getPaths } from "./paths.js";

const logSources = [
  { scope: "laraboxs", file: "laraboxs.log", alreadyScoped: true },
  { scope: "nginx", file: "nginx-error.log" },
  { scope: "mysql", file: "mysql-error.log" },
  { scope: "php", file: "php-fastcgi.log" },
  { scope: "redis", file: "redis.log" }
];

export async function appendLog(scope: string, message: string): Promise<void> {
  await ensureBaseDirs();
  const stamp = new Date().toISOString();
  const logPath = path.join(getPaths().logs, "laraboxs.log");
  await appendFile(logPath, `[${stamp}] [${scope}] ${message}\n`, "utf8");
}

export async function readRecentLogs(limit = 80): Promise<string[]> {
  await ensureBaseDirs();
  const logsRoot = getPaths().logs;
  const groups = await Promise.all(
    logSources.map(async (source) => {
      const lines = await readTail(path.join(logsRoot, source.file), limit);
      if (lines.length === 0) {
        return [];
      }

      return source.alreadyScoped ? lines : lines.map((line) => `[${source.scope}] ${line}`);
    })
  );

  return groups.flat();
}

export async function clearLogs(): Promise<string[]> {
  await ensureBaseDirs();
  const logsRoot = getPaths().logs;
  const entries = await readdir(logsRoot, { withFileTypes: true });
  const logFiles = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".log")).map((entry) => entry.name);

  await Promise.all(logFiles.map((file) => writeFile(path.join(logsRoot, file), "", "utf8")));
  return logFiles.sort();
}

async function readTail(filePath: string, limit: number): Promise<string[]> {
  try {
    const lines = (await readFile(filePath, "utf8"))
      .trimEnd()
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "");
    return lines.slice(Math.max(lines.length - limit, 0));
  } catch {
    return [];
  }
}
