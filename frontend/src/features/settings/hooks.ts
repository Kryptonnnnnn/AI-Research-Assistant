"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { SettingsOut, SettingsUpdate } from "@/types/api";

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: () => api<SettingsOut>("/settings") });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SettingsUpdate) => api<SettingsOut>("/settings", { method: "PUT", body }),
    onSuccess: (data) => qc.setQueryData(qk.settings, data),
  });
}
