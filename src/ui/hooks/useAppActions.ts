import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { postJson, fetchRuntimeInstallJob } from "../apiClient.js";
import type { RuntimeInstallJob, RuntimeKind, UpdateCenterStatus } from "../types.js";
import { getJsonWithTimeout } from "../shared/utils.js";
import { summaryQueryKey } from "./useSummary.js";

export function useAppActions(addToast: (message: string, tone: "error" | "info" | "success") => void) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateCenterStatus | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: summaryQueryKey });
  }, [queryClient]);

  const request = useCallback(
    async (path: string, body: Record<string, unknown> = {}) => {
      setBusy(true);
      try {
        const payload = await postJson<unknown>(path, body);
        await refresh();
        setError(null);
        return payload;
      } catch (requestError) {
        const message = requestError instanceof Error ? requestError.message : String(requestError);
        setError(`Action failed: ${message}`);
        addToast(message, "error");
        throw requestError;
      } finally {
        setBusy(false);
      }
    },
    [addToast, refresh]
  );

  const post = useCallback(
    async (path: string, body: Record<string, unknown> = {}) => {
      await request(path, body);
    },
    [request]
  );

  const startRuntimeInstall = useCallback(
    async (kind: RuntimeKind, version?: string, force = false): Promise<RuntimeInstallJob | undefined> => {
      try {
        const payload = await postJson<{ job: RuntimeInstallJob }>("/api/runtimes/install", { kind, version, force });
        setError(null);
        return payload.job;
      } catch (requestError) {
        const message = requestError instanceof Error ? requestError.message : String(requestError);
        setError(`Action failed: ${message}`);
        addToast(message, "error");
        return undefined;
      }
    },
    [addToast]
  );

  const checkForUpdates = useCallback(async () => {
    setUpdateChecking(true);
    try {
      const status = await getJsonWithTimeout<UpdateCenterStatus>("/api/updates", 7000);
      setUpdateStatus(status);
      if (status.application.updateAvailable) {
        addToast(`Laraboxs ${status.application.latestVersion} is available.`, "info");
      }
    } catch {
      setUpdateStatus(null);
    } finally {
      setUpdateChecking(false);
    }
  }, [addToast]);

  return {
    busy,
    error,
    setError,
    updateStatus,
    updateChecking,
    refresh,
    request,
    post,
    startRuntimeInstall,
    checkForUpdates,
    fetchRuntimeInstallJob
  };
}
