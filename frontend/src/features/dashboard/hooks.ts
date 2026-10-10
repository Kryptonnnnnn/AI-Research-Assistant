"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { Dashboard } from "@/types/api";

/** Dashboard metrics. Polls every 3 s only while documents are actually being processed. */
export function useDashboard() {
  return useQuery({
    queryKey: qk.dashboard,
    queryFn: () => api<Dashboard>("/dashboard"),
    staleTime: 5_000,
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      return d.documents.processing > 0 || (d.active_jobs?.length ?? 0) > 0 ? 3_000 : false;
    },
  });
}
