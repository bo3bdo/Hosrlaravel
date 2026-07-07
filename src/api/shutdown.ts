import type http from "node:http";
import { runMysql } from "../core/mysql.js";
import { runNginx } from "../core/nginx.js";
import { runPhpFastCgi } from "../core/php.js";
import { runRedis } from "../core/redis.js";
import { stopAllSiteWorkers } from "./siteWorkers.js";

const shutdownTasks: Array<() => Promise<void> | void> = [];
let shuttingDown = false;
let server: http.Server | null = null;

export function registerShutdownTask(task: () => Promise<void> | void): void {
  shutdownTasks.push(task);
}

export function attachServer(httpServer: http.Server): void {
  server = httpServer;
}

export async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}. Stopping services...`);

  try {
    await stopAllSiteWorkers();
  } catch {
    // Ignore errors during shutdown.
  }

  try {
    console.log("Stopping Nginx...");
    await runNginx("stop");
  } catch {
    // Ignore errors during shutdown.
  }

  try {
    console.log("Stopping PHP FastCGI...");
    await runPhpFastCgi("stop");
  } catch {
    // Ignore errors during shutdown.
  }

  try {
    console.log("Stopping MySQL...");
    await runMysql("stop");
  } catch {
    // Ignore errors during shutdown.
  }

  try {
    console.log("Stopping Redis...");
    await runRedis("stop");
  } catch {
    // Ignore errors during shutdown.
  }

  await Promise.all(shutdownTasks.map(async (task) => { try { await task(); } catch { /* noop */ } }));

  if (!server) {
    process.exit(0);
    return;
  }

  server.closeAllConnections?.();
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("Forced exit after shutdown timeout.");
    process.exit(1);
  }, 8000);
}

export function setupGracefulShutdown(): void {
  process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
  process.on("exit", () => {
    console.log("laraboxs helper API exited.");
  });
}
