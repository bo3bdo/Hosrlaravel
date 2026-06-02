import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { buildMongoDbCommand, findAvailableMongoDbPort, generateMongoDbConfig, mongoDbBinaryPath, setMongoDbPort } from "../src/core/mongodb.js";
import { getPaths } from "../src/core/paths.js";

describe("MongoDB service", () => {
  beforeEach(async () => {
    process.env.LARABOXS_HOME = await mkdir(path.join(os.tmpdir(), `laraboxs-mongodb-${Date.now()}-`), { recursive: true });
  });

  it("generates a localhost-only MongoDB config", async () => {
    await setMongoDbPort(47017);

    const config = await generateMongoDbConfig();

    expect(config).toContain("bindIp: 127.0.0.1");
    expect(config).toContain("port: 47017");
    expect(config).toContain("mongodb.log");
    expect(config).toContain("data/db");
  });

  it("builds the app-local mongod command", async () => {
    const command = await buildMongoDbCommand("start");

    expect(command.command).toBe(mongoDbBinaryPath("mongod", "8.2"));
    expect(command.args).toContain("--config");
    expect(command.args.join(" ")).toContain("mongod.conf");
    expect(command.cwd).toBe(getPaths().mongodbRoot);
  });

  it("finds an available MongoDB port", async () => {
    await expect(findAvailableMongoDbPort(47018)).resolves.toBeGreaterThanOrEqual(47018);
  });
});
