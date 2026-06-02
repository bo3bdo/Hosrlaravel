import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { getPaths } from "./paths.js";
import { findSiteForCwd } from "./sites.js";
import type { CommandSpec, Site } from "./types.js";

export function phpFastCgiPort(version: string): number {
  const digits = version.replace(/\D/g, "");
  const suffix = Number.parseInt(digits || "84", 10);
  return 9000 + suffix;
}

export function phpBinaryPath(version: string): string {
  const bundled = path.join(getPaths().phpRoot, version, "php.exe");
  return existsSync(bundled) ? bundled : "php";
}

export function buildPhpCommand(version: string, args: string[]): CommandSpec {
  return {
    command: phpBinaryPath(version),
    args
  };
}

export async function selectedPhpVersionForCwd(cwd = process.cwd()): Promise<string> {
  try {
    const site: Site = await findSiteForCwd(cwd);
    return site.phpVersion;
  } catch {
    const { loadConfig } = await import("./config.js");
    return (await loadConfig()).globalPhpVersion;
  }
}

export async function runPhp(args: string[], cwd = process.cwd()): Promise<number> {
  const version = await selectedPhpVersionForCwd(cwd);
  const command = buildPhpCommand(version, args);
  const child = spawn(command.command, command.args, {
    cwd,
    stdio: "inherit",
    shell: false
  });

  return new Promise((resolve) => {
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });
}
