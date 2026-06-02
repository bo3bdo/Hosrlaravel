import { loadConfig } from "./config.js";
import { readRecentLogs } from "./logging.js";
import { getMysqlStatus } from "./mysql.js";
import { getNginxStatus } from "./nginx.js";
import { getPaths } from "./paths.js";
import { discoverSites } from "./sites.js";
import type { DashboardSummary } from "./types.js";

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const config = await loadConfig();
  const sites = await discoverSites(config);
  const mysql = await getMysqlStatus();

  return {
    config,
    paths: getPaths(),
    sites,
    services: {
      nginx: getNginxStatus(),
      mysql,
      php: {
        name: "php",
        state: "unknown",
        version: config.globalPhpVersion,
        message: "PHP FastCGI workers are configured per version; process supervision is part of the helper-service phase."
      }
    },
    logs: await readRecentLogs()
  };
}
