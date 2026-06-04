export type Framework = "Laravel" | "PHP" | "Static";
export type ServiceState = "running" | "stopped" | "unknown";

export interface LaraboxsConfig {
  setupComplete: boolean;
  startup: StartupSettings;
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

export interface StartupSettings {
  launchAppOnLogin: boolean;
  startServicesOnLaunch: boolean;
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

export type SiteDiagnosticTone = "pass" | "warn" | "fail";

export interface SiteDiagnosticItem {
  id: string;
  label: string;
  detail: string;
  tone: SiteDiagnosticTone;
  fix?: string;
}

export interface SiteDiagnosticReport {
  site: Site;
  health: SiteHealthStatus;
  checkedAt: string;
  summary: {
    pass: number;
    warn: number;
    fail: number;
  };
  checks: SiteDiagnosticItem[];
}

export type SiteEnvProfileKind = "app" | "database" | "redis" | "queue-redis" | "full";

export interface SiteEnvProfile {
  id: SiteEnvProfileKind;
  label: string;
  detail: string;
  values: Record<string, string>;
  block: string;
}

export interface SiteEnvApplyResult {
  site: Site;
  envPath: string;
  profile: SiteEnvProfile;
  createdDatabase?: string;
  databaseError?: string;
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

export type SiteCommandKind =
  | "artisan:migrate"
  | "artisan:cache-clear"
  | "artisan:route-list"
  | "composer:install"
  | "npm:install"
  | "npm:build";

export type SiteCommandJobStatus = "queued" | "running" | "complete" | "failed";
export type SiteCommandLogLevel = "info" | "success" | "error";

export interface SiteCommandDefinition {
  id: SiteCommandKind;
  label: string;
  detail: string;
}

export interface SiteCommandLogEntry {
  at: string;
  level: SiteCommandLogLevel;
  message: string;
}

export interface SiteCommandJob {
  id: string;
  site: string;
  command: SiteCommandKind;
  label: string;
  status: SiteCommandJobStatus;
  percent: number;
  message: string;
  logs: SiteCommandLogEntry[];
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  exitCode?: number;
  error?: string;
}

export type SiteWorkerKind = "queue" | "schedule";
export type SiteWorkerState = "running" | "stopped" | "failed";

export interface SiteWorkerStatus {
  id: string;
  site: string;
  kind: SiteWorkerKind;
  label: string;
  state: SiteWorkerState;
  pid?: number;
  startedAt?: string;
  updatedAt: string;
  message?: string;
  logs: SiteCommandLogEntry[];
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

export interface DatabaseInfo {
  name: string;
  system: boolean;
}

export interface DatabaseTableInfo {
  name: string;
  rows?: number;
}

export interface DatabaseExportResult {
  database: string;
  path: string;
}

export interface PortCheckResult {
  id: string;
  label: string;
  service: "nginx" | "mysql" | "redis" | "php";
  port: number;
  status: "ok" | "free" | "conflict";
  inUse: boolean;
  expected: boolean;
  processName?: string;
  pid?: number;
  suggestedPort?: number;
  message: string;
}

export interface UpdateCenterItem {
  id: string;
  kind: RuntimeKind | "laravel-installer";
  name: string;
  version: string;
  installed: boolean;
  updateAvailable: boolean;
  installedVersion?: string;
  latestVersion?: string;
  message?: string;
}

export interface UpdateCenterStatus {
  checkedAt: string;
  items: UpdateCenterItem[];
}

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

export interface StartupStatus extends StartupSettings {
  platform: string;
  supported: boolean;
  launchCommand?: string;
  intendedLaunchCommand?: string;
  message?: string;
}
