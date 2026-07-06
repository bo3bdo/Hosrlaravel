import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BadgeCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  CircleAlert,
  Clipboard,
  Database,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  FolderPlus,
  Globe,
  HardDrive,
  KeyRound,
  Languages,
  LayoutDashboard,
  ListRestart,
  LoaderCircle,
  Lock,
  LockOpen,
  Network,
  PackageCheck,
  PanelTopOpen,
  Play,
  RotateCw,
  Save,
  Search,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  SquareTerminal,
  Trash2,
  X
} from "lucide-react";
import type {
  DashboardSummary,
  DatabaseExportResult,
  DatabaseTableInfo,
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
  RuntimeInstallJob,
  RuntimeInstallStatus,
  RuntimeKind,
  ServiceStatus,
  SiteCommandDefinition,
  SiteCommandJob,
  SiteCommandKind,
  SiteCreationJob,
  Site,
  SiteCreationResult,
  SiteDeletionResult,
  SiteDatabaseInfo,
  SiteDiagnosticReport,
  SiteEnvApplyResult,
  SiteEnvProfile,
  SiteEnvProfileKind,
  SiteHealthStatus,
  SiteWorkerKind,
  SiteWorkerStatus,
  StartupStatus,
  UpdateCenterStatus,
  PortCheckResult,
  AppLanguage,
  DesktopConfirmOptions,
  DesktopConfirmFn
} from "./types.js";
import { apiUrl, copyTextToClipboard, fetchRuntimeInstallJob, getJson, openExternalUrl, postJson, responseErrorMessage } from "./apiClient.js";
import { t } from "./i18n.js";
import { BootScreen } from "./components/BootScreen.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { HealthCheckPanel } from "./components/HealthCheckPanel.js";
import { ToastContainer } from "./components/ToastContainer.js";
import { useToasts, showToast } from "./components/useToasts.js";

type Section = "dashboard" | "sites" | "services" | "tools" | "logs" | "settings";
type ServicesPane = "mysql" | "redis" | "phpmyadmin" | "php" | "nginx" | "all";
type SiteDetailTab = "general" | "database" | "commands" | "workers" | "information";
type DatabaseEngine = "mysql" | "mariadb";
type RuntimeJobMap = Record<string, RuntimeInstallJob>;
type WizardStepId = "folder" | "install" | "finish";
type WizardTaskStatus = "pending" | "running" | "complete" | "failed";
type WizardTaskState = { status: WizardTaskStatus; message?: string };
type WizardTaskDefinition = {
  id: string;
  label: string;
  detail: string;
  optional?: boolean;
  runtime?: { kind: RuntimeKind; version?: string };
};

const DesktopConfirmContext = createContext<DesktopConfirmFn | null>(null);

const sections: Array<{ id: Section; label: string; labelAr: string; icon: typeof Globe }> = [
  { id: "dashboard", label: "Dashboard", labelAr: "لوحة التحكم", icon: LayoutDashboard },
  { id: "sites", label: "Sites", labelAr: "المواقع", icon: Globe },
  { id: "services", label: "Services", labelAr: "الخدمات", icon: Server },
  { id: "tools", label: "Tools", labelAr: "الأدوات", icon: PanelTopOpen },
  { id: "logs", label: "Logs", labelAr: "السجلات", icon: FileText },
  { id: "settings", label: "Settings", labelAr: "الإعدادات", icon: Settings }
];

const sectionMeta: Record<Section, { subtitleEn: string; subtitleAr: string }> = {
  dashboard: { subtitleEn: "Stack overview and quick actions", subtitleAr: "نظرة عامة وإجراءات سريعة" },
  sites: { subtitleEn: "Domains, commands, and project settings", subtitleAr: "الدومينات والأوامر وإعدادات المشروع" },
  services: { subtitleEn: "PHP, Nginx, database, and Redis", subtitleAr: "PHP وNginx وقاعدة البيانات وRedis" },
  tools: { subtitleEn: "Database, ports, and runtime updates", subtitleAr: "قاعدة البيانات والمنافذ وتحديثات الأدوات" },
  logs: { subtitleEn: "Runtime output and troubleshooting", subtitleAr: "مخرجات التشغيل واستكشاف الأخطاء" },
  settings: { subtitleEn: "Workspace, paths, and security", subtitleAr: "مساحة العمل والمسارات والأمان" }
};

const shellCopy = {
  en: {
    brandSubtitle: "Windows local dev",
    refresh: "Refresh",
    loading: "Loading laraboxs state...",
    languageButton: "AR",
    live: "Live",
    servicesRunning: "services running",
    sitesCount: "sites"
  },
  ar: {
    brandSubtitle: "بيئة تطوير ويندوز",
    refresh: "تحديث",
    loading: "جار تحميل حالة laraboxs...",
    languageButton: "EN",
    live: "مباشر",
    servicesRunning: "خدمات تعمل",
    sitesCount: "مواقع"
  }
} satisfies Record<AppLanguage, Record<string, string>>;

const bundledAppVersion = __LARABOXS_APP_VERSION__;

function sectionLabel(section: { label: string; labelAr: string }, language: AppLanguage): string {
  return language === "ar" ? section.labelAr : section.label;
}

function appVersionLabel(version: string | undefined): string {
  const normalized = (version ?? bundledAppVersion).trim() || bundledAppVersion;
  return normalized.toLowerCase().startsWith("v") ? normalized : `v${normalized}`;
}

function serviceBadgeForSection(sectionId: Section, summary: DashboardSummary): JSX.Element | null {
  if (sectionId === "services") {
    const runningServices = [summary.services.php, summary.services.nginx, summary.services.mysql, summary.services.redis].filter(
      (service) => service.state === "running"
    ).length;
    const tone = runningServices === 4 ? "green" : runningServices > 0 ? "amber" : "red";
    return <span className={`status-dot ${tone}`} title={`${runningServices}/4 services running`} />;
  }
  return null;
}

function useDesktopConfirm(): DesktopConfirmFn {
  const confirm = useContext(DesktopConfirmContext);
  if (!confirm) {
    throw new Error("Desktop confirm dialog is not available.");
  }
  return confirm;
}

export default function App() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [section, setSection] = useState<Section>("dashboard");
  const [language, setLanguage] = useState<AppLanguage>("en");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installJobs, setInstallJobs] = useState<RuntimeJobMap>({});
  const [updateStatus, setUpdateStatus] = useState<UpdateCenterStatus | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<DesktopConfirmOptions | null>(null);
  const pendingConfirm = useRef<((confirmed: boolean) => void) | null>(null);
  const { toasts, addToast, removeToast, pauseToast, resumeToast } = useToasts();

  const confirmAction = useCallback<DesktopConfirmFn>((options) => {
    return new Promise((resolve) => {
      pendingConfirm.current?.(false);
      pendingConfirm.current = resolve;
      setConfirmDialog({
        cancelLabel: "Cancel",
        confirmLabel: "Continue",
        tone: "default",
        ...options
      });
    });
  }, []);

  const settleConfirm = useCallback((confirmed: boolean) => {
    const resolve = pendingConfirm.current;
    pendingConfirm.current = null;
    setConfirmDialog(null);
    resolve?.(confirmed);
  }, []);

  async function refresh(signal?: AbortSignal) {
    try {
      setSummary(await getJson<DashboardSummary>("/api/summary", { signal }));
      setError(null);
    } catch (requestError) {
      if ((requestError as Error)?.name === "AbortError") {
        return;
      }
      setError(`Helper API offline or unavailable: ${requestError instanceof Error ? requestError.message : String(requestError)}`);
    }
  }

  async function post(path: string, body: Record<string, unknown> = {}) {
    await request(path, body);
  }

  async function startRuntimeInstall(kind: RuntimeKind, version?: string, force = false): Promise<RuntimeInstallJob | undefined> {
    try {
      const payload = await postJson<{ job: RuntimeInstallJob }>("/api/runtimes/install", { kind, version, force });
      setInstallJobs((current) => ({ ...current, [payload.job.id]: payload.job }));
      setError(null);
      return payload.job;
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : String(requestError);
      setError(`Action failed: ${message}`);
      addToast(message, "error");
      return undefined;
    }
  }

  async function removeRuntime(kind: RuntimeKind, version?: string) {
    await request("/api/runtimes/uninstall", { kind, version });
  }

  async function request(path: string, body: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      const payload = await postJson<unknown>(path, body);
      await refresh();
      setError(null);
      return payload as unknown;
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : String(requestError);
      setError(`Action failed: ${message}`);
      addToast(message, "error");
      throw requestError;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let controller = new AbortController();
    void refresh(controller.signal);

    function tick() {
      if (document.hidden) {
        return;
      }
      controller.abort();
      controller = new AbortController();
      void refresh(controller.signal);
    }

    const timer = window.setInterval(tick, 2000);

    function handleVisibilityChange() {
      if (!document.hidden) {
        tick();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey && (event.key === "r" || event.key === "R")) {
        event.preventDefault();
        tick();
        return;
      }

      if (event.key === "F5") {
        event.preventDefault();
        tick();
        return;
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function checkForUpdates() {
      setUpdateChecking(true);
      try {
        const status = await getJsonWithTimeout<UpdateCenterStatus>("/api/updates", 7000);
        if (cancelled) {
          return;
        }
        setUpdateStatus(status);
        if (status.application.updateAvailable) {
          addToast(`Laraboxs ${status.application.latestVersion} is available.`, "info");
        }
      } catch {
        if (!cancelled) {
          setUpdateStatus(null);
        }
      } finally {
        if (!cancelled) {
          setUpdateChecking(false);
        }
      }
    }
    void checkForUpdates();
    return () => {
      cancelled = true;
    };
  }, [addToast]);

  const activeJobKey = useMemo(() => {
    return Object.values(installJobs)
      .filter(isActiveRuntimeJob)
      .map((job) => job.id)
      .sort()
      .join("|");
  }, [installJobs]);

  useEffect(() => {
    if (!activeJobKey) {
      return;
    }

    const jobIds = activeJobKey.split("|");
    let cancelled = false;

    async function pollJobs() {
      try {
        const updates = await Promise.all(jobIds.map(fetchRuntimeInstallJob));
        if (cancelled) {
          return;
        }

        setInstallJobs((current) => {
          const next = { ...current };
          for (const job of updates) {
            next[job.id] = job;
          }
          return next;
        });

        if (updates.some((job) => !isActiveRuntimeJob(job))) {
          void refresh();
        }
        setError(null);
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : String(requestError));
        }
      }
    }

    void pollJobs();
    const timer = window.setInterval(() => void pollJobs(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeJobKey]);

  const active = useMemo(() => sections.find((item) => item.id === section)!, [section]);
  const activeLabel = sectionLabel(active, language);
  const activeSubtitle = language === "ar" ? sectionMeta[section].subtitleAr : sectionMeta[section].subtitleEn;
  const copy = shellCopy[language];
  const runningServicesCount = summary
    ? [summary.services.php, summary.services.nginx, summary.services.mysql, summary.services.redis].filter((service) => service.state === "running").length
    : 0;
  const stackTone = runningServicesCount === 4 ? "green" : runningServicesCount > 0 ? "amber" : "red";
  const appUpdate = updateStatus?.application;
  const hasAppUpdate = Boolean(appUpdate?.updateAvailable);
  const displayedAppVersion = appVersionLabel(bundledAppVersion);

  function openAppUpdate() {
    const target = appUpdate?.asset?.downloadUrl || appUpdate?.releaseUrl;
    if (target) {
      void openExternalUrl(target);
    } else {
      setSection("tools");
    }
  }

  if (!summary) {
    return <BootScreen error={error} busy={busy} refresh={refresh} />;
  }

  if (summary && needsFirstRunSetup(summary)) {
    return (
      <FirstRunWizard
        summary={summary}
        installJobs={installJobs}
        startRuntimeInstall={startRuntimeInstall}
        request={request}
        refresh={refresh}
        busy={busy}
        error={error}
        language={language}
        onFinish={() => {
          setSection("dashboard");
          void refresh();
        }}
      />
    );
  }

  return (
    <DesktopConfirmContext.Provider value={confirmAction}>
    <div className={`app-shell ${language === "ar" ? "rtl" : ""}`} dir={language === "ar" ? "rtl" : "ltr"}>
      <aside className="sidebar">
        <div className="brand">
          <strong>laraboxs</strong>
        </div>
        <nav aria-label={language === "ar" ? "التنقل الرئيسي" : "Main navigation"}>
          {sections.map((item) => {
            const Icon = item.icon;
            const badge = summary ? serviceBadgeForSection(item.id, summary) : null;
            const isActive = section === item.id;
            return (
              <button
                key={item.id}
                className={isActive ? "active" : ""}
                aria-current={isActive ? "page" : undefined}
                onClick={() => setSection(item.id)}
              >
                <span className="nav-indicator" aria-hidden="true" />
                <Icon size={18} />
                <span>{sectionLabel(item, language)}</span>
                {badge ?? null}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className={`sidebar-stack-pill ${stackTone}`}>
            <span className="status-dot pulse" />
            <span>
              {runningServicesCount}/4 {copy.servicesRunning}
            </span>
          </div>
        </div>
      </aside>

      <div className="main-frame">
        <header className="topbar desktop-titlebar">
          <div className="topbar-leading">
            <h1>{activeLabel}</h1>
          </div>
          <div className="topbar-actions">
            {hasAppUpdate && appUpdate ? (
              <button
                className="update-pill available"
                onClick={openAppUpdate}
                title="Download the latest Laraboxs release"
              >
                <Download size={16} />
                <span>{`Update ${appUpdate.latestVersion}`}</span>
              </button>
            ) : null}
          </div>
        </header>

        {error ? <div className="notice app-notice">{error}</div> : null}

        {!summary ? (
          <div className="empty-state desktop-empty">{copy.loading}</div>
        ) : (
          <section className="content">
            <div key={section} className="page-view">
              {section === "dashboard" ? <Dashboard summary={summary} post={post} busy={busy} onNavigate={setSection} language={language} /> : null}
              {section === "sites" ? <Sites summary={summary} post={post} request={request} busy={busy} onNavigate={setSection} language={language} /> : null}
              {section === "services" ? (
                <Services summary={summary} post={post} request={request} installJobs={installJobs} startRuntimeInstall={startRuntimeInstall} busy={busy} language={language} />
              ) : null}
              {section === "tools" ? (
                <Tools summary={summary} post={post} request={request} startRuntimeInstall={startRuntimeInstall} busy={busy} updateStatus={updateStatus} language={language} />
              ) : null}
              {section === "logs" ? <Logs summary={summary} post={post} busy={busy} language={language} /> : null}
              {section === "settings" ? <SettingsView summary={summary} post={post} request={request} busy={busy} language={language} onLanguageChange={setLanguage} /> : null}
            </div>
          </section>
        )}

        <footer className="status-bar">
          <div className="status-bar-group">
            <span className={`status-dot ${stackTone}`} />
            <span>
              {runningServicesCount}/4 {copy.servicesRunning}
            </span>
            <span className="status-bar-sep" aria-hidden="true" />
            <span>
              {summary.sites.length} {copy.sitesCount}
            </span>
          </div>
          <div className="status-bar-group muted">
            <span>PHP {summary.config.globalPhpVersion}</span>
            <span className="status-bar-sep" aria-hidden="true" />
            <span>.{summary.config.tld}</span>
          </div>
          <div className="status-bar-group muted">{displayedAppVersion}</div>
        </footer>
      </div>

      <ToastContainer toasts={toasts} removeToast={removeToast} pauseToast={pauseToast} resumeToast={resumeToast} language={language} />
      {confirmDialog ? <ConfirmDialog options={confirmDialog} onResolve={settleConfirm} /> : null}
    </div>
    </DesktopConfirmContext.Provider>
  );
}

type LogSeverity = "info" | "warning" | "error";

function logSeverity(line: string): LogSeverity {
  if (/\b(error|failed|denied|refusing|timed out|aborted connection)\b/i.test(line)) {
    return "error";
  }
  if (/\b(warn|warning|untrusted|fallback|reduced|unauthenticated)\b/i.test(line)) {
    return "warning";
  }
  return "info";
}

function logService(line: string): string {
  const timestamped = line.match(/^\[[^\]]+\]\s+\[([^\]]+)\]/);
  const simple = line.match(/^\[([^\]]+)\]/);
  return (timestamped?.[1] ?? simple?.[1] ?? "app").toLowerCase();
}

function Dashboard({
  summary,
  post,
  busy,
  onNavigate,
  language
}: ViewProps & {
  onNavigate: (section: Section) => void;
}) {
  const selectedPhp = summary.runtimes.php.find((runtime) => runtime.version === summary.config.globalPhpVersion);
  const selectedDatabase = selectedMysqlRuntime(summary, summary.config.mysql.version);
  const runningServices = [summary.services.php, summary.services.nginx, summary.services.mysql, summary.services.redis].filter(
    (service) => service.state === "running"
  ).length;
  const coreRuntimes = [selectedPhp, selectedDatabase, summary.runtimes.nginx, summary.runtimes.node, summary.runtimes.composer].filter(
    Boolean
  ) as RuntimeInstallStatus[];
  const installedCoreCount = coreRuntimes.filter((runtime) => runtime.installed).length;
  const securedSites = summary.sites.filter((site) => site.secured).length;
  const warningGroups = summary.logInsights.groups;
  const warningLines = summary.logInsights.warningLines + summary.logInsights.errorLines;
  const stackReady = runningServices === 4 && installedCoreCount === coreRuntimes.length && summary.ssl.trusted;
  const copy =
    language === "ar"
      ? {
          ready: "البيئة المحلية جاهزة",
          needsWork: "البيئة تحتاج انتباه",
          subtitle: "ملخص سريع للخدمات، المواقع، والتحذيرات قبل تبدأ الشغل.",
          nextAction: "الإجراء التالي",
          startStack: "تشغيل الخدمات",
          startStackDetail: "شغّل PHP وNginx وقاعدة البيانات وRedis المتاحة.",
          trustCa: "توثيق SSL",
          trustCaDetail: "وثّق شهادة laraboxs المحلية في ويندوز.",
          syncHosts: "مزامنة Hosts",
          syncHostsDetail: "حدّث الدومينات المحلية للمواقع.",
          reviewLogs: "مراجعة السجلات",
          reviewLogsDetail: "افتح التحذيرات الأخيرة وشخّصها.",
          openSites: "فتح المواقع",
          openSitesDetail: "ابدأ من قائمة المواقع والمعاينة.",
          stack: "الخدمات",
          runtimes: "الأدوات",
          sites: "المواقع",
          warnings: "تحذيرات",
          health: "الفحص السريع",
          recentSites: "آخر المواقع",
          recentSitesDetail: summary.sites.length ? `${summary.sites.length} مشاريع مكتشفة` : "لا توجد مشاريع مضافة",
          openSitesButton: "فتح المواقع",
          servicesTitle: "الخدمات",
          servicesDetail: `${runningServices}/4 خدمات أساسية تعمل`,
          openServicesButton: "فتح الخدمات",
          recentWarnings: "ملخص التحذيرات",
          recentWarningsDetail: warningGroups.length ? `${warningGroups.length} مشاكل مجمعة من ${warningLines} أسطر` : "لا توجد تحذيرات",
          noSites: "لا توجد مشاريع مضافة.",
          noWarnings: "لا توجد تحذيرات حديثة.",
          openLogsButton: "فتح السجلات"
        }
      : {
          ready: "Local stack is ready",
          needsWork: "Local stack needs attention",
          subtitle: "A quick read on services, sites, and warnings before you start working.",
          nextAction: "Next Action",
          startStack: "Start Stack",
          startStackDetail: "Start available PHP, Nginx, database, and Redis services.",
          trustCa: "Trust SSL",
          trustCaDetail: "Trust the laraboxs local CA in Windows.",
          syncHosts: "Sync Hosts",
          syncHostsDetail: "Refresh local domains for parked sites.",
          reviewLogs: "Review Logs",
          reviewLogsDetail: "Open recent warnings and diagnose them.",
          openSites: "Open Sites",
          openSitesDetail: "Start from the site list and preview.",
          stack: "Services",
          runtimes: "Runtimes",
          sites: "Sites",
          warnings: "Warnings",
          health: "Health Check",
          recentSites: "Recent Sites",
          recentSitesDetail: summary.sites.length ? `${summary.sites.length} discovered projects` : "No parked projects found",
          openSitesButton: "Open Sites",
          servicesTitle: "Services",
          servicesDetail: `${runningServices}/4 core services running`,
          openServicesButton: "Open Services",
          recentWarnings: "Warning Summary",
          recentWarningsDetail: warningGroups.length ? `${warningGroups.length} grouped issues from ${warningLines} lines` : "No warning lines detected",
          noSites: "No parked projects found.",
          noWarnings: "No recent warnings.",
          openLogsButton: "Open Logs"
        };

  const canStartInstalledStack = Boolean(selectedPhp?.installed && selectedDatabase?.installed && summary.runtimes.nginx.installed);

  async function startInstalledStack() {
    if (selectedPhp?.installed && summary.services.php.state !== "running") {
      await post("/api/php-fcgi/start");
    }
    if (selectedDatabase?.installed && summary.services.mysql.state !== "running") {
      await post("/api/mysql/start");
    }
    if (summary.runtimes.redis.installed && summary.services.redis.state !== "running") {
      await post("/api/redis/start");
    }
    if (summary.runtimes.nginx.installed && summary.services.nginx.state !== "running") {
      await post("/api/nginx/start");
    }
  }

  async function stopRunningStack() {
    if (summary.services.nginx.state === "running") {
      await post("/api/nginx/stop");
    }
    if (summary.services.php.state === "running") {
      await post("/api/php-fcgi/stop");
    }
    if (summary.services.redis.state === "running") {
      await post("/api/redis/stop");
    }
    if (summary.services.mysql.state === "running") {
      await post("/api/mysql/stop");
    }
  }

  const serviceRows = [
    { label: "Nginx", service: summary.services.nginx, detail: `Port ${summary.config.nginx.httpPort}` },
    { label: "PHP", service: summary.services.php, detail: summary.config.globalPhpVersion },
    { label: databaseEngineName(selectedDatabase), service: summary.services.mysql, detail: `Port ${summary.config.mysql.port}` },
    { label: "Redis", service: summary.services.redis, detail: `Port ${summary.config.redis.port}` }
  ];

  return (
    <div className="dashboard-view herd-dashboard">
      <section className="dash-status-bar">
        <span className={`status-dot ${runningServices === 4 ? "green" : runningServices > 0 ? "amber" : "red"}`} />
        <div className="dash-status-copy">
          <strong>{stackReady ? copy.ready : copy.needsWork}</strong>
          <span>
            {runningServices}/4 {language === "ar" ? "خدمات تعمل" : "services running"} · PHP {summary.config.globalPhpVersion} · {summary.sites.length}{" "}
            {language === "ar" ? "مواقع" : "sites"}
          </span>
        </div>
        <div className="dash-status-actions">
          <button className="primary" disabled={busy || runningServices === 4 || !canStartInstalledStack} onClick={() => void startInstalledStack()}>
            <Play size={16} />
            <span>{language === "ar" ? "تشغيل الكل" : "Start All"}</span>
          </button>
          <button disabled={busy || runningServices === 0} onClick={() => void stopRunningStack()}>
            <CircleStop size={16} />
            <span>{language === "ar" ? "إيقاف الكل" : "Stop All"}</span>
          </button>
        </div>
      </section>

      <div className="dash-grid">
        <section className="settings-panel dash-card">
          <SettingsPanelHeader icon={Server} title={copy.servicesTitle} detail={copy.servicesDetail} />
          <div className="dash-service-list">
            {serviceRows.map((item) => {
              const tone = item.service.state === "running" ? "green" : item.service.state === "stopped" ? "red" : "amber";
              return (
                <button key={item.label} className="dash-service-row" onClick={() => onNavigate("services")} title={`${item.label} - ${item.service.state}`}>
                  <span className={`status-dot ${tone}`} />
                  <strong>{item.label}</strong>
                  <span>{item.detail}</span>
                  <small>{item.service.state}</small>
                </button>
              );
            })}
          </div>
        </section>

        <section className="settings-panel dash-card">
          <SettingsPanelHeader icon={Globe} title={language === "ar" ? "وصول سريع" : "Quick Access"} detail={copy.recentSitesDetail} />
          <div className="dash-site-list">
            {summary.sites.slice(0, 6).map((site) => (
              <div key={site.domain} className="dash-site-row">
                {site.secured ? <Lock className="site-lock secured" size={14} /> : <LockOpen className="site-lock" size={14} />}
                <div>
                  <strong>{site.domain}</strong>
                  <span>PHP {site.phpVersion}</span>
                </div>
                <button onClick={() => void openExternalUrl(site.url)} title={`Open ${site.domain}`}>
                  <ExternalLink size={15} />
                </button>
              </div>
            ))}
            {!summary.sites.length ? <div className="settings-empty-row">{copy.noSites}</div> : null}
          </div>
          <div className="settings-actions">
            <button onClick={() => onNavigate("sites")}>
              <Globe size={15} />
              <span>{copy.openSitesButton}</span>
            </button>
          </div>
        </section>
      </div>

      {warningGroups.length ? (
        <section className="settings-panel dash-card">
          <SettingsPanelHeader icon={FileText} title={copy.recentWarnings} detail={copy.recentWarningsDetail} />
          <div className="dashboard-warning-list">
            {warningGroups.slice(0, 4).map((group) => (
              <div key={group.id} className={`dashboard-warning-line ${group.severity}`}>
                <span>{group.service}{group.count > 1 ? ` x${group.count}` : ""}</span>
                <p>{group.message}</p>
                {group.action ? <small>{group.action}</small> : null}
              </div>
            ))}
          </div>
          <div className="settings-actions">
            <button onClick={() => onNavigate("logs")}>
              <FileText size={15} />
              <span>{copy.openLogsButton}</span>
            </button>
          </div>
        </section>
      ) : null}

      <HealthCheckPanel summary={summary} post={post} busy={busy} />
    </div>
  );
}

function DashboardMetric({
  icon: Icon,
  label,
  value,
  tone
}: {
  icon: typeof Globe;
  label: string;
  value: string;
  tone: "green" | "amber" | "red";
}) {
  return (
    <div className={`dashboard-metric ${tone}`}>
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FirstRunWizard({
  summary,
  installJobs,
  startRuntimeInstall,
  request,
  refresh,
  busy,
  error,
  language,
  onFinish
}: {
  summary: DashboardSummary;
  installJobs: RuntimeJobMap;
  startRuntimeInstall: (kind: RuntimeKind, version?: string, force?: boolean) => Promise<RuntimeInstallJob | undefined>;
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
  refresh: () => Promise<void>;
  busy: boolean;
  error: string | null;
  language: AppLanguage;
  onFinish: () => void;
}) {
  const [step, setStep] = useState<WizardStepId>("install");
  const [sitesFolder, setSitesFolder] = useState(summary.config.parkedFolders[0] ?? defaultSitesFolder(summary));
  const [taskStates, setTaskStates] = useState<Record<string, WizardTaskState>>({});
  const [running, setRunning] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [wizardWarning, setWizardWarning] = useState<string | null>(null);
  const [showTimeline, setShowTimeline] = useState(false);
  const [mysqlVersion, setMysqlVersion] = useState(() => {
    // Prefer the configured version if it's installed; otherwise prefer MariaDB
    // (it bundles its own VC++ DLLs on Windows, so it initializes reliably even
    // when the system Visual C++ Redistributable is missing/incomplete).
    const configured = summary.config.mysql.version;
    const configuredInstalled = selectedMysqlRuntime(summary, configured)?.installed;
    if (configuredInstalled) {
      return configured;
    }
    const preferred = preferredDatabaseRuntime(summary.runtimes.mysql);
    return preferred?.version ?? configured;
  });
  const startedRef = useRef(false);

  const phpRuntime = preferredRuntime(summary.runtimes.php);
  const mysqlRuntime = selectedMysqlRuntime(summary, mysqlVersion) ?? selectedMysqlRuntime(summary, summary.config.mysql.version) ?? summary.runtimes.mysql[0];
  const phpVersion = phpRuntime?.version ?? summary.config.globalPhpVersion;
  const selectedDatabaseLabel = databaseRuntimeDisplay(mysqlRuntime);
  const mysqlVersionsKey = summary.runtimes.mysql.map((runtime) => runtime.version).join("|");
  const canStart = sitesFolder.trim().length > 0;
  const steps: Array<{ id: WizardStepId; label: string; detail: string }> = [
    { id: "folder", label: t("wizard.step.sites", language), detail: pathTail(sitesFolder) || t("wizard.step.chooseFolder", language) },
    { id: "install", label: t("wizard.step.stack", language), detail: running ? t("wizard.step.installing", language) : `${taskDefinitionsLabel(summary, phpVersion, mysqlVersion)}` },
    { id: "finish", label: t("wizard.step.ready", language), detail: t("wizard.step.openWorkspace", language) }
  ];
  const activeStepIndex = steps.findIndex((item) => item.id === step);
  const taskDefinitions = useMemo(
    () =>
      firstRunTaskDefinitions(summary, {
        phpVersion,
        mysqlVersion,
        sitesFolder: sitesFolder.trim()
      }),
    [summary, phpVersion, mysqlVersion, sitesFolder]
  );
  const resolvedCount = taskDefinitions.filter((task) => {
    const status = taskStates[task.id]?.status;
    return status === "complete" || (task.optional && status === "failed");
  }).length;
  const setupFinished = taskDefinitions.length > 0 && resolvedCount === taskDefinitions.length;
  const setupPercent = taskDefinitions.length ? Math.round((resolvedCount / taskDefinitions.length) * 100) : 0;
  const completedTaskCount = taskDefinitions.filter((task) => taskStates[task.id]?.status === "complete").length;
  const activeTaskIndex = Math.max(
    0,
    taskDefinitions.findIndex((task) => (taskStates[task.id]?.status ?? "pending") !== "complete")
  );
  const compactTaskLimit = 6;
  const visibleTaskDefinitions = showTimeline
    ? taskDefinitions
    : taskDefinitions.filter((task, index) => {
        const status = taskStates[task.id]?.status ?? "pending";
        if (status === "complete") {
          return false;
        }
        if (status === "running" || status === "failed") {
          return true;
        }
        return index >= activeTaskIndex && index < activeTaskIndex + compactTaskLimit;
      });
  const hiddenTaskCount = taskDefinitions.length - visibleTaskDefinitions.length;

  function updateTask(id: string, status: WizardTaskStatus, message?: string) {
    setTaskStates((current) => ({
      ...current,
      [id]: { status, message }
    }));
  }

  useEffect(() => {
    if (summary.runtimes.mysql.length && !summary.runtimes.mysql.some((runtime) => runtime.version === mysqlVersion)) {
      setMysqlVersion(summary.config.mysql.version);
    }
  }, [mysqlVersion, mysqlVersionsKey, summary.config.mysql.version, summary.runtimes.mysql]);

  async function runSetup() {
    if (!canStart) {
      setWizardError(t("wizard.chooseFolderFirst", language));
      setStep("folder");
      return;
    }

    setStep("install");
    setRunning(true);
    setWizardError(null);
    setWizardWarning(null);

    try {
      setTaskStates({});
      const optionalFailures: string[] = [];
      for (const task of taskDefinitions) {
        try {
          if (task.runtime) {
            await runRuntimeWizardTask(task, summary, startRuntimeInstall, refresh, updateTask);
          } else {
            await runActionWizardTask(task, async () => {
              switch (task.id) {
                case "park":
                  await request("/api/sites/park", { path: sitesFolder.trim(), primary: true });
                  break;
                case "configure":
                  await request("/api/php-fcgi/stop").catch(() => undefined);
                  await request("/api/php/versions", { versions: [phpVersion], globalVersion: phpVersion });
                  if (mysqlVersion !== summary.config.mysql.version) {
                    await request("/api/mysql/stop").catch(() => undefined);
                    await request("/api/mysql/version", { version: mysqlVersion });
                  }
                  break;
                case "mysql-init":
                  await request("/api/mysql/init");
                  break;
                case "phpmyadmin":
                  await request("/api/phpmyadmin/install");
                  break;
                case "laravel-installer":
                  await request("/api/laravel-installer/install");
                  break;
                case "php-start":
                  await request("/api/php-fcgi/start");
                  break;
                case "mysql-start":
                  await request("/api/mysql/start");
                  break;
                case "redis-start":
                  await request("/api/redis/start");
                  break;
                case "nginx-start":
                  await request("/api/nginx/start");
                  break;
                case "ca-trust":
                  await request("/api/ssl/trust", { wait: true });
                  break;
                case "hosts-sync":
                  await request("/api/hosts/sync");
                  break;
                case "complete":
                  await request("/api/setup/complete");
                  break;
              }
              await refresh();
            }, updateTask);
          }
        } catch (taskError) {
          if (!task.optional) {
            throw taskError;
          }
          optionalFailures.push(task.label);
        }
      }
      if (optionalFailures.length) {
        setWizardWarning(`${optionalFailures.join(", ")} can be configured later from their pages.`);
      }
      setStep("finish");
    } catch (setupError) {
      setWizardError(setupError instanceof Error ? setupError.message : String(setupError));
    } finally {
      setRunning(false);
      await refresh();
    }
  }

  async function browseFolder() {
    const payload = (await request("/api/dialog/folder", { initialPath: sitesFolder })) as { path?: string | null };
    if (payload.path) {
      setSitesFolder(payload.path);
    }
  }

  // Auto-start setup on first mount so the user never has to click anything.
  // Defaults: <home>\Sites folder, highest PHP, configured database, all services + Redis + CA trust + hosts.
  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    if (setupFinished || summary.config.setupComplete) {
      setStep("finish");
      return;
    }
    startedRef.current = true;
    void runSetup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-open the workspace shortly after setup completes (no click required).
  useEffect(() => {
    if (!setupFinished || running) {
      return;
    }
    const timer = window.setTimeout(() => onFinish(), 1300);
    return () => window.clearTimeout(timer);
  }, [setupFinished, running, onFinish]);

  return (
    <div className="wizard-shell">
      <aside className="wizard-rail">
        <div className="brand">
          <div className="brand-mark">L</div>
          <div>
            <strong>laraboxs</strong>
            <span>{t("wizard.firstLaunch", language)}</span>
          </div>
        </div>
        <div className="wizard-step-list">
          {steps.map((item, index) => (
            <button
              key={item.id}
              className={["wizard-step", step === item.id ? "active" : "", index < activeStepIndex ? "done" : ""].filter(Boolean).join(" ")}
              disabled={running || (item.id === "finish" && !setupFinished)}
              onClick={() => setStep(item.id)}
            >
              <span>{index < activeStepIndex || (item.id === "finish" && setupFinished) ? <CheckCircle2 size={15} /> : index + 1}</span>
              <div>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </div>
            </button>
          ))}
        </div>
      </aside>

      <main className="wizard-main">
        <header className="wizard-titlebar">
          <div>
            <span className="eyebrow">{t("wizard.localStack", language)}</span>
            <h1>{step === "finish" ? t("wizard.ready", language) : t("wizard.setUp", language)}</h1>
          </div>
          <button className="icon-button" onClick={() => void refresh()} disabled={busy || running} title={t("action.refresh", language)}>
            <RotateCw size={18} />
            <span>{t("action.refresh", language)}</span>
          </button>
        </header>

        {error || wizardError || wizardWarning ? <div className="notice wizard-notice">{wizardError ?? error ?? wizardWarning}</div> : null}

        <section className="wizard-content">
          {step === "folder" ? (
            <div className="wizard-page wizard-folder-page">
              <div className="wizard-copy">
                <span className="eyebrow">{t("wizard.sitesFolderEyebrow", language)}</span>
                <h2>{t("wizard.chooseSites", language)}</h2>
                <p>{t("wizard.parkHint", language)}</p>
              </div>
              <div className="wizard-folder-card">
                <label>
                  <span>{t("wizard.sitesFolderLabel", language)}</span>
                  <div className="path-picker">
                    <input value={sitesFolder} onChange={(event) => setSitesFolder(event.target.value)} />
                    <button type="button" className="field-icon-button" disabled={busy || running} onClick={() => void browseFolder()} title={t("wizard.browse", language)}>
                      <FolderOpen size={18} />
                    </button>
                  </div>
                </label>
                <div className="button-row">
                  <button disabled={busy || running} onClick={() => setSitesFolder(defaultSitesFolder(summary))}>
                    <RotateCw size={18} />
                    <span>{t("wizard.useDefault", language)}</span>
                  </button>
                </div>
              </div>

              <div className="wizard-stack-preview">
                <StackPreviewItem icon={SquareTerminal} title={`PHP ${phpVersion}`} runtime={phpRuntime} />
                <StackPreviewItem icon={Database} title={selectedDatabaseLabel} runtime={mysqlRuntime} />
                <StackPreviewItem icon={Server} title={`Nginx ${summary.runtimes.nginx.version}`} runtime={summary.runtimes.nginx} />
                <StackPreviewItem icon={Database} title={`Redis ${summary.runtimes.redis.version}`} runtime={summary.runtimes.redis} />
                <StackPreviewItem icon={PackageCheck} title="Composer stable" runtime={summary.runtimes.composer} />
                <StackPreviewItem icon={SquareTerminal} title={`Node.js ${summary.runtimes.node.version}`} runtime={summary.runtimes.node} />
              </div>
              <div className="wizard-runtime-choice">
                <span className="eyebrow">{t("wizard.database", language)}</span>
                <DatabaseRuntimePicker runtimes={summary.runtimes.mysql} value={mysqlVersion} onChange={setMysqlVersion} />
              </div>
            </div>
          ) : null}

          {step === "install" ? (
            <div className="wizard-page wizard-install-page">
              <div className="wizard-install-header">
                <div className="wizard-copy">
                  <span className="eyebrow">{t("wizard.settingUp", language)}</span>
                  <h2>{t("wizard.preparingStack", language)}</h2>
                </div>
                <div className="wizard-progress-summary">
                  <strong>{setupPercent}%</strong>
                  <span>
                    {resolvedCount}/{taskDefinitions.length} {t("wizard.complete", language)}
                  </span>
                  <button
                    className="field-icon-button"
                    disabled={running}
                    onClick={() => setStep("folder")}
                    title={t("wizard.customizeHint", language)}
                  >
                    <SlidersHorizontal size={16} />
                    <span>{t("wizard.customize", language)}</span>
                  </button>
                </div>
              </div>
              <div className="progress-track wizard-overall-progress">
                <div className="progress-fill" style={{ width: `${setupPercent}%` }} />
              </div>
              <div className="wizard-task-toolbar">
                <span>
                  {showTimeline
                    ? `Showing full timeline (${taskDefinitions.length} steps)`
                    : completedTaskCount
                      ? `${completedTaskCount} completed hidden; showing current steps`
                      : "Showing current setup steps"}
                </span>
                <button type="button" onClick={() => setShowTimeline((value) => !value)} title={showTimeline ? "Hide completed timeline" : "Show full timeline"}>
                  <ListRestart size={16} />
                  <span>{showTimeline ? "Hide Timeline" : "Show Timeline"}</span>
                </button>
              </div>
              <div className={["wizard-task-list", showTimeline ? "timeline" : "compact"].join(" ")}>
                {visibleTaskDefinitions.map((task) => (
                  <WizardTaskRow key={task.id} task={task} state={taskStates[task.id]} installJobs={installJobs} />
                ))}
                {!showTimeline && hiddenTaskCount > 0 ? (
                  <button type="button" className="wizard-hidden-tasks" onClick={() => setShowTimeline(true)}>
                    <ListRestart size={16} />
                    <span>{hiddenTaskCount} more steps in timeline</span>
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {step === "finish" ? (
            <div className="wizard-page wizard-finish">
              <CheckCircle2 size={46} />
              <div>
                <span className="eyebrow">{t("wizard.completeEyebrow", language)}</span>
                <h2>{t("wizard.stackReady", language)}</h2>
                <p>{pathTail(sitesFolder) || t("wizard.sitesFolderLabel", language)} {t("wizard.parkedWith", language)} PHP {phpVersion}, Nginx, {selectedDatabaseLabel}, Composer, Node.js.</p>
              </div>
            </div>
          ) : null}
        </section>

        <footer className="wizard-footer">
          <button disabled={running || step === "folder"} onClick={() => setStep(steps[Math.max(0, activeStepIndex - 1)].id)}>
            <ChevronLeft size={18} />
            <span>{t("wizard.back", language)}</span>
          </button>
          {step === "folder" ? (
            <button className="primary" disabled={running || busy || !canStart} onClick={() => void runSetup()}>
              <Download size={18} />
              <span>{t("wizard.continue", language)}</span>
            </button>
          ) : null}
          {step === "install" ? (
            <button className="primary" disabled={running || busy || setupFinished} onClick={() => void runSetup()}>
              {running ? <LoaderCircle className="spin" size={18} /> : <PackageCheck size={18} />}
              <span>{running ? t("wizard.preparing", language) : wizardError ? t("wizard.retrySetup", language) : setupFinished ? t("wizard.completeEyebrow", language) : t("wizard.startSetup", language)}</span>
            </button>
          ) : null}
          {step === "finish" ? (
            <button className="primary" disabled={!setupFinished && !summary.config.setupComplete} onClick={onFinish}>
              <CheckCircle2 size={18} />
              <span>{t("wizard.openLaraboxs", language)}</span>
            </button>
          ) : null}
        </footer>
      </main>
    </div>
  );
}

function StackPreviewItem({ icon: Icon, title, runtime }: { icon: typeof Globe; title: string; runtime?: RuntimeInstallStatus }) {
  const ready = Boolean(runtime?.installed && !runtime.updateAvailable);
  return (
    <div className="stack-preview-item">
      <Icon size={19} />
      <div>
        <strong>{title}</strong>
        <span>{ready ? runtimeDisplayVersion(runtime!) : runtime?.installed ? "Update during setup" : "Download during setup"}</span>
      </div>
      <Badge label={ready ? "ready" : runtime?.installed ? "update" : "latest"} tone={ready ? "green" : "amber"} />
    </div>
  );
}

function WizardTaskRow({ task, state, installJobs }: { task: WizardTaskDefinition; state?: WizardTaskState; installJobs: RuntimeJobMap }) {
  const status = state?.status ?? "pending";
  const runtimeJob = task.runtime ? latestRuntimeJob(Object.values(installJobs), task.runtime.kind, task.runtime.version ?? "") : undefined;
  const showRuntimeProgress = runtimeJob ? isActiveRuntimeJob(runtimeJob) || runtimeJob.status === "failed" : false;
  const runtimePercent = runtimeJob ? Math.max(runtimeJob.percent, isActiveRuntimeJob(runtimeJob) ? 4 : 0) : 0;

  return (
    <div className={`wizard-task ${status}`}>
      <div className="wizard-task-icon">
        {status === "complete" ? <CheckCircle2 size={18} /> : status === "running" ? <LoaderCircle className="spin" size={18} /> : status === "failed" ? <CircleStop size={18} /> : <PackageCheck size={18} />}
      </div>
      <div className="wizard-task-main">
        <div className="wizard-task-title">
          <strong>{task.label}</strong>
          <span>{state?.message ?? task.detail}</span>
        </div>
        {showRuntimeProgress && runtimeJob ? (
          <div className={`wizard-task-progress ${runtimeJob.status === "failed" ? "failed" : ""}`} aria-label={`${runtimeJob.name} ${runtimeJob.version} install progress`}>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${runtimePercent}%` }} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

async function runActionWizardTask(task: WizardTaskDefinition, action: () => Promise<void>, updateTask: (id: string, status: WizardTaskStatus, message?: string) => void) {
  updateTask(task.id, "running", task.detail);
  try {
    await action();
    updateTask(task.id, "complete", "Complete");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateTask(task.id, "failed", message);
    throw error;
  }
}

async function runRuntimeWizardTask(
  task: WizardTaskDefinition,
  summary: DashboardSummary,
  startRuntimeInstall: (kind: RuntimeKind, version?: string, force?: boolean) => Promise<RuntimeInstallJob | undefined>,
  refresh: () => Promise<void>,
  updateTask: (id: string, status: WizardTaskStatus, message?: string) => void
) {
  const runtime = task.runtime ? selectedRuntimeStatus(summary, task.runtime.kind, task.runtime.version) : undefined;
  if (runtime?.installed && !runtime.updateAvailable) {
    updateTask(task.id, "complete", "Already installed");
    return;
  }

  updateTask(task.id, "running", runtime?.updateAvailable ? "Updating runtime" : "Starting download");
  const job = task.runtime ? await startRuntimeInstall(task.runtime.kind, task.runtime.version, Boolean(runtime?.updateAvailable)) : undefined;
  if (!job) {
    const message = `Could not start ${task.label}.`;
    updateTask(task.id, "failed", message);
    throw new Error(message);
  }

  const finishedJob = await waitForRuntimeJob(job, (currentJob) => {
    updateTask(task.id, "running", currentJob.message ?? statusLabel(currentJob.status));
  });

  if (finishedJob.status === "failed") {
    const message = finishedJob.error ?? finishedJob.message ?? `${task.label} failed.`;
    if (isRecoverableRuntimeInstallFailure(finishedJob)) {
      updateTask(task.id, "complete", message);
      await refresh();
      return;
    }
    updateTask(task.id, "failed", message);
    throw new Error(message);
  }

  updateTask(task.id, "complete", "Installed");
  await refresh();
}

async function waitForRuntimeJob(job: RuntimeInstallJob, onUpdate: (job: RuntimeInstallJob) => void): Promise<RuntimeInstallJob> {
  let currentJob = job;
  onUpdate(currentJob);

  while (isActiveRuntimeJob(currentJob)) {
    await sleep(900);
    currentJob = await fetchRuntimeInstallJob(currentJob.id);
    onUpdate(currentJob);
  }

  return currentJob;
}

function isRecoverableRuntimeInstallFailure(job: RuntimeInstallJob): boolean {
  const message = `${job.error ?? ""} ${job.message ?? ""}`;
  return job.kind === "php" && /disabled .+ automatically/i.test(message) && /can continue running/i.test(message);
}

function firstRunTaskDefinitions(
  summary: DashboardSummary,
  options: {
    phpVersion: string;
    mysqlVersion: string;
    sitesFolder: string;
  }
): WizardTaskDefinition[] {
  const databaseRuntime = selectedMysqlRuntime(summary, options.mysqlVersion);
  const databaseLabel = databaseRuntimeDisplay(databaseRuntime);
  const databaseName = databaseEngineName(databaseRuntime);
  const tasks: WizardTaskDefinition[] = [
    { id: "park", label: "Park sites folder", detail: options.sitesFolder },
    { id: "configure", label: "Apply selected versions", detail: `Use PHP ${options.phpVersion} and ${databaseLabel}` },
    { id: `php-${options.phpVersion}`, label: `Prepare PHP ${options.phpVersion}`, detail: "Download PHP CLI and FastCGI", runtime: { kind: "php", version: options.phpVersion } },
    { id: "nginx", label: "Prepare Nginx", detail: "Download the local web server", runtime: { kind: "nginx", version: summary.runtimes.nginx.version } },
    { id: `mysql-${options.mysqlVersion}`, label: `Prepare ${databaseLabel}`, detail: "Download the database runtime", runtime: { kind: "mysql", version: options.mysqlVersion } },
    { id: "redis", label: "Prepare Redis", detail: "Download the local cache service", runtime: { kind: "redis", version: summary.runtimes.redis.version } },
    { id: "composer", label: "Prepare Composer", detail: "Install Composer for Laravel packages", runtime: { kind: "composer", version: summary.runtimes.composer.version } },
    { id: "node", label: "Prepare Node.js", detail: "Install frontend tooling runtime", runtime: { kind: "node", version: summary.runtimes.node.version } },
    { id: "laravel-installer", label: "Install Laravel Installer", detail: "Install laravel/installer for new Laravel sites" }
  ];

  tasks.push({ id: "mysql-init", label: `Initialize ${databaseName}`, detail: "Create data directory and root password" });
  if (!summary.phpMyAdmin.installed) {
    tasks.push({ id: "phpmyadmin", label: "Install phpMyAdmin", detail: "Create the database admin site", optional: true });
  }
  tasks.push(
    { id: "php-start", label: "Start PHP FastCGI", detail: "Launch the selected PHP worker" },
    { id: "mysql-start", label: `Start ${databaseName}`, detail: "Start the local database service" },
    { id: "redis-start", label: "Start Redis", detail: "Launch the local cache service" }
  );
  tasks.push(
    { id: "nginx-start", label: "Start Nginx", detail: "Serve local sites" },
    { id: "ca-trust", label: "Trust local HTTPS CA", detail: "Enable https:// for local sites without browser warnings", optional: true },
    { id: "hosts-sync", label: "Sync local domains", detail: "Update the Windows hosts file", optional: true },
    { id: "complete", label: "Save setup state", detail: "Open the workspace" }
  );

  return tasks;
}

function needsFirstRunSetup(summary: DashboardSummary): boolean {
  if (!summary.config.setupComplete) {
    return true;
  }

  return summary.config.parkedFolders.length === 0 || !baseStackInstalled(summary);
}

function baseStackInstalled(summary: DashboardSummary): boolean {
  return Boolean(
    selectedPhpRuntime(summary, summary.config.globalPhpVersion)?.installed &&
      selectedMysqlRuntime(summary, summary.config.mysql.version)?.installed &&
      summary.runtimes.nginx.installed &&
      summary.runtimes.redis.installed &&
      summary.runtimes.composer.installed
  );
}

function selectedRuntimeStatus(summary: DashboardSummary, kind: RuntimeKind, version?: string): RuntimeInstallStatus | undefined {
  switch (kind) {
    case "php":
      return selectedPhpRuntime(summary, version ?? summary.config.globalPhpVersion);
    case "mysql":
      return selectedMysqlRuntime(summary, version ?? summary.config.mysql.version);
    case "nginx":
      return summary.runtimes.nginx;
    case "redis":
      return summary.runtimes.redis;
    case "node":
      return summary.runtimes.node;
    case "composer":
      return summary.runtimes.composer;
  }
}

function selectedPhpRuntime(summary: DashboardSummary, version: string): RuntimeInstallStatus | undefined {
  return summary.runtimes.php.find((runtime) => runtime.version === version) ?? summary.runtimes.php[0];
}

function selectedMysqlRuntime(summary: DashboardSummary, version: string): RuntimeInstallStatus | undefined {
  return summary.runtimes.mysql.find((runtime) => runtime.version === version) ?? summary.runtimes.mysql[0];
}

function databaseRuntimeDisplay(runtime?: RuntimeInstallStatus): string {
  return runtime ? `${databaseEngineName(runtime)} ${databaseVersionDisplay(runtime.version)}` : "Database";
}

function databaseEngineName(runtime?: RuntimeInstallStatus): string {
  return runtime?.name === "MariaDB" ? "MariaDB" : "MySQL";
}

function databaseEngineKey(runtime?: RuntimeInstallStatus): DatabaseEngine {
  return runtime?.name === "MariaDB" || runtime?.version.toLowerCase().startsWith("mariadb-") ? "mariadb" : "mysql";
}

function databaseRuntimesForEngine(runtimes: RuntimeInstallStatus[], engine: DatabaseEngine): RuntimeInstallStatus[] {
  return runtimes.filter((runtime) => databaseEngineKey(runtime) === engine);
}

function preferredDatabaseRuntime(runtimes: RuntimeInstallStatus[]): RuntimeInstallStatus | undefined {
  const installed = runtimes.filter((runtime) => runtime.installed);
  return preferredRuntime(installed.length ? installed : runtimes);
}

function databaseVersionDisplay(version: string): string {
  return version.toLowerCase().startsWith("mariadb-") ? version.slice("mariadb-".length) : version;
}

function preferredRuntime(items: RuntimeInstallStatus[]): RuntimeInstallStatus | undefined {
  return [...items].sort((left, right) => compareVersionStrings(right.version, left.version))[0];
}

function compareVersionStrings(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return left.localeCompare(right);
}

function versionParts(version: string): number[] {
  return version.match(/\d+/g)?.map((part) => Number(part)) ?? [];
}

function defaultSitesFolder(summary: DashboardSummary): string {
  const match = summary.paths.home.match(/^(.*)[\\/]\.config[\\/]laraboxs$/i);
  return `${match?.[1] ?? summary.paths.home}\\Sites`;
}

function pathTail(folder: string): string {
  const trimmed = folder.trim().replace(/[\\/]+$/g, "");
  return trimmed.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
}

function normalizeSiteName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function joinWindowsPath(parent: string, child: string): string {
  const base = parent.trim().replace(/[\\/]+$/g, "");
  return child ? `${base}\\${child}` : base;
}

function taskDefinitionsLabel(summary: DashboardSummary, phpVersion: string, mysqlVersion: string): string {
  const count = firstRunTaskDefinitions(summary, { phpVersion, mysqlVersion, sitesFolder: "" }).length;
  return `${count} automatic tasks`;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function Services({
  summary,
  post,
  request,
  installJobs,
  startRuntimeInstall,
  busy,
  language
}: ViewProps & {
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
  installJobs: RuntimeJobMap;
  startRuntimeInstall: (kind: RuntimeKind, version?: string, force?: boolean) => Promise<RuntimeInstallJob | undefined>;
}) {
  const [phpVersion, setPhpVersion] = useState(summary.config.globalPhpVersion);
  const [mysqlVersion, setMysqlVersion] = useState(summary.config.mysql.version);
  const [mysqlPort, setMysqlPort] = useState(String(summary.config.mysql.port));
  const [redisPort, setRedisPort] = useState(String(summary.config.redis.port));
  const [servicesPane, setServicesPane] = useState<ServicesPane>("all");
  const [databaseName, setDatabaseName] = useState("app_name");
  const [envText, setEnvText] = useState("");
  const [rootPassword, setRootPassword] = useState("");
  const [showRootPassword, setShowRootPassword] = useState(false);
  const [newRootPassword, setNewRootPassword] = useState("");
  const [phpSettings, setPhpSettings] = useState<PhpConfig>({
    ...summary.config.php,
    xdebugEnabled: summary.config.php.xdebugEnabled ?? false,
    xdebugIdeKey: summary.config.php.xdebugIdeKey ?? "PHPSTORM"
  });
  const [phpExtensions, setPhpExtensions] = useState<PhpExtensionStatus[]>([]);
  const [phpIniPath, setPhpIniPath] = useState("");
  const [phpSettingsLoading, setPhpSettingsLoading] = useState(false);
  const [phpSettingsSaving, setPhpSettingsSaving] = useState(false);
  const confirm = useDesktopConfirm();
  const jobs = Object.values(installJobs);
  const phpRuntime = summary.runtimes.php.find((runtime) => runtime.version === phpVersion) ?? summary.runtimes.php[0];
  const mysqlRuntime = summary.runtimes.mysql.find((runtime) => runtime.version === mysqlVersion) ?? summary.runtimes.mysql[0];
  const activeMysqlRuntime = selectedMysqlRuntime(summary, summary.config.mysql.version);
  const activePhpRuntime = summary.runtimes.php.find((runtime) => runtime.version === summary.config.globalPhpVersion);
  const activeDatabaseName = databaseEngineName(activeMysqlRuntime);
  const activeDatabaseLabel = databaseRuntimeDisplay(activeMysqlRuntime);
  const selectedDatabaseName = databaseEngineName(mysqlRuntime);
  const selectedDatabaseLabel = databaseRuntimeDisplay(mysqlRuntime);
  const phpJob = phpRuntime ? latestRuntimeJob(jobs, "php", phpRuntime.version) : undefined;
  const mysqlJob = mysqlRuntime ? latestRuntimeJob(jobs, "mysql", mysqlRuntime.version) : undefined;
  const nginxJob = latestRuntimeJob(jobs, "nginx", summary.runtimes.nginx.version);
  const redisJob = latestRuntimeJob(jobs, "redis", summary.runtimes.redis.version);
  const phpVersionsKey = summary.runtimes.php.map((runtime) => runtime.version).join("|");
  const mysqlVersionsKey = summary.runtimes.mysql.map((runtime) => runtime.version).join("|");
  const runningServices = [summary.services.php, summary.services.nginx, summary.services.mysql, summary.services.redis].filter(
    (service) => service.state === "running"
  ).length;
  const canStartInstalledStack = Boolean(activePhpRuntime?.installed && activeMysqlRuntime?.installed && summary.runtimes.nginx.installed);
  const showPhp = servicesPane === "php" || servicesPane === "all";
  const showNginx = servicesPane === "nginx" || servicesPane === "all";
  const showMysql = servicesPane === "mysql" || servicesPane === "all";
  const showRedis = servicesPane === "redis" || servicesPane === "all";
  const showPhpMyAdmin = servicesPane === "phpmyadmin" || servicesPane === "all";

  useEffect(() => {
    setMysqlPort(String(summary.config.mysql.port));
    setRedisPort(String(summary.config.redis.port));
  }, [summary.config.mysql.port, summary.config.redis.port]);

  useEffect(() => {
    if (summary.runtimes.php.length && !summary.runtimes.php.some((runtime) => runtime.version === phpVersion)) {
      setPhpVersion(summary.config.globalPhpVersion);
    }
  }, [phpVersion, phpVersionsKey, summary.config.globalPhpVersion, summary.runtimes.php]);

  useEffect(() => {
    if (summary.runtimes.mysql.length && !summary.runtimes.mysql.some((runtime) => runtime.version === mysqlVersion)) {
      setMysqlVersion(summary.config.mysql.version);
    }
  }, [mysqlVersion, mysqlVersionsKey, summary.config.mysql.version, summary.runtimes.mysql]);

  useEffect(() => {
    let cancelled = false;

    async function loadPhpSettings() {
      setPhpSettingsLoading(true);
      try {
        const payload = await getJson<PhpSettingsStatus>(`/api/php/settings?version=${encodeURIComponent(phpVersion)}`);
        if (!cancelled) {
          setPhpSettings(payload.settings);
          setPhpExtensions(payload.extensions);
          setPhpIniPath(payload.iniPath);
        }
      } catch {
        if (!cancelled) {
          setPhpSettings(summary.config.php);
          setPhpExtensions([]);
          setPhpIniPath("");
        }
      } finally {
        if (!cancelled) {
          setPhpSettingsLoading(false);
        }
      }
    }

    void loadPhpSettings();
    return () => {
      cancelled = true;
    };
  }, [
    phpVersion,
    summary.config.php.memoryLimit,
    summary.config.php.uploadMaxFilesize,
    summary.config.php.postMaxSize,
    summary.config.php.maxExecutionTime,
    summary.config.php.maxInputVars,
    summary.config.php.enabledExtensions.join("|")
  ]);

  async function useMysqlVersion() {
    if (summary.services.mysql.state === "running") {
      await post("/api/mysql/stop");
    }
    await post("/api/mysql/version", { version: mysqlVersion });
  }

  async function loadEnv() {
    const payload = (await request("/api/mysql/env", { name: databaseName })) as { env?: string };
    setEnvText(payload.env ?? "");
  }

  async function loadRootPassword() {
    const payload = (await request("/api/mysql/password")) as { password?: string };
    setRootPassword(payload.password ?? "");
    setShowRootPassword(true);
  }

  async function resetRootPassword() {
    const confirmed = await confirm({
      title: `Reset ${activeDatabaseName} root password?`,
      message: "Laraboxs will generate and store a new local root password.",
      details: [`Runtime: ${activeDatabaseLabel}`, "Use this only when the database service is running and you are ready to update local connection settings."],
      confirmLabel: "Reset Password",
      tone: "warning"
    });
    if (!confirmed) {
      return;
    }
    const payload = (await request("/api/mysql/reset-password")) as { password?: string };
    setRootPassword(payload.password ?? "");
    setNewRootPassword("");
    setShowRootPassword(true);
  }

  async function changeRootPassword() {
    const payload = (await request("/api/mysql/change-password", { password: newRootPassword })) as { password?: string };
    setRootPassword(payload.password ?? "");
    setNewRootPassword("");
    setShowRootPassword(true);
  }

  function updatePhpSetting(patch: Partial<PhpConfig>) {
    setPhpSettings((current) => ({ ...current, ...patch }));
  }

  function togglePhpExtension(name: string) {
    const enabled = new Set(phpSettings.enabledExtensions);
    if (enabled.has(name)) {
      enabled.delete(name);
    } else {
      enabled.add(name);
    }
    const next = { ...phpSettings, enabledExtensions: Array.from(enabled).sort() };
    setPhpSettings(next);
    // Herd-style: persist immediately instead of waiting for the Save button.
    void savePhpSettings(next);
  }

  async function savePhpSettings(settings: PhpConfig = phpSettings) {
    setPhpSettingsSaving(true);
    try {
      await post("/api/php/settings", { settings });
    } finally {
      setPhpSettingsSaving(false);
    }
  }

  async function startInstalledStack() {
    if (activePhpRuntime?.installed && summary.services.php.state !== "running") {
      await post("/api/php-fcgi/start");
    }
    if (activeMysqlRuntime?.installed && summary.services.mysql.state !== "running") {
      await post("/api/mysql/start");
    }
    if (summary.runtimes.redis.installed && summary.services.redis.state !== "running") {
      await post("/api/redis/start");
    }
    if (summary.runtimes.nginx.installed && summary.services.nginx.state !== "running") {
      await post("/api/nginx/start");
    }
  }

  async function stopRunningStack() {
    if (summary.services.nginx.state === "running") {
      await post("/api/nginx/stop");
    }
    if (summary.services.php.state === "running") {
      await post("/api/php-fcgi/stop");
    }
    if (summary.services.redis.state === "running") {
      await post("/api/redis/stop");
    }
    if (summary.services.mysql.state === "running") {
      await post("/api/mysql/stop");
    }
  }

  async function restartRunningStack() {
    if (summary.services.php.state === "running") {
      await post("/api/php-fcgi/restart");
    }
    if (summary.services.mysql.state === "running") {
      await post("/api/mysql/restart");
    }
    if (summary.services.redis.state === "running") {
      await post("/api/redis/restart");
    }
    if (summary.services.nginx.state === "running") {
      await post("/api/nginx/restart");
    }
  }

  return (
    <div className="services-view">
      <section className="services-command-bar">
        <div className="services-command-main">
          <ListRestart size={18} />
          <div>
            <strong>{language === "ar" ? "الخدمات" : "Services"}</strong>
            <span>{runningServices === 4 ? (language === "ar" ? "كل الخدمات الأساسية تعمل" : "All core services are running") : `${runningServices}/4 ${language === "ar" ? "خدمات تعمل" : "services running"}`}</span>
          </div>
        </div>
        <div className="services-command-actions">
          <button className="primary" disabled={busy || runningServices === 4 || !canStartInstalledStack} onClick={() => void startInstalledStack()} title="Start installed stack services">
            <Play size={16} />
            <span>{language === "ar" ? "تشغيل الكل" : "Start All"}</span>
          </button>
          <button disabled={busy || runningServices === 0} onClick={() => void restartRunningStack()} title="Restart currently running services">
            <RotateCw size={16} />
            <span>{language === "ar" ? "إعادة تشغيل" : "Restart"}</span>
          </button>
          <button disabled={busy || runningServices === 0} onClick={() => void stopRunningStack()} title="Stop running stack services">
            <CircleStop size={16} />
            <span>{language === "ar" ? "إيقاف الكل" : "Stop All"}</span>
          </button>
        </div>
      </section>

      <div className="services-workbench">
        <aside className="services-list" aria-label="Service list">
          <div className="service-group-label">{language === "ar" ? "خادم الويب" : "Web Server"}</div>
          <ServiceNavButton icon={Server} label="Nginx" detail={`Port ${summary.config.nginx.httpPort}`} service={summary.services.nginx} active={servicesPane === "nginx"} onClick={() => setServicesPane("nginx")} onStart={() => void post("/api/nginx/start")} onStop={() => void post("/api/nginx/stop")} busy={busy} language={language} />
          <ServiceNavButton icon={SquareTerminal} label="PHP" detail={summary.config.globalPhpVersion} service={summary.services.php} active={servicesPane === "php"} onClick={() => setServicesPane("php")} onStart={() => void post("/api/php-fcgi/start")} onStop={() => void post("/api/php-fcgi/stop")} busy={busy} language={language} />

          <div className="service-group-label">{language === "ar" ? "قاعدة البيانات" : "Database"}</div>
          <ServiceNavButton icon={Database} label={activeDatabaseName} detail={`Port ${summary.config.mysql.port}`} service={summary.services.mysql} active={servicesPane === "mysql"} onClick={() => setServicesPane("mysql")} onStart={() => void post("/api/mysql/start")} onStop={() => void post("/api/mysql/stop")} busy={busy} language={language} />
          <ServiceNavButton
            icon={Database}
            label="phpMyAdmin"
            detail={summary.phpMyAdmin.installed ? (language === "ar" ? "مثبّت" : "Installed") : (language === "ar" ? "غير مثبّت" : "Missing")}
            service={{
              name: "phpMyAdmin",
              state: summary.phpMyAdmin.installed ? "running" : "stopped",
              version: summary.phpMyAdmin.version
            }}
            active={servicesPane === "phpmyadmin"}
            onClick={() => setServicesPane("phpmyadmin")}
          />

          <div className="service-group-label">{language === "ar" ? "الكاش" : "Cache & Queue"}</div>
          <ServiceNavButton icon={Database} label="Redis" detail={`Port ${summary.config.redis.port}`} service={summary.services.redis} active={servicesPane === "redis"} onClick={() => setServicesPane("redis")} onStart={() => void post("/api/redis/start")} onStop={() => void post("/api/redis/stop")} busy={busy} language={language} />

          <button className={servicesPane === "all" ? "service-nav-all active" : "service-nav-all"} onClick={() => setServicesPane("all")} title={language === "ar" ? "كل الخدمات - عرض الحزمة كاملة" : "All Services - full stack view"}>
            <ListRestart size={16} />
            <span>{language === "ar" ? "كل الخدمات" : "All Services"}</span>
            {(() => {
              const running = [summary.services.php, summary.services.nginx, summary.services.mysql, summary.services.redis].filter((service) => service.state === "running").length;
              const tone = running === 4 ? "green" : running > 0 ? "amber" : "red";
              return <span className={`status-dot ${tone}`} title={`${running}/4 ${language === "ar" ? "خدمات تعمل" : "services running"}`} />;
            })()}
          </button>
        </aside>

        <div className="services-detail">
      <div className={`services-grid ${servicesPane === "all" ? "" : "focused-services-grid"}`}>
        {showPhp ? (
        <div className="service-panel">
          <ServiceHeader
            icon={SquareTerminal}
            title="PHP"
            service={summary.services.php}
            detail={`${summary.services.php.message ?? ""} ${phpFastCgiEndpoint(summary.config.globalPhpVersion)}`.trim()}
          />
          <RuntimePicker runtimes={summary.runtimes.php} value={phpVersion} onChange={setPhpVersion} />
          {phpJob && (isActiveRuntimeJob(phpJob) || phpJob.status === "failed") ? <RuntimeProgress job={phpJob} /> : null}
          <div className="service-actions">
            {phpRuntime ? (
              <button
                title={runtimeActionLabel(phpRuntime, phpJob, "Install PHP")}
                className={!phpRuntime.installed || phpRuntime.updateAvailable ? "primary" : ""}
                disabled={busy || (phpRuntime.installed && !phpRuntime.updateAvailable) || Boolean(phpJob && isActiveRuntimeJob(phpJob))}
                onClick={() => void startRuntimeInstall("php", phpRuntime.version, Boolean(phpRuntime.updateAvailable))}
              >
                <Download size={18} />
                <span>{runtimeActionLabel(phpRuntime, phpJob, "Install")}</span>
              </button>
            ) : null}
            <button className="primary" title={language === "ar" ? "استخدام PHP المحدد" : "Use selected PHP"} disabled={busy || !phpRuntime?.installed || phpVersion === summary.config.globalPhpVersion} onClick={() => void post("/api/php/use", { version: phpVersion })}>
              <BadgeCheck size={18} />
              <span>{language === "ar" ? "استخدام" : "Use"}</span>
            </button>
            <button title={language === "ar" ? "تشغيل PHP" : "Start PHP"} disabled={busy || summary.services.php.state === "running"} onClick={() => void post("/api/php-fcgi/start")}>
              <Play size={18} />
              <span>{language === "ar" ? "تشغيل" : "Start"}</span>
            </button>
            <button title={language === "ar" ? "إيقاف PHP" : "Stop PHP"} disabled={busy} onClick={() => void post("/api/php-fcgi/stop")}>
              <CircleStop size={18} />
              <span>{language === "ar" ? "إيقاف" : "Stop"}</span>
            </button>
            <button title={language === "ar" ? "إعادة تشغيل PHP" : "Restart PHP"} disabled={busy} onClick={() => void post("/api/php-fcgi/restart")}>
              <RotateCw size={18} />
              <span>{language === "ar" ? "إعادة" : "Restart"}</span>
            </button>
          </div>
        </div>
        ) : null}

        {showPhp ? (
        <div className="service-panel wide-service-panel php-settings-service-panel">
          <ServiceHeader icon={Settings} title={language === "ar" ? "إعدادات PHP" : "PHP Settings"} service={summary.services.php} detail={phpIniPath || `PHP ${phpVersion}`} />
          <div className="settings-grid">
            <label>
              <span>memory_limit</span>
              <input value={phpSettings.memoryLimit} onChange={(event) => updatePhpSetting({ memoryLimit: event.target.value })} />
            </label>
            <label>
              <span>upload_max_filesize</span>
              <input value={phpSettings.uploadMaxFilesize} onChange={(event) => updatePhpSetting({ uploadMaxFilesize: event.target.value })} />
            </label>
            <label>
              <span>post_max_size</span>
              <input value={phpSettings.postMaxSize} onChange={(event) => updatePhpSetting({ postMaxSize: event.target.value })} />
            </label>
            <label>
              <span>max_execution_time</span>
              <input type="number" min="0" value={phpSettings.maxExecutionTime} onChange={(event) => updatePhpSetting({ maxExecutionTime: Number(event.target.value) })} />
            </label>
            <label>
              <span>max_input_vars</span>
              <input type="number" min="0" value={phpSettings.maxInputVars} onChange={(event) => updatePhpSetting({ maxInputVars: Number(event.target.value) })} />
            </label>
          </div>
          <div className="service-actions">
            <button className="primary" title={language === "ar" ? "حفظ إعدادات PHP وإعادة التشغيل" : "Save PHP settings and restart"} disabled={busy || phpSettingsSaving || phpSettingsLoading} onClick={() => void savePhpSettings()}>
              <BadgeCheck size={18} />
              <span>{language === "ar" ? "حفظ" : "Save"}</span>
            </button>
          </div>
          <div className="extensions-grid compact-extensions-grid">
            {phpExtensions.length ? (
              phpExtensions.map((extension) => (
                <label key={extension.name} className={!extension.available ? "extension-toggle unavailable" : "extension-toggle"} title={extension.available ? extension.name : `${extension.name} unavailable`}>
                  <input
                    type="checkbox"
                    checked={phpSettings.enabledExtensions.includes(extension.name)}
                    disabled={!extension.available || phpSettingsSaving || phpSettingsLoading}
                    onChange={() => togglePhpExtension(extension.name)}
                  />
                  <span>{extension.name}</span>
                </label>
              ))
            ) : (
              <span className="muted">{phpSettingsLoading ? (language === "ar" ? "جارٍ تحميل الإضافات..." : "Loading extensions...") : language === "ar" ? "لا توجد إضافات." : "No extensions found."}</span>
            )}
          </div>
          <div className="xdebug-panel" style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
            <label className="compact-toggle">
              <input
                type="checkbox"
                checked={phpSettings.xdebugEnabled}
                disabled={phpSettingsSaving || phpSettingsLoading}
                onChange={() => {
                  const next = { ...phpSettings, xdebugEnabled: !phpSettings.xdebugEnabled };
                  setPhpSettings(next);
                  void savePhpSettings(next);
                }}
              />
              <span>Enable Xdebug</span>
            </label>
            <label style={{ display: "grid", gap: 4, marginTop: 6 }}>
              <span style={{ color: "var(--muted)", fontSize: 11, fontWeight: 800, textTransform: "uppercase" }}>Xdebug IDE key</span>
              <input
                value={phpSettings.xdebugIdeKey}
                disabled={!phpSettings.xdebugEnabled || phpSettingsSaving || phpSettingsLoading}
                onChange={(event) => {
                  setPhpSettings((current) => ({ ...current, xdebugIdeKey: event.target.value }));
                }}
              />
            </label>
          </div>
        </div>
        ) : null}

        {showNginx ? (
        <div className="service-panel">
          <ServiceHeader icon={Server} title="Nginx" service={summary.services.nginx} detail={`HTTP ${summary.config.nginx.httpPort} / HTTPS ${summary.config.nginx.httpsPort}`} />
          <RuntimePicker runtimes={[summary.runtimes.nginx]} value={summary.runtimes.nginx.version} onChange={() => undefined} />
          {nginxJob && (isActiveRuntimeJob(nginxJob) || nginxJob.status === "failed") ? <RuntimeProgress job={nginxJob} /> : null}
          <div className="service-actions">
            <button
              title={runtimeActionLabel(summary.runtimes.nginx, nginxJob, "Install Nginx")}
              className={!summary.runtimes.nginx.installed || summary.runtimes.nginx.updateAvailable ? "primary" : ""}
              disabled={busy || (summary.runtimes.nginx.installed && !summary.runtimes.nginx.updateAvailable) || Boolean(nginxJob && isActiveRuntimeJob(nginxJob))}
              onClick={() => void startRuntimeInstall("nginx", summary.runtimes.nginx.version, Boolean(summary.runtimes.nginx.updateAvailable))}
            >
              <Download size={18} />
              <span>{runtimeActionLabel(summary.runtimes.nginx, nginxJob, "Install")}</span>
            </button>
            <button title={language === "ar" ? "تشغيل Nginx" : "Start Nginx"} disabled={busy || summary.services.nginx.state === "running"} onClick={() => void post("/api/nginx/start")}>
              <Play size={18} />
              <span>{language === "ar" ? "تشغيل" : "Start"}</span>
            </button>
            <button title={language === "ar" ? "إيقاف Nginx" : "Stop Nginx"} disabled={busy} onClick={() => void post("/api/nginx/stop")}>
              <CircleStop size={18} />
              <span>{language === "ar" ? "إيقاف" : "Stop"}</span>
            </button>
            <button title={language === "ar" ? "إعادة تشغيل Nginx" : "Restart Nginx"} disabled={busy} onClick={() => void post("/api/nginx/restart")}>
              <RotateCw size={18} />
              <span>{language === "ar" ? "إعادة" : "Restart"}</span>
            </button>
          </div>
        </div>
        ) : null}

        {showMysql ? (
        <div className="service-panel wide-service-panel">
          <ServiceHeader icon={Database} title={activeDatabaseName} service={summary.services.mysql} detail={`${activeDatabaseLabel} · 127.0.0.1:${summary.config.mysql.port}`} />
          <DatabaseRuntimePicker runtimes={summary.runtimes.mysql} value={mysqlVersion} onChange={setMysqlVersion} />
          {mysqlJob && (isActiveRuntimeJob(mysqlJob) || mysqlJob.status === "failed") ? <RuntimeProgress job={mysqlJob} /> : null}
          <div className="service-actions">
            {mysqlRuntime ? (
              <button
                title={runtimeActionLabel(mysqlRuntime, mysqlJob, `Install ${selectedDatabaseLabel}`)}
                className={!mysqlRuntime.installed || mysqlRuntime.updateAvailable ? "primary" : ""}
                disabled={busy || (mysqlRuntime.installed && !mysqlRuntime.updateAvailable) || Boolean(mysqlJob && isActiveRuntimeJob(mysqlJob))}
                onClick={() => void startRuntimeInstall("mysql", mysqlRuntime.version, Boolean(mysqlRuntime.updateAvailable))}
              >
                <Download size={18} />
                <span>{runtimeActionLabel(mysqlRuntime, mysqlJob, "Install")}</span>
              </button>
            ) : null}
            <button className="primary" title={language === "ar" ? `استخدام ${selectedDatabaseName} المحدد` : `Use selected ${selectedDatabaseName}`} disabled={busy || !mysqlRuntime?.installed || mysqlVersion === summary.config.mysql.version} onClick={() => void useMysqlVersion()}>
              <BadgeCheck size={18} />
              <span>{language === "ar" ? "استخدام" : "Use"}</span>
            </button>
            <button title={language === "ar" ? `تهيئة ${activeDatabaseName}` : `Initialize ${activeDatabaseName}`} disabled={busy} onClick={() => void post("/api/mysql/init")}>
              <BadgeCheck size={18} />
              <span>{language === "ar" ? "تهيئة" : "Initialize"}</span>
            </button>
            <button title={language === "ar" ? `تشغيل ${activeDatabaseName}` : `Start ${activeDatabaseName}`} disabled={busy || summary.services.mysql.state === "running"} onClick={() => void post("/api/mysql/start")}>
              <Play size={18} />
              <span>{language === "ar" ? "تشغيل" : "Start"}</span>
            </button>
            <button title={language === "ar" ? `إيقاف ${activeDatabaseName}` : `Stop ${activeDatabaseName}`} disabled={busy} onClick={() => void post("/api/mysql/stop")}>
              <CircleStop size={18} />
              <span>{language === "ar" ? "إيقاف" : "Stop"}</span>
            </button>
            <button title={language === "ar" ? `إعادة تشغيل ${activeDatabaseName}` : `Restart ${activeDatabaseName}`} disabled={busy} onClick={() => void post("/api/mysql/restart")}>
              <RotateCw size={18} />
              <span>{language === "ar" ? "إعادة" : "Restart"}</span>
            </button>
            <button title={language === "ar" ? `فتح طرفية ${activeDatabaseName}` : `Open ${activeDatabaseName} shell`} disabled={busy} onClick={() => void post("/api/mysql/shell")}>
              <SquareTerminal size={18} />
              <span>{language === "ar" ? "طرفية" : "Shell"}</span>
            </button>
          </div>
          <div className="service-inline-settings">
            <input value={mysqlPort} onChange={(event) => setMysqlPort(event.target.value)} inputMode="numeric" />
            <button title={`Set ${activeDatabaseName} port`} disabled={busy || !mysqlPort.trim()} onClick={() => void post("/api/mysql/port", { port: Number(mysqlPort) })}>
              <Settings size={18} />
              <span>Set Port</span>
            </button>
            <button title={`Auto ${activeDatabaseName} port`} disabled={busy} onClick={() => void post("/api/mysql/port", { port: "auto" })}>
              <RotateCw size={18} />
              <span>Auto</span>
            </button>
          </div>
        </div>
        ) : null}

        {showRedis ? (
        <div className="service-panel">
          <ServiceHeader icon={Database} title="Redis" service={summary.services.redis} detail={`127.0.0.1:${summary.config.redis.port}`} />
          <RuntimePicker runtimes={[summary.runtimes.redis]} value={summary.runtimes.redis.version} onChange={() => undefined} />
          {redisJob && (isActiveRuntimeJob(redisJob) || redisJob.status === "failed") ? <RuntimeProgress job={redisJob} /> : null}
          <div className="service-actions">
            <button
              title={runtimeActionLabel(summary.runtimes.redis, redisJob, "Install Redis")}
              className={!summary.runtimes.redis.installed || summary.runtimes.redis.updateAvailable ? "primary" : ""}
              disabled={busy || (summary.runtimes.redis.installed && !summary.runtimes.redis.updateAvailable) || Boolean(redisJob && isActiveRuntimeJob(redisJob))}
              onClick={() => void startRuntimeInstall("redis", summary.runtimes.redis.version, Boolean(summary.runtimes.redis.updateAvailable))}
            >
              <Download size={18} />
              <span>{runtimeActionLabel(summary.runtimes.redis, redisJob, "Install")}</span>
            </button>
            <button title={language === "ar" ? "تشغيل Redis" : "Start Redis"} disabled={busy || summary.services.redis.state === "running"} onClick={() => void post("/api/redis/start")}>
              <Play size={18} />
              <span>{language === "ar" ? "تشغيل" : "Start"}</span>
            </button>
            <button title={language === "ar" ? "إيقاف Redis" : "Stop Redis"} disabled={busy} onClick={() => void post("/api/redis/stop")}>
              <CircleStop size={18} />
              <span>{language === "ar" ? "إيقاف" : "Stop"}</span>
            </button>
            <button title={language === "ar" ? "إعادة تشغيل Redis" : "Restart Redis"} disabled={busy} onClick={() => void post("/api/redis/restart")}>
              <RotateCw size={18} />
              <span>{language === "ar" ? "إعادة" : "Restart"}</span>
            </button>
            <button title={language === "ar" ? "فتح طرفية Redis" : "Open Redis CLI"} disabled={busy} onClick={() => void post("/api/redis/shell")}>
              <SquareTerminal size={18} />
              <span>{language === "ar" ? "طرفية" : "CLI"}</span>
            </button>
          </div>
          <div className="service-inline-settings">
            <input value={redisPort} onChange={(event) => setRedisPort(event.target.value)} inputMode="numeric" />
            <button title="Set Redis port" disabled={busy || !redisPort.trim()} onClick={() => void post("/api/redis/port", { port: Number(redisPort) })}>
              <Settings size={18} />
              <span>Set Port</span>
            </button>
          </div>
        </div>
        ) : null}

      </div>

      {showMysql || showPhpMyAdmin ? (
      <div className="service-panel tools-service-panel">
        <ServiceHeader
          icon={Database}
          title="Database Workbench"
          service={summary.services.mysql}
          detail={`${activeDatabaseLabel} · 127.0.0.1:${summary.config.mysql.port}`}
        />
        <div className="database-workbench">
          <div className="database-card database-create-card">
            <h2>Create Database</h2>
            <div className="service-inline-settings">
              <input value={databaseName} onChange={(event) => setDatabaseName(event.target.value)} />
              <button className="primary" title="Create database" disabled={busy || !databaseName.trim()} onClick={() => void post("/api/mysql/create-db", { name: databaseName })}>
                <Database size={18} />
                <span>Create</span>
              </button>
              <button title="Generate Laravel env" disabled={busy || !databaseName.trim()} onClick={() => void loadEnv()}>
                <FileText size={18} />
                <span>Laravel Env</span>
              </button>
            </div>
            {envText ? <pre className="snippet compact-snippet">{envText}</pre> : null}
          </div>

          <div className="database-card database-root-card">
            <h2>Root Password</h2>
            <div className="service-inline-settings">
              <input readOnly type={showRootPassword ? "text" : "password"} value={rootPassword} placeholder="Stored password" />
              <button title="Show root password" disabled={busy} onClick={() => void loadRootPassword()}>
                <KeyRound size={18} />
                <span>Show</span>
              </button>
              <button title="Reset root password" disabled={busy || summary.services.mysql.state !== "running"} onClick={() => void resetRootPassword()}>
                <RotateCw size={18} />
                <span>Reset</span>
              </button>
            </div>
            <div className="service-inline-settings">
              <input type="password" value={newRootPassword} onChange={(event) => setNewRootPassword(event.target.value)} placeholder="New root password" />
              <button className="primary" title="Change root password" disabled={busy || summary.services.mysql.state !== "running" || newRootPassword.length < 8} onClick={() => void changeRootPassword()}>
                <BadgeCheck size={18} />
                <span>Change</span>
              </button>
            </div>
          </div>

          <div className="database-card database-admin-card">
            <h2>phpMyAdmin</h2>
            <ServiceStrip
              service={{
                name: "phpMyAdmin",
                state: summary.phpMyAdmin.installed ? "running" : "stopped",
                version: summary.phpMyAdmin.version,
                message: summary.phpMyAdmin.installed ? summary.phpMyAdmin.url : "Not installed"
              }}
            />
            <div className="service-actions">
              <button className={!summary.phpMyAdmin.installed ? "primary" : ""} title="Install phpMyAdmin" disabled={busy || summary.phpMyAdmin.installed} onClick={() => void request("/api/phpmyadmin/install")}>
                <Download size={18} />
                <span>{summary.phpMyAdmin.installed ? "Installed" : "Install"}</span>
              </button>
              <button title="Sync hosts" disabled={busy || !summary.phpMyAdmin.installed} onClick={() => void post("/api/hosts/sync", {})}>
                <ListRestart size={18} />
                <span>Sync Hosts</span>
              </button>
              <button className="link-command-button" title="Open phpMyAdmin" disabled={busy || !summary.phpMyAdmin.installed} onClick={() => void openExternalUrl(summary.phpMyAdmin.url)}>
                <ExternalLink size={16} />
                <span>Open</span>
              </button>
            </div>
          </div>
        </div>

        <dl className="details compact-service-details">
          <dt>Database data</dt>
          <dd>{summary.paths.mysqlData}</dd>
          <dt>phpMyAdmin</dt>
          <dd>{summary.phpMyAdmin.installed ? summary.phpMyAdmin.root : "Not installed"}</dd>
        </dl>
      </div>
      ) : null}
        </div>
      </div>
    </div>
  );
}

function ServiceNavButton({
  icon: Icon,
  label,
  detail,
  service,
  active,
  onClick,
  onStart,
  onStop,
  busy,
  language
}: {
  icon: typeof Globe;
  label: string;
  detail: string;
  service: ServiceStatus;
  active: boolean;
  onClick: () => void;
  onStart?: () => void;
  onStop?: () => void;
  busy?: boolean;
  language?: AppLanguage;
}) {
  const tone = service.state === "running" ? "green" : service.state === "stopped" ? "red" : "amber";
  const running = service.state === "running";
  const startLabel = language === "ar" ? "تشغيل" : "Start";
  const stopLabel = language === "ar" ? "إيقاف" : "Stop";
  return (
    <div className={active ? "service-nav-item active" : "service-nav-item"}>
      <button type="button" className="service-nav-main" onClick={onClick} title={`${label} - ${detail} - ${service.state}`}>
        <span className={`status-dot ${tone}`} title={service.state} />
        <Icon size={17} />
        <div>
          <strong>{label}</strong>
          <span>{detail}</span>
        </div>
      </button>
      {onStart || onStop ? (
        running ? (
          <button type="button" className="service-nav-action" disabled={busy} onClick={onStop} title={`${stopLabel} ${label}`}>
            <CircleStop size={15} />
            <span>{stopLabel}</span>
          </button>
        ) : (
          <button type="button" className="service-nav-action primary" disabled={busy} onClick={onStart} title={`${startLabel} ${label}`}>
            <Play size={15} />
            <span>{startLabel}</span>
          </button>
        )
      ) : null}
    </div>
  );
}

function ServiceSnapshot({
  icon: Icon,
  label,
  value,
  detail,
  tone
}: {
  icon: typeof Globe;
  label: string;
  value: string;
  detail: string;
  tone: "green" | "amber" | "red";
}) {
  return (
    <div className="service-snapshot" title={`${label}: ${value} - ${detail}`}>
      <Icon size={18} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      <span className={`status-dot ${tone}`} />
    </div>
  );
}

function ServiceHeader({ icon: Icon, title, service, detail }: { icon: typeof Globe; title: string; service: ServiceStatus; detail?: string }) {
  const tone = service.state === "running" ? "green" : service.state === "stopped" ? "red" : "amber";
  return (
    <div className="service-panel-header">
      <Icon size={20} />
      <div>
        <strong>{title}</strong>
        <span>{detail || service.message || service.version || ""}</span>
      </div>
      <span className={`status-dot ${tone}`} title={service.state} />
    </div>
  );
}

function RuntimePicker({ runtimes, value, onChange }: { runtimes: RuntimeInstallStatus[]; value: string; onChange: (version: string) => void }) {
  return (
    <div className="runtime-picker">
      {runtimes.map((runtime) => (
        <button key={`${runtime.name}-${runtime.version}`} className={value === runtime.version ? "active" : ""} onClick={() => onChange(runtime.version)}>
          <strong>{runtimeDisplayVersion(runtime)}</strong>
          <span>{runtime.installed ? (runtime.updateAvailable ? "Update" : "Installed") : "Missing"}</span>
        </button>
      ))}
    </div>
  );
}

function DatabaseRuntimePicker({ runtimes, value, onChange }: { runtimes: RuntimeInstallStatus[]; value: string; onChange: (version: string) => void }) {
  const selectedRuntime = runtimes.find((runtime) => runtime.version === value) ?? runtimes[0];
  const selectedEngine = databaseEngineKey(selectedRuntime);
  const mysqlRuntimes = databaseRuntimesForEngine(runtimes, "mysql");
  const mariadbRuntimes = databaseRuntimesForEngine(runtimes, "mariadb");
  const visibleRuntimes = databaseRuntimesForEngine(runtimes, selectedEngine);

  function chooseEngine(engine: DatabaseEngine) {
    const nextRuntime = preferredDatabaseRuntime(databaseRuntimesForEngine(runtimes, engine));
    if (nextRuntime) {
      onChange(nextRuntime.version);
    }
  }

  return (
    <div className="database-runtime-picker">
      <div className="segmented database-engine-segmented" aria-label="Database engine">
        <button className={selectedEngine === "mysql" ? "active" : ""} disabled={!mysqlRuntimes.length} onClick={() => chooseEngine("mysql")}>
          MySQL
        </button>
        <button className={selectedEngine === "mariadb" ? "active" : ""} disabled={!mariadbRuntimes.length} onClick={() => chooseEngine("mariadb")}>
          MariaDB
        </button>
      </div>
      <RuntimePicker runtimes={visibleRuntimes} value={value} onChange={onChange} />
    </div>
  );
}

function Sites({
  summary,
  post,
  request,
  busy,
  language,
  onNavigate
}: ViewProps & {
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
  onNavigate: (section: Section) => void;
}) {
  const [folder, setFolder] = useState(summary.config.parkedFolders[0] ?? "");
  const [selectedDomain, setSelectedDomain] = useState(summary.sites[0]?.domain ?? "");
  const [siteTab, setSiteTab] = useState<SiteDetailTab>("general");
  const [newSiteOpen, setNewSiteOpen] = useState(false);
  const [siteSearch, setSiteSearch] = useState("");
  const [siteFilter, setSiteFilter] = useState<"all" | "laravel" | "secure" | "needs-ssl" | "isolated">("all");
  const selectedSite = summary.sites.find((site) => site.domain === selectedDomain) ?? summary.sites[0];
  const isLaravelSite = selectedSite?.framework === "Laravel";
  const [entryPath, setEntryPath] = useState(selectedSite?.entryPath ?? ".");
  const [sitePhpVersion, setSitePhpVersion] = useState(selectedSite?.phpVersion ?? summary.config.globalPhpVersion);
  const [siteHealth, setSiteHealth] = useState<SiteHealthStatus | null>(null);
  const [siteHealthLoading, setSiteHealthLoading] = useState(false);
  const [siteMenu, setSiteMenu] = useState<{ x: number; y: number; domain: string } | null>(null);
  const confirm = useDesktopConfirm();

  useEffect(() => {
    if (!siteMenu) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSiteMenu(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [siteMenu]);
  const laravelSitesCount = summary.sites.filter((site) => site.framework === "Laravel").length;
  const securedSitesCount = summary.sites.filter((site) => site.secured).length;
  const isolatedPhpCount = summary.sites.filter((site) => site.phpVersion !== summary.config.globalPhpVersion).length;
  const needsSslCount = summary.sites.length - securedSitesCount;

  const filteredSites = summary.sites.filter((site) => {
    const query = siteSearch.trim().toLowerCase();
    const matchesQuery =
      !query ||
      site.name.toLowerCase().includes(query) ||
      site.domain.toLowerCase().includes(query) ||
      site.path.toLowerCase().includes(query) ||
      site.framework.toLowerCase().includes(query);
    const matchesFilter =
      siteFilter === "all" ||
      (siteFilter === "laravel" && site.framework === "Laravel") ||
      (siteFilter === "secure" && site.secured) ||
      (siteFilter === "needs-ssl" && !site.secured) ||
      (siteFilter === "isolated" && site.phpVersion !== summary.config.globalPhpVersion);
    return matchesQuery && matchesFilter;
  });
  const siteFilterChips: Array<{ id: typeof siteFilter; label: string; count: number }> = [
    { id: "all", label: "All", count: summary.sites.length },
    { id: "laravel", label: "Laravel", count: laravelSitesCount },
    { id: "secure", label: "HTTPS", count: securedSitesCount },
    { id: "needs-ssl", label: "Needs SSL", count: needsSslCount },
    { id: "isolated", label: "PHP Override", count: isolatedPhpCount }
  ];

  async function browseFolder() {
    const payload = (await request("/api/dialog/folder", { initialPath: folder })) as { path?: string | null };
    if (payload.path) {
      setFolder(payload.path);
    }
  }

  useEffect(() => {
    if (!summary.sites.some((site) => site.domain === selectedDomain)) {
      setSelectedDomain(summary.sites[0]?.domain ?? "");
    }
  }, [summary.sites, selectedDomain]);

  useEffect(() => {
    setEntryPath(selectedSite?.entryPath ?? ".");
    setSitePhpVersion(selectedSite?.phpVersion ?? summary.config.globalPhpVersion);
  }, [selectedSite?.domain, selectedSite?.entryPath, selectedSite?.phpVersion, summary.config.globalPhpVersion]);

  useEffect(() => {
    if (siteTab === "workers" && !isLaravelSite) {
      setSiteTab("general");
    }
  }, [isLaravelSite, siteTab, selectedSite?.domain]);

  useEffect(() => {
    if (!selectedSite) {
      setSiteHealth(null);
      return;
    }

    let cancelled = false;
    setSiteHealthLoading(true);
    setSiteHealth(null);

    async function loadSiteHealth() {
      try {
        const payload = await getJson<SiteHealthStatus>(`/api/sites/health?site=${encodeURIComponent(selectedSite!.domain)}`);
        if (!cancelled) {
          setSiteHealth(payload);
        }
      } catch (error) {
        if (!cancelled) {
          setSiteHealth({
            domain: selectedSite!.domain,
            url: selectedSite!.url,
            state: "error",
            message: error instanceof Error ? error.message : String(error),
            responseTimeMs: 0,
            checkedAt: new Date().toISOString()
          });
        }
      } finally {
        if (!cancelled) {
          setSiteHealthLoading(false);
        }
      }
    }

    void loadSiteHealth();
    return () => {
      cancelled = true;
    };
  }, [selectedSite?.domain]);

  async function saveSelectedEntry(nextEntry = entryPath) {
    if (!selectedSite) {
      return;
    }
    await post("/api/sites/entry", { site: selectedSite.domain, entry: nextEntry });
  }

  async function resetSelectedEntry() {
    if (!selectedSite) {
      return;
    }
    const defaultEntry = selectedSite.framework === "Laravel" ? "public" : ".";
    setEntryPath(defaultEntry);
    await post("/api/sites/entry", { site: selectedSite.domain, entry: null });
  }

  async function saveSelectedPhpVersion() {
    if (!selectedSite) {
      return;
    }
    if (sitePhpVersion === summary.config.globalPhpVersion) {
      await post("/api/php/unisolate", { site: selectedSite.domain });
      return;
    }
    await post("/api/php/isolate", { site: selectedSite.domain, version: sitePhpVersion });
  }

  async function deleteSelectedSite() {
    if (!selectedSite) {
      return;
    }

    const confirmed = await confirm({
      title: `Delete ${selectedSite.domain}?`,
      message: "This removes the project folder and can also drop the local database listed in the site's .env file.",
      details: [`Project folder: ${selectedSite.path}`, "This cannot be undone."],
      confirmLabel: "Delete Site",
      tone: "danger"
    });
    if (!confirmed) {
      return;
    }

    const nextDomain = summary.sites.find((site) => site.domain !== selectedSite.domain)?.domain ?? "";
    const payload = (await request("/api/sites/delete", { site: selectedSite.domain, deleteDatabases: true })) as {
      result?: SiteDeletionResult;
    };
    setSelectedDomain(nextDomain);
    setSiteTab("general");

    const deletedDatabases = payload.result?.deletedDatabases ?? [];
    const skippedDatabases = payload.result?.skippedDatabases ?? [];
    const databaseMessage = deletedDatabases.length ? ` Dropped database ${deletedDatabases.join(", ")}.` : "";
    const skippedMessage = skippedDatabases.length ? ` Skipped database ${skippedDatabases.join(", ")}.` : "";
    showToast(`Deleted ${selectedSite.domain}.${databaseMessage}${skippedMessage}`, "success");
  }

  return (
    <>
      <section className="sites-command-center herd-sites-toolbar">
        <div className="toolbar sites-toolbar">
          <div className="path-picker">
            <input value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="C:\www" />
            <button type="button" className="field-icon-button" disabled={busy} onClick={() => void browseFolder()} title="Browse folder">
              <FolderOpen size={18} />
            </button>
          </div>
          <button className="primary" disabled={busy} onClick={() => setNewSiteOpen((open) => !open)} title={language === "ar" ? "إنشاء موقع جديد" : "Create new site"}>
            <FolderPlus size={18} />
            <span>{language === "ar" ? "موقع جديد" : "New Site"}</span>
          </button>
          <button disabled={busy || !folder.trim()} onClick={() => void post("/api/sites/park", { path: folder, primary: true })}>
            <FolderOpen size={18} />
            <span>{language === "ar" ? "إضافة مجلد" : "Park Folder"}</span>
          </button>
          <button disabled={busy} onClick={() => void post("/api/hosts/sync", {})}>
            <ListRestart size={18} />
            <span>Sync Hosts</span>
          </button>
        </div>
        <SslTrustPanel summary={summary} post={post} busy={busy} language={language} />
      </section>
      {newSiteOpen ? (
        <div
          className="new-site-modal-backdrop"
          onMouseDown={(event) => {
            if (!busy && event.currentTarget === event.target) {
              setNewSiteOpen(false);
            }
          }}
        >
          <NewSitePanel
            summary={summary}
            request={request}
            busy={busy}
            defaultParent={folder || summary.config.parkedFolders[0] || defaultSitesFolder(summary)}
            onClose={() => {
              if (!busy) {
                setNewSiteOpen(false);
              }
            }}
            onCreated={(site) => {
              setSelectedDomain(site.domain);
              setSiteTab("general");
              setNewSiteOpen(false);
            }}
          />
        </div>
      ) : null}
      {selectedSite ? (
        <div className="sites-workbench">
          <aside className="sites-list-pane">
            <div className="sites-list-header">
              <div className="sites-search">
                <Search size={14} />
                <input
                  placeholder="Search sites..."
                  value={siteSearch}
                  onChange={(event) => setSiteSearch(event.target.value)}
                />
                <span>{filteredSites.length}</span>
              </div>
            </div>
            <div className="sites-filter-chips" aria-label="Site quick filters">
              {siteFilterChips.map((chip) => (
                <button key={chip.id} className={siteFilter === chip.id ? "active" : ""} onClick={() => setSiteFilter(chip.id)}>
                  <span>{chip.label}</span>
                  <strong>{chip.count}</strong>
                </button>
              ))}
            </div>
            <div className="sites-list">
              {filteredSites.map((site) => (
                <button
                  key={site.domain}
                  className={site.domain === selectedSite.domain ? "site-list-item active" : "site-list-item"}
                  onClick={() => setSelectedDomain(site.domain)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setSelectedDomain(site.domain);
                    setSiteMenu({ x: event.clientX, y: event.clientY, domain: site.domain });
                  }}
                  title={`${site.domain} - ${site.framework}`}
                >
                  {site.secured ? <Lock className="site-lock secured" size={14} /> : <LockOpen className="site-lock" size={14} />}
                  <span className="site-list-main">
                    <strong>{site.domain}</strong>
                    <span>{site.name}</span>
                  </span>
                  <small>PHP {site.phpVersion}</small>
                </button>
              ))}
              {filteredSites.length === 0 && summary.sites.length > 0 ? (
                <div className="settings-empty-row sites-empty-row"><span>{language === "ar" ? "لا مواقع تطابق البحث." : "No sites match search."}</span></div>
              ) : null}
            </div>
          </aside>

          <section className="site-detail-pane">
            <div className="site-detail-header">
              <div className="site-heading">
                <span className="eyebrow">{selectedSite.framework}</span>
                <h2>{selectedSite.name}</h2>
                <div className="site-url-row">
                  <button className="link-button" onClick={() => void openExternalUrl(selectedSite.url)}>
                    <ExternalLink size={15} />
                    <span>{selectedSite.url}</span>
                  </button>
                  <span className={selectedSite.secured ? "site-security-badge secured" : "site-security-badge"}>
                    {selectedSite.secured ? "HTTPS" : "HTTP"}
                  </span>
                  <span className={siteHealthLoading ? "site-health-badge checking" : siteHealth?.state === "error" ? "site-health-badge error" : "site-health-badge ok"}>
                    {siteHealthLoading ? (language === "ar" ? "فحص" : "Checking") : siteHealth?.state === "error" ? (language === "ar" ? "خطأ موقع" : "Site Error") : language === "ar" ? "سليم" : "Healthy"}
                  </span>
                </div>
              </div>
              <div className="site-header-actions">
                <button className={selectedSite.secured ? "" : "primary"} disabled={busy || (selectedSite.secured && !summary.ssl.trusted)} onClick={() => void post(selectedSite.secured ? "/api/ssl/unsecure" : "/api/ssl/secure", { site: selectedSite.domain })}>
                  {selectedSite.secured ? <Lock size={18} /> : <LockOpen size={18} />}
                  <span>{selectedSite.secured ? "Disable SSL" : "Enable SSL"}</span>
                </button>
                <button className="danger-site-button" disabled={busy} onClick={() => void deleteSelectedSite()} title="Delete site">
                  <Trash2 size={18} />
                  <span>Delete Site</span>
                </button>
              </div>
            </div>

            <div className="site-detail-tabs" role="tablist" aria-label={language === "ar" ? "أقسام الموقع" : "Site sections"}>
              <button role="tab" aria-selected={siteTab === "general"} className={siteTab === "general" ? "active" : ""} onClick={() => setSiteTab("general")}>
                {language === "ar" ? "عام" : "General"}
              </button>
              <button role="tab" aria-selected={siteTab === "database"} className={siteTab === "database" ? "active" : ""} onClick={() => setSiteTab("database")}>
                {language === "ar" ? "قاعدة البيانات" : "Database"}
              </button>
              <button role="tab" aria-selected={siteTab === "commands"} className={siteTab === "commands" ? "active" : ""} onClick={() => setSiteTab("commands")}>
                {language === "ar" ? "الأوامر" : "Commands"}
              </button>
              {isLaravelSite ? (
                <button role="tab" aria-selected={siteTab === "workers"} className={siteTab === "workers" ? "active" : ""} onClick={() => setSiteTab("workers")}>
                  {language === "ar" ? "العمليات" : "Workers"}
                </button>
              ) : null}
              <button role="tab" aria-selected={siteTab === "information"} className={siteTab === "information" ? "active" : ""} onClick={() => setSiteTab("information")}>
                {language === "ar" ? "معلومات" : "Information"}
              </button>
            </div>

            {siteTab === "general" ? (
              <>
                {siteHealth?.state === "error" ? (
                  <div className="site-attention-panel">
                    <CircleAlert size={18} />
                    <div>
                      <strong>{siteHealth.statusCode ? `HTTP ${siteHealth.statusCode}` : "Site check failed"}</strong>
                      <span>{siteHealth.message}</span>
                    </div>
                    <button onClick={() => void openExternalUrl(selectedSite.url)}>
                      <ExternalLink size={16} />
                      <span>Open Site</span>
                    </button>
                    <button onClick={() => onNavigate("logs")}>
                      <FileText size={16} />
                      <span>Open Logs</span>
                    </button>
                  </div>
                ) : null}
                <div className="site-general-grid">
                  <div className="site-preview-panel">
                    <SitePreviewImage site={selectedSite} />
                    <button className="primary" title="Open site" onClick={() => void openExternalUrl(selectedSite.url)}>
                      <ExternalLink size={18} />
                      <span>Open Site</span>
                    </button>
                  </div>
                  <div className="site-controls-panel">
                    <div className="site-control-card">
                      <div className="site-control-card-title">
                        <SquareTerminal size={16} />
                        <div>
                          <strong>PHP Runtime</strong>
                          <span>{selectedSite.phpVersion === summary.config.globalPhpVersion ? "Using global default" : `Isolated to PHP ${selectedSite.phpVersion}`}</span>
                        </div>
                      </div>
                      <label>
                        <span>PHP Version</span>
                        <select value={sitePhpVersion} onChange={(event) => setSitePhpVersion(event.target.value)}>
                          {summary.runtimes.php.map((runtime) => (
                            <option key={runtime.version} value={runtime.version}>
                              PHP {runtime.version}{runtime.installed ? "" : " (missing)"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button className="primary" disabled={busy || sitePhpVersion === selectedSite.phpVersion} onClick={() => void saveSelectedPhpVersion()}>
                        <BadgeCheck size={18} />
                        <span>Apply PHP</span>
                      </button>
                    </div>
                    <div className="site-control-card">
                      <div className="site-control-card-title">
                        <Server size={16} />
                        <div>
                          <strong>Nginx Entry</strong>
                          <span>{selectedSite.documentRoot}</span>
                        </div>
                      </div>
                      <label>
                        <span>Entry Path</span>
                        <input value={entryPath} onChange={(event) => setEntryPath(event.target.value)} />
                      </label>
                      <div className="button-row site-entry-actions">
                        <button disabled={busy} onClick={() => setEntryPath(".")}>
                          <FolderOpen size={18} />
                          <span>Project Root</span>
                        </button>
                        <button disabled={busy} onClick={() => setEntryPath("public")}>
                          <FolderOpen size={18} />
                          <span>public</span>
                        </button>
                        <button className="primary" disabled={busy || !entryPath.trim()} onClick={() => void saveSelectedEntry()}>
                          <BadgeCheck size={18} />
                          <span>Save Entry</span>
                        </button>
                        <button disabled={busy} onClick={() => void resetSelectedEntry()}>
                          <RotateCw size={18} />
                          <span>Reset</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : siteTab === "commands" ? (
              <div className="site-tab-panel">
                <ProjectTools site={selectedSite} request={request} busy={busy} />
              </div>
            ) : siteTab === "database" ? (
              <div className="site-tab-panel">
                <SiteDatabaseTools site={selectedSite} request={request} busy={busy} />
              </div>
            ) : siteTab === "workers" && isLaravelSite ? (
              <div className="site-tab-panel">
                <WorkerTools site={selectedSite} request={request} busy={busy} />
              </div>
            ) : (
              <dl className="details site-info-details">
                <dt>Domain</dt>
                <dd>{selectedSite.domain}</dd>
                <dt>URL</dt>
                <dd>{selectedSite.url}</dd>
                <dt>Project path</dt>
                <dd>{selectedSite.path}</dd>
                <dt>Document root</dt>
                <dd>{selectedSite.documentRoot}</dd>
                <dt>Entry</dt>
                <dd>{selectedSite.entryPath}</dd>
                <dt>PHP</dt>
                <dd>{selectedSite.phpVersion}</dd>
              </dl>
            )}
          </section>
        </div>
      ) : (
        <div className="empty-state">No parked projects found.</div>
      )}
      {siteMenu ? (
        (() => {
          const menuSite = summary.sites.find((site) => site.domain === siteMenu.domain);
          if (!menuSite) {
            return null;
          }
          const close = () => setSiteMenu(null);
          const run = (action: () => void) => {
            action();
            close();
          };
          return (
            <>
              <div className="context-menu-backdrop" onMouseDown={close} onContextMenu={(event) => { event.preventDefault(); close(); }} />
              <div
                className="context-menu"
                style={{ top: Math.min(siteMenu.y, window.innerHeight - 292), left: Math.min(siteMenu.x, window.innerWidth - 210) }}
                role="menu"
              >
                <button role="menuitem" onClick={() => run(() => void openExternalUrl(menuSite.url))}>
                  <ExternalLink size={15} />
                  <span>{language === "ar" ? "فتح الموقع" : "Open Site"}</span>
                </button>
                <button role="menuitem" onClick={() => run(() => void post("/api/open-path", { path: menuSite.path }))}>
                  <FolderOpen size={15} />
                  <span>{language === "ar" ? "فتح المجلد" : "Open Folder"}</span>
                </button>
                <button role="menuitem" onClick={() => run(() => { void copyTextToClipboard(menuSite.url); showToast(language === "ar" ? "تم نسخ الرابط." : "Copied site URL.", "success"); })}>
                  <Clipboard size={15} />
                  <span>{language === "ar" ? "نسخ الرابط" : "Copy URL"}</span>
                </button>
                <div className="context-menu-separator" />
                <button role="menuitem" disabled={busy || (menuSite.secured && !summary.ssl.trusted)} onClick={() => run(() => void post(menuSite.secured ? "/api/ssl/unsecure" : "/api/ssl/secure", { site: menuSite.domain }))}>
                  {menuSite.secured ? <LockOpen size={15} /> : <Lock size={15} />}
                  <span>{menuSite.secured ? (language === "ar" ? "إلغاء SSL" : "Disable SSL") : (language === "ar" ? "تفعيل SSL" : "Enable SSL")}</span>
                </button>
                <button role="menuitem" onClick={() => run(() => { setSelectedDomain(menuSite.domain); setSiteTab("commands"); })}>
                  <SquareTerminal size={15} />
                  <span>{language === "ar" ? "الأوامر" : "Commands"}</span>
                </button>
                <button role="menuitem" onClick={() => run(() => onNavigate("logs"))}>
                  <FileText size={15} />
                  <span>{language === "ar" ? "السجلات" : "Logs"}</span>
                </button>
                <div className="context-menu-separator" />
                <button role="menuitem" className="context-menu-danger" disabled={busy} onClick={() => run(() => { setSelectedDomain(menuSite.domain); void deleteSelectedSite(); })}>
                  <Trash2 size={15} />
                  <span>{language === "ar" ? "حذف الموقع" : "Delete Site"}</span>
                </button>
              </div>
            </>
          );
        })()
      ) : null}
    </>
  );
}

function SiteSummaryCard({
  icon: Icon,
  label,
  value,
  detail,
  tone
}: {
  icon: typeof Globe;
  label: string;
  value: string;
  detail: string;
  tone: "default" | "green" | "amber";
}) {
  return (
    <div className={`site-summary-card ${tone}`}>
      <Icon size={17} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function NewSitePanel({
  summary,
  request,
  busy,
  defaultParent,
  onCreated,
  onClose
}: {
  summary: DashboardSummary;
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
  busy: boolean;
  defaultParent: string;
  onCreated: (site: Site) => void;
  onClose: () => void;
}) {
  const activeDatabaseDriver: LaravelDatabaseDriver =
    databaseEngineName(selectedMysqlRuntime(summary, summary.config.mysql.version)) === "MariaDB" ? "mariadb" : "mysql";
  const [name, setName] = useState("");
  const [parentPath, setParentPath] = useState(defaultParent);
  const [preset, setPreset] = useState<NewSitePreset>("laravel");
  const [starterKit, setStarterKit] = useState<LaravelStarterKit>("none");
  const [auth, setAuth] = useState<LaravelAuthPreset>("default");
  const [database, setDatabase] = useState<LaravelDatabaseDriver>(activeDatabaseDriver);
  const [packageManager, setPackageManager] = useState<LaravelPackageManager>("none");
  const [testing, setTesting] = useState<LaravelTestingFramework>("pest");
  const [git, setGit] = useState(false);
  const [boost, setBoost] = useState(false);
  const [installerStatus, setInstallerStatus] = useState<LaravelInstallerStatus | null>(null);
  const [installerBusy, setInstallerBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [creationJob, setCreationJob] = useState<SiteCreationJob | null>(null);
  const [completedJobId, setCompletedJobId] = useState("");
  const [panelError, setPanelError] = useState<string | null>(null);
  const working = busy || installerBusy || creating;
  const canCreate = name.trim().length > 0 && parentPath.trim().length > 0;
  const installerTone = !installerStatus
    ? "amber"
    : installerStatus.installed && !installerStatus.updateAvailable
      ? "green"
      : installerStatus.installed
        ? "amber"
        : "red";
  const installerLabel = !installerStatus
    ? "Checking"
    : installerStatus.installed
      ? installerStatus.updateAvailable
        ? `Update ${installerStatus.latestVersion ?? ""}`.trim()
        : `Installed ${installerStatus.version ?? ""}`.trim()
      : "Missing";
  const requirementsMessage = installerStatus?.message;
  const normalizedName = normalizeSiteName(name);
  const previewName = normalizedName || "my-app";
  const previewDomain = `${previewName}.${summary.config.tld}`;
  const previewPath = joinWindowsPath(parentPath || defaultParent, previewName);
  const commandPreview =
    preset === "laravel"
      ? [
          "laravel",
          "new",
          previewName,
          starterKit !== "none" ? `--${starterKit}` : "",
          auth !== "default" ? `--auth=${auth}` : "",
          `--database=${database}`,
          `--${testing}`,
          packageManager !== "none" ? `--${packageManager}` : "",
          git ? "--git" : "",
          boost ? "--boost" : ""
        ]
          .filter(Boolean)
          .join(" ")
      : `create ${preset} site ${previewName}`;
  const previewOptions = [
    preset === "laravel" ? `starter: ${starterKit}` : "",
    preset === "laravel" ? `auth: ${auth}` : "",
    preset === "laravel" ? `db: ${database}` : "",
    preset === "laravel" ? `tests: ${testing}` : "",
    preset === "laravel" && packageManager !== "none" ? `node: ${packageManager}` : "",
    git ? "git" : "",
    boost ? "boost" : ""
  ].filter(Boolean);

  useEffect(() => {
    if (!parentPath.trim()) {
      setParentPath(defaultParent);
    }
  }, [defaultParent, parentPath]);

  useEffect(() => {
    void loadInstallerStatus();
  }, []);

  useEffect(() => {
    if (!creationJob || creationJob.id === "local" || creationJob.status === "complete" || creationJob.status === "failed") {
      return;
    }

    const activeJobId = creationJob.id;
    let cancelled = false;
    let timer: number | undefined;

    async function pollCreationJob() {
      try {
        const payload = await getJson<{ job: SiteCreationJob }>(`/api/sites/create/jobs/${encodeURIComponent(activeJobId)}`);
        if (cancelled) {
          return;
        }
        setCreationJob(payload.job);
        if (payload.job.status === "complete") {
          setCreating(false);
          setPanelError(null);
          if (payload.job.result?.site && completedJobId !== payload.job.id) {
            setCompletedJobId(payload.job.id);
            window.setTimeout(() => onCreated(payload.job.result!.site), 900);
          }
          return;
        }
        if (payload.job.status === "failed") {
          setCreating(false);
          setPanelError(`Create site failed: ${payload.job.error ?? payload.job.message}`);
          return;
        }
      } catch (error) {
        if (!cancelled) {
          setCreating(false);
          setPanelError(`Create site status failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        return;
      }

      timer = window.setTimeout(pollCreationJob, 900);
    }

    timer = window.setTimeout(pollCreationJob, 500);
    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [completedJobId, creationJob, onCreated]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !working) {
        onClose();
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, working]);

  async function loadInstallerStatus() {
    setInstallerBusy(true);
    try {
      setInstallerStatus(await getJson<LaravelInstallerStatus>("/api/laravel-installer/status"));
      setPanelError(null);
    } catch (error) {
      setPanelError(`Installer status failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setInstallerBusy(false);
    }
  }

  async function browseParentFolder() {
    const payload = (await request("/api/dialog/folder", { initialPath: parentPath })) as { path?: string | null };
    if (payload.path) {
      setParentPath(payload.path);
    }
  }

  async function installInstaller() {
    setInstallerBusy(true);
    try {
      const payload = (await request("/api/laravel-installer/install", {})) as { status?: LaravelInstallerStatus };
      if (payload.status) {
        setInstallerStatus(payload.status);
      } else {
        await loadInstallerStatus();
      }
      setPanelError(null);
    } catch (error) {
      setPanelError(`Installer action failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setInstallerBusy(false);
    }
  }

  async function createSite() {
    setCreating(true);
    setPanelError(null);
    setCreationJob({
      id: "local",
      status: "queued",
      percent: 0,
      message: "Sending create request.",
      logs: [{ at: new Date().toISOString(), level: "info", message: "Sending create request." }],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    try {
      const payload = await postJson<{ job?: SiteCreationJob }>("/api/sites/create", {
        name,
        parentPath,
        preset,
        starterKit,
        auth,
        database,
        packageManager,
        testing,
        git,
        boost
      });
      if (!payload.job) {
        throw new Error("Site creation job was not returned.");
      }
      setCreationJob(payload.job);
      setCompletedJobId("");
      setPanelError(null);
    } catch (error) {
      setPanelError(`Create site failed: ${error instanceof Error ? error.message : String(error)}`);
      setCreationJob((current) =>
        current
          ? {
              ...current,
              status: "failed",
              message: error instanceof Error ? error.message : String(error),
              error: error instanceof Error ? error.message : String(error),
              logs: [...current.logs, { at: new Date().toISOString(), level: "error", message: error instanceof Error ? error.message : String(error) }]
            }
          : current
      );
      setCreating(false);
    }
  }

  return (
    <div className="new-site-panel" role="dialog" aria-modal="true" aria-labelledby="new-site-title">
      <div className="new-site-panel-header">
        <div className="new-site-title">
          <FolderPlus size={20} />
          <div>
            <strong id="new-site-title">Create New Site</strong>
            <span>{parentPath}</span>
          </div>
        </div>
        <div className="new-site-header-actions">
          <Badge label={installerLabel} tone={installerTone} />
          {!installerStatus?.installed || installerStatus.updateAvailable ? (
            <button
              className="primary"
              disabled={working}
              onClick={() => void installInstaller()}
              title={installerStatus?.installed ? "Update Laravel Installer" : "Install Laravel Installer"}
            >
              {installerStatus?.installed ? <RotateCw size={18} /> : <Download size={18} />}
              <span>{installerStatus?.installed ? "Update" : "Install"}</span>
            </button>
          ) : null}
          <button disabled={working} onClick={() => void loadInstallerStatus()} title="Refresh installer status">
            <RotateCw size={18} />
          </button>
          <button className="new-site-close" disabled={working} onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="new-site-form">
        <div className="new-site-fields">
          <label>
            <span>Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="my-app" autoFocus />
          </label>
          <label className="new-site-path-field">
            <span>Location</span>
            <div className="path-picker">
              <input value={parentPath} onChange={(event) => setParentPath(event.target.value)} />
              <button type="button" className="field-icon-button" disabled={working} onClick={() => void browseParentFolder()} title="Browse folder">
                <FolderOpen size={18} />
              </button>
            </div>
          </label>
          <label>
            <span>Type</span>
            <div className="segmented new-site-segmented">
              {(["laravel", "php", "static"] as NewSitePreset[]).map((item) => (
                <button key={item} className={preset === item ? "active" : ""} onClick={() => setPreset(item)}>
                  {item === "laravel" ? "Laravel" : item === "php" ? "PHP" : "Static"}
                </button>
              ))}
            </div>
          </label>

          {preset === "laravel" ? (
            <div className="new-site-laravel-options">
            <label>
              <span>Starter</span>
              <select value={starterKit} onChange={(event) => setStarterKit(event.target.value as LaravelStarterKit)}>
                <option value="none">None</option>
                <option value="react">React</option>
                <option value="vue">Vue</option>
                <option value="svelte">Svelte</option>
                <option value="livewire">Livewire</option>
              </select>
            </label>
            <label>
              <span>Auth</span>
              <select value={auth} onChange={(event) => setAuth(event.target.value as LaravelAuthPreset)}>
                <option value="default">Default</option>
                <option value="none">None</option>
                <option value="workos">WorkOS</option>
              </select>
            </label>
            <label>
              <span>Database</span>
              <select value={database} onChange={(event) => setDatabase(event.target.value as LaravelDatabaseDriver)}>
                <option value="mysql">MySQL</option>
                <option value="mariadb">MariaDB</option>
                <option value="sqlite">SQLite</option>
                <option value="pgsql">PostgreSQL</option>
                <option value="sqlsrv">SQL Server</option>
              </select>
            </label>
            <label>
              <span>Testing</span>
              <select value={testing} onChange={(event) => setTesting(event.target.value as LaravelTestingFramework)}>
                <option value="pest">Pest</option>
                <option value="phpunit">PHPUnit</option>
              </select>
            </label>
            <label>
              <span>Node</span>
              <select value={packageManager} onChange={(event) => setPackageManager(event.target.value as LaravelPackageManager)}>
                <option value="none">Skip</option>
                <option value="npm">npm</option>
                <option value="pnpm">pnpm</option>
                <option value="bun">Bun</option>
                <option value="yarn">Yarn</option>
              </select>
            </label>
            <div className="new-site-switches">
              <label className="compact-toggle" title="Initialize a Git repository for the new project.">
                <input type="checkbox" checked={git} onChange={(event) => setGit(event.target.checked)} />
                <span>Git</span>
              </label>
              <label className="compact-toggle" title="Install Laravel Boost when the selected Laravel stack supports it.">
                <input type="checkbox" checked={boost} onChange={(event) => setBoost(event.target.checked)} />
                <span>Boost</span>
              </label>
            </div>
            </div>
          ) : null}
        </div>
        <div className="new-site-preview-card">
          <div className="new-site-preview-heading">
            <PanelTopOpen size={16} />
            <div>
              <strong>Creation Preview</strong>
              <span>{preset === "laravel" ? "Laravel installer command" : "Local project scaffold"}</span>
            </div>
          </div>
          <div>
            <span>Domain</span>
            <strong>{previewDomain}</strong>
          </div>
          <div>
            <span>Path</span>
            <strong>{previewPath}</strong>
          </div>
          <div>
            <span>Command</span>
            <code>{commandPreview}</code>
          </div>
          <div>
            <span>Options</span>
            <strong>{previewOptions.length ? previewOptions.join(" · ") : "default"}</strong>
          </div>
        </div>
      </div>

      {panelError || (requirementsMessage && preset === "laravel") ? (
        <div className={panelError ? "new-site-message error" : "new-site-message"}>{panelError ?? requirementsMessage}</div>
      ) : null}

      {creationJob ? <SiteCreationProgressPanel job={creationJob} /> : null}

      <div className="new-site-actions">
        <button className="primary" disabled={working || !canCreate} onClick={() => void createSite()} title="Create site">
          {creating ? <LoaderCircle className="spin" size={18} /> : <PackageCheck size={18} />}
          <span>{creating ? "Creating" : "Create & Open"}</span>
        </button>
        <button disabled={working} onClick={onClose} title="Cancel">
          <CircleStop size={18} />
          <span>Cancel</span>
        </button>
      </div>
    </div>
  );
}

function SiteCreationProgressPanel({ job }: { job: SiteCreationJob }) {
  const logRef = useRef<HTMLDivElement | null>(null);
  const tone = job.status === "complete" ? "success" : job.status === "failed" ? "error" : "running";
  const statusLabel = job.status === "complete" ? "Complete" : job.status === "failed" ? "Failed" : job.status === "queued" ? "Queued" : "Running";

  useEffect(() => {
    const element = logRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [job.logs.length, job.message]);

  return (
    <div className={`new-site-progress-panel ${tone}`}>
      <div className="new-site-progress-header">
        <div>
          <strong>{statusLabel}</strong>
          <span>{job.message}</span>
        </div>
        <span>{job.percent}%</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${job.percent}%` }} />
      </div>
      <div ref={logRef} className="new-site-log" aria-label="Site creation log">
        {job.logs.map((entry, index) => (
          <div key={`${entry.at}-${index}`} className={`new-site-log-line ${entry.level}`}>
            <span>{new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            <p>{entry.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SitePreviewImage({ site }: { site: Site }) {
  const [refreshToken, setRefreshToken] = useState(0);
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const previewUrl = apiUrl(
    `/api/sites/preview?site=${encodeURIComponent(site.domain)}${refreshToken > 0 ? `&refresh=1&t=${refreshToken}` : ""}`
  );

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;

    setState("loading");
    setImageUrl(null);

    async function loadPreview() {
      try {
        const response = await fetch(previewUrl, { cache: "no-store", signal: controller.signal });
        if (!response.ok) {
          throw new Error(await responseErrorMessage(response));
        }

        const blob = await response.blob();
        if (!blob.size) {
          throw new Error("Preview image was empty.");
        }

        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      } catch {
        if (!controller.signal.aborted) {
          setState("error");
        }
      }
    }

    void loadPreview();

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [previewUrl]);

  return (
    <div className="site-preview-window">
      {state !== "error" && imageUrl ? (
        <img src={imageUrl} alt={`${site.domain} preview`} onLoad={() => setState("loaded")} onError={() => setState("error")} />
      ) : null}
      {state === "error" ? (
        <div className="site-preview-fallback">
          <Globe size={28} />
          <strong>{site.domain}</strong>
          <span>Preview unavailable</span>
        </div>
      ) : null}
      {state === "loading" ? (
        <div className="site-preview-loading">
          <LoaderCircle className="spin" size={18} />
        </div>
      ) : null}
      <div className="site-preview-caption">
        <Globe size={16} />
        <strong>{site.domain}</strong>
      </div>
      <button className="site-preview-refresh" title="Refresh preview" onClick={() => setRefreshToken(Date.now())}>
        <RotateCw size={16} />
      </button>
    </div>
  );
}

function SslTrustPanel({ summary, post, busy, language }: ViewProps) {
  const ssl = summary.ssl;
  const tone = ssl.trusted ? "green" : ssl.exists ? "amber" : "red";
  const label = ssl.trusted ? "trusted" : ssl.exists ? "untrusted" : "missing";

  async function trustCa() {
    await post("/api/ssl/trust");
    showToast("Local CA trusted in Windows Root.", "success");
  }

  return (
    <div className="ssl-trust-panel">
      <div className="ssl-trust-main">
        <ShieldCheck size={20} />
        <div>
          <strong>Local CA</strong>
          <span>{ssl.store ?? ssl.message ?? ssl.certPath}</span>
        </div>
      </div>
      <Badge label={label} tone={tone} />
      <button className={!ssl.trusted ? "primary" : ""} disabled={busy || ssl.trusted || ssl.platform !== "win32"} onClick={() => void trustCa()}>
        <ShieldCheck size={18} />
        <span>{ssl.trusted ? "Trusted" : "Trust CA"}</span>
      </button>
    </div>
  );
}

function NginxSettingsPanel({ summary, post, busy, language }: ViewProps) {
  const [httpPort, setHttpPort] = useState(String(summary.config.nginx.httpPort));
  const [httpsPort, setHttpsPort] = useState(String(summary.config.nginx.httpsPort));
  const [fastCgiHost, setFastCgiHost] = useState(summary.config.nginx.fastCgiHost);

  useEffect(() => {
    setHttpPort(String(summary.config.nginx.httpPort));
    setHttpsPort(String(summary.config.nginx.httpsPort));
    setFastCgiHost(summary.config.nginx.fastCgiHost);
  }, [summary.config.nginx.httpPort, summary.config.nginx.httpsPort, summary.config.nginx.fastCgiHost]);

  const httpPortNumber = Number(httpPort);
  const httpsPortNumber = Number(httpsPort);
  const validPorts = Number.isInteger(httpPortNumber) && Number.isInteger(httpsPortNumber) && httpPortNumber > 0 && httpsPortNumber > 0 && httpPortNumber <= 65535 && httpsPortNumber <= 65535;
  const validHost = fastCgiHost.trim().length > 0;
  const changed = httpPort !== String(summary.config.nginx.httpPort) || httpsPort !== String(summary.config.nginx.httpsPort) || fastCgiHost.trim() !== summary.config.nginx.fastCgiHost;

  function resetForm() {
    setHttpPort(String(summary.config.nginx.httpPort));
    setHttpsPort(String(summary.config.nginx.httpsPort));
    setFastCgiHost(summary.config.nginx.fastCgiHost);
  }

  return (
    <div className="panel">
      <h2>Settings</h2>
      <div className="settings-grid">
        <label>
          <span>HTTP Port</span>
          <input value={httpPort} onChange={(event) => setHttpPort(event.target.value)} inputMode="numeric" />
        </label>
        <label>
          <span>HTTPS Port</span>
          <input value={httpsPort} onChange={(event) => setHttpsPort(event.target.value)} inputMode="numeric" />
        </label>
        <label>
          <span>FastCGI Host</span>
          <input value={fastCgiHost} onChange={(event) => setFastCgiHost(event.target.value)} />
        </label>
      </div>
      <div className="button-row">
        <button className="primary" disabled={busy || !changed || !validPorts || httpPortNumber === httpsPortNumber || !validHost} onClick={() => void post("/api/nginx/settings", { httpPort: httpPortNumber, httpsPort: httpsPortNumber, fastCgiHost: fastCgiHost.trim() })}>
          <BadgeCheck size={18} />
          <span>Save Settings</span>
        </button>
        <button disabled={busy || !changed} onClick={resetForm}>
          <RotateCw size={18} />
          <span>Reset</span>
        </button>
      </div>
    </div>
  );
}

function Php({ summary, post, busy }: ViewProps) {
  const [version, setVersion] = useState(summary.config.globalPhpVersion);
  const [site, setSite] = useState(summary.sites[0]?.domain ?? "");
  const [siteVersion, setSiteVersion] = useState(summary.config.phpVersions[0] ?? "8.4");
  const [phpSettings, setPhpSettings] = useState<PhpConfig>(summary.config.php);
  const [extensions, setExtensions] = useState<PhpExtensionStatus[]>([]);
  const [iniPath, setIniPath] = useState("");
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadPhpSettings() {
      setSettingsLoading(true);
      try {
        const payload = await getJson<PhpSettingsStatus>(`/api/php/settings?version=${encodeURIComponent(version)}`);
        if (!cancelled) {
          setPhpSettings(payload.settings);
          setExtensions(payload.extensions);
          setIniPath(payload.iniPath);
        }
      } finally {
        if (!cancelled) {
          setSettingsLoading(false);
        }
      }
    }

    void loadPhpSettings();
    return () => {
      cancelled = true;
    };
  }, [
    version,
    summary.config.php.memoryLimit,
    summary.config.php.uploadMaxFilesize,
    summary.config.php.postMaxSize,
    summary.config.php.maxExecutionTime,
    summary.config.php.maxInputVars,
    summary.config.php.enabledExtensions.join("|")
  ]);

  function updatePhpSetting(patch: Partial<PhpConfig>) {
    setPhpSettings((current) => ({ ...current, ...patch }));
  }

  function toggleExtension(name: string) {
    setPhpSettings((current) => {
      const enabled = new Set(current.enabledExtensions);
      if (enabled.has(name)) {
        enabled.delete(name);
      } else {
        enabled.add(name);
      }
      return { ...current, enabledExtensions: Array.from(enabled).sort() };
    });
  }

  async function savePhpSettings() {
    setSettingsSaving(true);
    try {
      await post("/api/php/settings", { settings: phpSettings });
    } finally {
      setSettingsSaving(false);
    }
  }

  const runtimeByVersion = new Map(summary.runtimes.php.map((runtime) => [runtime.version, runtime]));
  const globalRuntime = runtimeByVersion.get(summary.config.globalPhpVersion);
  const selectedRuntime = runtimeByVersion.get(version);
  const isolatedSiteCount = Object.keys(summary.config.isolatedPhp).length;
  const globalEndpoint = phpFastCgiEndpoint(summary.config.globalPhpVersion);
  const selectedEndpoint = phpFastCgiEndpoint(version);

  return (
    <>
      <div className="php-overview">
        <div className="php-overview-status">
          <Badge label={summary.services.php.state} tone={summary.services.php.state === "running" ? "green" : summary.services.php.state === "stopped" ? "red" : "amber"} />
          <div>
            <strong>PHP FastCGI</strong>
            <span>{summary.services.php.message ?? "Ready for local sites."}</span>
          </div>
        </div>
        <dl className="php-overview-details">
          <div>
            <dt>Global Version</dt>
            <dd>PHP {summary.config.globalPhpVersion}</dd>
          </div>
          <div>
            <dt>Main Endpoint</dt>
            <dd>{globalEndpoint}</dd>
          </div>
          <div>
            <dt>Installed Runtime</dt>
            <dd>{globalRuntime?.installed ? "Installed" : "Not installed"}</dd>
          </div>
          <div>
            <dt>Isolated Sites</dt>
            <dd>{isolatedSiteCount}</dd>
          </div>
        </dl>
        <div className="php-endpoints" aria-label="PHP FastCGI endpoints">
          {summary.config.phpVersions.map((candidate) => {
            const runtime = runtimeByVersion.get(candidate);
            return (
              <div key={candidate} className={candidate === summary.config.globalPhpVersion ? "active" : ""}>
                <strong>PHP {candidate}</strong>
                <span>{phpFastCgiEndpoint(candidate)}</span>
                <Badge label={runtime?.installed ? "installed" : "missing"} tone={runtime?.installed ? "green" : "amber"} />
              </div>
            );
          })}
        </div>
      </div>
      <div className="toolbar">
        <button className="primary" disabled={busy || summary.services.php.state === "running"} onClick={() => void post("/api/php-fcgi/start")}>
          <Play size={18} />
          <span>Start</span>
        </button>
        <button disabled={busy} onClick={() => void post("/api/php-fcgi/stop")}>
          <CircleStop size={18} />
          <span>Stop</span>
        </button>
        <button disabled={busy} onClick={() => void post("/api/php-fcgi/restart")}>
          <RotateCw size={18} />
          <span>Restart</span>
        </button>
      </div>
      <div className="two-column">
        <div className="panel">
          <h2>Global Version</h2>
          <div className="segmented">
            {summary.config.phpVersions.map((candidate) => (
              <button key={candidate} className={version === candidate ? "active" : ""} onClick={() => setVersion(candidate)}>
                {candidate}
              </button>
            ))}
          </div>
          <dl className="details compact-details">
            <dt>Selected</dt>
            <dd>PHP {version}</dd>
            <dt>Endpoint</dt>
            <dd>{selectedEndpoint}</dd>
            <dt>Status</dt>
            <dd>{selectedRuntime?.installed ? "Installed" : "Not installed"}</dd>
          </dl>
          <button className="primary" disabled={busy || version === summary.config.globalPhpVersion} onClick={() => void post("/api/php/use", { version })}>
            <BadgeCheck size={18} />
            <span>Use Version</span>
          </button>
        </div>
        <div className="panel">
          <h2>Per-Site Version</h2>
          {summary.sites.length ? (
            <>
              <select value={site} onChange={(event) => setSite(event.target.value)}>
                {summary.sites.map((candidate) => (
                  <option key={candidate.domain} value={candidate.domain}>
                    {candidate.domain}
                  </option>
                ))}
              </select>
              <select value={siteVersion} onChange={(event) => setSiteVersion(event.target.value)}>
                {summary.config.phpVersions.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    PHP {candidate}
                  </option>
                ))}
              </select>
              <div className="button-row">
                <button className="primary" disabled={busy || !site} onClick={() => void post("/api/php/isolate", { site, version: siteVersion })}>
                  <KeyRound size={18} />
                  <span>Isolate</span>
                </button>
                <button disabled={busy || !site} onClick={() => void post("/api/php/unisolate", { site })}>
                  <CircleStop size={18} />
                  <span>Unisolate</span>
                </button>
              </div>
            </>
          ) : (
            <span className="muted">No local sites detected.</span>
          )}
        </div>
      </div>
      <div className="panel">
        <h2>PHP Settings</h2>
        <dl className="details compact-details">
          <dt>Editing</dt>
          <dd>PHP {version}</dd>
          <dt>php.ini</dt>
          <dd>{iniPath || "Loading..."}</dd>
        </dl>
        <div className="settings-grid">
          <label>
            <span>memory_limit</span>
            <input value={phpSettings.memoryLimit} onChange={(event) => updatePhpSetting({ memoryLimit: event.target.value })} />
          </label>
          <label>
            <span>upload_max_filesize</span>
            <input value={phpSettings.uploadMaxFilesize} onChange={(event) => updatePhpSetting({ uploadMaxFilesize: event.target.value })} />
          </label>
          <label>
            <span>post_max_size</span>
            <input value={phpSettings.postMaxSize} onChange={(event) => updatePhpSetting({ postMaxSize: event.target.value })} />
          </label>
          <label>
            <span>max_execution_time</span>
            <input
              type="number"
              min="0"
              value={phpSettings.maxExecutionTime}
              onChange={(event) => updatePhpSetting({ maxExecutionTime: Number(event.target.value) })}
            />
          </label>
          <label>
            <span>max_input_vars</span>
            <input
              type="number"
              min="0"
              value={phpSettings.maxInputVars}
              onChange={(event) => updatePhpSetting({ maxInputVars: Number(event.target.value) })}
            />
          </label>
        </div>
        <div className="button-row">
          <button className="primary" disabled={busy || settingsSaving || settingsLoading} onClick={() => void savePhpSettings()}>
            <BadgeCheck size={18} />
            <span>Save & Restart</span>
          </button>
        </div>
      </div>
      <div className="panel">
        <h2>Extensions</h2>
        <div className="extensions-grid">
          {extensions.length ? (
            extensions.map((extension) => (
              <label key={extension.name} className={!extension.available ? "extension-toggle unavailable" : "extension-toggle"}>
                <input
                  type="checkbox"
                  checked={phpSettings.enabledExtensions.includes(extension.name)}
                  disabled={!extension.available || settingsSaving || settingsLoading}
                  onChange={() => toggleExtension(extension.name)}
                />
                <span>{extension.name}</span>
              </label>
            ))
          ) : (
            <span className="muted">No extensions found.</span>
          )}
        </div>
      </div>
    </>
  );
}

function Mysql({
  summary,
  post,
  request,
  installJobs,
  startRuntimeInstall,
  busy
}: ViewProps & {
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
  installJobs: RuntimeJobMap;
  startRuntimeInstall: (kind: RuntimeKind, version?: string, force?: boolean) => Promise<RuntimeInstallJob | undefined>;
}) {
  const [databaseName, setDatabaseName] = useState("app_name");
  const [port, setPort] = useState(String(summary.config.mysql.port));
  const [selectedVersion, setSelectedVersion] = useState(summary.config.mysql.version);
  const [envText, setEnvText] = useState("");
  const [rootPassword, setRootPassword] = useState("");
  const [showRootPassword, setShowRootPassword] = useState(false);
  const [newRootPassword, setNewRootPassword] = useState("");
  const mysql = summary.services.mysql;
  const selectedRuntime = summary.runtimes.mysql.find((runtime) => runtime.version === selectedVersion) ?? summary.runtimes.mysql[0];
  const activeRuntime = summary.runtimes.mysql.find((runtime) => runtime.version === summary.config.mysql.version) ?? selectedRuntime;
  const activeDatabaseName = databaseEngineName(activeRuntime);
  const activeDatabaseLabel = databaseRuntimeDisplay(activeRuntime);
  const selectedDatabaseLabel = databaseRuntimeDisplay(selectedRuntime);
  const installJob = selectedRuntime ? latestRuntimeJob(Object.values(installJobs), "mysql", selectedRuntime.version) : undefined;
  const installing = installJob ? isActiveRuntimeJob(installJob) : false;
  const showInstallProgress = installJob ? installing || installJob.status === "failed" : false;
  const confirm = useDesktopConfirm();

  useEffect(() => {
    setPort(String(summary.config.mysql.port));
    setSelectedVersion(summary.config.mysql.version);
  }, [summary.config.mysql.port, summary.config.mysql.version]);

  async function loadEnv() {
    const payload = (await request("/api/mysql/env", { name: databaseName })) as { env?: string };
    setEnvText(payload.env ?? "");
  }

  async function loadRootPassword() {
    const payload = (await request("/api/mysql/password")) as { password?: string };
    setRootPassword(payload.password ?? "");
    setShowRootPassword(true);
  }

  async function resetRootPassword() {
    const confirmed = await confirm({
      title: `Reset ${activeDatabaseName} root password?`,
      message: "Laraboxs will generate and store a new local root password.",
      details: [`Runtime: ${activeDatabaseLabel}`, "Use this only when the database service is running and you are ready to update local connection settings."],
      confirmLabel: "Reset Password",
      tone: "warning"
    });
    if (!confirmed) {
      return;
    }
    const payload = (await request("/api/mysql/reset-password")) as { password?: string };
    setRootPassword(payload.password ?? "");
    setNewRootPassword("");
    setShowRootPassword(true);
  }

  async function changeRootPassword() {
    const payload = (await request("/api/mysql/change-password", { password: newRootPassword })) as { password?: string };
    setRootPassword(payload.password ?? "");
    setNewRootPassword("");
    setShowRootPassword(true);
  }

  return (
    <>
      <ServiceStrip service={mysql} />
      <div className="toolbar">
        {selectedRuntime ? (
          <button
            className={!selectedRuntime.installed || selectedRuntime.updateAvailable ? "primary" : ""}
            disabled={busy || (selectedRuntime.installed && !selectedRuntime.updateAvailable) || installing}
            onClick={() => void startRuntimeInstall("mysql", selectedRuntime.version, Boolean(selectedRuntime.updateAvailable))}
          >
            <Download size={18} />
            <span>{runtimeActionLabel(selectedRuntime, installJob, `Install ${selectedDatabaseLabel}`)}</span>
          </button>
        ) : null}
        <button disabled={busy} onClick={() => void post("/api/mysql/init")}>
          <BadgeCheck size={18} />
          <span>Initialize</span>
        </button>
        <button className="primary" disabled={busy || mysql.state === "running"} onClick={() => void post("/api/mysql/start")}>
          <Play size={18} />
          <span>Start</span>
        </button>
        <button disabled={busy} onClick={() => void post("/api/mysql/stop")}>
          <CircleStop size={18} />
          <span>Stop</span>
        </button>
        <button disabled={busy} onClick={() => void post("/api/mysql/restart")}>
          <RotateCw size={18} />
          <span>Restart</span>
        </button>
        <button disabled={busy} onClick={() => void post("/api/mysql/shell")}>
          <SquareTerminal size={18} />
          <span>Open Shell</span>
        </button>
      </div>
      {installJob && showInstallProgress ? <RuntimeProgress job={installJob} /> : null}
      <div className="panel">
        <h2>Version</h2>
        <DatabaseRuntimePicker runtimes={summary.runtimes.mysql} value={selectedVersion} onChange={setSelectedVersion} />
        <div className="button-row">
          <button disabled={busy || !selectedRuntime?.installed || selectedVersion === summary.config.mysql.version || mysql.state === "running"} onClick={() => void post("/api/mysql/version", { version: selectedVersion })}>
            <BadgeCheck size={18} />
            <span>Use Version</span>
          </button>
        </div>
        <dl className="details">
          <dt>Active</dt>
          <dd>{activeDatabaseLabel}</dd>
          <dt>Selected runtime</dt>
          <dd>{selectedRuntime ? `${selectedRuntime.installed ? "Installed" : "Not installed"} at ${selectedRuntime.root}` : "Unavailable"}</dd>
        </dl>
      </div>
      <div className="panel">
        <h2>Connection</h2>
        <div className="inline-form">
          <input value={port} onChange={(event) => setPort(event.target.value)} inputMode="numeric" />
          <button disabled={busy || !port.trim()} onClick={() => void post("/api/mysql/port", { port: Number(port) })}>
            <Settings size={18} />
            <span>Set Port</span>
          </button>
          <button disabled={busy} onClick={() => void post("/api/mysql/port", { port: "auto" })}>
            <RotateCw size={18} />
            <span>Auto Port</span>
          </button>
        </div>
      </div>
      <div className="two-column">
        <div className="panel">
          <h2>Root Password</h2>
          <div className="inline-form">
            <input readOnly type={showRootPassword ? "text" : "password"} value={rootPassword} placeholder="Stored password" />
            <button disabled={busy} onClick={() => void loadRootPassword()}>
              <KeyRound size={18} />
              <span>Show</span>
            </button>
            <button disabled={busy || mysql.state !== "running"} onClick={() => void resetRootPassword()}>
              <RotateCw size={18} />
              <span>Reset</span>
            </button>
          </div>
          <div className="inline-form">
            <input type="password" value={newRootPassword} onChange={(event) => setNewRootPassword(event.target.value)} placeholder="New root password" />
            <button className="primary" disabled={busy || mysql.state !== "running" || newRootPassword.length < 8} onClick={() => void changeRootPassword()}>
              <BadgeCheck size={18} />
              <span>Change</span>
            </button>
          </div>
        </div>
        <div className="panel">
          <h2>phpMyAdmin</h2>
          <ServiceStrip
            service={{
              name: "phpMyAdmin",
              state: summary.phpMyAdmin.installed ? "running" : "stopped",
              version: summary.phpMyAdmin.version,
              message: summary.phpMyAdmin.installed ? summary.phpMyAdmin.url : "Not installed"
            }}
          />
          <div className="button-row">
            <button className={!summary.phpMyAdmin.installed ? "primary" : ""} disabled={busy || summary.phpMyAdmin.installed} onClick={() => void request("/api/phpmyadmin/install")}>
              <Download size={18} />
              <span>{summary.phpMyAdmin.installed ? "Installed" : "Install"}</span>
            </button>
            <button disabled={busy || !summary.phpMyAdmin.installed} onClick={() => void post("/api/hosts/sync", {})}>
              <ListRestart size={18} />
              <span>Sync Hosts</span>
            </button>
            <button className="link-command-button" disabled={busy || !summary.phpMyAdmin.installed} onClick={() => void openExternalUrl(summary.phpMyAdmin.url)}>
              <ExternalLink size={16} />
              <span>Open</span>
            </button>
          </div>
          <dl className="details">
            <dt>Root</dt>
            <dd>{summary.phpMyAdmin.root}</dd>
            <dt>Config</dt>
            <dd>{summary.phpMyAdmin.configPath}</dd>
          </dl>
        </div>
      </div>
      <div className="panel">
        <h2>Create Database</h2>
        <div className="inline-form">
          <input value={databaseName} onChange={(event) => setDatabaseName(event.target.value)} />
          <button className="primary" disabled={busy || !databaseName.trim()} onClick={() => void post("/api/mysql/create-db", { name: databaseName })}>
            <Database size={18} />
            <span>Create</span>
          </button>
          <button disabled={busy || !databaseName.trim()} onClick={() => void loadEnv()}>
            <FileText size={18} />
            <span>Laravel Env</span>
          </button>
        </div>
        {envText ? <pre className="snippet">{envText}</pre> : null}
        <dl className="details">
          <dt>Version</dt>
          <dd>{activeDatabaseLabel}</dd>
          <dt>Port</dt>
          <dd>{summary.config.mysql.port}</dd>
          <dt>Root user</dt>
          <dd>{summary.config.mysql.rootUser}</dd>
          <dt>Data directory</dt>
          <dd>{summary.paths.mysqlData}</dd>
          <dt>Runtime root</dt>
          <dd>{activeRuntime?.root ?? ""}</dd>
        </dl>
      </div>
    </>
  );
}

function Redis({
  summary,
  post,
  installJobs,
  startRuntimeInstall,
  busy
}: ViewProps & {
  installJobs: RuntimeJobMap;
  startRuntimeInstall: (kind: RuntimeKind, version?: string, force?: boolean) => Promise<RuntimeInstallJob | undefined>;
}) {
  const [port, setPort] = useState(String(summary.config.redis.port));
  const redis = summary.runtimes.redis;
  const installJob = latestRuntimeJob(Object.values(installJobs), "redis", redis.version);
  const installing = installJob ? isActiveRuntimeJob(installJob) : false;
  const showInstallProgress = installJob ? installing || installJob.status === "failed" : false;

  useEffect(() => {
    setPort(String(summary.config.redis.port));
  }, [summary.config.redis.port]);

  return (
    <>
      <ServiceStrip service={summary.services.redis} />
      <div className="toolbar">
        <button
          className={!redis.installed || redis.updateAvailable ? "primary" : ""}
          disabled={busy || (redis.installed && !redis.updateAvailable) || installing}
          onClick={() => void startRuntimeInstall("redis", redis.version, Boolean(redis.updateAvailable))}
        >
          <Download size={18} />
          <span>{runtimeActionLabel(redis, installJob, "Install Redis")}</span>
        </button>
        <button className="primary" disabled={busy || summary.services.redis.state === "running"} onClick={() => void post("/api/redis/start")}>
          <Play size={18} />
          <span>Start</span>
        </button>
        <button disabled={busy} onClick={() => void post("/api/redis/stop")}>
          <CircleStop size={18} />
          <span>Stop</span>
        </button>
        <button disabled={busy} onClick={() => void post("/api/redis/restart")}>
          <RotateCw size={18} />
          <span>Restart</span>
        </button>
        <button disabled={busy} onClick={() => void post("/api/redis/shell")}>
          <SquareTerminal size={18} />
          <span>Open CLI</span>
        </button>
      </div>
      {installJob && showInstallProgress ? <RuntimeProgress job={installJob} /> : null}
      <div className="two-column">
        <div className="panel">
          <h2>Connection</h2>
          <div className="inline-form">
            <input value={port} onChange={(event) => setPort(event.target.value)} inputMode="numeric" />
            <button disabled={busy || !port.trim()} onClick={() => void post("/api/redis/port", { port: Number(port) })}>
              <Settings size={18} />
              <span>Set Port</span>
            </button>
            <button disabled={busy} onClick={() => void post("/api/redis/port", { port: "auto" })}>
              <RotateCw size={18} />
              <span>Auto Port</span>
            </button>
          </div>
          <dl className="details">
            <dt>Host</dt>
            <dd>127.0.0.1</dd>
            <dt>Port</dt>
            <dd>{summary.config.redis.port}</dd>
            <dt>Data directory</dt>
            <dd>{summary.paths.redisData}</dd>
          </dl>
        </div>
        <div className="panel">
          <h2>Runtime</h2>
          <dl className="details">
            <dt>Version</dt>
            <dd>{redis.installedPackageVersion ?? redis.version}</dd>
            <dt>Binary</dt>
            <dd>{redis.binary}</dd>
            <dt>Root</dt>
            <dd>{summary.paths.redisRoot}</dd>
            <dt>Log</dt>
            <dd>{summary.services.redis.logPath}</dd>
          </dl>
        </div>
      </div>
    </>
  );
}

function Logs({ summary, post, busy, language }: ViewProps) {
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState<"all" | LogSeverity>("all");
  const [latestFirst, setLatestFirst] = useState(false);
  const confirm = useDesktopConfirm();
  const services = Array.from(new Set(summary.logs.map(logService))).sort();
  const filteredLogs = summary.logs.filter((line) => {
    const normalizedQuery = query.trim().toLowerCase();
    const matchesQuery = !normalizedQuery || line.toLowerCase().includes(normalizedQuery);
    const matchesService = serviceFilter === "all" || logService(line) === serviceFilter;
    const matchesSeverity = severityFilter === "all" || logSeverity(line) === severityFilter;
    return matchesQuery && matchesService && matchesSeverity;
  });
  const visibleLogs = latestFirst ? [...filteredLogs].reverse() : filteredLogs;
  const errorLineCount = summary.logs.filter((line) => logSeverity(line) === "error").length;
  const warningLineCount = summary.logs.filter((line) => logSeverity(line) === "warning").length;
  const displayText = visibleLogs.join("\n") || (language === "ar" ? "لا توجد سجلات تطابق المرشحات الحالية." : "No log entries match the current filters.");
  const insightText = summary.logInsights.groups.length
    ? summary.logInsights.groups
        .map((group) => `- [${group.severity}] ${group.service} x${group.count}: ${group.message}${group.action ? `\n  ${language === "ar" ? "إجراء" : "Action"}: ${group.action}` : ""}`)
        .join("\n")
    : language === "ar" ? "لا توجد تحذيرات أو أخطاء مجمعة." : "No grouped warnings or errors.";
  const modelText = [
    "Laraboxs diagnostic log",
    `Generated: ${new Date().toISOString()}`,
    `Grouped issues: ${summary.logInsights.groups.length}, warning lines=${summary.logInsights.warningLines}, error lines=${summary.logInsights.errorLines}`,
    `Filters: service=${serviceFilter}, severity=${severityFilter}, query=${query.trim() || "none"}`,
    "",
    "Insights:",
    insightText,
    "",
    "```text",
    displayText,
    "```"
  ].join("\n");

  async function copyLogs() {
    await copyTextToClipboard(modelText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  async function clearAllLogs() {
    const confirmed = await confirm({
      title: language === "ar" ? "مسح كل سجلات laraboxs؟" : "Clear all Laraboxs logs?",
      message: language === "ar" ? "هذا يزيل سجلات التشغيل المعروضة في اللوحة." : "This removes the runtime log entries shown in the dashboard.",
      details: [language === "ar" ? "هذا الإجراء لا يحذف المشاريع أو تثبيتات الأدوات." : "The action does not delete projects or runtime installations."],
      confirmLabel: language === "ar" ? "مسح السجلات" : "Clear Logs",
      tone: "warning"
    });
    if (!confirmed) {
      return;
    }
    await post("/api/logs/clear");
  }

  return (
    <div className="logs-view">
      <div className="logs-diagnostics-column">
      <div className="logs-summary-strip">
        <button
          className={severityFilter === "all" && serviceFilter === "all" && !query.trim() ? "logs-summary-card active" : "logs-summary-card"}
          onClick={() => {
            setSeverityFilter("all");
            setServiceFilter("all");
            setQuery("");
          }}
          title={language === "ar" ? "عرض كل السجلات" : "Show all logs"}
        >
          <FileText size={16} />
          <span>{language === "ar" ? "إجمالي الأسطر" : "Total Lines"}</span>
          <strong>{summary.logs.length}</strong>
        </button>
        <button
          className={`${errorLineCount ? "logs-summary-card red" : "logs-summary-card"} ${severityFilter === "error" ? "active" : ""}`}
          onClick={() => setSeverityFilter("error")}
          title={language === "ar" ? "عرض الأخطاء" : "Show errors"}
        >
          <CircleAlert size={16} />
          <span>{language === "ar" ? "أخطاء" : "Errors"}</span>
          <strong>{errorLineCount}</strong>
        </button>
        <button
          className={`${warningLineCount ? "logs-summary-card amber" : "logs-summary-card"} ${severityFilter === "warning" ? "active" : ""}`}
          onClick={() => setSeverityFilter("warning")}
          title={language === "ar" ? "عرض التحذيرات" : "Show warnings"}
        >
          <CircleAlert size={16} />
          <span>{language === "ar" ? "تحذيرات" : "Warnings"}</span>
          <strong>{warningLineCount}</strong>
        </button>
        <button
          className={query.trim() || serviceFilter !== "all" || severityFilter !== "all" ? "logs-summary-card green active" : "logs-summary-card green"}
          onClick={() => setLatestFirst((current) => !current)}
          title={language === "ar" ? "تبديل الأحدث أولاً" : "Toggle latest logs first"}
        >
          <Search size={16} />
          <span>{language === "ar" ? "مُصفّاة" : "Filtered"}</span>
          <strong>{visibleLogs.length}</strong>
        </button>
      </div>

      <section className="log-insights-panel">
        <div className="settings-panel-header">
          <Activity size={18} />
          <div>
            <strong>{language === "ar" ? "التشخيصات المجمعة" : "Grouped Diagnostics"}</strong>
            <span>
              {summary.logInsights.groups.length
                ? language === "ar"
                  ? `${summary.logInsights.groups.length} مشاكل من ${summary.logInsights.warningLines + summary.logInsights.errorLines} أسطر تحذير`
                  : `${summary.logInsights.groups.length} issues from ${summary.logInsights.warningLines + summary.logInsights.errorLines} warning lines`
                : language === "ar" ? "لا توجد تحذيرات أو أخطاء" : "No warnings or errors detected"}
            </span>
          </div>
        </div>
        <div className="log-insight-grid">
          {summary.logInsights.groups.slice(0, 6).map((group) => (
            <div key={group.id} className={`log-insight-card ${group.severity}`}>
              <CircleAlert size={18} />
              <div>
                <div className="log-insight-title">
                  <strong>{group.service}</strong>
                  <Badge label={`x${group.count}`} tone={group.severity === "error" ? "red" : "amber"} />
                </div>
                <p>{group.message}</p>
                {group.action ? <small>{group.action}</small> : null}
              </div>
            </div>
          ))}
          {!summary.logInsights.groups.length ? <div className="settings-empty-row">The latest logs look clean.</div> : null}
        </div>
      </section>
      </div>

      <div className="logs-runtime-column">
      <div className="logs-toolbar">
        <div className="logs-meta">
          <strong>Runtime Logs</strong>
          <span>{summary.logs.length ? `${visibleLogs.length}/${summary.logs.length} lines` : "empty"}</span>
        </div>
        <div className="logs-actions">
          <button disabled={busy} onClick={() => void copyLogs()} title="Copy logs for any model">
            <Clipboard size={18} />
            <span>{copied ? "Copied" : "Copy for Model"}</span>
          </button>
          <button className="danger-log-button" disabled={busy || summary.logs.length === 0} onClick={() => void clearAllLogs()} title="Clear all logs">
            <Trash2 size={18} />
            <span>Clear Logs</span>
          </button>
        </div>
      </div>
      <div className="logs-filterbar">
        <div className="logs-search">
          <Search size={14} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search logs..." />
        </div>
        <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as "all" | LogSeverity)}>
          <option value="all">All severity</option>
          <option value="error">Errors</option>
          <option value="warning">Warnings</option>
          <option value="info">Info</option>
        </select>
        <label className="compact-toggle logs-toggle">
          <input type="checkbox" checked={latestFirst} onChange={(event) => setLatestFirst(event.target.checked)} />
          <span>Latest first</span>
        </label>
        <button
          className="logs-clear-filters"
          disabled={!query.trim() && serviceFilter === "all" && severityFilter === "all" && !latestFirst}
          onClick={() => {
            setQuery("");
            setServiceFilter("all");
            setSeverityFilter("all");
            setLatestFirst(false);
          }}
          title="Clear log filters"
        >
          <X size={14} />
          <span>Clear</span>
        </button>
      </div>
      <div className="logs-service-chips" aria-label="Log service quick filters">
        <button className={serviceFilter === "all" ? "active" : ""} onClick={() => setServiceFilter("all")}>
          All
        </button>
        {services.slice(0, 8).map((service) => (
          <button key={service} className={serviceFilter === service ? "active" : ""} onClick={() => setServiceFilter(service)}>
            {service}
          </button>
        ))}
      </div>
      <div className="logs" role="log" aria-label="Filtered runtime logs">
        {visibleLogs.length ? (
          visibleLogs.map((line, index) => (
            <div key={`${line}-${index}`} className={`log-line ${logSeverity(line)}`}>
              <span>{logService(line)}</span>
              <p>{line}</p>
            </div>
          ))
        ) : (
          <div className="log-line info">
            <span>logs</span>
            <p>{displayText}</p>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

type ToolsPane = "ports" | "updates";

function Tools({
  summary,
  request,
  startRuntimeInstall,
  busy,
  language,
  updateStatus
}: ViewProps & {
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
  startRuntimeInstall: (kind: RuntimeKind, version?: string, force?: boolean) => Promise<RuntimeInstallJob | undefined>;
  updateStatus: UpdateCenterStatus | null;
}) {
  const [pane, setPane] = useState<ToolsPane>("ports");
  const appUpdateAvailable = Boolean(updateStatus?.application.updateAvailable);
  const runtimeUpdates = updateStatus?.items.filter((item) => item.updateAvailable).length ?? 0;
  const missingRuntimes = updateStatus?.items.filter((item) => !item.installed).length ?? 0;
  const panes: Array<{ id: ToolsPane; label: string; detail: string; icon: typeof Globe }> = [
    { id: "ports", label: language === "ar" ? "المنافذ" : "Ports", detail: language === "ar" ? "تعارضات واقتراحات" : "conflicts and suggestions", icon: Network },
    { id: "updates", label: language === "ar" ? "التحديثات" : "Updates", detail: language === "ar" ? "الأدوات وLaravel" : "runtimes and Laravel", icon: PackageCheck }
  ];

  return (
    <div className="tools-view">
      <div className="settings-tabs tools-tabs" role="tablist" aria-label="Tool sections">
        {panes.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} className={pane === item.id ? "active" : ""} onClick={() => setPane(item.id)}>
              <Icon size={16} />
              <span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
            </button>
          );
        })}
      </div>

      {pane === "ports" ? <PortTools request={request} busy={busy} /> : null}
      {pane === "updates" ? <UpdateTools request={request} startRuntimeInstall={startRuntimeInstall} busy={busy} initialUpdates={updateStatus} /> : null}
    </div>
  );
}

function ToolSummaryCard({
  icon: Icon,
  label,
  value,
  detail,
  tone
}: {
  icon: typeof Globe;
  label: string;
  value: string;
  detail: string;
  tone: "default" | "green" | "amber";
}) {
  return (
    <div className={`tool-summary-card ${tone}`}>
      <Icon size={17} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function SiteDatabaseTools({
  site,
  request,
  busy
}: {
  site: Site;
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
  busy: boolean;
}) {
  const [info, setInfo] = useState<SiteDatabaseInfo | null>(null);
  const [tables, setTables] = useState<DatabaseTableInfo[]>([]);
  const [importPath, setImportPath] = useState("");
  const [exportResult, setExportResult] = useState<DatabaseExportResult | null>(null);
  const [databaseError, setDatabaseError] = useState("");
  const [loading, setLoading] = useState(false);
  const confirm = useDesktopConfirm();
  const configuredDatabase = info?.supported && info.configured && info.database ? info.database : "";
  const displayDatabase = configuredDatabase || info?.suggestedDatabase || "";

  async function loadSiteDatabase() {
    setLoading(true);
    try {
      const payload = await getJson<SiteDatabaseInfo>(`/api/sites/database?site=${encodeURIComponent(site.domain)}`);
      setInfo(payload);
      setExportResult(null);

      if (payload.supported && payload.configured && payload.database) {
        try {
          const tablesPayload = await getJson<{ tables: DatabaseTableInfo[] }>(`/api/databases/tables?database=${encodeURIComponent(payload.database)}`);
          setTables(tablesPayload.tables);
          setDatabaseError("");
        } catch (error) {
          setTables([]);
          setDatabaseError(error instanceof Error ? error.message : String(error));
        }
      } else {
        setTables([]);
        setDatabaseError(payload.message ?? "");
      }
    } catch (error) {
      setInfo(null);
      setTables([]);
      setDatabaseError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSiteDatabase();
  }, [site.domain]);

  async function applyLocalDatabase() {
    if (configuredDatabase) {
      await request("/api/databases/create", { name: configuredDatabase });
      showToast(`Database ${configuredDatabase} is ready.`, "success");
    } else {
      const payload = (await request("/api/sites/env/apply", {
        site: site.domain,
        profile: "database",
        createDatabase: true
      })) as { result?: SiteEnvApplyResult };
      if (payload.result?.databaseError) {
        setDatabaseError(payload.result.databaseError);
      } else {
        showToast(`Database settings applied for ${site.domain}.`, "success");
      }
    }
    await loadSiteDatabase();
  }

  async function exportSelected() {
    if (!configuredDatabase) return;
    const payload = (await request("/api/databases/export", { name: configuredDatabase })) as { export?: DatabaseExportResult };
    setExportResult(payload.export ?? null);
  }

  async function browseSqlFile() {
    const payload = (await request("/api/dialog/sql-file", { initialPath: importPath })) as { path?: string | null };
    if (payload.path) {
      setImportPath(payload.path);
    }
  }

  async function importSelected() {
    if (!configuredDatabase) return;
    await request("/api/databases/import", { name: configuredDatabase, path: importPath });
    await loadSiteDatabase();
    showToast(`Imported ${pathTail(importPath) || "SQL file"} into ${configuredDatabase}.`, "success");
  }

  async function dropDatabase() {
    if (!configuredDatabase) return;
    const confirmed = await confirm({
      title: `Drop database ${configuredDatabase}?`,
      message: "This deletes the local database used by this site.",
      details: ["Export it first if you need a copy.", `The site's .env will still reference ${configuredDatabase}.`],
      confirmLabel: "Drop Database",
      tone: "danger"
    });
    if (!confirmed) return;
    await request("/api/databases/drop", { name: configuredDatabase });
    await loadSiteDatabase();
  }

  return (
    <div className="tools-grid site-database-grid">
      <section className="settings-panel wide-settings-panel">
        <SettingsPanelHeader icon={Database} title={displayDatabase || "Database"} detail={info?.configured ? "From this site's .env" : "Suggested local database"} />
        {databaseError || info?.message ? <div className="notice compact-notice">{databaseError || info?.message}</div> : null}
        <dl className="details site-database-details">
          <dt>Database</dt>
          <dd>{configuredDatabase || info?.suggestedDatabase || "Unknown"}</dd>
          <dt>Connection</dt>
          <dd>{info?.connection || "mysql"}</dd>
          <dt>.env</dt>
          <dd>{info?.envPath || "Loading..."}</dd>
        </dl>
        <div className="settings-actions">
          <button disabled={busy || loading} onClick={() => void loadSiteDatabase()}>
            <RotateCw size={16} />
            <span>Refresh</span>
          </button>
          <button className="primary" disabled={busy || loading || !info?.supported} onClick={() => void applyLocalDatabase()}>
            <Database size={16} />
            <span>{configuredDatabase ? "Ensure DB" : "Apply Local DB"}</span>
          </button>
        </div>
      </section>

      <section className="settings-panel wide-settings-panel">
        <SettingsPanelHeader icon={Database} title={configuredDatabase || "Tables"} detail={configuredDatabase ? `${tables.length} tables` : "Apply local database first"} />
        <div className="database-table-list">
          {tables.map((table) => (
            <div key={table.name} className="database-table-row">
              <strong>{table.name}</strong>
              <span>{typeof table.rows === "number" ? `${table.rows} rows` : "rows unknown"}</span>
            </div>
          ))}
          {configuredDatabase && !tables.length ? <div className="settings-empty-row">{loading ? "Loading tables..." : "No tables found."}</div> : null}
          {!configuredDatabase ? <div className="settings-empty-row">No managed database is configured for this site.</div> : null}
        </div>
        <div className="settings-actions">
          <button disabled={busy || loading || !configuredDatabase} onClick={() => void exportSelected()}>
            <Download size={16} />
            <span>Export SQL</span>
          </button>
          <button className="danger-log-button" disabled={busy || loading || !configuredDatabase} onClick={() => void dropDatabase()}>
            <Trash2 size={16} />
            <span>Drop</span>
          </button>
        </div>
        {exportResult ? <pre className="snippet compact-snippet">{exportResult.path}</pre> : null}
      </section>

      <section className="settings-panel wide-settings-panel">
        <SettingsPanelHeader icon={FolderPlus} title="Import SQL" detail={configuredDatabase ? `Target: ${configuredDatabase}` : "Choose this site's database first"} />
        <div className="settings-form-grid">
          <label className="sql-import-target-field">
            <span>Import target</span>
            <input readOnly value={configuredDatabase || "Apply local database first"} />
          </label>
          <label className="sql-import-path-field">
            <span>SQL import path</span>
            <div className="path-picker sql-import-picker">
              <input value={importPath} onChange={(event) => setImportPath(event.target.value)} placeholder="C:\backup\app.sql" />
              <button
                type="button"
                className="sql-file-picker-button"
                disabled={busy || loading || !configuredDatabase}
                onClick={() => void browseSqlFile()}
                title={configuredDatabase ? `Choose SQL file for ${configuredDatabase}` : "Apply local database first"}
              >
                <FolderOpen size={16} />
                <span>Choose SQL File</span>
              </button>
            </div>
          </label>
        </div>
        <div className="settings-actions">
          <button disabled={busy || loading || !configuredDatabase || !importPath.trim()} onClick={() => void importSelected()}>
            <FileText size={16} />
            <span>Import SQL</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function ProjectTools({
  site,
  request,
  busy
}: {
  site: Site;
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
  busy: boolean;
}) {
  const [commands, setCommands] = useState<SiteCommandDefinition[]>([]);
  const [jobs, setJobs] = useState<SiteCommandJob[]>([]);
  const [diagnostics, setDiagnostics] = useState<SiteDiagnosticReport | null>(null);
  const [toolError, setToolError] = useState("");
  const [loading, setLoading] = useState(false);
  const activeJobKey = jobs
    .filter((job) => job.status === "queued" || job.status === "running")
    .map((job) => job.id)
    .sort()
    .join("|");
  const latestJob = jobs[0];

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [commandsPayload, jobsPayload, diagnosticsPayload] = await Promise.all([
          getJson<{ commands: SiteCommandDefinition[] }>("/api/sites/commands"),
          getJson<{ jobs: SiteCommandJob[] }>(`/api/sites/commands/jobs?site=${encodeURIComponent(site.domain)}`),
          getJson<SiteDiagnosticReport>(`/api/sites/diagnostics?site=${encodeURIComponent(site.domain)}`)
        ]);
        if (!cancelled) {
          setCommands(commandsPayload.commands);
          setJobs(jobsPayload.jobs);
          setDiagnostics(diagnosticsPayload);
          setToolError("");
        }
      } catch (error) {
        if (!cancelled) {
          setToolError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [site.domain]);

  useEffect(() => {
    if (!activeJobKey) return;
    let cancelled = false;
    async function poll() {
      const payload = await getJson<{ jobs: SiteCommandJob[] }>(`/api/sites/commands/jobs?site=${encodeURIComponent(site.domain)}`);
      if (!cancelled) {
        setJobs(payload.jobs);
      }
    }
    const timer = window.setInterval(() => void poll(), 1200);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeJobKey, site.domain]);

  async function runCommand(command: SiteCommandKind) {
    const payload = (await request("/api/sites/commands/run", { site: site.domain, command })) as { job?: SiteCommandJob };
    if (payload.job) {
      setJobs((current) => [payload.job!, ...current.filter((job) => job.id !== payload.job!.id)]);
    }
  }

  async function reloadDiagnostics() {
    try {
      setDiagnostics(await getJson<SiteDiagnosticReport>(`/api/sites/diagnostics?site=${encodeURIComponent(site.domain)}`));
      setToolError("");
    } catch (error) {
      setToolError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="tools-grid">
      <section className="settings-panel wide-settings-panel">
        <SettingsPanelHeader icon={SquareTerminal} title="Project Commands" detail={site.path} />
        {toolError ? <div className="notice compact-notice">{toolError}</div> : null}
        <div className="tools-action-grid">
          {commands.map((command) => (
            <button key={command.id} disabled={busy || loading || latestJob?.status === "running"} onClick={() => void runCommand(command.id)} title={command.detail}>
              <SquareTerminal size={16} />
              <span>{command.label}</span>
            </button>
          ))}
        </div>
        {latestJob ? <CommandJobPanel job={latestJob} /> : <div className="settings-empty-row">No commands have run for this site yet.</div>}
      </section>

      <EnvHelperPanel site={site} request={request} busy={busy} />

      <section className="settings-panel wide-settings-panel">
        <SettingsPanelHeader
          icon={Activity}
          title="Diagnostics"
          detail={diagnostics ? `${diagnostics.summary.fail} failures, ${diagnostics.summary.warn} warnings` : "Checking site"}
        />
        <div className="settings-actions">
          <button disabled={busy || loading} onClick={() => void reloadDiagnostics()}>
            <RotateCw size={16} />
            <span>Recheck</span>
          </button>
        </div>
        <div className="diagnostic-grid">
          {diagnostics?.checks.map((check) => (
            <div key={check.id} className={`diagnostic-item ${check.tone}`}>
              {check.tone === "pass" ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}
              <div>
                <strong>{check.label}</strong>
                <span>{check.detail}</span>
                {check.tone !== "pass" && check.fix ? <small>{check.fix}</small> : null}
              </div>
            </div>
          ))}
          {!diagnostics ? <div className="settings-empty-row">Loading diagnostics...</div> : null}
        </div>
      </section>
    </div>
  );
}

function EnvHelperPanel({
  site,
  request,
  busy
}: {
  site: Site;
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
  busy: boolean;
}) {
  const [profiles, setProfiles] = useState<SiteEnvProfile[]>([]);
  const [envPath, setEnvPath] = useState("");
  const [selectedProfile, setSelectedProfile] = useState<SiteEnvProfileKind>("full");
  const [createDatabase, setCreateDatabase] = useState(true);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const profile = profiles.find((item) => item.id === selectedProfile) ?? profiles[0];
  const canCreateDatabase = Boolean(profile?.values.DB_DATABASE);

  useEffect(() => {
    let cancelled = false;
    async function loadProfiles() {
      setLoading(true);
      setError("");
      try {
        const payload = await getJson<{ site: Site; envPath: string; profiles: SiteEnvProfile[] }>(`/api/sites/env?site=${encodeURIComponent(site.domain)}`);
        if (!cancelled) {
          setProfiles(payload.profiles);
          setEnvPath(payload.envPath);
          setSelectedProfile((current) => (payload.profiles.some((item) => item.id === current) ? current : "full"));
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : String(requestError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void loadProfiles();
    return () => {
      cancelled = true;
    };
  }, [site.domain]);

  async function copyProfile() {
    if (!profile) return;
    await copyTextToClipboard(profile.block);
    setCopied(true);
    setMessage(`${profile.label} .env block copied.`);
    window.setTimeout(() => setCopied(false), 1400);
  }

  async function applyProfile() {
    if (!profile) return;
    setError("");
    setMessage("");
    try {
      const payload = (await request("/api/sites/env/apply", {
        site: site.domain,
        profile: profile.id,
        createDatabase: createDatabase && canCreateDatabase
      })) as { result?: SiteEnvApplyResult };
      const result = payload.result;
      if (result?.databaseError) {
        setMessage(`.env updated at ${result.envPath}.`);
        setError(`Database was not created: ${result.databaseError}`);
        return;
      }
      const restartNote = result?.phpRestarted ? " PHP restarted with Redis enabled." : "";
      setMessage(result?.createdDatabase ? `.env updated and database ${result.createdDatabase} is ready.${restartNote}` : `.env updated at ${result?.envPath ?? envPath}.${restartNote}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  }

  return (
    <section className="settings-panel wide-settings-panel env-helper-panel">
      <SettingsPanelHeader icon={FileText} title="Environment Helper" detail={envPath || "Generate .env values for local services"} />
      {error ? <div className="notice compact-notice">{error}</div> : null}
      {message ? <div className="env-helper-message">{message}</div> : null}
      <div className="env-helper-toolbar">
        <select value={profile?.id ?? selectedProfile} disabled={loading || !profiles.length} onChange={(event) => setSelectedProfile(event.target.value as SiteEnvProfileKind)}>
          {profiles.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <label className={!canCreateDatabase ? "compact-toggle disabled" : "compact-toggle"}>
          <input type="checkbox" checked={createDatabase} disabled={!canCreateDatabase} onChange={(event) => setCreateDatabase(event.target.checked)} />
          <span>Create DB</span>
        </label>
        <button disabled={busy || loading || !profile} onClick={() => void copyProfile()}>
          <Clipboard size={16} />
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
        <button className="primary" disabled={busy || loading || !profile} onClick={() => void applyProfile()}>
          <Save size={16} />
          <span>Apply to .env</span>
        </button>
      </div>
      <textarea className="env-helper-block" readOnly value={profile?.block ?? ""} aria-label=".env block" />
      {profile ? <span className="settings-warning env-helper-detail">{profile.detail}</span> : null}
    </section>
  );
}

function CommandJobPanel({ job }: { job: SiteCommandJob }) {
  return (
    <div className={`command-job-panel ${job.status}`}>
      <div className="runtime-progress-meta">
        <strong>{job.label} · {statusLabelForJob(job.status)}</strong>
        <span>{job.message}</span>
      </div>
      <div className="progress-track" aria-label={`${job.label} progress`}>
        <div className="progress-fill" style={{ width: `${Math.max(job.percent, job.status === "running" ? 4 : 0)}%` }} />
      </div>
      <div className="command-log">
        {job.logs.slice(-10).map((line, index) => (
          <div key={`${line.at}-${index}`} className={`new-site-log-line ${line.level}`}>
            <span>{new Date(line.at).toLocaleTimeString()}</span>
            <p>{line.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkerTools({
  site,
  request,
  busy
}: {
  site: Site;
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
  busy: boolean;
}) {
  const [workers, setWorkers] = useState<SiteWorkerStatus[]>([]);
  const workerKinds: SiteWorkerKind[] = ["queue", "schedule"];

  async function loadWorkers() {
    const payload = await getJson<{ workers: SiteWorkerStatus[] }>(`/api/sites/workers?site=${encodeURIComponent(site.domain)}`);
    setWorkers(payload.workers);
  }

  useEffect(() => {
    void loadWorkers();
    const timer = window.setInterval(() => void loadWorkers(), 1500);
    return () => window.clearInterval(timer);
  }, [site.domain]);

  async function setWorker(kind: SiteWorkerKind, action: "start" | "stop") {
    const payload = (await request(`/api/sites/workers/${action}`, { site: site.domain, kind })) as { worker?: SiteWorkerStatus };
    if (payload.worker) {
      setWorkers((current) => [payload.worker!, ...current.filter((worker) => worker.kind !== kind)]);
    }
  }

  return (
    <div className="tools-grid">
      {workerKinds.map((kind) => {
        const worker = workers.find((item) => item.kind === kind);
        const running = worker?.state === "running";
        return (
          <section key={kind} className="settings-panel wide-settings-panel">
            <SettingsPanelHeader icon={kind === "queue" ? ListRestart : RotateCw} title={kind === "queue" ? "Queue Worker" : "Scheduler"} detail={worker?.message ?? "Stopped"} />
            <ServiceStrip service={{ name: kind, state: running ? "running" : worker?.state === "failed" ? "unknown" : "stopped", pid: worker?.pid, message: worker?.message }} />
            <div className="settings-actions">
              <button className="primary" disabled={busy || running} onClick={() => void setWorker(kind, "start")}>
                <Play size={16} />
                <span>Start</span>
              </button>
              <button disabled={busy || !running} onClick={() => void setWorker(kind, "stop")}>
                <CircleStop size={16} />
                <span>Stop</span>
              </button>
            </div>
            <div className="command-log worker-log">
              {(worker?.logs ?? []).slice(-10).map((line, index) => (
                <div key={`${line.at}-${index}`} className={`new-site-log-line ${line.level}`}>
                  <span>{new Date(line.at).toLocaleTimeString()}</span>
                  <p>{line.message}</p>
                </div>
              ))}
              {!worker?.logs.length ? <div className="settings-empty-row">No worker output yet.</div> : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function PortTools({ busy }: { request: (path: string, body?: Record<string, unknown>) => Promise<unknown>; busy: boolean }) {
  const [ports, setPorts] = useState<PortCheckResult[]>([]);
  const [portError, setPortError] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadPorts() {
    setLoading(true);
    try {
      const payload = await getJson<{ ports: PortCheckResult[] }>("/api/ports/check");
      setPorts(payload.ports);
      setPortError("");
    } catch (error) {
      setPorts([]);
      setPortError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPorts();
  }, []);

  return (
    <section className="settings-panel wide-settings-panel">
      <SettingsPanelHeader icon={Network} title="Port Conflicts" detail={`${ports.filter((port) => port.status === "conflict").length} conflicts`} />
      {portError ? <div className="notice compact-notice">{portError}</div> : null}
      <div className="settings-actions">
        <button disabled={busy || loading} onClick={() => void loadPorts()}>
          <RotateCw size={16} />
          <span>Check Ports</span>
        </button>
      </div>
      <div className="port-grid">
        {ports.map((port) => (
          <div key={port.id} className={`port-card ${port.status}`}>
            <Network size={16} />
            <div>
              <strong>{port.label}</strong>
              <span>{port.message}</span>
              {port.pid ? <small>PID {port.pid}</small> : null}
            </div>
            <Badge label={port.status} tone={port.status === "conflict" ? "red" : port.status === "ok" ? "green" : "amber"} />
          </div>
        ))}
        {!ports.length ? <div className="settings-empty-row">{loading ? "Checking ports..." : "No port checks loaded."}</div> : null}
      </div>
    </section>
  );
}

function UpdateTools({
  request,
  startRuntimeInstall,
  busy,
  initialUpdates
}: {
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
  startRuntimeInstall: (kind: RuntimeKind, version?: string, force?: boolean) => Promise<RuntimeInstallJob | undefined>;
  busy: boolean;
  initialUpdates: UpdateCenterStatus | null;
}) {
  const [updates, setUpdates] = useState<UpdateCenterStatus | null>(initialUpdates);
  const [updateError, setUpdateError] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadUpdates(showLoading = true) {
    if (showLoading) {
      setLoading(true);
    }
    try {
      setUpdates(await getJsonWithTimeout<UpdateCenterStatus>("/api/updates", 9000));
      setUpdateError("");
    } catch (error) {
      setUpdates(null);
      setUpdateError(error instanceof Error ? error.message : String(error));
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (initialUpdates) {
      setUpdates(initialUpdates);
      void loadUpdates(false);
      return;
    }
    void loadUpdates(true);
  }, []);

  async function runUpdate(item: UpdateCenterStatus["items"][number]) {
    if (item.kind === "laravel-installer") {
      await request("/api/laravel-installer/install", {});
      await loadUpdates();
      return;
    }
    await startRuntimeInstall(item.kind, item.version, item.updateAvailable);
    await loadUpdates();
  }

  function openApplicationUpdate() {
    const app = updates?.application;
    const target = app?.updateAvailable ? app.asset?.downloadUrl || app.releaseUrl : app?.releaseUrl || app?.asset?.downloadUrl;
    if (target) {
      void openExternalUrl(target);
    }
  }

  const appUpdate = updates?.application;

  return (
    <section className="settings-panel wide-settings-panel">
      <SettingsPanelHeader icon={PackageCheck} title="Updates Center" detail={updates ? `Checked ${new Date(updates.checkedAt).toLocaleTimeString()}` : "Checking releases and runtimes"} />
      {updateError ? <div className="notice compact-notice">{updateError}</div> : null}
      <div className="settings-actions">
        <button disabled={busy || loading} onClick={() => void loadUpdates()}>
          <RotateCw size={16} />
          <span>Refresh</span>
        </button>
      </div>
      {appUpdate ? (
        <div className={`application-update-card ${appUpdate.status}`}>
          <div className="application-update-main">
            <div className="application-update-icon">
              <PackageCheck size={22} />
            </div>
            <div>
              <span className="eyebrow">Laraboxs App</span>
              <h3>{appUpdate.updateAvailable ? `Version ${appUpdate.latestVersion} is ready` : `Version ${appUpdate.currentVersion}`}</h3>
              <p>{appUpdate.message ?? "Release status loaded from GitHub."}</p>
              <div className="application-update-meta">
                <span>Current {appUpdate.currentVersion}</span>
                {appUpdate.latestVersion ? <span>Latest {appUpdate.latestVersion}</span> : null}
                {appUpdate.asset ? <span>{appUpdate.asset.name} · {formatBytes(appUpdate.asset.size)}</span> : null}
              </div>
            </div>
          </div>
          <div className="application-update-actions">
            <Badge
              label={appUpdate.status === "available" ? "update" : appUpdate.status === "current" ? "current" : "offline"}
              tone={appUpdate.status === "available" ? "amber" : appUpdate.status === "current" ? "green" : "red"}
            />
            <button className={appUpdate.updateAvailable ? "primary" : ""} disabled={busy || loading || (!appUpdate.releaseUrl && !appUpdate.asset)} onClick={openApplicationUpdate}>
              {appUpdate.updateAvailable ? <Download size={16} /> : <ExternalLink size={16} />}
              <span>{appUpdate.updateAvailable ? "Download Update" : "Release Notes"}</span>
            </button>
          </div>
        </div>
      ) : null}
      <div className="updates-list">
        {(updates?.items ?? []).map((item) => (
          <div key={item.id} className="update-row">
            <PackageCheck size={16} />
            <div>
              <strong>{item.name} {item.version}</strong>
              <span>{item.message ?? (item.installed ? "Installed" : "Not installed")}</span>
            </div>
            <Badge label={item.updateAvailable ? "update" : item.installed ? "ready" : "missing"} tone={item.updateAvailable ? "amber" : item.installed ? "green" : "red"} />
            <button
              className={!item.installed || item.updateAvailable ? "primary" : ""}
              disabled={busy || loading || (item.installed && !item.updateAvailable)}
              onClick={() => void runUpdate(item)}
            >
              {item.installed ? <RotateCw size={16} /> : <Download size={16} />}
              <span>{item.installed ? "Update" : "Install"}</span>
            </button>
          </div>
        ))}
        {!updates?.items.length ? <div className="settings-empty-row">{loading ? "Checking updates..." : "No update data loaded."}</div> : null}
      </div>
    </section>
  );
}

function statusLabelForJob(status: SiteCommandJob["status"]): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "complete":
      return "Complete";
    case "failed":
      return "Failed";
  }
}

function SettingsView({
  summary,
  post,
  request,
  busy,
  language,
  onLanguageChange
}: ViewProps & {
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
  onLanguageChange: (language: AppLanguage) => void;
}) {
  type SettingsPane = "general" | "tools" | "paths" | "security";
  const [tld, setTld] = useState(summary.config.tld);
  const [folder, setFolder] = useState(summary.config.parkedFolders[0] ?? "");
  const [phpChoice, setPhpChoice] = useState(summary.config.globalPhpVersion);
  const [databaseChoice, setDatabaseChoice] = useState(summary.config.mysql.version);
  const [copiedPath, setCopiedPath] = useState("");
  const [hostsPreview, setHostsPreview] = useState("");
  const [installerStatus, setInstallerStatus] = useState<LaravelInstallerStatus | null>(null);
  const [installerBusy, setInstallerBusy] = useState(false);
  const [startupStatus, setStartupStatus] = useState<StartupStatus | null>(null);
  const [startupBusy, setStartupBusy] = useState(false);
  const [settingsPane, setSettingsPane] = useState<SettingsPane>("general");
  const confirm = useDesktopConfirm();

  const normalizedTld = normalizeLocalTld(tld);
  const tldValid = isValidLocalTld(normalizedTld);
  const tldChanged = normalizedTld !== summary.config.tld;
  const selectedDatabase = selectedMysqlRuntime(summary, databaseChoice);
  const databaseRunning = summary.services.mysql.state === "running";
  const firstParkedFolder = summary.config.parkedFolders[0] ?? "";
  const parkedFoldersKey = summary.config.parkedFolders.join("|");
  const phpVersionsKey = summary.runtimes.php.map((runtime) => runtime.version).join("|");
  const databaseVersionsKey = summary.runtimes.mysql.map((runtime) => runtime.version).join("|");
  const installerWorking = busy || installerBusy;
  const installerActionLabel = !installerStatus
    ? "Checking"
    : installerStatus.installed
      ? installerStatus.updateAvailable
        ? "Update"
        : "Installed"
      : "Install";
  const installerBadge = laravelInstallerBadge(installerStatus);
  const installerDetail = laravelInstallerDetail(installerStatus);
  const startupWorking = busy || startupBusy;
  const launchOnLogin = startupStatus?.launchAppOnLogin ?? summary.config.startup.launchAppOnLogin;
  const startServicesOnLaunch = startupStatus?.startServicesOnLaunch ?? summary.config.startup.startServicesOnLaunch;
  const startupSupported = startupStatus?.supported ?? false;
  const runningServicesCount = [summary.services.php, summary.services.nginx, summary.services.mysql, summary.services.redis].filter(
    (service) => service.state === "running"
  ).length;
  const pathRows = [
    { group: "Core", label: "Config", value: summary.paths.configFile, icon: FileText, reveal: true },
    { group: "Core", label: "Hosts", value: summary.paths.hostsFile, icon: Network, reveal: true },
    { group: "Core", label: "App data", value: summary.paths.home, icon: HardDrive },
    { group: "Core", label: "Logs", value: summary.paths.logs, icon: FileText },
    { group: "Runtime", label: "Nginx config", value: summary.paths.nginxConfig, icon: Server, reveal: true },
    { group: "Runtime", label: "Nginx sites", value: summary.paths.nginxSites, icon: FolderOpen },
    { group: "Runtime", label: "Database data", value: summary.paths.mysqlData, icon: Database },
    { group: "Security", label: "CA certificate", value: summary.ssl.certPath, icon: ShieldCheck, reveal: true }
  ];
  const pathGroups = ["Core", "Runtime", "Security"].map((group) => ({
    group,
    rows: pathRows.filter((row) => row.group === group)
  }));
  const settingsPanes: Array<{ id: SettingsPane; label: string; detail: string; icon: typeof Globe }> = [
    { id: "general", label: language === "ar" ? "عام" : "General", detail: language === "ar" ? "TLD وPHP وقاعدة البيانات والبدء" : "TLD, PHP, database, and startup", icon: SlidersHorizontal },
    { id: "tools", label: language === "ar" ? "الأدوات" : "Tools", detail: language === "ar" ? "مثبّت Laravel وملفات الإعداد" : "Laravel Installer and config files", icon: PackageCheck },
    { id: "paths", label: language === "ar" ? "المسارات" : "Paths", detail: language === "ar" ? "المجلدات المرتبطة وملفات التطبيق" : "Parked folders and app files", icon: FolderOpen },
    { id: "security", label: language === "ar" ? "الأمان" : "Security", detail: language === "ar" ? "Hosts وSSL وDefender" : "Hosts, SSL, and Defender", icon: Shield }
  ];

  useEffect(() => {
    setTld((current) => (normalizeLocalTld(current) === summary.config.tld ? summary.config.tld : current));
  }, [summary.config.tld]);

  useEffect(() => {
    setFolder((current) => (current.trim() ? current : firstParkedFolder));
  }, [firstParkedFolder, parkedFoldersKey]);

  useEffect(() => {
    setPhpChoice((current) => (summary.runtimes.php.some((runtime) => runtime.version === current) ? current : summary.config.globalPhpVersion));
  }, [phpVersionsKey, summary.config.globalPhpVersion, summary.runtimes.php]);

  useEffect(() => {
    setDatabaseChoice((current) => (summary.runtimes.mysql.some((runtime) => runtime.version === current) ? current : summary.config.mysql.version));
  }, [databaseVersionsKey, summary.config.mysql.version, summary.runtimes.mysql]);

  useEffect(() => {
    void loadLaravelInstallerStatus();
    void loadStartupStatus();
  }, []);

  async function saveGeneralSettings() {
    await request("/api/settings", { tld: normalizedTld });
    setHostsPreview("");
  }

  async function browseFolder() {
    const payload = (await request("/api/dialog/folder", { initialPath: folder })) as { path?: string | null };
    if (payload.path) {
      setFolder(payload.path);
    }
  }

  async function copyPath(value: string) {
    await copyTextToClipboard(value);
    setCopiedPath(value);
    window.setTimeout(() => setCopiedPath((current) => (current === value ? "" : current)), 1200);
  }

  async function previewHosts() {
    const payload = (await request("/api/hosts/sync", { dryRun: true })) as { hosts?: string };
    setHostsPreview(payload.hosts ?? "");
  }

  async function trustCa() {
    await post("/api/ssl/trust");
    showToast("Local CA trusted in Windows Root.", "success");
  }

  async function loadStartupStatus() {
    setStartupBusy(true);
    try {
      setStartupStatus(await getJson<StartupStatus>("/api/startup"));
    } finally {
      setStartupBusy(false);
    }
  }

  async function saveStartupSetting(patch: Partial<Pick<StartupStatus, "launchAppOnLogin" | "startServicesOnLaunch">>) {
    setStartupBusy(true);
    try {
      const payload = (await request("/api/startup", patch)) as { status?: StartupStatus };
      if (payload.status) {
        setStartupStatus(payload.status);
      } else {
        await loadStartupStatus();
      }
      showToast("Startup settings updated.", "success");
    } finally {
      setStartupBusy(false);
    }
  }

  async function loadLaravelInstallerStatus() {
    setInstallerBusy(true);
    try {
      setInstallerStatus(await getJson<LaravelInstallerStatus>("/api/laravel-installer/status"));
    } finally {
      setInstallerBusy(false);
    }
  }

  async function installLaravelInstaller() {
    setInstallerBusy(true);
    try {
      const payload = (await request("/api/laravel-installer/install", {})) as { status?: LaravelInstallerStatus };
      setInstallerStatus(payload.status ?? null);
      if (!payload.status) {
        await loadLaravelInstallerStatus();
      }
    } finally {
      setInstallerBusy(false);
    }
  }

  async function removeLaravelInstaller() {
    const confirmed = await confirm({
      title: "Remove Laravel Installer?",
      message: "This removes the Composer global Laravel Installer from this local environment.",
      details: ["You can install it again later from the same Tools panel."],
      confirmLabel: "Remove Installer",
      tone: "danger"
    });
    if (!confirmed) {
      return;
    }
    setInstallerBusy(true);
    try {
      const payload = (await request("/api/laravel-installer/uninstall", {})) as { status?: LaravelInstallerStatus };
      setInstallerStatus(payload.status ?? null);
      if (!payload.status) {
        await loadLaravelInstallerStatus();
      }
    } finally {
      setInstallerBusy(false);
    }
  }

  return (
    <div className="settings-view">
      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        {settingsPanes.map((pane) => {
          const Icon = pane.icon;
          return (
            <button key={pane.id} className={settingsPane === pane.id ? "active" : ""} onClick={() => setSettingsPane(pane.id)}>
              <Icon size={16} />
              <span>
                <strong>{pane.label}</strong>
                <small>{pane.detail}</small>
              </span>
            </button>
          );
        })}
      </div>
      <div className="settings-layout">
        {settingsPane === "general" ? (
          <>
        <section className="settings-panel">
          <SettingsPanelHeader icon={SlidersHorizontal} title="General" detail="Local names and default runtimes" />
          <div className="settings-form-grid">
            <label>
              <span>{language === "ar" ? "لغة الواجهة" : "Language"}</span>
              <div className="segmented language-segmented" aria-label={language === "ar" ? "لغة الواجهة" : "Interface language"}>
                <button className={language === "en" ? "active" : ""} onClick={() => onLanguageChange("en")}>
                  <Languages size={15} />
                  <span>English</span>
                </button>
                <button className={language === "ar" ? "active" : ""} onClick={() => onLanguageChange("ar")}>
                  <Languages size={15} />
                  <span>العربية</span>
                </button>
              </div>
            </label>
            <label>
              <span>Local TLD</span>
              <div className={tldValid || !tld.trim() ? "tld-field" : "tld-field invalid"}>
                <span>.</span>
                <input value={tld} onChange={(event) => setTld(event.target.value)} placeholder="test" />
              </div>
            </label>
            <label>
              <span>Global PHP</span>
              <select value={phpChoice} onChange={(event) => setPhpChoice(event.target.value)}>
                {summary.runtimes.php.map((runtime) => (
                  <option key={runtime.version} value={runtime.version}>
                    PHP {runtime.version}
                  </option>
                ))}
              </select>
            </label>
            <div className="settings-database-choice">
              <span>Database</span>
              <DatabaseRuntimePicker runtimes={summary.runtimes.mysql} value={databaseChoice} onChange={setDatabaseChoice} />
            </div>
          </div>
          <div className="settings-actions">
            <button className="primary" disabled={busy || !tldValid || !tldChanged} onClick={() => void saveGeneralSettings()} title="Save local TLD">
              <Save size={16} />
              <span>Save TLD</span>
            </button>
            <button disabled={busy || phpChoice === summary.config.globalPhpVersion} onClick={() => void post("/api/php/use", { version: phpChoice })} title="Use selected PHP">
              <BadgeCheck size={16} />
              <span>Use PHP</span>
            </button>
            <button
              disabled={busy || !selectedDatabase?.installed || databaseChoice === summary.config.mysql.version || databaseRunning}
              onClick={() => void post("/api/mysql/version", { version: databaseChoice })}
              title={!selectedDatabase?.installed ? "Install the selected database first" : databaseRunning ? "Stop the database before switching runtime" : `Use ${databaseRuntimeDisplay(selectedDatabase)}`}
            >
              <Database size={16} />
              <span>Use DB</span>
            </button>
          </div>
          {!tldValid && tld.trim() ? <span className="settings-warning">Use letters, numbers, or hyphens only.</span> : null}
        </section>

        <section className="settings-panel">
          <SettingsPanelHeader icon={ListRestart} title="Startup" detail={`${runningServicesCount}/4 services running`} />
          <div className="startup-toggle-list">
            <label className={!startupSupported ? "startup-toggle disabled" : "startup-toggle"}>
              <input
                type="checkbox"
                checked={launchOnLogin}
                disabled={startupWorking || !startupSupported}
                onChange={(event) => void saveStartupSetting({ launchAppOnLogin: event.target.checked })}
              />
              <span>
                <strong>Open with Windows</strong>
                <small>Start minimized in the tray</small>
              </span>
            </label>
            <label className="startup-toggle">
              <input
                type="checkbox"
                checked={startServicesOnLaunch}
                disabled={startupWorking}
                onChange={(event) => void saveStartupSetting({ startServicesOnLaunch: event.target.checked })}
              />
              <span>
                <strong>Start services on launch</strong>
                <small>Nginx, PHP, database, and Redis</small>
              </span>
            </label>
          </div>
          {startupStatus?.message ? <span className="settings-warning startup-message">{startupStatus.message}</span> : null}
        </section>
          </>
        ) : null}

        {settingsPane === "tools" ? (
          <>
        <section className="settings-panel wide-settings-panel">
          <SettingsPanelHeader icon={PackageCheck} title="Laravel Installer" detail="composer global require laravel/installer" />
          <div className="installer-tool-card">
            <PackageCheck size={18} />
            <div>
              <strong>{installerDetail.title}</strong>
              <span>{installerDetail.subtitle}</span>
            </div>
            <Badge label={installerBadge.label} tone={installerBadge.tone} />
          </div>
          <div className="settings-actions">
            <button
              className={!installerStatus?.installed || installerStatus.updateAvailable ? "primary" : ""}
              disabled={installerWorking || !installerStatus || (installerStatus.installed && !installerStatus.updateAvailable)}
              onClick={() => void installLaravelInstaller()}
              title={installerStatus?.installed ? "Update Laravel Installer" : "Install Laravel Installer"}
            >
              {installerStatus?.installed ? <RotateCw size={16} /> : <Download size={16} />}
              <span>{installerActionLabel}</span>
            </button>
            <button disabled={installerWorking} onClick={() => void loadLaravelInstallerStatus()} title="Refresh Laravel Installer status">
              <RotateCw size={16} />
              <span>Refresh</span>
            </button>
            <button className="danger-log-button" disabled={installerWorking || !installerStatus?.installed} onClick={() => void removeLaravelInstaller()} title="Remove Laravel Installer">
              <Trash2 size={16} />
              <span>Remove</span>
            </button>
          </div>
          <dl className="details compact-details installer-details">
            <dt>Version</dt>
            <dd>{installerStatus?.version ?? "Not installed"}</dd>
            <dt>Latest</dt>
            <dd>{installerStatus?.latestVersion ?? "Unknown"}</dd>
            <dt>Composer Home</dt>
            <dd>{installerStatus?.composerHome ?? "Checking..."}</dd>
            <dt>Binary</dt>
            <dd>{installerStatus?.binary ?? "Not installed"}</dd>
          </dl>
          {installerStatus?.message ? <span className="settings-warning">{installerStatus.message}</span> : null}
        </section>
          </>
        ) : null}

        {settingsPane === "paths" ? (
          <>
        <section className="settings-panel wide-settings-panel">
          <SettingsPanelHeader icon={FolderOpen} title="Paths Overview" detail="Fast access to the folders used most often" />
          <div className="settings-quick-grid">
            <SettingsQuickTile
              icon={FolderPlus}
              label="Parked folders"
              value={`${summary.config.parkedFolders.length} folders`}
              detail={summary.config.parkedFolders[0] ? pathTail(summary.config.parkedFolders[0]) : "Add a sites folder"}
            />
            <SettingsQuickTile icon={FileText} label="Config" value={pathTail(summary.paths.configFile) || "Config file"} detail={summary.paths.configFile} />
            <SettingsQuickTile icon={HardDrive} label="Runtime data" value={pathTail(summary.paths.home) || "App data"} detail={summary.paths.home} />
            <SettingsQuickTile icon={ShieldCheck} label="Certificate" value={summary.ssl.trusted ? "Trusted" : "Needs trust"} detail={summary.ssl.certPath} tone={summary.ssl.trusted ? "green" : "amber"} />
          </div>
        </section>
        <section className="settings-panel">
          <SettingsPanelHeader icon={FolderPlus} title="Sites Folders" detail={`${summary.sites.length} discovered sites`} />
          <div className="inline-form compact-folder-form">
            <div className="path-picker">
              <input value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="C:\www" />
              <button type="button" className="field-icon-button" disabled={busy} onClick={() => void browseFolder()} title="Browse folder">
                <FolderOpen size={16} />
              </button>
            </div>
            <button className="primary" disabled={busy || !folder.trim()} onClick={() => void post("/api/sites/park", { path: folder, primary: true })} title="Park folder">
              <FolderPlus size={16} />
              <span>Park</span>
            </button>
          </div>
          <div className="settings-path-list">
            {summary.config.parkedFolders.length ? (
              summary.config.parkedFolders.map((parkedFolder) => (
                <SettingsPathRow
                  key={parkedFolder}
                  icon={FolderOpen}
                  label={pathTail(parkedFolder) || "Sites"}
                  value={parkedFolder}
                  copied={copiedPath === parkedFolder}
                  onCopy={() => void copyPath(parkedFolder)}
                  onOpen={() => void post("/api/open-path", { path: parkedFolder })}
                />
              ))
            ) : (
              <div className="settings-empty-row">No parked folders yet.</div>
            )}
          </div>
        </section>
          </>
        ) : null}

        {settingsPane === "security" ? (
          <>
        <section className="settings-panel">
          <SettingsPanelHeader icon={Shield} title="Hosts & SSL" detail={summary.ssl.store ?? summary.ssl.message ?? summary.paths.hostsFile} />
          <div className="settings-quick-grid security-status-grid">
            <SettingsQuickTile
              icon={Network}
              label="Hosts"
              value={`${summary.sites.length} domains`}
              detail={hostsPreview ? "Preview loaded" : "Ready to sync"}
              tone={hostsPreview ? "green" : "default"}
            />
            <SettingsQuickTile
              icon={ShieldCheck}
              label="Local CA"
              value={summary.ssl.trusted ? "Trusted" : "Untrusted"}
              detail={summary.ssl.store ?? summary.ssl.message ?? "Windows certificate store"}
              tone={summary.ssl.trusted ? "green" : "amber"}
            />
            <SettingsQuickTile
              icon={HardDrive}
              label="Defender"
              value={summary.config.parkedFolders[0] ? "Recommended" : "Needs folder"}
              detail={summary.config.parkedFolders[0] ? pathTail(summary.config.parkedFolders[0]) : "Park a sites folder first"}
              tone={summary.config.parkedFolders[0] ? "amber" : "default"}
            />
          </div>
          <div className="settings-action-grid">
            <div className="settings-action-tile">
              <Network size={18} />
              <div>
                <strong>Hosts</strong>
                <span>{summary.sites.length} local domains</span>
              </div>
              <button disabled={busy} onClick={() => void previewHosts()} title="Preview hosts entries">
                <FileText size={16} />
              </button>
              <button className="primary" disabled={busy} onClick={() => void post("/api/hosts/sync", {})} title="Sync hosts file">
                <RotateCw size={16} />
              </button>
            </div>
            <div className="settings-action-tile">
              <ShieldCheck size={18} />
              <div>
                <strong>Local CA</strong>
                <span>{summary.ssl.trusted ? summary.ssl.store ?? "Trusted" : summary.ssl.message ?? "Untrusted"}</span>
              </div>
              <button disabled={busy} onClick={() => void post("/api/open-path", { path: summary.ssl.certPath, reveal: true })} title="Show certificate">
                <FolderOpen size={16} />
              </button>
              <button className={!summary.ssl.trusted ? "primary" : ""} disabled={busy || summary.ssl.trusted || summary.ssl.platform !== "win32"} onClick={() => void trustCa()} title="Trust CA">
                <Lock size={16} />
              </button>
            </div>
          </div>
          {hostsPreview ? <pre className="settings-hosts-preview">{hostsPreview}</pre> : null}
        </section>
          </>
        ) : null}

        {settingsPane === "tools" ? (
          <>
        <section className="settings-panel wide-settings-panel">
          <SettingsPanelHeader icon={FileText} title="Config Files" detail="Edit generated runtime ini files" />
          <div className="ini-edit-grid">
            <div className="ini-edit-card">
              <SquareTerminal size={18} />
              <div>
                <strong>php.ini</strong>
                <span>{summary.paths.phpIni}</span>
              </div>
              <button className="primary" disabled={busy} onClick={() => void post("/api/php/ini/open", { version: summary.config.globalPhpVersion })} title="Edit php.ini">
                <FileText size={16} />
                <span>Edit</span>
              </button>
              <button disabled={busy} onClick={() => void post("/api/php/ini/open", { version: summary.config.globalPhpVersion, reveal: true })} title="Show php.ini">
                <FolderOpen size={16} />
                <span>Reveal</span>
              </button>
            </div>
            <div className="ini-edit-card">
              <Database size={18} />
              <div>
                <strong>my.ini</strong>
                <span>{summary.paths.mysqlConfig}</span>
              </div>
              <button className="primary" disabled={busy} onClick={() => void post("/api/mysql/ini", {})} title="Edit my.ini">
                <FileText size={16} />
                <span>Edit</span>
              </button>
              <button disabled={busy} onClick={() => void post("/api/mysql/ini", { reveal: true })} title="Show my.ini">
                <FolderOpen size={16} />
                <span>Reveal</span>
              </button>
            </div>
          </div>
        </section>
          </>
        ) : null}

        {settingsPane === "paths" ? (
          <>
        <section className="settings-panel">
          <SettingsPanelHeader icon={HardDrive} title="Files" detail="Open or copy app paths" />
          <div className="settings-path-groups">
            {pathGroups.map((group) => (
              <div className="settings-path-group" key={group.group}>
                <div className="settings-path-group-header">
                  <strong>{group.group}</strong>
                  <span>{group.rows.length} paths</span>
                </div>
                <div className="settings-path-list dense">
                  {group.rows.map((item) => (
                    <SettingsPathRow
                      key={item.label}
                      icon={item.icon}
                      label={item.label}
                      value={item.value}
                      copied={copiedPath === item.value}
                      onCopy={() => void copyPath(item.value)}
                      onOpen={() => void post("/api/open-path", { path: item.value, reveal: item.reveal === true })}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
          </>
        ) : null}

        {settingsPane === "security" ? (
          <>
        <section className="settings-panel wide-settings-panel">
          <SettingsPanelHeader icon={Shield} title="Windows Defender" detail="Add exclusions to avoid scanning app data" />
          <div className="settings-action-grid">
            <DefenderExclusionTile
              label="Sites folder"
              path={summary.config.parkedFolders[0] ?? ""}
              copied={copiedPath === (summary.config.parkedFolders[0] ?? "")}
              onCopy={() => {
                if (summary.config.parkedFolders[0]) {
                  void copyPath(summary.config.parkedFolders[0]);
                }
              }}
              onAdd={async () => {
                const payload = (await request("/api/defender/exclude", { path: summary.config.parkedFolders[0] })) as { ok?: boolean; excluded?: boolean };
                if (payload.ok) {
                  showToast("Sites folder excluded from Windows Defender.", "success");
                } else {
                  showToast("Could not exclude sites folder.", "error");
                }
              }}
            />
            <DefenderExclusionTile
              label="App data"
              path={summary.paths.home}
              copied={copiedPath === summary.paths.home}
              onCopy={() => void copyPath(summary.paths.home)}
              onAdd={async () => {
                const payload = (await request("/api/defender/exclude", { path: summary.paths.home })) as { ok?: boolean; excluded?: boolean };
                if (payload.ok) {
                  showToast("App data excluded from Windows Defender.", "success");
                } else {
                  showToast("Could not exclude app data.", "error");
                }
              }}
            />
          </div>
        </section>
          </>
        ) : null}
      </div>
    </div>
  );
}

function SettingsQuickTile({
  icon: Icon,
  label,
  value,
  detail,
  tone = "default"
}: {
  icon: typeof Globe;
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "green" | "amber";
}) {
  return (
    <div className={`settings-quick-tile ${tone}`}>
      <Icon size={18} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function DefenderExclusionTile({
  label,
  path,
  copied,
  onCopy,
  onAdd
}: {
  label: string;
  path: string;
  copied: boolean;
  onCopy: () => void;
  onAdd: () => void;
}) {
  return (
    <div className="settings-action-tile">
      <Shield size={18} />
      <div>
        <strong>{label}</strong>
        <span>{path}</span>
      </div>
      <button onClick={onCopy} disabled={!path} title={copied ? "Copied" : "Copy path"}>
        {copied ? <CheckCircle2 size={16} /> : <Clipboard size={16} />}
      </button>
      <button onClick={() => void onAdd()} disabled={!path}>
        <ShieldCheck size={16} />
      </button>
    </div>
  );
}

function SettingsStat({
  icon: Icon,
  label,
  value,
  tone = "default"
}: {
  icon: typeof Globe;
  label: string;
  value: string;
  tone?: "default" | "green" | "amber";
}) {
  return (
    <div className={`settings-stat ${tone}`}>
      <Icon size={18} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function laravelInstallerBadge(status: LaravelInstallerStatus | null): { label: string; tone: "green" | "amber" | "red" } {
  if (!status) {
    return { label: "checking", tone: "amber" };
  }
  if (!status.installed) {
    return { label: "missing", tone: "red" };
  }
  if (status.updateAvailable) {
    return { label: "update", tone: "amber" };
  }
  return { label: "installed", tone: "green" };
}

function laravelInstallerDetail(status: LaravelInstallerStatus | null): { title: string; subtitle: string } {
  if (!status) {
    return { title: "Checking Laravel Installer", subtitle: "Reading Composer global status" };
  }
  if (!status.phpInstalled) {
    return { title: "PHP runtime will be installed", subtitle: "Needed before Composer can run the installer" };
  }
  if (!status.composerInstalled) {
    return { title: "Composer will be installed", subtitle: "Install uses composer global require laravel/installer" };
  }
  if (!status.installed) {
    return { title: "Laravel Installer is not installed", subtitle: "Install uses composer global require laravel/installer" };
  }
  if (status.updateAvailable) {
    return { title: `Update available ${status.latestVersion ?? ""}`.trim(), subtitle: `Installed ${status.version ?? "unknown"}` };
  }
  return { title: `Installed ${status.version ?? "ready"}`, subtitle: status.binary ?? status.binDir };
}

function SettingsPanelHeader({ icon: Icon, title, detail }: { icon: typeof Globe; title: string; detail: string }) {
  return (
    <div className="settings-panel-header">
      <Icon size={18} />
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
    </div>
  );
}

function SettingsPathRow({
  icon: Icon,
  label,
  value,
  copied,
  onCopy,
  onOpen
}: {
  icon: typeof Globe;
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="settings-path-row">
      <Icon size={16} />
      <div>
        <strong>{label}</strong>
        <span>{value}</span>
      </div>
      <button onClick={onCopy} title={copied ? "Copied" : "Copy path"}>
        {copied ? <CheckCircle2 size={16} /> : <Clipboard size={16} />}
      </button>
      <button onClick={onOpen} title="Open path">
        <FolderOpen size={16} />
      </button>
    </div>
  );
}

function normalizeLocalTld(value: string): string {
  return value.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

function isValidLocalTld(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value);
}

function phpFastCgiEndpoint(version: string): string {
  const digits = version.replace(/\D/g, "");
  const suffix = Number.parseInt(digits || "84", 10);
  return `127.0.0.1:${9000 + suffix}`;
}

function ServiceStrip({ service }: { service: ServiceStatus }) {
  return (
    <div className="service-strip">
      <Badge label={service.state} tone={service.state === "running" ? "green" : service.state === "stopped" ? "red" : "amber"} />
      <strong>{service.name}</strong>
      {service.port ? <span>127.0.0.1:{service.port}</span> : null}
      {service.message ? <span className="muted">{service.message}</span> : null}
    </div>
  );
}

function Badge({ label, tone }: { label: string; tone: "green" | "amber" | "red" }) {
  return <span className={`badge ${tone}`}>{label}</span>;
}

function RuntimeProgress({ job }: { job: RuntimeInstallJob }) {
  const percent = Math.round(job.percent);
  const transfer = formatTransfer(job);
  const eta = isActiveRuntimeJob(job) && typeof job.etaSeconds === "number" && Number.isFinite(job.etaSeconds) ? `${formatDuration(job.etaSeconds)} remaining` : "";
  const details = [job.message, `${percent}%`, transfer, eta].filter(Boolean).join(" · ");

  return (
    <div className={`runtime-progress ${job.status === "failed" ? "failed" : ""}`}>
      <div className="runtime-progress-meta">
        <strong>{statusLabel(job.status)}</strong>
        <span>{details}</span>
      </div>
      <div className="progress-track" aria-label={`${job.name} ${job.version} install progress`}>
        <div className="progress-fill" style={{ width: `${Math.max(job.percent, isActiveRuntimeJob(job) ? 4 : 0)}%` }} />
      </div>
    </div>
  );
}

function latestRuntimeJob(jobs: RuntimeInstallJob[], kind: RuntimeKind, version: string): RuntimeInstallJob | undefined {
  return jobs
    .filter((job) => job.kind === kind && job.version === version)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}

function runtimeActionLabel(item: RuntimeInstallStatus, job?: RuntimeInstallJob, fallback = "Install"): string {
  if (item.installed) {
    if (item.updateAvailable) {
      return "Update";
    }
    return "Ready";
  }

  if (job && isActiveRuntimeJob(job)) {
    return statusLabel(job.status);
  }

  if (job?.status === "failed") {
    return "Retry";
  }

  return fallback;
}

function runtimeDisplayVersion(item: RuntimeInstallStatus): string {
  if (item.name === "MySQL" || item.name === "MariaDB") {
    return databaseRuntimeDisplay(item);
  }
  if (item.name === "Composer" && item.installedPackageVersion) {
    return item.installedPackageVersion;
  }
  return item.version;
}

function statusLabel(status: RuntimeInstallJob["status"]): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "downloading":
      return "Downloading";
    case "extracting":
      return "Extracting";
    case "installing":
      return "Installing";
    case "complete":
      return "Complete";
    case "failed":
      return "Failed";
  }
}

function isActiveRuntimeJob(job: RuntimeInstallJob): boolean {
  return job.status !== "complete" && job.status !== "failed";
}

async function getJsonWithTimeout<T>(path: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await getJson<T>(path, { signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

function formatTransfer(job: RuntimeInstallJob): string {
  if (typeof job.bytesDownloaded !== "number") {
    return "";
  }

  if (typeof job.totalBytes === "number") {
    return `${formatBytes(job.bytesDownloaded)} of ${formatBytes(job.totalBytes)}`;
  }

  return formatBytes(job.bytesDownloaded);
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function formatDuration(seconds: number): string {
  const rounded = Math.max(1, Math.ceil(seconds));
  if (rounded < 60) {
    return `${rounded}s`;
  }

  const minutes = Math.ceil(rounded / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

interface ViewProps {
  summary: DashboardSummary;
  post: (path: string, body?: Record<string, unknown>) => Promise<void>;
  busy: boolean;
  language: AppLanguage;
}
