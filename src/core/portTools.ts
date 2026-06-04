import { loadConfig } from "./config.js";
import { getMysqlStatus } from "./mysql.js";
import { getNginxStatus } from "./nginx.js";
import { phpFastCgiPort, getPhpFastCgiStatus } from "./php.js";
import { checkPortConflict, findAvailablePort } from "./ports.js";
import { getRedisStatus } from "./redis.js";
import type { PortCheckResult } from "./types.js";

interface PortTarget {
  id: string;
  label: string;
  service: PortCheckResult["service"];
  port: number;
  expectedRunning: boolean;
}

export async function checkLaraboxsPorts(): Promise<PortCheckResult[]> {
  const config = await loadConfig();
  const [nginx, mysql, redis, php] = await Promise.all([getNginxStatus(), getMysqlStatus(), getRedisStatus(), getPhpFastCgiStatus()]);
  const targets: PortTarget[] = [
    {
      id: "nginx-http",
      label: "Nginx HTTP",
      service: "nginx",
      port: config.nginx.httpPort,
      expectedRunning: nginx.state === "running"
    },
    {
      id: "nginx-https",
      label: "Nginx HTTPS",
      service: "nginx",
      port: config.nginx.httpsPort,
      expectedRunning: nginx.state === "running"
    },
    {
      id: "mysql",
      label: "Database",
      service: "mysql",
      port: config.mysql.port,
      expectedRunning: mysql.state === "running"
    },
    {
      id: "redis",
      label: "Redis",
      service: "redis",
      port: config.redis.port,
      expectedRunning: redis.state === "running"
    },
    ...config.phpVersions.map((version) => ({
      id: `php-${version}`,
      label: `PHP ${version} FastCGI`,
      service: "php" as const,
      port: phpFastCgiPort(version),
      expectedRunning: php.state === "running" || php.state === "unknown"
    }))
  ];

  return Promise.all(targets.map(checkTarget));
}

async function checkTarget(target: PortTarget): Promise<PortCheckResult> {
  const conflict = await checkPortConflict(target.port);
  const status = conflict.inUse ? (target.expectedRunning ? "ok" : "conflict") : "free";
  const suggestedPort = status === "conflict" ? await findAvailablePort("127.0.0.1", target.port + 1, target.port + 100).catch(() => undefined) : undefined;
  return {
    id: target.id,
    label: target.label,
    service: target.service,
    port: target.port,
    status,
    inUse: conflict.inUse,
    expected: target.expectedRunning,
    processName: conflict.processName,
    pid: conflict.pid,
    suggestedPort,
    message: portMessage(target, conflict.inUse, status, conflict.processName, suggestedPort)
  };
}

function portMessage(target: PortTarget, inUse: boolean, status: PortCheckResult["status"], processName?: string, suggestedPort?: number): string {
  if (status === "ok") {
    return `${target.label} is accepting connections on ${target.port}.`;
  }
  if (!inUse) {
    return `${target.port} is free.`;
  }
  const occupant = processName ? ` by ${processName}` : "";
  const suggestion = suggestedPort ? ` Suggested port: ${suggestedPort}.` : "";
  return `${target.port} is already in use${occupant}.${suggestion}`;
}

