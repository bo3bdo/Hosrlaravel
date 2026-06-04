import crypto from "node:crypto";
import net from "node:net";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { loadConfig, updateConfig } from "./config.js";
import { checkPortConflict } from "./ports.js";
import { appendLog } from "./logging.js";
import { getPaths, mysqlDataForVersion, mysqlRootForVersion, toNginxPath } from "./paths.js";
import { ensureSecret, readSecret, saveSecret } from "./secretStore.js";
import { findRuntimeEntry } from "./runtimes.js";
import type { CommandSpec, RuntimeManifestEntry, ServiceAction, ServiceStatus } from "./types.js";

const mysqlRootPasswordKey = "mysql-root-password";

export function mysqlBinaryPath(binary: "mysqld" | "mysql" | "mysqladmin" | "mysqldump" = "mysqld", version?: string): string {
  const extension = process.platform === "win32" ? ".exe" : "";
  const root = version ? mysqlRootForVersion(version) : findRuntimeEntry("mysql").root;
  const bundled = path.join(root, "bin", `${binary}${extension}`);
  return existsSync(bundled) ? bundled : binary;
}

export function mysqlConfigPath(version: string): string {
  return mysqlPathsForVersion(version).config;
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
  const runtime = databaseRuntimeForVersion(config.mysql.version);
  const databaseName = databaseRuntimeDisplay(runtime);
  const paths = mysqlPathsForVersion(config.mysql.version);
  const marker = path.join(paths.data, "mysql");

  if (existsSync(marker)) {
    return getMysqlStatus(`${runtime.name} data directory already initialized.`);
  }

  if (isMissingWindowsMysqlBinary(mysqlBinaryPath("mysqld", config.mysql.version))) {
    const message = `${runtime.name} server binary not found. Install ${databaseName} from Setup or the Database page before initialization.`;
    await appendLog("mysql", message);
    return { name: "mysql", state: "unknown", port: config.mysql.port, version: config.mysql.version, message };
  }

  if ((await isDirectoryNonEmpty(paths.data)) && !existsSync(marker)) {
    if (isMariaDbRuntime(runtime)) {
      await resetIncompleteMariaDbDataDir(paths.data);
    } else {
      throw new Error(`${runtime.name} data directory is not empty but does not look initialized: ${paths.data}`);
    }
  }

  const initSpec = isMariaDbRuntime(runtime)
    ? buildMariaDbInstallDbCommand(config.mysql.version, password, config.mysql.port)
    : {
        command: mysqlBinaryPath("mysqld", config.mysql.version),
        args: [`--defaults-file=${paths.config}`, "--initialize-insecure", `--user=${config.mysql.rootUser}`],
        cwd: paths.root
      };
  const initCode = await runForeground(initSpec);
  if (initCode !== 0) {
    throw new Error(`${runtime.name} initialization exited with code ${initCode}.`);
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
  await applyRootPasswordAfterInitialization(password, isMariaDbRuntime(runtime) ? password : undefined);
  await runMysql("stop");
  await waitForMysqlStopped(10_000);
  await appendLog("mysql", `${runtime.name} data directory initialized and root password applied`);
  return getMysqlStatus(`${runtime.name} data directory initialized.`);
}

export async function generateMysqlIni(): Promise<string> {
  const config = await loadConfig();
  const runtime = databaseRuntimeForVersion(config.mysql.version);
  const paths = mysqlPathsForVersion(config.mysql.version);
  const pluginDir = mysqlPluginDir(config.mysql.version);

  const mysqldLines = [
    "[mysqld]",
    `basedir=${toNginxPath(paths.root)}`,
    `datadir=${toNginxPath(paths.data)}`,
    `plugin-dir=${pluginDir}`,
    `port=${config.mysql.port}`,
    "bind-address=127.0.0.1",
    "skip-name-resolve",
    `log-error=${toNginxPath(path.join(getPaths().logs, "mysql-error.log"))}`
  ];

  if (isMariaDbRuntime(runtime)) {
    mysqldLines.push("default-authentication-plugin=mysql_native_password");
  } else {
    mysqldLines.splice(6, 0, "mysqlx-bind-address=127.0.0.1");
  }

  const clientLines = [
    "",
    "[client]",
    "host=127.0.0.1",
    `port=${config.mysql.port}`,
    `user=${config.mysql.rootUser}`,
    `plugin-dir=${pluginDir}`,
    "default-auth=mysql_native_password",
    "ssl=0"
  ];

  return [...mysqldLines, ...clientLines].join("\n");
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
    const args = [...mysqlClientArgs(config), "shutdown"];
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
      args: [...mysqlClientArgs(config), "shutdown"],
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

  if (action === "start") {
    const initialized = await ensureMysqlInitializedForStart();
    if (initialized && initialized.state === "unknown") {
      return initialized;
    }

    const config = await loadConfig();
    const conflict = await checkPortConflict(config.mysql.port);
    if (conflict.inUse) {
      const occupant = conflict.processName ? ` (used by ${conflict.processName})` : "";
      const msg = `MySQL port ${config.mysql.port} is already in use${occupant}. Stop the other process or change the MySQL port in Settings.`;
      await appendLog("mysql", msg);
      return { name: "mysql", state: "unknown", version: config.mysql.version, port: config.mysql.port, message: msg };
    }
  }

  const command = await buildMysqlCommand(action);

  if (isMissingWindowsMysqlBinary(command.command)) {
    const config = await loadConfig();
    const runtime = databaseRuntimeForVersion(config.mysql.version);
    const message = `${runtime.name} binary not found. Install ${databaseRuntimeDisplay(runtime)} from Setup or the Database page.`;
    if (action === "stop") {
      await stopAppLocalMysqlProcesses();
      await appendLog("mysql", `${message} Fallback stop requested.`);
      return getMysqlStatus("stop requested");
    }
    await appendLog("mysql", message);
    return { name: "mysql", state: "unknown", version: config.mysql.version, port: config.mysql.port, message };
  }

  if (action === "stop") {
    const code = await runHidden(command);
    if (code !== 0) {
      await stopAppLocalMysqlProcesses();
    }
    await waitForMysqlStopped(10_000);
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
      await repairRootUserAuthIfNeeded();
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
  const args = [...mysqlClientArgs(config), "-e", `CREATE DATABASE IF NOT EXISTS \`${safeName}\`;`];
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
    const runtime = databaseRuntimeForVersion(config.mysql.version);
    const message = `${runtime.name} client binary not found. Install ${databaseRuntimeDisplay(runtime)} from Setup or the Database page.`;
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
    args: mysqlClientArgs(config),
    env: password ? { MYSQL_PWD: password } : undefined
  };
}

export async function openMysqlShell(): Promise<void> {
  const command = await mysqlShellCommand();
  if (isMissingWindowsMysqlBinary(command.command)) {
    const config = await loadConfig();
    const runtime = databaseRuntimeForVersion(config.mysql.version);
    throw new Error(`${runtime.name} client binary not found. Install ${databaseRuntimeDisplay(runtime)} from Setup or the Database page.`);
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
  const runtime = databaseRuntimeForVersion(config.mysql.version);
  const sql = buildRootUserGrantSql(config.mysql.rootUser, password, runtime);
  const code = await runHidden({
    command: mysqlBinaryPath("mysql", config.mysql.version),
    args: [...mysqlClientArgs(config), "-e", sql],
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

function databaseRuntimeForVersion(version: string): RuntimeManifestEntry {
  return findRuntimeEntry("mysql", version);
}

function isMariaDbRuntime(runtime: RuntimeManifestEntry): boolean {
  return runtime.name === "MariaDB";
}

function databaseRuntimeDisplay(runtime: RuntimeManifestEntry): string {
  return `${runtime.name} ${databaseDisplayVersion(runtime.version)}`;
}

function databaseDisplayVersion(version: string): string {
  return version.toLowerCase().startsWith("mariadb-") ? version.slice("mariadb-".length) : version;
}

async function ensureMysqlInitializedForStart(): Promise<ServiceStatus | undefined> {
  const config = await loadConfig();
  const paths = mysqlPathsForVersion(config.mysql.version);
  if (existsSync(path.join(paths.data, "mysql"))) {
    return undefined;
  }
  await appendLog("mysql", "data directory is not initialized; initializing before start");
  const status = await initializeMysqlDataDir();
  return existsSync(path.join(paths.data, "mysql")) ? undefined : status;
}

async function resetIncompleteMariaDbDataDir(dataDir: string): Promise<void> {
  const entries = await readdir(dataDir, { withFileTypes: true }).catch(() => []);
  if (!entries.length) {
    return;
  }

  if (entries.some((entry) => entry.isDirectory())) {
    throw new Error(`MariaDB data directory is not initialized and contains folders: ${dataDir}`);
  }

  await appendLog("mysql", `removing incomplete MariaDB data directory at ${dataDir}`);
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });
}

function buildMariaDbInstallDbCommand(version: string, password: string, port: number): CommandSpec {
  const paths = mysqlPathsForVersion(version);
  return {
    command: mariaDbInstallDbPath(version),
    args: [`--datadir=${paths.data}`, `--password=${password}`, `--port=${port}`, `--config=${paths.config}`, "--silent"],
    cwd: paths.root
  };
}

function mariaDbInstallDbPath(version: string): string {
  const root = mysqlRootForVersion(version);
  const extension = process.platform === "win32" ? ".exe" : "";
  for (const binary of [`mariadb-install-db${extension}`, `mysql_install_db${extension}`]) {
    const candidate = path.join(root, "bin", binary);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return path.join(root, "bin", `mariadb-install-db${extension}`);
}

async function applyRootPasswordAfterInitialization(password: string, connectPassword?: string): Promise<void> {
  const config = await loadConfig();
  const runtime = databaseRuntimeForVersion(config.mysql.version);
  await runForeground({
    command: mysqlBinaryPath("mysql", config.mysql.version),
    args: [...mysqlClientArgs(config), "-e", buildRootUserGrantSql(config.mysql.rootUser, password, runtime)],
    env: connectPassword ? { MYSQL_PWD: connectPassword } : undefined
  });
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
  const runtime = databaseRuntimeForVersion(config.mysql.version);
  const initFile = path.join(getPaths().logs, "mysql-startup-init.sql");
  const sql = buildRootUserGrantSql(config.mysql.rootUser, password, runtime);
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

export function mysqlClientArgs(config: { mysql: { port: number; rootUser: string; version: string } }): string[] {
  const iniPath = toNginxPath(mysqlPathsForVersion(config.mysql.version).config);
  return [`--defaults-file=${iniPath}`, "-h", "127.0.0.1", "-P", String(config.mysql.port), "-u", config.mysql.rootUser];
}

function mysqlPluginDir(version: string): string {
  return toNginxPath(path.join(mysqlRootForVersion(version), "lib", "plugin"));
}

function buildRootUserGrantSql(rootUser: string, password: string, runtime: RuntimeManifestEntry): string {
  const user = escapeSqlString(rootUser);
  const secret = escapeSqlString(password);
  const identified = isMariaDbRuntime(runtime)
    ? `IDENTIFIED VIA mysql_native_password USING PASSWORD('${secret}')`
    : `IDENTIFIED BY '${secret}'`;

  return [
    `ALTER USER '${user}'@'localhost' ${identified}`,
    `CREATE USER IF NOT EXISTS '${user}'@'127.0.0.1' ${identified}`,
    `ALTER USER '${user}'@'127.0.0.1' ${identified}`,
    `GRANT ALL PRIVILEGES ON *.* TO '${user}'@'127.0.0.1' WITH GRANT OPTION`,
    "FLUSH PRIVILEGES"
  ].join("; ");
}

async function repairRootUserAuthIfNeeded(): Promise<void> {
  const config = await loadConfig();
  const runtime = databaseRuntimeForVersion(config.mysql.version);
  if (!isMariaDbRuntime(runtime)) {
    return;
  }

  const password = await readSecret(mysqlRootPasswordKey);
  if (!password) {
    return;
  }

  const code = await runHidden({
    command: mysqlBinaryPath("mysql", config.mysql.version),
    args: [...mysqlClientArgs(config), "-e", buildRootUserGrantSql(config.mysql.rootUser, password, runtime)],
    env: { MYSQL_PWD: password }
  });

  if (code === 0) {
    await appendLog("mysql", "root user auth normalized to mysql_native_password");
  }
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

async function waitForMysqlStopped(timeoutMs: number): Promise<void> {
  const config = await loadConfig();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await canConnect("127.0.0.1", config.mysql.port, 250))) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
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
