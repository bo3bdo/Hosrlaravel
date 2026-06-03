import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import type { TLSSocket } from "node:tls";
import { mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNewSite } from "../src/core/laravelInstaller.js";
import { writeNginxConfigs } from "../src/core/nginx.js";
import { getPaths } from "../src/core/paths.js";
import { secureSite, unsecureSite } from "../src/core/ssl.js";
import { discoverSites } from "../src/core/sites.js";

describe("new site opening", () => {
  const servers: Array<http.Server | https.Server> = [];

  beforeEach(async () => {
    process.env.LARABOXS_HOME = await mkdir(path.join(os.tmpdir(), `laraboxs-site-open-${Date.now()}-`), { recursive: true });
    process.env.LARABOXS_SKIP_CA_TRUST = "1";
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(closeServer));
  });

  it("creates a site that opens without SSL and then with its own SSL certificate", async () => {
    const parked = path.join(process.env.LARABOXS_HOME ?? "", "www");
    const result = await createNewSite({ name: "Open Check", preset: "static", parentPath: parked });

    await writeNginxConfigs();
    expect(result.site.domain).toBe("open-check.test");
    expect(result.site.url).toBe("http://open-check.test");

    const httpServer = http.createServer(serveIndex(result.site.documentRoot));
    servers.push(httpServer);
    const httpPort = await listen(httpServer);
    await expect(requestHttp(result.site.domain, httpPort)).resolves.toContain("Laraboxs Site");

    await secureSite(result.site.domain);
    await writeNginxConfigs();

    const securedSite = (await discoverSites()).find((site) => site.domain === result.site.domain);
    expect(securedSite?.url).toBe("https://open-check.test");

    const cert = await readFile(path.join(getPaths().certs, `${result.site.domain}.crt`), "utf8");
    const key = await readFile(path.join(getPaths().certs, `${result.site.domain}.key`), "utf8");
    const httpsServer = https.createServer({ cert, key }, serveIndex(result.site.documentRoot));
    servers.push(httpsServer);
    const httpsPort = await listen(httpsServer);
    const httpsResult = await requestHttps(result.site.domain, httpsPort);

    expect(httpsResult.body).toContain("Laraboxs Site");
    expect(httpsResult.certificateCommonName).toBe("open-check.test");

    await unsecureSite(result.site.domain);
    await writeNginxConfigs();

    const unsecuredSite = (await discoverSites()).find((site) => site.domain === result.site.domain);
    expect(unsecuredSite?.url).toBe("http://open-check.test");
  });
});

function serveIndex(documentRoot: string): http.RequestListener {
  return async (_request, response) => {
    const body = await readFile(path.join(documentRoot, "index.html"), "utf8");
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(body);
  };
}

function listen(server: http.Server | https.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function closeServer(server: http.Server | https.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function requestHttp(domain: string, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/",
        headers: { Host: domain }
      },
      (response) => collectBody(response, resolve, reject)
    );

    request.once("error", reject);
    request.end();
  });
}

function requestHttps(domain: string, port: number): Promise<{ body: string; certificateCommonName?: string }> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/",
        servername: domain,
        rejectUnauthorized: false,
        headers: { Host: domain }
      },
      (response) => {
        const certificate = (response.socket as TLSSocket).getPeerCertificate();
        collectBody(response, (body) => resolve({ body, certificateCommonName: certificate?.subject?.CN }), reject);
      }
    );

    request.once("error", reject);
    request.end();
  });
}

function collectBody(response: http.IncomingMessage, resolve: (body: string) => void, reject: (error: Error) => void): void {
  const chunks: Buffer[] = [];
  response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  response.once("error", reject);
  response.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
}
