import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiUrl } from "../apiClient.js";
import type { DashboardSummary } from "../types.js";

export const summaryQueryKey = ["summary"] as const;

async function fetchSummary(): Promise<DashboardSummary> {
  const response = await fetch(apiUrl("/api/summary"));
  if (!response.ok) {
    throw new Error(`Summary request failed (${response.status}).`);
  }
  return (await response.json()) as DashboardSummary;
}

export function useSummary() {
  const queryClient = useQueryClient();
  const eventSourceRef = useRef<EventSource | null>(null);

  const query = useQuery({
    queryKey: summaryQueryKey,
    queryFn: fetchSummary,
    retry: 2,
    refetchOnWindowFocus: true,
    staleTime: 1500
  });

  useEffect(() => {
    const source = new EventSource(apiUrl("/api/events"));
    eventSourceRef.current = source;

    source.addEventListener("summary", (event) => {
      try {
        const summary = JSON.parse(event.data) as DashboardSummary;
        queryClient.setQueryData(summaryQueryKey, summary);
      } catch {
        // Ignore malformed SSE payloads.
      }
    });

    source.addEventListener("error", () => {
      void queryClient.invalidateQueries({ queryKey: summaryQueryKey });
    });

    return () => {
      source.close();
      eventSourceRef.current = null;
    };
  }, [queryClient]);

  return query;
}
