import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfig, updateConfig } from "./config.js";
import { dropManagedDatabase } from "./databaseManager.js";
import { tryEnsureWindowsDefenderExclusion } from "./defender.js";
import { appendLog } from "./logging.js";
import { getMysqlStatus, runMysql } from "./mysql.js";
import { getPaths } from "./paths.js";
import type { Framework, LaraboxsConfig, Site, SiteDeletionResult } from "./types.js";

const systemDatabases = new Set(["information_schema", "mysql", "performance_schema", "sys"]);

export async function addParkedFolder(folder: string, options: { defenderExclusion?: boolean } = {}): Promise<LaraboxsConfig> {
  const resolved = path.resolve(folder);
  await mkdir(resolved, { recursive: true });
  if (options.defenderExclusion !== false) {
    await tryEnsureWindowsDefenderExclusion(resolved);
  }

  return updateConfig((config) => {
    if (!config.parkedFolders.includes(resolved)) {
      config.parkedFolders.push(resolved);
    }
  });
}

export async function setGlobalPhpVersion(version: string): Promise<LaraboxsConfig> {
  return updateConfig((config) => {
    ensureKnownPhpVersion(config, version);
    config.globalPhpVersion = version;
  });
}

export async function setConfiguredPhpVersions(versions: string[], globalVersion?: string): Promise<LaraboxsConfig> {
  const selectedVersions = Array.from(new Set(versions.map((version) => version.trim()).filter(Boolean))).sort();
  if (!selectedVersions.length) {
    throw new Error("At least one PHP version is required.");
  }

  const activeVersion = globalVersion?.trim() || selectedVersions[0];
  if (!selectedVersions.includes(activeVersion)) {
    throw new Error("The global PHP version must be one of the configured PHP versions.");
  }

  return updateConfig((config) => {
    selectedVersions.forEach((version) => ensureKnownPhpVersion(config, version));
    config.phpVersions = selectedVersions;
    config.globalPhpVersion = activeVersion;

    for (const [domain, version] of Object.entries(config.isolatedPhp)) {
      if (!selectedVersions.includes(version)) {
        delete config.isolatedPhp[domain];
      }
    }
  });
}

export async function isolateSite(identifier: string, version: string): Promise<LaraboxsConfig> {
  const site = await findSite(identifier);
  return updateConfig((config) => {
    ensureKnownPhpVersion(config, version);
    config.isolatedPhp[site.domain] = version;
  });
}

export async function unisolateSite(identifier: string): Promise<LaraboxsConfig> {
  const site = await findSite(identifier);
  return updateConfig((config) => {
    delete config.isolatedPhp[site.domain];
  });
}

export async function setSiteEntryPath(identifier: string, entryPath: string): Promise<LaraboxsConfig> {
  const site = await findSite(identifier);
  const normalizedEntry = await validateSiteEntryPath(site.path, entryPath);
  const defaultEntry = defaultSiteEntryPath(site.framework);

  return updateConfig((config) => {
    if (normalizedEntry === defaultEntry) {
      delete config.siteEntryPaths[site.domain];
    } else {
      config.siteEntryPaths[site.domain] = normalizedEntry;
    }
  });
}

export async function resetSiteEntryPath(identifier: string): Promise<LaraboxsConfig> {
  const site = await findSite(identifier);
  return updateConfig((config) => {
    delete config.siteEntryPaths[site.domain];
  });
}

export async function deleteSite(
  identifier: string,
  options: { deleteDatabases?: boolean } = {}
): Promise<SiteDeletionResult> {
  const config = await loadConfig();
  const site = await findSite(identifier);
  const sitePath = assertDeletableSitePath(site, config);
  const databaseCandidates = await databaseNamesForSite(site);
  const deleteDatabases = options.deleteDatabases !== false;
  const deletedDatabases: string[] = [];
  const skippedDatabases = databaseCandidates
    .filter((database) => !database.drop)
    .map((database) => database.name);

  if (deleteDatabases) {
    const droppableDatabases = databaseCandidates.filter((candidate) => candidate.drop);
    if (droppableDatabases.length && (await getMysqlStatus()).state !== "running") {
      const status = await runMysql("start");
      if (status.state !== "running") {
        throw new Error(status.message ?? "Could not start MySQL to delete the site's database.");
      }
    }

    for (const database of droppableDatabases) {
      await dropManagedDatabase(database.name);
      deletedDatabases.push(database.name);
    }
  } else {
    skippedDatabases.push(...databaseCandidates.filter((candidate) => candidate.drop).map((database) => database.name));
  }

  await rm(sitePath, { recursive: true, force: true });
  await updateConfig((next) => {
    delete next.isolatedPhp[site.domain];
    delete next.siteEntryPaths[site.domain];
    next.securedDomains = next.securedDomains.filter((domain) => domain !== site.domain);
  });
  await removeSiteArtifacts(site);
  await appendLog("site", `deleted site ${site.domain} at ${sitePath}`);

  return {
    site,
    deletedPath: sitePath,
    deletedDatabases,
    skippedDatabases: Array.from(new Set(skippedDatabases)).sort()
  };
}

export async function setSiteSecurity(identifier: string, secured: boolean): Promise<LaraboxsConfig> {
  const site = await findSite(identifier);
  return updateConfig((config) => {
    const domains = new Set(config.securedDomains);
    if (secured) {
      domains.add(site.domain);
    } else {
      domains.delete(site.domain);
    }
    config.securedDomains = Array.from(domains).sort();
  });
}

export async function discoverSites(config?: LaraboxsConfig): Promise<Site[]> {
  const activeConfig = config ?? (await loadConfig());
  const discovered: Site[] = [];

  for (const parkedFolder of activeConfig.parkedFolders) {
    if (!existsSync(parkedFolder)) {
      continue;
    }

    const entries = await readdir(parkedFolder, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }

      const projectPath = path.join(parkedFolder, entry.name);
      discovered.push(await siteFromProject(projectPath, activeConfig));
    }
  }

  return discovered.sort((a, b) => a.name.localeCompare(b.name));
}

export async function findSite(identifier: string): Promise<Site> {
  const sites = await discoverSites();
  const needle = identifier.toLowerCase();
  const site = sites.find((candidate) => {
    return candidate.name.toLowerCase() === needle || candidate.domain.toLowerCase() === needle;
  });

  if (!site) {
    throw new Error(`No site found for "${identifier}". Park a folder first or check laraboxs sites.`);
  }

  return site;
}

export async function findSiteForCwd(cwd = process.cwd()): Promise<Site> {
  const sites = await discoverSites();
  const resolvedCwd = normalizePathForCompare(path.resolve(cwd));
  const site = sites.find((candidate) => {
    const projectRoot = normalizePathForCompare(path.resolve(candidate.path));
    return resolvedCwd === projectRoot || resolvedCwd.startsWith(`${projectRoot}${path.sep}`);
  });

  if (!site) {
    throw new Error(`Current directory is not inside a parked site: ${resolvedCwd}`);
  }

  return site;
}

export async function siteFromProject(projectPath: string, config: LaraboxsConfig): Promise<Site> {
  const name = path.basename(projectPath);
  const domain = `${slugify(name)}.${config.tld}`;
  const framework = await detectFramework(projectPath);
  const defaultEntryPath = defaultSiteEntryPath(framework);
  const entryPath = resolveConfiguredSiteEntryPath(projectPath, config.siteEntryPaths[domain] ?? defaultEntryPath, defaultEntryPath);
  const documentRoot = path.join(projectPath, entryPath);
  const secured = config.securedDomains.includes(domain);
  const phpVersion = config.isolatedPhp[domain] ?? config.globalPhpVersion;

  return {
    name,
    domain,
    url: `${secured ? "https" : "http"}://${domain}`,
    path: path.resolve(projectPath),
    documentRoot: path.resolve(documentRoot),
    entryPath,
    secured,
    phpVersion,
    framework
  };
}

export async function detectFramework(projectPath: string): Promise<Framework> {
  if (await fileExists(path.join(projectPath, "public", "index.php"))) {
    return "Laravel";
  }

  if (await fileExists(path.join(projectPath, "index.php"))) {
    return "PHP";
  }

  return "Static";
}

export function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "site";
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}

function ensureKnownPhpVersion(config: LaraboxsConfig, version: string): void {
  if (!config.phpVersions.includes(version)) {
    config.phpVersions.push(version);
    config.phpVersions.sort();
  }
}

function defaultSiteEntryPath(framework: Framework): string {
  return framework === "Laravel" ? "public" : ".";
}

async function validateSiteEntryPath(projectPath: string, entryPath: string): Promise<string> {
  const normalizedEntry = normalizeSiteEntryPath(entryPath);
  const root = path.resolve(projectPath);
  const resolvedEntry = path.resolve(root, normalizedEntry);
  const relative = path.relative(root, resolvedEntry);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Nginx entry must be inside the site folder.");
  }

  try {
    const info = await stat(resolvedEntry);
    if (!info.isDirectory()) {
      throw new Error("Nginx entry must point to a directory.");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Nginx entry must point to a directory.") {
      throw error;
    }
    throw new Error(`Nginx entry folder does not exist: ${resolvedEntry}`);
  }

  return normalizedEntry;
}

function resolveConfiguredSiteEntryPath(projectPath: string, entryPath: string, fallback: string): string {
  try {
    const normalizedEntry = normalizeSiteEntryPath(entryPath);
    const root = path.resolve(projectPath);
    const resolvedEntry = path.resolve(root, normalizedEntry);
    const relative = path.relative(root, resolvedEntry);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !existsSync(resolvedEntry)) {
      return fallback;
    }
    return normalizedEntry;
  } catch {
    return fallback;
  }
}

function normalizeSiteEntryPath(entryPath: string): string {
  const trimmed = entryPath.trim();
  if (!trimmed || trimmed === ".") {
    return ".";
  }
  if (path.isAbsolute(trimmed)) {
    throw new Error("Nginx entry must be relative to the site folder.");
  }

  const normalized = path.normalize(trimmed).replace(/\\/g, "/").replace(/\/+$/g, "");
  if (!normalized || normalized === ".") {
    return ".";
  }
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Nginx entry must be inside the site folder.");
  }
  return normalized;
}

function normalizePathForCompare(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function assertDeletableSitePath(site: Site, config: LaraboxsConfig): string {
  const sitePath = path.resolve(site.path);
  const parent = path.dirname(sitePath);
  const parkedFolder = config.parkedFolders.find((folder) => normalizePathForCompare(path.resolve(folder)) === normalizePathForCompare(parent));

  if (!parkedFolder) {
    throw new Error(`Refusing to delete ${sitePath}. Site folders can only be deleted from a configured parked folder.`);
  }

  if (normalizePathForCompare(path.resolve(parkedFolder)) === normalizePathForCompare(sitePath)) {
    throw new Error(`Refusing to delete parked folder root: ${sitePath}`);
  }

  if (parkedFolderLooksLikeProjectRoot(parkedFolder)) {
    throw new Error(`Refusing to delete ${sitePath}. The parked folder itself looks like a project root; park its parent folder before deleting sites.`);
  }

  return sitePath;
}

function parkedFolderLooksLikeProjectRoot(parkedFolder: string): boolean {
  return [
    path.join(parkedFolder, "artisan"),
    path.join(parkedFolder, "composer.json"),
    path.join(parkedFolder, "index.php"),
    path.join(parkedFolder, "public", "index.php")
  ].some((filePath) => existsSync(filePath));
}

async function databaseNamesForSite(site: Site): Promise<Array<{ name: string; drop: boolean }>> {
  const names = new Set<string>();
  const skipped = new Set<string>();
  const env = await readSiteEnv(site);
  const connection = env.DB_CONNECTION?.trim().toLowerCase();

  if (!connection || connection === "mysql" || connection === "mariadb") {
    addDatabaseCandidate(env.DB_DATABASE, names, skipped);
  }

  return [
    ...Array.from(names).map((name) => ({ name, drop: true })),
    ...Array.from(skipped).map((name) => ({ name, drop: false }))
  ];
}

async function readSiteEnv(site: Site): Promise<Record<string, string>> {
  const envPath = path.join(site.path, ".env");
  const raw = await readFile(envPath, "utf8").catch(() => "");
  const values: Record<string, string> = {};

  for (const line of raw.replace(/\r\n/g, "\n").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) {
      continue;
    }
    values[match[1]] = unquoteEnvValue(match[2]);
  }

  return values;
}

function addDatabaseCandidate(value: string | undefined, names: Set<string>, skipped: Set<string>): void {
  const name = value?.trim();
  if (!name) {
    return;
  }

  if (!/^[A-Za-z0-9_]+$/.test(name) || systemDatabases.has(name)) {
    skipped.add(name);
    return;
  }

  names.add(name);
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return trimmed;
}

async function removeSiteArtifacts(site: Site): Promise<void> {
  const paths = getPaths();
  await Promise.all([
    rm(path.join(paths.certs, `${site.domain}.crt`), { force: true }),
    rm(path.join(paths.certs, `${site.domain}.key`), { force: true }),
    rm(path.join(paths.home, "previews", `${safePreviewName(site.domain)}.png`), { force: true })
  ]);
}

function safePreviewName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "") || "site";
}
