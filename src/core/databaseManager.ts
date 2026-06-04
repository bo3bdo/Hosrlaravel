import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";
import { appendLog } from "./logging.js";
import { mysqlBinaryPath, runCreateDatabase } from "./mysql.js";
import { getPaths } from "./paths.js";
import { readSecret } from "./secretStore.js";
import type { CommandSpec, DatabaseExportResult, DatabaseInfo, DatabaseTableInfo } from "./types.js";

const mysqlRootPasswordKey = "mysql-root-password";
const systemDatabases = new Set(["information_schema", "mysql", "performance_schema", "sys"]);

export async function listDatabases(): Promise<DatabaseInfo[]> {
  const rows = await runMysqlQuery("SHOW DATABASES;");
  return rows
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name, system: systemDatabases.has(name) }))
    .sort((left, right) => Number(left.system) - Number(right.system) || left.name.localeCompare(right.name));
}

export async function listDatabaseTables(database: string): Promise<DatabaseTableInfo[]> {
  const safeName = validateDatabaseName(database);
  const rows = await runMysqlQuery(
    `SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA='${escapeSqlString(safeName)}' ORDER BY TABLE_NAME;`,
    { raw: true }
  );
  return rows
    .map((line) => line.split("\t"))
    .filter((parts) => parts[0])
    .map(([name, rows]) => ({
      name,
      rows: rows && rows !== "NULL" ? Number(rows) : undefined
    }));
}

export async function createManagedDatabase(database: string): Promise<DatabaseInfo> {
  const safeName = validateDatabaseName(database);
  await runCreateDatabase(safeName);
  return { name: safeName, system: false };
}

export async function dropManagedDatabase(database: string): Promise<void> {
  const safeName = validateUserDatabaseName(database);
  await runMysqlQuery(`DROP DATABASE IF EXISTS \`${safeName}\`;`);
  await appendLog("mysql", `database dropped: ${safeName}`);
}

export async function exportDatabase(database: string): Promise<DatabaseExportResult> {
  const safeName = validateUserDatabaseName(database);
  const config = await loadConfig();
  const password = await readSecret(mysqlRootPasswordKey);
  const exportsDir = path.join(getPaths().home, "exports");
  await mkdir(exportsDir, { recursive: true });
  const outputPath = path.join(exportsDir, `${safeName}-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`);
  const command: CommandSpec = {
    command: mysqlBinaryPath("mysqldump", config.mysql.version),
    args: ["-h", "127.0.0.1", "-P", String(config.mysql.port), "-u", config.mysql.rootUser, "--result-file", outputPath, safeName],
    env: password ? { MYSQL_PWD: password } : undefined
  };
  await runCommand(command);
  await appendLog("mysql", `database exported: ${safeName} -> ${outputPath}`);
  return { database: safeName, path: outputPath };
}

export async function importDatabase(database: string, sqlFile: string): Promise<void> {
  const safeName = validateUserDatabaseName(database);
  const resolvedFile = path.resolve(sqlFile);
  if (!existsSync(resolvedFile) || !resolvedFile.toLowerCase().endsWith(".sql")) {
    throw new Error("Import file must be an existing .sql file.");
  }
  await createManagedDatabase(safeName);
  const config = await loadConfig();
  const password = await readSecret(mysqlRootPasswordKey);
  const command: CommandSpec = {
    command: mysqlBinaryPath("mysql", config.mysql.version),
    args: ["-h", "127.0.0.1", "-P", String(config.mysql.port), "-u", config.mysql.rootUser, safeName],
    env: password ? { MYSQL_PWD: password } : undefined
  };
  await runCommand(command, { stdinFile: resolvedFile });
  await appendLog("mysql", `database imported: ${resolvedFile} -> ${safeName}`);
}

async function runMysqlQuery(sql: string, options: { raw?: boolean } = {}): Promise<string[]> {
  const config = await loadConfig();
  const password = await readSecret(mysqlRootPasswordKey);
  const args = ["-h", "127.0.0.1", "-P", String(config.mysql.port), "-u", config.mysql.rootUser, "--batch", "--skip-column-names", "-e", sql];
  const result = await runCommand({
    command: mysqlBinaryPath("mysql", config.mysql.version),
    args,
    env: password ? { MYSQL_PWD: password } : undefined
  });
  return result
    .split(/\r?\n/)
    .map((line) => (options.raw ? line.trimEnd() : line.trim()))
    .filter(Boolean);
}

function runCommand(command: CommandSpec, options: { stdinFile?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env: { ...process.env, ...(command.env ?? {}) },
      shell: false,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `${path.basename(command.command)} exited with ${code ?? "unknown status"}.`));
    });

    if (options.stdinFile) {
      import("node:fs").then(({ createReadStream }) => {
        createReadStream(options.stdinFile!).pipe(child.stdin);
      }).catch(reject);
    } else {
      child.stdin?.end();
    }
  });
}

function validateUserDatabaseName(database: string): string {
  const safeName = validateDatabaseName(database);
  if (systemDatabases.has(safeName)) {
    throw new Error(`Refusing to modify system database: ${safeName}`);
  }
  return safeName;
}

function validateDatabaseName(database: string): string {
  const value = database.trim();
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error("Database name may contain only letters, numbers, and underscores.");
  }
  return value;
}

function escapeSqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

