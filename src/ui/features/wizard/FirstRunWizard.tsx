import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  Database,
  Download,
  FolderOpen,
  ListRestart,
  LoaderCircle,
  PackageCheck,
  RotateCw,
  Server,
  SlidersHorizontal,
  SquareTerminal
} from "lucide-react";
import { fetchRuntimeInstallJob } from "../../apiClient.js";
import { t } from "../../i18n.js";
import {
  Badge,
  DatabaseRuntimePicker,
  RuntimeProgress,
  StackPreviewItem,
  WizardTaskRow
} from "../../shared/components.js";
import type {
  AppLanguage,
  DashboardSummary,
  RuntimeInstallJob,
  RuntimeInstallStatus,
  RuntimeKind,
  WizardStepId,
  WizardTaskState,
  WizardTaskStatus
} from "../../shared/types.js";
import type { RuntimeJobMap } from "../../shared/types.js";
import {
  databaseRuntimeDisplay,
  defaultSitesFolder,
  firstRunTaskDefinitions,
  isActiveRuntimeJob,
  pathTail,
  preferredDatabaseRuntime,
  preferredRuntime,
  runActionWizardTask,
  runRuntimeWizardTask,
  selectedMysqlRuntime,
  selectedRuntimeStatus,
  sleep,
  statusLabel,
  taskDefinitionsLabel
} from "../../shared/utils.js";

export function FirstRunWizard({
  summary,
  installJobs,
  startRuntimeInstall,
  request,
  refresh,
  busy,
  error,
  language,
  onFinish
}: {
  summary: DashboardSummary;
  installJobs: RuntimeJobMap;
  startRuntimeInstall: (kind: RuntimeKind, version?: string, force?: boolean) => Promise<RuntimeInstallJob | undefined>;
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
  refresh: () => Promise<void>;
  busy: boolean;
  error: string | null;
  language: AppLanguage;
  onFinish: () => void;
}) {
  const [step, setStep] = useState<WizardStepId>("install");
  const [sitesFolder, setSitesFolder] = useState(summary.config.parkedFolders[0] ?? defaultSitesFolder(summary));
  const [taskStates, setTaskStates] = useState<Record<string, WizardTaskState>>({});
  const [running, setRunning] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [wizardWarning, setWizardWarning] = useState<string | null>(null);
  const [showTimeline, setShowTimeline] = useState(false);
  const [mysqlVersion, setMysqlVersion] = useState(() => {
    // Prefer the configured version if it's installed; otherwise prefer MariaDB
    // (it bundles its own VC++ DLLs on Windows, so it initializes reliably even
    // when the system Visual C++ Redistributable is missing/incomplete).
    const configured = summary.config.mysql.version;
    const configuredInstalled = selectedMysqlRuntime(summary, configured)?.installed;
    if (configuredInstalled) {
      return configured;
    }
    const preferred = preferredDatabaseRuntime(summary.runtimes.mysql);
    return preferred?.version ?? configured;
  });
  const startedRef = useRef(false);

  const phpRuntime = preferredRuntime(summary.runtimes.php);
  const mysqlRuntime = selectedMysqlRuntime(summary, mysqlVersion) ?? selectedMysqlRuntime(summary, summary.config.mysql.version) ?? summary.runtimes.mysql[0];
  const phpVersion = phpRuntime?.version ?? summary.config.globalPhpVersion;
  const selectedDatabaseLabel = databaseRuntimeDisplay(mysqlRuntime);
  const mysqlVersionsKey = summary.runtimes.mysql.map((runtime) => runtime.version).join("|");
  const canStart = sitesFolder.trim().length > 0;
  const steps: Array<{ id: WizardStepId; label: string; detail: string }> = [
    { id: "folder", label: t("wizard.step.sites", language), detail: pathTail(sitesFolder) || t("wizard.step.chooseFolder", language) },
    { id: "install", label: t("wizard.step.stack", language), detail: running ? t("wizard.step.installing", language) : `${taskDefinitionsLabel(summary, phpVersion, mysqlVersion)}` },
    { id: "finish", label: t("wizard.step.ready", language), detail: t("wizard.step.openWorkspace", language) }
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
  const completedTaskCount = taskDefinitions.filter((task) => taskStates[task.id]?.status === "complete").length;
  const activeTaskIndex = Math.max(
    0,
    taskDefinitions.findIndex((task) => (taskStates[task.id]?.status ?? "pending") !== "complete")
  );
  const compactTaskLimit = 6;
  const visibleTaskDefinitions = showTimeline
    ? taskDefinitions
    : taskDefinitions.filter((task, index) => {
        const status = taskStates[task.id]?.status ?? "pending";
        if (status === "complete") {
          return false;
        }
        if (status === "running" || status === "failed") {
          return true;
        }
        return index >= activeTaskIndex && index < activeTaskIndex + compactTaskLimit;
      });
  const hiddenTaskCount = taskDefinitions.length - visibleTaskDefinitions.length;

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
      setWizardError(t("wizard.chooseFolderFirst", language));
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
                  await request("/api/sites/park", { path: sitesFolder.trim(), primary: true });
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
                case "laravel-installer":
                  await request("/api/laravel-installer/install");
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
                case "ca-trust":
                  await request("/api/ssl/trust", { wait: true });
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

  // Auto-start setup on first mount so the user never has to click anything.
  // Defaults: <home>\Sites folder, highest PHP, configured database, all services + Redis + CA trust + hosts.
  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    if (setupFinished || summary.config.setupComplete) {
      setStep("finish");
      return;
    }
    startedRef.current = true;
    void runSetup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-open the workspace shortly after setup completes (no click required).
  useEffect(() => {
    if (!setupFinished || running) {
      return;
    }
    const timer = window.setTimeout(() => onFinish(), 1300);
    return () => window.clearTimeout(timer);
  }, [setupFinished, running, onFinish]);

  return (
    <div className="wizard-shell">
      <aside className="wizard-rail">
        <div className="brand">
          <div className="brand-mark">L</div>
          <div>
            <strong>laraboxs</strong>
            <span>{t("wizard.firstLaunch", language)}</span>
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
            <span className="eyebrow">{t("wizard.localStack", language)}</span>
            <h1>{step === "finish" ? t("wizard.ready", language) : t("wizard.setUp", language)}</h1>
          </div>
          <button className="icon-button" onClick={() => void refresh()} disabled={busy || running} title={t("action.refresh", language)}>
            <RotateCw size={18} />
            <span>{t("action.refresh", language)}</span>
          </button>
        </header>

        {error || wizardError || wizardWarning ? <div className="notice wizard-notice">{wizardError ?? error ?? wizardWarning}</div> : null}

        <section className="wizard-content">
          {step === "folder" ? (
            <div className="wizard-page wizard-folder-page">
              <div className="wizard-copy">
                <span className="eyebrow">{t("wizard.sitesFolderEyebrow", language)}</span>
                <h2>{t("wizard.chooseSites", language)}</h2>
                <p>{t("wizard.parkHint", language)}</p>
              </div>
              <div className="wizard-folder-card">
                <label>
                  <span>{t("wizard.sitesFolderLabel", language)}</span>
                  <div className="path-picker">
                    <input value={sitesFolder} onChange={(event) => setSitesFolder(event.target.value)} />
                    <button type="button" className="field-icon-button" disabled={busy || running} onClick={() => void browseFolder()} title={t("wizard.browse", language)}>
                      <FolderOpen size={18} />
                    </button>
                  </div>
                </label>
                <div className="button-row">
                  <button disabled={busy || running} onClick={() => setSitesFolder(defaultSitesFolder(summary))}>
                    <RotateCw size={18} />
                    <span>{t("wizard.useDefault", language)}</span>
                  </button>
                </div>
              </div>

              <div className="wizard-stack-preview">
                <StackPreviewItem icon={SquareTerminal} title={`PHP ${phpVersion}`} runtime={phpRuntime} />
                <StackPreviewItem icon={Database} title={selectedDatabaseLabel} runtime={mysqlRuntime} />
                <StackPreviewItem icon={Server} title={`Nginx ${summary.runtimes.nginx.version}`} runtime={summary.runtimes.nginx} />
                <StackPreviewItem icon={Database} title={`Redis ${summary.runtimes.redis.version}`} runtime={summary.runtimes.redis} />
                <StackPreviewItem icon={PackageCheck} title="Composer stable" runtime={summary.runtimes.composer} />
                <StackPreviewItem icon={SquareTerminal} title={`Node.js ${summary.runtimes.node.version}`} runtime={summary.runtimes.node} />
              </div>
              <div className="wizard-runtime-choice">
                <span className="eyebrow">{t("wizard.database", language)}</span>
                <DatabaseRuntimePicker runtimes={summary.runtimes.mysql} value={mysqlVersion} onChange={setMysqlVersion} />
              </div>
            </div>
          ) : null}

          {step === "install" ? (
            <div className="wizard-page wizard-install-page">
              <div className="wizard-install-header">
                <div className="wizard-copy">
                  <span className="eyebrow">{t("wizard.settingUp", language)}</span>
                  <h2>{t("wizard.preparingStack", language)}</h2>
                </div>
                <div className="wizard-progress-summary">
                  <strong>{setupPercent}%</strong>
                  <span>
                    {resolvedCount}/{taskDefinitions.length} {t("wizard.complete", language)}
                  </span>
                  <button
                    className="field-icon-button"
                    disabled={running}
                    onClick={() => setStep("folder")}
                    title={t("wizard.customizeHint", language)}
                  >
                    <SlidersHorizontal size={16} />
                    <span>{t("wizard.customize", language)}</span>
                  </button>
                </div>
              </div>
              <div className="progress-track wizard-overall-progress">
                <div className="progress-fill" style={{ width: `${setupPercent}%` }} />
              </div>
              <div className="wizard-task-toolbar">
                <span>
                  {showTimeline
                    ? `Showing full timeline (${taskDefinitions.length} steps)`
                    : completedTaskCount
                      ? `${completedTaskCount} completed hidden; showing current steps`
                      : "Showing current setup steps"}
                </span>
                <button type="button" onClick={() => setShowTimeline((value) => !value)} title={showTimeline ? "Hide completed timeline" : "Show full timeline"}>
                  <ListRestart size={16} />
                  <span>{showTimeline ? "Hide Timeline" : "Show Timeline"}</span>
                </button>
              </div>
              <div className={["wizard-task-list", showTimeline ? "timeline" : "compact"].join(" ")}>
                {visibleTaskDefinitions.map((task) => (
                  <WizardTaskRow key={task.id} task={task} state={taskStates[task.id]} installJobs={installJobs} />
                ))}
                {!showTimeline && hiddenTaskCount > 0 ? (
                  <button type="button" className="wizard-hidden-tasks" onClick={() => setShowTimeline(true)}>
                    <ListRestart size={16} />
                    <span>{hiddenTaskCount} more steps in timeline</span>
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {step === "finish" ? (
            <div className="wizard-page wizard-finish">
              <CheckCircle2 size={46} />
              <div>
                <span className="eyebrow">{t("wizard.completeEyebrow", language)}</span>
                <h2>{t("wizard.stackReady", language)}</h2>
                <p>{pathTail(sitesFolder) || t("wizard.sitesFolderLabel", language)} {t("wizard.parkedWith", language)} PHP {phpVersion}, Nginx, {selectedDatabaseLabel}, Composer, Node.js.</p>
              </div>
            </div>
          ) : null}
        </section>

        <footer className="wizard-footer">
          <button disabled={running || step === "folder"} onClick={() => setStep(steps[Math.max(0, activeStepIndex - 1)].id)}>
            <ChevronLeft size={18} />
            <span>{t("wizard.back", language)}</span>
          </button>
          {step === "folder" ? (
            <button className="primary" disabled={running || busy || !canStart} onClick={() => void runSetup()}>
              <Download size={18} />
              <span>{t("wizard.continue", language)}</span>
            </button>
          ) : null}
          {step === "install" ? (
            <button className="primary" disabled={running || busy || setupFinished} onClick={() => void runSetup()}>
              {running ? <LoaderCircle className="spin" size={18} /> : <PackageCheck size={18} />}
              <span>{running ? t("wizard.preparing", language) : wizardError ? t("wizard.retrySetup", language) : setupFinished ? t("wizard.completeEyebrow", language) : t("wizard.startSetup", language)}</span>
            </button>
          ) : null}
          {step === "finish" ? (
            <button className="primary" disabled={!setupFinished && !summary.config.setupComplete} onClick={onFinish}>
              <CheckCircle2 size={18} />
              <span>{t("wizard.openLaraboxs", language)}</span>
            </button>
          ) : null}
        </footer>
      </main>
    </div>
  );
}
