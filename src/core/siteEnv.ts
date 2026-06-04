import path from "node:path";
import { loadConfig } from "./config.js";
import { updateDotEnvFile } from "./envFile.js";
import { runCreateDatabase } from "./mysql.js";
import { findSite, slugify } from "./sites.js";
import { getMysqlRootPassword } from "./mysql.js";
import type { Site, SiteEnvApplyResult, SiteEnvProfile, SiteEnvProfileKind } from "./types.js";

export async function siteEnvProfiles(identifier: string): Promise<{ site: Site; envPath: string; profiles: SiteEnvProfile[] }> {
  const site = await findSite(identifier);
  const envPath = path.join(site.path, ".env");
  return {
    site,
    envPath,
    profiles: await buildSiteEnvProfiles(site)
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

  let createdDatabase: string | undefined;
  if (options.createDatabase && profile.values.DB_DATABASE) {
    await runCreateDatabase(profile.values.DB_DATABASE);
    createdDatabase = profile.values.DB_DATABASE;
  }

  const envPath = path.join(site.path, ".env");
  await updateDotEnvFile(envPath, profile.values);
  return { site, envPath, profile, createdDatabase };
}

async function buildSiteEnvProfiles(site: Site): Promise<SiteEnvProfile[]> {
  const config = await loadConfig();
  const databaseName = slugify(site.name).replace(/-/g, "_");
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

