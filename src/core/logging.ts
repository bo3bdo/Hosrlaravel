import { appendFile, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureBaseDirs, getPaths } from "./paths.js";
import type { LogInsight, LogInsightSummary, LogSeverity } from "./types.js";

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

export function summarizeLogs(lines: string[], limit = 12): LogInsightSummary {
  const groups = new Map<string, LogInsight>();

  for (const line of lines) {
    const severity = logSeverity(line);
    if (severity === "info") {
      continue;
    }

    const service = logService(line);
    const message = displayLogMessage(line);
    const key = `${service}:${severity}:${normalizeLogMessage(message)}`;
    const seenAt = logTimestamp(line);
    const current = groups.get(key);

    if (current) {
      current.count += 1;
      current.sample = line;
      current.lastSeen = seenAt ?? current.lastSeen;
      if (!current.firstSeen && seenAt) {
        current.firstSeen = seenAt;
      }
      continue;
    }

    groups.set(key, {
      id: stableLogId(key),
      service,
      severity,
      message,
      sample: line,
      count: 1,
      firstSeen: seenAt,
      lastSeen: seenAt,
      action: suggestedLogAction(service, message)
    });
  }

  const grouped = Array.from(groups.values()).sort((a, b) => {
    const severityDelta = severityRank(b.severity) - severityRank(a.severity);
    if (severityDelta !== 0) return severityDelta;
    return b.count - a.count;
  });

  return {
    totalLines: lines.length,
    warningLines: lines.filter((line) => logSeverity(line) === "warning").length,
    errorLines: lines.filter((line) => logSeverity(line) === "error").length,
    actionableCount: grouped.filter((group) => Boolean(group.action)).length,
    groups: grouped.slice(0, limit),
    generatedAt: new Date().toISOString()
  };
}

export function logSeverity(line: string): LogSeverity {
  if (/\b(aborted connection|unauthenticated|untrusted|fallback|reduced)\b/i.test(line)) {
    return "warning";
  }
  if (/\b(error|failed|denied|refusing|timed out|fatal|exception|checksum mismatch|could not)\b/i.test(line)) {
    return "error";
  }
  if (/\b(warn|warning|conflict|busy|missing|not found)\b/i.test(line)) {
    return "warning";
  }
  return "info";
}

export function logService(line: string): string {
  const timestamped = line.match(/^\[[^\]]+\]\s+\[([^\]]+)\]/);
  const simple = line.match(/^\[([^\]]+)\]/);
  return (timestamped?.[1] ?? simple?.[1] ?? "app").toLowerCase();
}

export async function clearLogs(): Promise<string[]> {
  await ensureBaseDirs();
  const logsRoot = getPaths().logs;
  const entries = await readdir(logsRoot, { withFileTypes: true });
  const logFiles = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".log")).map((entry) => entry.name);

  await Promise.all(logFiles.map((file) => writeFile(path.join(logsRoot, file), "", "utf8")));
  return logFiles.sort();
}

function displayLogMessage(line: string): string {
  return line.replace(/^\[[^\]]+\]\s+\[[^\]]+\]\s*/, "").replace(/^\[[^\]]+\]\s*/, "").trim();
}

function normalizeLogMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/\b\d{4}-\d{2}-\d{2}[^\s\]]+/g, "<time>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/[a-z]:[\\/][^\s'"]+/gi, "<path>")
    .replace(/\s+/g, " ")
    .trim();
}

function logTimestamp(line: string): string | undefined {
  const match = line.match(/^\[([^\]]+)\]/);
  if (!match) {
    return undefined;
  }
  const date = new Date(match[1]);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function stableLogId(key: string): string {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return `log-${hash.toString(16)}`;
}

function severityRank(severity: LogSeverity): number {
  switch (severity) {
    case "error":
      return 3;
    case "warning":
      return 2;
    case "info":
      return 1;
  }
}

function suggestedLogAction(service: string, message: string): string | undefined {
  if (/\bport\b.*\b(conflict|busy|in use)\b/i.test(message)) {
    return "Check the Ports tool and switch the affected service to an available port.";
  }
  if (/\b(untrusted|certificate|ca)\b/i.test(message)) {
    return "Trust the local CA from Settings > Security, then restart Nginx.";
  }
  if (/\bpermission|denied|access is denied\b/i.test(message)) {
    return "Run the action with administrator approval or use the helper service.";
  }
  if (/\bchecksum mismatch|download failed|timed out\b/i.test(message)) {
    return "Retry the runtime update; if it repeats, check network access and the runtime source.";
  }
  if (service === "mysql" && /\baborted connection|unauthenticated\b/i.test(message)) {
    return "Usually a harmless local probe; review only if database connections are failing.";
  }
  if (/\brefusing to delete\b/i.test(message)) {
    return "Move the project under a parked parent folder before using destructive site actions.";
  }
  return undefined;
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
