import { loadConfig } from "./config.js";
import { readRecentLogs } from "./logging.js";
import { getMongoDbStatus } from "./mongodb.js";
import { getMysqlStatus } from "./mysql.js";
import { getNginxStatus } from "./nginx.js";
import { getPaths, mongodbDataForVersion, mongodbRootForVersion, mysqlDataForVersion, mysqlRootForVersion, redisDataForVersion, redisRootForVersion } from "./paths.js";
import { getPhpFastCgiStatus } from "./php.js";
import { getPhpMyAdminStatus } from "./phpmyadmin.js";
import { getRedisStatus } from "./redis.js";
import { getRuntimeStatus } from "./runtimes.js";
import { discoverSites } from "./sites.js";
import { getLocalCaStatus } from "./ssl.js";
import type { DashboardSummary } from "./types.js";

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const config = await loadConfig();
  const sites = await discoverSites(config);
  const mysql = await getMysqlStatus();
  const php = await getPhpFastCgiStatus();
  const redis = await getRedisStatus();
  const mongodb = await getMongoDbStatus();

  return {
    config,
    paths: activeSummaryPaths(config),
    sites,
    services: {
      nginx: { ...getNginxStatus(), port: config.nginx.httpPort },
      mysql,
      redis,
      mongodb,
      php
    },
    runtimes: getRuntimeStatus(),
    phpMyAdmin: getPhpMyAdminStatus(),
    ssl: await getLocalCaStatus(),
    logs: await readRecentLogs()
  };
}

function activeSummaryPaths(config: DashboardSummary["config"]): DashboardSummary["paths"] {
  const paths = getPaths();
  return {
    ...paths,
    mysqlRoot: mysqlRootForVersion(config.mysql.version),
    mysqlData: mysqlDataForVersion(config.mysql.version),
    redisRoot: redisRootForVersion(config.redis.version),
    redisData: redisDataForVersion(config.redis.version),
    mongodbRoot: mongodbRootForVersion(config.mongodb.version),
    mongodbData: mongodbDataForVersion(config.mongodb.version)
  };
}
