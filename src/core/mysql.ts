import crypto from "node:crypto";
import net from "node:net";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { loadConfig, updateConfig } from "./config.js";
import { appendLog } from "./logging.js";
import { getPaths, mysqlDataForVersion, mysqlRootForVersion, toNginxPath } from "./paths.js";
import { ensureSecret, readSecret, saveSecret } from "./secretStore.js";
import { findRuntimeEntry } from "./runtimes.js";
import type { CommandSpec, ServiceAction, ServiceStatus } from "./types.js";

const mysqlRootPasswordKey = "mysql-root-password";

export function mysqlBinaryPath(binary: "mysqld" | "mysql" | "mysqladmin" = "mysqld", version?: string): string {
  const extension = process.platform === "win32" ? ".exe" : "";
  const root = version ? mysqlRootForVersion(version) : findRuntimeEntry("mysql").root;
  const bundled = path.join(root, "bin", `${binary}${extension}`);
  return existsSync(bundled) ? bundled : binary;
}

export async function ensureMysqlConfigured(): Promise<string> {
  const config = await loadConfig();
  const paths = mysqlPathsForVersion(config.mysql.version);
  await mkdir(paths.data, { recursive: true });
  await mkdir(getPaths().logs, { recursive: true });
  const password = await ensureSecret(mysqlRootPasswordKey, generateRootPassword);
  await writeFile(paths.config, `${await generateMysqlIni()}\n`, "utf8");
  await appendLog("mysql", `configuration ready at ${paths.config}`);
  return password;
}

export async function initializeMysqlDataDir(): Promise<ServiceStatus> {
  const password = await ensureMysqlConfigured();
  const config = await loadConfig();
  const paths = mysqlPathsForVersion(config.mysql.version);
  const marker = path.join(paths.data, "mysql");

  if (existsSync(marker)) {
    return getMysqlStatus("MySQL data directory already initialized.");
  }

  if (isMissingWindowsMysqlBinary(mysqlBinaryPath("mysqld", config.mysql.version))) {
    const message = `MySQL server binary not found. Install MySQL ${config.mysql.version} from Setup or the MySQL page before initialization.`;
    await appendLog("mysql", message);
    return { name: "mysql", state: "unknown", port: config.mysql.port, version: config.mysql.version, message };
  }

  if ((await isDirectoryNonEmpty(paths.data)) && !existsSync(marker)) {
    throw new Error(`MySQL data directory is not empty but does not look initialized: ${paths.data}`);
  }

  const initSpec: CommandSpec = {
    command: mysqlBinaryPath("mysqld", config.mysql.version),
    args: [`--defaults-file=${paths.config}`, "--initialize-insecure", `--user=${config.mysql.rootUser}`],
    cwd: paths.root
  };
  const initCode = await runForeground(initSpec);
  if (initCode !== 0) {
    throw new Error(`mysqld --initialize-insecure exited with code ${initCode}.`);
  }

  const child = startBackground({
    command: mysqlBinaryPath("mysqld", config.mysql.version),
    args: [`--defaults-file=${paths.config}`],
    cwd: paths.root
  });
  child.once("error", (error) => {
    void appendLog("mysql", `temporary start after initialization failed: ${error.message}`);
  });

  await waitForMysql(20_000);
  await runForeground({
    command: mysqlBinaryPath("mysql", config.mysql.version),
    args: [
      "-h",
      "127.0.0.1",
      "-P",
      String(config.mysql.port),
      "-u",
      config.mysql.rootUser,
      "-e",
      [
        `ALTER USER '${config.mysql.rootUser}'@'localhost' IDENTIFIED BY '${escapeSqlString(password)}'`,
        `CREATE USER IF NOT EXISTS '${config.mysql.rootUser}'@'127.0.0.1' IDENTIFIED BY '${escapeSqlString(password)}'`,
        `ALTER USER '${config.mysql.rootUser}'@'127.0.0.1' IDENTIFIED BY '${escapeSqlString(password)}'`,
        `GRANT ALL PRIVILEGES ON *.* TO '${config.mysql.rootUser}'@'127.0.0.1' WITH GRANT OPTION`,
        "FLUSH PRIVILEGES"
      ].join("; ")
    ]
  });
  await runMysql("stop");
  await appendLog("mysql", "data directory initialized and root password applied");
  return getMysqlStatus("MySQL data directory initialized.");
}

export async function generateMysqlIni(): Promise<string> {
  const config = await loadConfig();
  const paths = mysqlPathsForVersion(config.mysql.version);

  return [
    "[mysqld]",
    `basedir=${toNginxPath(paths.root)}`,
    `datadir=${toNginxPath(paths.data)}`,
    `port=${config.mysql.port}`,
    "bind-address=127.0.0.1",
    "mysqlx-bind-address=127.0.0.1",
    "skip-name-resolve",
    `log-error=${toNginxPath(path.join(getPaths().logs, "mysql-error.log"))}`,
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

export async function setMysqlVersion(version: string): Promise<void> {
  findRuntimeEntry("mysql", version);

  if ((await getMysqlStatus()).state === "running") {
    throw new Error("Stop MySQL before switching versions.");
  }

  await updateConfig((config) => {
    config.mysql.version = version;
  });
  await ensureMysqlConfigured();
}

export async function findAvailableMysqlPort(preferredPort = 3306): Promise<number> {
  for (let port = preferredPort; port < preferredPort + 100; port += 1) {
    if (!(await canConnect("127.0.0.1", port, 100))) {
      return port;
    }
  }

  throw new Error(`No available MySQL port found between ${preferredPort} and ${preferredPort + 99}.`);
}

export async function buildMysqlCommand(action: ServiceAction): Promise<CommandSpec> {
  const config = await loadConfig();
  const paths = mysqlPathsForVersion(config.mysql.version);
  const iniPath = paths.config;

  if (action === "stop") {
    const password = await readSecret(mysqlRootPasswordKey);
    const args = ["-h", "127.0.0.1", "-P", String(config.mysql.port), "-u", config.mysql.rootUser];
    args.push("shutdown");
    return {
      command: mysqlBinaryPath("mysqladmin", config.mysql.version),
      args,
      env: password ? { MYSQL_PWD: password } : undefined
    };
  }

  if (action === "restart") {
    const password = await readSecret(mysqlRootPasswordKey);
    return {
      command: mysqlBinaryPath("mysqladmin", config.mysql.version),
      args: ["-h", "127.0.0.1", "-P", String(config.mysql.port), "-u", config.mysql.rootUser, "shutdown"],
      env: password ? { MYSQL_PWD: password } : undefined
    };
  }

  const password = await ensureSecret(mysqlRootPasswordKey, generateRootPassword);
  const initFile = await writeMysqlStartupInitFile(password);
  return {
    command: mysqlBinaryPath("mysqld", config.mysql.version),
    args: [`--defaults-file=${iniPath}`, `--init-file=${initFile}`],
    cwd: paths.root
  };
}

export async function runMysql(action: ServiceAction): Promise<ServiceStatus> {
  await ensureMysqlConfigured();

  if (action === "restart") {
    await runMysql("stop");
    const status = await runMysql("start");
    await appendLog("mysql", "restart requested");
    return { ...status, message: "restart requested" };
  }

  if (action === "start" && (await getMysqlStatus()).state === "running") {
    return getMysqlStatus("start requested; already running");
  }

  const command = await buildMysqlCommand(action);

  if (isMissingWindowsMysqlBinary(command.command)) {
    const config = await loadConfig();
    const message = `MySQL binary not found. Install MySQL ${config.mysql.version} from Setup or the MySQL page.`;
    await appendLog("mysql", message);
    return { name: "mysql", state: "unknown", version: config.mysql.version, port: config.mysql.port, message };
  }

  if (action === "stop") {
    const code = await runHidden(command);
    if (code !== 0) {
      await stopAppLocalMysqlProcesses();
    }
    await appendLog("mysql", "stop requested");
    return getMysqlStatus("stop requested");
  }

  const child = startBackground(command);
  child.once("error", (error) => {
    void appendLog("mysql", `${action} failed: ${error.message}`);
  });
  if (action === "start") {
    try {
      await waitForMysql(15_000);
    } finally {
      await cleanupMysqlStartupInitFile();
    }
  }
  await appendLog("mysql", `${action} requested`);
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
    logPath: path.join(getPaths().logs, "mysql-error.log"),
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
    command: mysqlBinaryPath("mysql", config.mysql.version),
    args,
    env: password ? { MYSQL_PWD: password } : undefined
  };
}

export async function runCreateDatabase(databaseName: string): Promise<ServiceStatus> {
  await ensureMysqlConfigured();
  const command = await createDatabase(databaseName);
  if (isMissingWindowsMysqlBinary(command.command)) {
    const config = await loadConfig();
    const message = `MySQL client binary not found. Install MySQL ${config.mysql.version} from Setup or the MySQL page.`;
    await appendLog("mysql", message);
    return { name: "mysql", state: "unknown", version: config.mysql.version, port: config.mysql.port, message };
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
  const password = await readSecret(mysqlRootPasswordKey);
  return {
    command: mysqlBinaryPath("mysql", config.mysql.version),
    args: ["-h", "127.0.0.1", "-P", String(config.mysql.port), "-u", config.mysql.rootUser],
    env: password ? { MYSQL_PWD: password } : undefined
  };
}

export async function openMysqlShell(): Promise<void> {
  const command = await mysqlShellCommand();
  if (isMissingWindowsMysqlBinary(command.command)) {
    const config = await loadConfig();
    throw new Error(`MySQL client binary not found. Install MySQL ${config.mysql.version} from Setup or the MySQL page.`);
  }

  const launcher = mysqlShellLauncherCommand(command);
  const child = spawn(launcher.command, launcher.args, {
    cwd: launcher.cwd,
    detached: true,
    env: { ...process.env, ...(launcher.env ?? {}) },
    stdio: "ignore",
    shell: false,
    windowsHide: false
  });

  child.once("error", (error) => {
    void appendLog("mysql", `interactive shell failed: ${error.message}`);
  });
  child.unref();
  await appendLog("mysql", "interactive shell opened");
}

export function mysqlShellLauncherCommand(command: CommandSpec): CommandSpec {
  if (process.platform !== "win32") {
    return command;
  }

  return {
    command: "cmd.exe",
    args: ["/d", "/c", "start", "laraboxs MySQL Shell", command.command, ...command.args],
    env: command.env
  };
}

export async function resetMysqlRootPassword(): Promise<string> {
  return changeMysqlRootPassword(generateRootPassword());
}

export async function changeMysqlRootPassword(nextPassword: string): Promise<string> {
  const password = validateMysqlRootPassword(nextPassword);
  const config = await loadConfig();

  if (!(await canConnect("127.0.0.1", config.mysql.port, 250))) {
    throw new Error("Start MySQL before changing the root password.");
  }

  const currentPassword = await readSecret(mysqlRootPasswordKey);
  const sql = [
    `ALTER USER '${escapeSqlString(config.mysql.rootUser)}'@'localhost' IDENTIFIED BY '${escapeSqlString(password)}'`,
    `CREATE USER IF NOT EXISTS '${escapeSqlString(config.mysql.rootUser)}'@'127.0.0.1' IDENTIFIED BY '${escapeSqlString(password)}'`,
    `ALTER USER '${escapeSqlString(config.mysql.rootUser)}'@'127.0.0.1' IDENTIFIED BY '${escapeSqlString(password)}'`,
    `GRANT ALL PRIVILEGES ON *.* TO '${escapeSqlString(config.mysql.rootUser)}'@'127.0.0.1' WITH GRANT OPTION`,
    "FLUSH PRIVILEGES"
  ].join("; ");
  const code = await runHidden({
    command: mysqlBinaryPath("mysql", config.mysql.version),
    args: ["-h", "127.0.0.1", "-P", String(config.mysql.port), "-u", config.mysql.rootUser, "-e", sql],
    env: currentPassword ? { MYSQL_PWD: currentPassword } : undefined
  });

  if (code !== 0) {
    throw new Error("Could not change MySQL root password. Check the current stored password and MySQL logs.");
  }

  await saveSecret(mysqlRootPasswordKey, password);
  await appendLog("mysql", "root password changed");
  return password;
}

export async function getMysqlRootPassword(): Promise<string> {
  return ensureMysqlConfigured();
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

function validateMysqlRootPassword(password: string): string {
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    throw new Error("MySQL root password must be between 8 and 128 characters.");
  }
  return password;
}

function validateDatabaseName(databaseName: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(databaseName)) {
    throw new Error("Database names may contain only letters, numbers, and underscores.");
  }
  return databaseName;
}

async function isDirectoryNonEmpty(directory: string): Promise<boolean> {
  try {
    return (await readdir(directory)).length > 0;
  } catch {
    return false;
  }
}

function escapeSqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function writeMysqlStartupInitFile(password: string): Promise<string> {
  const config = await loadConfig();
  const initFile = path.join(getPaths().logs, "mysql-startup-init.sql");
  const rootUser = escapeSqlString(config.mysql.rootUser);
  const rootPassword = escapeSqlString(password);
  const sql = [
    `ALTER USER '${rootUser}'@'localhost' IDENTIFIED BY '${rootPassword}'`,
    `CREATE USER IF NOT EXISTS '${rootUser}'@'127.0.0.1' IDENTIFIED BY '${rootPassword}'`,
    `ALTER USER '${rootUser}'@'127.0.0.1' IDENTIFIED BY '${rootPassword}'`,
    `GRANT ALL PRIVILEGES ON *.* TO '${rootUser}'@'127.0.0.1' WITH GRANT OPTION`,
    "FLUSH PRIVILEGES"
  ].join(";\n");
  await mkdir(getPaths().logs, { recursive: true });
  await writeFile(initFile, `${sql};\n`, "utf8");
  return initFile;
}

async function cleanupMysqlStartupInitFile(): Promise<void> {
  await rm(path.join(getPaths().logs, "mysql-startup-init.sql"), { force: true });
}

function mysqlPathsForVersion(version: string): { root: string; data: string; config: string } {
  const root = mysqlRootForVersion(version);
  return {
    root,
    data: mysqlDataForVersion(version),
    config: path.join(root, "my.ini")
  };
}

async function waitForMysql(timeoutMs: number): Promise<void> {
  const config = await loadConfig();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await canConnect("127.0.0.1", config.mysql.port, 250)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`MySQL did not become reachable on 127.0.0.1:${config.mysql.port}.`);
}

function isMissingWindowsMysqlBinary(command: string): boolean {
  if (process.platform !== "win32") {
    return false;
  }
  if (path.isAbsolute(command) || command.includes(path.sep)) {
    return !existsSync(command);
  }
  if (command !== "mysqld" && command !== "mysql" && command !== "mysqladmin") {
    return false;
  }

  const result = spawnSync("where.exe", [command], { stdio: "ignore", shell: false, windowsHide: true });
  return result.status !== 0;
}

function runForeground(command: CommandSpec): Promise<number> {
  const child = spawn(command.command, command.args, {
    cwd: command.cwd,
    env: { ...process.env, ...(command.env ?? {}) },
    stdio: "inherit",
    shell: false,
    windowsHide: true
  });

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

function runHidden(command: CommandSpec): Promise<number> {
  const child = spawn(command.command, command.args, {
    cwd: command.cwd,
    env: { ...process.env, ...(command.env ?? {}) },
    stdio: "ignore",
    shell: false,
    windowsHide: true
  });

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

function startBackground(command: CommandSpec) {
  const child = spawn(command.command, command.args, {
    cwd: command.cwd,
    detached: process.platform !== "win32",
    env: { ...process.env, ...(command.env ?? {}) },
    stdio: "ignore",
    shell: false,
    windowsHide: true
  });
  child.unref();
  return child;
}

async function stopAppLocalMysqlProcesses(): Promise<void> {
  if (process.platform !== "win32") {
    return;
  }

  const config = await loadConfig();
  const rootPattern = `*${mysqlRootForVersion(config.mysql.version).replace(/'/g, "''")}*`;
  const script = [
    `$rootPattern = '${rootPattern}'`,
    "Get-CimInstance Win32_Process -Filter \"name = 'mysqld.exe'\" | Where-Object { $_.CommandLine -like $rootPattern } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
  ].join("; ");

  const code = await runHidden({
    command: "powershell.exe",
    args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]
  });

  if (code !== 0) {
    await appendLog("mysql", `fallback process stop exited with code ${code}`);
  } else {
    await appendLog("mysql", "fallback process stop requested for app-local mysqld.exe");
  }
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
