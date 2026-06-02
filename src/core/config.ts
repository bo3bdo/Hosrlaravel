import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { ensureBaseDirs, getPaths } from "./paths.js";
import type { LaraboxsConfig } from "./types.js";

export function defaultConfig(): LaraboxsConfig {
  return {
    version: 1,
    tld: "test",
    parkedFolders: [],
    globalPhpVersion: "8.4",
    phpVersions: ["8.4", "8.5"],
    isolatedPhp: {},
    securedDomains: [],
    nginx: {
      httpPort: 80,
      httpsPort: 443,
      fastCgiHost: "127.0.0.1"
    },
    mysql: {
      version: "8.4",
      port: 3306,
      rootUser: "root",
      instanceName: "default"
    }
  };
}

export async function loadConfig(): Promise<LaraboxsConfig> {
  await ensureBaseDirs();
  const paths = getPaths();

  if (!existsSync(paths.configFile)) {
    const config = defaultConfig();
    await saveConfig(config);
    return config;
  }

  const raw = await readFile(paths.configFile, "utf8");
  const parsed = JSON.parse(raw) as Partial<LaraboxsConfig>;
  return normalizeConfig(parsed);
}

export async function saveConfig(config: LaraboxsConfig): Promise<void> {
  const paths = await ensureBaseDirs();
  const normalized = normalizeConfig(config);
  await writeFile(paths.configFile, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

export async function updateConfig(mutator: (config: LaraboxsConfig) => void | Promise<void>): Promise<LaraboxsConfig> {
  const config = await loadConfig();
  await mutator(config);
  const normalized = normalizeConfig(config);
  await saveConfig(normalized);
  return normalized;
}

export function normalizeConfig(input: Partial<LaraboxsConfig>): LaraboxsConfig {
  const defaults = defaultConfig();
  const parkedFolders = Array.from(
    new Set((input.parkedFolders ?? defaults.parkedFolders).map((folder) => path.resolve(folder)))
  ).sort((a, b) => a.localeCompare(b));

  const securedDomains = Array.from(new Set(input.securedDomains ?? defaults.securedDomains)).sort();

  return {
    version: 1,
    tld: input.tld ?? defaults.tld,
    parkedFolders,
    globalPhpVersion: input.globalPhpVersion ?? defaults.globalPhpVersion,
    phpVersions: Array.from(new Set(input.phpVersions ?? defaults.phpVersions)).sort(),
    isolatedPhp: input.isolatedPhp ?? defaults.isolatedPhp,
    securedDomains,
    nginx: {
      ...defaults.nginx,
      ...(input.nginx ?? {})
    },
    mysql: {
      ...defaults.mysql,
      ...(input.mysql ?? {})
    }
  };
}
