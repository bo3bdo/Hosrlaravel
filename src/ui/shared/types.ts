import type { AppLanguage, DashboardSummary, RuntimeInstallJob, RuntimeKind } from "../types.js";

export type Section = "dashboard" | "sites" | "services" | "tools" | "logs" | "settings";
export type ServicesPane = "mysql" | "redis" | "phpmyadmin" | "php" | "nginx" | "all";
export type SiteDetailTab = "general" | "database" | "commands" | "workers" | "information";
export type DatabaseEngine = "mysql" | "mariadb";
export type RuntimeJobMap = Record<string, RuntimeInstallJob>;
export type WizardStepId = "folder" | "install" | "finish";
export type WizardTaskStatus = "pending" | "running" | "complete" | "failed";
export type WizardTaskState = { status: WizardTaskStatus; message?: string };
export type WizardTaskDefinition = {
  id: string;
  label: string;
  detail: string;
  optional?: boolean;
  runtime?: { kind: RuntimeKind; version?: string };
};
export type LogSeverity = "info" | "warning" | "error";

export interface ViewProps {
  summary: DashboardSummary;
  post: (path: string, body?: Record<string, unknown>) => Promise<void>;
  busy: boolean;
  language: AppLanguage;
}

export type {
  AppLanguage,
  DashboardSummary,
  DatabaseExportResult,
  DatabaseTableInfo,
  DesktopConfirmFn,
  DesktopConfirmOptions,
  LaravelAuthPreset,
  LaravelDatabaseDriver,
  LaravelInstallerStatus,
  LaravelPackageManager,
  LaravelStarterKit,
  LaravelTestingFramework,
  NewSitePreset,
  PhpConfig,
  PhpExtensionStatus,
  PhpSettingsStatus,
  PortCheckResult,
  RuntimeInstallJob,
  RuntimeInstallStatus,
  RuntimeKind,
  ServiceStatus,
  Site,
  SiteCommandDefinition,
  SiteCommandJob,
  SiteCommandKind,
  SiteCreationJob,
  SiteCreationResult,
  SiteDatabaseInfo,
  SiteDeletionResult,
  SiteDiagnosticReport,
  SiteEnvApplyResult,
  SiteEnvProfile,
  SiteEnvProfileKind,
  SiteHealthStatus,
  SiteWorkerKind,
  SiteWorkerStatus,
  StartupStatus,
  UpdateCenterStatus
} from "../types.js";
