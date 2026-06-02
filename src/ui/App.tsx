import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  CircleStop,
  Database,
  ExternalLink,
  FileText,
  FolderPlus,
  Globe,
  KeyRound,
  ListRestart,
  Play,
  RotateCw,
  Settings,
  ShieldCheck,
  SquareTerminal
} from "lucide-react";
import type { DashboardSummary, ServiceStatus, Site } from "./types.js";

type Section = "sites" | "php" | "mysql" | "ssl" | "logs" | "settings";

const sections: Array<{ id: Section; label: string; icon: typeof Globe }> = [
  { id: "sites", label: "Sites", icon: Globe },
  { id: "php", label: "PHP", icon: SquareTerminal },
  { id: "mysql", label: "MySQL", icon: Database },
  { id: "ssl", label: "SSL Certificates", icon: ShieldCheck },
  { id: "logs", label: "Logs", icon: FileText },
  { id: "settings", label: "Settings", icon: Settings }
];

export default function App() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [section, setSection] = useState<Section>("sites");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const response = await fetch("/api/summary");
      if (!response.ok) throw new Error(await response.text());
      setSummary(await response.json());
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  }

  async function post(path: string, body: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) throw new Error(await response.text());
      await refresh();
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

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

        {error ? <div className="notice">Helper API offline or unavailable: {error}</div> : null}

        {!summary ? (
          <div className="empty-state">Loading laraboxs state...</div>
        ) : (
          <section className="content">
            {section === "sites" ? <Sites summary={summary} post={post} busy={busy} /> : null}
            {section === "php" ? <Php summary={summary} post={post} busy={busy} /> : null}
            {section === "mysql" ? <Mysql summary={summary} post={post} busy={busy} /> : null}
            {section === "ssl" ? <Ssl summary={summary} post={post} busy={busy} /> : null}
            {section === "logs" ? <Logs summary={summary} /> : null}
            {section === "settings" ? <SettingsView summary={summary} /> : null}
          </section>
        )}
      </main>
    </div>
  );
}

function Sites({ summary, post, busy }: ViewProps) {
  const [folder, setFolder] = useState(summary.config.parkedFolders[0] ?? "");

  return (
    <>
      <div className="toolbar">
        <input value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="C:\www" />
        <button className="primary" disabled={busy || !folder.trim()} onClick={() => void post("/api/sites/park", { path: folder })}>
          <FolderPlus size={18} />
          <span>Park Folder</span>
        </button>
        <button disabled={busy} onClick={() => void post("/api/hosts/sync", {})}>
          <ListRestart size={18} />
          <span>Sync Hosts</span>
        </button>
      </div>
      <SitesTable sites={summary.sites} />
    </>
  );
}

function SitesTable({ sites }: { sites: Site[] }) {
  if (sites.length === 0) {
    return <div className="empty-state">No parked projects found.</div>;
  }

  return (
    <div className="table-frame">
      <table>
        <thead>
          <tr>
            <th>Site</th>
            <th>URL</th>
            <th>Path</th>
            <th>SSL</th>
            <th>PHP</th>
            <th>Framework</th>
          </tr>
        </thead>
        <tbody>
          {sites.map((site) => (
            <tr key={site.domain}>
              <td>{site.name}</td>
              <td>
                <a href={site.url} target="_blank" rel="noreferrer">
                  {site.url}
                  <ExternalLink size={14} />
                </a>
              </td>
              <td className="path-cell">{site.path}</td>
              <td>{site.secured ? <Badge label="Secured" tone="green" /> : <Badge label="Plain" tone="amber" />}</td>
              <td>{site.phpVersion}</td>
              <td>{site.framework}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Php({ summary, post, busy }: ViewProps) {
  const [version, setVersion] = useState(summary.config.globalPhpVersion);
  const [site, setSite] = useState(summary.sites[0]?.domain ?? "");
  const [siteVersion, setSiteVersion] = useState(summary.config.phpVersions[0] ?? "8.4");

  return (
    <div className="two-column">
      <div className="panel">
        <h2>Global PHP</h2>
        <div className="segmented">
          {summary.config.phpVersions.map((candidate) => (
            <button key={candidate} className={version === candidate ? "active" : ""} onClick={() => setVersion(candidate)}>
              {candidate}
            </button>
          ))}
        </div>
        <button className="primary" disabled={busy} onClick={() => void post("/api/php/use", { version })}>
          <BadgeCheck size={18} />
          <span>Use Version</span>
        </button>
      </div>
      <div className="panel">
        <h2>Site Isolation</h2>
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
      </div>
    </div>
  );
}

function Mysql({ summary, post, busy }: ViewProps) {
  const [databaseName, setDatabaseName] = useState("app_name");
  const mysql = summary.services.mysql;

  return (
    <>
      <ServiceStrip service={mysql} />
      <div className="toolbar">
        <button className="primary" disabled={busy} onClick={() => void post("/api/mysql/start")}>
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
      <div className="panel">
        <h2>Create Database</h2>
        <div className="inline-form">
          <input value={databaseName} onChange={(event) => setDatabaseName(event.target.value)} />
          <button className="primary" disabled={busy || !databaseName.trim()} onClick={() => void post("/api/mysql/create-db", { name: databaseName })}>
            <Database size={18} />
            <span>Create</span>
          </button>
        </div>
        <dl className="details">
          <dt>Version</dt>
          <dd>{summary.config.mysql.version}</dd>
          <dt>Port</dt>
          <dd>{summary.config.mysql.port}</dd>
          <dt>Root user</dt>
          <dd>{summary.config.mysql.rootUser}</dd>
          <dt>Data directory</dt>
          <dd>{summary.paths.mysqlData}</dd>
        </dl>
      </div>
    </>
  );
}

function Ssl({ summary, post, busy }: ViewProps) {
  const [site, setSite] = useState(summary.sites[0]?.domain ?? "");

  return (
    <div className="panel">
      <h2>Local Certificates</h2>
      <select value={site} onChange={(event) => setSite(event.target.value)}>
        {summary.sites.map((candidate) => (
          <option key={candidate.domain} value={candidate.domain}>
            {candidate.domain}
          </option>
        ))}
      </select>
      <div className="button-row">
        <button className="primary" disabled={busy || !site} onClick={() => void post("/api/ssl/secure", { site })}>
          <ShieldCheck size={18} />
          <span>Secure</span>
        </button>
        <button disabled={busy || !site} onClick={() => void post("/api/ssl/unsecure", { site })}>
          <CircleStop size={18} />
          <span>Unsecure</span>
        </button>
      </div>
      <SitesTable sites={summary.sites.filter((candidate) => candidate.secured)} />
    </div>
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
      </dl>
    </div>
  );
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

interface ViewProps {
  summary: DashboardSummary;
  post: (path: string, body?: Record<string, unknown>) => Promise<void>;
  busy: boolean;
}
