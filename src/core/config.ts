import { readFile, writeFile } from "node:fs/promises";
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

export function defaultConfig(): LaraboxsConfig {
  return {
    version: 1,
    setupComplete: false,
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
      enabledExtensions: defaultPhpExtensions
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

  return {
    version: 1,
    setupComplete: input.setupComplete ?? defaults.setupComplete,
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
      enabledExtensions: normalizeExtensionList(enabledExtensionsWithDefaults(inputPhp.enabledExtensions))
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
  if (hasEveryExtension(normalized, legacyDefaultPhpExtensions)) {
    return [...normalized, ...defaultPhpExtensions];
  }

  return normalized;
}

function hasEveryExtension(extensions: string[], requiredExtensions: string[]): boolean {
  const extensionSet = new Set(extensions);
  return requiredExtensions.every((extension) => extensionSet.has(extension));
}
