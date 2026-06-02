import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { buildMysqlCommand, generateMysqlIni, setMysqlPort } from "../src/core/mysql.js";

describe("mysql command logic", () => {
  beforeEach(async () => {
    process.env.LARABOXS_HOME = await mkdir(path.join(os.tmpdir(), `laraboxs-mysql-${Date.now()}-`), { recursive: true });
  });

  it("generates a localhost-only my.ini", async () => {
    await setMysqlPort(3307);
    const ini = await generateMysqlIni();

    expect(ini).toContain("port=3307");
    expect(ini).toContain("bind-address=127.0.0.1");
    expect(ini).toContain("mysqlx-bind-address=127.0.0.1");
  });

  it("builds a mysqld start command from the generated config", async () => {
    const command = await buildMysqlCommand("start");

    expect(command.command).toBe("mysqld");
    expect(command.args.join(" ")).toContain("--defaults-file=");
    expect(command.args).toContain("--console");
  });
});
