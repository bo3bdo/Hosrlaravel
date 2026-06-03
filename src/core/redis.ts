import net from "node:net";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadConfig, updateConfig } from "./config.js";
import { appendLog } from "./logging.js";
import { getPaths, redisDataForVersion, redisRootForVersion, toNginxPath } from "./paths.js";
import { findRuntimeEntry } from "./runtimes.js";
import type { CommandSpec, ServiceAction, ServiceStatus } from "./types.js";

export function redisBinaryPath(binary: "redis-server" | "redis-cli" = "redis-server", version?: string): string {
  const extension = process.platform === "win32" ? ".exe" : "";
  const root = version ? redisRootForVersion(version) : findRuntimeEntry("redis").root;
  return path.join(root, `${binary}${extension}`);
}

export async function ensureRedisConfigured(): Promise<string> {
  const config = await loadConfig();
  const paths = redisPathsForVersion(config.redis.version);
  await mkdir(paths.data, { recursive: true });
  await mkdir(getPaths().logs, { recursive: true });
  await writeFile(paths.config, `${await generateRedisConfig()}\n`, "utf8");
  await appendLog("redis", `configuration ready at ${paths.config}`);
  return paths.config;
}

export async function generateRedisConfig(): Promise<string> {
  const config = await loadConfig();
  const paths = redisPathsForVersion(config.redis.version);

  return [
    "bind 127.0.0.1 -::1",
    "protected-mode yes",
    `port ${config.redis.port}`,
    "tcp-backlog 511",
    "timeout 0",
    "tcp-keepalive 300",
    `dir "${toNginxPath(paths.data)}"`,
    `logfile "${toNginxPath(path.join(getPaths().logs, "redis.log"))}"`,
    "save 900 1",
    "save 300 10",
    "save 60 10000",
    "appendonly no"
  ].join("\n");
}

export async function setRedisPort(port: number): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Redis port must be an integer between 1 and 65535.");
  }

  if ((await getRedisStatus()).state === "running") {
    throw new Error("Stop Redis before changing its port.");
  }

  await updateConfig((config) => {
    config.redis.port = port;
  });
  await ensureRedisConfigured();
}

export async function setRedisVersion(version: string): Promise<void> {
  findRuntimeEntry("redis", version);

  if ((await getRedisStatus()).state === "running") {
    throw new Error("Stop Redis before switching versions.");
  }

  await updateConfig((config) => {
    config.redis.version = version;
  });
  await ensureRedisConfigured();
}

export async function findAvailableRedisPort(preferredPort = 6379): Promise<number> {
  for (let port = preferredPort; port < preferredPort + 100; port += 1) {
    if (!(await canConnect("127.0.0.1", port, 100))) {
      return port;
    }
  }

  throw new Error(`No available Redis port found between ${preferredPort} and ${preferredPort + 99}.`);
}

export async function buildRedisCommand(action: ServiceAction): Promise<CommandSpec> {
  const config = await loadConfig();
  const paths = redisPathsForVersion(config.redis.version);

  if (action === "stop" || action === "restart") {
    return {
      command: redisBinaryPath("redis-cli", config.redis.version),
      args: ["-h", "127.0.0.1", "-p", String(config.redis.port), "shutdown"]
    };
  }

  await ensureRedisConfigured();
  return {
    command: redisBinaryPath("redis-server", config.redis.version),
    args: [path.basename(paths.config)],
    cwd: paths.root
  };
}

export async function runRedis(action: ServiceAction): Promise<ServiceStatus> {
  if (action === "restart") {
    await runRedis("stop");
    const status = await runRedis("start");
    await appendLog("redis", "restart requested");
    return { ...status, message: "restart requested" };
  }

  if (action === "start" && (await getRedisStatus()).state === "running") {
    return getRedisStatus("start requested; already running");
  }

  if (action === "start") {
    const command = await buildRedisCommand("start");
    if (!existsSync(command.command)) {
      const config = await loadConfig();
      const message = "Redis is not installed. Install it from Setup or the Redis page.";
      await appendLog("redis", message);
      return { name: "redis", state: "unknown", version: config.redis.version, port: config.redis.port, logPath: redisLogPath(), message };
    }

    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      detached: process.platform !== "win32",
      stdio: "ignore",
      shell: false,
      windowsHide: true
    });
    child.once("error", (error) => {
      void appendLog("redis", `start failed: ${error.message}`);
    });
    child.unref();
    await writeFile(redisPidPath(), String(child.pid), "utf8");
    await waitForRedis(5_000);
    await appendLog("redis", "start requested");
    return getRedisStatus("start requested");
  }

  const command = await buildRedisCommand("stop");
  if (existsSync(command.command)) {
    const code = await runHidden(command);
    if (code !== 0) {
      await stopRedisPid();
    }
  } else {
    await stopRedisPid();
  }
  await rm(redisPidPath(), { force: true });
  await appendLog("redis", "stop requested");
  return getRedisStatus("stop requested");
}

export async function getRedisStatus(message?: string): Promise<ServiceStatus> {
  const config = await loadConfig();
  const reachable = await canConnect("127.0.0.1", config.redis.port, 250);

  return {
    name: "redis",
    state: reachable ? "running" : "stopped",
    version: config.redis.version,
    port: config.redis.port,
    logPath: redisLogPath(),
    message
  };
}

export async function redisCliCommand(): Promise<CommandSpec> {
  const config = await loadConfig();
  return {
    command: redisBinaryPath("redis-cli", config.redis.version),
    args: ["-h", "127.0.0.1", "-p", String(config.redis.port)]
  };
}

export async function openRedisCli(): Promise<void> {
  const command = await redisCliCommand();
  if (!existsSync(command.command)) {
    throw new Error("Redis CLI binary not found. Install Redis from Setup or the Redis page.");
  }

  const launcher = redisCliLauncherCommand(command);
  const child = spawn(launcher.command, launcher.args, {
    cwd: launcher.cwd,
    detached: true,
    env: { ...process.env, ...(launcher.env ?? {}) },
    stdio: "ignore",
    shell: false,
    windowsHide: false
  });

  child.once("error", (error) => {
    void appendLog("redis", `interactive CLI failed: ${error.message}`);
  });
  child.unref();
  await appendLog("redis", "interactive CLI opened");
}

export function redisCliLauncherCommand(command: CommandSpec): CommandSpec {
  if (process.platform !== "win32") {
    return command;
  }

  return {
    command: "cmd.exe",
    args: ["/d", "/c", "start", "laraboxs Redis CLI", command.command, ...command.args],
    env: command.env
  };
}

function redisPathsForVersion(version: string): { root: string; data: string; config: string } {
  const root = redisRootForVersion(version);
  return {
    root,
    data: redisDataForVersion(version),
    config: path.join(root, "redis.conf")
  };
}

function redisLogPath(): string {
  return path.join(getPaths().logs, "redis.log");
}

function redisPidPath(): string {
  return path.join(getPaths().logs, "redis.pid");
}

async function stopRedisPid(): Promise<void> {
  try {
    const pid = Number((await readFile(redisPidPath(), "utf8")).trim());
    if (Number.isFinite(pid) && pid > 0) {
      process.kill(pid);
    }
  } catch {
    // Redis may already be stopped or may not have been started by laraboxs.
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

async function waitForRedis(timeoutMs: number): Promise<void> {
  const config = await loadConfig();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await canConnect("127.0.0.1", config.redis.port, 200)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Redis did not become reachable on 127.0.0.1:${config.redis.port}.`);
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
