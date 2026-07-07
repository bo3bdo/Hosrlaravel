import { useEffect, useRef, useState } from "react";
import {
  Activity,
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
  ListRestart,
  Network,
  PackageCheck,
  Play,
  RotateCw,
  Save,
  SquareTerminal,
  Trash2
} from "lucide-react";
import { copyTextToClipboard, getJson, openExternalUrl } from "../apiClient.js";
import { showToast } from "../components/useToasts.js";
import { useDesktopConfirm } from "../shared/context.js";
import { makeT } from "../i18n.js";
import { Badge, ServiceStrip, SettingsPanelHeader } from "../shared/components.js";
import type {
  DatabaseExportResult,
  DatabaseTableInfo,
  PortCheckResult,
  RuntimeInstallJob,
  RuntimeKind,
  Site,
  SiteCommandDefinition,
  SiteCommandJob,
  SiteCommandKind,
  SiteDatabaseInfo,
  SiteDiagnosticReport,
  SiteEnvApplyResult,
  SiteEnvProfile,
  SiteEnvProfileKind,
  SiteWorkerKind,
  SiteWorkerStatus,
  UpdateCenterStatus
} from "../shared/types.js";
import type { ViewProps } from "../shared/types.js";
import {
  formatBytes,
  getJsonWithTimeout,
  pathTail,
  statusLabelForJob
} from "../shared/utils.js";

type ToolsPane = "ports" | "updates";

export function ToolsPage({
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
  const t = makeT(language);
  const panes: Array<{ id: ToolsPane; label: string; detail: string; icon: typeof Globe }> = [
    { id: "ports", label: t("tools.ports"), detail: t("tools.conflictsDetail"), icon: Network },
    { id: "updates", label: t("tools.updates"), detail: t("tools.updatesDetail"), icon: PackageCheck }
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

export function ToolSummaryCard({
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

export function SiteDatabaseTools({
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

export function ProjectTools({
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

export function EnvHelperPanel({
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

export function CommandJobPanel({ job }: { job: SiteCommandJob }) {
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

export function WorkerTools({
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

export function PortTools({ busy }: { request: (path: string, body?: Record<string, unknown>) => Promise<unknown>; busy: boolean }) {
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

export function UpdateTools({
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
