import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { buildRedisCommand, generateRedisConfig, redisBinaryPath, setRedisPort } from "../src/core/redis.js";

describe("redis command logic", () => {
  beforeEach(async () => {
    process.env.LARABOXS_HOME = await mkdir(path.join(os.tmpdir(), `laraboxs-redis-${Date.now()}-`), { recursive: true });
  });

  it("generates a localhost-only Redis config", async () => {
    await setRedisPort(46379);
    const config = await generateRedisConfig();

    expect(config).toContain("bind 127.0.0.1");
    expect(config).toContain("protected-mode yes");
    expect(config).toContain("port 46379");
    expect(config).toContain("logfile");
  });

  it("builds a redis-server start command from the generated config", async () => {
    const command = await buildRedisCommand("start");

    expect(command.command).toBe(redisBinaryPath("redis-server", "8.8"));
    expect(command.args[0]).toBe("redis.conf");
    expect(command.cwd).toContain(path.join("services", "redis", "8.8"));
  });
});
