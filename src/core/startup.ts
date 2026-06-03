import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadConfig, updateConfig } from "./config.js";
import { appendLog } from "./logging.js";
import { runMysql } from "./mysql.js";
import { runNginx } from "./nginx.js";
import { runPhpFastCgi } from "./php.js";
import { runRedis } from "./redis.js";
import type { ServiceStatus, StartupSettings, StartupStatus } from "./types.js";

const runKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const runValueName = "laraboxs";

export async function getStartupStatus(): Promise<StartupStatus> {
  const config = await loadConfig();
  const intendedExecutable = desktopExecutablePath();
  const intendedLaunchCommand = intendedExecutable ? startupLaunchCommand(intendedExecutable) : undefined;
  const launchCommand = process.platform === "win32" ? await readStartupLaunchCommand() : undefined;
  const launchAppOnLogin = process.platform === "win32" ? Boolean(launchCommand) : config.startup.launchAppOnLogin;
  const supported = process.platform === "win32" && Boolean(intendedLaunchCommand);
  const message =
    process.platform !== "win32"
      ? "Windows startup is available only on Windows."
      : supported
        ? undefined
        : "Open the packaged desktop app to enable Windows startup.";

  return {
    platform: process.platform,
    supported,
    launchAppOnLogin,
    startServicesOnLaunch: config.startup.startServicesOnLaunch,
    launchCommand,
    intendedLaunchCommand,
    message
  };
}

export async function updateStartupSettings(settings: Partial<StartupSettings>): Promise<StartupStatus> {
  if (typeof settings.launchAppOnLogin === "boolean") {
    await setLaunchAppOnLogin(settings.launchAppOnLogin);
  }

  if (typeof settings.startServicesOnLaunch === "boolean") {
    await updateConfig((config) => {
      config.startup.startServicesOnLaunch = settings.startServicesOnLaunch!;
    });
    await appendLog("startup", `start services on launch ${settings.startServicesOnLaunch ? "enabled" : "disabled"}`);
  }

  return getStartupStatus();
}

export async function startConfiguredServicesOnLaunch(): Promise<void> {
  const config = await loadConfig();
  if (!config.startup.startServicesOnLaunch) {
    return;
  }

  await appendLog("startup", "auto-starting local services");

  const services: Array<[string, () => Promise<ServiceStatus>]> = [
    ["php", () => runPhpFastCgi("start")],
    ["mysql", () => runMysql("start")],
    ["redis", () => runRedis("start")],
    ["nginx", () => runNginx("start")]
  ];

  for (const [name, start] of services) {
    try {
      const status = await start();
      const detail = status.message ? `: ${status.message}` : "";
      await appendLog("startup", `${name} auto-start ${status.state}${detail}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await appendLog("startup", `${name} auto-start failed: ${message}`);
    }
  }
}

async function setLaunchAppOnLogin(enabled: boolean): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("Windows startup is available only on Windows.");
  }

  const executable = desktopExecutablePath();
  if (!executable) {
    throw new Error("Open the packaged desktop app to enable Windows startup.");
  }

  if (enabled) {
    const result = await runReg(["add", runKey, "/v", runValueName, "/t", "REG_SZ", "/d", startupLaunchCommand(executable), "/f"]);
    if (result.code !== 0) {
      throw new Error(regErrorMessage(result, "Could not enable Windows startup."));
    }
  } else {
    const result = await runReg(["delete", runKey, "/v", runValueName, "/f"]);
    if (result.code !== 0 && (await readStartupLaunchCommand())) {
      throw new Error(regErrorMessage(result, "Could not disable Windows startup."));
    }
  }

  await updateConfig((config) => {
    config.startup.launchAppOnLogin = enabled;
  });
  await appendLog("startup", `launch app on login ${enabled ? "enabled" : "disabled"}`);
}

function desktopExecutablePath(): string | undefined {
  const configured = process.env.LARABOXS_DESKTOP_EXE;
  if (configured && existsSync(configured)) {
    return path.resolve(configured);
  }

  if (process.platform === "win32" && process.execPath && !process.execPath.toLowerCase().endsWith("\\node.exe")) {
    return path.resolve(process.execPath);
  }

  return undefined;
}

function startupLaunchCommand(executable: string): string {
  return `"${path.resolve(executable)}" --hidden`;
}

async function readStartupLaunchCommand(): Promise<string | undefined> {
  const result = await runReg(["query", runKey, "/v", runValueName]);
  if (result.code !== 0) {
    return undefined;
  }

  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(new RegExp(`^\\s*${escapeRegex(runValueName)}\\s+REG_\\w+\\s+(.+)$`, "i"));
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

function runReg(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("reg.exe", args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", (error) => resolve({ code: 1, stdout: "", stderr: error.message }));
    child.once("exit", (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
  });
}

function regErrorMessage(result: { stdout: string; stderr: string }, fallback: string): string {
  return [fallback, result.stderr.trim(), result.stdout.trim()].filter(Boolean).join(" ");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
