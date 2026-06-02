import crypto from "node:crypto";
import net from "node:net";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadConfig, updateConfig } from "./config.js";
import { appendLog } from "./logging.js";
import { getPaths, toNginxPath } from "./paths.js";
import { ensureSecret, readSecret, saveSecret } from "./secretStore.js";
import type { CommandSpec, ServiceAction, ServiceStatus } from "./types.js";

const mysqlRootPasswordKey = "mysql-root-password";

export function mysqlBinaryPath(binary: "mysqld" | "mysql" | "mysqladmin" = "mysqld"): string {
  const extension = process.platform === "win32" ? ".exe" : "";
  const bundled = path.join(getPaths().mysqlRoot, "bin", `${binary}${extension}`);
  return existsSync(bundled) ? bundled : binary;
}

export async function ensureMysqlConfigured(): Promise<string> {
  const paths = getPaths();
  await mkdir(paths.mysqlData, { recursive: true });
  const password = await ensureSecret(mysqlRootPasswordKey, generateRootPassword);
  await writeFile(path.join(paths.mysqlRoot, "my.ini"), `${await generateMysqlIni()}\n`, "utf8");
  await appendLog("mysql", `configuration ready at ${path.join(paths.mysqlRoot, "my.ini")}`);
  return password;
}

export async function generateMysqlIni(): Promise<string> {
  const config = await loadConfig();
  const paths = getPaths();

  return [
    "[mysqld]",
    `basedir=${toNginxPath(paths.mysqlRoot)}`,
    `datadir=${toNginxPath(paths.mysqlData)}`,
    `port=${config.mysql.port}`,
    "bind-address=127.0.0.1",
    "mysqlx-bind-address=127.0.0.1",
    "skip-name-resolve",
    "",
    "[client]",
    "host=127.0.0.1",
    `port=${config.mysql.port}`,
    `user=${config.mysql.rootUser}`
  ].join("\n");
}

export async function setMysqlPort(port: number): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("MySQL port must be an integer between 1 and 65535.");
  }

  await updateConfig((config) => {
    config.mysql.port = port;
  });
  await ensureMysqlConfigured();
}

export async function buildMysqlCommand(action: ServiceAction): Promise<CommandSpec> {
  const config = await loadConfig();
  const paths = getPaths();
  const iniPath = path.join(paths.mysqlRoot, "my.ini");

  if (action === "stop") {
    const password = await readSecret(mysqlRootPasswordKey);
    const args = ["-h", "127.0.0.1", "-P", String(config.mysql.port), "-u", config.mysql.rootUser];
    args.push("shutdown");
    return {
      command: mysqlBinaryPath("mysqladmin"),
      args,
      env: password ? { MYSQL_PWD: password } : undefined
    };
  }

  if (action === "restart") {
    const password = await readSecret(mysqlRootPasswordKey);
    return {
      command: mysqlBinaryPath("mysqladmin"),
      args: ["-h", "127.0.0.1", "-P", String(config.mysql.port), "-u", config.mysql.rootUser, "shutdown"],
      env: password ? { MYSQL_PWD: password } : undefined
    };
  }

  return {
    command: mysqlBinaryPath("mysqld"),
    args: [`--defaults-file=${iniPath}`, "--console"],
    cwd: paths.mysqlRoot
  };
}

export async function runMysql(action: ServiceAction): Promise<ServiceStatus> {
  await ensureMysqlConfigured();
  const command = await buildMysqlCommand(action);

  if (isMissingWindowsMysqlBinary(command.command)) {
    const message = `MySQL binary not found. Place MySQL 8.4 binaries under ${path.join(getPaths().mysqlRoot, "bin")} or add MySQL tools to PATH.`;
    await appendLog("mysql", message);
    return { name: "mysql", state: "unknown", port: (await loadConfig()).mysql.port, message };
  }

  const child = spawn(command.command, command.args, {
    cwd: command.cwd ?? getPaths().mysqlRoot,
    detached: true,
    env: { ...process.env, ...(command.env ?? {}) },
    stdio: "ignore",
    shell: false
  });
  child.once("error", (error) => {
    void appendLog("mysql", `${action} failed: ${error.message}`);
  });
  child.unref();
  await appendLog("mysql", `${action} requested`);
  if (action === "restart") {
    await runMysql("start");
  }
  return getMysqlStatus(`${action} requested`);
}

export async function getMysqlStatus(message?: string): Promise<ServiceStatus> {
  const config = await loadConfig();
  const reachable = await canConnect("127.0.0.1", config.mysql.port, 250);

  return {
    name: "mysql",
    state: reachable ? "running" : "stopped",
    version: config.mysql.version,
    port: config.mysql.port,
    logPath: path.join(getPaths().logs, "mysql.log"),
    message
  };
}

export async function createDatabase(databaseName: string): Promise<CommandSpec> {
  const safeName = validateDatabaseName(databaseName);
  const config = await loadConfig();
  const password = await readSecret(mysqlRootPasswordKey);
  const args = ["-h", "127.0.0.1", "-P", String(config.mysql.port), "-u", config.mysql.rootUser];
  args.push("-e", `CREATE DATABASE IF NOT EXISTS \`${safeName}\`;`);
  await appendLog("mysql", `create database requested: ${safeName}`);
  return {
    command: mysqlBinaryPath("mysql"),
    args,
    env: password ? { MYSQL_PWD: password } : undefined
  };
}

export async function runCreateDatabase(databaseName: string): Promise<ServiceStatus> {
  await ensureMysqlConfigured();
  const command = await createDatabase(databaseName);
  if (isMissingWindowsMysqlBinary(command.command)) {
    const message = `MySQL client binary not found. Place mysql.exe under ${path.join(getPaths().mysqlRoot, "bin")} or add mysql to PATH.`;
    await appendLog("mysql", message);
    return { name: "mysql", state: "unknown", port: (await loadConfig()).mysql.port, message };
  }

  const code = await runForeground(command);
  if (code !== 0) {
    throw new Error(`mysql exited with code ${code}.`);
  }

  await appendLog("mysql", `database created: ${validateDatabaseName(databaseName)}`);
  return getMysqlStatus(`database created: ${validateDatabaseName(databaseName)}`);
}

export async function mysqlShellCommand(): Promise<CommandSpec> {
  const config = await loadConfig();
  return {
    command: mysqlBinaryPath("mysql"),
    args: ["-h", "127.0.0.1", "-P", String(config.mysql.port), "-u", config.mysql.rootUser, "-p"]
  };
}

export async function resetMysqlRootPassword(): Promise<string> {
  const next = generateRootPassword();
  await saveSecret(mysqlRootPasswordKey, next);
  await appendLog("mysql", "root password reset in local secret store");
  return next;
}

export async function laravelEnv(databaseName: string): Promise<string> {
  const config = await loadConfig();
  const password = await ensureMysqlConfigured();
  return [
    "DB_CONNECTION=mysql",
    "DB_HOST=127.0.0.1",
    `DB_PORT=${config.mysql.port}`,
    `DB_DATABASE=${validateDatabaseName(databaseName)}`,
    `DB_USERNAME=${config.mysql.rootUser}`,
    `DB_PASSWORD=${password}`
  ].join("\n");
}

function generateRootPassword(): string {
  return crypto.randomBytes(18).toString("base64url");
}

function validateDatabaseName(databaseName: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(databaseName)) {
    throw new Error("Database names may contain only letters, numbers, and underscores.");
  }
  return databaseName;
}

function isMissingWindowsMysqlBinary(command: string): boolean {
  if (process.platform !== "win32") {
    return false;
  }
  if (path.isAbsolute(command) || command.includes(path.sep)) {
    return false;
  }
  return command === "mysqld" || command === "mysql" || command === "mysqladmin";
}

function runForeground(command: CommandSpec): Promise<number> {
  const child = spawn(command.command, command.args, {
    cwd: command.cwd ?? getPaths().mysqlRoot,
    env: { ...process.env, ...(command.env ?? {}) },
    stdio: "inherit",
    shell: false
  });

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

function canConnect(host: string, port: number, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}
