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

  it("hides MySQL warnings caused by local status probes", async () => {
    await mkdir(getPaths().logs, { recursive: true });
    await writeFile(
      path.join(getPaths().logs, "mysql-error.log"),
      [
        "2026-06-13 19:24:40 13180 [Warning] Aborted connection 13180 to db: 'unconnected' user: 'unauthenticated' host: '127.0.0.1' (Got an error reading communication packets)",
        "2026-06-13 19:24:40 13180 [Warning] Aborted connection 13180 to db: 'unconnected' user: 'unauthenticated' host: '127.0.0.1' (This connection closed normally without authentication)",
        "2026-06-13 19:24:41 13181 [ERROR] real database error"
      ].join("\n"),
      "utf8"
    );

    const logs = await readRecentLogs();

    expect(logs).toEqual(["[mysql] 2026-06-13 19:24:41 13181 [ERROR] real database error"]);
  });

  it("hides benign service startup noise from diagnostics", async () => {
    await mkdir(getPaths().logs, { recursive: true });
    await writeFile(
      path.join(getPaths().logs, "mysql-error.log"),
      [
        "2026-07-05 19:21:22 0 [Warning] 'user' entry 'root@desktop-ipatrrm' ignored in --skip-name-resolve mode.",
        "2026-07-05 19:21:22 0 [Warning] 'proxies_priv' entry '@% root@desktop-ipatrrm' ignored in --skip-name-resolve mode.",
        "2026-07-05 19:21:18 0 [Note] InnoDB: Doublewrite buffer not found: creating new",
        "2026-07-05 19:21:23 0 [ERROR] real mysql error"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(getPaths().logs, "redis.log"),
      [
        "292:M 05 Jul 2026 19:23:00.308 # You requested maxclients of 10000 requiring at least 10032 max file descriptors.",
        "292:M 05 Jul 2026 19:23:00.311 # Server can't set maximum open files to 10032 because of OS error: Operation not permitted.",
        "292:M 05 Jul 2026 19:23:00.315 # Current maximum open files is 3200. maxclients has been reduced to 3168 to compensate for low ulimit.",
        "292:M 05 Jul 2026 19:23:00.337 # WARNING: Redis does not require authentication. Redis will accept connections from any local client.",
        "292:M 05 Jul 2026 19:23:01.000 # real redis error"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(getPaths().logs, "nginx-error.log"),
      ["fallback process stop requested for app-local nginx.exe", "nginx real warning"].join("\n"),
      "utf8"
    );

    const logs = await readRecentLogs();

    expect(logs).toEqual(["[nginx] nginx real warning", "[mysql] 2026-07-05 19:21:23 0 [ERROR] real mysql error", "[redis] 292:M 05 Jul 2026 19:23:01.000 # real redis error"]);
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
