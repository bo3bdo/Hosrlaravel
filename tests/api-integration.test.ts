import { describe, expect, it } from "vitest";
import { Router } from "../src/api/router.js";
import { apiRoutes } from "../src/api/routes/index.js";

describe("API route registry", () => {
  const router = new Router().addAll(apiRoutes);

  it("registers health and summary endpoints", async () => {
    const patterns = apiRoutes.map((route) => `${route.method} ${route.pattern}`);
    expect(patterns).toContain("GET /api/health");
    expect(patterns).toContain("GET /api/summary");
    expect(patterns).toContain("GET /api/events");
    expect(patterns).toContain("GET /api/updates");
  });

  it("serves /api/health through the router", async () => {
    const response = createMockResponse();
    const ctx = {
      request: { method: "GET", headers: {}, on: () => undefined } as Parameters<Router["dispatch"]>[0]["request"],
      response: response as unknown as Parameters<Router["dispatch"]>[0]["response"],
      url: new URL("http://127.0.0.1:47899/api/health")
    };

    expect(await router.dispatch(ctx)).toBe(true);
    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.body) as { ok: boolean; name: string };
    expect(payload.ok).toBe(true);
    expect(payload.name).toBe("laraboxs-helper");
  });
});

type MockResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  writeHead: (statusCode: number, headers?: Record<string, string>) => void;
  write: (chunk: string) => void;
  end: (chunk?: string) => void;
};

function createMockResponse(): MockResponse {
  const response: MockResponse = {
    statusCode: 200,
    headers: {},
    body: "",
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    write(chunk) {
      this.body += chunk;
    },
    end(chunk) {
      if (chunk) {
        this.body += chunk;
      }
    }
  };
  return response;
}
