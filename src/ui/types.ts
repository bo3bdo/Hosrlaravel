export type Framework = "Laravel" | "PHP" | "Static";
export type ServiceState = "running" | "stopped" | "unknown";

export interface LaraboxsConfig {
  tld: string;
  parkedFolders: string[];
  globalPhpVersion: string;
  phpVersions: string[];
  securedDomains: string[];
  mysql: {
    version: string;
    port: number;
    rootUser: string;
    instanceName: string;
  };
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
  logPath?: string;
  message?: string;
}

export interface DashboardSummary {
  config: LaraboxsConfig;
  paths: {
    home: string;
    configFile: string;
    logs: string;
    mysqlData: string;
    hostsFile: string;
  };
  sites: Site[];
  services: {
    nginx: ServiceStatus;
    mysql: ServiceStatus;
    php: ServiceStatus;
  };
  logs: string[];
}
