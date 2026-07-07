import { useEffect, useRef, useState } from "react";
import {
  Activity,
  BadgeCheck,
  CheckCircle2,
  CircleAlert,
  CircleStop,
  Clipboard,
  Database,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  FolderPlus,
  Globe,
  KeyRound,
  ListRestart,
  LoaderCircle,
  Lock,
  LockOpen,
  PackageCheck,
  PanelTopOpen,
  RotateCw,
  Search,
  Server,
  ShieldCheck,
  SquareTerminal,
  Trash2,
  X
} from "lucide-react";
import {
  apiUrl,
  copyTextToClipboard,
  getJson,
  openExternalUrl,
  postJson,
  responseErrorMessage
} from "../apiClient.js";
import { showToast } from "../components/useToasts.js";
import { useDesktopConfirm } from "../shared/context.js";
import { makeT } from "../i18n.js";
import { Badge } from "../shared/components.js";
import type {
  DashboardSummary,
  LaravelAuthPreset,
  LaravelDatabaseDriver,
  LaravelInstallerStatus,
  LaravelPackageManager,
  LaravelStarterKit,
  LaravelTestingFramework,
  NewSitePreset,
  Site,
  SiteCreationJob,
  SiteDeletionResult,
  SiteHealthStatus
} from "../shared/types.js";
import type { Section, SiteDetailTab, ViewProps } from "../shared/types.js";
import {
  databaseEngineName,
  defaultSitesFolder,
  joinWindowsPath,
  normalizeSiteName,
  pathTail,
  selectedMysqlRuntime
} from "../shared/utils.js";
import {
  ProjectTools,
  SiteDatabaseTools,
  WorkerTools
} from "./ToolsPage.js";

export function SitesPage({
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
  const t = makeT(language);

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
          <button className="primary" disabled={busy} onClick={() => setNewSiteOpen((open) => !open)} title={t("sites.createNewSite")}>
            <FolderPlus size={18} />
            <span>{t("sites.newSite")}</span>
          </button>
          <button disabled={busy || !folder.trim()} onClick={() => void post("/api/sites/park", { path: folder, primary: true })}>
            <FolderOpen size={18} />
            <span>{t("sites.parkFolder")}</span>
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
                <div className="settings-empty-row sites-empty-row"><span>{t("sites.noSitesMatchSearch")}</span></div>
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
                    {siteHealthLoading ? t("sites.checking") : siteHealth?.state === "error" ? t("sites.siteError") : t("sites.healthy")}
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

            <div className="site-detail-tabs" role="tablist" aria-label={t("sites.sectionsAria")}>
              <button role="tab" aria-selected={siteTab === "general"} className={siteTab === "general" ? "active" : ""} onClick={() => setSiteTab("general")}>
                {t("sites.general")}
              </button>
              <button role="tab" aria-selected={siteTab === "database"} className={siteTab === "database" ? "active" : ""} onClick={() => setSiteTab("database")}>
                {t("sites.database")}
              </button>
              <button role="tab" aria-selected={siteTab === "commands"} className={siteTab === "commands" ? "active" : ""} onClick={() => setSiteTab("commands")}>
                {t("sites.commands")}
              </button>
              {isLaravelSite ? (
                <button role="tab" aria-selected={siteTab === "workers"} className={siteTab === "workers" ? "active" : ""} onClick={() => setSiteTab("workers")}>
                  {t("sites.workers")}
                </button>
              ) : null}
              <button role="tab" aria-selected={siteTab === "information"} className={siteTab === "information" ? "active" : ""} onClick={() => setSiteTab("information")}>
                {t("sites.information")}
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
                  <span>{t("sites.openSite")}</span>
                </button>
                <button role="menuitem" onClick={() => run(() => void post("/api/open-path", { path: menuSite.path }))}>
                  <FolderOpen size={15} />
                  <span>{t("sites.openFolder")}</span>
                </button>
                <button role="menuitem" onClick={() => run(() => { void copyTextToClipboard(menuSite.url); showToast(t("sites.copiedUrl"), "success"); })}>
                  <Clipboard size={15} />
                  <span>{t("sites.copyUrl")}</span>
                </button>
                <div className="context-menu-separator" />
                <button role="menuitem" disabled={busy || (menuSite.secured && !summary.ssl.trusted)} onClick={() => run(() => void post(menuSite.secured ? "/api/ssl/unsecure" : "/api/ssl/secure", { site: menuSite.domain }))}>
                  {menuSite.secured ? <LockOpen size={15} /> : <Lock size={15} />}
                  <span>{menuSite.secured ? t("sites.disableSsl") : t("sites.enableSsl")}</span>
                </button>
                <button role="menuitem" onClick={() => run(() => { setSelectedDomain(menuSite.domain); setSiteTab("commands"); })}>
                  <SquareTerminal size={15} />
                  <span>{t("sites.commands")}</span>
                </button>
                <button role="menuitem" onClick={() => run(() => onNavigate("logs"))}>
                  <FileText size={15} />
                  <span>{t("logs.title")}</span>
                </button>
                <div className="context-menu-separator" />
                <button role="menuitem" className="context-menu-danger" disabled={busy} onClick={() => run(() => { setSelectedDomain(menuSite.domain); void deleteSelectedSite(); })}>
                  <Trash2 size={15} />
                  <span>{t("sites.delete")}</span>
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
