import { databaseRoutes } from "./databases.js";
import { defenderRoutes } from "./defender.js";
import { dialogRoutes } from "./dialogs.js";
import { healthRoutes } from "./health.js";
import { runtimeRoutes } from "./runtimes.js";
import { serviceRoutes } from "./services.js";
import { setupRoutes } from "./setup.js";
import { siteRoutes } from "./sites.js";
import { sslRoutes } from "./ssl.js";
import { summaryRoutes } from "./summary.js";
import type { RouteDefinition } from "../router.js";

export const apiRoutes: RouteDefinition[] = [
  ...healthRoutes,
  ...summaryRoutes,
  ...setupRoutes,
  ...siteRoutes,
  ...serviceRoutes,
  ...databaseRoutes,
  ...runtimeRoutes,
  ...sslRoutes,
  ...defenderRoutes,
  ...dialogRoutes
];
