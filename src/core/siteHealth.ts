import http from "node:http";
import https from "node:https";
import { findSite } from "./sites.js";

export interface SiteHealthStatus {
  domain: string;
  url: string;
  state: "ok" | "error";
  statusCode?: number;
  statusMessage?: string;
  message: string;
  responseTimeMs: number;
  checkedAt: string;
}

export async function checkSiteHealth(identifier: string): Promise<SiteHealthStatus> {
  const site = await findSite(identifier);
  const startedAt = Date.now();

  try {
    const response = await requestSite(site.url);
    const responseTimeMs = Date.now() - startedAt;
    const ok = response.statusCode < 500;
    return {
      domain: site.domain,
      url: site.url,
      state: ok ? "ok" : "error",
      statusCode: response.statusCode,
      statusMessage: response.statusMessage,
      message: ok ? `Responded with HTTP ${response.statusCode}.` : `Site returned HTTP ${response.statusCode}.`,
      responseTimeMs,
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      domain: site.domain,
      url: site.url,
      state: "error",
      message: error instanceof Error ? error.message : String(error),
      responseTimeMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString()
    };
  }
}

function requestSite(url: string): Promise<{ statusCode: number; statusMessage?: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === "https:" ? https : http;
    const request = client.request(
      target,
      {
        method: "GET",
        timeout: 5000,
        rejectUnauthorized: false,
        headers: {
          "User-Agent": "laraboxs-health-check"
        }
      },
      (response) => {
        response.resume();
        response.once("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            statusMessage: response.statusMessage
          });
        });
      }
    );

    request.once("timeout", () => {
      request.destroy(new Error("Site health check timed out."));
    });
    request.once("error", reject);
    request.end();
  });
}
