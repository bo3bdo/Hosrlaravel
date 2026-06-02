import net from "node:net";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadConfig, updateConfig } from "./config.js";
import { appendLog } from "./logging.js";
import { getPaths, mongodbDataForVersion, mongodbRootForVersion, toNginxPath } from "./paths.js";
import { findRuntimeEntry } from "./runtimes.js";
import type { CommandSpec, ServiceAction, ServiceStatus } from "./types.js";

export function mongoDbBinaryPath(binary: "mongod" = "mongod", version?: string): string {
  const extension = process.platform === "win32" ? ".exe" : "";
  const root = version ? mongodbRootForVersion(version) : findRuntimeEntry("mongodb").root;
  return path.join(root, "bin", `${binary}${extension}`);
}

export async function ensureMongoDbConfigured(): Promise<string> {
  const config = await loadConfig();
  const paths = mongoDbPathsForVersion(config.mongodb.version);
  await mkdir(paths.data, { recursive: true });
  await mkdir(getPaths().logs, { recursive: true });
  await writeFile(paths.config, `${await generateMongoDbConfig()}\n`, "utf8");
  await appendLog("mongodb", `configuration ready at ${paths.config}`);
  return paths.config;
}

export async function generateMongoDbConfig(): Promise<string> {
  const config = await loadConfig();
  const paths = mongoDbPathsForVersion(config.mongodb.version);

  return [
    "storage:",
    `  dbPath: \"${toNginxPath(paths.data)}\"`,
    "systemLog:",
    "  destination: file",
    `  path: \"${toNginxPath(mongoDbLogPath())}\"`,
    "  logAppend: true",
    "net:",
    "  bindIp: 127.0.0.1",
    `  port: ${config.mongodb.port}`
  ].join("\n");
}

export async function setMongoDbPort(port: number): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("MongoDB port must be an integer between 1 and 65535.");
  }

  if ((await getMongoDbStatus()).state === "running") {
    throw new Error("Stop MongoDB before changing its port.");
  }

  await updateConfig((config) => {
    config.mongodb.port = port;
  });
  await ensureMongoDbConfigured();
}

export async function findAvailableMongoDbPort(preferredPort = 27017): Promise<number> {
  for (let port = preferredPort; port < preferredPort + 100; port += 1) {
    if (!(await canConnect("127.0.0.1", port, 100))) {
      return port;
    }
  }

  throw new Error(`No available MongoDB port found between ${preferredPort} and ${preferredPort + 99}.`);
}

export async function buildMongoDbCommand(action: ServiceAction): Promise<CommandSpec> {
  const config = await loadConfig();
  const paths = mongoDbPathsForVersion(config.mongodb.version);

  if (action === "stop" || action === "restart") {
    return {
      command: mongoDbBinaryPath("mongod", config.mongodb.version),
      args: ["--shutdown", "--config", paths.config],
      cwd: paths.root
    };
  }

  await ensureMongoDbConfigured();
  return {
    command: mongoDbBinaryPath("mongod", config.mongodb.version),
    args: ["--config", paths.config],
    cwd: paths.root
  };
}

export async function runMongoDb(action: ServiceAction): Promise<ServiceStatus> {
  if (action === "restart") {
    await runMongoDb("stop");
    const status = await runMongoDb("start");
    await appendLog("mongodb", "restart requested");
    return { ...status, message: "restart requested" };
  }

  if (action === "start" && (await getMongoDbStatus()).state === "running") {
    return getMongoDbStatus("start requested; already running");
  }

  if (action === "start") {
    const command = await buildMongoDbCommand("start");
    if (!existsSync(command.command)) {
      const config = await loadConfig();
      const message = "MongoDB is not installed. Install it from Setup or the MongoDB page.";
      await appendLog("mongodb", message);
      return { name: "mongodb", state: "unknown", version: config.mongodb.version, port: config.mongodb.port, logPath: mongoDbLogPath(), message };
    }

    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      detached: process.platform !== "win32",
      stdio: "ignore",
      shell: false,
      windowsHide: true
    });
    child.once("error", (error) => {
      void appendLog("mongodb", `start failed: ${error.message}`);
    });
    child.unref();
    await writeFile(mongoDbPidPath(), String(child.pid), "utf8");
    await waitForMongoDb(20_000);
    await appendLog("mongodb", "start requested");
    return getMongoDbStatus("start requested");
  }

  const command = await buildMongoDbCommand("stop");
  if (existsSync(command.command)) {
    const code = await runHidden(command);
    if (code !== 0) {
      await stopMongoDbPid();
    }
  } else {
    await stopMongoDbPid();
  }
  await rm(mongoDbPidPath(), { force: true });
  await appendLog("mongodb", "stop requested");
  return getMongoDbStatus("stop requested");
}

export async function getMongoDbStatus(message?: string): Promise<ServiceStatus> {
  const config = await loadConfig();
  const reachable = await canConnect("127.0.0.1", config.mongodb.port, 250);

  return {
    name: "mongodb",
    state: reachable ? "running" : "stopped",
    version: config.mongodb.version,
    port: config.mongodb.port,
    logPath: mongoDbLogPath(),
    message
  };
}

function mongoDbPathsForVersion(version: string): { root: string; data: string; config: string } {
  const root = mongodbRootForVersion(version);
  return {
    root,
    data: mongodbDataForVersion(version),
    config: path.join(root, "mongod.conf")
  };
}

function mongoDbLogPath(): string {
  return path.join(getPaths().logs, "mongodb.log");
}

function mongoDbPidPath(): string {
  return path.join(getPaths().logs, "mongodb.pid");
}

async function stopMongoDbPid(): Promise<void> {
  try {
    const pid = Number((await readFile(mongoDbPidPath(), "utf8")).trim());
    if (Number.isFinite(pid) && pid > 0) {
      process.kill(pid);
    }
  } catch {
    // MongoDB may already be stopped or may not have been started by laraboxs.
  }
}

async function runHidden(command: CommandSpec): Promise<number> {
  const child = spawn(command.command, command.args, {
    cwd: command.cwd,
    stdio: "ignore",
    shell: false,
    windowsHide: true
  });

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function waitForMongoDb(timeoutMs: number): Promise<void> {
  const config = await loadConfig();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await canConnect("127.0.0.1", config.mongodb.port, 200)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`MongoDB did not become reachable on 127.0.0.1:${config.mongodb.port}.`);
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
