export type Framework = "Laravel" | "PHP" | "Static";
export type ServiceState = "running" | "stopped" | "unknown";
export type ServiceAction = "start" | "stop" | "restart";

export interface NginxConfig {
  httpPort: number;
  httpsPort: number;
  fastCgiHost: string;
}

export interface MysqlConfig {
  version: string;
  port: number;
  rootUser: string;
  instanceName: string;
}

export interface LaraboxsConfig {
  version: 1;
  tld: string;
  parkedFolders: string[];
  globalPhpVersion: string;
  phpVersions: string[];
  isolatedPhp: Record<string, string>;
  securedDomains: string[];
  nginx: NginxConfig;
  mysql: MysqlConfig;
}

export interface Site {
  name: string;
  domain: string;
  url: string;
  path: string;
  documentRoot: string;
  secured: boolean;
  phpVersion: string;
  framework: Framework;
}

export interface ServiceStatus {
  name: string;
  state: ServiceState;
  version?: string;
  port?: number;
  pid?: number;
  logPath?: string;
  message?: string;
}

export interface LaraboxsPaths {
  home: string;
  configFile: string;
  logs: string;
  nginxRoot: string;
  nginxConfig: string;
  nginxSites: string;
  mysqlRoot: string;
  mysqlData: string;
  phpRoot: string;
  certs: string;
  hostsFile: string;
}

export interface DashboardSummary {
  config: LaraboxsConfig;
  paths: LaraboxsPaths;
  sites: Site[];
  services: {
    nginx: ServiceStatus;
    mysql: ServiceStatus;
    php: ServiceStatus;
  };
  logs: string[];
}

export interface CommandSpec {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}
