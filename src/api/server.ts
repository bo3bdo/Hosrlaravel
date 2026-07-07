import http from "node:http";
import { ensureDeveloperCommandPath } from "../core/runtimes.js";
import { startConfiguredServicesOnLaunch } from "../core/startup.js";
import { host, port, sendError } from "./context.js";
import { ApiHttpError, apiSecurityHeaders, assertTrustedApiRequest, corsOrigin } from "./httpSecurity.js";
import { Router } from "./router.js";
import { apiRoutes } from "./routes/index.js";
import { serveBuiltUi } from "./routes/static.js";
import { attachServer, registerShutdownTask, setupGracefulShutdown } from "./shutdown.js";

export { registerShutdownTask };

const router = new Router().addAll(apiRoutes);

const server = http.createServer(async (request, response) => {
  for (const [name, value] of Object.entries(apiSecurityHeaders())) {
    response.setHeader(name, value);
  }
  response.setHeader("Access-Control-Allow-Origin", corsOrigin(request.headers.origin, port));
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Laraboxs-Token");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);

    if (url.pathname.startsWith("/api/")) {
      assertTrustedApiRequest(request, port);
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const ctx = { request, response, url };

    if (await router.dispatch(ctx)) {
      return;
    }

    if (await serveBuiltUi(ctx)) {
      return;
    }

    sendError(response, new ApiHttpError(404, "Not found"));
  } catch (error) {
    sendError(response, error);
  }
});

attachServer(server);

server.listen(port, host, () => {
  console.log(`laraboxs helper API listening on http://${host}:${port}`);
  void ensureDeveloperCommandPath();
  void startConfiguredServicesOnLaunch();
});

setupGracefulShutdown();
