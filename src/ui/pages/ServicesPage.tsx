import { useEffect, useState } from "react";
import {
  BadgeCheck,
  CircleStop,
  Database,
  Download,
  ExternalLink,
  FileText,
  KeyRound,
  ListRestart,
  Play,
  RotateCw,
  Server,
  Settings,
  SquareTerminal
} from "lucide-react";
import { getJson, openExternalUrl } from "../apiClient.js";
import { useDesktopConfirm } from "../shared/context.js";
import { makeT } from "../i18n.js";
import {
  Badge,
  DatabaseRuntimePicker,
  RuntimePicker,
  RuntimeProgress,
  ServiceHeader,
  ServiceNavButton,
  ServiceStrip
} from "../shared/components.js";
import type {
  PhpConfig,
  PhpExtensionStatus,
  PhpSettingsStatus,
  RuntimeInstallJob,
  RuntimeKind
} from "../shared/types.js";
import type { RuntimeJobMap, ServicesPane, ViewProps } from "../shared/types.js";
import {
  databaseEngineName,
  databaseRuntimeDisplay,
  isActiveRuntimeJob,
  latestRuntimeJob,
  phpFastCgiEndpoint,
  runtimeActionLabel,
  selectedMysqlRuntime
} from "../shared/utils.js";

export function ServicesPage({
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
  const t = makeT(language);

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
            <strong>{t("services.title")}</strong>
            <span>{runningServices === 4 ? t("services.allCoreRunning") : t("services.runningCount").replace("{count}", String(runningServices))}</span>
          </div>
        </div>
        <div className="services-command-actions">
          <button className="primary" disabled={busy || runningServices === 4 || !canStartInstalledStack} onClick={() => void startInstalledStack()} title="Start installed stack services">
            <Play size={16} />
            <span>{t("services.startAll")}</span>
          </button>
          <button disabled={busy || runningServices === 0} onClick={() => void restartRunningStack()} title="Restart currently running services">
            <RotateCw size={16} />
            <span>{t("services.restartAll")}</span>
          </button>
          <button disabled={busy || runningServices === 0} onClick={() => void stopRunningStack()} title="Stop running stack services">
            <CircleStop size={16} />
            <span>{t("services.stopAll")}</span>
          </button>
        </div>
      </section>

      <div className="services-workbench">
        <aside className="services-list" aria-label="Service list">
          <div className="service-group-label">{t("services.webServer")}</div>
          <ServiceNavButton icon={Server} label="Nginx" detail={`Port ${summary.config.nginx.httpPort}`} service={summary.services.nginx} active={servicesPane === "nginx"} onClick={() => setServicesPane("nginx")} onStart={() => void post("/api/nginx/start")} onStop={() => void post("/api/nginx/stop")} busy={busy} language={language} />
          <ServiceNavButton icon={SquareTerminal} label="PHP" detail={summary.config.globalPhpVersion} service={summary.services.php} active={servicesPane === "php"} onClick={() => setServicesPane("php")} onStart={() => void post("/api/php-fcgi/start")} onStop={() => void post("/api/php-fcgi/stop")} busy={busy} language={language} />

          <div className="service-group-label">{t("services.databaseGroup")}</div>
          <ServiceNavButton icon={Database} label={activeDatabaseName} detail={`Port ${summary.config.mysql.port}`} service={summary.services.mysql} active={servicesPane === "mysql"} onClick={() => setServicesPane("mysql")} onStart={() => void post("/api/mysql/start")} onStop={() => void post("/api/mysql/stop")} busy={busy} language={language} />
          <ServiceNavButton
            icon={Database}
            label="phpMyAdmin"
            detail={summary.phpMyAdmin.installed ? t("common.installed") : t("common.missing")}
            service={{
              name: "phpMyAdmin",
              state: summary.phpMyAdmin.installed ? "running" : "stopped",
              version: summary.phpMyAdmin.version
            }}
            active={servicesPane === "phpmyadmin"}
            onClick={() => setServicesPane("phpmyadmin")}
          />

          <div className="service-group-label">{t("services.cacheQueue")}</div>
          <ServiceNavButton icon={Database} label="Redis" detail={`Port ${summary.config.redis.port}`} service={summary.services.redis} active={servicesPane === "redis"} onClick={() => setServicesPane("redis")} onStart={() => void post("/api/redis/start")} onStop={() => void post("/api/redis/stop")} busy={busy} language={language} />

          <button className={servicesPane === "all" ? "service-nav-all active" : "service-nav-all"} onClick={() => setServicesPane("all")} title={`${t("common.allServices")} - ${t("common.fullStackView")}`}>
            <ListRestart size={16} />
            <span>{t("common.allServices")}</span>
            {(() => {
              const running = [summary.services.php, summary.services.nginx, summary.services.mysql, summary.services.redis].filter((service) => service.state === "running").length;
              const tone = running === 4 ? "green" : running > 0 ? "amber" : "red";
              return <span className={`status-dot ${tone}`} title={t("services.runningCount").replace("{count}", String(running))} />;
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
            <button className="primary" title={t("services.useSelectedPhp")} disabled={busy || !phpRuntime?.installed || phpVersion === summary.config.globalPhpVersion} onClick={() => void post("/api/php/use", { version: phpVersion })}>
              <BadgeCheck size={18} />
              <span>{t("common.use")}</span>
            </button>
            <button title={t("services.startPhp")} disabled={busy || summary.services.php.state === "running"} onClick={() => void post("/api/php-fcgi/start")}>
              <Play size={18} />
              <span>{t("common.start")}</span>
            </button>
            <button title={t("services.stopPhp")} disabled={busy} onClick={() => void post("/api/php-fcgi/stop")}>
              <CircleStop size={18} />
              <span>{t("common.stop")}</span>
            </button>
            <button title={t("services.restartPhp")} disabled={busy} onClick={() => void post("/api/php-fcgi/restart")}>
              <RotateCw size={18} />
              <span>{t("services.restartShort")}</span>
            </button>
          </div>
        </div>
        ) : null}

        {showPhp ? (
        <div className="service-panel wide-service-panel php-settings-service-panel">
          <ServiceHeader icon={Settings} title={t("services.phpSettings")} service={summary.services.php} detail={phpIniPath || `PHP ${phpVersion}`} />
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
            <button className="primary" title={t("services.savePhpSettings")} disabled={busy || phpSettingsSaving || phpSettingsLoading} onClick={() => void savePhpSettings()}>
              <BadgeCheck size={18} />
              <span>{t("common.save")}</span>
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
              <span className="muted">{phpSettingsLoading ? t("services.loadingExtensions") : t("services.noExtensions")}</span>
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
            <button title={t("services.startNginx")} disabled={busy || summary.services.nginx.state === "running"} onClick={() => void post("/api/nginx/start")}>
              <Play size={18} />
              <span>{t("common.start")}</span>
            </button>
            <button title={t("services.stopNginx")} disabled={busy} onClick={() => void post("/api/nginx/stop")}>
              <CircleStop size={18} />
              <span>{t("common.stop")}</span>
            </button>
            <button title={t("services.restartNginx")} disabled={busy} onClick={() => void post("/api/nginx/restart")}>
              <RotateCw size={18} />
              <span>{t("services.restartShort")}</span>
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
            <button className="primary" title={t("services.useSelectedRuntime").replace("{name}", selectedDatabaseName)} disabled={busy || !mysqlRuntime?.installed || mysqlVersion === summary.config.mysql.version} onClick={() => void useMysqlVersion()}>
              <BadgeCheck size={18} />
              <span>{t("common.use")}</span>
            </button>
            <button title={t("services.initializeRuntime").replace("{name}", activeDatabaseName)} disabled={busy} onClick={() => void post("/api/mysql/init")}>
              <BadgeCheck size={18} />
              <span>{t("services.initialize")}</span>
            </button>
            <button title={t("services.startRuntime").replace("{name}", activeDatabaseName)} disabled={busy || summary.services.mysql.state === "running"} onClick={() => void post("/api/mysql/start")}>
              <Play size={18} />
              <span>{t("common.start")}</span>
            </button>
            <button title={t("services.stopRuntime").replace("{name}", activeDatabaseName)} disabled={busy} onClick={() => void post("/api/mysql/stop")}>
              <CircleStop size={18} />
              <span>{t("common.stop")}</span>
            </button>
            <button title={t("services.restartRuntime").replace("{name}", activeDatabaseName)} disabled={busy} onClick={() => void post("/api/mysql/restart")}>
              <RotateCw size={18} />
              <span>{t("services.restartShort")}</span>
            </button>
            <button title={t("services.openShell").replace("{name}", activeDatabaseName)} disabled={busy} onClick={() => void post("/api/mysql/shell")}>
              <SquareTerminal size={18} />
              <span>{t("services.shell")}</span>
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
            <button title={t("services.startRedis")} disabled={busy || summary.services.redis.state === "running"} onClick={() => void post("/api/redis/start")}>
              <Play size={18} />
              <span>{t("common.start")}</span>
            </button>
            <button title={t("services.stopRedis")} disabled={busy} onClick={() => void post("/api/redis/stop")}>
              <CircleStop size={18} />
              <span>{t("common.stop")}</span>
            </button>
            <button title={t("services.restartRedis")} disabled={busy} onClick={() => void post("/api/redis/restart")}>
              <RotateCw size={18} />
              <span>{t("services.restartShort")}</span>
            </button>
            <button title={t("services.openShell").replace("{name}", "Redis")} disabled={busy} onClick={() => void post("/api/redis/shell")}>
              <SquareTerminal size={18} />
              <span>{t("services.cli")}</span>
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
