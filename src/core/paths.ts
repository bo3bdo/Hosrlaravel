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
  const mysqlRoot = path.join(home, "services", "mysql", "8.4");

  return {
    home,
    configFile: path.join(home, "config.json"),
    logs: path.join(home, "logs"),
    nginxRoot,
    nginxConfig: path.join(nginxRoot, "conf", "nginx.conf"),
    nginxSites: path.join(nginxRoot, "conf", "sites-enabled"),
    mysqlRoot,
    mysqlData: path.join(mysqlRoot, "data"),
    phpRoot: path.join(home, "runtimes", "php"),
    certs: path.join(home, "certs"),
    hostsFile: hostsFilePath()
  };
}

export async function ensureBaseDirs(): Promise<LaraboxsPaths> {
  const paths = getPaths();
  await Promise.all([
    mkdir(paths.home, { recursive: true }),
    mkdir(paths.logs, { recursive: true }),
    mkdir(path.dirname(paths.nginxConfig), { recursive: true }),
    mkdir(paths.nginxSites, { recursive: true }),
    mkdir(paths.mysqlData, { recursive: true }),
    mkdir(paths.phpRoot, { recursive: true }),
    mkdir(paths.certs, { recursive: true })
  ]);
  return paths;
}

export function toNginxPath(filePath: string): string {
  return path.resolve(filePath).replace(/\\/g, "/");
}
