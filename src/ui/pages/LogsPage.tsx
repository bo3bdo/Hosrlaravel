import { useState } from "react";
import {
  Activity,
  CircleAlert,
  Clipboard,
  FileText,
  Search,
  Trash2,
  X
} from "lucide-react";
import { copyTextToClipboard } from "../apiClient.js";
import { useDesktopConfirm } from "../shared/context.js";
import { makeT } from "../i18n.js";
import { Badge } from "../shared/components.js";
import type { LogSeverity } from "../shared/types.js";
import type { ViewProps } from "../shared/types.js";
import { logService, logSeverity } from "../shared/utils.js";

export function LogsPage({ summary, post, busy, language }: ViewProps) {
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState<"all" | LogSeverity>("all");
  const [latestFirst, setLatestFirst] = useState(false);
  const confirm = useDesktopConfirm();
  const t = makeT(language);
  const services = Array.from(new Set(summary.logs.map(logService))).sort();
  const filteredLogs = summary.logs.filter((line) => {
    const normalizedQuery = query.trim().toLowerCase();
    const matchesQuery = !normalizedQuery || line.toLowerCase().includes(normalizedQuery);
    const matchesService = serviceFilter === "all" || logService(line) === serviceFilter;
    const matchesSeverity = severityFilter === "all" || logSeverity(line) === severityFilter;
    return matchesQuery && matchesService && matchesSeverity;
  });
  const visibleLogs = latestFirst ? [...filteredLogs].reverse() : filteredLogs;
  const errorLineCount = summary.logs.filter((line) => logSeverity(line) === "error").length;
  const warningLineCount = summary.logs.filter((line) => logSeverity(line) === "warning").length;
  const displayText = visibleLogs.join("\n") || t("logs.noEntriesMatch");
  const insightText = summary.logInsights.groups.length
    ? summary.logInsights.groups
        .map((group) => `- [${group.severity}] ${group.service} x${group.count}: ${group.message}${group.action ? `\n  ${t("logs.action")}: ${group.action}` : ""}`)
        .join("\n")
    : t("logs.noGroupedWarnings");
  const modelText = [
    "Laraboxs diagnostic log",
    `Generated: ${new Date().toISOString()}`,
    `Grouped issues: ${summary.logInsights.groups.length}, warning lines=${summary.logInsights.warningLines}, error lines=${summary.logInsights.errorLines}`,
    `Filters: service=${serviceFilter}, severity=${severityFilter}, query=${query.trim() || "none"}`,
    "",
    "Insights:",
    insightText,
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
    const confirmed = await confirm({
      title: t("logs.clearAllTitle"),
      message: t("logs.clearAllMessage"),
      details: [t("logs.clearAllDetails")],
      confirmLabel: t("logs.clearConfirm"),
      tone: "warning"
    });
    if (!confirmed) {
      return;
    }
    await post("/api/logs/clear");
  }

  return (
    <div className="logs-view">
      <div className="logs-diagnostics-column">
      <div className="logs-summary-strip">
        <button
          className={severityFilter === "all" && serviceFilter === "all" && !query.trim() ? "logs-summary-card active" : "logs-summary-card"}
          onClick={() => {
            setSeverityFilter("all");
            setServiceFilter("all");
            setQuery("");
          }}
          title={t("logs.showAll")}
        >
          <FileText size={16} />
          <span>{t("logs.totalLines")}</span>
          <strong>{summary.logs.length}</strong>
        </button>
        <button
          className={`${errorLineCount ? "logs-summary-card red" : "logs-summary-card"} ${severityFilter === "error" ? "active" : ""}`}
          onClick={() => setSeverityFilter("error")}
          title={t("logs.showErrors")}
        >
          <CircleAlert size={16} />
          <span>{t("logs.errors")}</span>
          <strong>{errorLineCount}</strong>
        </button>
        <button
          className={`${warningLineCount ? "logs-summary-card amber" : "logs-summary-card"} ${severityFilter === "warning" ? "active" : ""}`}
          onClick={() => setSeverityFilter("warning")}
          title={t("logs.showWarnings")}
        >
          <CircleAlert size={16} />
          <span>{t("logs.warnings")}</span>
          <strong>{warningLineCount}</strong>
        </button>
        <button
          className={query.trim() || serviceFilter !== "all" || severityFilter !== "all" ? "logs-summary-card green active" : "logs-summary-card green"}
          onClick={() => setLatestFirst((current) => !current)}
          title={t("logs.toggleLatestFirst")}
        >
          <Search size={16} />
          <span>{t("logs.filtered")}</span>
          <strong>{visibleLogs.length}</strong>
        </button>
      </div>

      <section className="log-insights-panel">
        <div className="settings-panel-header">
          <Activity size={18} />
          <div>
            <strong>{t("logs.groupedDiagnostics")}</strong>
            <span>
              {summary.logInsights.groups.length
                ? t("logs.issuesFromLines")
                    .replace("{groups}", String(summary.logInsights.groups.length))
                    .replace("{lines}", String(summary.logInsights.warningLines + summary.logInsights.errorLines))
                : t("logs.noWarningsDetected")}
            </span>
          </div>
        </div>
        <div className="log-insight-grid">
          {summary.logInsights.groups.slice(0, 6).map((group) => (
            <div key={group.id} className={`log-insight-card ${group.severity}`}>
              <CircleAlert size={18} />
              <div>
                <div className="log-insight-title">
                  <strong>{group.service}</strong>
                  <Badge label={`x${group.count}`} tone={group.severity === "error" ? "red" : "amber"} />
                </div>
                <p>{group.message}</p>
                {group.action ? <small>{group.action}</small> : null}
              </div>
            </div>
          ))}
          {!summary.logInsights.groups.length ? <div className="settings-empty-row">The latest logs look clean.</div> : null}
        </div>
      </section>
      </div>

      <div className="logs-runtime-column">
      <div className="logs-toolbar">
        <div className="logs-meta">
          <strong>Runtime Logs</strong>
          <span>{summary.logs.length ? `${visibleLogs.length}/${summary.logs.length} lines` : "empty"}</span>
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
      <div className="logs-filterbar">
        <div className="logs-search">
          <Search size={14} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search logs..." />
        </div>
        <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as "all" | LogSeverity)}>
          <option value="all">All severity</option>
          <option value="error">Errors</option>
          <option value="warning">Warnings</option>
          <option value="info">Info</option>
        </select>
        <label className="compact-toggle logs-toggle">
          <input type="checkbox" checked={latestFirst} onChange={(event) => setLatestFirst(event.target.checked)} />
          <span>Latest first</span>
        </label>
        <button
          className="logs-clear-filters"
          disabled={!query.trim() && serviceFilter === "all" && severityFilter === "all" && !latestFirst}
          onClick={() => {
            setQuery("");
            setServiceFilter("all");
            setSeverityFilter("all");
            setLatestFirst(false);
          }}
          title="Clear log filters"
        >
          <X size={14} />
          <span>Clear</span>
        </button>
      </div>
      <div className="logs-service-chips" aria-label="Log service quick filters">
        <button className={serviceFilter === "all" ? "active" : ""} onClick={() => setServiceFilter("all")}>
          All
        </button>
        {services.slice(0, 8).map((service) => (
          <button key={service} className={serviceFilter === service ? "active" : ""} onClick={() => setServiceFilter(service)}>
            {service}
          </button>
        ))}
      </div>
      <div className="logs" role="log" aria-label="Filtered runtime logs">
        {visibleLogs.length ? (
          visibleLogs.map((line, index) => (
            <div key={`${line}-${index}`} className={`log-line ${logSeverity(line)}`}>
              <span>{logService(line)}</span>
              <p>{line}</p>
            </div>
          ))
        ) : (
          <div className="log-line info">
            <span>logs</span>
            <p>{displayText}</p>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
