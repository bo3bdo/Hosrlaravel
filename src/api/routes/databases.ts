import {
  createManagedDatabase,
  dropManagedDatabase,
  exportDatabase,
  importDatabase,
  listDatabases,
  listDatabaseTables
} from "../../core/databaseManager.js";
import { assertString, readJson, sendJson } from "../context.js";
import type { RouteDefinition } from "../router.js";

export const databaseRoutes: RouteDefinition[] = [
  {
    method: "GET",
    pattern: "/api/databases",
    handler: async ({ response }) => {
      await sendJson(response, { databases: await listDatabases() });
    }
  },
  {
    method: "GET",
    pattern: "/api/databases/tables",
    handler: async ({ url, response }) => {
      const database = assertString(url.searchParams.get("database"), "database");
      await sendJson(response, { tables: await listDatabaseTables(database) });
    }
  },
  {
    method: "POST",
    pattern: "/api/databases/create",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      await sendJson(response, { ok: true, database: await createManagedDatabase(assertString(body.name, "name")) });
    }
  },
  {
    method: "POST",
    pattern: "/api/databases/drop",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      await dropManagedDatabase(assertString(body.name, "name"));
      await sendJson(response, { ok: true });
    }
  },
  {
    method: "POST",
    pattern: "/api/databases/export",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      await sendJson(response, { ok: true, export: await exportDatabase(assertString(body.name, "name")) });
    }
  },
  {
    method: "POST",
    pattern: "/api/databases/import",
    handler: async ({ request, response }) => {
      const body = await readJson(request);
      await importDatabase(assertString(body.name, "name"), assertString(body.path, "path"));
      await sendJson(response, { ok: true });
    }
  }
];
