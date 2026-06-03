import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { appendLog, clearLogs, readRecentLogs } from "../src/core/logging.js";
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
});
