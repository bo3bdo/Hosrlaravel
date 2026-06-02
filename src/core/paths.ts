import os from "node:os";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { LaraboxsPaths } from "./types.js";

export function laraboxsHome(): string {
  if (process.env.LARABOXS_HOME) {
    return path.resolve(process.env.LARABOXS_HOME);
  }

  const userHome = process.env.USERPROFILE || os.homedir();
  return path.join(userHome, ".config", "laraboxs");
}

export function hostsFilePath(): string {
  if (process.env.LARABOXS_HOSTS_FILE) {
    return path.resolve(process.env.LARABOXS_HOSTS_FILE);
  }

  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    return path.join(systemRoot, "System32", "drivers", "etc", "hosts");
  }

  return "/etc/hosts";
}

export function getPaths(): LaraboxsPaths {
  const home = laraboxsHome();
  const nginxRoot = path.join(home, "services", "nginx");
  const mysqlRoot = mysqlRootForVersion("9.7");
  const redisRoot = redisRootForVersion("8.8");
  const mongodbRoot = mongodbRootForVersion("8.2");

  return {
    home,
    configFile: path.join(home, "config.json"),
    logs: path.join(home, "logs"),
    nginxRoot,
    nginxConfig: path.join(nginxRoot, "conf", "nginx.conf"),
    nginxSites: path.join(nginxRoot, "conf", "sites-enabled"),
    mysqlRoot,
    mysqlData: mysqlDataForVersion("9.7"),
    redisRoot,
    redisData: redisDataForVersion("8.8"),
    mongodbRoot,
    mongodbData: mongodbDataForVersion("8.2"),
    phpRoot: path.join(home, "runtimes", "php"),
    certs: path.join(home, "certs"),
    hostsFile: hostsFilePath()
  };
}

export function mysqlRootForVersion(version: string): string {
  return path.join(laraboxsHome(), "services", "mysql", version);
}

export function mysqlDataForVersion(version: string): string {
  return path.join(mysqlRootForVersion(version), "data");
}

export function redisRootForVersion(version: string): string {
  return path.join(laraboxsHome(), "services", "redis", version);
}

export function redisDataForVersion(version: string): string {
  return path.join(redisRootForVersion(version), "data");
}

export function mongodbRootForVersion(version: string): string {
  return path.join(laraboxsHome(), "services", "mongodb", version);
}

export function mongodbDataForVersion(version: string): string {
  return path.join(mongodbRootForVersion(version), "data", "db");
}

export async function ensureBaseDirs(): Promise<LaraboxsPaths> {
  const paths = getPaths();
  await Promise.all([
    mkdir(paths.home, { recursive: true }),
    mkdir(paths.logs, { recursive: true }),
    mkdir(path.dirname(paths.nginxConfig), { recursive: true }),
    mkdir(paths.nginxSites, { recursive: true }),
    mkdir(paths.mysqlData, { recursive: true }),
    mkdir(paths.redisData, { recursive: true }),
    mkdir(paths.mongodbData, { recursive: true }),
    mkdir(paths.phpRoot, { recursive: true }),
    mkdir(paths.certs, { recursive: true })
  ]);
  return paths;
}

export function toNginxPath(filePath: string): string {
  return path.resolve(filePath).replace(/\\/g, "/");
}
