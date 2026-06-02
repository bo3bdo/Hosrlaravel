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

export interface RedisConfig {
  version: string;
  port: number;
}

export interface PhpConfig {
  memoryLimit: string;
  uploadMaxFilesize: string;
  postMaxSize: string;
  maxExecutionTime: number;
  maxInputVars: number;
  enabledExtensions: string[];
}

export interface LaraboxsConfig {
  version: 1;
  setupComplete: boolean;
  tld: string;
  parkedFolders: string[];
  globalPhpVersion: string;
  phpVersions: string[];
  isolatedPhp: Record<string, string>;
  siteEntryPaths: Record<string, string>;
  securedDomains: string[];
  php: PhpConfig;
  nginx: NginxConfig;
  mysql: MysqlConfig;
  redis: RedisConfig;
}

export interface Site {
  name: string;
  domain: string;
  url: string;
  path: string;
  documentRoot: string;
  entryPath: string;
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

export interface RuntimeInstallStatus {
  name: string;
  version: string;
  root: string;
  binary: string;
  installed: boolean;
  downloadUrl?: string;
  installedDownloadUrl?: string;
  installedPackageVersion?: string;
  installedAt?: string;
  updateAvailable?: boolean;
}

export type RuntimeKind = "php" | "mysql" | "nginx" | "redis" | "node" | "composer";
export type RuntimeInstallJobStatus = "queued" | "downloading" | "extracting" | "installing" | "complete" | "failed";

export interface RuntimeInstallProgress {
  status: RuntimeInstallJobStatus;
  percent: number;
  message?: string;
  bytesDownloaded?: number;
  totalBytes?: number;
  etaSeconds?: number;
}

export interface RuntimeInstallJob extends RuntimeInstallProgress {
  id: string;
  kind: RuntimeKind;
  name: string;
  version: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  result?: RuntimeInstallStatus;
}

export interface RuntimeManifestEntry {
  kind: RuntimeKind;
  name: string;
  version: string;
  packageVersion?: string;
  downloadUrl: string;
  archiveType: "zip" | "file";
  root: string;
  binary: string;
}

export interface PhpExtensionStatus {
  name: string;
  available: boolean;
  enabled: boolean;
  dll?: string;
}

export interface PhpSettingsStatus {
  version: string;
  iniPath: string;
  settings: PhpConfig;
  extensions: PhpExtensionStatus[];
}

export interface PhpMyAdminStatus {
  name: "phpMyAdmin";
  version: string;
  installed: boolean;
  root: string;
  url: string;
  configPath: string;
  downloadUrl: string;
}

export interface SslTrustStatus {
  certPath: string;
  keyPath: string;
  exists: boolean;
  trusted: boolean;
  platform: NodeJS.Platform;
  store?: string;
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
  redisRoot: string;
  redisData: string;
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
    redis: ServiceStatus;
    php: ServiceStatus;
  };
  runtimes: {
    mysql: RuntimeInstallStatus[];
    nginx: RuntimeInstallStatus;
    redis: RuntimeInstallStatus;
    php: RuntimeInstallStatus[];
    node: RuntimeInstallStatus;
    composer: RuntimeInstallStatus;
  };
  phpMyAdmin: PhpMyAdminStatus;
  ssl: SslTrustStatus;
  logs: string[];
}

export interface CommandSpec {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}
