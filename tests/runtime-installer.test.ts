import { createHash } from "node:crypto";
import { access, mkdtemp, readFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { downloadFile, partialDownloadPath } from "../src/core/runtimeInstaller.js";

describe("runtime installer downloads", () => {
  const servers: http.Server[] = [];
  let home = "";

  beforeEach(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), "laraboxs-downloads-"));
    process.env.LARABOXS_HOME = home;
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(closeServer));
  });

  it("retries transient HTTP failures and writes the final file atomically", async () => {
    const body = Buffer.from("runtime payload");
    let attempts = 0;
    const server = http.createServer((_request, response) => {
      attempts += 1;
      if (attempts === 1) {
        response.writeHead(503, { "Content-Type": "text/plain" });
        response.end("try again");
        return;
      }
      response.writeHead(200, { "Content-Length": String(body.byteLength) });
      response.end(body);
    });
    servers.push(server);
    const port = await listen(server);
    const destination = path.join(home, "downloads", "runtime.bin");

    await downloadFile(`http://127.0.0.1:${port}/runtime.bin`, destination, "test", {
      retries: 1,
      retryDelayMs: 1,
      checksumSha256: sha256(body)
    });

    expect(attempts).toBe(2);
    expect(await readFile(destination, "utf8")).toBe("runtime payload");
    await expect(access(partialDownloadPath(destination))).rejects.toThrow();
  });

  it("removes partial files when checksum verification fails", async () => {
    const body = Buffer.from("tampered payload");
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { "Content-Length": String(body.byteLength) });
      response.end(body);
    });
    servers.push(server);
    const port = await listen(server);
    const destination = path.join(home, "downloads", "runtime.bin");

    await expect(
      downloadFile(`http://127.0.0.1:${port}/runtime.bin`, destination, "test", {
        retries: 0,
        checksumSha256: "0".repeat(64)
      })
    ).rejects.toThrow(/Checksum mismatch/);

    await expect(access(destination)).rejects.toThrow();
    await expect(access(partialDownloadPath(destination))).rejects.toThrow();
  });
});

function sha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
