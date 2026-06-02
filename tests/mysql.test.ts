import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildMysqlCommand,
  createDatabase,
  ensureMysqlConfigured,
  generateMysqlIni,
  mysqlShellCommand,
  mysqlShellLauncherCommand,
  setMysqlPort,
  setMysqlVersion
} from "../src/core/mysql.js";

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
    expect(ini).toContain("log-error=");
  });

  it("builds a mysqld start command from the generated config", async () => {
    const command = await buildMysqlCommand("start");

    expect(command.command).toBe("mysqld");
    expect(command.args.join(" ")).toContain("--defaults-file=");
    expect(command.args).not.toContain("--console");
  });

  it("generates MySQL config for the selected version", async () => {
    await setMysqlPort(43307);
    await setMysqlVersion("8.0");
    const ini = await generateMysqlIni();

    expect(ini).toContain(path.join("services", "mysql", "8.0").replace(/\\/g, "/"));
    expect(ini).toContain(path.join("services", "mysql", "8.0", "data").replace(/\\/g, "/"));
  });

  it("uses MYSQL_PWD instead of exposing passwords in command arguments", async () => {
    await ensureMysqlConfigured();
    const command = await createDatabase("app_name");
    const shell = await mysqlShellCommand();

    expect(command.args.join(" ")).not.toContain("--password");
    expect(command.env?.MYSQL_PWD).toBeTruthy();
    expect(shell.args).not.toContain("-p");
    expect(shell.env?.MYSQL_PWD).toBeTruthy();
  });

  it("launches the interactive shell without putting the password in arguments", () => {
    const launcher = mysqlShellLauncherCommand({
      command: "C:\\mysql\\bin\\mysql.exe",
      args: ["-h", "127.0.0.1", "-u", "root"],
      env: { MYSQL_PWD: "secret-password" }
    });

    expect(launcher.env?.MYSQL_PWD).toBe("secret-password");
    expect(launcher.args.join(" ")).not.toContain("secret-password");
    if (process.platform === "win32") {
      expect(launcher.command).toBe("cmd.exe");
      expect(launcher.args).toContain("start");
      expect(launcher.args).toContain("C:\\mysql\\bin\\mysql.exe");
    } else {
      expect(launcher.command).toBe("C:\\mysql\\bin\\mysql.exe");
    }
  });
});
