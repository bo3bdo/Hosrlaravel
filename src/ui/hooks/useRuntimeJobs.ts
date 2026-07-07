import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchRuntimeInstallJob } from "../apiClient.js";
import type { RuntimeInstallJob, RuntimeKind } from "../types.js";
import type { RuntimeJobMap } from "../shared/types.js";
import { isActiveRuntimeJob } from "../shared/utils.js";
import { summaryQueryKey } from "./useSummary.js";

export function useRuntimeJobs() {
  const queryClient = useQueryClient();
  const [installJobs, setInstallJobs] = useState<RuntimeJobMap>({});

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
          void queryClient.invalidateQueries({ queryKey: summaryQueryKey });
        }
      } catch {
        // Polling errors are surfaced by the summary query.
      }
    }

    void pollJobs();
    const timer = window.setInterval(() => void pollJobs(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeJobKey, queryClient]);

  function trackJob(job: RuntimeInstallJob) {
    setInstallJobs((current) => ({ ...current, [job.id]: job }));
  }

  function clearJobsForKind(kind: RuntimeKind, version?: string) {
    setInstallJobs((current) => {
      const next = { ...current };
      for (const [id, job] of Object.entries(next)) {
        if (job.kind === kind && (!version || job.version === version)) {
          delete next[id];
        }
      }
      return next;
    });
  }

  return { installJobs, trackJob, clearJobsForKind };
}
