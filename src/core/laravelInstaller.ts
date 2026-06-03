import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";
import { tryEnsureWindowsDefenderExclusion, type DefenderExclusionStatus } from "./defender.js";
import { updateDotEnvFile } from "./envFile.js";
import { appendLog } from "./logging.js";
import { laravelEnv, runCreateDatabase, runMysql } from "./mysql.js";
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

export type SiteCreationProgressReporter = (message: string, percent?: number, level?: "info" | "success" | "error") => void;

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

export async function createNewSite(request: NewSiteRequest, onProgress?: SiteCreationProgressReporter): Promise<SiteCreationResult> {
  onProgress?.("Validating site options", 5);
  const normalized = normalizeNewSiteRequest(request);
  const config = await loadConfig();
  const parentPath = path.resolve(normalized.parentPath || config.parkedFolders[0] || path.join(getPaths().home, "Sites"));
  const projectPath = path.join(parentPath, normalized.name);

  onProgress?.(`Preparing folder ${parentPath}`, 12);
  await mkdir(parentPath, { recursive: true });
  onProgress?.("Optimizing sites folder for Windows Defender", 15);
  reportDefenderExclusion(await tryEnsureWindowsDefenderExclusion(parentPath), onProgress);
  onProgress?.(`Checking project path ${projectPath}`, 18);
  await assertProjectPathAvailable(projectPath);

  let command: string | undefined;
  let output: string | undefined;

  if (normalized.preset === "laravel") {
    onProgress?.("Preparing PHP, Composer, Laravel Installer, and Node tools", 25);
    await ensureLaravelCreationTools(normalized.packageManager, config.globalPhpVersion, onProgress);

    const args = buildLaravelNewArgs(normalized);
    onProgress?.(`Running Laravel Installer: laravel ${args.join(" ")}`, 45);
    onProgress?.("Downloading Laravel project files and resolving dependencies", 47);
    let laravelOutputSeen = false;
    let heartbeatStep = 0;
    const heartbeatMessages = laravelInstallerProgressMessages(normalized);
    const heartbeatStartedAt = Date.now();
    const heartbeat = setInterval(() => {
      const message = heartbeatMessages[Math.min(heartbeatStep, heartbeatMessages.length - 1)];
      const percent = Math.min(70, 50 + heartbeatStep * 2);
      onProgress?.(`${message} (${formatElapsed(heartbeatStartedAt)})`, percent);
      heartbeatStep += 1;
    }, 8000);
    let result: CommandResult;
    try {
      result = await runLaravelCommand(args, {
        cwd: parentPath,
        timeoutMs: 20 * 60 * 1000,
        onOutput: (line) => {
          laravelOutputSeen = true;
          onProgress?.(`Laravel: ${line}`, Math.min(70, 55 + heartbeatStep));
        }
      });
    } finally {
      clearInterval(heartbeat);
    }
    command = `laravel ${args.join(" ")}`;
    output = trimCommandOutput(`${result.stdout}\n${result.stderr}`);
    if (output && !laravelOutputSeen) {
      for (const line of output.split(/\r?\n/).slice(-12)) {
        onProgress?.(`Laravel: ${line}`, 65);
      }
    }
    onProgress?.("Laravel project files created", 72, "success");
    await configureLaravelProjectEnvironment(projectPath, normalized, `${normalized.name}.${config.tld}`, onProgress);
  } else if (normalized.preset === "php") {
    onProgress?.("Creating PHP project folder", 35);
    await mkdir(projectPath, { recursive: true });
    onProgress?.("Writing index.php", 55);
    await writeFile(path.join(projectPath, "index.php"), "<?php echo 'Hello from Laraboxs';\n", "utf8");
    onProgress?.("PHP starter file created", 72, "success");
  } else {
    onProgress?.("Creating static project folder", 35);
    await mkdir(projectPath, { recursive: true });
    onProgress?.("Writing index.html", 55);
    await writeFile(path.join(projectPath, "index.html"), "<!doctype html><title>Laraboxs Site</title><h1>Laraboxs Site</h1>\n", "utf8");
    onProgress?.("Static starter file created", 72, "success");
  }

  onProgress?.("Parking project folder", 80);
  const nextConfig = await addParkedFolder(parentPath, { defenderExclusion: false });
  onProgress?.("Detecting new local domain", 86);
  const site = await siteFromProject(projectPath, nextConfig);
  await appendLog("site", `created ${normalized.preset} site ${site.domain} at ${projectPath}`);
  onProgress?.(`Site detected as ${site.domain}`, 90, "success");

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
  const args = ["new", normalized.name, "--no-interaction", "--no-ansi", "--verbose"];

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

function laravelInstallerProgressMessages(request: Required<NewSiteRequest>): string[] {
  const messages = [
    "Downloading Laravel application skeleton",
    "Installing Composer dependencies",
    "Preparing Laravel configuration files"
  ];

  if (request.starterKit !== "none") {
    messages.push(`Scaffolding ${request.starterKit} starter kit`);
  }

  if (request.packageManager !== "none") {
    messages.push(`Installing frontend dependencies with ${request.packageManager}`);
  }

  if (request.boost) {
    messages.push("Installing Laravel Boost tooling");
  }

  if (request.git) {
    messages.push("Initializing Git repository");
  }

  messages.push("Finalizing Laravel project files");
  messages.push("Laravel Installer is still working; downloads can take a few minutes");
  return messages;
}

function formatElapsed(startedAt: number): string {
  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds} elapsed`;
}

function reportDefenderExclusion(status: DefenderExclusionStatus, onProgress?: SiteCreationProgressReporter): void {
  if (status.skipped && !status.supported) {
    onProgress?.("Windows Defender optimization is unavailable on this system", 16);
    return;
  }

  if (status.excluded && status.changed) {
    onProgress?.("Windows Defender exclusion added for sites folder", 16, "success");
    return;
  }

  if (status.excluded) {
    onProgress?.("Windows Defender exclusion already covers sites folder", 16, "success");
    return;
  }

  if (!status.skipped) {
    onProgress?.(status.message, 16, "error");
  }
}

async function configureLaravelProjectEnvironment(
  projectPath: string,
  request: Required<NewSiteRequest>,
  domain: string,
  onProgress?: SiteCreationProgressReporter
): Promise<void> {
  const envPath = path.join(projectPath, ".env");
  const values: Record<string, string> = {
    APP_URL: `http://${domain}`
  };

  if (request.database === "mysql" || request.database === "mariadb") {
    onProgress?.("Configuring local database credentials", 74);
    const databaseValues = envBlockToRecord(await laravelEnv(request.name));
    if (request.database === "mariadb") {
      databaseValues.DB_CONNECTION = "mariadb";
    }
    Object.assign(values, databaseValues);

    onProgress?.(`Creating database ${request.name}`, 75);
    await runMysql("start");
    await runCreateDatabase(request.name);
  }

  await updateDotEnvFile(envPath, values);
  onProgress?.("Laravel environment configured", 76, "success");

  if (request.database === "mysql" || request.database === "mariadb") {
    onProgress?.("Running Laravel database migrations", 77);
    await runCommand(await phpBinaryForDeveloperTools(), ["artisan", "migrate", "--force", "--no-interaction"], {
      cwd: projectPath,
      timeoutMs: 5 * 60 * 1000,
      env: await developerToolEnv(),
      onOutput: (line) => onProgress?.(`Migrate: ${line}`, 78)
    });
    onProgress?.("Laravel database migrations completed", 79, "success");
  }
}

function envBlockToRecord(block: string): Record<string, string> {
  const record: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) {
      record[match[1]] = match[2];
    }
  }
  return record;
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

async function ensurePhpAndComposer(phpVersion: string, onProgress?: SiteCreationProgressReporter): Promise<void> {
  const php = findRuntimeEntry("php", phpVersion);
  if (!existsSync(php.binary)) {
    onProgress?.(`Installing PHP ${phpVersion}`, 28);
    await appendLog("site", `installing PHP ${phpVersion} for Laravel Installer`);
    await installRuntime("php", phpVersion);
    onProgress?.(`PHP ${phpVersion} installed`, 32, "success");
  } else {
    onProgress?.(`PHP ${phpVersion} is ready`, 28, "success");
  }

  const composer = findRuntimeEntry("composer");
  if (!existsSync(composer.binary)) {
    onProgress?.("Installing Composer", 32);
    await appendLog("site", "installing Composer for Laravel Installer");
    await installRuntime("composer");
    onProgress?.("Composer is ready", 36, "success");
  } else {
    onProgress?.("Composer is ready", 36, "success");
  }
}

async function runLaravelCommand(args: string[], options: { cwd: string; timeoutMs: number; onOutput?: (line: string) => void }): Promise<CommandResult> {
  const command = await laravelCommand();
  return runCommand(command.command, [...command.args, ...args], {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
    env: await developerToolEnv(),
    onOutput: options.onOutput
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
  applyLocalDevelopmentInstallEnvironment(env);
  delete env.NODE_OPTIONS;
  return env;
}

export function applyLocalDevelopmentInstallEnvironment(env: NodeJS.ProcessEnv): void {
  env.NODE_ENV = "development";
  env.npm_config_production = "false";
  env.NPM_CONFIG_PRODUCTION = "false";
  env.npm_config_include = "dev";
  env.NPM_CONFIG_INCLUDE = "dev";
  env.YARN_PRODUCTION = "false";
  delete env.npm_config_omit;
  delete env.NPM_CONFIG_OMIT;
  delete env.npm_config_only;
  delete env.NPM_CONFIG_ONLY;
  delete env.COMPOSER_NO_DEV;
}

async function ensureLaravelCreationTools(packageManager: LaravelPackageManager, phpVersion: string, onProgress?: SiteCreationProgressReporter): Promise<void> {
  await ensurePhpAndComposer(phpVersion, onProgress);

  onProgress?.("Checking Laravel Installer", 38);
  const status = await getLaravelInstallerStatus({ checkLatest: false });
  if (!status.installed) {
    onProgress?.("Installing Laravel Installer", 40);
    await installOrUpdateLaravelInstaller();
    onProgress?.("Laravel Installer is ready", 43, "success");
  } else {
    onProgress?.(`Laravel Installer ${status.version ?? ""} is ready`.trim(), 43, "success");
  }

  await ensureNodePackageManager(packageManager, onProgress);
}

async function ensureNodePackageManager(packageManager: LaravelPackageManager, onProgress?: SiteCreationProgressReporter): Promise<void> {
  if (packageManager === "none") {
    onProgress?.("Skipping Node package manager install", 44);
    return;
  }

  onProgress?.("Checking Node.js runtime", 44);
  const node = await ensureNodeRuntime();
  const npm = path.join(node.root, "npm.cmd");
  if (!existsSync(npm)) {
    throw new Error("npm was not found in the Laraboxs Node.js runtime.");
  }

  if (packageManager === "npm") {
    onProgress?.("npm is ready", 44, "success");
    return;
  }

  const command = path.join(nodePackageManagerBinDir(), `${packageManager}.cmd`);
  if (existsSync(command)) {
    onProgress?.(`${packageManager} is ready`, 44, "success");
    return;
  }

  onProgress?.(`Installing ${packageManager}`, 44);
  await mkdir(nodePackageManagerBinDir(), { recursive: true });
  await appendLog("site", `installing ${packageManager} with Laraboxs Node.js`);
  await runCommand(npm, ["install", "--global", "--prefix", nodePackageManagerBinDir(), packageManager], {
    cwd: getPaths().home,
    timeoutMs: 10 * 60 * 1000,
    env: await developerToolEnv(),
    onOutput: (line) => onProgress?.(line, 44)
  });
  await appendLog("site", `${packageManager} installed at ${nodePackageManagerBinDir()}`);
  onProgress?.(`${packageManager} installed`, 44, "success");
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
  options: { cwd: string; timeoutMs: number; env: NodeJS.ProcessEnv; onOutput?: (line: string) => void }
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
    let outputBuffer = "";
    let lastPartialOutput = "";
    let lastPartialOutputAt = 0;
    const timer = setTimeout(() => {
      if (!finished) {
        child.kill();
        reject(new Error(`${path.basename(command)} timed out.`));
      }
    }, options.timeoutMs);

    const emitOutput = (line: string, partial = false) => {
      const clean = cleanCommandLine(line);
      if (!clean) {
        return;
      }
      if (partial) {
        const now = Date.now();
        if (clean === lastPartialOutput || now - lastPartialOutputAt < 900) {
          return;
        }
        lastPartialOutput = clean;
        lastPartialOutputAt = now;
      } else {
        lastPartialOutput = "";
      }
      options.onOutput?.(clean);
    };

    const handleOutput = (chunk: string) => {
      outputBuffer += chunk.replace(/\r/g, "\n");
      if (outputBuffer.includes("\n")) {
        const lines = outputBuffer.split("\n");
        outputBuffer = lines.pop() ?? "";
        for (const line of lines) {
          emitOutput(line);
        }
        return;
      }

      emitOutput(outputBuffer, true);
      if (outputBuffer.length > 2000) {
        outputBuffer = outputBuffer.slice(-2000);
      }
    };

    child.stdout?.on("data", (chunk) => {
      const text = String(chunk);
      stdout = appendLimited(stdout, text);
      handleOutput(text);
    });
    child.stderr?.on("data", (chunk) => {
      const text = String(chunk);
      stderr = appendLimited(stderr, text);
      handleOutput(text);
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
      const cleanTail = cleanCommandLine(outputBuffer);
      if (cleanTail && cleanTail !== lastPartialOutput) {
        options.onOutput?.(cleanTail);
      }
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

function cleanCommandLine(line: string): string {
  return line.replace(/\u001b\[[0-9;]*m/g, "").trim();
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
