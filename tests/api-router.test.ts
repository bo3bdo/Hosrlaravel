import { describe, expect, it } from "vitest";
import type { ApiContext } from "../src/api/context.js";
import { Router } from "../src/api/router.js";

describe("API router", () => {
  it("matches exact paths and extracts params", async () => {
    const router = new Router()
      .add({
        method: "GET",
        pattern: "/api/health",
        handler: async ({ response }) => {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: true }));
        }
      })
      .add({
        method: "GET",
        pattern: "/api/runtimes/jobs/:id",
        handler: async ({ response }, params) => {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ id: params.id }));
        }
      });

    const healthResponse = createMockResponse();
    const healthCtx = createMockContext("GET", "/api/health", healthResponse);
    expect(await router.dispatch(healthCtx)).toBe(true);
    expect(healthResponse.statusCode).toBe(200);
    expect(JSON.parse(healthResponse.body)).toEqual({ ok: true });

    const jobResponse = createMockResponse();
    const jobCtx = createMockContext("GET", "/api/runtimes/jobs/job-123", jobResponse);
    expect(await router.dispatch(jobCtx)).toBe(true);
    expect(JSON.parse(jobResponse.body)).toEqual({ id: "job-123" });

    const missingResponse = createMockResponse();
    const missingCtx = createMockContext("GET", "/api/missing", missingResponse);
    expect(await router.dispatch(missingCtx)).toBe(false);
  });

  it("prefers first matching route in registration order", async () => {
    const router = new Router()
      .add({
        method: "POST",
        pattern: "/api/nginx/settings",
        handler: async ({ response }) => {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ route: "settings" }));
        }
      })
      .add({
        method: "POST",
        pattern: "/api/nginx/:action",
        handler: async ({ response }, params) => {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ route: "action", action: params.action }));
        }
      });

    const response = createMockResponse();
    const ctx = createMockContext("POST", "/api/nginx/settings", response);
    expect(await router.dispatch(ctx)).toBe(true);
    expect(JSON.parse(response.body)).toEqual({ route: "settings" });
  });
});

function createMockContext(method: string, pathname: string, response: MockResponse): ApiContext {
  return {
    request: { method, headers: {}, on: () => undefined } as ApiContext["request"],
    response: response as unknown as ApiContext["response"],
    url: new URL(`http://127.0.0.1:47899${pathname}`)
  };
}

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
