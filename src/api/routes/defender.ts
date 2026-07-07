import { tryEnsureWindowsDefenderExclusion } from "../../core/defender.js";
import { assertString, readJson, sendJson } from "../context.js";
import type { RouteDefinition } from "../router.js";

export const defenderRoutes: RouteDefinition[] = [
  {
    method: "POST",
    pattern: "/api/defender/exclude",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      const targetPath = assertString(body.path, "path");
      const status = await tryEnsureWindowsDefenderExclusion(targetPath);
      await sendJson(response, { ok: status.excluded, status });
    }
  }
];
