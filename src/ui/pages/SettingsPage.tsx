import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Clipboard,
  BadgeCheck,
  Database,
  Download,
  FileText,
  FolderOpen,
  FolderPlus,
  Globe,
  HardDrive,
  Languages,
  ListRestart,
  Lock,
  Network,
  PackageCheck,
  RotateCw,
  Save,
  Server,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  SquareTerminal,
  Trash2
} from "lucide-react";
import { copyTextToClipboard, getJson } from "../apiClient.js";
import { showToast } from "../components/useToasts.js";
import { useDesktopConfirm } from "../shared/context.js";
import { makeT } from "../i18n.js";
import {
  DatabaseRuntimePicker,
  SettingsPanelHeader,
  SettingsPathRow,
  SettingsQuickTile
} from "../shared/components.js";
import type { AppLanguage, LaravelInstallerStatus, StartupStatus } from "../shared/types.js";
import type { ViewProps } from "../shared/types.js";
import { Badge } from "../shared/components.js";
import {
  databaseRuntimeDisplay,
  isValidLocalTld,
  normalizeLocalTld,
  pathTail,
  selectedMysqlRuntime
} from "../shared/utils.js";

export function SettingsPage({
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
  const t = makeT(language);

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
    { id: "general", label: t("settings.general"), detail: t("settings.paneGeneralDetail"), icon: SlidersHorizontal },
    { id: "tools", label: t("settings.tools"), detail: t("settings.paneToolsDetail"), icon: PackageCheck },
    { id: "paths", label: t("settings.paths"), detail: t("settings.panePathsDetail"), icon: FolderOpen },
    { id: "security", label: t("settings.security"), detail: t("settings.paneSecurityDetail"), icon: Shield }
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
              <span>{t("settings.language")}</span>
              <div className="segmented language-segmented" aria-label={t("settings.interfaceLanguage")}>
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

export function DefenderExclusionTile({
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

export function laravelInstallerBadge(status: LaravelInstallerStatus | null): { label: string; tone: "green" | "amber" | "red" } {
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

export function laravelInstallerDetail(status: LaravelInstallerStatus | null): { title: string; subtitle: string } {
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
