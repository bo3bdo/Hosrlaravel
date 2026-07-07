import { CircleStop, ExternalLink, FileText, Globe, Lock, LockOpen, Play, Server } from "lucide-react";
import { HealthCheckPanel } from "../components/HealthCheckPanel.js";
import { openExternalUrl } from "../apiClient.js";
import { makeT } from "../i18n.js";
import { SettingsPanelHeader } from "../shared/components.js";
import type { RuntimeInstallStatus, Section } from "../shared/types.js";
import type { ViewProps } from "../shared/types.js";
import { databaseEngineName, selectedMysqlRuntime } from "../shared/utils.js";

export function DashboardPage({
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
  const t = makeT(language);
  const recentSitesDetail = summary.sites.length
    ? t("dashboard.recentSitesDetail").replace("{count}", String(summary.sites.length))
    : t("dashboard.recentSitesDetailEmpty");
  const servicesDetail = t("dashboard.servicesDetail").replace("{running}", String(runningServices));
  const recentWarningsDetail = warningGroups.length
    ? t("dashboard.recentWarningsDetail")
        .replace("{groups}", String(warningGroups.length))
        .replace("{lines}", String(warningLines))
    : t("dashboard.recentWarningsDetailEmpty");

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
          <strong>{stackReady ? t("dashboard.ready") : t("dashboard.needsWork")}</strong>
          <span>
            {runningServices}/4 {t("state.servicesRunning")} · PHP {summary.config.globalPhpVersion} · {summary.sites.length}{" "}
            {t("state.sitesCount")}
          </span>
        </div>
        <div className="dash-status-actions">
          <button className="primary" disabled={busy || runningServices === 4 || !canStartInstalledStack} onClick={() => void startInstalledStack()}>
            <Play size={16} />
            <span>{t("services.startAll")}</span>
          </button>
          <button disabled={busy || runningServices === 0} onClick={() => void stopRunningStack()}>
            <CircleStop size={16} />
            <span>{t("services.stopAll")}</span>
          </button>
        </div>
      </section>

      <div className="dash-grid">
        <section className="settings-panel dash-card">
          <SettingsPanelHeader icon={Server} title={t("dashboard.servicesTitle")} detail={servicesDetail} />
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
          <SettingsPanelHeader icon={Globe} title={t("dashboard.quickAccess")} detail={recentSitesDetail} />
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
            {!summary.sites.length ? <div className="settings-empty-row">{t("dashboard.noSites")}</div> : null}
          </div>
          <div className="settings-actions">
            <button onClick={() => onNavigate("sites")}>
              <Globe size={15} />
              <span>{t("dashboard.openSitesButton")}</span>
            </button>
          </div>
        </section>
      </div>

      {warningGroups.length ? (
        <section className="settings-panel dash-card">
          <SettingsPanelHeader icon={FileText} title={t("dashboard.recentWarnings")} detail={recentWarningsDetail} />
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
              <span>{t("dashboard.openLogsButton")}</span>
            </button>
          </div>
        </section>
      ) : null}

      <HealthCheckPanel summary={summary} post={post} busy={busy} />
    </div>
  );
}
