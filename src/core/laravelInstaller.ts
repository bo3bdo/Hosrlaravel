import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";
import { appendLog } from "./logging.js";
import { getPaths } from "./paths.js";
import { developerCommandPathEntries, findRuntimeEntry, getRuntimeStatus, installRuntime, mergePathEntries } from "./runtimes.js";
import { addParkedFolder, siteFromProject, slugify } from "./sites.js";
import type {
  LaravelAuthPreset,
  LaravelDatabaseDriver,
  LaravelInstallerStatus,
  LaravelPackageManager,
  LaravelStarterKit,
  LaravelTestingFramework,
  NewSitePreset,
  NewSiteRequest,
  SiteCreationResult
} from "./types.js";

const installerPackageName = "laravel/installer";
const packagistInstallerUrl = "https://repo.packagist.org/p2/laravel/installer.json";

interface CommandResult {
  stdout: string;
  stderr: string;
}

export function laravelInstallerPaths(): { composerHome: string; binDir: string; proxy: string; batch: string } {
  const composerHome = path.join(getPaths().home, "composer-home");
  const binDir = path.join(composerHome, "vendor", "bin");
  return {
    composerHome,
    binDir,
    proxy: path.join(binDir, "laravel"),
    batch: path.join(binDir, "laravel.bat")
  };
}

export async function getLaravelInstallerStatus(options: { checkLatest?: boolean } = {}): Promise<LaravelInstallerStatus> {
  const paths = laravelInstallerPaths();
  const composer = findRuntimeEntry("composer");
  const composerInstalled = existsSync(composer.binary);
  const phpBinary = await phpBinaryForDeveloperTools().catch(() => undefined);
  const phpInstalled = Boolean(phpBinary);
  const binary = installerBinaryForDisplay();
  const installed = Boolean(binary);
  let version: string | undefined;
  let latestVersion: string | undefined;
  let message: string | undefined;

  if (installed && phpBinary) {
    try {
      const output = await runLaravelCommand(["--version", "--no-ansi"], {
        cwd: getPaths().home,
        timeoutMs: 10000
      });
      version = parseLaravelInstallerVersion(`${output.stdout}\n${output.stderr}`);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
  }

  if (options.checkLatest !== false) {
    try {
      latestVersion = await latestLaravelInstallerVersion();
    } catch (error) {
      message = message ?? `Unable to check latest Laravel Installer version: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  const updateAvailable =
    installed && version && latestVersion ? compareDottedVersions(cleanVersion(version), cleanVersion(latestVersion)) < 0 : false;

  return {
    installed,
    version,
    latestVersion,
    updateAvailable,
    binary,
    binDir: paths.binDir,
    composerHome: paths.composerHome,
    composerInstalled,
    phpInstalled,
    message
  };
}

export async function installOrUpdateLaravelInstaller(): Promise<LaravelInstallerStatus> {
  const paths = laravelInstallerPaths();
  const config = await loadConfig();
  await ensurePhpAndComposer(config.globalPhpVersion);
  await mkdir(paths.composerHome, { recursive: true });
  await mkdir(path.join(getPaths().home, "composer-cache"), { recursive: true });
  await appendLog("site", `installing ${installerPackageName}`);

  await runComposerGlobalCommand(["require", installerPackageName, "--no-interaction", "--no-ansi"], {
    cwd: getPaths().home,
    timeoutMs: 15 * 60 * 1000
  });

  await appendLog("site", `${installerPackageName} installed in ${paths.composerHome}`);
  return getLaravelInstallerStatus({ checkLatest: true });
}

export async function uninstallLaravelInstaller(): Promise<LaravelInstallerStatus> {
  const status = await getLaravelInstallerStatus({ checkLatest: false });
  if (!status.installed) {
    return getLaravelInstallerStatus({ checkLatest: true });
  }

  const config = await loadConfig();
  await ensurePhpAndComposer(config.globalPhpVersion);
  await appendLog("site", `removing ${installerPackageName}`);

  await runComposerGlobalCommand(["remove", installerPackageName, "--no-interaction", "--no-ansi"], {
    cwd: getPaths().home,
    timeoutMs: 10 * 60 * 1000
  });

  await appendLog("site", `${installerPackageName} removed from ${laravelInstallerPaths().composerHome}`);
  return getLaravelInstallerStatus({ checkLatest: true });
}

export async function createNewSite(request: NewSiteRequest): Promise<SiteCreationResult> {
  const normalized = normalizeNewSiteRequest(request);
  const config = await loadConfig();
  const parentPath = path.resolve(normalized.parentPath || config.parkedFolders[0] || path.join(getPaths().home, "Sites"));
  const projectPath = path.join(parentPath, normalized.name);

  await mkdir(parentPath, { recursive: true });
  await assertProjectPathAvailable(projectPath);

  let command: string | undefined;
  let output: string | undefined;

  if (normalized.preset === "laravel") {
    await ensureLaravelCreationTools(normalized.packageManager, config.globalPhpVersion);

    const args = buildLaravelNewArgs(normalized);
    const result = await runLaravelCommand(args, {
      cwd: parentPath,
      timeoutMs: 20 * 60 * 1000
    });
    command = `laravel ${args.join(" ")}`;
    output = trimCommandOutput(`${result.stdout}\n${result.stderr}`);
  } else if (normalized.preset === "php") {
    await mkdir(projectPath, { recursive: true });
    await writeFile(path.join(projectPath, "index.php"), "<?php echo 'Hello from Laraboxs';\n", "utf8");
  } else {
    await mkdir(projectPath, { recursive: true });
    await writeFile(path.join(projectPath, "index.html"), "<!doctype html><title>Laraboxs Site</title><h1>Laraboxs Site</h1>\n", "utf8");
  }

  const nextConfig = await addParkedFolder(parentPath);
  const site = await siteFromProject(projectPath, nextConfig);
  await appendLog("site", `created ${normalized.preset} site ${site.domain} at ${projectPath}`);

  return {
    projectPath,
    name: normalized.name,
    preset: normalized.preset,
    site,
    command,
    output
  };
}

export function buildLaravelNewArgs(request: NewSiteRequest): string[] {
  const normalized = normalizeNewSiteRequest({ ...request, preset: "laravel" });
  const args = ["new", normalized.name, "--no-interaction", "--no-ansi"];

  if (normalized.database) {
    args.push(`--database=${normalized.database}`);
  }

  switch (normalized.starterKit) {
    case "react":
      args.push("--react");
      break;
    case "vue":
      args.push("--vue");
      break;
    case "svelte":
      args.push("--svelte");
      break;
    case "livewire":
      args.push("--livewire");
      break;
  }

  if (normalized.auth === "none") {
    args.push("--no-authentication");
  } else if (normalized.auth === "workos") {
    args.push("--workos");
  }

  if (normalized.testing === "phpunit") {
    args.push("--phpunit");
  } else {
    args.push("--pest");
  }

  if (normalized.packageManager && normalized.packageManager !== "none") {
    args.push(`--${normalized.packageManager}`);
  }

  args.push(normalized.boost ? "--boost" : "--no-boost");

  if (normalized.git) {
    args.push("--git");
  }

  return args;
}

function normalizeNewSiteRequest(request: NewSiteRequest): Required<NewSiteRequest> {
  const preset = enumValue<NewSitePreset>(request.preset, ["laravel", "php", "static"], "preset");
  const name = normalizeProjectName(request.name);
  return {
    name,
    parentPath: typeof request.parentPath === "string" ? request.parentPath.trim() : "",
    preset,
    starterKit: enumValue<LaravelStarterKit>(request.starterKit ?? "none", ["none", "react", "vue", "svelte", "livewire"], "starter kit"),
    auth: enumValue<LaravelAuthPreset>(request.auth ?? "default", ["default", "none", "workos"], "authentication"),
    database: enumValue<LaravelDatabaseDriver>(request.database ?? "mysql", ["sqlite", "mysql", "mariadb", "pgsql", "sqlsrv"], "database"),
    packageManager: enumValue<LaravelPackageManager>(request.packageManager ?? "none", ["none", "npm", "pnpm", "bun", "yarn"], "package manager"),
    testing: enumValue<LaravelTestingFramework>(request.testing ?? "pest", ["pest", "phpunit"], "testing framework"),
    git: request.git === true,
    boost: request.boost === true
  };
}

function normalizeProjectName(value: string): string {
  if (!value.trim()) {
    throw new Error("Site name is required.");
  }
  const name = slugify(value);
  if (!name) {
    throw new Error("Site name is required.");
  }
  if (name.length > 64) {
    throw new Error("Site name must be 64 characters or fewer.");
  }
  return name;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(`Unsupported ${label}: ${String(value)}`);
}

async function assertProjectPathAvailable(projectPath: string): Promise<void> {
  try {
    await stat(projectPath);
    throw new Error(`Project folder already exists: ${projectPath}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Project folder already exists:")) {
      throw error;
    }
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

async function runComposerGlobalCommand(args: string[], options: { cwd: string; timeoutMs: number }): Promise<CommandResult> {
  const composer = findRuntimeEntry("composer");
  if (!existsSync(composer.binary)) {
    throw new Error("Composer runtime is not installed.");
  }

  const phpBinary = await phpBinaryForDeveloperTools();
  return runCommand(phpBinary, [composer.binary, "global", ...args], {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
    env: await developerToolEnv()
  });
}

async function ensurePhpAndComposer(phpVersion: string): Promise<void> {
  const php = findRuntimeEntry("php", phpVersion);
  if (!existsSync(php.binary)) {
    await appendLog("site", `installing PHP ${phpVersion} for Laravel Installer`);
    await installRuntime("php", phpVersion);
  }

  const composer = findRuntimeEntry("composer");
  if (!existsSync(composer.binary)) {
    await appendLog("site", "installing Composer for Laravel Installer");
    await installRuntime("composer");
  }
}

async function runLaravelCommand(args: string[], options: { cwd: string; timeoutMs: number }): Promise<CommandResult> {
  const command = await laravelCommand();
  return runCommand(command.command, [...command.args, ...args], {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
    env: await developerToolEnv()
  });
}

async function laravelCommand(): Promise<{ command: string; args: string[] }> {
  const paths = laravelInstallerPaths();
  if (existsSync(paths.proxy)) {
    return { command: await phpBinaryForDeveloperTools(), args: [paths.proxy] };
  }
  if (existsSync(paths.batch)) {
    return { command: "cmd.exe", args: ["/d", "/c", paths.batch] };
  }
  throw new Error("Laravel Installer command was not found.");
}

function installerBinaryForDisplay(): string | undefined {
  const paths = laravelInstallerPaths();
  if (existsSync(paths.batch)) {
    return paths.batch;
  }
  if (existsSync(paths.proxy)) {
    return paths.proxy;
  }
  return undefined;
}

async function phpBinaryForDeveloperTools(): Promise<string> {
  const config = await loadConfig();
  const preferred = path.join(getPaths().phpRoot, config.globalPhpVersion, "php.exe");
  if (existsSync(preferred)) {
    return preferred;
  }

  const installed = getRuntimeStatus().php.find((runtime) => runtime.installed && existsSync(runtime.binary));
  if (installed) {
    return installed.binary;
  }

  throw new Error("PHP runtime is not installed.");
}

async function developerToolEnv(): Promise<NodeJS.ProcessEnv> {
  const paths = getPaths();
  const phpBinary = await phpBinaryForDeveloperTools();
  const installer = laravelInstallerPaths();
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const currentPath = process.env[pathKey] ?? process.env.PATH ?? "";
  const env = { ...process.env };
  const composerRoot = findRuntimeEntry("composer").root;
  const entries = [path.dirname(phpBinary), nodePackageManagerBinDir(), composerRoot, installer.binDir, ...developerCommandPathEntries()];

  env[pathKey] = mergePathEntries(currentPath, entries);
  env.PATH = env[pathKey];
  env.COMPOSER_HOME = installer.composerHome;
  env.COMPOSER_CACHE_DIR = path.join(paths.home, "composer-cache");
  env.LARABOXS_HOME = paths.home;
  delete env.NODE_OPTIONS;
  return env;
}

async function ensureLaravelCreationTools(packageManager: LaravelPackageManager, phpVersion: string): Promise<void> {
  await ensurePhpAndComposer(phpVersion);

  const status = await getLaravelInstallerStatus({ checkLatest: false });
  if (!status.installed) {
    await installOrUpdateLaravelInstaller();
  }

  await ensureNodePackageManager(packageManager);
}

async function ensureNodePackageManager(packageManager: LaravelPackageManager): Promise<void> {
  if (packageManager === "none") {
    return;
  }

  const node = await ensureNodeRuntime();
  const npm = path.join(node.root, "npm.cmd");
  if (!existsSync(npm)) {
    throw new Error("npm was not found in the Laraboxs Node.js runtime.");
  }

  if (packageManager === "npm") {
    return;
  }

  const command = path.join(nodePackageManagerBinDir(), `${packageManager}.cmd`);
  if (existsSync(command)) {
    return;
  }

  await mkdir(nodePackageManagerBinDir(), { recursive: true });
  await appendLog("site", `installing ${packageManager} with Laraboxs Node.js`);
  await runCommand(npm, ["install", "--global", "--prefix", nodePackageManagerBinDir(), packageManager], {
    cwd: getPaths().home,
    timeoutMs: 10 * 60 * 1000,
    env: await developerToolEnv()
  });
  await appendLog("site", `${packageManager} installed at ${nodePackageManagerBinDir()}`);
}

async function ensureNodeRuntime(): Promise<{ root: string; binary: string }> {
  let node = findRuntimeEntry("node");
  if (!existsSync(node.binary)) {
    await installRuntime("node");
    node = findRuntimeEntry("node");
  }
  return { root: node.root, binary: node.binary };
}

function nodePackageManagerBinDir(): string {
  return path.join(getPaths().home, "developer-tools", "node-global");
}

function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; env: NodeJS.ProcessEnv }
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        child.kill();
        reject(new Error(`${path.basename(command)} timed out.`));
      }
    }, options.timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout = appendLimited(stdout, String(chunk));
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendLimited(stderr, String(chunk));
    });
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
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(trimCommandOutput(`${stderr}\n${stdout}`) || `${path.basename(command)} exited with ${code ?? "unknown status"}.`));
    });
  });
}

function appendLimited(current: string, next: string, limit = 30000): string {
  const combined = current + next;
  return combined.length > limit ? combined.slice(combined.length - limit) : combined;
}

function parseLaravelInstallerVersion(output: string): string | undefined {
  return output.match(/Laravel Installer\s+v?(\d+(?:\.\d+){1,2})/i)?.[1];
}

async function latestLaravelInstallerVersion(): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(packagistInstallerUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Packagist returned ${response.status}`);
    }
    const payload = (await response.json()) as {
      packages?: Record<string, Array<{ version?: string; version_normalized?: string }>>;
    };
    const packages = payload.packages?.[installerPackageName] ?? [];
    const latest = packages.find((release) => release.version && !release.version.includes("-"));
    return latest?.version ? cleanVersion(latest.version) : undefined;
  } finally {
    clearTimeout(timer);
  }
}

function cleanVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}

function compareDottedVersions(left: string, right: string): number {
  const leftParts = left.match(/\d+/g)?.map((part) => Number(part)) ?? [];
  const rightParts = right.match(/\d+/g)?.map((part) => Number(part)) ?? [];
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function trimCommandOutput(output: string): string {
  return output
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-24)
    .join("\n");
}
