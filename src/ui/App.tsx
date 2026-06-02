import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  CircleStop,
  Database,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  FolderPlus,
  Globe,
  KeyRound,
  ListRestart,
  Lock,
  LockOpen,
  Play,
  RotateCw,
  Server,
  Settings,
  ShieldCheck,
  SquareTerminal,
  Trash2
} from "lucide-react";
import type { DashboardSummary, PhpConfig, PhpExtensionStatus, PhpSettingsStatus, RuntimeInstallJob, RuntimeInstallStatus, RuntimeKind, ServiceStatus, Site } from "./types.js";

type Section = "setup" | "sites" | "nginx" | "php" | "mysql" | "mongodb" | "redis" | "logs" | "settings";
type RuntimeJobMap = Record<string, RuntimeInstallJob>;

const sections: Array<{ id: Section; label: string; icon: typeof Globe }> = [
  { id: "setup", label: "Setup", icon: Download },
  { id: "sites", label: "Sites", icon: Globe },
  { id: "nginx", label: "Nginx", icon: Server },
  { id: "php", label: "PHP", icon: SquareTerminal },
  { id: "mysql", label: "MySQL", icon: Database },
  { id: "mongodb", label: "MongoDB", icon: Database },
  { id: "redis", label: "Redis", icon: Database },
  { id: "logs", label: "Logs", icon: FileText },
  { id: "settings", label: "Settings", icon: Settings }
];

function apiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const isLocalBrowser =
    (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") &&
    (window.location.port === "5173" || window.location.port === "47899");

  if ((window.location.protocol === "http:" || window.location.protocol === "https:") && isLocalBrowser) {
    return normalizedPath;
  }

  return `http://127.0.0.1:47899${normalizedPath}`;
}

export default function App() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [section, setSection] = useState<Section>("setup");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installJobs, setInstallJobs] = useState<RuntimeJobMap>({});

  async function refresh() {
    try {
      const response = await fetch(apiUrl("/api/summary"));
      if (!response.ok) throw new Error(await responseErrorMessage(response));
      setSummary(await response.json());
      setError(null);
    } catch (requestError) {
      setError(`Helper API offline or unavailable: ${requestError instanceof Error ? requestError.message : String(requestError)}`);
    }
  }

  async function post(path: string, body: Record<string, unknown> = {}) {
    await request(path, body);
  }

  async function startRuntimeInstall(kind: RuntimeKind, version?: string, force = false) {
    try {
      const response = await fetch(apiUrl("/api/runtimes/install"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, version, force })
      });
      if (!response.ok) throw new Error(await responseErrorMessage(response));
      const payload = (await response.json()) as { job: RuntimeInstallJob };
      setInstallJobs((current) => ({ ...current, [payload.job.id]: payload.job }));
      setError(null);
    } catch (requestError) {
      setError(`Action failed: ${requestError instanceof Error ? requestError.message : String(requestError)}`);
    }
  }

  async function removeRuntime(kind: RuntimeKind, version?: string) {
    await request("/api/runtimes/uninstall", { kind, version });
  }

  async function request(path: string, body: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      const response = await fetch(apiUrl(path), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) throw new Error(await responseErrorMessage(response));
      const payload = await response.json();
      await refresh();
      setError(null);
      return payload as unknown;
    } catch (requestError) {
      setError(`Action failed: ${requestError instanceof Error ? requestError.message : String(requestError)}`);
      throw requestError;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, []);

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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">L</div>
          <div>
            <strong>laraboxs</strong>
            <span>Windows local dev</span>
          </div>
        </div>
        <nav>
          {sections.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}>
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <span className="eyebrow">{active.label}</span>
            <h1>{active.label}</h1>
          </div>
          <button className="icon-button" onClick={() => void refresh()} disabled={busy} title="Refresh">
            <RotateCw size={18} />
            <span>Refresh</span>
          </button>
        </header>

        {error ? <div className="notice">{error}</div> : null}

        {!summary ? (
          <div className="empty-state">Loading laraboxs state...</div>
        ) : (
          <section className="content">
            {section === "sites" ? <Sites summary={summary} post={post} request={request} busy={busy} /> : null}
            {section === "setup" ? (
              <Setup summary={summary} installJobs={installJobs} startRuntimeInstall={startRuntimeInstall} removeRuntime={removeRuntime} busy={busy} />
            ) : null}
            {section === "nginx" ? (
              <Nginx summary={summary} post={post} installJobs={installJobs} startRuntimeInstall={startRuntimeInstall} busy={busy} />
            ) : null}
            {section === "php" ? <Php summary={summary} post={post} busy={busy} /> : null}
            {section === "mysql" ? (
              <Mysql summary={summary} post={post} request={request} installJobs={installJobs} startRuntimeInstall={startRuntimeInstall} busy={busy} />
            ) : null}
            {section === "mongodb" ? (
              <MongoDB summary={summary} post={post} installJobs={installJobs} startRuntimeInstall={startRuntimeInstall} busy={busy} />
            ) : null}
            {section === "redis" ? (
              <Redis summary={summary} post={post} installJobs={installJobs} startRuntimeInstall={startRuntimeInstall} busy={busy} />
            ) : null}
            {section === "logs" ? <Logs summary={summary} /> : null}
            {section === "settings" ? <SettingsView summary={summary} /> : null}
          </section>
        )}
      </main>
    </div>
  );
}

function Setup({
  summary,
  installJobs,
  startRuntimeInstall,
  removeRuntime,
  busy
}: {
  summary: DashboardSummary;
  installJobs: RuntimeJobMap;
  startRuntimeInstall: (kind: RuntimeKind, version?: string, force?: boolean) => Promise<void>;
  removeRuntime: (kind: RuntimeKind, version?: string) => Promise<void>;
  busy: boolean;
}) {
  return (
    <div className="setup-grid">
      <RuntimePanel
        title="PHP"
        kind="php"
        items={summary.runtimes.php}
        installJobs={installJobs}
        busy={busy}
        install={startRuntimeInstall}
        uninstall={removeRuntime}
      />
      <RuntimePanel
        title="Nginx"
        kind="nginx"
        items={[summary.runtimes.nginx]}
        installJobs={installJobs}
        busy={busy}
        install={startRuntimeInstall}
        uninstall={removeRuntime}
      />
      <RuntimePanel title="MySQL" kind="mysql" items={summary.runtimes.mysql} installJobs={installJobs} busy={busy} install={startRuntimeInstall} uninstall={removeRuntime} />
      <RuntimePanel title="MongoDB" kind="mongodb" items={[summary.runtimes.mongodb]} installJobs={installJobs} busy={busy} install={startRuntimeInstall} uninstall={removeRuntime} />
      <RuntimePanel title="Redis" kind="redis" items={[summary.runtimes.redis]} installJobs={installJobs} busy={busy} install={startRuntimeInstall} uninstall={removeRuntime} />
      <RuntimePanel title="Node.js" kind="node" items={[summary.runtimes.node]} installJobs={installJobs} busy={busy} install={startRuntimeInstall} uninstall={removeRuntime} />
      <RuntimePanel
        title="Composer"
        kind="composer"
        items={[summary.runtimes.composer]}
        installJobs={installJobs}
        busy={busy}
        install={startRuntimeInstall}
        uninstall={removeRuntime}
      />
    </div>
  );
}

function RuntimePanel({
  title,
  kind,
  items,
  installJobs,
  busy,
  install,
  uninstall
}: {
  title: string;
  kind: RuntimeKind;
  items: RuntimeInstallStatus[];
  installJobs: RuntimeJobMap;
  busy: boolean;
  install: (kind: RuntimeKind, version?: string, force?: boolean) => Promise<void>;
  uninstall: (kind: RuntimeKind, version?: string) => Promise<void>;
}) {
  const jobs = Object.values(installJobs);

  async function removeInstalledRuntime(item: RuntimeInstallStatus) {
    const displayVersion = runtimeDisplayVersion(item);
    const warning =
      kind === "mysql"
        ? `Remove ${item.name} ${displayVersion}? This deletes the app-local MySQL runtime folder, including local MySQL data. Stop MySQL first.`
        : kind === "mongodb"
          ? `Remove ${item.name} ${displayVersion}? This deletes the app-local MongoDB runtime folder, including local MongoDB data. Stop MongoDB first.`
        : `Remove ${item.name} ${displayVersion}?`;
    if (!window.confirm(warning)) {
      return;
    }
    await uninstall(kind, item.version);
  }

  return (
    <div className="panel">
      <h2>{title}</h2>
      <div className="runtime-list">
        {items.map((item) => {
          const job = latestRuntimeJob(jobs, kind, item.version);
          const activeJob = job ? isActiveRuntimeJob(job) : false;
          const showProgress = job ? activeJob || job.status === "failed" : false;
          const displayVersion = runtimeDisplayVersion(item);

          return (
            <div className="runtime-row" key={`${item.name}-${item.version}`}>
              <div className="runtime-row-main">
                <div className="runtime-version-info">
                  <strong>{displayVersion}</strong>
                  <span>{item.installed ? (item.updateAvailable ? "Update available" : "Installed") : runtimeStatusLabel(job)}</span>
                </div>
                <div className="runtime-actions">
                  <button
                    className={!item.installed || item.updateAvailable ? "primary" : ""}
                    disabled={busy || (item.installed && !item.updateAvailable) || activeJob}
                    onClick={() => void install(kind, item.version, Boolean(item.updateAvailable))}
                  >
                    <Download size={18} />
                    <span>{runtimeActionLabel(item, job)}</span>
                  </button>
                  {item.installed ? (
                    <button className="danger-icon-button" disabled={busy || activeJob} onClick={() => void removeInstalledRuntime(item)} title={`Remove ${item.name} ${displayVersion}`}>
                      <Trash2 size={18} />
                    </button>
                  ) : null}
                </div>
              </div>
              {job && showProgress ? <RuntimeProgress job={job} /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Sites({ summary, post, request, busy }: ViewProps & { request: (path: string, body?: Record<string, unknown>) => Promise<unknown> }) {
  const [folder, setFolder] = useState(summary.config.parkedFolders[0] ?? "");

  async function browseFolder() {
    const payload = (await request("/api/dialog/folder", { initialPath: folder })) as { path?: string | null };
    if (payload.path) {
      setFolder(payload.path);
    }
  }

  return (
    <>
      <div className="toolbar">
        <div className="path-picker">
          <input value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="C:\www" />
          <button type="button" className="field-icon-button" disabled={busy} onClick={() => void browseFolder()} title="Browse folder">
            <FolderOpen size={18} />
          </button>
        </div>
        <button className="primary" disabled={busy || !folder.trim()} onClick={() => void post("/api/sites/park", { path: folder })}>
          <FolderPlus size={18} />
          <span>Park Folder</span>
        </button>
        <button disabled={busy} onClick={() => void post("/api/hosts/sync", {})}>
          <ListRestart size={18} />
          <span>Sync Hosts</span>
        </button>
      </div>
      <SslTrustPanel summary={summary} post={post} busy={busy} />
      <SiteEntryPanel sites={summary.sites} post={post} busy={busy} />
      <SitesTable sites={summary.sites} post={post} busy={busy} caTrusted={summary.ssl.trusted} />
    </>
  );
}

function SiteEntryPanel({ sites, post, busy }: { sites: Site[]; post: (path: string, body?: Record<string, unknown>) => Promise<void>; busy: boolean }) {
  const [siteDomain, setSiteDomain] = useState(sites[0]?.domain ?? "");
  const selectedSite = sites.find((site) => site.domain === siteDomain) ?? sites[0];
  const [entryPath, setEntryPath] = useState(selectedSite?.entryPath ?? ".");

  useEffect(() => {
    if (!sites.some((site) => site.domain === siteDomain)) {
      setSiteDomain(sites[0]?.domain ?? "");
    }
  }, [sites, siteDomain]);

  useEffect(() => {
    setEntryPath(selectedSite?.entryPath ?? ".");
  }, [siteDomain]);

  if (!selectedSite) {
    return null;
  }

  const defaultEntry = selectedSite.framework === "Laravel" ? "public" : ".";

  async function saveEntry(nextEntry = entryPath) {
    await post("/api/sites/entry", { site: selectedSite.domain, entry: nextEntry });
  }

  async function resetEntry() {
    setEntryPath(defaultEntry);
    await post("/api/sites/entry", { site: selectedSite.domain, entry: null });
  }

  return (
    <div className="panel site-entry-panel">
      <h2>Nginx Entry</h2>
      <div className="inline-form">
        <select value={selectedSite.domain} onChange={(event) => setSiteDomain(event.target.value)}>
          {sites.map((site) => (
            <option key={site.domain} value={site.domain}>
              {site.domain}
            </option>
          ))}
        </select>
        <input value={entryPath} onChange={(event) => setEntryPath(event.target.value)} placeholder={defaultEntry} />
        <button disabled={busy} onClick={() => setEntryPath(".")}>
          <FolderOpen size={18} />
          <span>Project Root</span>
        </button>
        <button disabled={busy} onClick={() => setEntryPath("public")}>
          <FolderOpen size={18} />
          <span>public</span>
        </button>
        <button className="primary" disabled={busy || !entryPath.trim()} onClick={() => void saveEntry()}>
          <BadgeCheck size={18} />
          <span>Save Entry</span>
        </button>
        <button disabled={busy} onClick={() => void resetEntry()}>
          <RotateCw size={18} />
          <span>Reset</span>
        </button>
      </div>
      <dl className="details compact-details">
        <dt>Framework</dt>
        <dd>{selectedSite.framework}</dd>
        <dt>Project</dt>
        <dd>{selectedSite.path}</dd>
        <dt>Document root</dt>
        <dd>{selectedSite.documentRoot}</dd>
      </dl>
    </div>
  );
}

function SslTrustPanel({ summary, post, busy }: ViewProps) {
  const ssl = summary.ssl;
  const tone = ssl.trusted ? "green" : ssl.exists ? "amber" : "red";
  const label = ssl.trusted ? "trusted" : ssl.exists ? "untrusted" : "missing";

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
      <button className={!ssl.trusted ? "primary" : ""} disabled={busy || ssl.trusted || ssl.platform !== "win32"} onClick={() => void post("/api/ssl/trust")}>
        <ShieldCheck size={18} />
        <span>{ssl.trusted ? "Trusted" : "Trust CA"}</span>
      </button>
    </div>
  );
}

function SitesTable({
  sites,
  post,
  busy,
  caTrusted = false
}: {
  sites: Site[];
  post?: (path: string, body?: Record<string, unknown>) => Promise<void>;
  busy?: boolean;
  caTrusted?: boolean;
}) {
  if (sites.length === 0) {
    return <div className="empty-state">No parked projects found.</div>;
  }

  function toggleSsl(site: Site) {
    if (!post) {
      return;
    }
    const path = site.secured ? "/api/ssl/unsecure" : "/api/ssl/secure";
    void post(path, { site: site.domain });
  }

  return (
    <div className="table-frame">
      <table>
        <thead>
          <tr>
            <th>URL</th>
            <th className="icon-column">
              <Lock size={15} />
            </th>
            <th>PHP</th>
            <th>Entry</th>
          </tr>
        </thead>
        <tbody>
          {sites.map((site) => {
            const sslClass = ["ssl-icon-button", site.secured ? (caTrusted ? "secured" : "needs-trust") : ""].filter(Boolean).join(" ");
            return (
              <tr key={site.domain}>
                <td>
                  <div className="url-actions">
                    <a href={site.url} target="_blank" rel="noreferrer">
                      {site.url}
                      <ExternalLink size={14} />
                    </a>
                  </div>
                </td>
                <td className="icon-column">
                  {post ? (
                    <button className={sslClass} disabled={busy} onClick={() => toggleSsl(site)} title={site.secured ? "Disable SSL" : "Enable SSL"}>
                      {site.secured ? <Lock size={16} /> : <LockOpen size={16} />}
                    </button>
                  ) : site.secured ? (
                    <Lock size={16} />
                  ) : (
                    <LockOpen size={16} />
                  )}
                </td>
                <td>{site.phpVersion}</td>
                <td className="path-cell">{site.entryPath}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Nginx({
  summary,
  post,
  installJobs,
  startRuntimeInstall,
  busy
}: ViewProps & {
  installJobs: RuntimeJobMap;
  startRuntimeInstall: (kind: RuntimeKind, version?: string, force?: boolean) => Promise<void>;
}) {
  const nginx = summary.runtimes.nginx;
  const installJob = latestRuntimeJob(Object.values(installJobs), "nginx", nginx.version);
  const installing = installJob ? isActiveRuntimeJob(installJob) : false;
  const showInstallProgress = installJob ? installing || installJob.status === "failed" : false;

  return (
    <>
      <ServiceStrip service={summary.services.nginx} />
      <div className="toolbar">
        <button
          className={!nginx.installed || nginx.updateAvailable ? "primary" : ""}
          disabled={busy || (nginx.installed && !nginx.updateAvailable) || installing}
          onClick={() => void startRuntimeInstall("nginx", nginx.version, Boolean(nginx.updateAvailable))}
        >
          <Download size={18} />
          <span>{runtimeActionLabel(nginx, installJob, "Install Nginx")}</span>
        </button>
        <button className="primary" disabled={busy || summary.services.nginx.state === "running"} onClick={() => void post("/api/nginx/start")}>
          <Play size={18} />
          <span>Start</span>
        </button>
        <button disabled={busy} onClick={() => void post("/api/nginx/stop")}>
          <CircleStop size={18} />
          <span>Stop</span>
        </button>
        <button disabled={busy} onClick={() => void post("/api/nginx/restart")}>
          <RotateCw size={18} />
          <span>Restart</span>
        </button>
      </div>
      {installJob && showInstallProgress ? <RuntimeProgress job={installJob} /> : null}
      <SslTrustPanel summary={summary} post={post} busy={busy} />
      <div className="two-column">
        <div className="panel">
          <h2>Runtime</h2>
          <dl className="details">
            <dt>Version</dt>
            <dd>{nginx.installedPackageVersion ?? nginx.version}</dd>
            <dt>Binary</dt>
            <dd>{nginx.binary}</dd>
            <dt>Root</dt>
            <dd>{summary.paths.nginxRoot}</dd>
            <dt>Log</dt>
            <dd>{summary.services.nginx.logPath}</dd>
          </dl>
        </div>
        <div className="panel">
          <h2>Routing</h2>
          <dl className="details">
            <dt>HTTP</dt>
            <dd>127.0.0.1:{summary.config.nginx.httpPort}</dd>
            <dt>HTTPS</dt>
            <dd>127.0.0.1:{summary.config.nginx.httpsPort}</dd>
            <dt>Config</dt>
            <dd>{summary.paths.nginxConfig}</dd>
            <dt>Sites</dt>
            <dd>{summary.paths.nginxSites}</dd>
          </dl>
        </div>
      </div>
      <NginxSettingsPanel summary={summary} post={post} busy={busy} />
    </>
  );
}

function NginxSettingsPanel({ summary, post, busy }: ViewProps) {
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
        const response = await fetch(apiUrl(`/api/php/settings?version=${encodeURIComponent(version)}`));
        if (!response.ok) throw new Error(await responseErrorMessage(response));
        const payload = (await response.json()) as PhpSettingsStatus;
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
  startRuntimeInstall: (kind: RuntimeKind, version?: string, force?: boolean) => Promise<void>;
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
  const installJob = selectedRuntime ? latestRuntimeJob(Object.values(installJobs), "mysql", selectedRuntime.version) : undefined;
  const installing = installJob ? isActiveRuntimeJob(installJob) : false;
  const showInstallProgress = installJob ? installing || installJob.status === "failed" : false;

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
    if (!window.confirm("Reset MySQL root password?")) {
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
            <span>{runtimeActionLabel(selectedRuntime, installJob, "Install MySQL")}</span>
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
        <div className="segmented">
          {summary.runtimes.mysql.map((runtime) => (
            <button key={runtime.version} className={selectedVersion === runtime.version ? "active" : ""} onClick={() => setSelectedVersion(runtime.version)}>
              {runtime.version}
            </button>
          ))}
        </div>
        <div className="button-row">
          <button disabled={busy || selectedVersion === summary.config.mysql.version || mysql.state === "running"} onClick={() => void post("/api/mysql/version", { version: selectedVersion })}>
            <BadgeCheck size={18} />
            <span>Use Version</span>
          </button>
        </div>
        <dl className="details">
          <dt>Active</dt>
          <dd>MySQL {summary.config.mysql.version}</dd>
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
            <a className={!summary.phpMyAdmin.installed ? "disabled-link" : ""} href={summary.phpMyAdmin.url} target="_blank" rel="noreferrer">
              <ExternalLink size={16} />
              <span>Open</span>
            </a>
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
          <dd>{summary.config.mysql.version}</dd>
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
  startRuntimeInstall: (kind: RuntimeKind, version?: string, force?: boolean) => Promise<void>;
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

function MongoDB({
  summary,
  post,
  installJobs,
  startRuntimeInstall,
  busy
}: ViewProps & {
  installJobs: RuntimeJobMap;
  startRuntimeInstall: (kind: RuntimeKind, version?: string, force?: boolean) => Promise<void>;
}) {
  const [port, setPort] = useState(String(summary.config.mongodb.port));
  const mongodb = summary.runtimes.mongodb;
  const installJob = latestRuntimeJob(Object.values(installJobs), "mongodb", mongodb.version);
  const installing = installJob ? isActiveRuntimeJob(installJob) : false;
  const showInstallProgress = installJob ? installing || installJob.status === "failed" : false;

  useEffect(() => {
    setPort(String(summary.config.mongodb.port));
  }, [summary.config.mongodb.port]);

  return (
    <>
      <ServiceStrip service={summary.services.mongodb} />
      <div className="toolbar">
        <button
          className={!mongodb.installed || mongodb.updateAvailable ? "primary" : ""}
          disabled={busy || (mongodb.installed && !mongodb.updateAvailable) || installing}
          onClick={() => void startRuntimeInstall("mongodb", mongodb.version, Boolean(mongodb.updateAvailable))}
        >
          <Download size={18} />
          <span>{runtimeActionLabel(mongodb, installJob, "Install MongoDB")}</span>
        </button>
        <button className="primary" disabled={busy || summary.services.mongodb.state === "running"} onClick={() => void post("/api/mongodb/start")}>
          <Play size={18} />
          <span>Start</span>
        </button>
        <button disabled={busy} onClick={() => void post("/api/mongodb/stop")}>
          <CircleStop size={18} />
          <span>Stop</span>
        </button>
        <button disabled={busy} onClick={() => void post("/api/mongodb/restart")}>
          <RotateCw size={18} />
          <span>Restart</span>
        </button>
      </div>
      {installJob && showInstallProgress ? <RuntimeProgress job={installJob} /> : null}
      <div className="two-column">
        <div className="panel">
          <h2>Connection</h2>
          <div className="inline-form">
            <input value={port} onChange={(event) => setPort(event.target.value)} inputMode="numeric" />
            <button disabled={busy || !port.trim()} onClick={() => void post("/api/mongodb/port", { port: Number(port) })}>
              <Settings size={18} />
              <span>Set Port</span>
            </button>
            <button disabled={busy} onClick={() => void post("/api/mongodb/port", { port: "auto" })}>
              <RotateCw size={18} />
              <span>Auto Port</span>
            </button>
          </div>
          <dl className="details">
            <dt>Host</dt>
            <dd>127.0.0.1</dd>
            <dt>Port</dt>
            <dd>{summary.config.mongodb.port}</dd>
            <dt>Data directory</dt>
            <dd>{summary.paths.mongodbData}</dd>
          </dl>
        </div>
        <div className="panel">
          <h2>Runtime</h2>
          <dl className="details">
            <dt>Version</dt>
            <dd>{mongodb.installedPackageVersion ?? mongodb.version}</dd>
            <dt>Binary</dt>
            <dd>{mongodb.binary}</dd>
            <dt>Root</dt>
            <dd>{summary.paths.mongodbRoot}</dd>
            <dt>Log</dt>
            <dd>{summary.services.mongodb.logPath}</dd>
          </dl>
        </div>
      </div>
    </>
  );
}

function Logs({ summary }: { summary: DashboardSummary }) {
  return (
    <pre className="logs">{summary.logs.length ? summary.logs.join("\n") : "No log entries yet."}</pre>
  );
}

function SettingsView({ summary }: { summary: DashboardSummary }) {
  return (
    <div className="panel">
      <h2>Configuration</h2>
      <dl className="details">
        <dt>Config file</dt>
        <dd>{summary.paths.configFile}</dd>
        <dt>Hosts file</dt>
        <dd>{summary.paths.hostsFile}</dd>
        <dt>App data</dt>
        <dd>{summary.paths.home}</dd>
        <dt>Local TLD</dt>
        <dd>{summary.config.tld}</dd>
        <dt>SSL CA</dt>
        <dd>{summary.ssl.trusted ? summary.ssl.store ?? "Trusted" : summary.ssl.message ?? "Untrusted"}</dd>
        <dt>CA certificate</dt>
        <dd>{summary.ssl.certPath}</dd>
      </dl>
    </div>
  );
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

async function responseErrorMessage(response: Response): Promise<string> {
  const raw = await response.text();
  if (!raw) {
    return `${response.status} ${response.statusText}`;
  }

  try {
    const payload = JSON.parse(raw) as { error?: unknown };
    if (typeof payload.error === "string") {
      return payload.error;
    }
  } catch {
    // Keep the raw response below when it is not JSON.
  }

  return raw;
}

async function fetchRuntimeInstallJob(id: string): Promise<RuntimeInstallJob> {
  const response = await fetch(apiUrl(`/api/runtimes/jobs/${encodeURIComponent(id)}`));
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response));
  }
  const payload = (await response.json()) as { job: RuntimeInstallJob };
  return payload.job;
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
  if (item.name === "Composer" && item.installedPackageVersion) {
    return item.installedPackageVersion;
  }
  return item.version;
}

function runtimeStatusLabel(job?: RuntimeInstallJob): string {
  if (job && isActiveRuntimeJob(job)) {
    return statusLabel(job.status);
  }

  if (job?.status === "failed") {
    return "Install failed";
  }

  return "Not installed";
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
}
