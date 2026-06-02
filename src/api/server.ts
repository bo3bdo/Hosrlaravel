import http from "node:http";
import { spawn } from "node:child_process";
import { addParkedFolder, isolateSite, setGlobalPhpVersion, unisolateSite } from "../core/sites.js";
import { syncHostsFile } from "../core/hosts.js";
import { laravelEnv, mysqlShellCommand, runCreateDatabase, runMysql, setMysqlPort } from "../core/mysql.js";
import { runNginx, writeNginxConfigs } from "../core/nginx.js";
import { secureSite, unsecureSite } from "../core/ssl.js";
import { getDashboardSummary } from "../core/summary.js";
import type { ServiceAction } from "../core/types.js";

const host = "127.0.0.1";
const port = Number(process.env.LARABOXS_API_PORT ?? 47899);

const server = http.createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:5173");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);

    if (request.method === "GET" && url.pathname === "/api/summary") {
      await sendJson(response, await getDashboardSummary());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/sites/park") {
      const body = await readJson(request);
      await addParkedFolder(assertString(body.path, "path"));
      await writeNginxConfigs();
      await sendJson(response, { ok: true, summary: await getDashboardSummary() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/hosts/sync") {
      const body = await readJson(request);
      const next = await syncHostsFile({ dryRun: Boolean(body.dryRun) });
      await sendJson(response, { ok: true, hosts: next });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/php/use") {
      const body = await readJson(request);
      await setGlobalPhpVersion(assertString(body.version, "version"));
      await sendJson(response, { ok: true, summary: await getDashboardSummary() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/php/isolate") {
      const body = await readJson(request);
      await isolateSite(assertString(body.site, "site"), assertString(body.version, "version"));
      await sendJson(response, { ok: true, summary: await getDashboardSummary() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/php/unisolate") {
      const body = await readJson(request);
      await unisolateSite(assertString(body.site, "site"));
      await sendJson(response, { ok: true, summary: await getDashboardSummary() });
      return;
    }

    if (request.method === "POST" && url.pathname.startsWith("/api/nginx/")) {
      const action = serviceAction(url.pathname.split("/").at(-1));
      await sendJson(response, await runNginx(action));
      return;
    }

    if (request.method === "POST" && url.pathname.startsWith("/api/mysql/")) {
      const actionName = url.pathname.split("/").at(-1);

      if (actionName === "port") {
        const body = await readJson(request);
        await setMysqlPort(Number(body.port));
        await sendJson(response, { ok: true, summary: await getDashboardSummary() });
        return;
      }

      if (actionName === "create-db") {
        const body = await readJson(request);
        const status = await runCreateDatabase(assertString(body.name, "name"));
        await sendJson(response, { ok: true, status });
        return;
      }

      if (actionName === "shell") {
        const command = await mysqlShellCommand();
        spawn(command.command, command.args, { stdio: "inherit", shell: false });
        await sendJson(response, { ok: true });
        return;
      }

      if (actionName === "env") {
        const body = await readJson(request);
        await sendJson(response, { env: await laravelEnv(assertString(body.name, "name")) });
        return;
      }

      await sendJson(response, await runMysql(serviceAction(actionName)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/ssl/secure") {
      const body = await readJson(request);
      await secureSite(assertString(body.site, "site"));
      await writeNginxConfigs();
      await sendJson(response, { ok: true, summary: await getDashboardSummary() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/ssl/unsecure") {
      const body = await readJson(request);
      await unsecureSite(assertString(body.site, "site"));
      await writeNginxConfigs();
      await sendJson(response, { ok: true, summary: await getDashboardSummary() });
      return;
    }

    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Not found" }));
  } catch (error) {
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});

server.listen(port, host, () => {
  console.log(`laraboxs helper API listening on http://${host}:${port}`);
});

async function sendJson(response: http.ServerResponse, value: unknown): Promise<void> {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value, null, 2));
}

function readJson(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("error", reject);
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
    });
  });
}

function assertString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function serviceAction(value: string | undefined): ServiceAction {
  if (value === "start" || value === "stop" || value === "restart") {
    return value;
  }
  throw new Error(`Unsupported service action: ${value ?? ""}`);
}
