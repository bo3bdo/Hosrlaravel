import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { getPaths } from "./paths.js";
import { developerCommandPathEntries, findRuntimeEntry, getRuntimeStatus, mergePathEntries } from "./runtimes.js";

export async function phpBinaryForDeveloperTools(): Promise<string> {
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

export async function nodeBinaryForDeveloperTools(): Promise<string> {
  const node = findRuntimeEntry("node");
  if (!existsSync(node.binary)) {
    throw new Error("Node.js runtime is not installed.");
  }
  return node.binary;
}

export async function npmCommandForDeveloperTools(): Promise<string> {
  const node = findRuntimeEntry("node");
  const npm = path.join(node.root, "npm.cmd");
  if (!existsSync(npm)) {
    throw new Error("npm was not found in the Laraboxs Node.js runtime.");
  }
  return npm;
}

export async function composerCommandForDeveloperTools(): Promise<{ command: string; args: string[] }> {
  const composer = findRuntimeEntry("composer");
  if (!existsSync(composer.binary)) {
    throw new Error("Composer runtime is not installed.");
  }
  return { command: await phpBinaryForDeveloperTools(), args: [composer.binary] };
}

export async function developerToolEnv(): Promise<NodeJS.ProcessEnv> {
  const paths = getPaths();
  const phpBinary = await phpBinaryForDeveloperTools().catch(() => undefined);
  const nodeRoot = findRuntimeEntry("node").root;
  const composerRoot = findRuntimeEntry("composer").root;
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const currentPath = process.env[pathKey] ?? process.env.PATH ?? "";
  const env = { ...process.env };
  const entries = [
    phpBinary ? path.dirname(phpBinary) : "",
    nodeRoot,
    path.join(nodeRoot, "node_modules", "npm", "bin"),
    composerRoot,
    ...developerCommandPathEntries()
  ].filter(Boolean);

  env[pathKey] = mergePathEntries(currentPath, entries);
  env.PATH = env[pathKey];
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

