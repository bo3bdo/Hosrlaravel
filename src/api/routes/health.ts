import { builtUiRoot, projectRoot, sendJson } from "../context.js";
import { gracefulShutdown } from "../shutdown.js";
import type { RouteDefinition } from "../router.js";

export const healthRoutes: RouteDefinition[] = [
  {
    method: "GET",
    pattern: "/api/health",
    handler: async ({ response }) => {
      await sendJson(response, {
        ok: true,
        name: "laraboxs-helper",
        pid: process.pid,
        projectRoot,
        builtUiRoot
      });
    }
  },
  {
    method: "GET",
    pattern: "/api/health.txt",
    handler: async ({ response }) => {
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(["laraboxs-helper", projectRoot, String(process.pid)].join("\n"));
    }
  },
  {
    method: "POST",
    pattern: "/api/shutdown",
    handler: async ({ response }) => {
      await sendJson(response, { ok: true, message: "Shutdown requested." });
      setTimeout(() => void gracefulShutdown("API shutdown"), 50);
    }
  }
];
