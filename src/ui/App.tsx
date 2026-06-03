import { useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Clipboard,
  Database,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  FolderPlus,
  Globe,
  HardDrive,
  KeyRound,
  ListRestart,
  LoaderCircle,
  Lock,
  LockOpen,
  Network,
  PackageCheck,
  Play,
  RotateCw,
  Save,
  Search,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  SquareTerminal,
  Trash2,
  X
} from "lucide-react";
import type {
  DashboardSummary,
  LaravelAuthPreset,
  LaravelDatabaseDriver,
  LaravelInstallerStatus,
  LaravelPackageManager,
  LaravelStarterKit,
  LaravelTestingFramework,
  NewSitePreset,
  PhpConfig,
  PhpExtensionStatus,
  PhpSettingsStatus,
  RuntimeInstallJob,
  RuntimeInstallStatus,
  RuntimeKind,
  ServiceStatus,
  SiteCreationJob,
  Site,
  SiteCreationResult
} from "./types.js";
import { apiUrl, copyTextToClipboard, fetchRuntimeInstallJob, getJson, openExternalUrl, postJson, responseErrorMessage } from "./apiClient.js";
import { HealthCheckPanel } from "./components/HealthCheckPanel.js";
import { ToastContainer } from "./components/ToastContainer.js";
import { useToasts, showToast } from "./components/useToasts.js";

type Section = "sites" | "services" | "logs" | "settings";
type ServicesPane = "mysql" | "redis" | "phpmyadmin" | "php" | "nginx" | "all";
type DatabaseEngine = "mysql" | "mariadb";
type RuntimeJobMap = Record<string, RuntimeInstallJob>;
type WizardStepId = "folder" | "install" | "finish";
type WizardTaskStatus = "pending" | "running" | "complete" | "failed";
type WizardTaskState = { status: WizardTaskStatus; message?: string };
type WizardTaskDefinition = {
  id: string;
  label: string;
  detail: string;
  optional?: boolean;
  runtime?: { kind: RuntimeKind; version?: string };
};

const sections: Array<{ id: Section; label: string; icon: typeof Globe }> = [
  { id: "sites", label: "Sites", icon: Globe },
  { id: "services", label: "Services", icon: Server },
  { id: "logs", label: "Logs", icon: FileText },
  { id: "settings", label: "Settings", icon: Settings }
];

function serviceBadgeForSection(sectionId: Section, summary: DashboardSummary): JSX.Element | null {
  if (sectionId === "services") {
    const runningServices = [summary.services.php, summary.services.nginx, summary.services.mysql, summary.services.redis].filter(
      (service) => service.state === "running"
    ).length;
    const tone = runningServices === 4 ? "green" : runningServices > 0 ? "amber" : "red";
    return <span className={`status-dot ${tone}`} title={`${runningServices}/4 services running`} />;
  }
  return null;
}

export default function App() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [section, setSection] = useState<Section>("sites");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installJobs, setInstallJobs] = useState<RuntimeJobMap>({});
  const { toasts, addToast, removeToast } = useToasts();

  async function refresh() {
    try {
      setSummary(await getJson<DashboardSummary>("/api/summary"));
      setError(null);
    } catch (requestError) {
      setError(`Helper API offline or unavailable: ${requestError instanceof Error ? requestError.message : String(requestError)}`);
    }
  }

  async function post(path: string, body: Record<string, unknown> = {}) {
    await request(path, body);
  }

  async function startRuntimeInstall(kind: RuntimeKind, version?: string, force = false): Promise<RuntimeInstallJob | undefined> {
    try {
      const payload = await postJson<{ job: RuntimeInstallJob }>("/api/runtimes/install", { kind, version, force });
      setInstallJobs((current) => ({ ...current, [payload.job.id]: payload.job }));
      setError(null);
      return payload.job;
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : String(requestError);
      setError(`Action failed: ${message}`);
      addToast(message, "error");
      return undefined;
    }
  }

  async function removeRuntime(kind: RuntimeKind, version?: string) {
    await request("/api/runtimes/uninstall", { kind, version });
  }

  async function request(path: string, body: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      const payload = await postJson<unknown>(path, body);
      await refresh();
      setError(null);
      return payload as unknown;
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : String(requestError);
      setError(`Action failed: ${message}`);
      addToast(message, "error");
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

  if (!summary) {
    return <BootScreen error={error} busy={busy} refresh={refresh} />;
  }

  if (summary && needsFirstRunSetup(summary)) {
    return (
      <FirstRunWizard
        summary={summary}
        installJobs={installJobs}
        startRuntimeInstall={startRuntimeInstall}
        request={request}
        refresh={refresh}
        busy={busy}
        error={error}
        onFinish={() => {
          setSection("sites");
          void refresh();
        }}
      />
    );
  }

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
            const badge = summary ? serviceBadgeForSection(item.id, summary) : null;
            return (
              <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}>
                <Icon size={18} />
                <span>{item.label}</span>
                {badge ?? null}
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
            {section === "services" ? (
              <Services summary={summary} post={post} request={request} installJobs={installJobs} startRuntimeInstall={startRuntimeInstall} busy={busy} />
            ) : null}
            {section === "logs" ? <Logs summary={summary} post={post} busy={busy} /> : null}
            {section === "settings" ? <SettingsView summary={summary} post={post} request={request} busy={busy} /> : null}
          </section>
        )}
      </main>

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}

function BootScreen({ error, busy, refresh }: { error: string | null; busy: boolean; refresh: () => Promise<void> }) {
  return (
    <div className="boot-shell">
      <div className="boot-panel">
        <div className="brand">
          <div className="brand-mark">L</div>
          <div>
            <strong>laraboxs</strong>
            <span>Windows local dev</span>
          </div>
        </div>
        <div className="boot-status">
          <LoaderCircle className="spin" size={22} />
          <div>
            <strong>Loading local stack state</strong>
            <span>{error ?? "Checking runtimes and services..."}</span>
          </div>
        </div>
        <button onClick={() => void refresh()} disabled={busy}>
          <RotateCw size={18} />
          <span>Retry</span>
        </button>
      </div>
    </div>
  );
}

function FirstRunWizard({
  summary,
  installJobs,
  startRuntimeInstall,
  request,
  refresh,
  busy,
  error,
  onFinish
}: {
  summary: DashboardSummary;
  installJobs: RuntimeJobMap;
  startRuntimeInstall: (kind: RuntimeKind, version?: string, force?: boolean) => Promise<RuntimeInstallJob | undefined>;
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
  refresh: () => Promise<void>;
  busy: boolean;
  error: string | null;
  onFinish: () => void;
}) {
  const [step, setStep] = useState<WizardStepId>("folder");
  const [sitesFolder, setSitesFolder] = useState(summary.config.parkedFolders[0] ?? defaultSitesFolder(summary));
  const [taskStates, setTaskStates] = useState<Record<string, WizardTaskState>>({});
  const [running, setRunning] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [wizardWarning, setWizardWarning] = useState<string | null>(null);
  const [mysqlVersion, setMysqlVersion] = useState(summary.config.mysql.version);

  const phpRuntime = preferredRuntime(summary.runtimes.php);
  const mysqlRuntime = selectedMysqlRuntime(summary, mysqlVersion) ?? selectedMysqlRuntime(summary, summary.config.mysql.version) ?? summary.runtimes.mysql[0];
  const phpVersion = phpRuntime?.version ?? summary.config.globalPhpVersion;
  const selectedDatabaseLabel = databaseRuntimeDisplay(mysqlRuntime);
  const mysqlVersionsKey = summary.runtimes.mysql.map((runtime) => runtime.version).join("|");
  const canStart = sitesFolder.trim().length > 0;
  const steps: Array<{ id: WizardStepId; label: string; detail: string }> = [
    { id: "folder", label: "Sites", detail: pathTail(sitesFolder) || "Choose folder" },
    { id: "install", label: "Stack", detail: running ? "Installing" : `${taskDefinitionsLabel(summary, phpVersion, mysqlVersion)}` },
    { id: "finish", label: "Ready", detail: "Open workspace" }
  ];
  const activeStepIndex = steps.findIndex((item) => item.id === step);
  const taskDefinitions = useMemo(
    () =>
      firstRunTaskDefinitions(summary, {
        phpVersion,
        mysqlVersion,
        sitesFolder: sitesFolder.trim()
      }),
    [summary, phpVersion, mysqlVersion, sitesFolder]
  );
  const resolvedCount = taskDefinitions.filter((task) => {
    const status = taskStates[task.id]?.status;
    return status === "complete" || (task.optional && status === "failed");
  }).length;
  const setupFinished = taskDefinitions.length > 0 && resolvedCount === taskDefinitions.length;
  const setupPercent = taskDefinitions.length ? Math.round((resolvedCount / taskDefinitions.length) * 100) : 0;

  function updateTask(id: string, status: WizardTaskStatus, message?: string) {
    setTaskStates((current) => ({
      ...current,
      [id]: { status, message }
    }));
  }

  useEffect(() => {
    if (summary.runtimes.mysql.length && !summary.runtimes.mysql.some((runtime) => runtime.version === mysqlVersion)) {
      setMysqlVersion(summary.config.mysql.version);
    }
  }, [mysqlVersion, mysqlVersionsKey, summary.config.mysql.version, summary.runtimes.mysql]);

  async function runSetup() {
    if (!canStart) {
      setWizardError("Choose a sites folder before setup.");
      setStep("folder");
      return;
    }

    setStep("install");
    setRunning(true);
    setWizardError(null);
    setWizardWarning(null);

    try {
      setTaskStates({});
      const optionalFailures: string[] = [];
      for (const task of taskDefinitions) {
        try {
          if (task.runtime) {
            await runRuntimeWizardTask(task, summary, startRuntimeInstall, refresh, updateTask);
          } else {
            await runActionWizardTask(task, async () => {
              switch (task.id) {
                case "park":
                  await request("/api/sites/park", { path: sitesFolder.trim() });
                  break;
                case "configure":
                  await request("/api/php-fcgi/stop").catch(() => undefined);
                  await request("/api/php/versions", { versions: [phpVersion], globalVersion: phpVersion });
                  if (mysqlVersion !== summary.config.mysql.version) {
                    await request("/api/mysql/stop").catch(() => undefined);
                    await request("/api/mysql/version", { version: mysqlVersion });
                  }
                  break;
                case "mysql-init":
                  await request("/api/mysql/init");
                  break;
                case "phpmyadmin":
                  await request("/api/phpmyadmin/install");
                  break;
                case "php-start":
                  await request("/api/php-fcgi/start");
                  break;
                case "mysql-start":
                  await request("/api/mysql/start");
                  break;
                case "redis-start":
                  await request("/api/redis/start");
                  break;
                case "nginx-start":
                  await request("/api/nginx/start");
                  break;
                case "hosts-sync":
                  await request("/api/hosts/sync");
                  break;
                case "complete":
                  await request("/api/setup/complete");
                  break;
              }
              await refresh();
            }, updateTask);
          }
        } catch (taskError) {
          if (!task.optional) {
            throw taskError;
          }
          optionalFailures.push(task.label);
        }
      }
      if (optionalFailures.length) {
        setWizardWarning(`${optionalFailures.join(", ")} can be configured later from their pages.`);
      }
      setStep("finish");
    } catch (setupError) {
      setWizardError(setupError instanceof Error ? setupError.message : String(setupError));
    } finally {
      setRunning(false);
      await refresh();
    }
  }

  async function browseFolder() {
    const payload = (await request("/api/dialog/folder", { initialPath: sitesFolder })) as { path?: string | null };
    if (payload.path) {
      setSitesFolder(payload.path);
    }
  }

  return (
    <div className="wizard-shell">
      <aside className="wizard-rail">
        <div className="brand">
          <div className="brand-mark">L</div>
          <div>
            <strong>laraboxs</strong>
            <span>First launch</span>
          </div>
        </div>
        <div className="wizard-step-list">
          {steps.map((item, index) => (
            <button
              key={item.id}
              className={["wizard-step", step === item.id ? "active" : "", index < activeStepIndex ? "done" : ""].filter(Boolean).join(" ")}
              disabled={running || (item.id === "finish" && !setupFinished)}
              onClick={() => setStep(item.id)}
            >
              <span>{index < activeStepIndex || (item.id === "finish" && setupFinished) ? <CheckCircle2 size={15} /> : index + 1}</span>
              <div>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </div>
            </button>
          ))}
        </div>
      </aside>

      <main className="wizard-main">
        <header className="wizard-titlebar">
          <div>
            <span className="eyebrow">Local stack</span>
            <h1>{step === "finish" ? "laraboxs is ready" : "Set up laraboxs"}</h1>
          </div>
          <button className="icon-button" onClick={() => void refresh()} disabled={busy || running} title="Refresh">
            <RotateCw size={18} />
            <span>Refresh</span>
          </button>
        </header>

        {error || wizardError || wizardWarning ? <div className="notice wizard-notice">{wizardError ?? error ?? wizardWarning}</div> : null}

        <section className="wizard-content">
          {step === "folder" ? (
            <div className="wizard-page wizard-folder-page">
              <div className="wizard-copy">
                <span className="eyebrow">Sites folder</span>
                <h2>Choose where local projects live.</h2>
                <p>laraboxs will park this folder and create it if it does not exist.</p>
              </div>
              <div className="wizard-folder-card">
                <label>
                  <span>Sites folder</span>
                  <div className="path-picker">
                    <input value={sitesFolder} onChange={(event) => setSitesFolder(event.target.value)} />
                    <button type="button" className="field-icon-button" disabled={busy || running} onClick={() => void browseFolder()} title="Browse folder">
                      <FolderOpen size={18} />
                    </button>
                  </div>
                </label>
                <div className="button-row">
                  <button disabled={busy || running} onClick={() => setSitesFolder(defaultSitesFolder(summary))}>
                    <RotateCw size={18} />
                    <span>Use Default</span>
                  </button>
                </div>
              </div>

              <div className="wizard-stack-preview">
                <StackPreviewItem icon={SquareTerminal} title={`PHP ${phpVersion}`} runtime={phpRuntime} />
                <StackPreviewItem icon={Database} title={selectedDatabaseLabel} runtime={mysqlRuntime} />
                <StackPreviewItem icon={Server} title={`Nginx ${summary.runtimes.nginx.version}`} runtime={summary.runtimes.nginx} />
                <StackPreviewItem icon={PackageCheck} title="Composer stable" runtime={summary.runtimes.composer} />
                <StackPreviewItem icon={SquareTerminal} title={`Node.js ${summary.runtimes.node.version}`} runtime={summary.runtimes.node} />
              </div>
              <div className="wizard-runtime-choice">
                <span className="eyebrow">Database</span>
                <DatabaseRuntimePicker runtimes={summary.runtimes.mysql} value={mysqlVersion} onChange={setMysqlVersion} />
              </div>
            </div>
          ) : null}

          {step === "install" ? (
            <div className="wizard-page">
              <div className="wizard-install-header">
                <div className="wizard-copy">
                  <span className="eyebrow">Installing</span>
                  <h2>Downloading and starting the local stack.</h2>
                </div>
                <div className="wizard-progress-summary">
                  <strong>{setupPercent}%</strong>
                  <span>
                    {resolvedCount}/{taskDefinitions.length} complete
                  </span>
                </div>
              </div>
              <div className="progress-track wizard-overall-progress">
                <div className="progress-fill" style={{ width: `${setupPercent}%` }} />
              </div>
              <div className="wizard-task-list">
                {taskDefinitions.map((task) => (
                  <WizardTaskRow key={task.id} task={task} state={taskStates[task.id]} installJobs={installJobs} />
                ))}
              </div>
            </div>
          ) : null}

          {step === "finish" ? (
            <div className="wizard-page wizard-finish">
              <CheckCircle2 size={46} />
              <div>
                <span className="eyebrow">Complete</span>
                <h2>The local development stack is ready.</h2>
                <p>{pathTail(sitesFolder) || "Sites"} is parked with PHP {phpVersion}, Nginx, {selectedDatabaseLabel}, Composer, and Node.js.</p>
              </div>
            </div>
          ) : null}
        </section>

        <footer className="wizard-footer">
          <button disabled={running || step === "folder"} onClick={() => setStep(steps[Math.max(0, activeStepIndex - 1)].id)}>
            <ChevronLeft size={18} />
            <span>Back</span>
          </button>
          {step === "folder" ? (
            <button className="primary" disabled={running || busy || !canStart} onClick={() => void runSetup()}>
              <Download size={18} />
              <span>Continue</span>
            </button>
          ) : null}
          {step === "install" ? (
            <button className="primary" disabled={running || busy || setupFinished} onClick={() => void runSetup()}>
              {running ? <LoaderCircle className="spin" size={18} /> : <PackageCheck size={18} />}
              <span>{running ? "Preparing" : wizardError ? "Retry Setup" : setupFinished ? "Complete" : "Start Setup"}</span>
            </button>
          ) : null}
          {step === "finish" ? (
            <button className="primary" disabled={!setupFinished && !summary.config.setupComplete} onClick={onFinish}>
              <CheckCircle2 size={18} />
              <span>Open laraboxs</span>
            </button>
          ) : null}
        </footer>
      </main>
    </div>
  );
}

function StackPreviewItem({ icon: Icon, title, runtime }: { icon: typeof Globe; title: string; runtime?: RuntimeInstallStatus }) {
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

function WizardToggle({
  checked,
  disabled = false,
  title,
  detail,
  status,
  onChange
}: {
  checked: boolean;
  disabled?: boolean;
  title: string;
  detail: string;
  status: "ready" | "missing";
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label className={`wizard-toggle ${disabled ? "disabled" : ""}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange?.(event.target.checked)} />
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <Badge label={status} tone={status === "ready" ? "green" : "amber"} />
    </label>
  );
}

function WizardTaskRow({ task, state, installJobs }: { task: WizardTaskDefinition; state?: WizardTaskState; installJobs: RuntimeJobMap }) {
  const status = state?.status ?? "pending";
  const runtimeJob = task.runtime ? latestRuntimeJob(Object.values(installJobs), task.runtime.kind, task.runtime.version ?? "") : undefined;
  const showRuntimeProgress = runtimeJob ? isActiveRuntimeJob(runtimeJob) || runtimeJob.status === "failed" : false;

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
        {showRuntimeProgress && runtimeJob ? <RuntimeProgress job={runtimeJob} /> : null}
      </div>
    </div>
  );
}

async function runActionWizardTask(task: WizardTaskDefinition, action: () => Promise<void>, updateTask: (id: string, status: WizardTaskStatus, message?: string) => void) {
  updateTask(task.id, "running", task.detail);
  try {
    await action();
    updateTask(task.id, "complete", "Complete");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateTask(task.id, "failed", message);
    throw error;
  }
}

async function runRuntimeWizardTask(
  task: WizardTaskDefinition,
  summary: DashboardSummary,
  startRuntimeInstall: (kind: RuntimeKind, version?: string, force?: boolean) => Promise<RuntimeInstallJob | undefined>,
  refresh: () => Promise<void>,
  updateTask: (id: string, status: WizardTaskStatus, message?: string) => void
) {
  const runtime = task.runtime ? selectedRuntimeStatus(summary, task.runtime.kind, task.runtime.version) : undefined;
  if (runtime?.installed && !runtime.updateAvailable) {
    updateTask(task.id, "complete", "Already installed");
    return;
  }

  updateTask(task.id, "running", runtime?.updateAvailable ? "Updating runtime" : "Starting download");
  const job = task.runtime ? await startRuntimeInstall(task.runtime.kind, task.runtime.version, Boolean(runtime?.updateAvailable)) : undefined;
  if (!job) {
    const message = `Could not start ${task.label}.`;
    updateTask(task.id, "failed", message);
    throw new Error(message);
  }

  const finishedJob = await waitForRuntimeJob(job, (currentJob) => {
    updateTask(task.id, "running", currentJob.message ?? statusLabel(currentJob.status));
  });

  if (finishedJob.status === "failed") {
    const message = finishedJob.error ?? finishedJob.message ?? `${task.label} failed.`;
    updateTask(task.id, "failed", message);
    throw new Error(message);
  }

  updateTask(task.id, "complete", "Installed");
  await refresh();
}

async function waitForRuntimeJob(job: RuntimeInstallJob, onUpdate: (job: RuntimeInstallJob) => void): Promise<RuntimeInstallJob> {
  let currentJob = job;
  onUpdate(currentJob);

  while (isActiveRuntimeJob(currentJob)) {
    await sleep(900);
    currentJob = await fetchRuntimeInstallJob(currentJob.id);
    onUpdate(currentJob);
  }

  return currentJob;
}

function firstRunTaskDefinitions(
  summary: DashboardSummary,
  options: {
    phpVersion: string;
    mysqlVersion: string;
    sitesFolder: string;
  }
): WizardTaskDefinition[] {
  const databaseRuntime = selectedMysqlRuntime(summary, options.mysqlVersion);
  const databaseLabel = databaseRuntimeDisplay(databaseRuntime);
  const databaseName = databaseEngineName(databaseRuntime);
  const tasks: WizardTaskDefinition[] = [
    { id: "park", label: "Park sites folder", detail: options.sitesFolder },
    { id: "configure", label: "Apply selected versions", detail: `Use PHP ${options.phpVersion} and ${databaseLabel}` },
    { id: `php-${options.phpVersion}`, label: `Prepare PHP ${options.phpVersion}`, detail: "Download PHP CLI and FastCGI", runtime: { kind: "php", version: options.phpVersion } },
    { id: "nginx", label: "Prepare Nginx", detail: "Download the local web server", runtime: { kind: "nginx", version: summary.runtimes.nginx.version } },
    { id: `mysql-${options.mysqlVersion}`, label: `Prepare ${databaseLabel}`, detail: "Download the database runtime", runtime: { kind: "mysql", version: options.mysqlVersion } },
    { id: "composer", label: "Prepare Composer", detail: "Install Composer for Laravel packages", runtime: { kind: "composer", version: summary.runtimes.composer.version } },
    { id: "node", label: "Prepare Node.js", detail: "Install frontend tooling runtime", runtime: { kind: "node", version: summary.runtimes.node.version } }
  ];

  tasks.push({ id: "mysql-init", label: `Initialize ${databaseName}`, detail: "Create data directory and root password" });
  if (!summary.phpMyAdmin.installed) {
    tasks.push({ id: "phpmyadmin", label: "Install phpMyAdmin", detail: "Create the database admin site", optional: true });
  }
  tasks.push(
    { id: "php-start", label: "Start PHP FastCGI", detail: "Launch the selected PHP worker" },
    { id: "mysql-start", label: `Start ${databaseName}`, detail: "Start the local database service" }
  );
  tasks.push(
    { id: "nginx-start", label: "Start Nginx", detail: "Serve local sites" },
    { id: "hosts-sync", label: "Sync local domains", detail: "Update the Windows hosts file", optional: true },
    { id: "complete", label: "Save setup state", detail: "Open the workspace" }
  );

  return tasks;
}

function needsFirstRunSetup(summary: DashboardSummary): boolean {
  if (!summary.config.setupComplete) {
    return true;
  }

  return summary.config.parkedFolders.length === 0 || !baseStackInstalled(summary);
}

function baseStackInstalled(summary: DashboardSummary): boolean {
  return Boolean(
    selectedPhpRuntime(summary, summary.config.globalPhpVersion)?.installed &&
      selectedMysqlRuntime(summary, summary.config.mysql.version)?.installed &&
      summary.runtimes.nginx.installed &&
      summary.runtimes.composer.installed
  );
}

function selectedRuntimeStatus(summary: DashboardSummary, kind: RuntimeKind, version?: string): RuntimeInstallStatus | undefined {
  switch (kind) {
    case "php":
      return selectedPhpRuntime(summary, version ?? summary.config.globalPhpVersion);
    case "mysql":
      return selectedMysqlRuntime(summary, version ?? summary.config.mysql.version);
    case "nginx":
      return summary.runtimes.nginx;
    case "redis":
      return summary.runtimes.redis;
    case "node":
      return summary.runtimes.node;
    case "composer":
      return summary.runtimes.composer;
  }
}

function selectedPhpRuntime(summary: DashboardSummary, version: string): RuntimeInstallStatus | undefined {
  return summary.runtimes.php.find((runtime) => runtime.version === version) ?? summary.runtimes.php[0];
}

function selectedMysqlRuntime(summary: DashboardSummary, version: string): RuntimeInstallStatus | undefined {
  return summary.runtimes.mysql.find((runtime) => runtime.version === version) ?? summary.runtimes.mysql[0];
}

function databaseRuntimeDisplay(runtime?: RuntimeInstallStatus): string {
  return runtime ? `${databaseEngineName(runtime)} ${databaseVersionDisplay(runtime.version)}` : "Database";
}

function databaseEngineName(runtime?: RuntimeInstallStatus): string {
  return runtime?.name === "MariaDB" ? "MariaDB" : "MySQL";
}

function databaseEngineKey(runtime?: RuntimeInstallStatus): DatabaseEngine {
  return runtime?.name === "MariaDB" || runtime?.version.toLowerCase().startsWith("mariadb-") ? "mariadb" : "mysql";
}

function databaseRuntimesForEngine(runtimes: RuntimeInstallStatus[], engine: DatabaseEngine): RuntimeInstallStatus[] {
  return runtimes.filter((runtime) => databaseEngineKey(runtime) === engine);
}

function preferredDatabaseRuntime(runtimes: RuntimeInstallStatus[]): RuntimeInstallStatus | undefined {
  const installed = runtimes.filter((runtime) => runtime.installed);
  return preferredRuntime(installed.length ? installed : runtimes);
}

function databaseVersionDisplay(version: string): string {
  return version.toLowerCase().startsWith("mariadb-") ? version.slice("mariadb-".length) : version;
}

function preferredRuntime(items: RuntimeInstallStatus[]): RuntimeInstallStatus | undefined {
  return [...items].sort((left, right) => compareVersionStrings(right.version, left.version))[0];
}

function compareVersionStrings(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return left.localeCompare(right);
}

function versionParts(version: string): number[] {
  return version.match(/\d+/g)?.map((part) => Number(part)) ?? [];
}

function defaultSitesFolder(summary: DashboardSummary): string {
  const match = summary.paths.home.match(/^(.*)[\\/]\.config[\\/]laraboxs$/i);
  return `${match?.[1] ?? summary.paths.home}\\Sites`;
}

function pathTail(folder: string): string {
  const trimmed = folder.trim().replace(/[\\/]+$/g, "");
  return trimmed.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
}

function taskDefinitionsLabel(summary: DashboardSummary, phpVersion: string, mysqlVersion: string): string {
  const count = firstRunTaskDefinitions(summary, { phpVersion, mysqlVersion, sitesFolder: "" }).length;
  return `${count} automatic tasks`;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function Services({
  summary,
  post,
  request,
  installJobs,
  startRuntimeInstall,
  busy
}: ViewProps & {
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
  installJobs: RuntimeJobMap;
  startRuntimeInstall: (kind: RuntimeKind, version?: string, force?: boolean) => Promise<RuntimeInstallJob | undefined>;
}) {
  const [phpVersion, setPhpVersion] = useState(summary.config.globalPhpVersion);
  const [mysqlVersion, setMysqlVersion] = useState(summary.config.mysql.version);
  const [mysqlPort, setMysqlPort] = useState(String(summary.config.mysql.port));
  const [redisPort, setRedisPort] = useState(String(summary.config.redis.port));
  const [servicesPane, setServicesPane] = useState<ServicesPane>("mysql");
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
  const jobs = Object.values(installJobs);
  const phpRuntime = summary.runtimes.php.find((runtime) => runtime.version === phpVersion) ?? summary.runtimes.php[0];
  const mysqlRuntime = summary.runtimes.mysql.find((runtime) => runtime.version === mysqlVersion) ?? summary.runtimes.mysql[0];
  const activeMysqlRuntime = selectedMysqlRuntime(summary, summary.config.mysql.version);
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
  const showPhp = servicesPane === "php" || servicesPane === "all";
  const showNginx = servicesPane === "nginx" || servicesPane === "all";
  const showMysql = servicesPane === "mysql" || servicesPane === "all";
  const showRedis = servicesPane === "redis" || servicesPane === "all";
  const showPhpMyAdmin = servicesPane === "phpmyadmin" || servicesPane === "all";

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
    if (!window.confirm(`Reset ${activeDatabaseName} root password?`)) {
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
    setPhpSettingsSaving(true);
    try {
      await post("/api/php/settings", { settings: phpSettings });
    } finally {
      setPhpSettingsSaving(false);
    }
  }

  return (
    <div className="services-view">
      <div className="services-overview">
        <ServiceSnapshot icon={Play} label="Running" value={`${runningServices}/4`} detail="core services" tone={runningServices === 4 ? "green" : runningServices > 0 ? "amber" : "red"} />
        <ServiceSnapshot icon={SquareTerminal} label="PHP" value={summary.config.globalPhpVersion} detail={`${summary.runtimes.php.length} versions`} tone={summary.services.php.state === "running" ? "green" : "amber"} />
        <ServiceSnapshot icon={Database} label="Databases" value={summary.services.mysql.state} detail={`${activeDatabaseLabel} · Redis`} tone={summary.services.mysql.state === "running" ? "green" : "amber"} />
        <ServiceSnapshot icon={Server} label="Web Server" value={summary.services.nginx.state} detail={`HTTP ${summary.config.nginx.httpPort} / HTTPS ${summary.config.nginx.httpsPort}`} tone={summary.services.nginx.state === "running" ? "green" : "amber"} />
      </div>

      <div className="services-workbench">
        <aside className="services-list" aria-label="Service list">
          <ServiceNavButton icon={Database} label={activeDatabaseName} detail={`:${summary.config.mysql.port}`} service={summary.services.mysql} active={servicesPane === "mysql"} onClick={() => setServicesPane("mysql")} />
          <ServiceNavButton icon={Database} label="Redis" detail={`:${summary.config.redis.port}`} service={summary.services.redis} active={servicesPane === "redis"} onClick={() => setServicesPane("redis")} />
          <ServiceNavButton
            icon={Database}
            label="phpMyAdmin"
            detail={summary.phpMyAdmin.installed ? "Installed" : "Missing"}
            service={{
              name: "phpMyAdmin",
              state: summary.phpMyAdmin.installed ? "running" : "stopped",
              version: summary.phpMyAdmin.version
            }}
            active={servicesPane === "phpmyadmin"}
            onClick={() => setServicesPane("phpmyadmin")}
          />
          <ServiceNavButton icon={SquareTerminal} label="PHP" detail={summary.config.globalPhpVersion} service={summary.services.php} active={servicesPane === "php"} onClick={() => setServicesPane("php")} />
          <ServiceNavButton icon={Server} label="Nginx" detail={`:${summary.config.nginx.httpPort}`} service={summary.services.nginx} active={servicesPane === "nginx"} onClick={() => setServicesPane("nginx")} />
          <button className={servicesPane === "all" ? "service-nav-item active" : "service-nav-item"} onClick={() => setServicesPane("all")} title="All Services - full stack view">
            <ListRestart size={17} />
            <div>
              <strong>All Services</strong>
              <span>full stack view</span>
            </div>
            <span className="status-dot amber" title="overview" />
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
            <button className="primary" title="Use selected PHP" disabled={busy || !phpRuntime?.installed || phpVersion === summary.config.globalPhpVersion} onClick={() => void post("/api/php/use", { version: phpVersion })}>
              <BadgeCheck size={18} />
              <span>Use</span>
            </button>
            <button title="Start PHP" disabled={busy || summary.services.php.state === "running"} onClick={() => void post("/api/php-fcgi/start")}>
              <Play size={18} />
              <span>Start</span>
            </button>
            <button title="Stop PHP" disabled={busy} onClick={() => void post("/api/php-fcgi/stop")}>
              <CircleStop size={18} />
              <span>Stop</span>
            </button>
            <button title="Restart PHP" disabled={busy} onClick={() => void post("/api/php-fcgi/restart")}>
              <RotateCw size={18} />
              <span>Restart</span>
            </button>
          </div>
        </div>
        ) : null}

        {showPhp ? (
        <div className="service-panel wide-service-panel php-settings-service-panel">
          <ServiceHeader icon={Settings} title="PHP Settings" service={summary.services.php} detail={phpIniPath || `PHP ${phpVersion}`} />
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
            <button className="primary" title="Save PHP settings and restart" disabled={busy || phpSettingsSaving || phpSettingsLoading} onClick={() => void savePhpSettings()}>
              <BadgeCheck size={18} />
              <span>Save</span>
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
              <span className="muted">{phpSettingsLoading ? "Loading extensions..." : "No extensions found."}</span>
            )}
          </div>
          <div className="xdebug-panel" style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
            <label className="compact-toggle">
              <input
                type="checkbox"
                checked={phpSettings.xdebugEnabled}
                disabled={phpSettingsSaving || phpSettingsLoading}
                onChange={() => {
                  setPhpSettings((current) => ({ ...current, xdebugEnabled: !current.xdebugEnabled }));
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
            <button title="Start Nginx" disabled={busy || summary.services.nginx.state === "running"} onClick={() => void post("/api/nginx/start")}>
              <Play size={18} />
              <span>Start</span>
            </button>
            <button title="Stop Nginx" disabled={busy} onClick={() => void post("/api/nginx/stop")}>
              <CircleStop size={18} />
              <span>Stop</span>
            </button>
            <button title="Restart Nginx" disabled={busy} onClick={() => void post("/api/nginx/restart")}>
              <RotateCw size={18} />
              <span>Restart</span>
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
            <button className="primary" title={`Use selected ${selectedDatabaseName}`} disabled={busy || !mysqlRuntime?.installed || mysqlVersion === summary.config.mysql.version} onClick={() => void useMysqlVersion()}>
              <BadgeCheck size={18} />
              <span>Use</span>
            </button>
            <button title={`Initialize ${activeDatabaseName}`} disabled={busy} onClick={() => void post("/api/mysql/init")}>
              <BadgeCheck size={18} />
              <span>Initialize</span>
            </button>
            <button title={`Start ${activeDatabaseName}`} disabled={busy || summary.services.mysql.state === "running"} onClick={() => void post("/api/mysql/start")}>
              <Play size={18} />
              <span>Start</span>
            </button>
            <button title={`Stop ${activeDatabaseName}`} disabled={busy} onClick={() => void post("/api/mysql/stop")}>
              <CircleStop size={18} />
              <span>Stop</span>
            </button>
            <button title={`Restart ${activeDatabaseName}`} disabled={busy} onClick={() => void post("/api/mysql/restart")}>
              <RotateCw size={18} />
              <span>Restart</span>
            </button>
            <button title={`Open ${activeDatabaseName} shell`} disabled={busy} onClick={() => void post("/api/mysql/shell")}>
              <SquareTerminal size={18} />
              <span>Shell</span>
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
            <button title="Start Redis" disabled={busy || summary.services.redis.state === "running"} onClick={() => void post("/api/redis/start")}>
              <Play size={18} />
              <span>Start</span>
            </button>
            <button title="Stop Redis" disabled={busy} onClick={() => void post("/api/redis/stop")}>
              <CircleStop size={18} />
              <span>Stop</span>
            </button>
            <button title="Restart Redis" disabled={busy} onClick={() => void post("/api/redis/restart")}>
              <RotateCw size={18} />
              <span>Restart</span>
            </button>
            <button title="Open Redis CLI" disabled={busy} onClick={() => void post("/api/redis/shell")}>
              <SquareTerminal size={18} />
              <span>CLI</span>
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

function ServiceNavButton({
  icon: Icon,
  label,
  detail,
  service,
  active,
  onClick
}: {
  icon: typeof Globe;
  label: string;
  detail: string;
  service: ServiceStatus;
  active: boolean;
  onClick: () => void;
}) {
  const tone = service.state === "running" ? "green" : service.state === "stopped" ? "red" : "amber";
  return (
    <button className={active ? "service-nav-item active" : "service-nav-item"} onClick={onClick} title={`${label} - ${detail} - ${service.state}`}>
      <Icon size={17} />
      <div>
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <span className={`status-dot ${tone}`} title={service.state} />
    </button>
  );
}

function ServiceSnapshot({
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
  tone: "green" | "amber" | "red";
}) {
  return (
    <div className="service-snapshot" title={`${label}: ${value} - ${detail}`}>
      <Icon size={18} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      <span className={`status-dot ${tone}`} />
    </div>
  );
}

function ServiceHeader({ icon: Icon, title, service, detail }: { icon: typeof Globe; title: string; service: ServiceStatus; detail?: string }) {
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

function RuntimePicker({ runtimes, value, onChange }: { runtimes: RuntimeInstallStatus[]; value: string; onChange: (version: string) => void }) {
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

function DatabaseRuntimePicker({ runtimes, value, onChange }: { runtimes: RuntimeInstallStatus[]; value: string; onChange: (version: string) => void }) {
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

function Setup({
  summary,
  installJobs,
  startRuntimeInstall,
  removeRuntime,
  busy
}: {
  summary: DashboardSummary;
  installJobs: RuntimeJobMap;
  startRuntimeInstall: (kind: RuntimeKind, version?: string, force?: boolean) => Promise<RuntimeInstallJob | undefined>;
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
      <DatabaseRuntimePanel items={summary.runtimes.mysql} installJobs={installJobs} busy={busy} install={startRuntimeInstall} uninstall={removeRuntime} />
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
  install: (kind: RuntimeKind, version?: string, force?: boolean) => Promise<RuntimeInstallJob | undefined>;
  uninstall: (kind: RuntimeKind, version?: string) => Promise<void>;
}) {
  const jobs = Object.values(installJobs);

  async function removeInstalledRuntime(item: RuntimeInstallStatus) {
    const displayVersion = runtimeDisplayVersion(item);
    const warning =
      kind === "mysql"
        ? `Remove ${displayVersion}? This deletes the app-local ${item.name} runtime folder, including local database data. Stop the database first.`
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

function DatabaseRuntimePanel({
  items,
  installJobs,
  busy,
  install,
  uninstall
}: {
  items: RuntimeInstallStatus[];
  installJobs: RuntimeJobMap;
  busy: boolean;
  install: (kind: RuntimeKind, version?: string, force?: boolean) => Promise<RuntimeInstallJob | undefined>;
  uninstall: (kind: RuntimeKind, version?: string) => Promise<void>;
}) {
  const [version, setVersion] = useState(preferredDatabaseRuntime(items)?.version ?? items[0]?.version ?? "");
  const jobs = Object.values(installJobs);
  const selected = items.find((item) => item.version === version) ?? preferredDatabaseRuntime(items) ?? items[0];
  const job = selected ? latestRuntimeJob(jobs, "mysql", selected.version) : undefined;
  const activeJob = job ? isActiveRuntimeJob(job) : false;
  const showProgress = job ? activeJob || job.status === "failed" : false;

  useEffect(() => {
    if (items.length && !items.some((item) => item.version === version)) {
      setVersion(preferredDatabaseRuntime(items)?.version ?? items[0].version);
    }
  }, [items, version]);

  async function removeInstalledDatabase() {
    if (!selected) {
      return;
    }
    const displayVersion = runtimeDisplayVersion(selected);
    if (!window.confirm(`Remove ${displayVersion}? This deletes the app-local ${selected.name} runtime folder, including local database data. Stop the database first.`)) {
      return;
    }
    await uninstall("mysql", selected.version);
  }

  return (
    <div className="panel">
      <h2>Database</h2>
      <DatabaseRuntimePicker runtimes={items} value={selected?.version ?? version} onChange={setVersion} />
      {selected ? (
        <div className="runtime-row selected-runtime-row">
          <div className="runtime-row-main">
            <div className="runtime-version-info">
              <strong>{runtimeDisplayVersion(selected)}</strong>
              <span>{selected.installed ? (selected.updateAvailable ? "Update available" : "Installed") : runtimeStatusLabel(job)}</span>
            </div>
            <div className="runtime-actions">
              <button
                className={!selected.installed || selected.updateAvailable ? "primary" : ""}
                disabled={busy || (selected.installed && !selected.updateAvailable) || activeJob}
                onClick={() => void install("mysql", selected.version, Boolean(selected.updateAvailable))}
              >
                <Download size={18} />
                <span>{runtimeActionLabel(selected, job, `Install ${databaseRuntimeDisplay(selected)}`)}</span>
              </button>
              {selected.installed ? (
                <button className="danger-icon-button" disabled={busy || activeJob} onClick={() => void removeInstalledDatabase()} title={`Remove ${selected.name} ${runtimeDisplayVersion(selected)}`}>
                  <Trash2 size={18} />
                </button>
              ) : null}
            </div>
          </div>
          {showProgress ? <RuntimeProgress job={job!} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function Sites({ summary, post, request, busy }: ViewProps & { request: (path: string, body?: Record<string, unknown>) => Promise<unknown> }) {
  const [folder, setFolder] = useState(summary.config.parkedFolders[0] ?? "");
  const [selectedDomain, setSelectedDomain] = useState(summary.sites[0]?.domain ?? "");
  const [siteTab, setSiteTab] = useState<"general" | "information">("general");
  const [newSiteOpen, setNewSiteOpen] = useState(false);
  const [siteSearch, setSiteSearch] = useState("");
  const selectedSite = summary.sites.find((site) => site.domain === selectedDomain) ?? summary.sites[0];
  const [entryPath, setEntryPath] = useState(selectedSite?.entryPath ?? ".");
  const [sitePhpVersion, setSitePhpVersion] = useState(selectedSite?.phpVersion ?? summary.config.globalPhpVersion);

  const filteredSites = summary.sites.filter((site) => {
    const query = siteSearch.trim().toLowerCase();
    if (!query) return true;
    return (
      site.name.toLowerCase().includes(query) ||
      site.domain.toLowerCase().includes(query) ||
      site.path.toLowerCase().includes(query) ||
      site.framework.toLowerCase().includes(query)
    );
  });

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

  return (
    <>
      <div className="toolbar">
        <div className="path-picker">
          <input value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="C:\www" />
          <button type="button" className="field-icon-button" disabled={busy} onClick={() => void browseFolder()} title="Browse folder">
            <FolderOpen size={18} />
          </button>
        </div>
        <button className="primary" disabled={busy} onClick={() => setNewSiteOpen((open) => !open)} title="Create new site">
          <FolderPlus size={18} />
          <span>New Site</span>
        </button>
        <button disabled={busy || !folder.trim()} onClick={() => void post("/api/sites/park", { path: folder })}>
          <FolderOpen size={18} />
          <span>Park Folder</span>
        </button>
        <button disabled={busy} onClick={() => void post("/api/hosts/sync", {})}>
          <ListRestart size={18} />
          <span>Sync Hosts</span>
        </button>
      </div>
      <SslTrustPanel summary={summary} post={post} busy={busy} />
      {newSiteOpen ? (
        <div className="new-site-modal-backdrop" onMouseDown={(event) => event.currentTarget === event.target && setNewSiteOpen(false)}>
          <NewSitePanel
            summary={summary}
            request={request}
            busy={busy}
            defaultParent={folder || summary.config.parkedFolders[0] || defaultSitesFolder(summary)}
            onClose={() => setNewSiteOpen(false)}
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
              <div className="toolbar" style={{ width: "100%", flexWrap: "nowrap" }}>
                <Search size={14} style={{ color: "var(--muted)", flex: "0 0 auto" }} />
                <input
                  placeholder="Search sites..."
                  value={siteSearch}
                  onChange={(event) => setSiteSearch(event.target.value)}
                  style={{ flex: "1 1 auto", minWidth: 0 }}
                />
                <span style={{ color: "var(--muted)", fontSize: 12, flex: "0 0 auto" }}>{filteredSites.length}</span>
              </div>
            </div>
            <div className="sites-list">
              {filteredSites.map((site) => (
                <button key={site.domain} className={site.domain === selectedSite.domain ? "site-list-item active" : "site-list-item"} onClick={() => setSelectedDomain(site.domain)} title={`${site.domain} - ${site.framework}`}>
                  <span>{site.domain}</span>
                  <small>{site.framework}</small>
                </button>
              ))}
              {filteredSites.length === 0 && summary.sites.length > 0 ? (
                <div className="settings-empty-row" style={{ margin: 4 }}><span>No sites match search.</span></div>
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
                </div>
              </div>
              <button className={selectedSite.secured ? "" : "primary"} disabled={busy || (selectedSite.secured && !summary.ssl.trusted)} onClick={() => void post(selectedSite.secured ? "/api/ssl/unsecure" : "/api/ssl/secure", { site: selectedSite.domain })}>
                {selectedSite.secured ? <Lock size={18} /> : <LockOpen size={18} />}
                <span>{selectedSite.secured ? "Disable SSL" : "Enable SSL"}</span>
              </button>
            </div>

            <div className="site-detail-tabs">
              <button className={siteTab === "general" ? "active" : ""} onClick={() => setSiteTab("general")}>General</button>
              <button className={siteTab === "information" ? "active" : ""} onClick={() => setSiteTab("information")}>Information</button>
            </div>

            {siteTab === "general" ? (
              <div className="site-general-grid">
                <div className="site-preview-panel">
                  <SitePreviewImage site={selectedSite} />
                  <button className="primary" title="Open site" onClick={() => void openExternalUrl(selectedSite.url)}>
                    <ExternalLink size={18} />
                    <span>Open Site</span>
                  </button>
                </div>
                <div className="site-controls-panel">
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
                  <button disabled={busy || sitePhpVersion === selectedSite.phpVersion} onClick={() => void saveSelectedPhpVersion()}>
                    <BadgeCheck size={18} />
                    <span>Apply PHP</span>
                  </button>
                  <label>
                    <span>Nginx Entry</span>
                    <input value={entryPath} onChange={(event) => setEntryPath(event.target.value)} />
                  </label>
                  <div className="button-row">
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
    </>
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
          <>
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
              <label className="compact-toggle">
                <input type="checkbox" checked={git} onChange={(event) => setGit(event.target.checked)} />
                <span>Git</span>
              </label>
              <label className="compact-toggle">
                <input type="checkbox" checked={boost} onChange={(event) => setBoost(event.target.checked)} />
                <span>Boost</span>
              </label>
            </div>
          </>
        ) : null}
      </div>

      {panelError || (requirementsMessage && preset === "laravel") ? (
        <div className={panelError ? "new-site-message error" : "new-site-message"}>{panelError ?? requirementsMessage}</div>
      ) : null}

      {creationJob ? <SiteCreationProgressPanel job={creationJob} /> : null}

      <div className="new-site-actions">
        <button className="primary" disabled={working || !canCreate} onClick={() => void createSite()} title="Create site">
          {creating ? <LoaderCircle className="spin" size={18} /> : <PackageCheck size={18} />}
          <span>{creating ? "Creating" : "Create"}</span>
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

  function openSite(site: Site) {
    void openExternalUrl(site.url);
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
                    <button type="button" className="link-button" disabled={busy} onClick={() => openSite(site)} title={`Open ${site.url}`}>
                      {site.url}
                      <ExternalLink size={14} />
                    </button>
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
  startRuntimeInstall: (kind: RuntimeKind, version?: string, force?: boolean) => Promise<RuntimeInstallJob | undefined>;
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
        const payload = await getJson<PhpSettingsStatus>(`/api/php/settings?version=${encodeURIComponent(version)}`);
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
  startRuntimeInstall: (kind: RuntimeKind, version?: string, force?: boolean) => Promise<RuntimeInstallJob | undefined>;
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
  const activeDatabaseName = databaseEngineName(activeRuntime);
  const activeDatabaseLabel = databaseRuntimeDisplay(activeRuntime);
  const selectedDatabaseLabel = databaseRuntimeDisplay(selectedRuntime);
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
    if (!window.confirm(`Reset ${activeDatabaseName} root password?`)) {
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
            <span>{runtimeActionLabel(selectedRuntime, installJob, `Install ${selectedDatabaseLabel}`)}</span>
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
        <DatabaseRuntimePicker runtimes={summary.runtimes.mysql} value={selectedVersion} onChange={setSelectedVersion} />
        <div className="button-row">
          <button disabled={busy || !selectedRuntime?.installed || selectedVersion === summary.config.mysql.version || mysql.state === "running"} onClick={() => void post("/api/mysql/version", { version: selectedVersion })}>
            <BadgeCheck size={18} />
            <span>Use Version</span>
          </button>
        </div>
        <dl className="details">
          <dt>Active</dt>
          <dd>{activeDatabaseLabel}</dd>
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
            <button className="link-command-button" disabled={busy || !summary.phpMyAdmin.installed} onClick={() => void openExternalUrl(summary.phpMyAdmin.url)}>
              <ExternalLink size={16} />
              <span>Open</span>
            </button>
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
          <dd>{activeDatabaseLabel}</dd>
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
  startRuntimeInstall: (kind: RuntimeKind, version?: string, force?: boolean) => Promise<RuntimeInstallJob | undefined>;
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

function Logs({ summary, post, busy }: ViewProps) {
  const [copied, setCopied] = useState(false);
  const logText = summary.logs.join("\n");
  const displayText = logText || "No log entries yet.";
  const modelText = [
    "Laraboxs diagnostic log",
    `Generated: ${new Date().toISOString()}`,
    "",
    "```text",
    displayText,
    "```"
  ].join("\n");

  async function copyLogs() {
    await copyTextToClipboard(modelText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  async function clearAllLogs() {
    if (!window.confirm("Clear all Laraboxs logs?")) {
      return;
    }
    await post("/api/logs/clear");
  }

  return (
    <div className="logs-view">
      <div className="logs-toolbar">
        <div className="logs-meta">
          <strong>Runtime Logs</strong>
          <span>{summary.logs.length ? `${summary.logs.length} lines` : "empty"}</span>
        </div>
        <div className="logs-actions">
          <button disabled={busy} onClick={() => void copyLogs()} title="Copy logs for any model">
            <Clipboard size={18} />
            <span>{copied ? "Copied" : "Copy for Model"}</span>
          </button>
          <button className="danger-log-button" disabled={busy || summary.logs.length === 0} onClick={() => void clearAllLogs()} title="Clear all logs">
            <Trash2 size={18} />
            <span>Clear Logs</span>
          </button>
        </div>
      </div>
      <pre className="logs">{displayText}</pre>
    </div>
  );
}

function SettingsView({
  summary,
  post,
  request,
  busy
}: ViewProps & {
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
}) {
  const [tld, setTld] = useState(summary.config.tld);
  const [folder, setFolder] = useState(summary.config.parkedFolders[0] ?? "");
  const [phpChoice, setPhpChoice] = useState(summary.config.globalPhpVersion);
  const [databaseChoice, setDatabaseChoice] = useState(summary.config.mysql.version);
  const [copiedPath, setCopiedPath] = useState("");
  const [hostsPreview, setHostsPreview] = useState("");
  const [installerStatus, setInstallerStatus] = useState<LaravelInstallerStatus | null>(null);
  const [installerBusy, setInstallerBusy] = useState(false);

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
  const pathRows = [
    { label: "Config", value: summary.paths.configFile, icon: FileText, reveal: true },
    { label: "Hosts", value: summary.paths.hostsFile, icon: Network, reveal: true },
    { label: "App data", value: summary.paths.home, icon: HardDrive },
    { label: "Logs", value: summary.paths.logs, icon: FileText },
    { label: "Nginx config", value: summary.paths.nginxConfig, icon: Server, reveal: true },
    { label: "Nginx sites", value: summary.paths.nginxSites, icon: FolderOpen },
    { label: "Database data", value: summary.paths.mysqlData, icon: Database },
    { label: "CA certificate", value: summary.ssl.certPath, icon: ShieldCheck, reveal: true }
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
    if (!window.confirm("Remove Laravel Installer?")) {
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
      <div className="settings-overview">
        <SettingsStat icon={Globe} label="Local TLD" value={`.${summary.config.tld}`} />
        <SettingsStat icon={FolderOpen} label="Parked" value={`${summary.config.parkedFolders.length} folders`} />
        <SettingsStat icon={ShieldCheck} label="SSL CA" value={summary.ssl.trusted ? "Trusted" : "Untrusted"} tone={summary.ssl.trusted ? "green" : "amber"} />
        <SettingsStat icon={SquareTerminal} label="PHP" value={summary.config.globalPhpVersion} />
      </div>

      <HealthCheckPanel summary={summary} post={post} busy={busy} />

      <div className="settings-layout">
        <section className="settings-panel">
          <SettingsPanelHeader icon={SlidersHorizontal} title="General" detail="Local names and default runtimes" />
          <div className="settings-form-grid">
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

        <section className="settings-panel">
          <SettingsPanelHeader icon={FolderPlus} title="Sites Folders" detail={`${summary.sites.length} discovered sites`} />
          <div className="inline-form compact-folder-form">
            <div className="path-picker">
              <input value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="C:\www" />
              <button type="button" className="field-icon-button" disabled={busy} onClick={() => void browseFolder()} title="Browse folder">
                <FolderOpen size={16} />
              </button>
            </div>
            <button className="primary" disabled={busy || !folder.trim()} onClick={() => void post("/api/sites/park", { path: folder })} title="Park folder">
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

        <section className="settings-panel">
          <SettingsPanelHeader icon={Shield} title="Hosts & SSL" detail={summary.ssl.store ?? summary.ssl.message ?? summary.paths.hostsFile} />
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
              <button className={!summary.ssl.trusted ? "primary" : ""} disabled={busy || summary.ssl.trusted || summary.ssl.platform !== "win32"} onClick={() => void post("/api/ssl/trust")} title="Trust CA">
                <Lock size={16} />
              </button>
            </div>
          </div>
          {hostsPreview ? <pre className="settings-hosts-preview">{hostsPreview}</pre> : null}
        </section>

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

        <section className="settings-panel">
          <SettingsPanelHeader icon={HardDrive} title="Files" detail="Open or copy app paths" />
          <div className="settings-path-list dense">
            {pathRows.map((item) => (
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
        </section>

        <section className="settings-panel wide-settings-panel">
          <SettingsPanelHeader icon={Shield} title="Windows Defender" detail="Add exclusions to avoid scanning app data" />
          <div className="settings-action-grid">
            <DefenderExclusionTile
              label="Sites folder"
              path={summary.config.parkedFolders[0] ?? ""}
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
      </div>
    </div>
  );
}

function DefenderExclusionTile({ label, path, onAdd }: { label: string; path: string; onAdd: () => void }) {
  return (
    <div className="settings-action-tile">
      <Shield size={18} />
      <div>
        <strong>{label}</strong>
        <span>{path}</span>
      </div>
      <button onClick={() => void onAdd()} disabled={!path}>
        <ShieldCheck size={16} />
      </button>
    </div>
  );
}

function SettingsStat({
  icon: Icon,
  label,
  value,
  tone = "default"
}: {
  icon: typeof Globe;
  label: string;
  value: string;
  tone?: "default" | "green" | "amber";
}) {
  return (
    <div className={`settings-stat ${tone}`}>
      <Icon size={18} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function laravelInstallerBadge(status: LaravelInstallerStatus | null): { label: string; tone: "green" | "amber" | "red" } {
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

function laravelInstallerDetail(status: LaravelInstallerStatus | null): { title: string; subtitle: string } {
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

function SettingsPanelHeader({ icon: Icon, title, detail }: { icon: typeof Globe; title: string; detail: string }) {
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

function SettingsPathRow({
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

function normalizeLocalTld(value: string): string {
  return value.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

function isValidLocalTld(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value);
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
  if (item.name === "MySQL" || item.name === "MariaDB") {
    return databaseRuntimeDisplay(item);
  }
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
