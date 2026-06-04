import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { appendLog } from "./logging.js";
import { findSite } from "./sites.js";
import { composerCommandForDeveloperTools, developerToolEnv, npmCommandForDeveloperTools, phpBinaryForDeveloperTools } from "./developerTools.js";
import type { CommandSpec, SiteCommandDefinition, SiteCommandKind } from "./types.js";

export const siteCommandDefinitions: SiteCommandDefinition[] = [
  { id: "artisan:migrate", label: "Migrate", detail: "php artisan migrate --force" },
  { id: "artisan:cache-clear", label: "Clear Cache", detail: "config/cache/route/view clear" },
  { id: "artisan:route-list", label: "Routes", detail: "php artisan route:list" },
  { id: "composer:install", label: "Composer Install", detail: "composer install" },
  { id: "npm:install", label: "npm Install", detail: "npm install" },
  { id: "npm:build", label: "npm Build", detail: "npm run build" }
];

export async function buildSiteCommand(identifier: string, command: SiteCommandKind): Promise<CommandSpec> {
  const site = await findSite(identifier);
  const env = cleanEnv(await developerToolEnv());

  switch (command) {
    case "artisan:migrate":
      assertLaravelProject(site.path, command);
      return {
        command: await phpBinaryForDeveloperTools(),
        args: ["artisan", "migrate", "--force", "--no-interaction"],
        cwd: site.path,
        env
      };
    case "artisan:cache-clear":
      assertLaravelProject(site.path, command);
      return {
        command: await phpBinaryForDeveloperTools(),
        args: ["artisan", "optimize:clear", "--no-interaction"],
        cwd: site.path,
        env
      };
    case "artisan:route-list":
      assertLaravelProject(site.path, command);
      return {
        command: await phpBinaryForDeveloperTools(),
        args: ["artisan", "route:list", "--no-ansi"],
        cwd: site.path,
        env
      };
    case "composer:install": {
      const composer = await composerCommandForDeveloperTools();
      return {
        command: composer.command,
        args: [...composer.args, "install", "--no-interaction", "--no-ansi"],
        cwd: site.path,
        env
      };
    }
    case "npm:install":
      assertPackageJson(site.path, command);
      return {
        command: await npmCommandForDeveloperTools(),
        args: ["install"],
        cwd: site.path,
        env
      };
    case "npm:build":
      assertPackageJson(site.path, command);
      return {
        command: await npmCommandForDeveloperTools(),
        args: ["run", "build"],
        cwd: site.path,
        env
      };
  }
}

export function siteCommandDefinition(command: SiteCommandKind): SiteCommandDefinition {
  const definition = siteCommandDefinitions.find((item) => item.id === command);
  if (!definition) {
    throw new Error(`Unsupported site command: ${String(command)}`);
  }
  return definition;
}

export async function runSiteCommandProcess(
  spec: CommandSpec,
  options: {
    scope: string;
    timeoutMs: number;
    onOutput: (line: string) => void;
  }
): Promise<number> {
  await appendLog("site", `running ${options.scope}: ${spec.command} ${spec.args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: { ...process.env, ...(spec.env ?? {}) },
      shell: false,
      windowsHide: true
    });
    let finished = false;
    let outputBuffer = "";
    const timer = setTimeout(() => {
      if (!finished) {
        child.kill();
        reject(new Error(`${path.basename(spec.command)} timed out.`));
      }
    }, options.timeoutMs);

    const handleOutput = (chunk: string) => {
      outputBuffer += chunk.replace(/\r/g, "\n");
      const lines = outputBuffer.split("\n");
      outputBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const clean = cleanCommandLine(line);
        if (clean) {
          options.onOutput(clean);
        }
      }
      if (outputBuffer.length > 2000) {
        const clean = cleanCommandLine(outputBuffer);
        if (clean) {
          options.onOutput(clean);
        }
        outputBuffer = "";
      }
    };

    child.stdout?.on("data", (chunk) => handleOutput(String(chunk)));
    child.stderr?.on("data", (chunk) => handleOutput(String(chunk)));
    child.once("error", (error) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        reject(error);
      }
    });
    child.once("close", (code) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      const cleanTail = cleanCommandLine(outputBuffer);
      if (cleanTail) {
        options.onOutput(cleanTail);
      }
      resolve(code ?? 1);
    });
  });
}

function assertLaravelProject(projectPath: string, command: SiteCommandKind): void {
  if (!existsSync(path.join(projectPath, "artisan"))) {
    throw new Error(`${siteCommandDefinition(command).label} requires a Laravel project with an artisan file.`);
  }
}

function assertPackageJson(projectPath: string, command: SiteCommandKind): void {
  if (!existsSync(path.join(projectPath, "package.json"))) {
    throw new Error(`${siteCommandDefinition(command).label} requires package.json.`);
  }
}

function cleanCommandLine(line: string): string {
  return line.replace(/\u001b\[[0-9;]*m/g, "").trim();
}

function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}
