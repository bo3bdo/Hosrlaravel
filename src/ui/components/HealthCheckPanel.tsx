import { Activity, CheckCircle2, CircleAlert, Network, Play, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import type { DashboardSummary, RuntimeInstallStatus } from "../types.js";

type HealthTone = "green" | "amber" | "red";
type HealthItem = {
  id: string;
  label: string;
  detail: string;
  tone: HealthTone;
};

interface HealthCheckPanelProps {
  summary: DashboardSummary;
  busy: boolean;
  post: (path: string, body?: Record<string, unknown>) => Promise<void>;
}

export function HealthCheckPanel({ summary, busy, post }: HealthCheckPanelProps) {
  const [fixing, setFixing] = useState(false);
  const selectedPhp = summary.runtimes.php.find((runtime) => runtime.version === summary.config.globalPhpVersion);
  const selectedDatabase = summary.runtimes.mysql.find((runtime) => runtime.version === summary.config.mysql.version);
  const coreRuntimes = [selectedPhp, selectedDatabase, summary.runtimes.nginx, summary.runtimes.node, summary.runtimes.composer].filter(Boolean) as RuntimeInstallStatus[];
  const installedCoreCount = coreRuntimes.filter((runtime) => runtime.installed).length;
  const services = [summary.services.php, summary.services.nginx, summary.services.mysql, summary.services.redis];
  const runningServices = services.filter((service) => service.state === "running").length;
  const securedSites = summary.sites.filter((site) => site.secured).length;
  const hasLogWarnings = summary.logs.some((line) => /\b(error|failed|denied|refusing)\b/i.test(line));
  const canStartInstalledStack = Boolean(selectedPhp?.installed && selectedDatabase?.installed && summary.runtimes.nginx.installed);
  const canRepairLocalConfig = summary.sites.length > 0 || (securedSites > 0 && !summary.ssl.trusted);

  const checks = useMemo<HealthItem[]>(
    () => [
      {
        id: "workspace",
        label: "Workspace",
        detail: summary.config.parkedFolders.length ? `${summary.config.parkedFolders.length} parked folders` : "No parked folders",
        tone: summary.config.parkedFolders.length ? "green" : "amber"
      },
      {
        id: "runtimes",
        label: "Runtimes",
        detail: `${installedCoreCount}/${coreRuntimes.length} core runtimes installed`,
        tone: installedCoreCount === coreRuntimes.length ? "green" : installedCoreCount > 0 ? "amber" : "red"
      },
      {
        id: "services",
        label: "Services",
        detail: `${runningServices}/4 services running`,
        tone: runningServices === 4 ? "green" : runningServices > 0 ? "amber" : "red"
      },
      {
        id: "hosts",
        label: "Hosts",
        detail: summary.sites.length ? `${summary.sites.length} local domains managed` : "No local domains yet",
        tone: summary.sites.length ? "green" : "amber"
      },
      {
        id: "ssl",
        label: "SSL",
        detail: securedSites ? `${securedSites} secured sites, CA ${summary.ssl.trusted ? "trusted" : "untrusted"}` : "No secured sites yet",
        tone: securedSites && !summary.ssl.trusted ? "amber" : "green"
      },
      {
        id: "logs",
        label: "Logs",
        detail: hasLogWarnings ? "Recent warning or failure detected" : `${summary.logs.length} recent lines`,
        tone: hasLogWarnings ? "amber" : "green"
      }
    ],
    [coreRuntimes.length, hasLogWarnings, installedCoreCount, runningServices, securedSites, summary]
  );

  async function startInstalledStack() {
    setFixing(true);
    try {
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
    } finally {
      setFixing(false);
    }
  }

  async function repairLocalConfig() {
    setFixing(true);
    try {
      if (summary.sites.length) {
        await post("/api/hosts/sync");
      }
      if (securedSites > 0 && !summary.ssl.trusted && summary.ssl.platform === "win32") {
        await post("/api/ssl/trust");
      }
    } finally {
      setFixing(false);
    }
  }

  return (
    <section className="settings-panel wide-settings-panel health-panel">
      <div className="settings-panel-header">
        <Activity size={18} />
        <div>
          <strong>Health Check</strong>
          <span>{runningServices === 4 && installedCoreCount === coreRuntimes.length ? "Local stack is ready" : "Local stack needs attention"}</span>
        </div>
      </div>
      <div className="health-grid">
        {checks.map((item) => (
          <div key={item.id} className={`health-item ${item.tone}`}>
            {item.tone === "green" ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}
            <div>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="settings-actions">
        <button disabled={busy || fixing || !canStartInstalledStack || runningServices === 4} onClick={() => void startInstalledStack()} title="Start installed services">
          <Play size={16} />
          <span>Start Stack</span>
        </button>
        <button disabled={busy || fixing || !canRepairLocalConfig} onClick={() => void repairLocalConfig()} title="Repair local hosts and SSL trust">
          {securedSites > 0 && !summary.ssl.trusted ? <ShieldCheck size={16} /> : <Network size={16} />}
          <span>Repair Local</span>
        </button>
      </div>
    </section>
  );
}
