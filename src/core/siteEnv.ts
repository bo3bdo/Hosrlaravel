import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";
import { updateDotEnvFile } from "./envFile.js";
import { runCreateDatabase } from "./mysql.js";
import { findSite, slugify } from "./sites.js";
import { getMysqlRootPassword } from "./mysql.js";
import type { Site, SiteDatabaseInfo, SiteEnvApplyResult, SiteEnvProfile, SiteEnvProfileKind } from "./types.js";

export async function siteEnvProfiles(identifier: string): Promise<{ site: Site; envPath: string; profiles: SiteEnvProfile[] }> {
  const site = await findSite(identifier);
  const envPath = path.join(site.path, ".env");
  return {
    site,
    envPath,
    profiles: await buildSiteEnvProfiles(site)
  };
}

export async function siteDatabaseInfo(identifier: string): Promise<SiteDatabaseInfo> {
  const site = await findSite(identifier);
  const envPath = path.join(site.path, ".env");
  const env = await readEnvFile(envPath);
  const connection = env.DB_CONNECTION?.trim().toLowerCase();
  const database = env.DB_DATABASE?.trim();
  const suggestedDatabase = siteDatabaseName(site);

  if (!database) {
    return {
      site,
      envPath,
      connection,
      configured: false,
      supported: true,
      suggestedDatabase,
      message: ".env does not define DB_DATABASE yet."
    };
  }

  if (connection && connection !== "mysql" && connection !== "mariadb") {
    return {
      site,
      envPath,
      database,
      connection,
      configured: true,
      supported: false,
      suggestedDatabase,
      message: `DB_CONNECTION is ${connection}; local SQL import/export is available for MySQL and MariaDB sites.`
    };
  }

  if (!isManagedDatabaseName(database)) {
    return {
      site,
      envPath,
      database,
      connection,
      configured: true,
      supported: false,
      suggestedDatabase,
      message: "DB_DATABASE must contain only letters, numbers, and underscores to manage it here."
    };
  }

  return {
    site,
    envPath,
    database,
    connection,
    configured: true,
    supported: true,
    suggestedDatabase
  };
}

export async function applySiteEnvProfile(
  identifier: string,
  profileId: SiteEnvProfileKind,
  options: { createDatabase?: boolean } = {}
): Promise<SiteEnvApplyResult> {
  const site = await findSite(identifier);
  const profile = (await buildSiteEnvProfiles(site)).find((item) => item.id === profileId);
  if (!profile) {
    throw new Error(`Unsupported .env profile: ${profileId}`);
  }

  const envPath = path.join(site.path, ".env");
  await updateDotEnvFile(envPath, profile.values);

  let createdDatabase: string | undefined;
  let databaseError: string | undefined;
  if (options.createDatabase && profile.values.DB_DATABASE) {
    try {
      await runCreateDatabase(profile.values.DB_DATABASE);
      createdDatabase = profile.values.DB_DATABASE;
    } catch (error) {
      databaseError = error instanceof Error ? error.message : String(error);
    }
  }

  return { site, envPath, profile, createdDatabase, databaseError };
}

async function buildSiteEnvProfiles(site: Site): Promise<SiteEnvProfile[]> {
  const config = await loadConfig();
  const databaseName = siteDatabaseName(site);
  const mysqlPassword = await getMysqlRootPassword();
  const appValues = {
    APP_URL: site.url
  };
  const databaseValues = {
    DB_CONNECTION: databaseConnection(config.mysql.version),
    DB_HOST: "127.0.0.1",
    DB_PORT: String(config.mysql.port),
    DB_DATABASE: databaseName,
    DB_USERNAME: config.mysql.rootUser,
    DB_PASSWORD: mysqlPassword
  };
  const redisValues = {
    REDIS_CLIENT: "phpredis",
    REDIS_HOST: "127.0.0.1",
    REDIS_PASSWORD: "null",
    REDIS_PORT: String(config.redis.port)
  };
  const queueValues = {
    QUEUE_CONNECTION: "redis",
    CACHE_STORE: "redis",
    SESSION_DRIVER: "redis"
  };

  return [
    profile("app", "App URL", "Set APP_URL to the local laraboxs domain.", appValues),
    profile("database", "Database", "Use the active local MySQL/MariaDB credentials.", databaseValues),
    profile("redis", "Redis", "Use the local Redis service.", redisValues),
    profile("queue-redis", "Queue + Redis", "Use Redis for queues, cache, and sessions.", { ...redisValues, ...queueValues }),
    profile("full", "Full Local Stack", "Apply APP_URL, database, Redis, queue, cache, and sessions.", {
      ...appValues,
      ...databaseValues,
      ...redisValues,
      ...queueValues
    })
  ];
}

function profile(id: SiteEnvProfileKind, label: string, detail: string, values: Record<string, string>): SiteEnvProfile {
  return {
    id,
    label,
    detail,
    values,
    block: Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")
  };
}

function databaseConnection(version: string): string {
  return version.toLowerCase().startsWith("mariadb-") ? "mariadb" : "mysql";
}

function siteDatabaseName(site: Site): string {
  return slugify(site.name).replace(/-/g, "_");
}

async function readEnvFile(envPath: string): Promise<Record<string, string>> {
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

function isManagedDatabaseName(value: string): boolean {
  return /^[A-Za-z0-9_]+$/.test(value) && !["information_schema", "mysql", "performance_schema", "sys"].includes(value);
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return trimmed;
}
