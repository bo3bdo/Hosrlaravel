import {
  CheckCircle2,
  CircleStop,
  Clipboard,
  FolderOpen,
  Globe,
  LoaderCircle,
  PackageCheck,
  Play,
  Settings
} from "lucide-react";
import type { DashboardSummary } from "../types.js";
import type { AppLanguage } from "../types.js";
import type { RuntimeInstallJob, RuntimeInstallStatus, ServiceStatus } from "../types.js";
import type { DatabaseEngine, RuntimeJobMap, Section, WizardTaskDefinition, WizardTaskState } from "./types.js";
import {
  databaseEngineKey,
  databaseRuntimesForEngine,
  formatDuration,
  formatTransfer,
  isActiveRuntimeJob,
  latestRuntimeJob,
  preferredDatabaseRuntime,
  runtimeDisplayVersion,
  statusLabel
} from "./utils.js";

export function serviceBadgeForSection(sectionId: Section, summary: DashboardSummary): JSX.Element | null {
  if (sectionId === "services") {
    const runningServices = [summary.services.php, summary.services.nginx, summary.services.mysql, summary.services.redis].filter(
      (service) => service.state === "running"
    ).length;
    const tone = runningServices === 4 ? "green" : runningServices > 0 ? "amber" : "red";
    return <span className={`status-dot ${tone}`} title={`${runningServices}/4 services running`} />;
  }
  return null;
}

export function SettingsPanelHeader({ icon: Icon, title, detail }: { icon: typeof Globe; title: string; detail: string }) {
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

export function SettingsQuickTile({
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

export function SettingsPathRow({
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

export function Badge({ label, tone }: { label: string; tone: "green" | "amber" | "red" }) {
  return <span className={`badge ${tone}`}>{label}</span>;
}

export function RuntimeProgress({ job }: { job: RuntimeInstallJob }) {
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

export function ServiceStrip({ service }: { service: ServiceStatus }) {
  return (
    <div className="service-strip">
      <Badge label={service.state} tone={service.state === "running" ? "green" : service.state === "stopped" ? "red" : "amber"} />
      <strong>{service.name}</strong>
      {service.port ? <span>127.0.0.1:{service.port}</span> : null}
      {service.message ? <span className="muted">{service.message}</span> : null}
    </div>
  );
}

export function ServiceHeader({ icon: Icon, title, service, detail }: { icon: typeof Globe; title: string; service: ServiceStatus; detail?: string }) {
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

export function ServiceNavButton({
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

export function RuntimePicker({ runtimes, value, onChange }: { runtimes: RuntimeInstallStatus[]; value: string; onChange: (version: string) => void }) {
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

export function DatabaseRuntimePicker({ runtimes, value, onChange }: { runtimes: RuntimeInstallStatus[]; value: string; onChange: (version: string) => void }) {
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

export function StackPreviewItem({ icon: Icon, title, runtime }: { icon: typeof Globe; title: string; runtime?: RuntimeInstallStatus }) {
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

export function WizardTaskRow({ task, state, installJobs }: { task: WizardTaskDefinition; state?: WizardTaskState; installJobs: RuntimeJobMap }) {
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