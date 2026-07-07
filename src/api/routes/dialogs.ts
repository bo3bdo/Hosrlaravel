import { selectFile, selectFolder, sqlFileDialogOptions } from "../dialogs.js";
import { readJson, sendJson } from "../context.js";
import type { RouteDefinition } from "../router.js";

export const dialogRoutes: RouteDefinition[] = [
  {
    method: "POST",
    pattern: "/api/dialog/folder",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      if (body.probe === true) {
        await sendJson(response, { ok: true, available: true });
        return;
      }
      const selectedPath = await selectFolder({ initialPath: typeof body.initialPath === "string" ? body.initialPath : undefined });
      await sendJson(response, { ok: true, path: selectedPath });
    }
  },
  {
    method: "POST",
    pattern: "/api/dialogs/folder",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      if (body.probe === true) {
        await sendJson(response, { ok: true, available: true });
        return;
      }
      const selectedPath = await selectFolder({ initialPath: typeof body.initialPath === "string" ? body.initialPath : undefined });
      await sendJson(response, { ok: true, path: selectedPath });
    }
  },
  {
    method: "POST",
    pattern: "/api/dialog/sql-file",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      if (body.probe === true) {
        await sendJson(response, { ok: true, available: true });
        return;
      }
      const selectedPath = await selectFile(sqlFileDialogOptions(typeof body.initialPath === "string" ? body.initialPath : undefined));
      await sendJson(response, { ok: true, path: selectedPath });
    }
  },
  {
    method: "POST",
    pattern: "/api/dialogs/sql-file",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      if (body.probe === true) {
        await sendJson(response, { ok: true, available: true });
        return;
      }
      const selectedPath = await selectFile(sqlFileDialogOptions(typeof body.initialPath === "string" ? body.initialPath : undefined));
      await sendJson(response, { ok: true, path: selectedPath });
    }
  }
];
