import { beforeEach, describe, expect, it } from "vitest";
import { ApiHttpError, assertTrustedApiRequest, corsOrigin, isTrustedHost, isTrustedOrigin } from "../src/api/httpSecurity.js";

describe("helper API request security", () => {
  beforeEach(() => {
    delete process.env.LARABOXS_HELPER_TOKEN;
  });

  it("allows only local development and desktop origins", () => {
    expect(isTrustedOrigin("http://127.0.0.1:5173", 47899)).toBe(true);
    expect(isTrustedOrigin("http://localhost:47899", 47899)).toBe(true);
    expect(isTrustedOrigin("tauri://localhost", 47899)).toBe(true);
    expect(isTrustedOrigin("http://tauri.localhost", 47899)).toBe(true);
    expect(isTrustedOrigin("https://example.com", 47899)).toBe(false);
    expect(isTrustedOrigin("null", 47899)).toBe(false);
  });

  it("keeps CORS fallback local when an origin is missing or blocked", () => {
    expect(corsOrigin(undefined, 47899)).toBe("http://127.0.0.1:5173");
    expect(corsOrigin("https://example.com", 47899)).toBe("http://127.0.0.1:5173");
    expect(corsOrigin("http://127.0.0.1:47899", 47899)).toBe("http://127.0.0.1:47899");
  });

  it("rejects requests from untrusted host or origin headers", () => {
    expect(isTrustedHost("127.0.0.1:47899", 47899)).toBe(true);
    expect(isTrustedHost("localhost:5173", 47899)).toBe(true);
    expect(isTrustedHost("example.com:47899", 47899)).toBe(false);

    expect(() =>
      assertTrustedApiRequest(
        requestWithHeaders({ host: "127.0.0.1:47899", origin: "https://example.com" }),
        47899
      )
    ).toThrow(ApiHttpError);

    expect(() =>
      assertTrustedApiRequest(
        requestWithHeaders({ host: "example.com:47899", origin: "http://127.0.0.1:5173" }),
        47899
      )
    ).toThrow(ApiHttpError);
  });

  it("can enforce an optional helper token", () => {
    process.env.LARABOXS_HELPER_TOKEN = "local-secret";

    expect(() => assertTrustedApiRequest(requestWithHeaders({ host: "127.0.0.1:47899", origin: "http://127.0.0.1:5173" }), 47899)).toThrow(ApiHttpError);

    expect(() =>
      assertTrustedApiRequest(
        requestWithHeaders({
          host: "127.0.0.1:47899",
          origin: "http://127.0.0.1:5173",
          "x-laraboxs-token": "local-secret"
        }),
        47899
      )
    ).not.toThrow();
  });
});

function requestWithHeaders(headers: Record<string, string>) {
  return { headers } as Parameters<typeof assertTrustedApiRequest>[0];
}
