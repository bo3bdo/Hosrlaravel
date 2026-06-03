export type Framework = "Laravel" | "PHP" | "Static";
export type ServiceState = "running" | "stopped" | "unknown";

export interface LaraboxsConfig {
  setupComplete: boolean;
  tld: string;
  parkedFolders: string[];
  globalPhpVersion: string;
  phpVersions: string[];
  isolatedPhp: Record<string, string>;
  siteEntryPaths: Record<string, string>;
  securedDomains: string[];
  php: PhpConfig;
  nginx: {
    httpPort: number;
    httpsPort: number;
    fastCgiHost: string;
  };
  mysql: {
    version: string;
    port: number;
    rootUser: string;
    instanceName: string;
  };
  redis: {
    version: string;
    port: number;
  };
}

export interface PhpConfig {
  memoryLimit: string;
  uploadMaxFilesize: string;
  postMaxSize: string;
  maxExecutionTime: number;
  maxInputVars: number;
  enabledExtensions: string[];
  xdebugEnabled: boolean;
  xdebugIdeKey: string;
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
  platform: string;
  store?: string;
  message?: string;
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

export type NewSitePreset = "laravel" | "php" | "static";
export type LaravelStarterKit = "none" | "react" | "vue" | "svelte" | "livewire";
export type LaravelAuthPreset = "default" | "none" | "workos";
export type LaravelDatabaseDriver = "sqlite" | "mysql" | "mariadb" | "pgsql" | "sqlsrv";
export type LaravelPackageManager = "none" | "npm" | "pnpm" | "bun" | "yarn";
export type LaravelTestingFramework = "pest" | "phpunit";

export interface LaravelInstallerStatus {
  installed: boolean;
  version?: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  binary?: string;
  binDir: string;
  composerHome: string;
  composerInstalled: boolean;
  phpInstalled: boolean;
  message?: string;
}

export interface SiteCreationResult {
  projectPath: string;
  name: string;
  preset: NewSitePreset;
  site: Site;
  command?: string;
  output?: string;
}

export type SiteCreationJobStatus = "queued" | "running" | "complete" | "failed";
export type SiteCreationLogLevel = "info" | "success" | "error";

export interface SiteCreationLogEntry {
  at: string;
  level: SiteCreationLogLevel;
  message: string;
}

export interface SiteCreationJob {
  id: string;
  status: SiteCreationJobStatus;
  percent: number;
  message: string;
  logs: SiteCreationLogEntry[];
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  result?: SiteCreationResult;
}

export interface ServiceStatus {
  name: string;
  state: ServiceState;
  version?: string;
  port?: number;
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

export interface RuntimeInstallJob {
  id: string;
  kind: RuntimeKind;
  name: string;
  version: string;
  status: RuntimeInstallJobStatus;
  percent: number;
  message?: string;
  bytesDownloaded?: number;
  totalBytes?: number;
  etaSeconds?: number;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  result?: RuntimeInstallStatus;
}

export interface DashboardSummary {
  config: LaraboxsConfig;
  paths: {
    home: string;
    configFile: string;
    logs: string;
    nginxRoot: string;
    nginxConfig: string;
    nginxSites: string;
    mysqlConfig: string;
    mysqlData: string;
    phpIni: string;
    phpRoot: string;
    redisRoot: string;
    redisData: string;
    certs: string;
    hostsFile: string;
  };
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
