import { clearLogs } from "../../core/logging.js";
import { checkLaraboxsPorts } from "../../core/portTools.js";
import { getDashboardSummary } from "../../core/summary.js";
import { getStartupStatus, updateStartupSettings } from "../../core/startup.js";
import { getUpdateCenterStatus } from "../../core/updateCenter.js";
import { assertStartupSettings, readJson, sendJson } from "../context.js";
import type { RouteDefinition } from "../router.js";

const summaryEventIntervalMs = 2000;

export const summaryRoutes: RouteDefinition[] = [
  {
    method: "GET",
    pattern: "/api/summary",
    handler: async ({ response }) => {
      await sendJson(response, await getDashboardSummary());
    }
  },
  {
    method: "GET",
    pattern: "/api/updates",
    handler: async ({ response }) => {
      await sendJson(response, await getUpdateCenterStatus());
    }
  },
  {
    method: "GET",
    pattern: "/api/ports/check",
    handler: async ({ response }) => {
      await sendJson(response, { ports: await checkLaraboxsPorts() });
    }
  },
  {
    method: "GET",
    pattern: "/api/startup",
    handler: async ({ response }) => {
      await sendJson(response, await getStartupStatus());
    }
  },
  {
    method: "POST",
    pattern: "/api/startup",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      const status = await updateStartupSettings(assertStartupSettings(body));
      await sendJson(response, { ok: true, status, summary: await getDashboardSummary() });
    }
  },
  {
    method: "POST",
    pattern: "/api/logs/clear",
    handler: async ({ response }) => {
      const cleared = await clearLogs();
      await sendJson(response, { ok: true, cleared, summary: await getDashboardSummary() });
    }
  },
  {
    method: "GET",
    pattern: "/api/events",
    handler: async ({ request, response }) => {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      });
      response.write(": connected\n\n");

      let closed = false;
      const close = () => {
        closed = true;
      };
      request.on("close", close);
      request.on("aborted", close);

      const sendSummaryEvent = async () => {
        if (closed || response.writableEnded) {
          return;
        }
        try {
          const summary = await getDashboardSummary();
          response.write(`event: summary\ndata: ${JSON.stringify(summary)}\n\n`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          response.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
        }
      };

      await sendSummaryEvent();

      const interval = setInterval(() => {
        void sendSummaryEvent();
      }, summaryEventIntervalMs);

      request.on("close", () => {
        clearInterval(interval);
      });
    }
  }
];
