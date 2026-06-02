import { mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfig, updateConfig } from "./config.js";
import type { Framework, LaraboxsConfig, Site } from "./types.js";

export async function addParkedFolder(folder: string): Promise<LaraboxsConfig> {
  const resolved = path.resolve(folder);
  await mkdir(resolved, { recursive: true });

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
  const documentRoot = framework === "Laravel" ? path.join(projectPath, "public") : projectPath;
  const secured = config.securedDomains.includes(domain);
  const phpVersion = config.isolatedPhp[domain] ?? config.globalPhpVersion;

  return {
    name,
    domain,
    url: `${secured ? "https" : "http"}://${domain}`,
    path: path.resolve(projectPath),
    documentRoot: path.resolve(documentRoot),
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

function normalizePathForCompare(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}
