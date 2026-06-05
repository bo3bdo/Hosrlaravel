import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { appendLog, clearLogs, readRecentLogs, summarizeLogs } from "../src/core/logging.js";
import { getPaths } from "../src/core/paths.js";

describe("log aggregation", () => {
  beforeEach(async () => {
    process.env.LARABOXS_HOME = await mkdir(path.join(os.tmpdir(), `laraboxs-logs-${Date.now()}-`), { recursive: true });
  });

  it("includes laraboxs and service error logs", async () => {
    await appendLog("mysql", "start requested");
    await writeFile(path.join(getPaths().logs, "mysql-error.log"), "mysqld error line\n", "utf8");
    await writeFile(path.join(getPaths().logs, "nginx-error.log"), "nginx error line\n", "utf8");

    const logs = await readRecentLogs();

    expect(logs.some((line) => line.includes("[mysql] start requested"))).toBe(true);
    expect(logs).toContain("[mysql] mysqld error line");
    expect(logs).toContain("[nginx] nginx error line");
  });

  it("clears log files without removing non-log files", async () => {
    await appendLog("mysql", "start requested");
    await writeFile(path.join(getPaths().logs, "redis.log"), "redis line\n", "utf8");
    await writeFile(path.join(getPaths().logs, "mysql-startup-init.sql"), "keep me\n", "utf8");

    const cleared = await clearLogs();

    expect(cleared).toEqual(["laraboxs.log", "redis.log"]);
    expect(await readRecentLogs()).toEqual([]);
    expect(await readFile(path.join(getPaths().logs, "mysql-startup-init.sql"), "utf8")).toBe("keep me\n");
  });

  it("groups repeated warnings into actionable insights", () => {
    const summary = summarizeLogs([
      "[mysql] 2026-06-04 11:53:39 1918 [Warning] Aborted connection 1918 to db: 'unconnected' user: 'unauthenticated' host: '127.0.0.1'",
      "[mysql] 2026-06-04 11:53:40 1919 [Warning] Aborted connection 1919 to db: 'unconnected' user: 'unauthenticated' host: '127.0.0.1'",
      "[nginx] port conflict on 127.0.0.1:80",
      "[php] started cleanly"
    ]);

    expect(summary.warningLines).toBe(3);
    expect(summary.groups).toHaveLength(2);
    expect(summary.groups[0].count).toBe(2);
    expect(summary.groups.some((group) => /Ports tool/i.test(group.action ?? ""))).toBe(true);
  });
});
