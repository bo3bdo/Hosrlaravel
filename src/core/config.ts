import { readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { ensureBaseDirs, getPaths } from "./paths.js";
import type { LaraboxsConfig } from "./types.js";

const legacyDefaultPhpExtensions = [
  "mbstring",
  "openssl",
  "pdo_mysql",
  "mysqli",
  "pdo_sqlite",
  "sqlite3",
  "fileinfo",
  "curl",
  "zip",
  "intl",
  "gd",
  "sodium",
  "exif"
];

const defaultPhpExtensions = [
  "curl",
  "fileinfo",
  "mbstring",
  "openssl",
  "pdo_mysql",
  "pdo_sqlite",
  "mysqli",
  "sqlite3",
  "zip",
  "gd",
  "intl",
  "bcmath",
  "sodium",
  "exif",
  "ftp",
  "imap",
  "ldap",
  "soap",
  "sockets",
  "xsl",
  "redis",
  "imagick",
  "pgsql",
  "pdo_pgsql",
  "sqlsrv",
  "pdo_sqlsrv"
];

const extensionsAddedAfterLegacyDefaults = defaultPhpExtensions.filter((extension) => !legacyDefaultPhpExtensions.includes(extension));

export function defaultConfig(): LaraboxsConfig {
  return {
    version: 1,
    setupComplete: false,
    startup: {
      launchAppOnLogin: false,
      startServicesOnLaunch: false
    },
    tld: "test",
    parkedFolders: [],
    globalPhpVersion: "8.5",
    phpVersions: ["8.4", "8.5"],
    isolatedPhp: {},
    siteEntryPaths: {},
    securedDomains: [],
    php: {
      memoryLimit: "512M",
      uploadMaxFilesize: "64M",
      postMaxSize: "64M",
      maxExecutionTime: 60,
      maxInputVars: 3000,
      enabledExtensions: defaultPhpExtensions,
      xdebugEnabled: false,
      xdebugIdeKey: "PHPSTORM"
    },
    nginx: {
      httpPort: 80,
      httpsPort: 443,
      fastCgiHost: "127.0.0.1"
    },
    mysql: {
      version: "9.7",
      port: 3306,
      rootUser: "root",
      instanceName: "default"
    },
    redis: {
      version: "8.8",
      port: 6379
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
  await backupConfigFile(paths.configFile);
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
  const inputPhp: Partial<LaraboxsConfig["php"]> = input.php ?? {};
  const inputStartup: Partial<LaraboxsConfig["startup"]> = input.startup ?? {};

  return {
    version: 1,
    setupComplete: input.setupComplete ?? defaults.setupComplete,
    startup: {
      launchAppOnLogin: inputStartup.launchAppOnLogin ?? defaults.startup.launchAppOnLogin,
      startServicesOnLaunch: inputStartup.startServicesOnLaunch ?? defaults.startup.startServicesOnLaunch
    },
    tld: input.tld ?? defaults.tld,
    parkedFolders,
    globalPhpVersion: input.globalPhpVersion ?? defaults.globalPhpVersion,
    phpVersions: Array.from(new Set(input.phpVersions ?? defaults.phpVersions)).sort(),
    isolatedPhp: normalizeStringMap(input.isolatedPhp ?? defaults.isolatedPhp),
    siteEntryPaths: normalizeStringMap(input.siteEntryPaths ?? defaults.siteEntryPaths),
    securedDomains,
    php: {
      memoryLimit: inputPhp.memoryLimit ?? defaults.php.memoryLimit,
      uploadMaxFilesize: inputPhp.uploadMaxFilesize ?? defaults.php.uploadMaxFilesize,
      postMaxSize: inputPhp.postMaxSize ?? defaults.php.postMaxSize,
      maxExecutionTime: inputPhp.maxExecutionTime ?? defaults.php.maxExecutionTime,
      maxInputVars: inputPhp.maxInputVars ?? defaults.php.maxInputVars,
      enabledExtensions: normalizeExtensionList(enabledExtensionsWithDefaults(inputPhp.enabledExtensions)),
      xdebugEnabled: inputPhp.xdebugEnabled ?? defaults.php.xdebugEnabled,
      xdebugIdeKey: inputPhp.xdebugIdeKey ?? defaults.php.xdebugIdeKey
    },
    nginx: {
      ...defaults.nginx,
      ...(input.nginx ?? {})
    },
    mysql: {
      ...defaults.mysql,
      ...(input.mysql ?? {})
    },
    redis: {
      ...defaults.redis,
      ...(input.redis ?? {})
    }
  };
}

async function backupConfigFile(configFilePath: string): Promise<void> {
  if (!existsSync(configFilePath)) {
    return;
  }
  try {
    const backupDir = path.join(path.dirname(configFilePath), "backups");
    await import("node:fs/promises").then((mod) => mod.mkdir(backupDir, { recursive: true }));
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDir, `config.json.${timestamp}.bak`);
    const current = await readFile(configFilePath, "utf8");
    await writeFile(backupPath, current, "utf8");
    await pruneConfigBackups(backupDir, 20);
  } catch {
    // Non-critical: continue saving even if backup fails.
  }
}

async function pruneConfigBackups(backupDir: string, limit: number): Promise<void> {
  try {
    const { readdir, unlink } = await import("node:fs/promises");
    const entries = await readdir(backupDir);
    const files = entries.filter((entry) => entry.endsWith(".bak"));
    if (files.length <= limit) return;

    const stats = await Promise.all(
      files.map(async (name) => {
        try {
          return { name, s: await stat(path.join(backupDir, name)) };
        } catch {
          return { name, s: null };
        }
      })
    );

    const sorted = stats.sort((a, b) => {
      if (!a.s || !b.s) return 0;
      return b.s.mtime.getTime() - a.s.mtime.getTime();
    });

    const toRemove = sorted.slice(limit);
    for (const file of toRemove) {
      await unlink(path.join(backupDir, file.name)).catch(() => undefined);
    }
  } catch {
    // Ignore pruning errors.
  }
}

function normalizeExtensionList(extensions: string[]): string[] {
  return Array.from(
    new Set(
      extensions
        .map((extension) => extension.trim().toLowerCase())
        .filter((extension) => /^[a-z0-9_]+$/.test(extension))
    )
  ).sort();
}

function normalizeStringMap(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).filter(([key, value]) => key.trim() && typeof value === "string" && value.trim())
  );
}

function enabledExtensionsWithDefaults(extensions: string[] | undefined): string[] {
  if (!extensions) {
    return defaultPhpExtensions;
  }

  const normalized = normalizeExtensionList(extensions);
  if (hasEveryExtension(normalized, legacyDefaultPhpExtensions) && !hasAnyExtension(normalized, extensionsAddedAfterLegacyDefaults)) {
    return [...normalized, ...defaultPhpExtensions];
  }

  return normalized;
}

function hasEveryExtension(extensions: string[], requiredExtensions: string[]): boolean {
  const extensionSet = new Set(extensions);
  return requiredExtensions.every((extension) => extensionSet.has(extension));
}

function hasAnyExtension(extensions: string[], candidates: string[]): boolean {
  const extensionSet = new Set(extensions);
  return candidates.some((extension) => extensionSet.has(extension));
}
