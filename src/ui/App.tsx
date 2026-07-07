import { useCallback, useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { openExternalUrl } from "./apiClient.js";
import { BootScreen } from "./components/BootScreen.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { ToastContainer } from "./components/ToastContainer.js";
import { useToasts } from "./components/useToasts.js";
import { FirstRunWizard } from "./features/wizard/FirstRunWizard.js";
import { useAppActions } from "./hooks/useAppActions.js";
import { useRuntimeJobs } from "./hooks/useRuntimeJobs.js";
import { useSummary } from "./hooks/useSummary.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { LogsPage } from "./pages/LogsPage.js";
import { ServicesPage } from "./pages/ServicesPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { SitesPage } from "./pages/SitesPage.js";
import { ToolsPage } from "./pages/ToolsPage.js";
import { appVersionLabel, bundledAppVersion, sectionLabel, sections } from "./shared/constants.js";
import { t } from "./i18n.js";
import { DesktopConfirmContext } from "./shared/context.js";
import { serviceBadgeForSection } from "./shared/components.js";
import type { AppLanguage, DesktopConfirmOptions } from "./types.js";
import type { Section } from "./shared/types.js";
import { needsFirstRunSetup } from "./shared/utils.js";

const sectionRoutes: Record<Section, string> = {
  dashboard: "/",
  sites: "/sites",
  services: "/services",
  tools: "/tools",
  logs: "/logs",
  settings: "/settings"
};

function sectionFromPath(pathname: string): Section {
  const entry = Object.entries(sectionRoutes).find(([, route]) => route === pathname);
  return (entry?.[0] as Section | undefined) ?? "dashboard";
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const section = sectionFromPath(location.pathname);
  const [language, setLanguage] = useState<AppLanguage>("en");
  const [confirmDialog, setConfirmDialog] = useState<DesktopConfirmOptions | null>(null);
  const pendingConfirm = useRef<((confirmed: boolean) => void) | null>(null);
  const { toasts, addToast, removeToast, pauseToast, resumeToast } = useToasts();
  const { data: summary, error: summaryError, isLoading, refetch } = useSummary();
  const { installJobs, trackJob } = useRuntimeJobs();
  const {
    busy,
    error: actionError,
    updateStatus,
    refresh,
    request,
    post,
    startRuntimeInstall,
    checkForUpdates
  } = useAppActions(addToast);

  const confirmAction = useCallback((options: DesktopConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
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

  const navigateSection = useCallback(
    (next: Section) => {
      navigate(sectionRoutes[next]);
    },
    [navigate]
  );

  const wrappedStartRuntimeInstall = useCallback(
    async (...args: Parameters<typeof startRuntimeInstall>) => {
      const job = await startRuntimeInstall(...args);
      if (job) {
        trackJob(job);
      }
      return job;
    },
    [startRuntimeInstall, trackJob]
  );

  useEffect(() => {
    void checkForUpdates();
  }, [checkForUpdates]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey && (event.key === "r" || event.key === "R")) {
        event.preventDefault();
        void refetch();
        return;
      }
      if (event.key === "F5") {
        event.preventDefault();
        void refetch();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [refetch]);

  const error =
    actionError ??
    (summaryError instanceof Error ? `Helper API offline or unavailable: ${summaryError.message}` : summaryError ? String(summaryError) : null);

  if (isLoading && !summary) {
    return <BootScreen error={error} busy={busy} refresh={async () => void refetch()} />;
  }

  if (!summary) {
    return <BootScreen error={error} busy={busy} refresh={async () => void refetch()} />;
  }

  if (needsFirstRunSetup(summary)) {
    return (
      <FirstRunWizard
        summary={summary}
        installJobs={installJobs}
        startRuntimeInstall={wrappedStartRuntimeInstall}
        request={request}
        refresh={refresh}
        busy={busy}
        error={error}
        language={language}
        onFinish={() => {
          navigateSection("dashboard");
          void refresh();
        }}
      />
    );
  }

  const active = sections.find((item) => item.id === section)!;
  const activeLabel = sectionLabel(active, language);
  const runningServicesCount = [summary.services.php, summary.services.nginx, summary.services.mysql, summary.services.redis].filter(
    (service) => service.state === "running"
  ).length;
  const stackTone = runningServicesCount === 4 ? "green" : runningServicesCount > 0 ? "amber" : "red";
  const appUpdate = updateStatus?.application;
  const hasAppUpdate = Boolean(appUpdate?.updateAvailable);
  const displayedAppVersion = appVersionLabel(bundledAppVersion);

  function openAppUpdate() {
    const target = appUpdate?.asset?.downloadUrl || appUpdate?.releaseUrl;
    if (target) {
      void openExternalUrl(target);
    } else {
      navigateSection("tools");
    }
  }

  const viewProps = { summary, post, busy, language };

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
              const badge = serviceBadgeForSection(item.id, summary);
              const isActive = section === item.id;
              return (
                <button
                  key={item.id}
                  className={isActive ? "active" : ""}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => navigateSection(item.id)}
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
                {runningServicesCount}/4 {t("state.servicesRunning", language)}
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
                <button className="update-pill available" onClick={openAppUpdate} title="Download the latest Laraboxs release">
                  <Download size={16} />
                  <span>{`Update ${appUpdate.latestVersion}`}</span>
                </button>
              ) : null}
            </div>
          </header>

          {error ? <div className="notice app-notice">{error}</div> : null}

          <section className="content">
            <div key={section} className="page-view">
              <Routes>
                <Route path="/" element={<DashboardPage {...viewProps} onNavigate={navigateSection} />} />
                <Route path="/sites" element={<SitesPage {...viewProps} request={request} onNavigate={navigateSection} />} />
                <Route
                  path="/services"
                  element={
                    <ServicesPage
                      {...viewProps}
                      request={request}
                      installJobs={installJobs}
                      startRuntimeInstall={wrappedStartRuntimeInstall}
                    />
                  }
                />
                <Route
                  path="/tools"
                  element={<ToolsPage {...viewProps} request={request} startRuntimeInstall={wrappedStartRuntimeInstall} updateStatus={updateStatus} />}
                />
                <Route path="/logs" element={<LogsPage {...viewProps} />} />
                <Route path="/settings" element={<SettingsPage {...viewProps} request={request} onLanguageChange={setLanguage} />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </section>

          <footer className="status-bar">
            <div className="status-bar-group">
              <span className={`status-dot ${stackTone}`} />
              <span>
                {runningServicesCount}/4 {t("state.servicesRunning", language)}
              </span>
              <span className="status-bar-sep" aria-hidden="true" />
              <span>
                {summary.sites.length} {t("state.sitesCount", language)}
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
